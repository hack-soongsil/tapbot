import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ReactFlowInstance, Viewport } from '@xyflow/react'
import {
  MAIN_GRAPH_ID,
  functionGraphId,
  functionIdFromGraphId,
  type GraphId,
} from '../graph-store'
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
  const [navigationPath, setNavigationPath] = useState<GraphId[]>([MAIN_GRAPH_ID])
  const [graphNavigationError, setGraphNavigationError] = useState<string | null>(null)
  const flowRef = useRef<ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null>(null)
  const graphViewStates = useRef<Record<string, GraphViewState>>({})
  const navigationEpoch = useRef(0)

  const commitNavigation = useCallback((nextPath: GraphId[], focusNode?: MacroFlowNode) => {
    const epoch = ++navigationEpoch.current
    setGraphNavigationError(null)
    const viewport = flowRef.current?.getViewport()
    if (viewport) graphViewStates.current[activeGraphId] = { viewport, selectedNodeId }

    const targetKey = nextPath.at(-1) ?? MAIN_GRAPH_ID
    const saved = graphViewStates.current[targetKey]
    setNavigationPath(nextPath)
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

  const openFunction = useCallback((functionId: string | undefined, allowPendingDefinition = false) => {
    if (!functionId || (!allowPendingDefinition && !definition?.functions?.some((item) => item.id === functionId))) {
      setGraphNavigationError(functionId
        ? `함수 ${functionId}를 찾을 수 없습니다. 삭제되었거나 참조가 올바르지 않습니다.`
        : '호출할 함수가 지정되지 않았습니다.')
      return
    }
    const targetGraphId = functionGraphId(functionId)
    const existingIndex = navigationPath.indexOf(targetGraphId)
    const nextPath = existingIndex >= 0
      ? navigationPath.slice(0, existingIndex + 1)
      : [...navigationPath, targetGraphId]
    commitNavigation(nextPath)
    if (!graphViewStates.current[targetGraphId]?.selectedNodeId) {
      setSelectedBlueprint({ kind: 'function', id: functionId })
    }
  }, [commitNavigation, definition, navigationPath, setSelectedBlueprint])

  const openPath = useCallback((functionIds: string[], focusNode?: MacroFlowNode) => {
    const missing = functionIds.find((id) => !definition?.functions?.some((item) => item.id === id))
    if (missing) {
      setGraphNavigationError(`함수 ${missing}를 찾을 수 없습니다. 삭제되었거나 참조가 올바르지 않습니다.`)
      return false
    }
    commitNavigation([MAIN_GRAPH_ID, ...functionIds.map(functionGraphId)], focusNode)
    return true
  }, [commitNavigation, definition])

  const openMain = useCallback((focusNode?: MacroFlowNode) => {
    commitNavigation([MAIN_GRAPH_ID], focusNode)
  }, [commitNavigation])

  const goBack = useCallback(() => {
    if (navigationPath.length > 1) commitNavigation(navigationPath.slice(0, -1))
  }, [commitNavigation, navigationPath])

  const goToBreadcrumb = useCallback((index: number) => {
    if (index < 0 || index >= navigationPath.length) return
    commitNavigation(navigationPath.slice(0, index + 1))
  }, [commitNavigation, navigationPath])

  const resetGraphNavigation = useCallback(() => {
    graphViewStates.current = {}
    setGraphNavigationError(null)
    setNavigationPath([MAIN_GRAPH_ID])
    setActiveGraphId(MAIN_GRAPH_ID)
  }, [setActiveGraphId])

  const forgetGraphView = useCallback((functionId: string) => {
    delete graphViewStates.current[functionGraphId(functionId)]
  }, [])

  useEffect(() => {
    if (panelTab !== 'canvas' || navigationPath.length <= 1) return
    const goToParentGraph = (event: KeyboardEvent) => {
      if (!event.altKey || event.key !== 'ArrowLeft' || dialogOpen) return
      const target = event.target
      if (target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      goBack()
    }
    window.addEventListener('keydown', goToParentGraph)
    return () => window.removeEventListener('keydown', goToParentGraph)
  }, [dialogOpen, goBack, navigationPath.length, panelTab])

  const graphNavigationStack = navigationPath
    .slice(1)
    .flatMap((graphId) => {
      const functionId = functionIdFromGraphId(graphId)
      return functionId ? [functionId] : []
    })
  const breadcrumbs = navigationPath.map((graphId) => {
    const functionId = functionIdFromGraphId(graphId)
    return {
      graphId,
      functionId,
      label: functionId
        ? definition?.functions?.find((item) => item.id === functionId)?.name ?? functionId
        : 'Main',
    }
  })

  return {
    graphNavigationStack,
    graphNavigationError,
    setGraphNavigationError,
    flowRef,
    breadcrumbs,
    openMain,
    openFunction,
    openPath,
    goBack,
    goToBreadcrumb,
    resetGraphNavigation,
    forgetGraphView,
  }
}
