# Macro orchestration

The macro domain is independent from FastAPI, HTTP request models, Android
transport details, and GRBL serial internals.

```text
MacroService
  -> MacroEngine (lifecycle and runtime loop)
    -> MacroCoordinator (observe -> classify -> decide -> resolve)
      -> MacroExecutor (execute -> normalized result)
```

Concrete Android, robot, vision, classifier, and resolver implementations are
created outside this package and injected through high-level contracts.

```python
from tapbot.macro import (
    MacroCoordinator,
    MacroEngine,
    MacroExecutor,
    MacroService,
    default_screen_geometry,
)

def engine_factory(macro_id: str) -> MacroEngine:
    executor = MacroExecutor(
        primitive_controller,
        geometry_factory=default_screen_geometry,
    )
    coordinator = MacroCoordinator(
        screen_source,
        vision_pipeline,
        state_classifier,
        decision_policy,
        target_resolver,
        executor,
    )
    return MacroEngine(coordinator, macro_id=macro_id, device_id=device_id)

service = MacroService(engine_factory)
service.start()
step = service.step()
service.pause()
```

`TapTargetAction` contains a semantic label, never an HTTP command or
model-generated coordinate. The resolver selects a trusted UI-tree,
detection, or ROI target; the executor maps it to device coordinates and calls
only the injected primitive interface.

Immediately before a tap, `TapPointSampler` samples one center-weighted point
inside an inset safe region of the resolved element bounds. The same planned
point is used for trace/debug output and primitive execution; it is never
sampled again for that action. Tests can inject a seeded sampler, while setting
`TAPBOT_TAP_RANDOMIZATION_ENABLED=false` restores exact-center taps for
debugging and regression comparison.

Each step records the observation, classification, decision, resolved target,
normalized execution result, error policy, and trace evidence. Transport
timeouts preserve `outcome_unknown` so callers never infer that retrying a
non-idempotent input is safe.

## Graph definitions

`MacroDefinition` is the versioned, JSON-serializable workflow schema shared
with visual editors. `MacroNode.position` and `label` are editor metadata and
never affect execution. The canonical structural schema is
`macro-graph.schema.json`; type-specific config is checked by the registered
node handler before execution.

`GraphEngine` is a synchronous graph interpreter beneath the existing
`MacroEngine` lifecycle, not a second start/pause/stop state machine. It takes
a snapshot of the definition, validates it, dispatches through `NodeRegistry`,
and enforces step, timeout, retry, repeat, and cancellation guards. Android,
robot, and UI implementations are injected through `GraphActionPort` and
`GraphUiPort`; handlers never construct transports or services.

`tap_element` resolves bounds through the UI port and uses the same
`TapPointSampler` policy as the existing macro executor. Its one sampled point
is reused for primitive execution, node output, and trace output.

`FileMacroDefinitionStore` provides optional atomic JSON persistence below an
injected config path. The macro domain does not choose or hardcode a storage
directory.

## Device bindings and runtimes

`MacroRepository` owns versioned definitions, while
`DeviceMacroBindingRepository` persistently maps a stable Android `device_id`
to a definition. `RuntimeManager` snapshots that definition when a run starts
and owns an isolated execution context, variables, trace, cancellation gate,
and lifecycle for each device. One device cannot have two active runtimes;
different devices may execute the same definition concurrently without
sharing mutable state.

Bindings live at `TAPBOT_MACRO_BINDINGS_FILE` and definitions below
`TAPBOT_MACRO_DEFINITION_DIR`. Neither path is hardcoded in domain code.

## Live execution events

`MacroEventBroker` retains a bounded, device-isolated history. Every runtime
has its own ordered sequence and emits lifecycle, node, traversed-edge,
variable-key, resolved-element, and planned/completed tap events. The exact
tap point returned by `TapPointSampler` is reused in execution, trace, and
events.

`GET /api/android/{device_id}/macro/events` exposes these records as SSE and
supports the browser `Last-Event-ID` reconnect header. Clients first fetch the
runtime snapshot, then subscribe; a missed or truncated event range therefore
cannot permanently corrupt the visual state.

## Screen lifecycle graphs

Screen-aware definitions declare a rule-based `screen` signature and exactly
one `screen_enter`, `screen_update`, and `screen_exit` entry node. The runtime
refreshes the Android UI tree, dispatches transitions in `Exit(old) ->
Enter(new)` order, and runs only Update while the recognized screen remains
active. Update is single-flight and defaults to a 1000 ms interval. Stopping a
runtime does not synthesize a screen exit.

Legacy `entry_node_id` definitions remain readable. They are exposed as an
Enter-compatible entry and the React editor migrates them to protected event
nodes when opened and saved.

## Typed data wires

Graph edges distinguish control flow (`kind: "exec"`) from typed values
(`kind: "data"`). Missing `kind` remains a legacy exec edge. Data edges require
both source and target handles and exact matching types; implicit conversion is
not performed. The graph engine stores runtime-only output values separately
from JSON trace summaries and resolves them immediately before the target node
runs. This lets element references remain in-process without leaking transport
or snapshot-local identifiers into persisted definitions.
