"""Application composition root and process-scoped resource lifecycle."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass, field
from threading import RLock
from typing import cast

from tapbot.android.client import AndroidAgentClient
from tapbot.android.device_registry import (
    AndroidDeviceContext,
    AndroidDeviceRegistry,
)
from tapbot.android.discovery import (
    AgentProbe,
    AndroidDiscoveryService,
    PeerProvider,
    TailscalePeerProvider,
)
from tapbot.android.models import AndroidDeviceConfig
from tapbot.android.probe import TapBotAgentProbe
from tapbot.android.http import AndroidHttpDependencies
from tapbot.android.policy import (
    default_classifier,
    default_state_machine,
    default_ui_selectors,
    default_ui_state_classifier,
)
from tapbot.android.service import AndroidService
from tapbot.vision.camera.manager import CameraManager
from tapbot.vision.camera.source import CameraSource
from tapbot.config import TapBotConfig
from tapbot.events import EventLog
from tapbot.system_service import SystemService
from tapbot.android.controller import AndroidRemoteController
from tapbot.macro import (
    MacroCoordinator,
    MacroEngine,
    MacroEvent,
    MacroExecutor,
    MacroService,
    TapBounds,
    TapPointSampler,
    TapPointSamplingPolicy,
    default_screen_geometry,
)
from tapbot.macro.binding import DeviceMacroBinding, DeviceMacroBindingRepository
from tapbot.macro.graph_engine import GraphEngine
from tapbot.macro.graph_models import GraphElement, GraphExecutionContext, JsonObject
from tapbot.macro.graph_store import FileMacroDefinitionStore
from tapbot.macro.graph_validator import GraphValidator
from tapbot.macro.node_registry import create_default_node_registry
from tapbot.macro.repository import MacroRepository
from tapbot.macro.runtime_manager import RuntimeManager
from tapbot.macro.service import MacroManagementService
from tapbot.ui_resolution.accessibility import AccessibilityUiResolver
from tapbot.ui_resolution.models import UiSelector
from tapbot.model.client import HttpModelClient, ModelClient
from tapbot.ui_resolution.visual import TargetResolver
from tapbot.model.service import ModelService
from tapbot.robot.controller import RobotController
from tapbot.robot.grbl import GrblRobotConfig, GrblRobotController, GrblSession
from tapbot.robot.models import WorkspaceBounds
from tapbot.robot.serial_transport import SerialTransport, SerialTransportConfig
from tapbot.robot.service import RobotCommandDispatcher, RobotService
from tapbot.robot.wifi_transport import WiFiTransport, WiFiTransportConfig
from tapbot.android.screen_source import AndroidRemoteScreenSource
from tapbot.ui_resolution import (
    AndroidAccessibilityUiTreeProvider,
    HybridTargetResolver,
    ScreenRecognizer,
)
from tapbot.vision.calibration import CalibrationStore
from tapbot.vision.canonical import CanonicalVisionPipeline
from tapbot.vision.detector import ColorButtonDetector, Detector
from tapbot.vision.service import CameraFrameWorker, VisionService


@dataclass(slots=True)
class ApplicationInstances:
    """One process-scoped dependency graph with explicit resource ownership."""

    config: TapBotConfig
    event_log: EventLog
    robot_controller: RobotController
    robot_service: RobotService
    camera: CameraSource
    camera_manager: CameraManager | None
    vision_service: VisionService
    android_registry: AndroidDeviceRegistry
    android_discovery: AndroidDiscoveryService
    system_service: SystemService
    android_http: AndroidHttpDependencies
    macro_repository: MacroRepository
    macro_bindings: DeviceMacroBindingRepository
    macro_runtime_manager: RuntimeManager
    macro_management_service: MacroManagementService
    model_client: ModelClient | None = None
    model_service: ModelService | None = None
    _started: bool = field(default=False, init=False, repr=False)
    _lifecycle_lock: RLock = field(default_factory=RLock, init=False, repr=False)

    @property
    def default_android_service(self) -> AndroidService | None:
        device_id = self.android_registry.default_device_id
        return None if device_id is None else self.android_registry.get(device_id).debug_service

    async def start(self) -> None:
        with self._lifecycle_lock:
            if self._started:
                return
            self._started = True
        try:
            await asyncio.to_thread(self.robot_service.start)
            self.android_discovery.start()
            self.event_log.add("TapBot backend services started")
        except BaseException:
            await self.stop()
            raise

    async def stop(self) -> None:
        with self._lifecycle_lock:
            if not self._started:
                return
            self._started = False
        await asyncio.to_thread(self.android_discovery.stop)
        await asyncio.to_thread(self.macro_runtime_manager.close)
        for context in self.android_registry.list():
            try:
                await asyncio.to_thread(context.debug_service.close)
            except Exception as error:
                self.event_log.add(
                    f"Android device close error ({context.config.id}): {error}",
                    level="error",
                    event_type="android.device.close_error",
                    category="android",
                    status="error",
                    payload={"device_id": context.config.id},
                )
        await asyncio.to_thread(self.vision_service.stop)
        await asyncio.to_thread(self.robot_service.stop_service)
        self.event_log.add("TapBot backend services stopped")


def create_instances(
    config: TapBotConfig,
    *,
    robot: RobotController | None = None,
    camera: CameraSource | None = None,
    camera_manager: CameraManager | None = None,
    calibration_store: CalibrationStore | None = None,
    vision_detectors: Sequence[Detector] | None = None,
    android_client: AndroidAgentClient | None = None,
    android_service: AndroidService | None = None,
    android_registry: AndroidDeviceRegistry | None = None,
    android_discovery: AndroidDiscoveryService | None = None,
    android_peer_provider: PeerProvider | None = None,
    android_probe: AgentProbe | None = None,
) -> ApplicationInstances:
    """Create the full singleton graph; domain modules never call this function."""

    if camera is not None and camera_manager is not None:
        raise ValueError("Provide either camera or camera_manager, not both")
    controller = robot or _create_robot_controller(config)
    manager = camera_manager
    if camera is None:
        manager = manager or CameraManager.with_defaults(
            config.camera.source,
            discovery_max_index=config.camera.discovery_max_index,
        )
        camera = manager

    event_log = android_registry.event_log if android_registry is not None else EventLog()
    bounds = WorkspaceBounds(
        max_x=config.robot.workspace_width,
        max_y=config.robot.workspace_height,
    )
    detectors = tuple(vision_detectors or (ColorButtonDetector(),))
    dispatcher = RobotCommandDispatcher(controller, event_log)
    robot_service = RobotService(
        controller,
        event_log,
        dispatcher=dispatcher,
        bounds=bounds,
    )
    camera_worker = CameraFrameWorker(camera, event_log, fps=config.camera.fps)
    vision_service = VisionService(
        camera,
        camera_worker,
        event_log,
        detectors,
        calibration_store or CalibrationStore(config.paths.calibration_file),
        bounds,
        camera_manager=manager,
    )

    if android_registry is None:
        context_factory = create_android_context_factory(config, detectors, event_log)
        android_registry = AndroidDeviceRegistry(
            event_log,
            context_factory=context_factory,
            default_device_id=config.android.default_device_id,
        )
        if android_client is not None or android_service is not None:
            service = android_service
            client = android_client or (None if service is None else service.client)
            assert client is not None
            android_registry.register(
                AndroidDeviceConfig(
                    service.device_id if service is not None else "default",
                    service.device_name if service is not None else "Android Device",
                    getattr(client, "base_url", "injected://android"),
                    "injected",
                ),
                client=client,
                debug_service=service,
            )
        else:
            for device in config.android.devices:
                android_registry.register(device)

    discovery = android_discovery or AndroidDiscoveryService(
        android_registry,
        event_log,
        enabled=config.android.discovery_enabled,
        provider_name=config.android.discovery_provider,
        peer_provider=android_peer_provider
        or TailscalePeerProvider(timeout_sec=config.android.discovery_timeout_sec),
        probe=android_probe
        or TapBotAgentProbe(
            port=config.android.agent_port,
            timeout_sec=config.android.discovery_timeout_sec,
        ),
        token=config.android.discovery_token,
        interval_sec=config.android.discovery_interval_sec,
        max_concurrency=config.android.discovery_max_concurrency,
    )

    model_client: ModelClient | None = None
    model_service: ModelService | None = None
    if config.model.endpoint is not None:
        model_client = HttpModelClient(
            config.model.endpoint,
            model_name=config.model.model_name,
            api_token=config.model.api_token,
        )
        model_service = ModelService(model_client)

    system_service = SystemService(robot_service, vision_service, android_registry, event_log)
    graph_validator = GraphValidator(create_default_node_registry(
        tap_point_sampler=_tap_point_sampler(config)
    ))
    macro_repository = MacroRepository(FileMacroDefinitionStore(
        config.paths.macro_definition_dir, validator=graph_validator
    ))
    macro_bindings = DeviceMacroBindingRepository(config.paths.macro_bindings_file)

    def device_exists(device_id: str) -> bool:
        try:
            android_registry.get(device_id)
        except KeyError:
            return False
        return True

    def device_online(device_id: str) -> bool:
        return bool(android_registry.refresh(device_id).get("connected"))

    macro_runtime_manager = RuntimeManager(
        macro_repository,
        macro_bindings,
        engine_factory=lambda _device_id: GraphEngine(create_default_node_registry(
            tap_point_sampler=_tap_point_sampler(config)
        )),
        context_factory=lambda device_id, binding: _graph_context(
            android_registry.get(device_id), binding
        ),
        device_online=device_online,
    )
    macro_management_service = MacroManagementService(
        macro_repository,
        macro_bindings,
        macro_runtime_manager,
        graph_validator,
        device_exists=device_exists,
    )
    return ApplicationInstances(
        config=config,
        event_log=event_log,
        robot_controller=controller,
        robot_service=robot_service,
        camera=camera,
        camera_manager=manager,
        vision_service=vision_service,
        android_registry=android_registry,
        android_discovery=discovery,
        system_service=system_service,
        android_http=AndroidHttpDependencies(
            android_registry,
            event_log,
            discovery=discovery,
            manual_token=config.android.discovery_token,
        ),
        macro_repository=macro_repository,
        macro_bindings=macro_bindings,
        macro_runtime_manager=macro_runtime_manager,
        macro_management_service=macro_management_service,
        model_client=model_client,
        model_service=model_service,
    )


def _tap_point_sampler(config: TapBotConfig) -> TapPointSampler:
    settings = config.tap_point
    return TapPointSampler(TapPointSamplingPolicy(
        enabled=settings.randomization_enabled,
        edge_inset_ratio=settings.edge_inset_ratio,
        sigma_x_ratio=settings.sigma_ratio,
        sigma_y_ratio=settings.sigma_ratio,
        min_jitter_px=settings.min_jitter_px,
        max_jitter_px=settings.max_jitter_px,
        max_attempts=settings.max_attempts,
    ))


class _AndroidGraphActions:
    def __init__(self, context: AndroidDeviceContext) -> None:
        self.context = context

    def tap_screen(self, x: float, y: float, *, duration_ms: int):
        result = self.context.controller.tap(x, y, duration_ms=duration_ms)
        self.context.ui_tree_provider.invalidate()
        return result.to_dict()

    def swipe(self, x1: float, y1: float, x2: float, y2: float, *, duration_ms: int):
        result = self.context.controller.swipe(x1, y1, x2, y2, duration_ms=duration_ms)
        self.context.ui_tree_provider.invalidate()
        return result.to_dict()

    def back(self):
        return self.context.debug_service.back()

    def home(self):
        return self.context.debug_service.home()


class _AndroidGraphUi:
    def __init__(self, context: AndroidDeviceContext) -> None:
        self.context = context
        self.resolver = AccessibilityUiResolver()

    def read_ui_tree(self):
        return self.context.ui_tree_provider.snapshot(max_age_ms=0).to_dict()

    def screen_size(self) -> tuple[int, int]:
        tree = self.context.ui_tree_provider.snapshot(max_age_ms=0)
        return tree.screen_width, tree.screen_height

    def resolve_screen_element(
        self,
        screen_id: str,
        element_id: str,
        params: dict[str, object],
    ) -> GraphElement:
        tree = self.context.ui_tree_provider.snapshot(max_age_ms=0)
        recognition = ScreenRecognizer().recognize(tree)
        if recognition is None or recognition.screen_id != screen_id:
            actual = "unknown" if recognition is None else recognition.screen_id
            raise RuntimeError(
                f"screen mismatch: expected {screen_id!r}, recognized {actual!r}"
            )
        semantic_id = element_id
        if element_id in {"quick_date", "time_slot"}:
            index = params.get("index")
            if isinstance(index, bool) or not isinstance(index, int) or index < 0:
                raise RuntimeError(f"{element_id} requires a non-negative index")
            semantic_id = f"{element_id}[{index}]"
        candidate = next(
            (item for item in recognition.elements if item.semantic_id == semantic_id),
            None,
        )
        if candidate is None:
            raise RuntimeError(
                f"screen element {screen_id}/{semantic_id} was not found"
            )
        return _semantic_graph_element(candidate)

    def find_element(
        self,
        selector: JsonObject,
        *,
        strategy: str = "unique",
        require_enabled: bool = True,
        require_visible: bool = True,
    ) -> GraphElement | None:
        tree = self.context.ui_tree_provider.snapshot(max_age_ms=0)
        semantic_id = selector.get("semantic_id")
        semantic_family = selector.get("semantic_family")
        if isinstance(semantic_id, str) or isinstance(semantic_family, str):
            recognition = ScreenRecognizer().recognize(tree)
            if recognition is None:
                return None
            index = selector.get("index")
            candidate = next((
                element for element in recognition.elements
                if (
                    isinstance(semantic_id, str)
                    and element.semantic_id == semantic_id
                ) or (
                    isinstance(semantic_family, str)
                    and element.metadata.get("family") == semantic_family
                    and (index is None or element.metadata.get("index") == index)
                )
            ), None)
            if candidate is None or not candidate.tappable:
                return None
            return _semantic_graph_element(candidate)
        allowed = {
            "text", "text_contains", "text_regex", "content_description",
            "content_description_regex", "view_id", "class_name", "bounds_region",
            "clickable", "enabled", "visible_to_user", "index", "ui_tree_path",
        }
        query_values = {key: value for key, value in selector.items() if key in allowed}
        if require_enabled:
            query_values["enabled"] = True
        if require_visible:
            query_values["visible_to_user"] = True
        query = UiSelector(**query_values)
        result = self.resolver.resolve(
            tree, query
        )
        element = result.element
        if result.status == "ambiguous" and strategy != "unique" and result.candidates:
            element = (
                result.candidates[0]
                if strategy == "first"
                else max(result.candidates, key=lambda candidate: candidate.confidence)
            )
        if element is None:
            return None
        return GraphElement(
            element.label,
            TapBounds.from_xywh(
                element.bbox.x, element.bbox.y, element.bbox.width, element.bbox.height
            ),
            element.text,
            {
                "view_id": element.view_id,
                "class_name": element.class_name,
                "ui_tree_path": element.metadata.get("matched_node_id"),
            },
        )

    def current_state(self) -> str:
        state = self.context.debug_service.debug_state().get("state", {})
        return str(state.get("current", "unknown")) if isinstance(state, dict) else "unknown"


def _graph_context(
    context: AndroidDeviceContext,
    binding: DeviceMacroBinding,
) -> GraphExecutionContext:
    variables = binding.config.get("variables", {})
    return GraphExecutionContext(
        device_id=context.config.id,
        variables=dict(variables) if isinstance(variables, dict) else {},
        actions=_AndroidGraphActions(context),
        ui=_AndroidGraphUi(context),
    )


def _semantic_graph_element(candidate) -> GraphElement:
    return GraphElement(
        candidate.semantic_id,
        TapBounds(
            candidate.bounds.left,
            candidate.bounds.top,
            candidate.bounds.right,
            candidate.bounds.bottom,
        ),
        candidate.text,
        {"semantic_id": candidate.semantic_id, **candidate.metadata},
    )


def _create_robot_controller(config: TapBotConfig) -> RobotController:
    settings = config.robot
    controller_config = GrblRobotConfig(
        feed_rate_mm_per_min=settings.feed_rate,
        workspace_width_mm=settings.workspace_width,
        workspace_height_mm=settings.workspace_height,
        tap_dwell_ms=settings.tap_dwell_ms,
        servo_down_command=settings.servo_down_command,
        servo_up_command=settings.servo_up_command,
        dry_run=settings.dry_run,
    )
    session: GrblSession | None = None
    if not settings.dry_run:
        if settings.transport == "serial":
            assert settings.serial_port is not None
            transport = SerialTransport(
                SerialTransportConfig(
                    port=settings.serial_port,
                    baud_rate=settings.baud_rate,
                )
            )
        else:
            assert settings.wifi_host is not None
            transport = WiFiTransport(
                WiFiTransportConfig(settings.wifi_host, settings.wifi_port)
            )
        session = GrblSession(transport)
    return GrblRobotController(session, controller_config)


def create_android_context_factory(
    config: TapBotConfig,
    detectors: tuple[Detector, ...],
    event_log: EventLog,
):
    capture_root = config.android.capture_dir
    trace_root = config.paths.macro_trace_dir

    def create_context(
        device: AndroidDeviceConfig,
        supplied_client: AndroidAgentClient | None,
        supplied_service: AndroidService | None,
    ) -> AndroidDeviceContext:
        if supplied_service is not None:
            client = supplied_client or supplied_service.client
            return AndroidDeviceContext(device, client, supplied_service)

        client = supplied_client or AndroidAgentClient(device.base_url, device.token)
        source = AndroidRemoteScreenSource(client, source_id=f"android:{device.id}")
        controller = AndroidRemoteController(client)
        vision = CanonicalVisionPipeline(detectors)
        classifier = default_classifier()
        state_machine = default_state_machine()
        target_resolver = TargetResolver(minimum_detection_confidence=0.5)
        ui_tree_provider = AndroidAccessibilityUiTreeProvider(client)
        hybrid_resolver = HybridTargetResolver(target_resolver, default_ui_selectors())
        ui_tree_classifier = default_ui_state_classifier()
        capture_dir = capture_root / device.id
        trace_dir = trace_root / device.id

        def engine_factory(macro_id: str) -> MacroEngine:
            tap_settings = config.tap_point
            executor = MacroExecutor(
                controller,
                geometry_factory=default_screen_geometry,
                after_execution=ui_tree_provider.invalidate,
                tap_point_sampler=TapPointSampler(
                    TapPointSamplingPolicy(
                        enabled=tap_settings.randomization_enabled,
                        edge_inset_ratio=tap_settings.edge_inset_ratio,
                        sigma_x_ratio=tap_settings.sigma_ratio,
                        sigma_y_ratio=tap_settings.sigma_ratio,
                        min_jitter_px=tap_settings.min_jitter_px,
                        max_jitter_px=tap_settings.max_jitter_px,
                        max_attempts=tap_settings.max_attempts,
                    )
                ),
            )
            coordinator = MacroCoordinator(
                source,
                vision,
                classifier,
                state_machine,
                target_resolver,
                executor,
                artifact_dir=capture_dir / "macros" / macro_id / "frames",
                ui_tree_provider=ui_tree_provider,
                hybrid_target_resolver=hybrid_resolver,
                ui_tree_state_classifier=ui_tree_classifier,
            )
            return MacroEngine(coordinator, macro_id=macro_id, device_id=device.id)

        def record_event(event: MacroEvent) -> None:
            event_log.add(
                f"Android macro {event.name.replace('_', ' ')}",
                level="error" if event.status == "error" else "info",
                event_type=f"android.macro.{event.name}",
                category="macro",
                status=event.status,
                trace_id=event.macro_id,
                payload={"device_id": device.id, **event.payload},
            )

        macro_service = MacroService(
            engine_factory,
            trace_path_factory=lambda macro_id: trace_dir / "macros" / macro_id / "trace.json",
            event_sink=record_event,
        )
        service = AndroidService(
            client,
            source,
            controller,
            vision,
            classifier,
            ui_tree_provider,
            ui_tree_classifier,
            macro_service,
            event_log,
            device_id=device.id,
            device_name=device.name,
            capture_dir=capture_dir,
        )
        return AndroidDeviceContext(device, cast(AndroidAgentClient, client), service)

    return create_context
