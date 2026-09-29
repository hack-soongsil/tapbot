import type { MacroFlowEdge, MacroFlowNode } from './types'

export const MAIN_GRAPH_ID = 'main' as const
export type FunctionGraphId = `function:${string}`
export type GraphId = typeof MAIN_GRAPH_ID | FunctionGraphId

export interface GraphFlow {
  nodes: MacroFlowNode[]
  edges: MacroFlowEdge[]
}

export interface GraphStoreState {
  activeGraphId: GraphId
  graphs: Record<string, GraphFlow>
}

export const EMPTY_GRAPH: GraphFlow = { nodes: [], edges: [] }

export function functionGraphId(functionId: string): FunctionGraphId {
  return `function:${functionId}`
}

export function functionIdFromGraphId(graphId: GraphId): string | null {
  return graphId === MAIN_GRAPH_ID ? null : graphId.slice('function:'.length)
}

export function graphIdFromFunctionId(functionId: string | null | undefined): GraphId {
  return functionId ? functionGraphId(functionId) : MAIN_GRAPH_ID
}
