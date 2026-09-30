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
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import '@xyflow/react/dist/style.css'
import { getTapbotOverlayRoot } from '../../components/overlay-root'
import { MACRO_BLOCK_MIME } from './BlockPalette'
import {
  MACRO_BLUEPRINT_MIME,
  type BlueprintDragItem,
} from './blueprint-dnd'
import { InlineEditingContext } from './inline-editing'
import { isEditableKeyboardTarget, isImeKeyboardEvent } from './keyboard-events'
import { QuickBlockSearch } from './QuickBlockSearch'
import { createSearchItems, type SearchItem } from './search-provider'
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
import { UtilityNode } from './nodes/UtilityNode'
import type {
  JsonValue,
  MacroFlowEdge,
  MacroFlowNode,
  MacroNodeType,
  MacroVariableDefinition,
} from './types'

const nodeTypes: NodeTypes = {
  event: EventNode,
  ui: UiNode,
  action: ActionNode,
  condition: ConditionNode,
  control: ControlNode,
  validation: ValidationNode,
  utility: UtilityNode,
}

export interface MacroCanvasProps {
  nodes: MacroFlowNode[]
  edges: MacroFlowEdge[]
  onNodesChange: (changes: NodeChange<MacroFlowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<MacroFlowEdge>[]) => void
  onConnect: (connection: Connection, kind?: 'exec' | 'data') => void
  onSelectNode: (nodeId: string | null) => void
  onOpenFunction?: (functionId: string | undefined) => void
  onDropBlock: (
    type: MacroNodeType,
    position: { x: number; y: number },
  ) => CreatedMacroNode | null | undefined
  onReady: (instance: ReactFlowInstance<MacroFlowNode, MacroFlowEdge>) => void
  onDropBlueprintItem?: (
    item: BlueprintDragItem,
    position: { x: number; y: number },
  ) => void
  onPromoteToVariable?: (
    port: PromoteVariablePort,
    position: { x: number; y: number },
  ) => void
  quickSearchItems?: readonly SearchItem[]
  variables?: readonly MacroVariableDefinition[]
  onUpdateNodeConfig?: (nodeId: string, config: Record<string, JsonValue>) => void
  dialogOpen?: boolean
}

export interface PromoteVariablePort {
  nodeId: string
  portId: string
  portType: Exclude<import('./types').PortType, 'exec' | 'any'>
  direction: 'input' | 'output'
}

