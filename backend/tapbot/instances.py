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
    default_screen_geometry,
)
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
            self.vision_service.start()
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
        model_client=model_client,
        model_service=model_service,
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
            executor = MacroExecutor(
                controller,
                geometry_factory=default_screen_geometry,
                after_execution=ui_tree_provider.invalidate,
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
