import { Button, ButtonGroup, Callout, Tag } from '@blueprintjs/core'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { useMacroRuntime } from '../macro-runtime/useMacroRuntime'
import { macroEditorApi } from './api'
import { BlockPalette } from './BlockPalette'
import { BLOCK_BY_TYPE, cloneDefaultConfig } from './blocks'
import {
  createEmptyMacroDefinition,
  MACRO_DRAFT_STORAGE_KEY,
} from './definition-factory'
import {
  flowToMacroFunction,
  flowToMacroDefinition,
  macroFunctionToFlow,
  macroDefinitionToFlow,
  migrateLegacyEntry,
} from './graph-converters'
import { MacroCanvas } from './MacroCanvas'
import { NodeInspector } from './NodeInspector'
import { SCREEN_OPTIONS } from './screen-elements'
import type {
  JsonValue,
  MacroDefinition,
  MacroFlowEdge,
  MacroFlowNode,
  MacroFunctionDefinition,
  MacroFunctionPort,
  MacroVariableDefinition,
  MacroNodeType,
  ValidationIssue,
} from './types'
import {
  mapBackendValidationErrors,
  validateMacroDefinition,
} from './validation'
import './macro-editor.css'
import { ko, runtimeStateLabels } from '../../i18n/ko'

export interface IntegratedMacroPanelHandle {
  addFindElement(selector: Record<string, JsonValue>, label: string): boolean
}

interface IntegratedMacroPanelProps {
  deviceId: string
  runtime: ReturnType<typeof useMacroRuntime>
  onAvailabilityChange?: (available: boolean) => void
}

const DEFAULT_SCREEN_ID = SCREEN_OPTIONS[0].id
const DEVICE_DRAFT_STORAGE_PREFIX = 'tapbot.macro.deviceDraft.'

interface DeviceMacroDraft {
  definition: MacroDefinition
  isNew: boolean
}

function deviceDraftStorageKey(deviceId: string): string {
  return `${DEVICE_DRAFT_STORAGE_PREFIX}${deviceId}`
}

function readDeviceDraft(deviceId: string): DeviceMacroDraft | null {
  try {
    const raw = window.sessionStorage.getItem(deviceDraftStorageKey(deviceId))
    if (!raw) return null
    const candidate = JSON.parse(raw) as Partial<DeviceMacroDraft>
    if (
      !candidate.definition ||
      typeof candidate.definition.id !== 'string' ||
      !Array.isArray(candidate.definition.nodes) ||
      !Array.isArray(candidate.definition.edges)
    ) return null
    return {
      definition: candidate.definition,
      isNew: candidate.isNew === true,
    }
  } catch {
    return null
  }
}

function clearDeviceDraft(deviceId: string): void {
  window.sessionStorage.removeItem(deviceDraftStorageKey(deviceId))
}

export const IntegratedMacroPanel = forwardRef<
  IntegratedMacroPanelHandle,
  IntegratedMacroPanelProps
