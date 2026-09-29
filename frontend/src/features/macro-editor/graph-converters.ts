import { BLOCK_BY_TYPE } from './blocks'
import {
  SCREEN_OPTIONS,
  canonicalElementId,
  canonicalScreenId,
} from './screen-elements'
import type {
  JsonValue,
  MacroDefinition,
  MacroFlowEdge,
  MacroFlowNode,
  MacroFunctionDefinition,
  MacroNodeType,
} from './types'

export interface FlowGraph { nodes: MacroFlowNode[]; edges: MacroFlowEdge[] }
type EventKind = 'enter' | 'update' | 'exit'
const EVENT_KINDS: readonly EventKind[] = ['enter', 'update', 'exit']
const EVENT_TYPES: Record<EventKind, MacroNodeType> = {
  enter: 'screen_enter', update: 'screen_update', exit: 'screen_exit',
}

export function macroDefinitionToFlow(definition: MacroDefinition): FlowGraph {
  const normalized = migrateLegacyEntry(definition)
  const nodesById = new Map(normalized.nodes.map((node) => [node.id, node]))
  return {
    nodes: normalized.nodes.map((node, index) => {
      const block = BLOCK_BY_TYPE.get(node.type)
      const event = eventIdentityFor(normalized, node.id)
      return {
        id: node.id,
        type: block?.category ?? 'control',
        position: node.position ?? { x: 160 + index * 240, y: 120 },
        deletable: event === undefined,
        data: {
          nodeType: node.type,
          category: block?.category ?? 'control',
          label: node.label ?? block?.label ?? node.type,
          definitionLabel: node.label,
          config: structuredClone(node.config),
          isEntry: node.id === normalized.entry_node_id,
          isEvent: event !== undefined,
          eventKind: event?.kind,
          eventScreenId: event?.screenId,
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
  base: Pick<MacroDefinition, 'id' | 'name' | 'version' | 'entry_node_id' | 'screen' | 'event_entry_node_ids' | 'screen_event_entry_node_ids' | 'metadata' | 'functions' | 'variables'>,
  nodes: MacroFlowNode[],
  edges: MacroFlowEdge[],
): MacroDefinition {
  const screenEntries: NonNullable<MacroDefinition['screen_event_entry_node_ids']> = {}
  for (const node of nodes) {
    const { eventScreenId, eventKind } = node.data
    if (!eventScreenId || !eventKind) continue
    const current = screenEntries[eventScreenId] ?? { enter: '', update: '', exit: '' }
    current[eventKind] = node.id
    screenEntries[eventScreenId] = current
  }
  const completeEntries = Object.fromEntries(
    Object.entries(screenEntries).filter(([, value]) => value.enter && value.update && value.exit),
  )
  return normalizeSemanticScreenIds({
    id: base.id,
    name: base.name,
    version: base.version,
    ...(Object.keys(completeEntries).length > 0
      ? { screen_event_entry_node_ids: completeEntries }
      : base.entry_node_id ? { entry_node_id: base.entry_node_id } : {}),
    metadata: structuredClone(base.metadata),
    functions: structuredClone(base.functions ?? []),
    variables: structuredClone(base.variables ?? []),
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      config: structuredClone(node.data.config),
      position: { x: node.position.x, y: node.position.y },
      ...(node.data.definitionLabel === undefined ? {} : { label: node.data.definitionLabel }),
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
  })
}

export function macroFunctionToFlow(functionDefinition: MacroFunctionDefinition): FlowGraph {
  const nodesById = new Map(functionDefinition.nodes.map((node) => [node.id, node]))
  return {
    nodes: functionDefinition.nodes.map((node, index) => {
      const block = BLOCK_BY_TYPE.get(node.type)
      const boundary = node.id === functionDefinition.entry_node_id || node.id === functionDefinition.return_node_id
      return {
        id: node.id,
        type: block?.category ?? 'control',
        position: node.position ?? { x: 100 + index * 280, y: 120 },
        deletable: !boundary,
        data: {
          nodeType: node.type,
          category: block?.category ?? 'control',
          label: node.label ?? block?.label ?? node.type,
          definitionLabel: node.label,
          config: structuredClone(node.config),
          isEntry: node.id === functionDefinition.entry_node_id,
          isEvent: boundary,
          errors: [],
        },
      }
    }),
    edges: functionDefinition.edges.map((edge) => ({
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

export function flowToMacroFunction(
  base: MacroFunctionDefinition,
  nodes: MacroFlowNode[],
  edges: MacroFlowEdge[],
): MacroFunctionDefinition {
  return {
    ...structuredClone(base),
    nodes: normalizeNodeScreenIds(nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      config: structuredClone(node.data.config),
      position: { x: node.position.x, y: node.position.y },
      ...(node.data.definitionLabel === undefined ? {} : { label: node.data.definitionLabel }),
    }))),
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

function legacySourceHandle(sourceType: MacroNodeType | undefined, edge: MacroDefinition['edges'][number]) {
  if (!edge.kind && sourceType === 'find_element' && edge.source_handle === 'found') return 'exec_out'
  return edge.source_handle
}

/** Normalize both single-entry and global-lifecycle drafts into per-screen lifecycle nodes. */
export function migrateLegacyEntry(definition: MacroDefinition): MacroDefinition {
  definition = normalizeSemanticScreenIds(definition)
  definition = migrateLegacyClickScreenElements(definition)
  const usedNodeIds = new Set(definition.nodes.map((node) => node.id))
  const entries: NonNullable<MacroDefinition['screen_event_entry_node_ids']> = structuredClone(
    definition.screen_event_entry_node_ids ?? {},
  )
  const legacyScreenId = definition.screen?.id ?? SCREEN_OPTIONS[0].id
  const legacy = definition.event_entry_node_ids
  if (legacy && !entries[legacyScreenId] && legacy.enter && legacy.update && legacy.exit) {
    entries[legacyScreenId] = { enter: legacy.enter, update: legacy.update, exit: legacy.exit }
  }

  const nodeById = new Map(definition.nodes.map((node) => [node.id, node]))
  const generated: MacroDefinition['nodes'] = []
  SCREEN_OPTIONS.forEach((screen, screenIndex) => {
    const current = entries[screen.id] ?? { enter: '', update: '', exit: '' }
    EVENT_KINDS.forEach((kind, kindIndex) => {
      let nodeId = current[kind]
      if (!nodeId || nodeById.get(nodeId)?.type !== EVENT_TYPES[kind]) {
        nodeId = uniqueId(`event-${screen.id.replaceAll('_', '-')}-${kind}`, usedNodeIds)
        usedNodeIds.add(nodeId)
        generated.push({
          id: nodeId,
          type: EVENT_TYPES[kind],
          config: eventConfig(screen.id, kind),
          position: { x: 80 + kindIndex * 250, y: 50 + screenIndex * 190 },
          label: `${screen.label} / ${title(kind)}`,
        })
      }
      current[kind] = nodeId
    })
    entries[screen.id] = current
  })

  const registeredIds = new Set(Object.values(entries).flatMap((entry) => EVENT_KINDS.map((kind) => entry[kind])))
  const normalizedExisting = definition.nodes
    .filter((node) => !node.type.startsWith('screen_') || registeredIds.has(node.id))
    .map((node) => {
      const identity = identityFromEntries(entries, node.id)
      if (!identity) return node
      const screen = SCREEN_OPTIONS.find((option) => option.id === identity.screenId)
      return {
        ...node,
        config: { ...node.config, ...eventConfig(identity.screenId, identity.kind) },
        label: `${screen?.label ?? identity.screenId} / ${title(identity.kind)}`,
      }
    })
  const allNodes = [...normalizedExisting, ...generated]
  const keptIds = new Set(allNodes.map((node) => node.id))
  const edges = definition.edges.filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target))
  const legacyEntry = definition.entry_node_id
  if (legacyEntry && keptIds.has(legacyEntry)) {
    const homeEnter = entries[SCREEN_OPTIONS[0].id]!.enter
    if (homeEnter !== legacyEntry && !edges.some((edge) => edge.source === homeEnter && edge.target === legacyEntry)) {
      edges.unshift({
        id: uniqueId('legacy-enter', new Set(edges.map((edge) => edge.id))),
        source: homeEnter,
        target: legacyEntry,
        source_handle: 'exec_out',
        kind: 'exec',
      })
    }
  }
  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    metadata: structuredClone(definition.metadata),
    functions: structuredClone(definition.functions ?? []),
    variables: structuredClone(definition.variables ?? []),
    screen_event_entry_node_ids: entries,
    nodes: allNodes,
    edges,
  }
}

export function normalizeSemanticScreenIds(definition: MacroDefinition): MacroDefinition {
  const entries = definition.screen_event_entry_node_ids
    ? Object.fromEntries(Object.entries(definition.screen_event_entry_node_ids).map(
      ([screenId, value]) => [canonicalScreenId(screenId), structuredClone(value)],
    ))
    : undefined
  const metadata = structuredClone(definition.metadata)
  const rawNodeScreens = metadata.editor_screen_node_ids
  if (rawNodeScreens && typeof rawNodeScreens === 'object' && !Array.isArray(rawNodeScreens)) {
    metadata.editor_screen_node_ids = Object.fromEntries(
      Object.entries(rawNodeScreens).map(([screenId, nodeIds]) => [
        canonicalScreenId(screenId), nodeIds,
      ]),
    )
  }
  return {
    ...structuredClone(definition),
    ...(definition.screen
      ? { screen: { ...structuredClone(definition.screen), id: canonicalScreenId(definition.screen.id) } }
      : {}),
    ...(entries ? { screen_event_entry_node_ids: entries } : {}),
    metadata,
    nodes: normalizeNodeScreenIds(definition.nodes),
    functions: (definition.functions ?? []).map((item) => ({
      ...structuredClone(item),
      nodes: normalizeNodeScreenIds(item.nodes),
    })),
  }
}

function normalizeNodeScreenIds(nodes: MacroDefinition['nodes']): MacroDefinition['nodes'] {
  return nodes.map((node) => {
    const rawScreenId = node.config.screen_id
    if (typeof rawScreenId !== 'string') return structuredClone(node)
    const screenId = canonicalScreenId(rawScreenId)
    const rawElementId = node.config.element_id
    return {
      ...structuredClone(node),
      config: {
        ...structuredClone(node.config),
        screen_id: screenId,
        ...(typeof rawElementId === 'string'
          ? { element_id: canonicalElementId(screenId, rawElementId) }
          : {}),
      },
    }
  })
}

export function migrateLegacyClickScreenElements(
  definition: MacroDefinition,
): MacroDefinition {
  const legacyNodes = definition.nodes.filter((node) => node.type === 'click_screen_element')
  if (legacyNodes.length === 0) return definition
  const usedNodeIds = new Set(definition.nodes.map((node) => node.id))
  const usedEdgeIds = new Set(definition.edges.map((edge) => edge.id))
  const clickIds = new Map<string, string>()
  const generatedEdges: MacroDefinition['edges'] = []
  const nodes: MacroDefinition['nodes'] = []
  for (const node of definition.nodes) {
    if (node.type !== 'click_screen_element') {
      nodes.push(node)
      continue
    }
    const clickId = uniqueId(`${node.id}-click`, usedNodeIds)
    usedNodeIds.add(clickId)
    clickIds.set(node.id, clickId)
    const legacyClick = jsonObject(node.config.click)
    const legacyMode = typeof legacyClick.mode === 'string' ? legacyClick.mode : 'center'
    const samplingMode = ['center', 'uniform', 'normal'].includes(legacyMode)
      ? legacyMode
      : 'center'
    const durationMs = typeof legacyClick.duration_ms === 'number'
      ? legacyClick.duration_ms
      : 70
    const execId = uniqueId(`${node.id}-to-click`, usedEdgeIds)
    usedEdgeIds.add(execId)
    const dataId = uniqueId(`${node.id}-element`, usedEdgeIds)
    usedEdgeIds.add(dataId)
    generatedEdges.push(
      {
        id: execId,
        source: node.id,
        target: clickId,
        source_handle: 'exec_out',
        target_handle: 'exec_in',
        kind: 'exec',
      },
      {
        id: dataId,
        source: node.id,
        target: clickId,
        source_handle: 'element',
        target_handle: 'element',
        kind: 'data',
      },
    )
    nodes.push(
      {
        ...node,
        type: 'find_screen_element' as const,
        label: 'Find Screen Element',
        config: {
          screen_id: node.config.screen_id ?? '',
          element_id: node.config.element_id ?? '',
          params: node.config.params ?? {},
        },
      },
      {
        id: clickId,
        type: 'click_element' as const,
        label: 'Click Element',
        config: { sampling_mode: samplingMode, click: { duration_ms: durationMs } },
        ...(node.position
          ? { position: { x: node.position.x + 260, y: node.position.y } }
          : {}),
      },
    )
  }
  return {
    ...definition,
    nodes,
    edges: [
      ...definition.edges.map((edge) => ({
        ...edge,
        source: clickIds.get(edge.source) ?? edge.source,
      })),
      ...generatedEdges,
    ],
  }
}

function eventConfig(screenId: string, kind: EventKind): Record<string, JsonValue> {
  return kind === 'update'
    ? { screen_id: screenId, event: kind, interval_ms: 1_000, skip_if_running: true }
    : { screen_id: screenId, event: kind }
}

function eventIdentityFor(definition: MacroDefinition, nodeId: string) {
  return identityFromEntries(definition.screen_event_entry_node_ids ?? {}, nodeId)
}

function identityFromEntries(
  entries: NonNullable<MacroDefinition['screen_event_entry_node_ids']>,
  nodeId: string,
): { screenId: string; kind: EventKind } | undefined {
  for (const [screenId, screenEntries] of Object.entries(entries)) {
    for (const kind of EVENT_KINDS) {
      if (screenEntries[kind] === nodeId) return { screenId, kind }
    }
  }
  return undefined
}

function title(kind: EventKind) {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

function uniqueId(prefix: string, used: Set<string>) {
  if (!used.has(prefix)) return prefix
  let index = 2
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function jsonObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}
