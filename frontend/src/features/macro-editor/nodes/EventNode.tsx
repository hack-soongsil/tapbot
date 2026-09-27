import type { NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { MacroFlowNode } from '../types'

export function EventNode(props: NodeProps<MacroFlowNode>) {
  return <BaseNode {...props} />
}
