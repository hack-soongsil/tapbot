import type { Edge, Node } from '@xyflow/react'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type PortType =
  | 'exec'
  | 'any'
  | 'bool'
  | 'int'
  | 'float'
  | 'string'
  | 'position'
  | 'rect'
  | 'element'

export interface PortDefinition {
  id: string
  type: PortType
  label?: string
  optional?: boolean
}

export type MacroNodeType =
  | 'screen_enter'
  | 'screen_update'
  | 'screen_exit'
  | 'function_entry'
  | 'function_return'
  | 'call_function'
  | 'set_variable'
  | 'get_variable'
  | 'debug_print'
  | 'click_point'
  | 'drag_point'
  | 'random_click_area'
  | 'random_drag_area'
  | 'click_element'
  | 'find_screen_element'
  | 'click_screen_element'
  | 'for_loop'
  | 'sequence'
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
  | 'event'
  | 'ui'
  | 'action'
  | 'condition'
  | 'control'
  | 'validation'
  | 'utility'

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
  target_handle?: string
  kind?: 'exec' | 'data'
  condition?: 'success' | 'failure' | 'retry' | 'stopped'
}

export type MacroFunctionPort = Record<string, JsonValue> & {
  id: string
  type: Exclude<PortType, 'exec'>
  required?: boolean
  optional?: boolean
  default?: JsonValue
}

export interface MacroFunctionDefinition {
  id: string
  name: string
  inputs: MacroFunctionPort[]
  outputs: MacroFunctionPort[]
  nodes: MacroNodeDefinition[]
  edges: MacroEdgeDefinition[]
  entry_node_id: string
  return_node_id: string
}

export interface MacroVariableDefinition {
  name: string
  type: Exclude<PortType, 'exec' | 'any'>
  default?: JsonValue
  input?: boolean
  description?: string
  options?: JsonValue[]
}

export interface MacroDefinition {
  id: string
  name: string
  version: number
  nodes: MacroNodeDefinition[]
  edges: MacroEdgeDefinition[]
  entry_node_id?: string
  screen?: {
    id: string
    match: Record<string, JsonValue>
  }
  event_entry_node_ids?: {
    enter: string
    update?: string
    exit?: string
  }
  screen_event_entry_node_ids?: Record<string, {
    enter: string
    update: string
    exit: string
  }>
  metadata: Record<string, JsonValue>
  functions?: MacroFunctionDefinition[]
  variables?: MacroVariableDefinition[]
}

export interface MacroFlowNodeData extends Record<string, unknown> {
  nodeType: MacroNodeType
  category: MacroNodeCategory
  label: string
  definitionLabel?: string
  config: Record<string, JsonValue>
  isEntry: boolean
  isEvent?: boolean
  eventKind?: 'enter' | 'update' | 'exit'
  eventScreenId?: string
  errors: string[]
  // Render-only projection from RuntimeGraphOverlay. Graph converters deliberately
  // omit these fields so execution never becomes persisted editor data.
  runtimeState?: 'pending' | 'running' | 'success' | 'failure' | 'skipped'
  runtimeError?: Record<string, JsonValue>
}

export interface MacroFlowEdgeData extends Record<string, unknown> {
  condition?: MacroEdgeDefinition['condition']
  kind?: 'exec' | 'data'
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
  current_graph_id?: string | null
  current_graph_path?: string[]
  current_function_id?: string | null
  node_states?: Record<string, JsonValue>
  state: 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'error'
  active_screen_id?: string | null
  step_count: number
  variables: Record<string, JsonValue>
  trace: Array<Record<string, JsonValue>>
  started_at: string | null
  error: string | null
}
