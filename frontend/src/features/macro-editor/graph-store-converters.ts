import {
  flowToMacroDefinition,
  flowToMacroFunction,
  macroDefinitionToFlow,
  macroFunctionToFlow,
} from './graph-converters'
import { EMPTY_GRAPH, MAIN_GRAPH_ID, functionGraphId, type GraphFlow } from './graph-store'
import type { MacroDefinition } from './types'

export function normalizeDefinitionGraphs(definition: MacroDefinition): Record<string, GraphFlow> {
  return {
    [MAIN_GRAPH_ID]: macroDefinitionToFlow(definition),
    ...Object.fromEntries((definition.functions ?? []).map((item) => [
      functionGraphId(item.id),
      macroFunctionToFlow(item),
    ])),
  }
}

export function serializeDefinitionGraphs(
  definition: MacroDefinition,
  graphs: Record<string, GraphFlow>,
): MacroDefinition {
  const mainGraph = graphs[MAIN_GRAPH_ID] ?? EMPTY_GRAPH
  const functions = (definition.functions ?? []).map((item) => {
    const graph = graphs[functionGraphId(item.id)]
    return graph ? flowToMacroFunction(item, graph.nodes, graph.edges) : item
  })
  return flowToMacroDefinition(
    { ...definition, functions },
    mainGraph.nodes,
    mainGraph.edges,
  )
}