>(function IntegratedMacroPanel({ deviceId, runtime, onAvailabilityChange }, ref) {
  const [definitions, setDefinitions] = useState<MacroDefinition[]>([])
  const [definition, setDefinition] = useState<MacroDefinition | null>(null)
  const [nodes, setNodes] = useState<MacroFlowNode[]>([])
  const [edges, setEdges] = useState<MacroFlowEdge[]>([])
  const [nodeScreens, setNodeScreens] = useState<Record<string, string>>({})
  const [functionFlows, setFunctionFlows] = useState<Record<string, { nodes: MacroFlowNode[]; edges: MacroFlowEdge[] }>>({})
  const [activeFunctionId, setActiveFunctionId] = useState<string | null>(null)
  const [selectedVariableName, setSelectedVariableName] = useState('')
  const [selectedScreenId, setSelectedScreenId] = useState<string>(DEFAULT_SCREEN_ID)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [dirty, setDirty] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageIntent, setMessageIntent] = useState<'primary' | 'success' | 'warning' | 'danger'>('primary')
  const [panelTab, setPanelTab] = useState<'canvas' | 'execution'>('canvas')
  const flowRef = useRef<ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onAvailabilityChange?.(Boolean(definition))
  }, [definition, onAvailabilityChange])

  const loadDefinition = useCallback((source: MacroDefinition, newDefinition = false) => {
    const next = synchronizeVariableNodes(migrateLegacyEntry(source))
    const flow = macroDefinitionToFlow(next)
    setDefinition(next)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    setFunctionFlows(Object.fromEntries((next.functions ?? []).map((item) => [
      item.id,
      macroFunctionToFlow(item),
    ])))
    setActiveFunctionId(null)
    setSelectedVariableName(next.variables?.[0]?.name ?? '')
    setNodeScreens(deriveNodeScreens(next, flow.nodes, flow.edges))
    setSelectedNodeId(null)
    setIssues([])
    setDirty(false)
    setIsNew(newDefinition)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([macroEditorApi.list(), macroEditorApi.binding(deviceId)])
      .then(async ([listed, binding]) => {
        if (!active) return
        setDefinitions(listed.macros)
        const draft = readDeviceDraft(deviceId)
        const draftMatchesBinding = draft && (
          (draft.isNew && !binding.binding) ||
          draft.definition.id === binding.binding?.macro_definition_id
        )
        if (draft && draftMatchesBinding) {
          loadDefinition(draft.definition, draft.isNew)
          setDirty(true)
          return
        }
        if (!binding.binding) {
          setDefinition(null)
          setNodes([])
          setEdges([])
          setNodeScreens({})
          setFunctionFlows({})
          setActiveFunctionId(null)
          return
        }
        const next = await macroEditorApi.get(binding.binding.macro_definition_id)
        if (active) loadDefinition(next)
      })
      .catch((error: unknown) => {
        if (active) showError(error, '매크로를 불러오지 못했습니다.', setMessage, setMessageIntent)
      })
    return () => { active = false }
  }, [deviceId, loadDefinition])

  const definitionForSave = useMemo(() => {
    if (!definition) return null
    const functions = (definition.functions ?? []).map((item) => {
      const flow = functionFlows[item.id]
      return flow ? flowToMacroFunction(item, flow.nodes, flow.edges) : item
    })
    return synchronizeVariableNodes(synchronizeFunctionCalls(flowToMacroDefinition({
      ...definition,
      functions,
      metadata: {
        ...definition.metadata,
        editor_screen_node_ids: serializeNodeScreens(nodeScreens, nodes),
      },
    }, nodes, edges)))
  }, [definition, edges, functionFlows, nodeScreens, nodes])

  useEffect(() => {
    if (!definitionForSave || (!dirty && !isNew)) return
    const draft: DeviceMacroDraft = { definition: definitionForSave, isNew }
    window.sessionStorage.setItem(deviceDraftStorageKey(deviceId), JSON.stringify(draft))
  }, [definitionForSave, deviceId, dirty, isNew])

  const visibleNodeIds = useMemo(() => new Set(
    nodes
      .filter((node) => node.data.eventScreenId === selectedScreenId || (
        !node.data.isEvent && nodeScreens[node.id] === selectedScreenId
      ))
      .map((node) => node.id),
  ), [nodeScreens, nodes, selectedScreenId])

  const shownNodes = useMemo(() => (activeFunctionId
    ? functionFlows[activeFunctionId]?.nodes ?? []
    : nodes.filter((node) => visibleNodeIds.has(node.id)))
    .map((node) => ({
      ...node,
      data: {
        ...node.data,
        errors: issues.filter((item) => item.nodeId === node.id).map((item) => item.message),
        runtimeState: runtime.nodeState[node.id] ?? 'pending',
      },
    })), [activeFunctionId, functionFlows, issues, nodes, runtime.nodeState, visibleNodeIds])

  const shownEdges = useMemo(() => (activeFunctionId
    ? functionFlows[activeFunctionId]?.edges ?? []
    : edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)))
    .map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        errors: issues.filter((item) => item.edgeId === edge.id).map((item) => item.message),
      },
      className: [
        edge.data?.kind === 'data' ? 'macro-edge--data' : '',
        edge.id === runtime.currentEdgeId ? 'runtime-current-edge' : '',
      ].filter(Boolean).join(' ') || undefined,
      animated: edge.id === runtime.currentEdgeId,
    })), [activeFunctionId, edges, functionFlows, issues, runtime.currentEdgeId, visibleNodeIds])

  const selectedNode = shownNodes.find((node) => node.id === selectedNodeId) ?? null

  const markChanged = () => {
    setDirty(true)
    setMessage(null)
  }

  const addNode = useCallback((
    type: MacroNodeType,
    position?: { x: number; y: number },
    configOverride?: Record<string, JsonValue>,
    labelOverride?: string,
  ) => {
    if (!definition) return null
    const block = BLOCK_BY_TYPE.get(type)
    if (!block || block.category === 'event') return null
    const currentNodes = activeFunctionId
      ? functionFlows[activeFunctionId]?.nodes
      : nodes
    if (!currentNodes) return null
    const assignScreen = !activeFunctionId
    const screenCount = assignScreen
      ? currentNodes.filter((node) => nodeScreens[node.id] === selectedScreenId).length
      : currentNodes.length
    const id = uniqueNodeId(type, currentNodes)
    const configured = configOverride ?? configForNewNode(
      type,
      definition.functions ?? [],
      definition.variables ?? [],
    )
    const createdNode: MacroFlowNode = {
      id,
      type: block.category,
      position: position ?? {
        x: 120 + (screenCount % 3) * 220,
        y: 180 + Math.floor(screenCount / 3) * 150,
      },
      data: {
        nodeType: type,
        category: block.category,
        label: labelOverride ?? block.label,
        definitionLabel: labelOverride,
        config: configured,
        isEntry: false,
        errors: [],
      },
    }
    if (assignScreen) setNodeScreens((screens) => ({ ...screens, [id]: selectedScreenId }))
    setSelectedNodeId(id)
    if (activeFunctionId) {
      setFunctionFlows((current) => {
        const flow = current[activeFunctionId]
        if (!flow) return current
        return { ...current, [activeFunctionId]: { ...flow, nodes: [...flow.nodes, createdNode] } }
      })
    } else {
      setNodes((current) => [...current, createdNode])
    }
    markChanged()
    return { id, type, config: configured }
  }, [activeFunctionId, definition, functionFlows, nodeScreens, nodes, selectedScreenId])

  useImperativeHandle(ref, () => ({
    addFindElement(selector, label) {
      const canvas = editorRef.current?.querySelector<HTMLElement>('.macro-canvas')
      const bounds = canvas?.getBoundingClientRect()
      const position = flowRef.current && bounds && bounds.width > 0 && bounds.height > 0
        ? flowRef.current.screenToFlowPosition({
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2,
          })
        : undefined
      const added = addNode('find_element', position, { selector }, label)
      if (added) {
        setMessage(`${screenLabel(selectedScreenId)}에 ${label} 노드를 추가했습니다.`)
        setMessageIntent('success')
      }
      return Boolean(added)
    },
  }), [addNode, selectedScreenId])

  const validate = async (showSuccess = true) => {
    if (!definitionForSave) return false
    const clientIssues = validateMacroDefinition(definitionForSave)
    if (clientIssues.length > 0) {
      setIssues(clientIssues)
      setMessage('저장하거나 실행하기 전에 검증 오류를 수정하세요.')
      setMessageIntent('danger')
      return false
    }
    try {
      const response = await macroEditorApi.validate(definitionForSave)
      const backendIssues = mapBackendValidationErrors(response)
      setIssues(backendIssues)
      if (!response.valid || backendIssues.length > 0) {
        setMessage('백엔드 검증에서 그래프 오류를 발견했습니다.')
        setMessageIntent('danger')
        return false
      }
      if (showSuccess) {
        setMessage('그래프가 유효합니다.')
        setMessageIntent('success')
      }
      return true
    } catch (error) {
      showError(error, '백엔드 검증을 사용할 수 없습니다.', setMessage, setMessageIntent)
      return false
    }
  }

  const save = async () => {
    if (!definitionForSave || !(await validate(false))) return null
    setBusy(true)
    window.localStorage.setItem(MACRO_DRAFT_STORAGE_KEY, JSON.stringify(definitionForSave))
    try {
      const saved = isNew
        ? await macroEditorApi.create(definitionForSave)
        : await macroEditorApi.save(definitionForSave)
      await macroEditorApi.bind(deviceId, saved.id)
      setDefinitions((current) => [
        ...current.filter((item) => item.id !== saved.id),
        saved,
      ])
      clearDeviceDraft(deviceId)
      loadDefinition(saved)
      setMessage('매크로를 저장하고 이 기기에 연결했습니다.')
      setMessageIntent('success')
      return saved
    } catch (error) {
      showError(error, '매크로를 저장하지 못했습니다.', setMessage, setMessageIntent)
      return null
    } finally {
      setBusy(false)
    }
  }

  const command = async (name: 'start' | 'pause' | 'resume' | 'step' | 'stop' | 'reset') => {
    if (!definition) return
    setBusy(true)
    setMessage(null)
    try {
      if ((name === 'start' || name === 'step') && (dirty || isNew) && !(await save())) return
      await macroEditorApi.command(deviceId, name)
      await runtime.refresh()
    } catch (error) {
      showError(error, '매크로 명령을 실행하지 못했습니다.', setMessage, setMessageIntent)
    } finally {
      setBusy(false)
    }
  }

  const selectMacro = async (macroId: string) => {
    if ((dirty || isNew) && !window.confirm('저장하지 않은 매크로 변경 사항을 버릴까요?')) return
    setBusy(true)
    try {
      if (!macroId) {
        await macroEditorApi.unbind(deviceId)
        clearDeviceDraft(deviceId)
        setDefinition(null)
        setNodes([])
        setEdges([])
        setNodeScreens({})
        setFunctionFlows({})
          setActiveFunctionId(null)
          setSelectedVariableName('')
        setSelectedNodeId(null)
      } else {
        await macroEditorApi.bind(deviceId, macroId)
        const selected = await macroEditorApi.get(macroId)
        clearDeviceDraft(deviceId)
        loadDefinition(selected)
      }
    } catch (error) {
      showError(error, '매크로 연결을 변경하지 못했습니다.', setMessage, setMessageIntent)
    } finally {
      setBusy(false)
    }
  }

  const createNew = () => {
    if ((dirty || isNew) && !window.confirm('저장하지 않은 매크로 변경 사항을 버릴까요?')) return
    clearDeviceDraft(deviceId)
    const suffix = Date.now().toString(36)
    loadDefinition(createEmptyMacroDefinition(`macro-${suffix}`, '새 매크로'), true)
    setMessage('새 매크로를 만들었습니다. 저장하면 이 기기에 연결됩니다.')
    setMessageIntent('primary')
  }

  const loadDraft = () => {
    if ((dirty || isNew) && !window.confirm('저장하지 않은 매크로 변경 사항을 버릴까요?')) return
    try {
      const raw = window.localStorage.getItem(MACRO_DRAFT_STORAGE_KEY)
      if (!raw) throw new Error('로컬 매크로 초안이 없습니다.')
      const draft = JSON.parse(raw) as MacroDefinition
      clearDeviceDraft(deviceId)
      loadDefinition(draft, !definitions.some((item) => item.id === draft.id))
      setMessage('로컬 초안을 불러왔습니다.')
      setMessageIntent('success')
    } catch (error) {
      showError(error, '초안을 불러오지 못했습니다.', setMessage, setMessageIntent)
    }
  }

  const duplicate = async () => {
    if (!definitionForSave) return
    setBusy(true)
    try {
      if (isNew) {
        const suffix = Date.now().toString(36)
        clearDeviceDraft(deviceId)
        loadDefinition({
          ...definitionForSave,
          id: `macro-${suffix}`,
          name: `${definitionForSave.name} Copy`,
          version: 1,
        }, true)
      } else {
        const copy = await macroEditorApi.duplicate(definitionForSave.id, {
          name: `${definitionForSave.name} — ${deviceId}`,
        })
        await macroEditorApi.bind(deviceId, copy.id)
        setDefinitions((current) => [...current, copy])
        clearDeviceDraft(deviceId)
        loadDefinition(copy)
      }
    } catch (error) {
      showError(error, '매크로를 복제하지 못했습니다.', setMessage, setMessageIntent)
    } finally {
      setBusy(false)
    }
  }

  const changeNodes = (changes: NodeChange<MacroFlowNode>[]) => {
    if (activeFunctionId) {
      setFunctionFlows((current) => {
        const flow = current[activeFunctionId]
        return flow ? {
          ...current,
          [activeFunctionId]: { ...flow, nodes: applyNodeChanges(changes, flow.nodes) },
        } : current
      })
    } else {
      setNodes((current) => applyNodeChanges(changes, current))
    }
    if (changes.some((change) => change.type !== 'select' && change.type !== 'dimensions')) markChanged()
    if (changes.some((change) => change.type === 'remove' && change.id === selectedNodeId)) {
      setSelectedNodeId(null)
    }
  }

  const deleteSelected = () => {
    if (!selectedNodeId) return
    const selected = shownNodes.find((node) => node.id === selectedNodeId)
    if (selected?.data.isEvent) return
    if (activeFunctionId) {
      setFunctionFlows((current) => {
        const flow = current[activeFunctionId]
        return flow ? {
          ...current,
          [activeFunctionId]: {
            nodes: flow.nodes.filter((node) => node.id !== selectedNodeId),
            edges: flow.edges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId),
          },
        } : current
      })
    } else {
      setNodes((current) => current.filter((node) => node.id !== selectedNodeId))
      setEdges((current) => current.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId))
      setNodeScreens((current) => {
        const next = { ...current }
        delete next[selectedNodeId]
        return next
      })
    }
    setSelectedNodeId(null)
    markChanged()
  }

  const createFunction = () => {
    if (!definition) return
    const index = (definition.functions?.length ?? 0) + 1
    const id = uniqueFunctionId(`function-${index}`, definition.functions ?? [])
    const item = createFunctionDefinition(id, `Function ${index}`)
    setDefinition({ ...definition, functions: [...(definition.functions ?? []), item] })
    setFunctionFlows((current) => ({ ...current, [id]: macroFunctionToFlow(item) }))
    setActiveFunctionId(id)
    setSelectedNodeId(null)
    markChanged()
  }

  const renameFunction = () => {
    if (!definition || !activeFunctionId) return
    const current = definition.functions?.find((item) => item.id === activeFunctionId)
    if (!current) return
    const name = window.prompt('함수 이름', current.name)?.trim()
    if (!name || name === current.name) return
    setDefinition({
      ...definition,
      functions: (definition.functions ?? []).map((item) => item.id === activeFunctionId
        ? { ...item, name }
        : item),
    })
    markChanged()
  }

  const deleteFunction = () => {
    if (!definition || !activeFunctionId) return
    const references = countFunctionReferences(activeFunctionId, nodes, functionFlows)
    const warning = references > 0
      ? `이 함수는 함수 호출 노드 ${references}개에서 사용 중입니다. 그래도 삭제할까요?`
      : '이 함수를 삭제할까요?'
    if (!window.confirm(warning)) return
    setDefinition({
      ...definition,
      functions: (definition.functions ?? []).filter((item) => item.id !== activeFunctionId),
    })
    setFunctionFlows((current) => {
      const next = { ...current }
      delete next[activeFunctionId]
      return next
    })
        setActiveFunctionId(null)
        setSelectedVariableName('')
    setSelectedNodeId(null)
    markChanged()
  }

  const addFunctionPort = (kind: 'inputs' | 'outputs') => {
    if (!definition || !activeFunctionId) return
    const functionDefinition = definition.functions?.find((item) => item.id === activeFunctionId)
    if (!functionDefinition) return
    const id = window.prompt(`${kind === 'inputs' ? '입력' : '출력'} 포트 ID`)?.trim()
    if (!id) return
    if (functionDefinition[kind].some((port) => port.id === id)) {
      setMessage(`${id} 포트가 이미 있습니다.`)
      setMessageIntent('warning')
      return
    }
    const requested = window.prompt('포트 타입: any, bool, int, float, string, position, rect, element', 'string')?.trim()
    if (!isFunctionPortType(requested)) {
      setMessage('지원하지 않는 함수 포트 타입입니다.')
      setMessageIntent('warning')
      return
    }
    updateFunctionPorts(kind, [...functionDefinition[kind], { id, type: requested }])
  }

  const removeFunctionPort = (kind: 'inputs' | 'outputs') => {
    if (!definition || !activeFunctionId) return
    const functionDefinition = definition.functions?.find((item) => item.id === activeFunctionId)
    if (!functionDefinition || functionDefinition[kind].length === 0) return
    updateFunctionPorts(kind, functionDefinition[kind].slice(0, -1))
  }

  const updateFunctionPorts = (kind: 'inputs' | 'outputs', ports: MacroFunctionPort[]) => {
    if (!definition || !activeFunctionId) return
    const functions = (definition.functions ?? []).map((item) => item.id === activeFunctionId
      ? { ...item, [kind]: ports }
      : item)
    const updatedDefinition = synchronizeFunctionCalls({ ...definition, functions })
    setDefinition(updatedDefinition)
    setNodes((current) => synchronizeFlowFunctionCalls({ nodes: current, edges: [] }, functions).nodes)
    setFunctionFlows((current) => Object.fromEntries(functions.map((item) => {
      const flow = current[item.id] ?? macroFunctionToFlow(item)
      const next = synchronizeFlowFunctionCalls(flow, functions)
      if (item.id === activeFunctionId) {
        next.nodes = next.nodes.map((node) => node.id === item.entry_node_id
          ? { ...node, data: { ...node.data, config: { ...node.data.config, inputs: item.inputs } } }
          : node.id === item.return_node_id
            ? { ...node, data: { ...node.data, config: { ...node.data.config, outputs: item.outputs } } }
            : node)
      }
      return [item.id, next]
    })))
    markChanged()
  }

  const addVariable = () => {
    if (!definition) return
    const name = window.prompt('변수 이름')?.trim()
    if (!name) return
    if ((definition.variables ?? []).some((item) => item.name === name)) {
      setMessage(`${name} 변수가 이미 있습니다.`)
      setMessageIntent('warning')
      return
    }
    const requested = window.prompt(
      '변수 타입: bool, int, float, string, position, rect, element',
      'int',
    )?.trim()
    if (!isVariableType(requested)) {
      setMessage('지원하지 않는 변수 타입입니다.')
      setMessageIntent('warning')
      return
    }
    try {
      const variable = createVariableFromPrompts(name, requested)
      setDefinition(synchronizeVariableNodes({
        ...definition,
        variables: [...(definition.variables ?? []), variable],
      }))
      setSelectedVariableName(name)
      markChanged()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '기본값이 올바르지 않습니다.')
      setMessageIntent('warning')
    }
  }

  const editVariable = () => {
    if (!definition || !selectedVariableName) return
    const current = definition.variables?.find((item) => item.name === selectedVariableName)
    if (!current) return
    const name = window.prompt('변수 이름', current.name)?.trim()
    if (!name) return
    if (name !== current.name && (definition.variables ?? []).some((item) => item.name === name)) {
      setMessage(`${name} 변수가 이미 있습니다.`)
      setMessageIntent('warning')
      return
    }
    const requested = window.prompt(
      '변수 타입: bool, int, float, string, position, rect, element',
      current.type,
    )?.trim()
    if (!isVariableType(requested)) {
      setMessage('지원하지 않는 변수 타입입니다.')
      setMessageIntent('warning')
      return
    }
    try {
      const replacement = createVariableFromPrompts(name, requested, current.default)
      updateVariableDefinition(current.name, replacement)
      setSelectedVariableName(name)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '기본값이 올바르지 않습니다.')
      setMessageIntent('warning')
    }
  }

  const deleteVariable = () => {
    if (!definition || !selectedVariableName) return
    const references = countVariableReferences(selectedVariableName, nodes, functionFlows)
    const warning = references > 0
      ? `이 변수는 변수 설정/가져오기 노드 ${references}개에서 사용 중입니다. 그래도 삭제할까요?`
      : '이 변수를 삭제할까요?'
    if (!window.confirm(warning)) return
    setDefinition({
      ...definition,
      variables: (definition.variables ?? []).filter((item) => item.name !== selectedVariableName),
    })
    setSelectedVariableName('')
    markChanged()
  }

  const updateVariableDefinition = (oldName: string, replacement: MacroVariableDefinition) => {
    if (!definition) return
    const variables = (definition.variables ?? []).map((item) => item.name === oldName
      ? replacement
      : item)
    const syncFlow = (flow: { nodes: MacroFlowNode[]; edges: MacroFlowEdge[] }) => ({
      ...flow,
      nodes: flow.nodes.map((node) => {
        if (node.data.nodeType !== 'set_variable' && node.data.nodeType !== 'get_variable') return node
        if (node.data.config.name !== oldName) return node
        return {
          ...node,
          data: {
            ...node.data,
            config: variableNodeConfig(node.data.nodeType, replacement),
          },
        }
      }),
    })
    setDefinition(synchronizeVariableNodes({ ...definition, variables }))
    setNodes((current) => syncFlow({ nodes: current, edges: [] }).nodes)
    setFunctionFlows((current) => Object.fromEntries(
      Object.entries(current).map(([id, flow]) => [id, syncFlow(flow)]),
    ))
    markChanged()
  }

  const state = runtime.runtime?.state ?? 'idle'
  const runtimeActive = state === 'running' || state === 'paused'
  return (
    <section className="integrated-macro-panel" aria-label={ko.panels.macroCanvas} data-editor-pane="macro">
      <header className="integrated-macro-toolbar">
        <div className="integrated-macro-toolbar__selectors">
          <strong>{ko.panels.macroCanvas}</strong>
          <Tag minimal title={deviceId}>
            기기 · {deviceId.length > 18 ? `${deviceId.slice(0, 18)}…` : deviceId}
          </Tag>
          <select
            aria-label="작업공간 매크로"
            value={definition?.id ?? ''}
            disabled={busy}
            onChange={(event) => void selectMacro(event.target.value)}
          >
            <option value="">매크로 선택…</option>
            {isNew && definition && <option value={definition.id}>{definition.name} (저장되지 않음)</option>}
            {definitions.map((item) => (
              <option key={item.id} value={item.id}>{item.name} v{item.version}</option>
            ))}
          </select>
          <select
            aria-label="매크로 화면"
            value={selectedScreenId}
            disabled={!definition || Boolean(activeFunctionId)}
            onChange={(event) => {
              setSelectedScreenId(event.target.value)
              setSelectedNodeId(null)
              window.setTimeout(() => flowRef.current?.fitView({ duration: 200, padding: 0.2 }), 0)
            }}
          >
            {SCREEN_OPTIONS.map((screen) => (
              <option key={screen.id} value={screen.id}>{screen.label}</option>
            ))}
          </select>
          {dirty && <Tag intent="warning" minimal>편집 중</Tag>}
        </div>
        <div className="integrated-macro-tabs" role="tablist" aria-label="매크로 작업 모드">
          <Button
            minimal
            small
            role="tab"
            aria-selected={panelTab === 'canvas'}
            active={panelTab === 'canvas'}
            text="캔버스"
            onClick={() => setPanelTab('canvas')}
          />
          <Button
            minimal
            small
            role="tab"
            aria-selected={panelTab === 'execution'}
            active={panelTab === 'execution'}
            text="실행"
            onClick={() => setPanelTab('execution')}
          />
        </div>
        {panelTab === 'canvas' ? (
          <ButtonGroup className="integrated-macro-toolbar__actions" minimal>
            <Button small disabled={busy} onClick={createNew}>{ko.actions.newMacro}</Button>
            <Button small disabled={busy} onClick={loadDraft}>{ko.actions.loadDraft}</Button>
            <Button small disabled={!definition || busy} onClick={() => void duplicate()}>{ko.actions.duplicate}</Button>
            <Button small disabled={!definition || busy} onClick={() => void validate()}>{ko.actions.validate}</Button>
            <Button small disabled={!definition} onClick={() => void flowRef.current?.fitView({ duration: 200, padding: 0.2 })}>{ko.actions.fitView}</Button>
            <Button small intent="primary" disabled={!definition || busy} onClick={() => void save()}>{ko.actions.save}</Button>
            <select
              aria-label="매크로 그래프"
              value={activeFunctionId ?? '__main__'}
              disabled={!definition}
              onChange={(event) => {
                setActiveFunctionId(event.target.value === '__main__' ? null : event.target.value)
                setSelectedNodeId(null)
                window.setTimeout(() => flowRef.current?.fitView({ duration: 200, padding: 0.2 }), 0)
              }}
            >
              <option value="__main__">메인</option>
              {(definition?.functions ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <select
              aria-label="매크로 변수"
              value={selectedVariableName}
              disabled={!definition || (definition.variables?.length ?? 0) === 0}
              onChange={(event) => setSelectedVariableName(event.target.value)}
            >
              <option value="">변수…</option>
              {(definition?.variables ?? []).map((item) => (
                <option key={item.name} value={item.name}>{item.name} · {item.type}</option>
              ))}
            </select>
            <Button small disabled={!definition || busy} onClick={addVariable}>+ 변수</Button>
            <Button small disabled={!selectedVariableName || busy} onClick={editVariable}>변수 수정</Button>
            <Button small intent="danger" disabled={!selectedVariableName || busy} onClick={deleteVariable}>변수 삭제</Button>
            <Button small disabled={!definition || busy} onClick={createFunction}>새 함수</Button>
            <Button small disabled={!activeFunctionId || busy} onClick={renameFunction}>함수 이름 변경</Button>
            <Button small disabled={!activeFunctionId || busy} onClick={() => addFunctionPort('inputs')}>+ 입력</Button>
            <Button small disabled={!activeFunctionId || busy} onClick={() => removeFunctionPort('inputs')}>− 입력</Button>
            <Button small disabled={!activeFunctionId || busy} onClick={() => addFunctionPort('outputs')}>+ 출력</Button>
            <Button small disabled={!activeFunctionId || busy} onClick={() => removeFunctionPort('outputs')}>− 출력</Button>
            <Button small intent="danger" disabled={!activeFunctionId || busy} onClick={deleteFunction}>함수 삭제</Button>
          </ButtonGroup>
        ) : (
          <ButtonGroup className="integrated-macro-toolbar__actions" minimal>
            <Button small intent="success" disabled={!definition || busy || state !== 'idle'} onClick={() => void command('start')}>{ko.actions.run}</Button>
            <Button small disabled={busy || state !== 'running'} onClick={() => void command('pause')}>{ko.actions.pause}</Button>
            <Button small disabled={busy || state !== 'paused'} onClick={() => void command('resume')}>{ko.actions.resume}</Button>
            <Button small disabled={!definition || busy || state !== 'paused'} onClick={() => void command('step')}>{ko.actions.step}</Button>
            <Button small intent="danger" disabled={busy || !runtimeActive} onClick={() => void command('stop')}>{ko.actions.stop}</Button>
            <Button small disabled={busy || !['error', 'stopped', 'completed'].includes(state)} onClick={() => void command('reset')}>{ko.actions.reset}</Button>
          </ButtonGroup>
        )}
      </header>
      {message && <Callout className="integrated-macro-message" compact intent={messageIntent}>{message}</Callout>}
      <div className="integrated-macro-content">
        {panelTab === 'canvas' && runtimeActive && (
          <Callout className="integrated-macro-running-notice" compact intent="warning">
            실행 중 - 현재 실행에는 저장 후 변경사항이 반영되지 않습니다.
          </Callout>
        )}
        <div
          ref={editorRef}
          className={`integrated-macro-editor${panelTab === 'canvas' ? '' : ' is-tab-hidden'}`}
          aria-hidden={panelTab !== 'canvas'}
        >
          <BlockPalette onAdd={(type) => addNode(type)} />
          {definition ? (
            <MacroCanvas
            nodes={shownNodes}
            edges={shownEdges}
            onNodesChange={changeNodes}
            onEdgesChange={(changes: EdgeChange<MacroFlowEdge>[]) => {
              if (activeFunctionId) {
                setFunctionFlows((current) => {
                  const flow = current[activeFunctionId]
                  return flow ? {
                    ...current,
                    [activeFunctionId]: { ...flow, edges: applyEdgeChanges(changes, flow.edges) },
                  } : current
                })
              } else {
                setEdges((current) => applyEdgeChanges(changes, current))
              }
              if (changes.some((change) => change.type !== 'select')) markChanged()
            }}
            onConnect={(connection: Connection, kind: 'exec' | 'data' = 'exec') => {
              const connect = (current: MacroFlowEdge[]) => addEdge({
                ...connection,
                id: uniqueEdgeId(connection, current),
                data: { errors: [], kind },
              }, current)
              if (activeFunctionId) {
                setFunctionFlows((current) => {
                  const flow = current[activeFunctionId]
                  return flow ? {
                    ...current,
                    [activeFunctionId]: { ...flow, edges: connect(flow.edges) },
                  } : current
                })
              } else {
                setEdges(connect)
              }
              markChanged()
            }}
            onSelectNode={setSelectedNodeId}
            onDropBlock={(type, position) => addNode(type, position)}
            onReady={(instance) => { flowRef.current = instance }}
            />
          ) : (
            <div className="integrated-macro-empty">
              <strong>선택된 매크로가 없습니다</strong>
              <span>새 매크로를 만들거나 초안을 불러오거나 기존 매크로를 선택하세요.</span>
            </div>
          )}
          <NodeInspector
          node={selectedNode}
          issues={issues.filter((item) => item.nodeId === selectedNodeId)}
          onUpdateConfig={(config) => {
            if (!selectedNodeId) return
            updateSelectedFlowNode(activeFunctionId, selectedNodeId, setNodes, setFunctionFlows, (node) => ({
              ...node, data: { ...node.data, config },
            }))
            markChanged()
          }}
          onUpdateLabel={(label) => {
            if (!selectedNodeId) return
            updateSelectedFlowNode(activeFunctionId, selectedNodeId, setNodes, setFunctionFlows, (node) => ({
              ...node, data: { ...node.data, label, definitionLabel: label },
            }))
            markChanged()
          }}
          onSetEntry={() => undefined}
          onDelete={deleteSelected}
          allowLegacyEntry={false}
          functions={definition?.functions ?? []}
            variables={definition?.variables ?? []}
          />
        </div>
        {panelTab === 'execution' && (
          <MacroExecutionPanel runtime={runtime} state={state} />
        )}
      </div>
    </section>
  )
})

