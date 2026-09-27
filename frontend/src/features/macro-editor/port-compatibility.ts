import { getNodePorts } from './blocks'
import type { MacroFlowNode } from './types'

export interface PortConnection {
  source: string | null
  target: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
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
  if (!sourceType || !targetType || sourceType !== targetType) return null
  return sourceType === 'exec' ? 'exec' : 'data'
}
