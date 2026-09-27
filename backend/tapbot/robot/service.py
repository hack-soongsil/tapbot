"""Transport-independent robot command and state use cases."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import itertools
import math
from queue import PriorityQueue
from threading import Event, Lock, Thread
from time import perf_counter

from tapbot.robot.actions import (
    Action,
    EmergencyStopAction,
    HomeAction,
    MoveAction,
    PenDownAction,
    PenUpAction,
    TapAction,
)
from tapbot.events import EventLog
from tapbot.robot.executor import ActionExecutor
from tapbot.robot.controller import RobotController
from tapbot.robot.models import CoordinateValidationError, WorkspaceBounds


@dataclass(order=True, slots=True)
class _QueuedAction:
    priority: int
    sequence: int
    action: Action = field(compare=False)
    trace_id: str | None = field(compare=False, default=None)
    submitted_at: float = field(compare=False, default_factory=perf_counter)
    completed: Event = field(compare=False, default_factory=Event)
    error: BaseException | None = field(compare=False, default=None)
    shutdown: bool = field(compare=False, default=False)


class RobotCommandDispatcher:
    """Execute robot actions sequentially, prioritizing emergency stops."""

    _EMERGENCY_PRIORITY = 0
    _NORMAL_PRIORITY = 10
    _SHUTDOWN_PRIORITY = 100

    def __init__(self, controller: RobotController, event_log: EventLog) -> None:
        self.controller = controller
        self._executor = ActionExecutor(controller)
        self._event_log = event_log
        self._queue: PriorityQueue[_QueuedAction] = PriorityQueue()
        self._sequence = itertools.count()
        self._thread: Thread | None = None
        self._lifecycle_lock = Lock()
        self._activity_lock = Lock()
        self._active_commands = 0

    def start(self) -> None:
        with self._lifecycle_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._thread = Thread(
                target=self._run,
                name="tapbot-robot-dispatcher",
                daemon=True,
            )
            self._thread.start()

    def submit(
        self,
        action: Action,
        *,
        timeout: float = 10.0,
        trace_id: str | None = None,
    ) -> None:
        thread = self._thread
        if thread is None or not thread.is_alive():
            raise RuntimeError("Robot command dispatcher is not running")
        if isinstance(action, EmergencyStopAction):
            started_at = perf_counter()
            self._begin_command()
            try:
                self._executor.execute(action)
                self._event_log.add(
                    f"{type(self.controller).__name__} executed immediately: {action}",
                    event_type="robot.response",
                    category="robot",
                    status="success",
                    trace_id=trace_id,
                    latency_ms=(perf_counter() - started_at) * 1000,
                    payload={"action": repr(action), "immediate": True},
                )
            finally:
                self._end_command()
            return
        command = _QueuedAction(
            self._NORMAL_PRIORITY,
            next(self._sequence),
            action,
            trace_id=trace_id,
        )
        self._queue.put(command)
        if not command.completed.wait(timeout):
            raise TimeoutError(f"Robot action timed out: {action}")
        if command.error is not None:
            raise command.error

    def shutdown(self, *, timeout: float = 2.0) -> None:
        with self._lifecycle_lock:
            thread = self._thread
            if thread is None:
                return
            self._queue.put(
                _QueuedAction(
                    self._SHUTDOWN_PRIORITY,
                    next(self._sequence),
                    EmergencyStopAction(),
                    shutdown=True,
                )
            )
            thread.join(timeout)
            self._thread = None

    @property
    def pending_count(self) -> int:
        return self._queue.qsize()

    @property
    def is_busy(self) -> bool:
        with self._activity_lock:
            return self._active_commands > 0 or self._queue.qsize() > 0

    def _begin_command(self) -> None:
        with self._activity_lock:
            self._active_commands += 1

    def _end_command(self) -> None:
        with self._activity_lock:
            self._active_commands -= 1

    def _run(self) -> None:
        while True:
            command = self._queue.get()
            try:
                if command.shutdown:
                    return
                self._begin_command()
                self._executor.execute(command.action)
                self._event_log.add(
                    f"{type(self.controller).__name__} executed: {command.action}",
                    event_type="robot.response",
                    category="robot",
                    status="success",
                    trace_id=command.trace_id,
                    latency_ms=(perf_counter() - command.submitted_at) * 1000,
                    payload={"action": repr(command.action)},
                )
            except BaseException as error:
                command.error = error
                self._event_log.add(
                    f"Robot execution error for {command.action}: {error}",
                    level="error",
                    event_type="robot.error",
                    category="robot",
                    status="error",
                    trace_id=command.trace_id,
                    latency_ms=(perf_counter() - command.submitted_at) * 1000,
                    payload={"action": repr(command.action), "error": str(error)},
                )
            finally:
                if not command.shutdown:
                    self._end_command()
                command.completed.set()
                self._queue.task_done()


class RobotService:
    """Own robot use cases while hiding dispatcher and controller details."""

    def __init__(
        self,
        controller: RobotController,
        event_log: EventLog,
        *,
        dispatcher: RobotCommandDispatcher,
        bounds: WorkspaceBounds | None = None,
    ) -> None:
        self.controller = controller
        self.event_log = event_log
        self.bounds = bounds or WorkspaceBounds()
        self.dispatcher = dispatcher
        self._trace_ids = itertools.count(1)
        self._state_lock = Lock()
        self._state: dict[str, object] = {
            "x": 0.0,
            "y": 0.0,
            "homed": False,
            "pen": "unknown",
            "last_command": None,
        }

    def start(self) -> None:
        connect = getattr(self.controller, "connect", None)
        if callable(connect):
            try:
                connect()
                self.event_log.add(f"Robot connected: {type(self.controller).__name__}")
            except Exception as error:
                self.event_log.add(f"Robot connection error: {error}", level="error")
        self.dispatcher.start()

    def stop_service(self) -> None:
        self.dispatcher.shutdown()
        close = getattr(self.controller, "close", None)
        if callable(close):
            close()

    @property
    def mode(self) -> str:
        config = getattr(self.controller, "config", None)
        return "DRY-RUN" if getattr(config, "dry_run", False) else "REAL"

    def status(self) -> dict[str, object]:
        with self._state_lock:
            state = dict(self._state)
        return {
            "connected": bool(getattr(self.controller, "is_connected", True)),
            "busy": self.dispatcher.is_busy,
            "homed": state["homed"],
            "mode": self.mode,
            "position": {"x": state["x"], "y": state["y"]},
            "pen": state["pen"],
            "last_command": state["last_command"],
            "workspace": asdict(self.bounds),
            "queue_depth": self.dispatcher.pending_count,
        }

    def move(self, x: float, y: float) -> dict[str, object]:
        self._validate_coordinates(x, y)
        result = self._dispatch(MoveAction(x, y), f"move({x}, {y})")
        with self._state_lock:
            self._state.update(x=x, y=y, last_command="move")
        return result

    def tap(self, x: float, y: float) -> dict[str, object]:
        self._validate_coordinates(x, y)
        result = self._dispatch(TapAction(x, y), f"tap({x}, {y})")
        with self._state_lock:
            self._state.update(x=x, y=y, pen="up", last_command="tap")
        return result

    def home(self) -> dict[str, object]:
        result = self._dispatch(HomeAction(), "home")
        with self._state_lock:
            self._state.update(x=0.0, y=0.0, homed=True, last_command="home")
        return result

    def pen_up(self) -> dict[str, object]:
        result = self._dispatch(PenUpAction(), "pen up")
        with self._state_lock:
            self._state.update(pen="up", last_command="pen up")
        return result

    def pen_down(self) -> dict[str, object]:
        result = self._dispatch(PenDownAction(), "pen down")
        with self._state_lock:
            self._state.update(pen="down", last_command="pen down")
        return result

    def emergency_stop(self) -> dict[str, object]:
        result = self._dispatch(EmergencyStopAction(), "EMERGENCY STOP")
        with self._state_lock:
            self._state.update(
                homed=False,
                pen="unknown",
                last_command="emergency stop",
            )
        return result

    def _validate_coordinates(self, x: float, y: float) -> None:
        if not math.isfinite(x) or not math.isfinite(y):
            self.event_log.add(
                "Coordinate validation error: coordinates must be finite",
                level="error",
            )
            raise CoordinateValidationError("Coordinates must be finite")
        if not self.bounds.min_x <= x <= self.bounds.max_x:
            self.event_log.add(f"Coordinate validation error: X={x}", level="error")
            raise CoordinateValidationError(
                f"X must be between {self.bounds.min_x} and {self.bounds.max_x}"
            )
        if not self.bounds.min_y <= y <= self.bounds.max_y:
            self.event_log.add(f"Coordinate validation error: Y={y}", level="error")
            raise CoordinateValidationError(
                f"Y must be between {self.bounds.min_y} and {self.bounds.max_y}"
            )

    def _dispatch(self, action: Action, user_message: str) -> dict[str, object]:
        trace_id = f"manual-{next(self._trace_ids)}"
        parameters = asdict(action)
        self.event_log.add(
            f"User command: {user_message}",
            event_type="action.request",
            category="robot",
            status="info",
            trace_id=trace_id,
            payload={"command": user_message},
        )
        self.event_log.add(
            f"Action created: {action}",
            event_type="action.created",
            category="robot",
            status="success",
            trace_id=trace_id,
            payload={"action": type(action).__name__, "parameters": parameters},
        )
        self.event_log.add(
            f"Robot command: {type(action).__name__}",
            event_type="robot.command",
            category="robot",
            status="pending",
            trace_id=trace_id,
            payload={"action": type(action).__name__, "parameters": parameters},
        )
        try:
            self.dispatcher.submit(action, trace_id=trace_id)
        except Exception as error:
            self.event_log.add(
                f"Command failed: {error}",
                level="error",
                event_type="robot.error",
                category="robot",
                status="error",
                trace_id=trace_id,
                payload={"action": type(action).__name__, "error": str(error)},
            )
            raise
        return {"ok": True, "action": type(action).__name__}