function MacroExecutionPanel({
  runtime,
  state,
}: {
  runtime: ReturnType<typeof useMacroRuntime>
  state: string
}) {
  const snapshot = runtime.runtime
  const variableEntries = Object.entries(snapshot?.variables ?? {})
  const trace = snapshot?.trace ?? []
  const activeScreen = snapshot?.active_screen_id
    ? screenLabel(snapshot.active_screen_id)
    : '—'

  return (
    <section className="integrated-macro-runtime" aria-label="매크로 실행 상태">
      <header className="integrated-macro-runtime__heading">
        <div>
          <strong>런타임 상태</strong>
          <small>{snapshot?.runtime_id ?? '활성 런타임 없음'}</small>
        </div>
        <Tag
          intent={state === 'running' ? 'success' : state === 'paused' ? 'warning' : 'none'}
        >
          {runtimeStateLabels[state] ?? state}
          {snapshot?.definition_version ? ` v${snapshot.definition_version}` : ''}
        </Tag>
      </header>

      <dl className="integrated-macro-runtime__summary">
        <div>
          <dt>Runtime State</dt>
          <dd>{runtimeStateLabels[state] ?? state}</dd>
        </div>
        <div>
          <dt>Current Node</dt>
          <dd>{runtime.currentNodeId ?? snapshot?.current_node_id ?? '—'}</dd>
        </div>
        <div>
          <dt>Current Screen</dt>
          <dd>{activeScreen}</dd>
        </div>
        <div>
          <dt>Step Count</dt>
          <dd>{snapshot?.step_count ?? 0}</dd>
        </div>
        <div className={`is-error${snapshot?.error ? ' has-error' : ''}`}>
          <dt>Error</dt>
          <dd>{snapshot?.error ?? '—'}</dd>
        </div>
      </dl>

      <div className="integrated-macro-runtime__details">
        <section aria-label="런타임 변수">
          <header>
            <strong>Variables</strong>
            <Tag minimal>{variableEntries.length}</Tag>
          </header>
          <div className="integrated-macro-runtime__list">
            {variableEntries.length > 0 ? (
              variableEntries.map(([name, value]) => (
                <div className="integrated-macro-runtime__variable" key={name}>
                  <strong>{name}</strong>
                  <code>{formatRuntimeValue(value)}</code>
                </div>
              ))
            ) : (
              <div className="integrated-macro-runtime__empty">런타임 변수가 없습니다.</div>
            )}
          </div>
        </section>

        <section aria-label="런타임 트레이스">
          <header>
            <strong>Trace</strong>
            <Tag minimal>{trace.length}</Tag>
          </header>
          <div className="integrated-macro-runtime__list">
            {trace.length > 0 ? (
              trace.map((entry, index) => (
                <div className="integrated-macro-runtime__trace" key={index}>
                  <span>{index + 1}</span>
                  <code>{formatRuntimeValue(entry)}</code>
                </div>
              ))
            ) : (
              <div className="integrated-macro-runtime__empty">실행 트레이스가 없습니다.</div>
            )}
          </div>
        </section>
      </div>
    </section>
  )
}

