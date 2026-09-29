import type { Connection } from '@xyflow/react'
import { useRef, type Dispatch, type SetStateAction } from 'react'
import type { useMacroRuntime } from '../../macro-runtime/useMacroRuntime'
import { macroEditorApi } from '../api'
import type { BlueprintDragItem } from '../blueprint-dnd'
import { functionCallConfig } from '../function-model'
import type { GraphFlow } from '../graph-store'
import {
  clearDeviceDraft,
  synchronizeVariableNodes,
  variableNodeConfig,
} from '../macro-document-model'
import type { BlueprintSelection } from '../MyBlueprintPanel'
import type { PromoteVariablePort } from '../MacroCanvas'
import type {
  JsonValue,
  MacroDefinition,
  MacroFlowNode,
  MacroFunctionPort,
  MacroNodeType,
  MacroVariableDefinition,
} from '../types'
import type { useFunctionGraphs } from './useFunctionGraphs'
import type { useGraphEditor } from './useGraphEditor'
import type {
  ConfirmDialogState,
  NameDialogState,
  VariableDialogState,
} from './useMacroDialogs'
import type { useMacroDocument } from './useMacroDocument'
import type { useMacroValidation } from './useMacroValidation'

type MessageIntent = 'primary' | 'success' | 'warning' | 'danger'
type GraphCommands = ReturnType<typeof useGraphEditor>
type FunctionCommands = ReturnType<typeof useFunctionGraphs>
type DocumentCommands = ReturnType<typeof useMacroDocument>
type ValidationCommands = ReturnType<typeof useMacroValidation>
type RuntimeController = ReturnType<typeof useMacroRuntime>

export interface EditorCommandDependencies {
  deviceId: string
  definition: MacroDefinition | null
  setDefinition: Dispatch<SetStateAction<MacroDefinition | null>>
  definitions: MacroDefinition[]
  graphs: Record<string, GraphFlow>
  graph: Pick<GraphCommands,
    'addNode' | 'addConnection' | 'updateNode' | 'deleteNode' | 'deleteSelected'
    | 'changeNodes' | 'changeEdges' | 'mapGraphs'>
  functions: FunctionCommands
  document: Pick<DocumentCommands,
    'definitionForSave' | 'save' | 'selectMacroNow' | 'createNewNamed'
    | 'renameMacroNamed' | 'duplicateMacro' | 'deleteMacroNow' | 'loadDefinition'>
  validation: Pick<ValidationCommands, 'validateDefinition'>
  runtime: RuntimeController
  dirty: boolean
  isNew: boolean
  selectedVariableName: string
  selectedBlueprint: BlueprintSelection | null
  selectedNodeId: string | null
  variableDialog: VariableDialogState | null
  nameDialog: NameDialogState | null
  boundMacroId: string | null
  setBoundMacroId: Dispatch<SetStateAction<string | null>>
  setSelectedVariableName: Dispatch<SetStateAction<string>>
  setSelectedBlueprint: Dispatch<SetStateAction<BlueprintSelection | null>>
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
  setSelectedScreenId: Dispatch<SetStateAction<string>>
  setPanelTab: Dispatch<SetStateAction<'canvas' | 'execution'>>
  setRuntimeDetailOpen: Dispatch<SetStateAction<boolean>>
  setCanvasExpansion: (expanded: boolean) => void
  setVariableDialog: Dispatch<SetStateAction<VariableDialogState | null>>
  setNameDialog: Dispatch<SetStateAction<NameDialogState | null>>
  setConfirmDialog: Dispatch<SetStateAction<ConfirmDialogState | null>>
  setRunSetupMacro: Dispatch<SetStateAction<MacroDefinition | null>>
  setBusy: Dispatch<SetStateAction<boolean>>
  setMessage: Dispatch<SetStateAction<string | null>>
  setMessageIntent: Dispatch<SetStateAction<MessageIntent>>
  openMain: (focusNode?: MacroFlowNode) => void
  openFunction: (functionId: string | undefined) => void
  openPath: (path: string[], focusNode?: MacroFlowNode) => boolean
  goBack: () => void
  goToBreadcrumb: (index: number) => void
  guardUnsavedChanges: (hasUnsavedChanges: boolean, action: () => void | Promise<void>) => void
  markChanged: () => void
  selectedScreenId: string
  onCommandCommitted?: (record: EditorCommandRecord) => void
}

