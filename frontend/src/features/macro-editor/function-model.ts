import type {
  JsonValue,
  MacroDefinition,
  MacroFunctionDefinition,
  MacroFunctionPort,
} from './types'
import type { GraphFlow } from './graph-store'

export function functionCallConfig(functionDefinition: MacroFunctionDefinition): Record<string, JsonValue> {
  return {
    function_id: functionDefinition.id,
    inputs: structuredClone(functionDefinition.inputs),
    outputs: structuredClone(functionDefinition.outputs),
  }
}

export function createFunctionDefinition(id: string, name: string): MacroFunctionDefinition {
  return {
    id,
    name,
    inputs: [],
    outputs: [],
    entry_node_id: `${id}-entry`,
    return_node_id: `${id}-return`,
    nodes: [
      {
        id: `${id}-entry`, type: 'function_entry', label: `${name} / 시작`,
        config: { inputs: [] }, position: { x: 80, y: 140 },
      },
      {
        id: `${id}-return`, type: 'function_return', label: `${name} / 반환`,
        config: { outputs: [] }, position: { x: 620, y: 140 },
      },
    ],
    edges: [],
  }
}

export function renameFunctionDefinition(
  functionDefinition: MacroFunctionDefinition,
  name: string,
): MacroFunctionDefinition {
  return {
    ...functionDefinition,
    name,
    nodes: functionDefinition.nodes.map((node) => node.id === functionDefinition.entry_node_id
      ? { ...node, label: `${name} / 시작` }
      : node.id === functionDefinition.return_node_id
        ? { ...node, label: `${name} / 반환` }
        : node),
  }
}

export function duplicateFunctionDefinition(
  source: MacroFunctionDefinition,
  id: string,
  name: string,
): MacroFunctionDefinition {
  const ids = new Map(source.nodes.map((node) => [
    node.id,
    node.id === source.entry_node_id
      ? `${id}-entry`
      : node.id === source.return_node_id
        ? `${id}-return`
        : `${id}-${node.id}`,
  ]))
  return {
    ...structuredClone(source),
    id,
    name,
    entry_node_id: `${id}-entry`,
    return_node_id: `${id}-return`,
    nodes: source.nodes.map((node) => ({
      ...structuredClone(node),
      id: ids.get(node.id)!,
      ...(node.id === source.entry_node_id ? { label: `${name} / 시작` } : {}),
      ...(node.id === source.return_node_id ? { label: `${name} / 반환` } : {}),
    })),
    edges: source.edges.map((edge) => ({
      ...structuredClone(edge),
      id: `${id}-${edge.id}`,
      source: ids.get(edge.source) ?? edge.source,
      target: ids.get(edge.target) ?? edge.target,
    })),
  }
}

export function normalizeFunctionPorts(ports: readonly MacroFunctionPort[]): MacroFunctionPort[] | null {
  const normalized = ports.map((port) => ({ ...port, id: port.id.trim() }))
  if (normalized.some((port) => !port.id)) return null
  if (new Set(normalized.map((port) => port.id)).size !== normalized.length) return null
  return normalized
}

export function synchronizeFunctionCalls(definition: MacroDefinition): MacroDefinition {
  const functions = structuredClone(definition.functions ?? [])
  const signatures = new Map(functions.map((item) => [item.id, item]))
  const syncNodes = (
    nodes: MacroDefinition['nodes'],
    boundary?: MacroFunctionDefinition,
  ) => nodes.map((node) => {
    if (boundary && node.id === boundary.entry_node_id) {
      return { ...node, config: { ...node.config, inputs: structuredClone(boundary.inputs) } }
    }
    if (boundary && node.id === boundary.return_node_id) {
      return { ...node, config: { ...node.config, outputs: structuredClone(boundary.outputs) } }
    }
    if (node.type !== 'call_function') return node
    const functionId = typeof node.config.function_id === 'string' ? node.config.function_id : ''
    const target = signatures.get(functionId)
    if (!target) return node
    return {
      ...node,
      label: target.name,
      config: {
        ...node.config,
        inputs: structuredClone(target.inputs),
        outputs: structuredClone(target.outputs),
      },
    }
  })
  return {
    ...definition,
    nodes: syncNodes(definition.nodes),
    functions: functions.map((item) => ({ ...item, nodes: syncNodes(item.nodes, item) })),
  }
}

export function synchronizeFlowFunctionCalls(
  flow: GraphFlow,
  functions: readonly MacroFunctionDefinition[],
): GraphFlow {
  const signatures = new Map(functions.map((item) => [item.id, item]))
  return {
    ...flow,
    nodes: flow.nodes.map((node) => {
      if (node.data.nodeType !== 'call_function') return node
      const functionId = typeof node.data.config.function_id === 'string'
        ? node.data.config.function_id
        : ''
      const target = signatures.get(functionId)
      if (!target) return node
      return {
        ...node,
        data: {
          ...node.data,
          label: target.name,
          definitionLabel: target.name,
          config: {
            ...node.data.config,
            inputs: structuredClone(target.inputs),
            outputs: structuredClone(target.outputs),
          },
        },
      }
    }),
  }
}

export function uniqueFunctionId(prefix: string, functions: readonly MacroFunctionDefinition[]) {
  const used = new Set(functions.map((item) => item.id))
  if (!used.has(prefix)) return prefix
  let index = 2
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

export function countFunctionReferences(
  functionId: string,
  graphs: Record<string, GraphFlow>,
) {
  return Object.values(graphs)
    .map((flow) => flow.nodes)
    .flat()
    .filter((node) => node.data.nodeType === 'call_function' && node.data.config.function_id === functionId)
    .length
}
