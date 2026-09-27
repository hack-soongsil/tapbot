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

Each step records the observation, classification, decision, resolved target,
normalized execution result, error policy, and trace evidence. Transport
timeouts preserve `outcome_unknown` so callers never infer that retrying a
non-idempotent input is safe.
