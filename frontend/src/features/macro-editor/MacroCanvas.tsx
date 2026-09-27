import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  MiniMap,
  ReactFlow,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useRef, useState, type DragEvent } from 'react'
import { MACRO_BLOCK_MIME } from './BlockPalette'
import { BLOCKS } from './blocks'
import { QuickBlockSearch } from './QuickBlockSearch'
import {
  connectionForCreatedNode,
  connectionKind,
  sourcePortContext as resolveSourcePortContext,
  type CreatedMacroNode,
  type SourcePortContext,
} from './port-compatibility'
import { ActionNode } from './nodes/ActionNode'
import { ConditionNode } from './nodes/ConditionNode'
import { ControlNode } from './nodes/ControlNode'
import { UiNode } from './nodes/UiNode'
import { ValidationNode } from './nodes/ValidationNode'
import { EventNode } from './nodes/EventNode'
import type { MacroFlowEdge, MacroFlowNode, MacroNodeType } from './types'

const nodeTypes: NodeTypes = {
  event: EventNode,
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
  onConnect: (connection: Connection, kind?: 'exec' | 'data') => void
  onSelectNode: (nodeId: string | null) => void
  onDropBlock: (
    type: MacroNodeType,
    position: { x: number; y: number },
  ) => CreatedMacroNode | null | undefined
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
  const draggedPort = useRef<SourcePortContext | null>(null)
  const [quickSearch, setQuickSearch] = useState<{
    screenPosition: { x: number; y: number }
    flowPosition: { x: number; y: number }
    sourcePortContext: SourcePortContext | null
  } | null>(null)
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
        isValidConnection={(connection) => connectionKind(nodes, connection) !== null}
        onConnect={(connection) => {
          const kind = connectionKind(nodes, connection)
          if (kind !== null) onConnect(connection, kind)
        }}
        onConnectStart={(_, params) => {
          draggedPort.current = resolveSourcePortContext(
            nodes,
            params.nodeId,
            params.handleId,
            params.handleType,
          )
        }}
        onConnectEnd={(event, connectionState) => {
          const context = draggedPort.current
          draggedPort.current = null
          if (
            !context ||
            connectionState.isValid === true ||
            connectionState.toNode !== null ||
            !isEmptyCanvasTarget(event.target) ||
            !flowInstance.current
          ) return
          const screenPosition = pointerPosition(event)
          if (!screenPosition) return
          setQuickSearch({
            screenPosition,
            flowPosition: flowInstance.current.screenToFlowPosition(screenPosition),
            sourcePortContext: context,
          })
        }}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => {
          setQuickSearch(null)
          onSelectNode(null)
        }}
        onPaneContextMenu={(event) => {
          if (!flowInstance.current || isCanvasChrome(event.target)) return
          event.preventDefault()
          setQuickSearch({
            screenPosition: { x: event.clientX, y: event.clientY },
            flowPosition: flowInstance.current.screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            }),
            sourcePortContext: null,
          })
        }}
        onNodeContextMenu={(event) => event.stopPropagation()}
        onEdgeContextMenu={(event) => event.stopPropagation()}
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
      <QuickBlockSearch
        open={quickSearch !== null}
        screenPosition={quickSearch?.screenPosition ?? { x: 0, y: 0 }}
        flowPosition={quickSearch?.flowPosition ?? { x: 0, y: 0 }}
        blocks={BLOCKS}
        sourcePortContext={quickSearch?.sourcePortContext}
        onSelect={(type, position) => {
          const created = onDropBlock(type, position)
          const context = quickSearch?.sourcePortContext
          if (!created || !context) return
          const planned = connectionForCreatedNode(context, created)
          if (!planned || !planned.connection.source || !planned.connection.target) return
          onConnect({
            source: planned.connection.source,
            sourceHandle: planned.connection.sourceHandle ?? null,
            target: planned.connection.target,
            targetHandle: planned.connection.targetHandle ?? null,
          }, planned.kind)
        }}
        onClose={() => setQuickSearch(null)}
      />
    </section>
  )
}

function isCanvasChrome(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(
    '.react-flow__node, .react-flow__edge, .react-flow__minimap, .react-flow__controls',
  ))
}

function isEmptyCanvasTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    '.react-flow__pane, .react-flow__background',
  )) && !isCanvasChrome(target)
}

function pointerPosition(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ('clientX' in event) return { x: event.clientX, y: event.clientY }
  const touch = event.changedTouches[0]
  return touch ? { x: touch.clientX, y: touch.clientY } : null
}
