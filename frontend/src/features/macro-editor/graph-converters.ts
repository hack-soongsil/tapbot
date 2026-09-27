import { BLOCK_BY_TYPE } from './blocks'
import type {
  MacroDefinition,
  MacroFlowEdge,
  MacroFlowNode,
  MacroNodeType,
} from './types'

export interface FlowGraph {
  nodes: MacroFlowNode[]
  edges: MacroFlowEdge[]
}

export function macroDefinitionToFlow(definition: MacroDefinition): FlowGraph {
  const normalized = migrateLegacyEntry(definition)
  const nodesById = new Map(normalized.nodes.map((node) => [node.id, node]))
  return {
    nodes: normalized.nodes.map((node, index) => {
      const block = BLOCK_BY_TYPE.get(node.type)
      const eventKind = eventKindFor(normalized, node.id)
      return {
        id: node.id,
        type: block?.category ?? 'control',
        position: node.position ?? { x: 160 + index * 240, y: 120 },
        deletable: eventKind === undefined,
        data: {
          nodeType: node.type,
          category: block?.category ?? 'control',
          label: node.label ?? block?.label ?? node.type,
          definitionLabel: node.label,
          config: structuredClone(node.config),
          isEntry: node.id === normalized.entry_node_id,
          isEvent: eventKind !== undefined,
          eventKind,
          errors: [],
        },
      }
    }),
    edges: normalized.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: legacySourceHandle(nodesById.get(edge.source)?.type, edge),
      targetHandle: edge.target_handle,
      data: { condition: edge.condition, kind: edge.kind ?? 'exec', errors: [] },
      className: (edge.kind ?? 'exec') === 'data' ? 'macro-edge--data' : undefined,
    })),
  }
}

export function flowToMacroDefinition(
  base: Pick<MacroDefinition, 'id' | 'name' | 'version' | 'entry_node_id' | 'screen' | 'event_entry_node_ids' | 'metadata'>,
  nodes: MacroFlowNode[],
  edges: MacroFlowEdge[],
): MacroDefinition {
  const eventNodes = Object.fromEntries(
    nodes
      .filter((node) => node.data.eventKind)
      .map((node) => [node.data.eventKind, node.id]),
  ) as Partial<Record<'enter' | 'update' | 'exit', string>>
  const hasLifecycle = eventNodes.enter && eventNodes.update && eventNodes.exit
  return {
    id: base.id,
    name: base.name,
    version: base.version,
    ...(hasLifecycle
      ? {
          event_entry_node_ids: {
            enter: eventNodes.enter!,
            update: eventNodes.update!,
            exit: eventNodes.exit!,
          },
        }
      : base.entry_node_id ? { entry_node_id: base.entry_node_id } : {}),
    ...(base.screen ? { screen: structuredClone(base.screen) } : {}),
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
      ...(edge.targetHandle ? { target_handle: edge.targetHandle } : {}),
      kind: edge.data?.kind ?? 'exec',
      ...(edge.data?.condition ? { condition: edge.data.condition } : {}),
    })),
  }
}

function legacySourceHandle(
  sourceType: MacroNodeType | undefined,
  edge: MacroDefinition['edges'][number],
) {
  if (!edge.kind && sourceType === 'find_element' && edge.source_handle === 'found') {
    return 'exec_out'
  }
  return edge.source_handle
}

export function migrateLegacyEntry(definition: MacroDefinition): MacroDefinition {
  const entries = definition.event_entry_node_ids
  const hasCompleteLifecycle = Boolean(
    entries?.enter && entries.update && entries.exit &&
    definition.nodes.some((node) => node.id === entries.enter && node.type === 'screen_enter') &&
    definition.nodes.some((node) => node.id === entries.update && node.type === 'screen_update') &&
    definition.nodes.some((node) => node.id === entries.exit && node.type === 'screen_exit'),
  )
  if (hasCompleteLifecycle) return definition
  const legacyEntry = definition.entry_node_id ?? entries?.enter
  if (!legacyEntry) return definition
  const used = new Set(definition.nodes.map((node) => node.id))
  const enter = uniqueId('event-enter', used)
  used.add(enter)
  const update = uniqueId('event-update', used)
  used.add(update)
  const exit = uniqueId('event-exit', used)
  const eventNodes: MacroDefinition['nodes'] = [
    { id: enter, type: 'screen_enter', config: {}, position: { x: 80, y: 40 } },
    { id: update, type: 'screen_update', config: { interval_ms: 1_000, skip_if_running: true }, position: { x: 320, y: 40 } },
    { id: exit, type: 'screen_exit', config: {}, position: { x: 560, y: 40 } },
  ]
  return {
    ...definition,
    entry_node_id: undefined,
    event_entry_node_ids: { enter, update, exit },
    nodes: [...eventNodes, ...definition.nodes],
    edges: [
      {
        id: uniqueId('legacy-enter', new Set(definition.edges.map((edge) => edge.id))),
        source: enter,
        target: legacyEntry,
        source_handle: 'exec_out',
      },
      ...definition.edges,
    ],
  }
}

function eventKindFor(definition: MacroDefinition, nodeId: string) {
  const entries = definition.event_entry_node_ids
  if (entries?.enter === nodeId) return 'enter' as const
  if (entries?.update === nodeId) return 'update' as const
  if (entries?.exit === nodeId) return 'exit' as const
  return undefined
}

function uniqueId(prefix: string, used: Set<string>) {
  if (!used.has(prefix)) return prefix
  let index = 2
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}