function formatRuntimeValue(value: JsonValue | Record<string, JsonValue>): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function deriveNodeScreens(
  definition: MacroDefinition,
  nodes: MacroFlowNode[],
  edges: MacroFlowEdge[],
) {
  const result: Record<string, string> = {}
  const raw = definition.metadata.editor_screen_node_ids
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [screenId, ids] of Object.entries(raw)) {
      if (Array.isArray(ids)) {
        for (const id of ids) if (typeof id === 'string') result[id] = screenId
      }
    }
  }
  for (const node of nodes) {
    if (node.data.eventScreenId) result[node.id] = node.data.eventScreenId
  }
  for (const screen of SCREEN_OPTIONS) {
    const queue = nodes
      .filter((node) => node.data.eventScreenId === screen.id)
      .map((node) => node.id)
    const visited = new Set(queue)
    while (queue.length > 0) {
      const source = queue.shift()!
      for (const edge of edges) {
        if (edge.source !== source || visited.has(edge.target)) continue
        const target = nodes.find((node) => node.id === edge.target)
        if (!target || (target.data.isEvent && target.data.eventScreenId !== screen.id)) continue
        visited.add(target.id)
        if (!target.data.isEvent && !result[target.id]) result[target.id] = screen.id
        queue.push(target.id)
      }
    }
  }
  for (const node of nodes) {
    if (!node.data.isEvent && !result[node.id]) result[node.id] = DEFAULT_SCREEN_ID
  }
  return result
}

