import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { flowToMacroFunction, macroFunctionToFlow } from '../graph-converters'
import {
  countFunctionReferences,
  createFunctionDefinition,
  duplicateFunctionDefinition,
  normalizeFunctionPorts,
  renameFunctionDefinition,
  synchronizeFlowFunctionCalls,
  synchronizeFunctionCalls,
  uniqueFunctionId,
} from '../function-model'
import { functionGraphId, type GraphFlow, type GraphId } from '../graph-store'
import type { BlueprintSelection } from '../MyBlueprintPanel'
import type { ConfirmDialogState, NameDialogState } from './useMacroDialogs'
import type { MacroDefinition, MacroFunctionPort } from '../types'

type MessageIntent = 'primary' | 'success' | 'warning' | 'danger'

export function useFunctionGraphs({
  definition,
  setDefinition,
  graphs,
  getGraph,
  replaceGraph,
  removeGraph,
  mapGraphs,
  activeFunctionId,
  graphNavigationStack,
  navigateToGraphPath,
  forgetGraphView,
  selectedBlueprint,
  setSelectedBlueprint,
  setNameDialog,
  setConfirmDialog,
  setMessage,
  setMessageIntent,
  markChanged,
}: {
  definition: MacroDefinition | null
  setDefinition: Dispatch<SetStateAction<MacroDefinition | null>>
  graphs: Record<string, GraphFlow>
  getGraph: (graphId: GraphId) => GraphFlow
  replaceGraph: (graphId: GraphId, graph: GraphFlow) => void
  removeGraph: (graphId: GraphId) => void
  mapGraphs: (update: (graph: GraphFlow, graphId: GraphId) => GraphFlow) => void
  activeFunctionId: string | null
  graphNavigationStack: string[]
  navigateToGraphPath: (path: string[]) => void
  forgetGraphView: (functionId: string) => void
  selectedBlueprint: BlueprintSelection | null
  setSelectedBlueprint: Dispatch<SetStateAction<BlueprintSelection | null>>
  setNameDialog: Dispatch<SetStateAction<NameDialogState | null>>
  setConfirmDialog: Dispatch<SetStateAction<ConfirmDialogState | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  setMessageIntent: Dispatch<SetStateAction<MessageIntent>>
  markChanged: () => void
}) {
  const createFunction = useCallback(() => {
    if (!definition) return
    const index = (definition.functions?.length ?? 0) + 1
    setNameDialog({ kind: 'function-create', initialValue: `Function ${index}` })
  }, [definition, setNameDialog])

  const createFunctionNamed = useCallback((requestedName: string) => {
    if (!definition) return
    const index = (definition.functions?.length ?? 0) + 1
    const id = uniqueFunctionId(`function-${index}`, definition.functions ?? [])
    const item = createFunctionDefinition(id, requestedName)
    setDefinition({ ...definition, functions: [...(definition.functions ?? []), item] })
    replaceGraph(functionGraphId(id), macroFunctionToFlow(item))
    navigateToGraphPath([...graphNavigationStack, id])
    setSelectedBlueprint({ kind: 'function', id })
    markChanged()
  }, [definition, graphNavigationStack, markChanged, navigateToGraphPath, replaceGraph, setDefinition, setSelectedBlueprint])

  const renameFunction = useCallback((functionId = activeFunctionId) => {
    if (!definition || !functionId) return
    const current = definition.functions?.find((item) => item.id === functionId)
    if (!current) return
    setNameDialog({ kind: 'function-rename', initialValue: current.name, functionId })
  }, [activeFunctionId, definition, setNameDialog])

  const deleteFunctionNow = useCallback((functionId: string) => {
    if (!definition) return
    const pathIndex = graphNavigationStack.indexOf(functionId)
    if (pathIndex >= 0) {
      navigateToGraphPath(pathIndex === graphNavigationStack.length - 1
        ? []
        : graphNavigationStack.slice(0, pathIndex))
    }
    setDefinition({
      ...definition,
      functions: (definition.functions ?? []).filter((item) => item.id !== functionId),
    })
    removeGraph(functionGraphId(functionId))
    forgetGraphView(functionId)
    if (selectedBlueprint?.kind === 'function' && selectedBlueprint.id === functionId) {
      setSelectedBlueprint(null)
    }
    markChanged()
  }, [definition, forgetGraphView, graphNavigationStack, markChanged, navigateToGraphPath, removeGraph, selectedBlueprint, setDefinition, setSelectedBlueprint])

  const deleteFunction = useCallback((
    functionId = activeFunctionId,
    onDeleted?: () => void,
  ) => {
    if (!definition || !functionId) return
    const references = countFunctionReferences(functionId, graphs)
    const current = definition.functions?.find((item) => item.id === functionId)
    setConfirmDialog({
      title: '함수 삭제',
      description: references > 0
        ? `${current?.name ?? '이 함수'}는 함수 호출 노드 ${references}개에서 사용 중입니다. 삭제하면 참조 노드도 더 이상 유효하지 않습니다.`
        : `${current?.name ?? '이 함수'}를 삭제하시겠습니까?`,
      confirmLabel: '삭제',
      danger: true,
      onConfirm: () => {
        deleteFunctionNow(functionId)
        onDeleted?.()
      },
    })
  }, [activeFunctionId, definition, deleteFunctionNow, graphs, setConfirmDialog])

  const duplicateFunction = useCallback((functionId: string) => {
    if (!definition) return
    const source = definition.functions?.find((item) => item.id === functionId)
    if (!source) return
    const sourceGraphId = functionGraphId(functionId)
    const liveFlow = getGraph(sourceGraphId)
    const liveSource = graphs[sourceGraphId]
      ? flowToMacroFunction(source, liveFlow.nodes, liveFlow.edges)
      : source
    const id = uniqueFunctionId(`${source.id}-copy`, definition.functions ?? [])
    const copy = duplicateFunctionDefinition(liveSource, id, `${source.name} 복사본`)
    setDefinition({ ...definition, functions: [...(definition.functions ?? []), copy] })
    replaceGraph(functionGraphId(copy.id), macroFunctionToFlow(copy))
    setSelectedBlueprint({ kind: 'function', id: copy.id })
    markChanged()
  }, [definition, getGraph, graphs, markChanged, replaceGraph, setDefinition, setSelectedBlueprint])

  const updateFunctionPorts = useCallback((functionId: string, kind: 'inputs' | 'outputs', ports: MacroFunctionPort[]) => {
    if (!definition) return
    const normalized = normalizeFunctionPorts(ports)
    if (!normalized) {
      setMessage('함수 포트 이름은 비어 있거나 중복될 수 없습니다.')
      setMessageIntent('warning')
      return
    }
    const functions = (definition.functions ?? []).map((item) => item.id === functionId
      ? { ...item, [kind]: normalized }
      : item)
    setDefinition(synchronizeFunctionCalls({ ...definition, functions }))
    mapGraphs((flow, graphId) => {
      const next = synchronizeFlowFunctionCalls(flow, functions)
      if (graphId !== functionGraphId(functionId)) return next
      const item = functions.find((candidate) => candidate.id === functionId)!
      return {
        ...next,
        nodes: next.nodes.map((node) => node.id === item.entry_node_id
          ? { ...node, data: { ...node.data, config: { ...node.data.config, inputs: item.inputs } } }
          : node.id === item.return_node_id
            ? { ...node, data: { ...node.data, config: { ...node.data.config, outputs: item.outputs } } }
            : node),
      }
    })
    markChanged()
  }, [definition, mapGraphs, markChanged, setDefinition, setMessage, setMessageIntent])

  const updateFunctionName = useCallback((functionId: string, name: string) => {
    if (!definition || !name) return
    const functions = (definition.functions ?? []).map((item) => item.id === functionId
      ? renameFunctionDefinition(item, name)
      : item)
    setDefinition(synchronizeFunctionCalls({ ...definition, functions }))
    mapGraphs((flow, graphId) => {
      const synchronized = synchronizeFlowFunctionCalls(flow, functions)
      if (graphId !== functionGraphId(functionId)) return synchronized
      const item = functions.find((candidate) => candidate.id === functionId)!
      return {
        ...synchronized,
        nodes: synchronized.nodes.map((node) => node.id === item.entry_node_id
          ? { ...node, data: { ...node.data, label: `${name} / 시작`, definitionLabel: `${name} / 시작` } }
          : node.id === item.return_node_id
            ? { ...node, data: { ...node.data, label: `${name} / 반환`, definitionLabel: `${name} / 반환` } }
            : node),
      }
    })
    markChanged()
  }, [definition, mapGraphs, markChanged, setDefinition])

  return {
    createFunction,
    createFunctionNamed,
    renameFunction,
    deleteFunction,
    duplicateFunction,
    updateFunctionPorts,
    updateFunctionName,
  }
}
