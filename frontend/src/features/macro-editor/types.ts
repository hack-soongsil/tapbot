import type { Edge, Node } from '@xyflow/react'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type MacroNodeType =
  | 'tap_element'
  | 'tap_point'
  | 'swipe'
  | 'back'
  | 'home'
  | 'wait'
  | 'find_element'
  | 'require_element'
  | 'read_ui_tree'
  | 'element_exists'
  | 'element_text_equals'
  | 'state_equals'
  | 'branch'
  | 'retry'
  | 'repeat'
  | 'timeout'
  | 'stop'
  | 'wait_for_element'
  | 'wait_for_state'
  | 'assert_element'

export type MacroNodeCategory =
  | 'ui'
  | 'action'
  | 'condition'
  | 'control'
  | 'validation'

export interface MacroPosition {
  x: number
  y: number
}

export interface MacroNodeDefinition {
  id: string
  type: MacroNodeType
  config: Record<string, JsonValue>
  position?: MacroPosition
  label?: string
}

export interface MacroEdgeDefinition {
  id: string
  source: string
  target: string
  source_handle?: string
  condition?: 'success' | 'failure' | 'retry' | 'stopped'
}

export interface MacroDefinition {
  id: string
  name: string
  version: number
  nodes: MacroNodeDefinition[]
  edges: MacroEdgeDefinition[]
  entry_node_id: string
  metadata: Record<string, JsonValue>
}

export interface MacroFlowNodeData extends Record<string, unknown> {
  nodeType: MacroNodeType
  category: MacroNodeCategory
  label: string
  definitionLabel?: string
  config: Record<string, JsonValue>
  isEntry: boolean
  errors: string[]
  runtimeState?: 'pending' | 'running' | 'success' | 'failure' | 'skipped'
}

export interface MacroFlowEdgeData extends Record<string, unknown> {
  condition?: MacroEdgeDefinition['condition']
  errors: string[]
}

export type MacroFlowNode = Node<MacroFlowNodeData>
export type MacroFlowEdge = Edge<MacroFlowEdgeData>

export interface ValidationIssue {
  message: string
  nodeId?: string
  edgeId?: string
  path?: string
  source: 'client' | 'backend'
}

export interface BackendValidationResponse {
  valid: boolean
  errors: Array<{
    message: string
    node_id?: string
    edge_id?: string
    path?: string
  }>
  warnings?: string[]
}

export interface MacroRunResponse {
  runtime: MacroRuntime
}

export interface DeviceMacroBinding {
  device_id: string
  macro_definition_id: string
  enabled: boolean
  config: Record<string, JsonValue>
}

export interface MacroBindingResponse {
  binding: DeviceMacroBinding | null
  shared_device_count: number
}

export interface MacroRuntime {
  device_id: string
  runtime_id: string | null
  macro_definition_id: string | null
  definition_version: number | null
  current_node_id: string | null
  current_edge_id: string | null
  state: 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'error'
  step_count: number
  variables: Record<string, JsonValue>
  trace: Array<Record<string, JsonValue>>
  started_at: string | null
  error: string | null
}
