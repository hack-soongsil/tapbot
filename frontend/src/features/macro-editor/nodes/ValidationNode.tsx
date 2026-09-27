import type { NodeProps } from '@xyflow/react'
import type { MacroFlowNode } from '../types'
import { BaseNode } from './BaseNode'

export function ValidationNode(props: NodeProps<MacroFlowNode>) {
  return <BaseNode {...props} />
}
