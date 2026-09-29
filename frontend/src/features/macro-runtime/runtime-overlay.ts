import type { MacroRuntime } from '../macro-editor/types'
import type { MacroRuntimeEvent, RuntimeGraphOverlay, RuntimeNodeState, RuntimeTrace } from './types'

export function traceGraphPath(trace: RuntimeTrace): string[] {
  return normalizeGraphPath(trace.graph_path)
}

export function traceGraphId(trace: RuntimeTrace): string {
  return runtimeGraphId(trace.graph_id, trace.graph_path)
}

export function normalizeGraphPath(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const path = value.filter((id): id is string => typeof id === 'string')
  return path[0]?.toLowerCase() === 'main' ? path.slice(1) : path
}

export function traceErrorOrigin(trace: RuntimeTrace): RuntimeTrace {
  let origin = trace
  for (let depth = 0; depth < 32; depth += 1) {
    const payload = origin.error_payload
    const cause = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.cause : null
    if (!cause || typeof cause !== 'object' || Array.isArray(cause)) break
    origin = cause
  }
  return origin
}

export function traceErrorPayload(trace: RuntimeTrace): RuntimeTrace {
  const payload = trace.error_payload
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
}

export function traceErrorMessage(trace: RuntimeTrace): string | null {
  const payload = traceErrorPayload(trace)
  if (typeof payload.summary === 'string' && payload.summary) return payload.summary
  if (typeof payload.message === 'string' && payload.message) return payload.message
  if (typeof trace.error === 'string' && trace.error) return trace.error
  return trace.status === 'failure' ? '노드 실행 실패' : null
}

export function traceErrorCode(trace: RuntimeTrace): string {
  const code = traceErrorPayload(trace).code
  return typeof code === 'string' ? code : 'NODE_EXECUTION_FAILED'
}

export function traceErrorEdgeId(trace: RuntimeTrace): string | null {
  return stringValue(traceErrorPayload(trace).edge_id)
}

export function traceErrorSummary(trace: RuntimeTrace): string {
  const message = (traceErrorMessage(trace) ?? '노드 실행 실패').split(/\r?\n/)[0] ?? ''
  return message.length > 160 ? `${message.slice(0, 160)}…` : message
}

export function collectRuntimeErrors(traces: RuntimeTrace[]): RuntimeTrace[] {
  const errors = new Map<string, RuntimeTrace>()
  for (const entry of traces) {
    if (entry.status && entry.status !== 'failure') continue
    if (!traceErrorMessage(entry)) continue
    const origin = traceErrorOrigin(entry)
    const key = JSON.stringify([origin.graph_path, origin.node_id, origin.timestamp ?? origin.started_at ?? origin.step])
    errors.set(key, origin)
  }
  return [...errors.values()]
}

export function runtimeGraphId(graphId: unknown, graphPath: unknown): string {
  if (typeof graphId === 'string' && graphId) return graphId
  const path = normalizeGraphPath(graphPath)
  return path.length > 0 ? `function:${path.at(-1)}` : 'main'
}

export function runtimeNodeKey(graphId: string, nodeId: string): string {
  return `${graphId}::${nodeId}`
}

export function runtimeEdgeKey(graphId: string, edgeId: string): string {
  return `${graphId}::${edgeId}`
}

export function emptyRuntimeGraphOverlay(): RuntimeGraphOverlay {
  return {
    runtimeId: null,
    macroDefinitionId: null,
    currentGraphId: 'main',
    currentGraphPath: ['main'],
    currentFunctionId: null,
    activeScreenId: null,
    currentNodeId: null,
    currentEdgeId: null,
    nodeStates: {},
    nodeErrors: {},
    error: null,
    errors: [],
    errorEdgeId: null,
    errorGraphId: null,
    traces: [],
  }
}

export function runtimeGraphOverlayFromSnapshot(
  runtime: MacroRuntime,
  previous: RuntimeGraphOverlay = emptyRuntimeGraphOverlay(),
): RuntimeGraphOverlay {
  if (runtime.state === 'idle') return emptyRuntimeGraphOverlay()
  const traces = runtime.trace as RuntimeTrace[]
  const snapshotNodeStates = runtime.node_states
  const nodeStates: Record<string, RuntimeNodeState> = snapshotNodeStates
    ? Object.fromEntries(Object.entries(snapshotNodeStates).filter(
        (entry): entry is [string, RuntimeNodeState] => isRuntimeNodeState(entry[1]),
      ))
    : {}
  for (const trace of traces) {
    const nodeId = stringValue(trace.node_id)
    const status = stringValue(trace.status)
    if (!nodeId) continue
    const key = runtimeNodeKey(traceGraphId(trace), nodeId)
    if (!(key in nodeStates)) {
      nodeStates[key] = status === 'failure'
        ? 'failure'
        : status === 'skipped' ? 'skipped' : 'success'
    }
  }
  const lastTrace = traces.at(-1)
  const previousApplies = previous.runtimeId === runtime.runtime_id
  const currentGraphPath = fullGraphPath(runtime.current_graph_path)
    ?? (previousApplies ? previous.currentGraphPath : fullGraphPath(lastTrace?.graph_path))
    ?? ['main']
  const currentGraphId = runtimeGraphId(
    runtime.current_graph_id ?? (previousApplies ? previous.currentGraphId : lastTrace?.graph_id),
    currentGraphPath,
  )
  const currentFunctionId = runtime.current_function_id
    ?? (currentGraphId.startsWith('function:') ? currentGraphId.slice('function:'.length) : null)
  if (!snapshotNodeStates && runtime.current_node_id && (runtime.state === 'running' || runtime.state === 'paused')) {
    nodeStates[runtimeNodeKey(currentGraphId, runtime.current_node_id)] = 'running'
  }
  return finalizeOverlay({
    ...previous,
    runtimeId: runtime.runtime_id,
    macroDefinitionId: runtime.macro_definition_id,
    currentGraphId,
    currentGraphPath,
    currentFunctionId,
    activeScreenId: runtime.active_screen_id ?? null,
    currentNodeId: runtime.current_node_id,
    currentEdgeId: runtime.current_edge_id,
    nodeStates,
    traces,
  })
}

