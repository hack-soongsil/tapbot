import { BLOCK_BY_TYPE } from './blocks'
import type {
  MacroDefinition,
  MacroFlowEdge,
  MacroFlowNode,
} from './types'

export interface FlowGraph {
  nodes: MacroFlowNode[]
  edges: MacroFlowEdge[]
}

export function macroDefinitionToFlow(definition: MacroDefinition): FlowGraph {
  return {
    nodes: definition.nodes.map((node, index) => {
      const block = BLOCK_BY_TYPE.get(node.type)
      return {
        id: node.id,
        type: block?.category ?? 'control',
        position: node.position ?? { x: 160 + index * 240, y: 120 },
        data: {
          nodeType: node.type,
          category: block?.category ?? 'control',
          label: node.label ?? block?.label ?? node.type,
          definitionLabel: node.label,
          config: structuredClone(node.config),
          isEntry: node.id === definition.entry_node_id,
          errors: [],
        },
      }
    }),
    edges: definition.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.source_handle,
      data: { condition: edge.condition, errors: [] },
    })),
  }
}

export function flowToMacroDefinition(
  base: Pick<MacroDefinition, 'id' | 'name' | 'version' | 'entry_node_id' | 'metadata'>,
  nodes: MacroFlowNode[],
  edges: MacroFlowEdge[],
): MacroDefinition {
  return {
    id: base.id,
    name: base.name,
    version: base.version,
    entry_node_id: base.entry_node_id,
    metadata: structuredClone(base.metadata),
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      config: structuredClone(node.data.config),
      position: { x: node.position.x, y: node.position.y },
      ...(node.data.definitionLabel === undefined
        ? {}
        : { label: node.data.definitionLabel }),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { source_handle: edge.sourceHandle } : {}),
      ...(edge.data?.condition ? { condition: edge.data.condition } : {}),
    })),
  }
}
