import { SCREEN_OPTIONS } from './screen-elements'
import type { JsonValue, MacroDefinition, MacroFlowEdge, MacroFlowNode, MacroVariableDefinition } from './types'

const DEVICE_DRAFT_STORAGE_PREFIX = 'tapbot.macro.deviceDraft.'
const DEFAULT_SCREEN_ID = SCREEN_OPTIONS[0].id

export interface DeviceMacroDraft {
  definition: MacroDefinition
  isNew: boolean
}

function draftStorageKey(deviceId: string): string {
  return `${DEVICE_DRAFT_STORAGE_PREFIX}${deviceId}`
}

export function readDeviceDraft(deviceId: string): DeviceMacroDraft | null {
  try {
    const raw = window.sessionStorage.getItem(draftStorageKey(deviceId))
    if (!raw) return null
    const candidate = JSON.parse(raw) as Partial<DeviceMacroDraft>
    if (
      !candidate.definition
      || typeof candidate.definition.id !== 'string'
      || !Array.isArray(candidate.definition.nodes)
      || !Array.isArray(candidate.definition.edges)
    ) return null
    return { definition: candidate.definition, isNew: candidate.isNew === true }
  } catch {
    return null
  }
}

export function persistDeviceDraft(deviceId: string, draft: DeviceMacroDraft): void {
  window.sessionStorage.setItem(draftStorageKey(deviceId), JSON.stringify(draft))
}

export function clearDeviceDraft(deviceId: string): void {
  window.sessionStorage.removeItem(draftStorageKey(deviceId))
}

export function deriveNodeScreens(
  definition: MacroDefinition,
  nodes: MacroFlowNode[],
  edges: MacroFlowEdge[],
) {
  const result: Record<string, string> = {}
  const raw = definition.metadata.editor_screen_node_ids
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [screenId, ids] of Object.entries(raw)) {
      if (Array.isArray(ids)) {
        for (const id of ids) if (typeof id === 'string') result[id] = screenId
      }
    }
  }
  for (const node of nodes) {
    if (node.data.eventScreenId) result[node.id] = node.data.eventScreenId
  }
  for (const screen of SCREEN_OPTIONS) {
    const queue = nodes.filter((node) => node.data.eventScreenId === screen.id).map((node) => node.id)
    const visited = new Set(queue)
    while (queue.length > 0) {
      const source = queue.shift()!
      for (const edge of edges) {
        if (edge.source !== source || visited.has(edge.target)) continue
        const target = nodes.find((node) => node.id === edge.target)
        if (!target || (target.data.isEvent && target.data.eventScreenId !== screen.id)) continue
        visited.add(target.id)
        if (!target.data.isEvent && !result[target.id]) result[target.id] = screen.id
        queue.push(target.id)
      }
    }
  }
  for (const node of nodes) {
    if (!node.data.isEvent && !result[node.id]) result[node.id] = DEFAULT_SCREEN_ID
  }
  return result
}

export function serializeNodeScreens(nodeScreens: Record<string, string>, nodes: MacroFlowNode[]) {
  return Object.fromEntries(SCREEN_OPTIONS.map((screen) => [
    screen.id,
    nodes.filter((node) => !node.data.isEvent && nodeScreens[node.id] === screen.id).map((node) => node.id),
  ]))
}

export function variableNodeConfig(
  type: 'set_variable' | 'get_variable',
  variable: MacroVariableDefinition,
): Record<string, JsonValue> {
  return {
    name: variable.name,
    type: variable.type,
    ...(type === 'set_variable' ? { default: variable.default ?? null } : {}),
  }
}

export function synchronizeVariableNodes(definition: MacroDefinition): MacroDefinition {
  const variables = structuredClone(definition.variables ?? [])
  const byName = new Map(variables.map((item) => [item.name, item]))
  const sync = (nodes: MacroDefinition['nodes']) => nodes.map((node) => {
    if (node.type !== 'set_variable' && node.type !== 'get_variable') return node
    const name = typeof node.config.name === 'string' ? node.config.name : ''
    const variable = byName.get(name)
    return variable ? { ...node, config: variableNodeConfig(node.type, variable) } : node
  })
  return {
    ...definition,
    variables,
    nodes: sync(definition.nodes),
    functions: (definition.functions ?? []).map((item) => ({ ...item, nodes: sync(item.nodes) })),
  }
}
