import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ReactFlowInstance, Viewport } from '@xyflow/react'
import { MAIN_GRAPH_ID, graphIdFromFunctionId, type GraphId } from '../graph-store'
import type { BlueprintSelection } from '../MyBlueprintPanel'
import type { MacroDefinition, MacroFlowEdge, MacroFlowNode } from '../types'

interface GraphViewState {
  viewport: Viewport
  selectedNodeId: string | null
}

export function useGraphNavigation({
  definition,
  activeGraphId,
  setActiveGraphId,
  selectedNodeId,
  setSelectedNodeId,
  setSelectedBlueprint,
  panelTab,
  dialogOpen,
}: {
  definition: MacroDefinition | null
  activeGraphId: GraphId
  setActiveGraphId: (graphId: GraphId) => void
  selectedNodeId: string | null
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
  setSelectedBlueprint: Dispatch<SetStateAction<BlueprintSelection | null>>
  panelTab: 'canvas' | 'execution'
  dialogOpen: boolean
}) {
  const [graphNavigationStack, setGraphNavigationStack] = useState<string[]>([])
  const [graphNavigationError, setGraphNavigationError] = useState<string | null>(null)
  const flowRef = useRef<ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null>(null)
  const graphViewStates = useRef<Record<string, GraphViewState>>({})
  const navigationEpoch = useRef(0)

  const navigateToGraphPath = useCallback((nextPath: string[], focusNode?: MacroFlowNode) => {
    const epoch = ++navigationEpoch.current
    setGraphNavigationError(null)
    const viewport = flowRef.current?.getViewport()
    if (viewport) graphViewStates.current[activeGraphId] = { viewport, selectedNodeId }

    const targetFunctionId = nextPath.at(-1) ?? null
    const targetKey = graphIdFromFunctionId(targetFunctionId)
    const saved = graphViewStates.current[targetKey]
    setGraphNavigationStack(nextPath)
    setActiveGraphId(targetKey)
    setSelectedBlueprint(null)
    setSelectedNodeId(focusNode?.id ?? saved?.selectedNodeId ?? null)

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (epoch !== navigationEpoch.current) return
        if (focusNode) {
          const measured = flowRef.current?.getNode?.(focusNode.id)
          void flowRef.current?.setCenter(
            focusNode.position.x + (measured?.measured?.width ?? 220) / 2,
            focusNode.position.y + (measured?.measured?.height ?? 100) / 2,
            { zoom: viewport?.zoom ?? 1, duration: 200 },
          )
        } else if (saved) void flowRef.current?.setViewport(saved.viewport, { duration: 0 })
        else void flowRef.current?.fitView({ duration: 0, padding: 0.2 })
      })
    })
  }, [activeGraphId, selectedNodeId, setActiveGraphId, setSelectedBlueprint, setSelectedNodeId])

  const enterFunctionGraph = useCallback((functionId: string | undefined) => {
    if (!functionId || !definition?.functions?.some((item) => item.id === functionId)) {
      setGraphNavigationError(functionId
        ? `함수 ${functionId}를 찾을 수 없습니다. 삭제되었거나 참조가 올바르지 않습니다.`
        : '호출할 함수가 지정되지 않았습니다.')
      return
    }
    const existingIndex = graphNavigationStack.indexOf(functionId)
    const nextPath = existingIndex >= 0
      ? graphNavigationStack.slice(0, existingIndex + 1)
      : [...graphNavigationStack, functionId]
    navigateToGraphPath(nextPath)
    if (!graphViewStates.current[graphIdFromFunctionId(functionId)]?.selectedNodeId) {
      setSelectedBlueprint({ kind: 'function', id: functionId })
    }
  }, [definition, graphNavigationStack, navigateToGraphPath, setSelectedBlueprint])

  const resetGraphNavigation = useCallback(() => {
    graphViewStates.current = {}
    setGraphNavigationError(null)
    setGraphNavigationStack([])
    setActiveGraphId(MAIN_GRAPH_ID)
  }, [setActiveGraphId])

  const forgetGraphView = useCallback((functionId: string) => {
    delete graphViewStates.current[graphIdFromFunctionId(functionId)]
  }, [])

  useEffect(() => {
    if (panelTab !== 'canvas' || graphNavigationStack.length === 0) return
    const goToParentGraph = (event: KeyboardEvent) => {
      if (!event.altKey || event.key !== 'ArrowLeft' || dialogOpen) return
      const target = event.target
      if (target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      navigateToGraphPath(graphNavigationStack.slice(0, -1))
    }
    window.addEventListener('keydown', goToParentGraph)
    return () => window.removeEventListener('keydown', goToParentGraph)
  }, [dialogOpen, graphNavigationStack, navigateToGraphPath, panelTab])

  return {
    graphNavigationStack,
    graphNavigationError,
    setGraphNavigationError,
    flowRef,
    navigateToGraphPath,
    enterFunctionGraph,
    resetGraphNavigation,
    forgetGraphView,
  }
}