export function MacroCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectNode,
  onOpenFunction,
  onDropBlock,
  onReady,
  onDropBlueprintItem,
  onPromoteToVariable,
  quickSearchItems,
  variables = [],
  onUpdateNodeConfig,
  dialogOpen = false,
}: MacroCanvasProps) {
  const canvasRef = useRef<HTMLElement>(null)
  const flowInstance = useRef<ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null>(null)
  const draggedPort = useRef<SourcePortContext | null>(null)
  const [editingControlActive, setEditingControlActive] = useState(false)
  const [quickSearch, setQuickSearch] = useState<{
    screenPosition: { x: number; y: number }
    flowPosition: { x: number; y: number }
    sourcePortContext: SourcePortContext | null
  } | null>(null)
  const [blueprintDrop, setBlueprintDrop] = useState<{
    item: Extract<BlueprintDragItem, { kind: 'variable' }>
    screenPosition: { x: number; y: number }
    flowPosition: { x: number; y: number }
  } | null>(null)
  const [promoteMenu, setPromoteMenu] = useState<{
    port: PromoteVariablePort
    screenPosition: { x: number; y: number }
    flowPosition: { x: number; y: number }
  } | null>(null)
  const searchItems = useMemo(
    () => quickSearchItems ?? createSearchItems(null, (type, position) => onDropBlock(type, position)),
    [onDropBlock, quickSearchItems],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    let animationFrame = 0
    const observer = new ResizeObserver(() => {
      const instance = flowInstance.current
      if (!instance) return
      const viewport = instance.getViewport()
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => {
        if (flowInstance.current === instance) {
          void instance.setViewport(viewport, { duration: 0 })
        }
      })
    })
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(animationFrame)
    }
  }, [])

  useEffect(() => {
    if (!dialogOpen) return
    draggedPort.current = null
    window.setTimeout(() => {
      setQuickSearch(null)
      setBlueprintDrop(null)
      setPromoteMenu(null)
    }, 0)
  }, [dialogOpen])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !onPromoteToVariable) return
    const openPromoteMenu = (event: Event) => {
      const detail = (event as CustomEvent<PromoteVariablePort & {
        clientX: number
        clientY: number
      }>).detail
      if (!detail?.nodeId || !flowInstance.current) return
      const screenPosition = { x: detail.clientX, y: detail.clientY }
      setQuickSearch(null)
      setBlueprintDrop(null)
      setPromoteMenu({
        port: {
          nodeId: detail.nodeId,
          portId: detail.portId,
          portType: detail.portType,
          direction: detail.direction,
        },
        screenPosition,
        flowPosition: flowInstance.current.screenToFlowPosition(screenPosition),
      })
    }
    canvas.addEventListener('tapbot:promote-variable', openPromoteMenu)
    return () => canvas.removeEventListener('tapbot:promote-variable', openPromoteMenu)
  }, [onPromoteToVariable])

  useEffect(() => {
    if (!blueprintDrop && !promoteMenu) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.macro-canvas-context-menu')) return
      setBlueprintDrop(null)
      setPromoteMenu(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (isImeKeyboardEvent(event) || isEditableKeyboardTarget(event.target)) return
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setBlueprintDrop(null)
      setPromoteMenu(null)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [blueprintDrop, promoteMenu])
  const allowDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const drop = (
    event: DragEvent<HTMLDivElement>,
    instance: ReactFlowInstance<MacroFlowNode, MacroFlowEdge>,
  ) => {
    event.preventDefault()
    const blueprintItem = parseBlueprintDragItem(
      event.dataTransfer.getData(MACRO_BLUEPRINT_MIME),
    )
    if (blueprintItem && onDropBlueprintItem) {
      const screenPosition = { x: event.clientX, y: event.clientY }
      const flowPosition = instance.screenToFlowPosition(screenPosition)
      if (blueprintItem.kind === 'variable' && !blueprintItem.mode) {
        setBlueprintDrop({ item: blueprintItem, screenPosition, flowPosition })
      } else {
        onDropBlueprintItem(blueprintItem, flowPosition)
      }
      return
    }
    const nodeType = event.dataTransfer.getData(MACRO_BLOCK_MIME) as MacroNodeType
    if (!nodeType) return
    onDropBlock(
      nodeType,
      instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    )
  }

  return (
    <section
      ref={canvasRef}
      className="macro-canvas"
      aria-label="Macro graph canvas"
      onFocusCapture={(event) => {
        if (isEditableKeyboardTarget(event.target)) setEditingControlActive(true)
      }}
      onBlurCapture={(event) => {
        if (!isEditableKeyboardTarget(event.relatedTarget)) setEditingControlActive(false)
      }}
    >
      <InlineEditingContext.Provider value={{ variables, updateNodeConfig: onUpdateNodeConfig }}>
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
        onNodeDoubleClick={(event, node) => {
          if (dialogOpen || node.data.nodeType !== 'call_function' || !onOpenFunction) return
          event.stopPropagation()
          const functionId = node.data.config.function_id
          onOpenFunction(typeof functionId === 'string' ? functionId : undefined)
        }}
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
        nodesDraggable
        nodesConnectable
        elementsSelectable
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        selectionOnDrag={false}
        fitView
        minZoom={0.25}
        maxZoom={1.8}
        deleteKeyCode={editingControlActive ? null : ['Backspace', 'Delete']}
        selectionKeyCode="Shift"
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <MiniMap pannable zoomable />
          <Controls showInteractive={false} />
        </ReactFlow>
      </InlineEditingContext.Provider>
      <QuickBlockSearch
        open={!dialogOpen && quickSearch !== null}
        screenPosition={quickSearch?.screenPosition ?? { x: 0, y: 0 }}
        flowPosition={quickSearch?.flowPosition ?? { x: 0, y: 0 }}
        items={searchItems}
        sourcePortContext={quickSearch?.sourcePortContext}
        onCreated={(created) => {
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
      {!dialogOpen && blueprintDrop && createPortal((
        <div
          className="macro-canvas-context-menu"
          role="menu"
          aria-label={`${blueprintDrop.item.id} 변수 노드 선택`}
          style={{ left: blueprintDrop.screenPosition.x, top: blueprintDrop.screenPosition.y }}
        >
          <strong>{blueprintDrop.item.id}</strong>
          <button type="button" role="menuitem" onClick={() => {
            onDropBlueprintItem?.({ ...blueprintDrop.item, mode: 'get' }, blueprintDrop.flowPosition)
            setBlueprintDrop(null)
          }}>Get</button>
          <button type="button" role="menuitem" onClick={() => {
            onDropBlueprintItem?.({ ...blueprintDrop.item, mode: 'set' }, blueprintDrop.flowPosition)
            setBlueprintDrop(null)
          }}>Set</button>
        </div>
      ), getTapbotOverlayRoot())}
      {!dialogOpen && promoteMenu && createPortal((
        <div
          className="macro-canvas-context-menu"
          role="menu"
          aria-label="데이터 핀 메뉴"
          style={{ left: promoteMenu.screenPosition.x, top: promoteMenu.screenPosition.y }}
        >
          <button type="button" role="menuitem" onClick={() => {
            onPromoteToVariable?.(promoteMenu.port, promoteMenu.flowPosition)
            setPromoteMenu(null)
          }}>변수로 승격</button>
        </div>
      ), getTapbotOverlayRoot())}
    </section>
  )
}

function parseBlueprintDragItem(value: string): BlueprintDragItem | null {
  if (!value) return null
  try {
    const item = JSON.parse(value) as Partial<BlueprintDragItem>
    if ((item.kind !== 'variable' && item.kind !== 'function') || typeof item.id !== 'string') {
      return null
    }
    if (item.kind === 'variable') {
      const mode = item.mode === 'get' || item.mode === 'set' ? item.mode : undefined
      return { kind: 'variable', id: item.id, ...(mode ? { mode } : {}) }
    }
    return { kind: 'function', id: item.id }
  } catch {
    return null
  }
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
