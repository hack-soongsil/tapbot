import { getNodePorts } from './blocks'
import type { SearchItem } from './search-provider'
import type { JsonValue, MacroFlowNode, MacroNodeType, PortDefinition, PortType } from './types'

export interface PortConnection {
  source: string | null
  target: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface SourcePortContext {
  source_node_id: string
  source_port_id: string | null
  source_port_type: PortType
  source_direction: 'input' | 'output'
}

export interface CreatedMacroNode {
  id: string
  type: MacroNodeType
  config: Record<string, JsonValue>
}

export function connectionKind(
  nodes: readonly MacroFlowNode[],
  connection: PortConnection,
): 'exec' | 'data' | null {
  if (!connection.source || !connection.target) return null
  const source = nodes.find((node) => node.id === connection.source)
  const target = nodes.find((node) => node.id === connection.target)
  if (!source || !target) return null
  const sourceType = connection.sourceHandle == null
    ? 'exec'
    : getNodePorts(source.data.nodeType, source.data.config).outputs
        .find((port) => port.id === connection.sourceHandle)?.type
  const targetType = connection.targetHandle == null
    ? 'exec'
    : getNodePorts(target.data.nodeType, target.data.config).inputs
        .find((port) => port.id === connection.targetHandle)?.type
  if (!sourceType || !targetType) return null
  if (!portTypesAreCompatible(sourceType, targetType)) return null
  return sourceType === 'exec' ? 'exec' : 'data'
}

export function portTypesAreCompatible(sourceType: string, targetType: string) {
  if (sourceType === 'exec' || targetType === 'exec') {
    return sourceType === 'exec' && targetType === 'exec'
  }
  return sourceType === targetType || sourceType === 'any' || targetType === 'any'
}

export function sourcePortContext(
  nodes: readonly MacroFlowNode[],
  nodeId: string | null,
  handleId: string | null,
  handleType: 'source' | 'target' | null,
): SourcePortContext | null {
  if (!nodeId || !handleType) return null
  const node = nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return null
  const direction = handleType === 'source' ? 'output' : 'input'
  const ports = getNodePorts(node.data.nodeType, node.data.config)
  const candidates = direction === 'output' ? ports.outputs : ports.inputs
  const portType = handleId === null
    ? 'exec'
    : candidates.find((port) => port.id === handleId)?.type
  if (!portType) return null
  return {
    source_node_id: nodeId,
    source_port_id: handleId,
    source_port_type: portType,
    source_direction: direction,
  }
}

export function compatiblePorts(
  type: MacroNodeType,
  config: Record<string, JsonValue>,
  context: SourcePortContext,
): PortDefinition[] {
  const ports = getNodePorts(type, config)
  const candidates = context.source_direction === 'output' ? ports.inputs : ports.outputs
  return candidates
    .filter((port) => context.source_direction === 'output'
      ? portTypesAreCompatible(context.source_port_type, port.type)
      : portTypesAreCompatible(port.type, context.source_port_type))
    .map((port, index) => ({ port, index, score: portPriority(port, context) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ port }) => port)
}

export function blockSupportsPortContext(
  block: Pick<SearchItem, 'type' | 'defaultConfig'>,
  context: SourcePortContext,
): boolean {
  return compatiblePorts(block.type, block.defaultConfig, context).length > 0
}

export function connectionForCreatedNode(
  context: SourcePortContext,
  created: CreatedMacroNode,
): { connection: PortConnection; kind: 'exec' | 'data' } | null {
  const port = compatiblePorts(created.type, created.config, context)[0]
  if (!port) return null
  const connection = context.source_direction === 'output'
    ? {
        source: context.source_node_id,
        sourceHandle: context.source_port_id,
        target: created.id,
        targetHandle: port.id,
      }
    : {
        source: created.id,
        sourceHandle: port.id,
        target: context.source_node_id,
        targetHandle: context.source_port_id,
      }
  return {
    connection,
    kind: context.source_port_type === 'exec' ? 'exec' : 'data',
  }
}

function portPriority(port: PortDefinition, context: SourcePortContext): number {
  const conventionalId = context.source_direction === 'output' ? 'exec_in' : 'exec_out'
  return (port.type === context.source_port_type ? 100 : 0)
    + (port.id === conventionalId ? 20 : 0)
    + (port.optional ? 0 : 10)
}