export interface EditorCommandRecord {
  sequence: number
  name: string
  committedAt: number
}

/**
 * The UI-facing transaction boundary for the macro editor. Keeping all mutations
 * here makes command recording/history possible without changing child views.
 */
export function useEditorCommands(deps: EditorCommandDependencies) {
  const commandSequence = useRef(0)
  const {
    definition,
    graph,
    functions,
    document,
    validation,
  } = deps

  const completeMutation = (name: string) => {
    deps.markChanged()
    deps.onCommandCommitted?.({
      sequence: ++commandSequence.current,
      name,
      committedAt: Date.now(),
    })
  }

  const commitMutation = <T,>(name: string, mutation: () => T): T => {
    const result = mutation()
    completeMutation(name)
    return result
  }

  const createNode = (
    type: MacroNodeType,
    position?: { x: number; y: number },
    preset?: Record<string, JsonValue>,
    label?: string,
  ) => {
    const created = graph.addNode(type, position, preset, label)
    if (created) completeMutation('create-node')
    return created
  }

  const deleteNode = (nodeId: string) => commitMutation('delete-node', () => graph.deleteNode(nodeId))
  const deleteSelectedNode = () => {
    if (!deps.selectedNodeId) return
    deleteNode(deps.selectedNodeId)
  }
  const connectPorts = (connection: Connection, kind: 'exec' | 'data' = 'exec') =>
    commitMutation('connect-ports', () => graph.addConnection(connection, kind))
  const updateNode = (nodeId: string, transform: (node: MacroFlowNode) => MacroFlowNode) =>
    commitMutation('update-node', () => graph.updateNode(nodeId, transform))
  const updateNodeConfig = (nodeId: string, config: Record<string, JsonValue>) =>
    updateNode(nodeId, (node) => ({ ...node, data: { ...node.data, config } }))
  const updateNodeLabel = (nodeId: string, label: string) =>
    updateNode(nodeId, (node) => ({
      ...node, data: { ...node.data, label, definitionLabel: label },
    }))
  const changeNodes = (changes: Parameters<typeof graph.changeNodes>[0]) => {
    graph.changeNodes(changes)
    if (changes.some((change) => change.type !== 'select' && change.type !== 'dimensions')) {
      completeMutation('change-nodes')
    }
  }
  const changeEdges = (changes: Parameters<typeof graph.changeEdges>[0]) => {
    graph.changeEdges(changes)
    if (changes.some((change) => change.type !== 'select')) completeMutation('change-edges')
  }

  const selectScreen = (screenId: string) => {
    deps.setSelectedScreenId(screenId)
    deps.setSelectedNodeId(null)
  }
  const selectNode = (nodeId: string | null) => {
    deps.setSelectedNodeId(nodeId)
    if (nodeId) deps.setSelectedBlueprint(null)
  }
  const selectBlueprint = (selection: BlueprintSelection) => {
    deps.setSelectedBlueprint(selection)
    deps.setSelectedNodeId(null)
    if (selection.kind === 'variable') deps.setSelectedVariableName(selection.id)
  }

  const createNodeFromBlueprint = (
    item: BlueprintDragItem,
    position?: { x: number; y: number },
  ) => {
    if (!definition) return null
    if (item.kind === 'function') {
      const target = definition.functions?.find((candidate) => candidate.id === item.id)
      return target
        ? createNode('call_function', position, functionCallConfig(target), target.name)
        : null
    }
    const variable = definition.variables?.find((candidate) => candidate.name === item.id)
    if (!variable || !item.mode) return null
    return createVariableNode(variable.name, item.mode, position)
  }

  const createVariableNode = (
    variableName: string,
    mode: 'get' | 'set',
    position?: { x: number; y: number },
  ) => {
    const variable = definition?.variables?.find((item) => item.name === variableName)
    if (!variable) return null
    const type = mode === 'get' ? 'get_variable' : 'set_variable'
    return createNode(
      type,
      position,
      variableNodeConfig(type, variable),
      variableNodeLabel(mode, variable.name),
    )
  }

  const requestCreateVariable = () => {
    if (definition) deps.setVariableDialog({ mode: 'create' })
  }
  const requestEditVariable = (variableName = deps.selectedVariableName) => {
    const variable = definition?.variables?.find((item) => item.name === variableName)
    if (variable) deps.setVariableDialog({ mode: 'edit', variable })
  }
  const requestPromoteVariable = (port: PromoteVariablePort, position: { x: number; y: number }) => {
    if (!definition) return
    deps.setVariableDialog({
      mode: 'promote',
      suggestedName: uniqueVariableName(port.portId || 'value', definition.variables ?? []),
      suggestedType: port.portType,
      port,
      position,
    })
  }

  const renameVariable = (oldName: string, replacement: MacroVariableDefinition) => {
    if (!definition) return
    const variables = (definition.variables ?? []).map((item) => item.name === oldName
      ? replacement
      : item)
    const synchronizeFlow = (flow: GraphFlow): GraphFlow => ({
      ...flow,
      nodes: flow.nodes.map((node) => {
        if (node.data.nodeType !== 'set_variable' && node.data.nodeType !== 'get_variable') return node
        if (node.data.config.name !== oldName) return node
        return {
          ...node,
          data: { ...node.data, config: variableNodeConfig(node.data.nodeType, replacement) },
        }
      }),
    })
    commitMutation('rename-variable', () => {
      deps.setDefinition(synchronizeVariableNodes({ ...definition, variables }))
      graph.mapGraphs(synchronizeFlow)
    })
  }

  const createVariable = (variable: MacroVariableDefinition) => {
    if (!definition) return
    commitMutation('create-variable', () => deps.setDefinition(synchronizeVariableNodes({
      ...definition,
      variables: [...(definition.variables ?? []), variable],
    })))
  }

  const removeVariable = (variableName: string) => {
    if (!definition) return
    commitMutation('delete-variable', () => {
      deps.setDefinition({
        ...definition,
        variables: (definition.variables ?? []).filter((item) => item.name !== variableName),
      })
      if (deps.selectedVariableName === variableName) deps.setSelectedVariableName('')
      if (deps.selectedBlueprint?.kind === 'variable' && deps.selectedBlueprint.id === variableName) {
        deps.setSelectedBlueprint(null)
      }
    })
  }

  const requestDeleteVariable = (variableName = deps.selectedVariableName) => {
    if (!definition || !variableName) return
    const references = countVariableReferences(variableName, deps.graphs)
    deps.setConfirmDialog({
      title: '변수 삭제',
      description: references > 0
        ? `변수 ${variableName}는 변수 설정/가져오기 노드 ${references}개에서 사용 중입니다. 삭제하면 참조 노드도 더 이상 유효하지 않습니다.`
        : `변수 ${variableName}를 삭제하시겠습니까?`,
      confirmLabel: '삭제',
      danger: true,
      onConfirm: () => removeVariable(variableName),
    })
  }

  const toggleVariableInput = (variableName = deps.selectedVariableName) => {
    if (!definition || !variableName) return
    commitMutation('toggle-variable-input', () => deps.setDefinition({
      ...definition,
      variables: (definition.variables ?? []).map((item) => item.name === variableName
        ? { ...item, input: item.input !== true }
        : item),
    }))
  }

  const submitVariable = (variable: MacroVariableDefinition) => {
    const dialog = deps.variableDialog
    if (!definition || !dialog) return
    if (dialog.mode === 'edit') renameVariable(dialog.variable.name, variable)
    else createVariable(variable)
    deps.setSelectedVariableName(variable.name)
    deps.setSelectedBlueprint({ kind: 'variable', id: variable.name })

    if (dialog.mode === 'promote') {
      const mode = dialog.port.direction === 'input' ? 'get' : 'set'
      const nodeType = mode === 'get' ? 'get_variable' : 'set_variable'
      const created = createNode(
        nodeType,
        dialog.position,
        variableNodeConfig(nodeType, variable),
        variableNodeLabel(mode, variable.name),
      )
      if (created) {
        connectPorts(dialog.port.direction === 'input' ? {
          source: created.id,
          sourceHandle: 'value',
          target: dialog.port.nodeId,
          targetHandle: dialog.port.portId,
        } : {
          source: dialog.port.nodeId,
          sourceHandle: dialog.port.portId,
          target: created.id,
          targetHandle: 'value',
        }, 'data')
      }
    }
    deps.setVariableDialog(null)
  }

  const createFunction = (name: string) => commitMutation('create-function', () => functions.createFunctionNamed(name))
  const renameFunction = (functionId: string, name: string) =>
    commitMutation('rename-function', () => functions.updateFunctionName(functionId, name))
  const updateFunctionPorts = (functionId: string, kind: 'inputs' | 'outputs', ports: MacroFunctionPort[]) =>
    commitMutation('update-function-ports', () => functions.updateFunctionPorts(functionId, kind, ports))
  const duplicateFunction = (functionId: string) =>
    commitMutation('duplicate-function', () => functions.duplicateFunction(functionId))
  const requestDeleteFunction = (functionId?: string) =>
    functions.deleteFunction(functionId, () => completeMutation('delete-function'))

  const submitName = async (name: string) => {
    const dialog = deps.nameDialog
    if (!dialog) return
    if (dialog.kind === 'macro-create') await document.createNewNamed(name)
    else if (dialog.kind === 'macro-rename') await document.renameMacroNamed(dialog.macro, name)
    else if (dialog.kind === 'function-create') createFunction(name)
    else renameFunction(dialog.functionId, name)
    deps.setNameDialog(null)
  }

  const requestCreateMacro = () => discardOrRun(() => {
    deps.setNameDialog({ kind: 'macro-create', initialValue: '새 매크로' })
  })
  const requestRenameMacro = (macro: MacroDefinition) => {
    deps.setNameDialog({ kind: 'macro-rename', initialValue: macro.name, macro })
  }
  const requestDeleteMacro = (macro: MacroDefinition) => {
    const state = deps.runtime.runtime?.state ?? 'idle'
    if (deps.runtime.runtime?.macro_definition_id === macro.id && (state === 'running' || state === 'paused')) {
      deps.setMessage('실행 중인 매크로는 삭제할 수 없습니다. 먼저 중지하세요.')
      deps.setMessageIntent('warning')
      return
    }
    deps.setConfirmDialog({
      title: '매크로 삭제',
      description: `${macro.name} 매크로를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
      confirmLabel: '삭제',
      danger: true,
      onConfirm: () => document.deleteMacroNow(macro, deps.boundMacroId),
    })
  }

  const discardOrRun = (action: () => void | Promise<void>) =>
    deps.guardUnsavedChanges(deps.dirty || deps.isNew, action)

  const saveMacro = () => document.save()
  const validateMacro = (showSuccess = true) => document.definitionForSave
    ? validation.validateDefinition(document.definitionForSave, showSuccess)
    : Promise.resolve(false)

  const executeRuntime = async (
    name: 'start' | 'pause' | 'resume' | 'step' | 'stop' | 'reset',
    inputVariables?: Record<string, JsonValue>,
  ): Promise<boolean> => {
    if ((name === 'start' || name === 'step') && !definition) return false
    deps.setBusy(true)
    deps.setMessage(null)
    try {
      if ((name === 'start' || name === 'step') && (deps.dirty || deps.isNew) && !(await saveMacro())) return false
      if ((name === 'start' || name === 'step') && !(await validateMacro(false))) return false
      if (name === 'start' || name === 'step') {
        if (!document.definitionForSave) return false
        await macroEditorApi.bind(deps.deviceId, document.definitionForSave.id)
        deps.setBoundMacroId(document.definitionForSave.id)
      }
      await macroEditorApi.command(
        deps.deviceId,
        name,
        name === 'start' ? { variables: inputVariables ?? {} } : undefined,
      )
      await deps.runtime.refresh()
      return true
    } catch (error) {
      showError(error, '매크로 명령을 실행하지 못했습니다.', deps.setMessage, deps.setMessageIntent)
      return false
    } finally {
      deps.setBusy(false)
    }
  }

  const runMacroNow = async (macro: MacroDefinition, inputVariables: Record<string, JsonValue>) => {
    if (!(await validation.validateDefinition(macro, false))) return false
    deps.setBusy(true)
    deps.setMessage(null)
    try {
      await macroEditorApi.bind(deps.deviceId, macro.id)
      deps.setBoundMacroId(macro.id)
      clearDeviceDraft(deps.deviceId)
      document.loadDefinition(macro)
      await macroEditorApi.command(deps.deviceId, 'start', { variables: inputVariables })
      await deps.runtime.refresh()
      return true
    } catch (error) {
      showError(error, '매크로를 실행하지 못했습니다.', deps.setMessage, deps.setMessageIntent)
      return false
    } finally {
      deps.setBusy(false)
    }
  }

  const runMacro = async (macro: MacroDefinition, inputVariables: Record<string, JsonValue>) => {
    const state = deps.runtime.runtime?.state ?? 'idle'
    if (state === 'running' || state === 'paused') return false
    if (macro.id === definition?.id && (deps.dirty || deps.isNew)) {
      return executeRuntime('start', inputVariables)
    }
    if (deps.dirty || deps.isNew) {
      deps.setConfirmDialog({
        title: '변경사항 버리기',
        description: '저장하지 않은 매크로 변경 사항을 버리고 다른 매크로를 실행할까요?',
        confirmLabel: '버리고 실행',
        danger: true,
        onConfirm: async () => {
          const started = await runMacroNow(macro, inputVariables)
          if (started) deps.setRunSetupMacro(null)
        },
      })
      return false
    }
    return runMacroNow(macro, inputVariables)
  }

  const editMacro = (macro: MacroDefinition) => discardOrRun(async () => {
    deps.setCanvasExpansion(false)
    await document.selectMacroNow(macro.id)
    deps.setPanelTab('canvas')
  })

  return {
    createNode,
    deleteNode,
    deleteSelectedNode,
    connectPorts,
    changeNodes,
    changeEdges,
    updateNode,
    updateNodeConfig,
    updateNodeLabel,
    selectScreen,
    selectNode,
    selectBlueprint,
    createNodeFromBlueprint,
    createVariableNode,
    requestCreateVariable,
    requestEditVariable,
    requestPromoteVariable,
    createVariable,
    renameVariable,
    requestDeleteVariable,
    toggleVariableInput,
    submitVariable,
    requestCreateFunction: functions.createFunction,
    createFunction,
    requestRenameFunction: functions.renameFunction,
    renameFunction,
    duplicateFunction,
    requestDeleteFunction,
    updateFunctionPorts,
    openMain: deps.openMain,
    openFunction: deps.openFunction,
    openPath: deps.openPath,
    goBack: deps.goBack,
    goToBreadcrumb: deps.goToBreadcrumb,
    submitName,
    requestCreateMacro,
    requestRenameMacro,
    requestDeleteMacro,
    duplicateMacro: document.duplicateMacro,
    saveMacro,
    validateMacro,
    executeRuntime,
    runMacro,
    editMacro,
    discardOrRun,
    selectMacro: document.selectMacroNow,
  }
}

function variableNodeLabel(mode: 'get' | 'set', name: string) {
  return mode === 'get' ? name : `${name} 설정`
}

function uniqueVariableName(prefix: string, variables: readonly MacroVariableDefinition[]) {
  const base = prefix.replace(/[^a-zA-Z0-9_가-힣]/g, '_') || 'value'
  const used = new Set(variables.map((item) => item.name))
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}_${index}`)) index += 1
  return `${base}_${index}`
}

function countVariableReferences(name: string, graphs: Record<string, GraphFlow>) {
  return Object.values(graphs)
    .flatMap((flow) => flow.nodes)
    .filter((node) => (
      (node.data.nodeType === 'set_variable' || node.data.nodeType === 'get_variable')
      && node.data.config.name === name
    )).length
}

function showError(
  error: unknown,
  fallback: string,
  setMessage: Dispatch<SetStateAction<string | null>>,
  setMessageIntent: Dispatch<SetStateAction<MessageIntent>>,
) {
  setMessage(error instanceof Error ? error.message : fallback)
  setMessageIntent('danger')
}
