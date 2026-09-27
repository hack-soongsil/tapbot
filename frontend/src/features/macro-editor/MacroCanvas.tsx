import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type OnConnect,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useRef, type DragEvent } from 'react'
import { MACRO_BLOCK_MIME } from './BlockPalette'
import { ActionNode } from './nodes/ActionNode'
import { ConditionNode } from './nodes/ConditionNode'
import { ControlNode } from './nodes/ControlNode'
import { UiNode } from './nodes/UiNode'
import { ValidationNode } from './nodes/ValidationNode'
import type { MacroFlowEdge, MacroFlowNode, MacroNodeType } from './types'

const nodeTypes: NodeTypes = {
  ui: UiNode,
  action: ActionNode,
  condition: ConditionNode,
  control: ControlNode,
  validation: ValidationNode,
}

export interface MacroCanvasProps {
  nodes: MacroFlowNode[]
  edges: MacroFlowEdge[]
  onNodesChange: (changes: NodeChange<MacroFlowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<MacroFlowEdge>[]) => void
  onConnect: OnConnect
  onSelectNode: (nodeId: string | null) => void
  onDropBlock: (type: MacroNodeType, position: { x: number; y: number }) => void
  onReady: (instance: ReactFlowInstance<MacroFlowNode, MacroFlowEdge>) => void
}

export function MacroCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectNode,
  onDropBlock,
  onReady,
}: MacroCanvasProps) {
  const flowInstance = useRef<ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null>(null)
  const allowDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const drop = (
    event: DragEvent<HTMLDivElement>,
    instance: ReactFlowInstance<MacroFlowNode, MacroFlowEdge>,
  ) => {
    event.preventDefault()
    const nodeType = event.dataTransfer.getData(MACRO_BLOCK_MIME) as MacroNodeType
    if (!nodeType) return
    onDropBlock(
      nodeType,
      instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    )
  }

  return (
    <section className="macro-canvas" aria-label="Macro graph canvas">
      <ReactFlow<MacroFlowNode, MacroFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        onInit={(instance) => {
          flowInstance.current = instance
          onReady(instance)
        }}
        onDragOver={allowDrop}
        onDrop={(event) => {
          if (flowInstance.current) drop(event, flowInstance.current)
        }}
        fitView
        minZoom={0.25}
        maxZoom={1.8}
        deleteKeyCode={['Backspace', 'Delete']}
        selectionKeyCode="Shift"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  )
}
