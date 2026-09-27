import type { MacroRuntime } from '../macro-editor/types'
import type {
  MacroRuntimeEvent,
  MacroRuntimeView,
  RuntimeNodeState,
} from './types'

export const EVENT_LOG_LIMIT = 500

export const emptyRuntimeView = (): MacroRuntimeView => ({
  runtime: null,
  nodeState: {},
  currentNodeId: null,
  currentEdgeId: null,
  events: [],
  overlay: { bounds: null, tapPoint: null, nodeId: null },
  connected: false,
  lastSequence: null,
})

export function syncRuntimeSnapshot(
  current: MacroRuntimeView,
  runtime: MacroRuntime,
): MacroRuntimeView {
  const nodeState: Record<string, RuntimeNodeState> = {}
  for (const trace of runtime.trace) {
    const nodeId = stringValue(trace.node_id)
    const status = stringValue(trace.status)
    if (nodeId) nodeState[nodeId] = status === 'failure' ? 'failure' : 'success'
  }
  if (
    runtime.current_node_id &&
    (runtime.state === 'running' || runtime.state === 'paused')
  ) {
    nodeState[runtime.current_node_id] = 'running'
  }
  return {
    ...current,
    runtime,
    nodeState,
    currentNodeId: runtime.current_node_id,
    currentEdgeId: runtime.current_edge_id,
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
          state: 'idle' as const,
          step_count: 0,
          variables: {},
          trace: [],
          started_at: event.timestamp,
          error: null,
        },
      }
    : current
  const nodeState = { ...base.nodeState }
  let currentNodeId = base.currentNodeId
  let currentEdgeId = base.currentEdgeId
  let overlay = base.overlay

  if (event.type === 'macro.node.started' && event.node_id) {
    nodeState[event.node_id] = 'running'
    currentNodeId = event.node_id
    currentEdgeId = null
    overlay = { bounds: null, tapPoint: null, nodeId: event.node_id }
  } else if (event.type === 'macro.node.completed' && event.node_id) {
    nodeState[event.node_id] = 'success'
  } else if (event.type === 'macro.node.failed' && event.node_id) {
    nodeState[event.node_id] = 'failure'
  } else if (event.type === 'macro.node.skipped' && event.node_id) {
    nodeState[event.node_id] = 'skipped'
  } else if (event.type === 'macro.edge.traversed') {
    currentEdgeId = event.edge_id
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
  const runtime = base.runtime
    ? {
        ...base.runtime,
        runtime_id: event.runtime_id,
        current_node_id: currentNodeId,
        current_edge_id: currentEdgeId,
        state: normalizeRuntimeState(runtimeState, base.runtime.state),
      }
    : base.runtime
  return {
    ...base,
    runtime,
    nodeState,
    currentNodeId,
    currentEdgeId,
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