export function applyEventToRuntimeGraphOverlay(
  current: RuntimeGraphOverlay,
  event: MacroRuntimeEvent,
  runtime: MacroRuntime | null,
): RuntimeGraphOverlay {
  if (event.type === 'macro.runtime.reset') return emptyRuntimeGraphOverlay()
  const isNewRuntime = current.runtimeId !== event.runtime_id
  const base = isNewRuntime ? emptyRuntimeGraphOverlay() : current
  const nodeStates = { ...base.nodeStates }
  const eventGraphPath = fullGraphPath(event.payload.graph_path) ?? base.currentGraphPath
  const eventGraphId = runtimeGraphId(event.payload.graph_id, eventGraphPath)
  let currentGraphId = base.currentGraphId
  let currentGraphPath = base.currentGraphPath
  let currentFunctionId = base.currentFunctionId
  let currentNodeId = base.currentNodeId
  let currentEdgeId = base.currentEdgeId

  if (event.type.startsWith('macro.node.') && event.node_id) {
    currentGraphId = eventGraphId
    currentGraphPath = eventGraphPath
    currentFunctionId = stringValue(event.payload.function_id)
      ?? (eventGraphId.startsWith('function:') ? eventGraphId.slice('function:'.length) : null)
    currentNodeId = event.node_id
    if (event.type === 'macro.node.started') {
      nodeStates[runtimeNodeKey(eventGraphId, event.node_id)] = 'running'
      currentEdgeId = null
    } else if (event.type === 'macro.node.completed') {
      nodeStates[runtimeNodeKey(eventGraphId, event.node_id)] = 'success'
    } else if (event.type === 'macro.node.failed') {
      nodeStates[runtimeNodeKey(eventGraphId, event.node_id)] = 'failure'
    } else if (event.type === 'macro.node.skipped') {
      nodeStates[runtimeNodeKey(eventGraphId, event.node_id)] = 'skipped'
    }
  } else if (event.type === 'macro.edge.traversed') {
    currentGraphId = eventGraphId
    currentGraphPath = eventGraphPath
    currentFunctionId = stringValue(event.payload.function_id)
      ?? (eventGraphId.startsWith('function:') ? eventGraphId.slice('function:'.length) : null)
    currentEdgeId = event.edge_id
  }

  return finalizeOverlay({
    ...base,
    runtimeId: event.runtime_id,
    macroDefinitionId: event.macro_id,
    currentGraphId,
    currentGraphPath,
    currentFunctionId,
    activeScreenId: stringValue(event.payload.screen_id)
      ?? stringValue(event.payload.active_screen_id)
      ?? runtime?.active_screen_id
      ?? base.activeScreenId,
    currentNodeId,
    currentEdgeId,
    nodeStates,
    traces: runtime?.trace ?? base.traces,
  })
}

export function runtimeNodeState(overlay: RuntimeGraphOverlay, graphId: string, nodeId: string): RuntimeNodeState {
  return overlay.nodeStates[runtimeNodeKey(graphId, nodeId)] ?? 'pending'
}

export function runtimeNodeError(overlay: RuntimeGraphOverlay, graphId: string, nodeId: string): RuntimeTrace | null {
  return overlay.nodeErrors[runtimeNodeKey(graphId, nodeId)] ?? null
}

export function runtimeGraphMatches(overlay: RuntimeGraphOverlay, graphId: string): boolean {
  return overlay.currentGraphId === graphId
}

function finalizeOverlay(overlay: RuntimeGraphOverlay): RuntimeGraphOverlay {
  const errors = collectRuntimeErrors(overlay.traces)
  const nodeErrors: Record<string, RuntimeTrace> = {}
  for (const error of errors) {
    const nodeId = stringValue(error.node_id)
    if (nodeId) nodeErrors[runtimeNodeKey(traceGraphId(error), nodeId)] = error
  }
  const error = errors.at(-1) ?? null
  const payload = error ? traceErrorPayload(error) : null
  return {
    ...overlay,
    errors,
    nodeErrors,
    error,
    errorEdgeId: stringValue(payload?.edge_id),
    errorGraphId: error ? traceGraphId(error) : null,
  }
}

function fullGraphPath(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const path = value.filter((id): id is string => typeof id === 'string')
  if (path.length === 0) return ['main']
  return path[0]?.toLowerCase() === 'main' ? ['main', ...path.slice(1)] : ['main', ...path]
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isRuntimeNodeState(value: unknown): value is RuntimeNodeState {
  return value === 'pending' || value === 'running' || value === 'success'
    || value === 'failure' || value === 'skipped'
}
