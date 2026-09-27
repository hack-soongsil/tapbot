import type { JsonValue, MacroRuntime } from '../macro-editor/types'

export type RuntimeNodeState = 'pending' | 'running' | 'success' | 'failure' | 'skipped'

export interface MacroRuntimeEvent {
  event_id: string
  device_id: string
  runtime_id: string
  macro_id: string
  type: string
  sequence: number
  timestamp: string
  node_id: string | null
  edge_id: string | null
  payload: Record<string, JsonValue>
}

export interface MacroOverlayState {
  bounds: [number, number, number, number] | null
  tapPoint: [number, number] | null
  nodeId: string | null
}

export interface MacroRuntimeView {
  runtime: MacroRuntime | null
  nodeState: Record<string, RuntimeNodeState>
  currentNodeId: string | null
  currentEdgeId: string | null
  events: MacroRuntimeEvent[]
  overlay: MacroOverlayState
  connected: boolean
  lastSequence: number | null
}
