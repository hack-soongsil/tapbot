import type { MacroRuntime } from '../macro-editor/types'
import {
  applyEventToRuntimeGraphOverlay,
  emptyRuntimeGraphOverlay,
  runtimeGraphOverlayFromSnapshot,
} from './runtime-overlay'
import type { MacroRuntimeEvent, MacroRuntimeView } from './types'

export const EVENT_LOG_LIMIT = 500

export const emptyRuntimeView = (): MacroRuntimeView => ({
  runtime: null,
  graphOverlay: emptyRuntimeGraphOverlay(),
  events: [],
  overlay: { bounds: null, tapPoint: null, nodeId: null },
  connected: false,
  lastSequence: null,
})

export function syncRuntimeSnapshot(
  current: MacroRuntimeView,
  runtime: MacroRuntime,
): MacroRuntimeView {
  return {
    ...current,
    runtime,
    graphOverlay: runtimeGraphOverlayFromSnapshot(runtime, current.graphOverlay),
    overlay:
      runtime.state === 'idle' || current.runtime?.runtime_id !== runtime.runtime_id
        ? { bounds: null, tapPoint: null, nodeId: null }
        : current.overlay,
    lastSequence: null,
  }
}

export function applyRuntimeEvent(
  current: MacroRuntimeView,
  event: MacroRuntimeEvent,
): MacroRuntimeView {
  const isNewRuntime = current.runtime?.runtime_id !== event.runtime_id
  const base = isNewRuntime
    ? {
        ...emptyRuntimeView(),
        connected: current.connected,
        runtime: {
          device_id: event.device_id,
          runtime_id: event.runtime_id,
          macro_definition_id: event.macro_id,
          definition_version: numberValue(event.payload.definition_version),
          current_node_id: stringValue(event.payload.entry_node_id),
          current_edge_id: null,
          current_graph_id: 'main',
          current_graph_path: ['main'],
          current_function_id: null,
          node_states: {},
          state: 'idle' as const,
          step_count: 0,
          variables: {},
          trace: [],
          started_at: event.timestamp,
          error: null,
        },
      }
    : current
  let currentNodeId = base.graphOverlay.currentNodeId
  let currentEdgeId = base.graphOverlay.currentEdgeId
  let overlay = base.overlay

  if (event.type === 'macro.node.started' && event.node_id) {
    currentNodeId = event.node_id
    currentEdgeId = null
    overlay = { bounds: null, tapPoint: null, nodeId: event.node_id }
  } else if (event.type === 'macro.edge.traversed') {
    currentEdgeId = event.edge_id
    currentNodeId = stringValue(event.payload.target) ?? currentNodeId
  } else if (event.type === 'android.element.resolved') {
    overlay = {
      ...overlay,
      bounds: numberBounds(event.payload.bounds),
      nodeId: event.node_id,
    }
  } else if (event.type === 'android.tap.planned') {
    overlay = {
      bounds: numberBounds(event.payload.bounds),
      tapPoint: numberPair(event.payload.tap_point),
      nodeId: event.node_id,
    }
  }

  const runtimeState = event.type.startsWith('macro.runtime.')
    ? event.type.slice('macro.runtime.'.length)
    : undefined
  if (runtimeState === 'reset') {
    currentNodeId = null
    currentEdgeId = null
    overlay = { bounds: null, tapPoint: null, nodeId: null }
  }
  let runtime = base.runtime
    ? {
        ...base.runtime,
        runtime_id: event.runtime_id,
        current_node_id: currentNodeId,
        current_edge_id: currentEdgeId,
        current_graph_id: stringValue(event.payload.graph_id) ?? base.runtime.current_graph_id,
        current_graph_path: stringArray(event.payload.graph_path) ?? base.runtime.current_graph_path,
        current_function_id: stringValue(event.payload.function_id) ?? (
          event.payload.function_id === null ? null : base.runtime.current_function_id
        ),
        node_states: base.runtime.node_states,
        state: normalizeRuntimeState(runtimeState, base.runtime.state),
      }
    : base.runtime
  if (runtime) {
    if (['macro.node.completed', 'macro.node.failed', 'macro.node.skipped'].includes(event.type) && event.node_id) {
      const entry = {
        ...event.payload,
        node_id: event.node_id,
        timestamp: event.payload.timestamp ?? event.timestamp,
        step: event.payload.step ?? runtime.trace.length + 1,
        graph_path: event.payload.graph_path ?? ['main'],
        status: event.payload.status ?? (
          event.type === 'macro.node.failed' ? 'failure'
            : event.type === 'macro.node.skipped' ? 'skipped' : 'success'
        ),
      }
      const alreadyPresent = runtime.trace.some((trace) => trace.step === entry.step && trace.timestamp === entry.timestamp)
      const trace = alreadyPresent ? runtime.trace : [...runtime.trace, entry]
      runtime = { ...runtime, trace, step_count: trace.length }
    }
    if (event.type === 'macro.runtime.failed') {
      runtime = { ...runtime, error: stringValue(event.payload.error) }
    }
    if (event.type === 'macro.runtime.reset') {
      runtime = { ...runtime, trace: [], step_count: 0, error: null }
    }
  }
  return {
    ...base,
    runtime,
    graphOverlay: applyEventToRuntimeGraphOverlay(base.graphOverlay, event, runtime),
    overlay,
    lastSequence: event.sequence,
    events: [...base.events, event].slice(-EVENT_LOG_LIMIT),
  }
}

function normalizeRuntimeState(
  eventState: string | undefined,
  fallback: MacroRuntime['state'],
): MacroRuntime['state'] {
  if (eventState === 'started' || eventState === 'resumed') return 'running'
  if (eventState === 'failed') return 'error'
  if (eventState === 'paused' || eventState === 'stopped' || eventState === 'completed') {
    return eventState
  }
  if (eventState === 'reset') return 'idle'
  return fallback
}

function numberPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== 'number')) {
    return null
  }
  return [value[0] as number, value[1] as number]
}

function numberBounds(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || value.some((item) => typeof item !== 'number')) {
    return null
  }
  return [value[0] as number, value[1] as number, value[2] as number, value[3] as number]
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown) {
  return typeof value === 'number' ? value : null
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value : null
}
