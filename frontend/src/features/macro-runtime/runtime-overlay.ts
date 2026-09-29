import type { MacroRuntime } from '../macro-editor/types'
import type { MacroRuntimeEvent, RuntimeGraphOverlay, RuntimeNodeState, RuntimeTrace } from './types'

export function traceGraphPath(trace: RuntimeTrace): string[] {
  return normalizeGraphPath(trace.graph_path)
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

export function runtimeNodeKey(nodeId: string, graphPath: unknown): string {
  const path = normalizeGraphPath(graphPath)
  return path.length > 0 ? JSON.stringify([...path, nodeId]) : nodeId
}

export function emptyRuntimeGraphOverlay(): RuntimeGraphOverlay {
  return {
    runtimeId: null,
    macroDefinitionId: null,
    graphPath: [],
    activeScreenId: null,
    currentNodeId: null,
    currentEdgeId: null,
    nodeStates: {},
    nodeErrors: {},
    error: null,
    errors: [],
    errorEdgeId: null,
    traces: [],
  }
}

export function runtimeGraphOverlayFromSnapshot(
  runtime: MacroRuntime,
  previous: RuntimeGraphOverlay = emptyRuntimeGraphOverlay(),
): RuntimeGraphOverlay {
  if (runtime.state === 'idle') return emptyRuntimeGraphOverlay()
  const traces = runtime.trace as RuntimeTrace[]
  const nodeStates: Record<string, RuntimeNodeState> = {}
  for (const trace of traces) {
    const nodeId = stringValue(trace.node_id)
    const status = stringValue(trace.status)
    if (!nodeId) continue
    nodeStates[runtimeNodeKey(nodeId, trace.graph_path)] = status === 'failure'
      ? 'failure'
      : status === 'skipped' ? 'skipped' : 'success'
  }
  const lastTracePath = traces.length > 0 ? traceGraphPath(traces[traces.length - 1]!) : []
  const graphPath = previous.runtimeId === runtime.runtime_id ? previous.graphPath : lastTracePath
  if (runtime.current_node_id && (runtime.state === 'running' || runtime.state === 'paused')) {
    nodeStates[runtimeNodeKey(runtime.current_node_id, graphPath)] = 'running'
  }
  return finalizeOverlay({
    ...previous,
    runtimeId: runtime.runtime_id,
    macroDefinitionId: runtime.macro_definition_id,
    graphPath,
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
  const eventPath = event.payload.graph_path === undefined ? base.graphPath : normalizeGraphPath(event.payload.graph_path)
  let graphPath = base.graphPath
  let currentNodeId = base.currentNodeId
  let currentEdgeId = base.currentEdgeId

  if (event.type.startsWith('macro.node.') && event.node_id) {
    graphPath = eventPath
    currentNodeId = event.node_id
    if (event.type === 'macro.node.started') {
      nodeStates[runtimeNodeKey(event.node_id, eventPath)] = 'running'
      currentEdgeId = null
    } else if (event.type === 'macro.node.completed') {
      nodeStates[runtimeNodeKey(event.node_id, eventPath)] = 'success'
    } else if (event.type === 'macro.node.failed') {
      nodeStates[runtimeNodeKey(event.node_id, eventPath)] = 'failure'
    } else if (event.type === 'macro.node.skipped') {
      nodeStates[runtimeNodeKey(event.node_id, eventPath)] = 'skipped'
    }
  } else if (event.type === 'macro.edge.traversed') {
    graphPath = eventPath
    currentEdgeId = event.edge_id
  }

  return finalizeOverlay({
    ...base,
    runtimeId: event.runtime_id,
    macroDefinitionId: event.macro_id,
    graphPath,
    activeScreenId: stringValue(event.payload.screen_id)
      ?? stringValue(event.payload.active_screen_id)
      ?? runtime?.active_screen_id
      ?? base.activeScreenId,
    currentNodeId,
    currentEdgeId,
    nodeStates,
    traces: (runtime?.trace ?? base.traces) as RuntimeTrace[],
  })
}

export function runtimeNodeState(overlay: RuntimeGraphOverlay, graphPath: string[], nodeId: string): RuntimeNodeState {
  return overlay.nodeStates[runtimeNodeKey(nodeId, graphPath)] ?? 'pending'
}

export function runtimeNodeError(overlay: RuntimeGraphOverlay, graphPath: string[], nodeId: string): RuntimeTrace | null {
  return overlay.nodeErrors[runtimeNodeKey(nodeId, graphPath)] ?? null
}

export function runtimeGraphMatches(overlay: RuntimeGraphOverlay, graphPath: string[]): boolean {
  return overlay.graphPath.length === graphPath.length
    && overlay.graphPath.every((id, index) => id === graphPath[index])
}

function finalizeOverlay(overlay: RuntimeGraphOverlay): RuntimeGraphOverlay {
  const errors = collectRuntimeErrors(overlay.traces)
  const nodeErrors: Record<string, RuntimeTrace> = {}
  for (const error of errors) {
    const nodeId = stringValue(error.node_id)
    if (nodeId) nodeErrors[runtimeNodeKey(nodeId, error.graph_path)] = error
  }
  const error = errors.at(-1) ?? null
  const payload = error ? traceErrorPayload(error) : null
  return {
    ...overlay,
    errors,
    nodeErrors,
    error,
    errorEdgeId: stringValue(payload?.edge_id),
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
