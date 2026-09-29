import { describe, expect, it } from 'vitest'
import { createEmptyMacroDefinition } from './definition-factory'
import { createFunctionDefinition } from './function-model'
import { normalizeDefinitionGraphs, serializeDefinitionGraphs } from './graph-store-converters'
import { MAIN_GRAPH_ID, functionGraphId } from './graph-store'

describe('graph store converters', () => {
  it('normalizes main and function graphs and serializes the existing macro schema', () => {
    const functionDefinition = createFunctionDefinition('reserve', 'Reserve')
    const definition = {
      ...createEmptyMacroDefinition('macro-1', 'Reservation'),
      functions: [functionDefinition],
    }

    const graphs = normalizeDefinitionGraphs(definition)
    expect(Object.keys(graphs).sort()).toEqual([MAIN_GRAPH_ID, functionGraphId('reserve')].sort())

    graphs[MAIN_GRAPH_ID]!.nodes[0]!.position = { x: 321, y: 654 }
    graphs[functionGraphId('reserve')]!.nodes[0]!.position = { x: 111, y: 222 }
    const serialized = serializeDefinitionGraphs(definition, graphs)

    expect(serialized.nodes[0]!.position).toEqual({ x: 321, y: 654 })
    expect(serialized.functions?.[0]?.nodes[0]?.position).toEqual({ x: 111, y: 222 })
    expect(serialized).not.toHaveProperty('activeGraphId')
    expect(serialized).not.toHaveProperty('graphs')
  })
})