function serializeNodeScreens(nodeScreens: Record<string, string>, nodes: MacroFlowNode[]) {
  return Object.fromEntries(SCREEN_OPTIONS.map((screen) => [
    screen.id,
    nodes
      .filter((node) => !node.data.isEvent && nodeScreens[node.id] === screen.id)
      .map((node) => node.id),
  ]))
}

function screenLabel(screenId: string) {
  return SCREEN_OPTIONS.find((screen) => screen.id === screenId)?.label ?? screenId
}

function uniqueNodeId(prefix: string, nodes: MacroFlowNode[]) {
  const used = new Set(nodes.map((node) => node.id))
  let index = 1
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function uniqueEdgeId(connection: Connection, edges: MacroFlowEdge[]) {
  const prefix = `${connection.source ?? 'node'}-${connection.target ?? 'node'}`
  const used = new Set(edges.map((edge) => edge.id))
  let index = 1
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function showError(
  error: unknown,
  fallback: string,
  setMessage: (value: string) => void,
  setIntent: (value: 'danger') => void,
) {
  setMessage(error instanceof Error ? error.message : fallback)
  setIntent('danger')
}

function configForNewNode(
  type: MacroNodeType,
  functions: readonly MacroFunctionDefinition[],
  variables: readonly MacroVariableDefinition[],
): Record<string, JsonValue> {
  const config = cloneDefaultConfig(type)
  if ((type === 'set_variable' || type === 'get_variable') && variables.length > 0) {
    const selected = variables[0]
    return selected ? variableNodeConfig(type, selected) : config
  }
  if (type !== 'call_function' || functions.length === 0) return config
  const selected = functions[0]
  if (!selected) return config
  return {
    function_id: selected.id,
    inputs: structuredClone(selected.inputs),
    outputs: structuredClone(selected.outputs),
  }
}

function synchronizeVariableNodes(definition: MacroDefinition): MacroDefinition {
  const variables = structuredClone(definition.variables ?? [])
  const byName = new Map(variables.map((item) => [item.name, item]))
  const sync = (nodes: MacroDefinition['nodes']) => nodes.map((node) => {
    if (node.type !== 'set_variable' && node.type !== 'get_variable') return node
    const name = typeof node.config.name === 'string' ? node.config.name : ''
    const variable = byName.get(name)
    return variable ? { ...node, config: variableNodeConfig(node.type, variable) } : node
  })
  return {
    ...definition,
    variables,
    nodes: sync(definition.nodes),
    functions: (definition.functions ?? []).map((item) => ({
      ...item,
      nodes: sync(item.nodes),
    })),
  }
}

function variableNodeConfig(
  type: 'set_variable' | 'get_variable',
  variable: MacroVariableDefinition,
): Record<string, JsonValue> {
  return {
    name: variable.name,
    type: variable.type,
    ...(type === 'set_variable' ? { default: variable.default ?? null } : {}),
  }
}

function createVariableFromPrompts(
  name: string,
  type: MacroVariableDefinition['type'],
  currentDefault?: JsonValue,
): MacroVariableDefinition {
  if (type === 'element') return { name, type }
  const suggested = currentDefault === undefined
    ? defaultVariableText(type)
    : typeof currentDefault === 'string' ? currentDefault : JSON.stringify(currentDefault)
  const raw = window.prompt('기본값', suggested)
  if (raw === null) throw new Error('변수 편집을 취소했습니다.')
  return { name, type, default: parseVariableDefault(raw, type) }
}

function parseVariableDefault(
  raw: string,
  type: Exclude<MacroVariableDefinition['type'], 'element'>,
): JsonValue {
  if (type === 'string') return raw
  if (type === 'bool') {
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new Error('불리언 기본값은 true 또는 false여야 합니다.')
  }
  if (type === 'int') {
    const value = Number(raw)
    if (!Number.isInteger(value)) throw new Error('정수 기본값은 정수여야 합니다.')
    return value
  }
  if (type === 'float') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error('실수 기본값은 유한한 숫자여야 합니다.')
    return value
  }
  try {
    const value = JSON.parse(raw) as JsonValue
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    const keys = type === 'position' ? ['x', 'y'] : ['left', 'top', 'right', 'bottom']
    if (keys.some((key) => typeof value[key] !== 'number')) throw new Error()
    return value
  } catch {
    throw new Error(`${type} 기본값은 올바른 JSON 객체여야 합니다.`)
  }
}

function defaultVariableText(type: Exclude<MacroVariableDefinition['type'], 'element'>) {
  if (type === 'bool') return 'false'
  if (type === 'int' || type === 'float') return '0'
  if (type === 'position') return '{"x":0,"y":0}'
  if (type === 'rect') return '{"left":0,"top":0,"right":100,"bottom":100}'
  return ''
}

function createFunctionDefinition(id: string, name: string): MacroFunctionDefinition {
  return {
    id,
    name,
    inputs: [],
    outputs: [],
    entry_node_id: `${id}-entry`,
    return_node_id: `${id}-return`,
    nodes: [
      {
        id: `${id}-entry`, type: 'function_entry', label: `${name} / 시작`,
        config: { inputs: [] }, position: { x: 80, y: 140 },
      },
      {
        id: `${id}-return`, type: 'function_return', label: `${name} / 반환`,
        config: { outputs: [] }, position: { x: 620, y: 140 },
      },
    ],
    edges: [],
  }
}

function synchronizeFunctionCalls(definition: MacroDefinition): MacroDefinition {
  const functions = structuredClone(definition.functions ?? [])
  const signatures = new Map(functions.map((item) => [item.id, item]))
  const syncNodes = (
    nodes: MacroDefinition['nodes'],
    boundary?: MacroFunctionDefinition,
  ) => nodes.map((node) => {
    if (boundary && node.id === boundary.entry_node_id) {
      return { ...node, config: { ...node.config, inputs: structuredClone(boundary.inputs) } }
    }
    if (boundary && node.id === boundary.return_node_id) {
      return { ...node, config: { ...node.config, outputs: structuredClone(boundary.outputs) } }
    }
    if (node.type !== 'call_function') return node
    const functionId = typeof node.config.function_id === 'string' ? node.config.function_id : ''
    const target = signatures.get(functionId)
    if (!target) return node
    return {
      ...node,
      config: {
        ...node.config,
        inputs: structuredClone(target.inputs),
        outputs: structuredClone(target.outputs),
      },
    }
  })
  return {
    ...definition,
    nodes: syncNodes(definition.nodes),
    functions: functions.map((item) => ({ ...item, nodes: syncNodes(item.nodes, item) })),
  }
}

function synchronizeFlowFunctionCalls(
  flow: { nodes: MacroFlowNode[]; edges: MacroFlowEdge[] },
  functions: readonly MacroFunctionDefinition[],
) {
  const signatures = new Map(functions.map((item) => [item.id, item]))
  return {
    ...flow,
    nodes: flow.nodes.map((node) => {
      if (node.data.nodeType !== 'call_function') return node
      const functionId = typeof node.data.config.function_id === 'string'
        ? node.data.config.function_id
        : ''
      const target = signatures.get(functionId)
      if (!target) return node
      return {
        ...node,
        data: {
          ...node.data,
          config: {
            ...node.data.config,
            inputs: structuredClone(target.inputs),
            outputs: structuredClone(target.outputs),
          },
        },
      }
    }),
  }
}

function updateSelectedFlowNode(
  activeFunctionId: string | null,
  selectedNodeId: string,
  setMainNodes: Dispatch<SetStateAction<MacroFlowNode[]>>,
  setFlows: Dispatch<SetStateAction<Record<string, { nodes: MacroFlowNode[]; edges: MacroFlowEdge[] }>>>,
  transform: (node: MacroFlowNode) => MacroFlowNode,
) {
  if (!activeFunctionId) {
    setMainNodes((current) => current.map((node) => node.id === selectedNodeId
      ? transform(node)
      : node))
    return
  }
  setFlows((current) => {
    const flow = current[activeFunctionId]
    return flow ? {
      ...current,
      [activeFunctionId]: {
        ...flow,
        nodes: flow.nodes.map((node) => node.id === selectedNodeId ? transform(node) : node),
      },
    } : current
  })
}

function uniqueFunctionId(prefix: string, functions: readonly MacroFunctionDefinition[]) {
  const used = new Set(functions.map((item) => item.id))
  if (!used.has(prefix)) return prefix
  let index = 2
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function countFunctionReferences(
  functionId: string,
  mainNodes: readonly MacroFlowNode[],
  flows: Record<string, { nodes: MacroFlowNode[]; edges: MacroFlowEdge[] }>,
) {
  return [mainNodes, ...Object.values(flows).map((flow) => flow.nodes)]
    .flat()
    .filter((node) => node.data.nodeType === 'call_function' && node.data.config.function_id === functionId)
    .length
}

function countVariableReferences(
  name: string,
  mainNodes: readonly MacroFlowNode[],
  flows: Record<string, { nodes: MacroFlowNode[]; edges: MacroFlowEdge[] }>,
) {
  return [mainNodes, ...Object.values(flows).map((flow) => flow.nodes)]
    .flat()
    .filter((node) => (
      (node.data.nodeType === 'set_variable' || node.data.nodeType === 'get_variable')
      && node.data.config.name === name
    ))
    .length
}

function isFunctionPortType(value: string | undefined): value is MacroFunctionPort['type'] {
  return !!value && ['any', 'bool', 'int', 'float', 'string', 'position', 'rect', 'element']
    .includes(value)
}

function isVariableType(value: string | undefined): value is MacroVariableDefinition['type'] {
  return !!value && ['bool', 'int', 'float', 'string', 'position', 'rect', 'element']
    .includes(value)
}
