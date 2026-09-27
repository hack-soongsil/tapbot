"""Transport-neutral macro orchestration and lifecycle domain."""

from tapbot.macro.actions import (
    BackAction,
    HomeAction,
    MacroAction,
    RequestHumanAction,
    ScreenshotAction,
    SwipeAction,
    TapTargetAction,
    WaitAction,
)
from tapbot.macro.state import (
    DetectionStateClassifier,
    DetectionStateRule,
    MacroLifecycleError,
    MacroRuntimeState,
    MacroStateMachine,
    StateClassification,
    StateClassifier,
)
from tapbot.macro.coordinator import MacroCoordinator
from tapbot.macro.engine import MacroEngine
from tapbot.macro.executor import (
    MacroExecutionContext,
    MacroExecutor,
    PrimitiveExecutor,
    default_screen_geometry,
)
from tapbot.macro.models import (
    MacroCommand,
    MacroEvent,
    MacroExecutionResult,
    MacroExecutionStatus,
    MacroStateSnapshot,
    MacroStatus,
    MacroStepResult,
)
from tapbot.macro.service import MacroManagementService, MacroService
from tapbot.macro.binding import DeviceMacroBinding, DeviceMacroBindingRepository
from tapbot.macro.repository import MacroRepository
from tapbot.macro.runtime_manager import (
    DeviceRuntimeSnapshot,
    DeviceRuntimeStatus,
    RuntimeManager,
)
from tapbot.macro.events import MacroEventBroker, MacroRuntimeEvent
from tapbot.macro.trace import MacroStepTrace, MacroTrace
from tapbot.macro.tap_point import (
    TapBounds,
    TapPoint,
    TapPointSample,
    TapPointSampler,
    TapPointSamplingPolicy,
)
from tapbot.macro.graph_models import (
    GraphActionPort,
    GraphElement,
    GraphExecutionContext,
    GraphNodeTrace,
    GraphRunResult,
    GraphRuntime,
    GraphRuntimeStatus,
    GraphUiPort,
    MacroDefinition,
    MacroEdge,
    MacroNode,
    NodePosition,
    NodeResult,
    NodeStatus,
    EventEntryNodeIds,
    ScreenDefinition,
)
from tapbot.macro.screen_lifecycle import (
    ScreenLifecycleDispatcher,
    ScreenLifecycleEvent,
)
from tapbot.macro.graph_engine import GraphEngine, GraphRunLimits
from tapbot.macro.graph_validator import (
    GraphValidationError,
    GraphValidationReport,
    GraphValidator,
)
from tapbot.macro.node_registry import (
    NodeHandler,
    NodeRegistry,
    create_default_node_registry,
)
from tapbot.macro.graph_store import FileMacroDefinitionStore
from tapbot.macro.ports import NodePorts, PortType, ports_for

__all__ = [
    "BackAction",
    "DetectionStateClassifier",
    "DetectionStateRule",
    "HomeAction",
    "GraphActionPort",
    "GraphElement",
    "GraphEngine",
    "GraphExecutionContext",
    "GraphNodeTrace",
    "GraphRunLimits",
    "GraphRunResult",
    "GraphRuntime",
    "GraphRuntimeStatus",
    "GraphUiPort",
    "GraphValidationError",
    "GraphValidationReport",
    "GraphValidator",
    "FileMacroDefinitionStore",
    "MacroAction",
    "MacroCommand",
    "MacroCoordinator",
    "MacroEngine",
    "MacroEvent",
    "MacroExecutionContext",
    "MacroExecutionResult",
    "MacroExecutionStatus",
    "MacroExecutor",
    "MacroLifecycleError",
    "MacroDefinition",
    "EventEntryNodeIds",
    "ScreenDefinition",
    "ScreenLifecycleDispatcher",
    "ScreenLifecycleEvent",
    "MacroEdge",
    "MacroNode",
    "MacroRuntimeState",
    "MacroService",
    "MacroManagementService",
    "MacroRepository",
    "DeviceMacroBinding",
    "DeviceMacroBindingRepository",
    "DeviceRuntimeSnapshot",
    "DeviceRuntimeStatus",
    "RuntimeManager",
    "MacroEventBroker",
    "MacroRuntimeEvent",
    "MacroStateSnapshot",
    "MacroStateMachine",
    "MacroStatus",
    "MacroStepResult",
    "MacroStepTrace",
    "MacroTrace",
    "PrimitiveExecutor",
    "NodeHandler",
    "NodePorts",
    "NodePosition",
    "NodeRegistry",
    "NodeResult",
    "NodeStatus",
    "PortType",
    "RequestHumanAction",
    "ScreenshotAction",
    "StateClassification",
    "StateClassifier",
    "SwipeAction",
    "TapTargetAction",
    "TapBounds",
    "TapPoint",
    "TapPointSample",
    "TapPointSampler",
    "TapPointSamplingPolicy",
    "WaitAction",
    "create_default_node_registry",
    "default_screen_geometry",
    "ports_for",
]
