import { Button, ButtonGroup, Callout, Tag } from '@blueprintjs/core'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport,
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
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react'
import type { useMacroRuntime } from '../macro-runtime/useMacroRuntime'
import { ConfirmDialog } from '../../components/AppDialog'
import { macroEditorApi } from './api'
import { BlockPalette } from './BlockPalette'
import { BlueprintInspector } from './BlueprintInspector'
import {
  BLOCKS,
  BLOCK_BY_TYPE,
  cloneDefaultConfig,
  getNodePorts,
  type BlockDefinition,
} from './blocks'
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
import {
  MacroCanvas,
  type PromoteVariablePort,
} from './MacroCanvas'
import {
  MyBlueprintPanel,
  type BlueprintSelection,
} from './MyBlueprintPanel'
import type { BlueprintDragItem } from './blueprint-dnd'
import { NodeInspector } from './NodeInspector'
import {
  NameEditorDialog,
  VariableEditorDialog,
} from './MacroEditorDialogs'
import { SCREEN_OPTIONS, SEMANTIC_SCREEN_OPTIONS } from './screen-elements'
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
const EXPANDED_PALETTE_WIDTH = 220
const EXPANDED_INSPECTOR_WIDTH = 320

function MacroValidationTag({
  status,
  errorCount,
}: {
  status: 'unknown' | 'valid' | 'invalid' | 'stale'
  errorCount: number
}) {
  if (status === 'valid') return <Tag intent="success" minimal>검증됨</Tag>
  if (status === 'invalid') return <Tag intent="danger" minimal>검증 오류 {errorCount}개</Tag>
  if (status === 'stale') return <Tag intent="warning" minimal>검증 결과 오래됨</Tag>
  return <Tag minimal>검증 안 됨</Tag>
}

interface DeviceMacroDraft {
  definition: MacroDefinition
  isNew: boolean
}
type VariableDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; variable: MacroVariableDefinition }
  | {
      mode: 'promote'
      suggestedName: string
      suggestedType: MacroVariableDefinition['type']
      port: PromoteVariablePort
      position: { x: number; y: number }
    }

type NameDialogState =
  | { kind: 'macro-create'; initialValue: string }
  | { kind: 'macro-rename'; initialValue: string; macro: MacroDefinition }
  | { kind: 'function-create'; initialValue: string }
  | { kind: 'function-rename'; initialValue: string; functionId: string }

interface ConfirmDialogState {
  title: string
  description: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
}

interface GraphViewState {
  viewport: Viewport
  selectedNodeId: string | null
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
  const [graphNavigationStack, setGraphNavigationStack] = useState<string[]>([])
  const [selectedVariableName, setSelectedVariableName] = useState('')
  const [selectedBlueprint, setSelectedBlueprint] = useState<BlueprintSelection | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'blueprint' | 'blocks'>('blocks')
  const [selectedScreenId, setSelectedScreenId] = useState<string>(DEFAULT_SCREEN_ID)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [dirty, setDirty] = useState(false)
  const [validationState, setValidationState] = useState<{
    status: 'unknown' | 'valid' | 'invalid' | 'stale'
    errorCount: number
  }>({ status: 'unknown', errorCount: 0 })
  const [isNew, setIsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageIntent, setMessageIntent] = useState<'primary' | 'success' | 'warning' | 'danger'>('primary')
  const [panelTab, setPanelTab] = useState<'canvas' | 'execution'>('execution')
  const [boundMacroId, setBoundMacroId] = useState<string | null>(null)
  const [runtimeDetailOpen, setRuntimeDetailOpen] = useState(false)
  const [runSetupMacro, setRunSetupMacro] = useState<MacroDefinition | null>(null)
  const [variableDialog, setVariableDialog] = useState<VariableDialogState | null>(null)
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [canvasExpanded, setCanvasExpanded] = useState(false)
  const [expandedPaletteWidth, setExpandedPaletteWidth] = useState(EXPANDED_PALETTE_WIDTH)
  const [expandedInspectorWidth, setExpandedInspectorWidth] = useState(EXPANDED_INSPECTOR_WIDTH)
  const flowRef = useRef<ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null>(null)
  const graphViewStates = useRef<Record<string, GraphViewState>>({})
  const editorRef = useRef<HTMLDivElement>(null)
  const editorDialogOpen = Boolean(
    variableDialog || nameDialog || confirmDialog || runSetupMacro,
  )

  const navigateToGraphPath = useCallback((nextPath: string[]) => {
    const currentKey = activeFunctionId ?? '__main__'
    const viewport = flowRef.current?.getViewport()
    if (viewport) {
      graphViewStates.current[currentKey] = { viewport, selectedNodeId }
    }

    const targetFunctionId = nextPath.at(-1) ?? null
    const targetKey = targetFunctionId ?? '__main__'
    const saved = graphViewStates.current[targetKey]
    setGraphNavigationStack(nextPath)
    setActiveFunctionId(targetFunctionId)
    setSelectedBlueprint(null)
    setSelectedNodeId(saved?.selectedNodeId ?? null)

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (saved) void flowRef.current?.setViewport(saved.viewport, { duration: 0 })
        else void flowRef.current?.fitView({ duration: 0, padding: 0.2 })
      })
    })
  }, [activeFunctionId, selectedNodeId])

  const enterFunctionGraph = (functionId: string) => {
    const existingIndex = graphNavigationStack.indexOf(functionId)
    const nextPath = existingIndex >= 0
      ? graphNavigationStack.slice(0, existingIndex + 1)
      : [...graphNavigationStack, functionId]
    navigateToGraphPath(nextPath)
    setSelectedBlueprint({ kind: 'function', id: functionId })
  }

  const setCanvasExpansion = useCallback((expanded: boolean) => {
    const viewport = flowRef.current?.getViewport()
    setCanvasExpanded(expanded)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (viewport) void flowRef.current?.setViewport(viewport, { duration: 0 })
      })
    })
  }, [])

  useEffect(() => {
    if (!canvasExpanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !editorDialogOpen) setCanvasExpansion(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [canvasExpanded, editorDialogOpen, setCanvasExpansion])

  useEffect(() => {
    if (panelTab !== 'canvas' || graphNavigationStack.length === 0) return
    const goToParentGraph = (event: KeyboardEvent) => {
      if (!event.altKey || event.key !== 'ArrowLeft') return
      if (variableDialog || nameDialog || confirmDialog || runSetupMacro) return
      const target = event.target
      if (target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      navigateToGraphPath(graphNavigationStack.slice(0, -1))
    }
    window.addEventListener('keydown', goToParentGraph)
    return () => window.removeEventListener('keydown', goToParentGraph)
  }, [
    confirmDialog,
    graphNavigationStack,
    nameDialog,
    navigateToGraphPath,
    panelTab,
    runSetupMacro,
    variableDialog,
  ])

  const beginExpandedResize = (
    side: 'palette' | 'inspector',
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = side === 'palette' ? expandedPaletteWidth : expandedInspectorWidth
    const move = (pointerEvent: PointerEvent) => {
      const modalWidth = window.innerWidth * 0.95
      const delta = pointerEvent.clientX - startX
      const requested = side === 'palette' ? startWidth + delta : startWidth - delta
      const minimum = side === 'palette' ? 150 : 240
      const next = Math.round(Math.max(minimum, Math.min(modalWidth * 0.4, requested)))
      if (side === 'palette') setExpandedPaletteWidth(next)
      else setExpandedInspectorWidth(next)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.classList.remove('macro-canvas-is-resizing')
    }
    document.body.classList.add('macro-canvas-is-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  useEffect(() => {
    onAvailabilityChange?.(Boolean(definition))
  }, [definition, onAvailabilityChange])

  const loadDefinition = useCallback((source: MacroDefinition, newDefinition = false) => {
    const next = synchronizeVariableNodes(synchronizeFunctionCalls(migrateLegacyEntry(source)))
    const flow = macroDefinitionToFlow(next)
    setDefinition(next)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    setFunctionFlows(Object.fromEntries((next.functions ?? []).map((item) => [
      item.id,
      macroFunctionToFlow(item),
    ])))
    graphViewStates.current = {}
    setGraphNavigationStack([])
    setActiveFunctionId(null)
    setSelectedVariableName(next.variables?.[0]?.name ?? '')
    setSelectedBlueprint(null)
    setNodeScreens(deriveNodeScreens(next, flow.nodes, flow.edges))
    setSelectedNodeId(null)
    setIssues([])
    setDirty(false)
    setValidationState({ status: 'unknown', errorCount: 0 })
    setIsNew(newDefinition)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([macroEditorApi.list(), macroEditorApi.binding(deviceId)])
      .then(async ([listed, binding]) => {
        if (!active) return
        setDefinitions(listed.macros)
        setBoundMacroId(binding.binding?.macro_definition_id ?? null)
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
          graphViewStates.current = {}
          setGraphNavigationStack([])
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

  const shownEdges = useMemo(() => {
    const graphNodes = activeFunctionId ? functionFlows[activeFunctionId]?.nodes ?? [] : nodes
    const graphEdges = activeFunctionId
      ? functionFlows[activeFunctionId]?.edges ?? []
      : edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    return graphEdges.map((edge) => {
      const source = graphNodes.find((node) => node.id === edge.source)
      const portType = edge.data?.kind === 'data' && source
        ? getNodePorts(source.data.nodeType, source.data.config).outputs
            .find((port) => port.id === edge.sourceHandle)?.type
        : undefined
      return {
      ...edge,
      data: {
        ...edge.data,
        errors: issues.filter((item) => item.edgeId === edge.id).map((item) => item.message),
      },
      className: [
        edge.data?.kind === 'data' ? 'macro-edge--data' : '',
        portType ? `macro-edge--type-${portType}` : '',
        edge.id === runtime.currentEdgeId ? 'runtime-current-edge' : '',
      ].filter(Boolean).join(' ') || undefined,
      animated: edge.id === runtime.currentEdgeId,
      }
    })
  }, [activeFunctionId, edges, functionFlows, issues, nodes, runtime.currentEdgeId, visibleNodeIds])

  const selectedNode = shownNodes.find((node) => node.id === selectedNodeId) ?? null
  const quickSearchBlocks = useMemo(
    () => contextualQuickSearchBlocks(definition),
    [definition],
  )

  const markChanged = () => {
    setDirty(true)
    setValidationState((current) => current.status === 'unknown'
      ? current
      : { ...current, status: 'stale' })
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
        label: labelOverride ?? contextualNodeLabel(type, configured, definition, block.label),
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

  const addConnection = useCallback((
    connection: Connection,
    kind: 'exec' | 'data' = 'exec',
  ) => {
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
  }, [activeFunctionId])

  const dropBlueprintItem = useCallback((
    item: BlueprintDragItem,
    position: { x: number; y: number },
  ) => {
    if (!definition) return
    if (item.kind === 'function') {
      const target = definition.functions?.find((candidate) => candidate.id === item.id)
      if (!target) return
      addNode('call_function', position, functionCallConfig(target), target.name)
      return
    }
    const variable = definition.variables?.find((candidate) => candidate.name === item.id)
    if (!variable || !item.mode) return
    const type = item.mode === 'get' ? 'get_variable' : 'set_variable'
    addNode(type, position, variableNodeConfig(type, variable), variableNodeLabel(item.mode, variable.name))
  }, [addNode, definition])

  const promoteToVariable = useCallback((
    port: PromoteVariablePort,
    position: { x: number; y: number },
  ) => {
    if (!definition) return
    const suggested = uniqueVariableName(port.portId || 'value', definition.variables ?? [])
    setVariableDialog({
      mode: 'promote',
      suggestedName: suggested,
      suggestedType: port.portType,
      port,
      position,
    })
  }, [definition])

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

  const validateDefinition = async (
    candidate: MacroDefinition,
    showSuccess = true,
  ) => {
    const clientIssues = validateMacroDefinition(candidate)
    if (clientIssues.length > 0) {
      setIssues(clientIssues)
      setValidationState({ status: 'invalid', errorCount: clientIssues.length })
      setMessage(showSuccess
        ? `그래프 검증 오류 ${clientIssues.length}개를 발견했습니다.`
        : `검증 오류 ${clientIssues.length}개가 있어 실행할 수 없습니다.`)
      setMessageIntent('danger')
      return false
    }
    try {
      const response = await macroEditorApi.validate(candidate)
      const backendIssues = mapBackendValidationErrors(response)
      setIssues(backendIssues)
      if (!response.valid || backendIssues.length > 0) {
        const errorCount = Math.max(1, backendIssues.length)
        setValidationState({ status: 'invalid', errorCount })
        setMessage(showSuccess
          ? `백엔드 그래프 검증 오류 ${errorCount}개를 발견했습니다.`
          : `검증 오류 ${errorCount}개가 있어 실행할 수 없습니다.`)
        setMessageIntent('danger')
        return false
      }
      setValidationState({ status: 'valid', errorCount: 0 })
      if (showSuccess) {
        setMessage('그래프가 유효합니다.')
        setMessageIntent('success')
      }
      return true
    } catch (error) {
      setValidationState({ status: 'unknown', errorCount: 0 })
      showError(error, '백엔드 검증을 사용할 수 없습니다.', setMessage, setMessageIntent)
      return false
    }
  }

  const validate = async (showSuccess = true) => {
    if (!definitionForSave) return false
    return validateDefinition(definitionForSave, showSuccess)
  }

  const save = async () => {
    if (!definitionForSave) return null
    const priorValidation = validationState
    const priorIssues = issues
    setBusy(true)
    window.localStorage.setItem(MACRO_DRAFT_STORAGE_KEY, JSON.stringify(definitionForSave))
    try {
      const saved = isNew
        ? await macroEditorApi.create(definitionForSave)
        : await macroEditorApi.save(definitionForSave)
      let bound = false
      if (priorValidation.status === 'valid') {
        try {
          await macroEditorApi.bind(deviceId, saved.id)
          setBoundMacroId(saved.id)
          bound = true
        } catch (error) {
          showError(error, '저장했지만 기기에 연결하지 못했습니다.', setMessage, setMessageIntent)
        }
      }
      setDefinitions((current) => [
        ...current.filter((item) => item.id !== saved.id),
        saved,
      ])
      clearDeviceDraft(deviceId)
      loadDefinition(saved)
      setIssues(priorIssues)
      setValidationState(priorValidation)
      if (priorValidation.status === 'invalid') {
        setMessage(`저장됨 · 검증 오류 ${priorValidation.errorCount}개 · 기기 연결 차단됨`)
        setMessageIntent('warning')
      } else if (priorValidation.status === 'unknown' || priorValidation.status === 'stale') {
        setMessage('매크로를 저장했습니다. 검증 후 실행하거나 기기에 연결할 수 있습니다.')
        setMessageIntent('warning')
      } else if (bound) {
        setMessage('매크로를 저장하고 이 기기에 연결했습니다.')
        setMessageIntent('success')
      }
      return saved
    } catch (error) {
      showError(error, '매크로를 저장하지 못했습니다.', setMessage, setMessageIntent)
      return null
    } finally {
      setBusy(false)
    }
  }

  const command = async (
    name: 'start' | 'pause' | 'resume' | 'step' | 'stop' | 'reset',
    inputVariables?: Record<string, JsonValue>,
  ): Promise<boolean> => {
    if ((name === 'start' || name === 'step') && !definition) return false
    setBusy(true)
    setMessage(null)
    try {
      if ((name === 'start' || name === 'step') && (dirty || isNew) && !(await save())) return false
      if ((name === 'start' || name === 'step') && !(await validate(false))) return false
      if (name === 'start' || name === 'step') {
        if (!definitionForSave) return false
        await macroEditorApi.bind(deviceId, definitionForSave.id)
        setBoundMacroId(definitionForSave.id)
      }
      await macroEditorApi.command(
        deviceId,
        name,
        name === 'start' ? { variables: inputVariables ?? {} } : undefined,
      )
      await runtime.refresh()
      return true
    } catch (error) {
      showError(error, '매크로 명령을 실행하지 못했습니다.', setMessage, setMessageIntent)
      return false
    } finally {
      setBusy(false)
    }
  }

  const discardOrRun = (action: () => void | Promise<void>) => {
    if (!(dirty || isNew)) {
      void action()
      return
    }
    setConfirmDialog({
      title: '변경사항 버리기',
      description: '저장하지 않은 매크로 변경 사항을 버릴까요?',
      confirmLabel: '버리기',
      danger: true,
      onConfirm: action,
    })
  }

  const selectMacroNow = async (macroId: string) => {
    setBusy(true)
    try {
      if (!macroId) {
        await macroEditorApi.unbind(deviceId)
        setBoundMacroId(null)
        clearDeviceDraft(deviceId)
        setDefinition(null)
        setNodes([])
        setEdges([])
        setNodeScreens({})
        setFunctionFlows({})
        graphViewStates.current = {}
        setGraphNavigationStack([])
        setActiveFunctionId(null)
        setSelectedVariableName('')
        setSelectedNodeId(null)
      } else {
        await macroEditorApi.bind(deviceId, macroId)
        setBoundMacroId(macroId)
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
    discardOrRun(() => setNameDialog({ kind: 'macro-create', initialValue: '새 매크로' }))
  }

  const createNewNamed = async (name: string) => {
    const suffix = Date.now().toString(36)
    setBusy(true)
    setMessage(null)
    try {
      const created = await macroEditorApi.create(
        createEmptyMacroDefinition(`macro-${suffix}`, name),
      )
      await macroEditorApi.bind(deviceId, created.id)
      setDefinitions((current) => [...current, created])
      setBoundMacroId(created.id)
      clearDeviceDraft(deviceId)
      loadDefinition(created)
      setPanelTab('canvas')
      setMessage(`${created.name} 매크로를 만들었습니다.`)
      setMessageIntent('success')
    } catch (error) {
      showError(error, '매크로를 만들지 못했습니다.', setMessage, setMessageIntent)
    } finally {
      setBusy(false)
    }
  }

  const renameMacro = (macro: MacroDefinition) => {
    setNameDialog({ kind: 'macro-rename', initialValue: macro.name, macro })
  }

  const renameMacroNamed = async (macro: MacroDefinition, name: string) => {
    if (name === macro.name) {
      setNameDialog(null)
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const saved = await macroEditorApi.save({ ...macro, name })
      setDefinitions((current) => current.map((item) => item.id === saved.id ? saved : item))
      if (definition?.id === saved.id) {
        if (dirty) {
          setDefinition((current) => current ? { ...current, name: saved.name, version: saved.version } : current)
        } else {
          loadDefinition(saved)
        }
      }
      setMessage(`${macro.name}의 이름을 ${saved.name}(으)로 변경했습니다.`)
      setMessageIntent('success')
    } catch (error) {
      showError(error, '매크로 이름을 변경하지 못했습니다.', setMessage, setMessageIntent)
    } finally {
      setBusy(false)
    }
  }

  const duplicateMacro = async (macro: MacroDefinition) => {
    setBusy(true)
    setMessage(null)
    try {
      const copy = await macroEditorApi.duplicate(macro.id, {
        name: `${macro.name} 복사본`,
      })
      setDefinitions((current) => [...current, copy])
      setMessage(`${macro.name} 매크로를 복제했습니다.`)
      setMessageIntent('success')
    } catch (error) {
      showError(error, '매크로를 복제하지 못했습니다.', setMessage, setMessageIntent)
    } finally {
      setBusy(false)
    }
  }

  const deleteMacro = (macro: MacroDefinition) => {
    const isRuntimeMacro = runtime.runtime?.macro_definition_id === macro.id
    if (isRuntimeMacro && runtimeActive) {
      setMessage('실행 중인 매크로는 삭제할 수 없습니다. 먼저 중지하세요.')
      setMessageIntent('warning')
      return
    }
    setConfirmDialog({
      title: '매크로 삭제',
      description: `${macro.name} 매크로를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
      confirmLabel: '삭제',
      danger: true,
      onConfirm: () => deleteMacroNow(macro),
    })
  }

  const deleteMacroNow = async (macro: MacroDefinition) => {
    setBusy(true)
    setMessage(null)
    let releasedCurrentBinding = false
    try {
      if (boundMacroId === macro.id) {
        await macroEditorApi.unbind(deviceId)
        setBoundMacroId(null)
        releasedCurrentBinding = true
      }
      await macroEditorApi.delete(macro.id)
      setDefinitions((current) => current.filter((item) => item.id !== macro.id))
      if (definition?.id === macro.id) {
        clearDeviceDraft(deviceId)
        setDefinition(null)
        setNodes([])
        setEdges([])
        setNodeScreens({})
        setFunctionFlows({})
        graphViewStates.current = {}
        setGraphNavigationStack([])
        setActiveFunctionId(null)
        setSelectedVariableName('')
        setSelectedNodeId(null)
      }
      setMessage(`${macro.name} 매크로를 삭제했습니다.`)
      setMessageIntent('success')
    } catch (error) {
      if (releasedCurrentBinding) {
        try {
          await macroEditorApi.bind(deviceId, macro.id)
          setBoundMacroId(macro.id)
        } catch {
          // Keep the original deletion error as the actionable message.
        }
      }
      showError(error, '매크로를 삭제하지 못했습니다.', setMessage, setMessageIntent)
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
    const fallbackName = `Function ${index}`
    setNameDialog({ kind: 'function-create', initialValue: fallbackName })
  }

  const createFunctionNamed = (requestedName: string) => {
    if (!definition) return
    const index = (definition.functions?.length ?? 0) + 1
    const id = uniqueFunctionId(`function-${index}`, definition.functions ?? [])
    const item = createFunctionDefinition(id, requestedName)
    setDefinition({ ...definition, functions: [...(definition.functions ?? []), item] })
    setFunctionFlows((current) => ({ ...current, [id]: macroFunctionToFlow(item) }))
    enterFunctionGraph(id)
    markChanged()
  }

  const renameFunction = (functionId = activeFunctionId) => {
    if (!definition || !functionId) return
    const current = definition.functions?.find((item) => item.id === functionId)
    if (!current) return
    setNameDialog({
      kind: 'function-rename',
      initialValue: current.name,
      functionId,
    })
  }

  const deleteFunction = (functionId = activeFunctionId) => {
    if (!definition || !functionId) return
    const references = countFunctionReferences(functionId, nodes, functionFlows)
    const current = definition.functions?.find((item) => item.id === functionId)
    setConfirmDialog({
      title: '함수 삭제',
      description: references > 0
        ? `${current?.name ?? '이 함수'}는 함수 호출 노드 ${references}개에서 사용 중입니다. 삭제하면 참조 노드도 더 이상 유효하지 않습니다.`
        : `${current?.name ?? '이 함수'}를 삭제하시겠습니까?`,
      confirmLabel: '삭제',
      danger: true,
      onConfirm: () => deleteFunctionNow(functionId),
    })
  }

  const deleteFunctionNow = (functionId: string) => {
    if (!definition) return
    const pathIndex = graphNavigationStack.indexOf(functionId)
    if (pathIndex >= 0) {
      const nextPath = pathIndex === graphNavigationStack.length - 1
        ? []
        : graphNavigationStack.slice(0, pathIndex)
      navigateToGraphPath(nextPath)
    }
    setDefinition({
      ...definition,
      functions: (definition.functions ?? []).filter((item) => item.id !== functionId),
    })
    setFunctionFlows((current) => {
      const next = { ...current }
      delete next[functionId]
      return next
    })
    delete graphViewStates.current[functionId]
    if (selectedBlueprint?.kind === 'function' && selectedBlueprint.id === functionId) {
      setSelectedBlueprint(null)
    }
    markChanged()
  }

  const duplicateFunction = (functionId: string) => {
    if (!definition) return
    const source = definition.functions?.find((item) => item.id === functionId)
    if (!source) return
    const liveSource = functionFlows[functionId]
      ? flowToMacroFunction(source, functionFlows[functionId].nodes, functionFlows[functionId].edges)
      : source
    const id = uniqueFunctionId(`${source.id}-copy`, definition.functions ?? [])
    const copy = duplicateFunctionDefinition(liveSource, id, `${source.name} 복사본`)
    setDefinition({ ...definition, functions: [...(definition.functions ?? []), copy] })
    setFunctionFlows((current) => ({ ...current, [copy.id]: macroFunctionToFlow(copy) }))
    setSelectedBlueprint({ kind: 'function', id: copy.id })
    markChanged()
  }

  const updateFunctionPorts = (
    functionId: string,
    kind: 'inputs' | 'outputs',
    ports: MacroFunctionPort[],
  ) => {
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
    const updatedDefinition = synchronizeFunctionCalls({ ...definition, functions })
    setDefinition(updatedDefinition)
    setNodes((current) => synchronizeFlowFunctionCalls({ nodes: current, edges: [] }, functions).nodes)
    setFunctionFlows((current) => Object.fromEntries(functions.map((item) => {
      const flow = current[item.id] ?? macroFunctionToFlow(item)
      const next = synchronizeFlowFunctionCalls(flow, functions)
      if (item.id === functionId) {
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
    setVariableDialog({ mode: 'create' })
  }

  const editVariable = (variableName = selectedVariableName) => {
    if (!definition || !variableName) return
    const current = definition.variables?.find((item) => item.name === variableName)
    if (!current) return
    setVariableDialog({ mode: 'edit', variable: current })
  }

  const deleteVariable = (variableName = selectedVariableName) => {
    if (!definition || !variableName) return
    const references = countVariableReferences(variableName, nodes, functionFlows)
    setConfirmDialog({
      title: '변수 삭제',
      description: references > 0
        ? `변수 ${variableName}는 변수 설정/가져오기 노드 ${references}개에서 사용 중입니다. 삭제하면 참조 노드도 더 이상 유효하지 않습니다.`
        : `변수 ${variableName}를 삭제하시겠습니까?`,
      confirmLabel: '삭제',
      danger: true,
      onConfirm: () => deleteVariableNow(variableName),
    })
  }

  const deleteVariableNow = (variableName: string) => {
    if (!definition) return
    setDefinition({
      ...definition,
      variables: (definition.variables ?? []).filter((item) => item.name !== variableName),
    })
    if (selectedVariableName === variableName) setSelectedVariableName('')
    if (selectedBlueprint?.kind === 'variable' && selectedBlueprint.id === variableName) {
      setSelectedBlueprint(null)
    }
    markChanged()
  }

  const updateFunctionName = (functionId: string, name: string) => {
    if (!definition || !name) return
    const functions = (definition.functions ?? []).map((item) => item.id === functionId
      ? renameFunctionDefinition(item, name)
      : item)
    setDefinition(synchronizeFunctionCalls({ ...definition, functions }))
    setNodes((current) => synchronizeFlowFunctionCalls({ nodes: current, edges: [] }, functions).nodes)
    setFunctionFlows((current) => Object.fromEntries(functions.map((item) => {
      const flow = current[item.id] ?? macroFunctionToFlow(item)
      const synchronized = synchronizeFlowFunctionCalls(flow, functions)
      return [item.id, item.id === functionId ? {
        ...synchronized,
        nodes: synchronized.nodes.map((node) => node.id === item.entry_node_id
          ? { ...node, data: { ...node.data, label: `${name} / 시작`, definitionLabel: `${name} / 시작` } }
          : node.id === item.return_node_id
            ? { ...node, data: { ...node.data, label: `${name} / 반환`, definitionLabel: `${name} / 반환` } }
            : node),
      } : synchronized]
    })))
    markChanged()
  }

  const toggleVariableInput = (variableName = selectedVariableName) => {
    if (!definition || !variableName) return
    setDefinition({
      ...definition,
      variables: (definition.variables ?? []).map((item) => item.name === variableName
        ? { ...item, input: item.input !== true }
        : item),
    })
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

  const submitVariableDialog = (variable: MacroVariableDefinition) => {
    if (!definition || !variableDialog) return
    if (variableDialog.mode === 'edit') {
      updateVariableDefinition(variableDialog.variable.name, variable)
      setSelectedVariableName(variable.name)
      setSelectedBlueprint({ kind: 'variable', id: variable.name })
      setVariableDialog(null)
      return
    }

    setDefinition(synchronizeVariableNodes({
      ...definition,
      variables: [...(definition.variables ?? []), variable],
    }))
    setSelectedVariableName(variable.name)
    setSelectedBlueprint({ kind: 'variable', id: variable.name })
    markChanged()

    if (variableDialog.mode === 'promote') {
      const { port, position } = variableDialog
      const mode = port.direction === 'input' ? 'get' : 'set'
      const nodeType = mode === 'get' ? 'get_variable' : 'set_variable'
      const created = addNode(
        nodeType,
        position,
        variableNodeConfig(nodeType, variable),
        variableNodeLabel(mode, variable.name),
      )
      if (created) {
        addConnection(port.direction === 'input' ? {
          source: created.id,
          sourceHandle: 'value',
          target: port.nodeId,
          targetHandle: port.portId,
        } : {
          source: port.nodeId,
          sourceHandle: port.portId,
          target: created.id,
          targetHandle: 'value',
        }, 'data')
      }
    }
    setVariableDialog(null)
  }

  const submitNameDialog = async (name: string) => {
    if (!nameDialog) return
    if (nameDialog.kind === 'macro-create') await createNewNamed(name)
    else if (nameDialog.kind === 'macro-rename') await renameMacroNamed(nameDialog.macro, name)
    else if (nameDialog.kind === 'function-create') createFunctionNamed(name)
    else updateFunctionName(nameDialog.functionId, name)
    setNameDialog(null)
  }

  const state = runtime.runtime?.state ?? 'idle'
  const runtimeActive = state === 'running' || state === 'paused'

  const runMacro = async (
    macro: MacroDefinition,
    inputVariables: Record<string, JsonValue>,
  ): Promise<boolean> => {
    if (runtimeActive) return false
    if (macro.id === definition?.id && (dirty || isNew)) {
      return command('start', inputVariables)
    }
    if (dirty || isNew) {
      setConfirmDialog({
        title: '변경사항 버리기',
        description: '저장하지 않은 매크로 변경 사항을 버리고 다른 매크로를 실행할까요?',
        confirmLabel: '버리고 실행',
        danger: true,
        onConfirm: async () => {
          const started = await runMacroNow(macro, inputVariables)
          if (started) setRunSetupMacro(null)
        },
      })
      return false
    }
    return runMacroNow(macro, inputVariables)
  }

  const runMacroNow = async (
    macro: MacroDefinition,
    inputVariables: Record<string, JsonValue>,
  ): Promise<boolean> => {
    if (!(await validateDefinition(macro, false))) return false
    setBusy(true)
    setMessage(null)
    try {
      await macroEditorApi.bind(deviceId, macro.id)
      setBoundMacroId(macro.id)
      clearDeviceDraft(deviceId)
      loadDefinition(macro)
      await macroEditorApi.command(deviceId, 'start', { variables: inputVariables })
      await runtime.refresh()
      return true
    } catch (error) {
      showError(error, '매크로를 실행하지 못했습니다.', setMessage, setMessageIntent)
      return false
    } finally {
      setBusy(false)
    }
  }

  const editMacro = (macro: MacroDefinition) => {
    discardOrRun(async () => {
      setCanvasExpansion(false)
      await selectMacroNow(macro.id)
      setPanelTab('canvas')
    })
  }

  return (
    <section className={`integrated-macro-panel${canvasExpanded ? ' is-canvas-expanded' : ''}`} aria-label={ko.panels.macroCanvas} data-editor-pane="macro">
      <header className="integrated-macro-toolbar">
        <div className="integrated-macro-toolbar__selectors">
          <strong title={panelTab === 'canvas' ? definition?.name : undefined}>
            {panelTab === 'execution' ? '매크로 실행' : definition?.name ?? ko.panels.macroCanvas}
          </strong>
          <Tag minimal title={deviceId}>
            기기 · {deviceId.length > 18 ? `${deviceId.slice(0, 18)}…` : deviceId}
          </Tag>
          {panelTab === 'canvas' && <select
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
          </select>}
          {panelTab === 'canvas' && (
            <>
              <Tag intent={dirty ? 'warning' : 'success'} minimal>
                {dirty ? '저장 안 됨' : '저장됨'}
              </Tag>
              <MacroValidationTag
                status={validationState.status}
                errorCount={validationState.errorCount}
              />
            </>
          )}
        </div>
        <div className="integrated-macro-tabs" role="tablist" aria-label="매크로 작업 모드">
          <Button
            minimal
            small
            role="tab"
            aria-selected={panelTab === 'execution'}
            active={panelTab === 'execution'}
            text="실행"
            onClick={() => {
              setRuntimeDetailOpen(false)
              setPanelTab('execution')
            }}
          />
          <Button
            minimal
            small
            role="tab"
            aria-selected={panelTab === 'canvas'}
            active={panelTab === 'canvas'}
            text="캔버스"
            onClick={() => setPanelTab('canvas')}
          />
        </div>
        {panelTab === 'canvas' ? (
          <ButtonGroup className="integrated-macro-toolbar__actions" minimal>
            <Button small disabled={!definition || busy} onClick={() => void validate()}>{ko.actions.validate}</Button>
            <Button small disabled={!definition} onClick={() => void flowRef.current?.fitView({ duration: 200, padding: 0.2 })}>{ko.actions.fitView}</Button>
            <Button small intent="primary" disabled={!definition || busy} onClick={() => void save()}>{ko.actions.save}</Button>
            <Button
              small
              icon="maximize"
              disabled={!definition}
              title="매크로 캔버스 확대"
              onClick={() => setCanvasExpansion(true)}
            >
              확대
            </Button>
            <select
              aria-label="매크로 그래프"
              value={activeFunctionId ?? '__main__'}
              disabled={!definition}
              onChange={(event) => {
                const functionId = event.target.value === '__main__' ? null : event.target.value
                navigateToGraphPath(functionId ? [functionId] : [])
              }}
            >
              <option value="__main__">메인</option>
              {(definition?.functions ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </ButtonGroup>
        ) : (
          <ButtonGroup className="integrated-macro-toolbar__actions" minimal>
            <Button small intent="primary" icon="plus" disabled={busy} onClick={() => void createNew()}>새 매크로</Button>
          </ButtonGroup>
        )}
      </header>
      {message && <Callout className="integrated-macro-message" compact intent={messageIntent}>{message}</Callout>}
      {canvasExpanded && (
        <>
          <div className="macro-canvas-expanded-backdrop" aria-hidden="true" />
          <section
            className="macro-canvas-expanded-shell"
            role="dialog"
            aria-modal="true"
            aria-label="매크로 캔버스 확대"
            aria-owns="integrated-macro-editor"
          >
            <header>
              <div className="macro-canvas-expanded-shell__identity">
                <strong>{definition?.name ?? ko.panels.macroCanvas}</strong>
                <Tag intent={dirty ? 'warning' : 'success'} minimal>
                  {dirty ? '저장 안 됨' : '저장됨'}
                </Tag>
                <MacroValidationTag
                  status={validationState.status}
                  errorCount={validationState.errorCount}
                />
              </div>
              <select
                aria-label="확대 화면 매크로 화면"
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
              <span />
              <Button small disabled={!definition || busy} onClick={() => void validate()}>{ko.actions.validate}</Button>
              <Button small disabled={!definition} onClick={() => void flowRef.current?.fitView({ duration: 200, padding: 0.2 })}>{ko.actions.fitView}</Button>
              <Button small intent="primary" disabled={!definition || busy} onClick={() => void save()}>{ko.actions.save}</Button>
              <Button
                minimal
                icon="cross"
                aria-label="확대 화면 닫기"
                title="닫기"
                onClick={() => setCanvasExpansion(false)}
              />
            </header>
          </section>
        </>
      )}
      <div className="integrated-macro-content">
        {panelTab === 'canvas' && runtimeActive && (
          <Callout className="integrated-macro-running-notice" compact intent="warning">
            실행 중 - 현재 실행에는 저장 후 변경사항이 반영되지 않습니다.
          </Callout>
        )}
        <div
          id="integrated-macro-editor"
          ref={editorRef}
          className={`integrated-macro-editor${panelTab === 'canvas' ? '' : ' is-tab-hidden'}${canvasExpanded ? ' is-expanded' : ''}`}
          aria-hidden={panelTab !== 'canvas'}
          style={canvasExpanded ? {
            gridTemplateColumns: `${expandedPaletteWidth}px 8px minmax(0, 1fr) 8px ${expandedInspectorWidth}px`,
          } : undefined}
        >
          <nav className="macro-graph-breadcrumb" aria-label="매크로 그래프 경로">
            {graphNavigationStack.length === 0 ? (
              <span className="macro-graph-breadcrumb__item is-current" aria-current="page" title="Main">Main</span>
            ) : (
              <button type="button" className="macro-graph-breadcrumb__item" title="Main" onClick={() => navigateToGraphPath([])}>Main</button>
            )}
            {graphNavigationStack.map((functionId, index) => {
              const label = definition?.functions?.find((item) => item.id === functionId)?.name ?? functionId
              const current = index === graphNavigationStack.length - 1
              return (
                <span className="macro-graph-breadcrumb__segment" key={functionId}>
                  <span className="macro-graph-breadcrumb__separator" aria-hidden="true">›</span>
                  {current ? (
                    <span className="macro-graph-breadcrumb__item is-current" aria-current="page" title={label}>{label}</span>
                  ) : (
                    <button
                      type="button"
                      className="macro-graph-breadcrumb__item"
                      title={label}
                      onClick={() => navigateToGraphPath(graphNavigationStack.slice(0, index + 1))}
                    >{label}</button>
                  )}
                </span>
              )
            })}
          </nav>
          <div className="macro-sidebar">
            <div className="macro-sidebar__tabs" role="tablist" aria-label="캔버스 탐색기">
              <button type="button" role="tab" aria-selected={sidebarTab === 'blueprint'} onClick={() => setSidebarTab('blueprint')}>My Blueprint</button>
              <button type="button" role="tab" aria-selected={sidebarTab === 'blocks'} onClick={() => setSidebarTab('blocks')}>Blocks</button>
            </div>
            <div hidden={sidebarTab !== 'blueprint'} className="macro-sidebar__panel">
              <MyBlueprintPanel
                variables={definition?.variables ?? []}
                functions={definition?.functions ?? []}
                selection={selectedBlueprint}
                onSelect={(selection) => {
                  setSelectedBlueprint(selection)
                  setSelectedNodeId(null)
                  if (selection.kind === 'variable') setSelectedVariableName(selection.id)
                }}
                onOpenFunction={enterFunctionGraph}
                onAddVariable={addVariable}
                onEditVariable={editVariable}
                onDeleteVariable={deleteVariable}
                onCreateVariableNode={(variableName, mode) => {
                  const variable = definition?.variables?.find((item) => item.name === variableName)
                  if (!variable) return
                  const type = mode === 'get' ? 'get_variable' : 'set_variable'
                  addNode(type, undefined, variableNodeConfig(type, variable), variableNodeLabel(mode, variable.name))
                }}
                onToggleVariableInput={toggleVariableInput}
                onAddFunction={createFunction}
                onRenameFunction={renameFunction}
                onDuplicateFunction={duplicateFunction}
                onDeleteFunction={deleteFunction}
              />
            </div>
            <div hidden={sidebarTab !== 'blocks'} className="macro-sidebar__panel">
              <BlockPalette onAdd={(type) => addNode(type)} />
            </div>
          </div>
          {canvasExpanded && (
            <div
              className="macro-canvas-expanded-splitter is-palette-splitter"
              role="separator"
              aria-label="블록과 캔버스 크기 조절"
              aria-orientation="vertical"
              onPointerDown={(event) => beginExpandedResize('palette', event)}
              onDoubleClick={() => setExpandedPaletteWidth(EXPANDED_PALETTE_WIDTH)}
            />
          )}
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
            onConnect={addConnection}
            onSelectNode={(nodeId) => {
              setSelectedNodeId(nodeId)
              if (nodeId) setSelectedBlueprint(null)
            }}
            onDropBlock={(type, position) => addNode(type, position)}
            onDropBlueprintItem={dropBlueprintItem}
            onPromoteToVariable={promoteToVariable}
            quickSearchBlocks={quickSearchBlocks}
            onDropQuickBlock={(block, position) => addNode(
              block.type,
              position,
              block.presetConfig,
              block.presetLabel,
            )}
            variables={definition.variables ?? []}
            onUpdateNodeConfig={(nodeId, config) => {
              updateSelectedFlowNode(activeFunctionId, nodeId, setNodes, setFunctionFlows, (node) => ({
                ...node, data: { ...node.data, config },
              }))
              markChanged()
            }}
            dialogOpen={editorDialogOpen}
            onReady={(instance) => { flowRef.current = instance }}
            />
          ) : (
            <div className="integrated-macro-empty">
              <strong>선택된 매크로가 없습니다</strong>
              <span>새 매크로를 만들거나 초안을 불러오거나 기존 매크로를 선택하세요.</span>
            </div>
          )}
          {canvasExpanded && (
            <div
              className="macro-canvas-expanded-splitter is-inspector-splitter"
              role="separator"
              aria-label="캔버스와 인스펙터 크기 조절"
              aria-orientation="vertical"
              onPointerDown={(event) => beginExpandedResize('inspector', event)}
              onDoubleClick={() => setExpandedInspectorWidth(EXPANDED_INSPECTOR_WIDTH)}
            />
          )}
          {selectedBlueprint ? (
            <BlueprintInspector
              selection={selectedBlueprint}
              variable={selectedBlueprint.kind === 'variable'
                ? definition?.variables?.find((item) => item.name === selectedBlueprint.id)
                : undefined}
              functionDefinition={selectedBlueprint.kind === 'function'
                ? definition?.functions?.find((item) => item.id === selectedBlueprint.id)
                : undefined}
              onEditVariable={editVariable}
              onDeleteVariable={deleteVariable}
              onRenameFunction={renameFunction}
              onUpdateFunctionPorts={updateFunctionPorts}
              onOpenFunction={enterFunctionGraph}
              onDeleteFunction={deleteFunction}
            />
          ) : <NodeInspector
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
          />}
        </div>
        {panelTab === 'execution' && (
          runtimeDetailOpen ? (
            <MacroRuntimeDetail
              macro={definitions.find((item) => item.id === runtime.runtime?.macro_definition_id)}
              deviceId={deviceId}
              runtime={runtime}
              state={state}
              busy={busy}
              onBack={() => setRuntimeDetailOpen(false)}
              onPause={() => void command('pause')}
              onResume={() => void command('resume')}
              onStep={() => void command('step')}
              onStop={() => void command('stop')}
              onReset={() => void command('reset')}
            />
          ) : (
            <MacroExecutionPanel
              definitions={definitions}
              deviceId={deviceId}
              boundMacroId={boundMacroId}
              runtime={runtime}
              busy={busy}
              onRun={setRunSetupMacro}
              onPause={() => void command('pause')}
              onResume={() => void command('resume')}
              onStop={() => void command('stop')}
              onDetail={() => setRuntimeDetailOpen(true)}
              onEdit={(macro) => void editMacro(macro)}
              onRename={(macro) => void renameMacro(macro)}
              onDuplicate={(macro) => void duplicateMacro(macro)}
              onDelete={(macro) => void deleteMacro(macro)}
              onCreate={() => void createNew()}
            />
          )
        )}
      </div>
      {runSetupMacro && (
        <MacroRunDialog
          key={runSetupMacro.id}
          macro={runSetupMacro}
          deviceId={deviceId}
          busy={busy}
          onCancel={() => setRunSetupMacro(null)}
          onRun={async (inputVariables) => {
            const started = await runMacro(runSetupMacro, inputVariables)
            if (started) setRunSetupMacro(null)
            return started
          }}
        />
      )}
      {variableDialog && definition && (
        <VariableEditorDialog
          key={variableDialog.mode === 'edit' ? `edit-${variableDialog.variable.name}` : variableDialog.mode}
          title={variableDialog.mode === 'edit'
            ? '변수 편집'
            : variableDialog.mode === 'promote' ? '변수로 승격' : '변수 추가'}
          submitLabel={variableDialog.mode === 'edit' ? '저장' : '추가'}
          initial={variableDialog.mode === 'edit' ? variableDialog.variable : undefined}
          suggestedName={variableDialog.mode === 'promote' ? variableDialog.suggestedName : undefined}
          suggestedType={variableDialog.mode === 'promote' ? variableDialog.suggestedType : undefined}
          existingNames={(definition.variables ?? [])
            .filter((item) => variableDialog.mode !== 'edit' || item.name !== variableDialog.variable.name)
            .map((item) => item.name)}
          onCancel={() => setVariableDialog(null)}
          onSubmit={submitVariableDialog}
        />
      )}
      {nameDialog && (
        <NameEditorDialog
          key={`${nameDialog.kind}-${nameDialog.initialValue}`}
          title={nameDialog.kind === 'macro-create'
            ? '새 매크로'
            : nameDialog.kind === 'macro-rename'
              ? '매크로 이름 변경'
              : nameDialog.kind === 'function-create' ? '새 함수' : '함수 이름 변경'}
          label={nameDialog.kind.startsWith('macro') ? '매크로 이름' : '함수 이름'}
          initialValue={nameDialog.initialValue}
          submitLabel={nameDialog.kind.endsWith('create') ? '생성' : '저장'}
          existingNames={nameDialog.kind.startsWith('macro')
            ? definitions
                .filter((item) => nameDialog.kind !== 'macro-rename' || item.id !== nameDialog.macro.id)
                .map((item) => item.name)
            : (definition?.functions ?? [])
                .filter((item) => nameDialog.kind !== 'function-rename' || item.id !== nameDialog.functionId)
                .map((item) => item.name)}
          busy={busy}
          onCancel={() => setNameDialog(null)}
          onSubmit={submitNameDialog}
        />
      )}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          danger={confirmDialog.danger}
          busy={busy}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={async () => {
            const action = confirmDialog.onConfirm
            setConfirmDialog(null)
            await action()
          }}
        />
      )}
    </section>
  )
})

type RuntimeInputDraft = string | boolean

function MacroRunDialog({
  macro,
  deviceId,
  busy,
  onCancel,
  onRun,
}: {
  macro: MacroDefinition
  deviceId: string
  busy: boolean
  onCancel: () => void
  onRun: (variables: Record<string, JsonValue>) => Promise<boolean>
}) {
  const variables = (macro.variables ?? []).filter((variable) => variable.input === true)
  const defaults = () => Object.fromEntries(variables.map((variable) => [
    variable.name,
    runtimeInputDraft(variable),
  ])) as Record<string, RuntimeInputDraft>
  const [draft, setDraft] = useState<Record<string, RuntimeInputDraft>>(defaults)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = async () => {
    const nextErrors: Record<string, string> = {}
    const values: Record<string, JsonValue> = {}
    for (const variable of variables) {
      const result = parseRuntimeInput(variable, draft[variable.name])
      if (result.error) nextErrors[variable.name] = result.error
      else if (result.value !== undefined) values[variable.name] = result.value
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    await onRun(values)
  }

  return (
    <div className="macro-run-dialog-backdrop" role="presentation">
      <section
        className="macro-run-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="macro-run-dialog-title"
      >
        <header>
          <div>
            <h2 id="macro-run-dialog-title">매크로 실행</h2>
            <span>{macro.name}</span>
          </div>
          <Button minimal icon="cross" aria-label="실행 설정 닫기" disabled={busy} onClick={onCancel} />
        </header>
        <div className="macro-run-dialog__body">
          <dl className="macro-run-dialog__summary">
            <div><dt>매크로</dt><dd>{macro.name}</dd></div>
            <div><dt>대상 디바이스</dt><dd>{deviceId}</dd></div>
          </dl>
          <section className="macro-run-dialog__inputs" aria-label="실행 입력값">
            <div className="macro-run-dialog__section-heading">
              <strong>실행 입력값</strong>
              <Tag minimal>{variables.length}</Tag>
            </div>
            {variables.length === 0 ? (
              <p className="macro-run-dialog__empty">설정할 외부 입력 변수가 없습니다.</p>
            ) : variables.map((variable) => (
              <RuntimeInputField
                key={variable.name}
                variable={variable}
                value={draft[variable.name]}
                error={errors[variable.name]}
                disabled={busy}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, [variable.name]: value }))
                  setErrors((current) => {
                    const next = { ...current }
                    delete next[variable.name]
                    return next
                  })
                }}
              />
            ))}
          </section>
        </div>
        <footer>
          {variables.length > 0 && (
            <Button minimal disabled={busy} onClick={() => {
              setDraft(defaults())
              setErrors({})
            }}>
              기본값으로 초기화
            </Button>
          )}
          <span />
          <Button disabled={busy} onClick={onCancel}>취소</Button>
          <Button intent="success" loading={busy} onClick={() => void submit()}>실행</Button>
        </footer>
      </section>
    </div>
  )
}

function RuntimeInputField({
  variable,
  value,
  error,
  disabled,
  onChange,
}: {
  variable: MacroVariableDefinition
  value: RuntimeInputDraft | undefined
  error?: string
  disabled: boolean
  onChange: (value: RuntimeInputDraft) => void
}) {
  const inputId = `macro-run-input-${variable.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const optionValues = variable.options?.map((option) => JSON.stringify(option)) ?? []
  return (
    <label className={`macro-run-field${error ? ' has-error' : ''}`} htmlFor={inputId}>
      <span className="macro-run-field__label">
        <strong>{variable.name}</strong>
        <code>{variable.type}</code>
      </span>
      {variable.description && <small>{variable.description}</small>}
      {optionValues.length > 0 ? (
        <select
          id={inputId}
          disabled={disabled}
          value={typeof value === 'string' ? value : JSON.stringify(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          {variable.options?.map((option, index) => (
            <option key={optionValues[index]} value={optionValues[index]}>
              {formatRuntimeValue(option)}
            </option>
          ))}
        </select>
      ) : variable.type === 'bool' ? (
        <input
          id={inputId}
          type="checkbox"
          disabled={disabled}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : variable.type === 'int' || variable.type === 'float' ? (
        <input
          id={inputId}
          type="number"
          step={variable.type === 'int' ? 1 : 'any'}
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : variable.type === 'string' ? (
        <input
          id={inputId}
          type="text"
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <textarea
          id={inputId}
          rows={4}
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          placeholder={runtimeInputPlaceholder(variable.type)}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <span className="macro-run-field__default">
        기본값: {variable.default === undefined ? '없음' : formatRuntimeValue(variable.default)}
      </span>
      {error && <span className="macro-run-field__error" role="alert">{error}</span>}
    </label>
  )
}

function runtimeInputDraft(variable: MacroVariableDefinition): RuntimeInputDraft {
  const value = variable.default
  if (variable.options?.length) return JSON.stringify(value ?? variable.options[0])
  if (variable.type === 'bool') return value === true
  if (variable.type === 'string') return typeof value === 'string' ? value : ''
  if (variable.type === 'int' || variable.type === 'float') {
    return typeof value === 'number' ? String(value) : ''
  }
  return value === undefined || value === null ? '' : JSON.stringify(value, null, 2)
}

function parseRuntimeInput(
  variable: MacroVariableDefinition,
  draft: RuntimeInputDraft | undefined,
): { value?: JsonValue; error?: string } {
  let value: JsonValue
  if (variable.options?.length) {
    try {
      value = JSON.parse(typeof draft === 'string' ? draft : '') as JsonValue
    } catch {
      return { error: '허용된 값을 선택하세요.' }
    }
    if (!variable.options.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
      return { error: '허용된 값을 선택하세요.' }
    }
  } else if (variable.type === 'bool') {
    if (typeof draft !== 'boolean') return { error: '체크 여부를 선택하세요.' }
    value = draft
  } else if (variable.type === 'string') {
    if (typeof draft !== 'string') return { error: '문자열을 입력하세요.' }
    value = draft
  } else if (variable.type === 'int' || variable.type === 'float') {
    if (typeof draft !== 'string' || draft.trim() === '') return { error: '숫자를 입력하세요.' }
    const number = Number(draft)
    if (!Number.isFinite(number) || (variable.type === 'int' && !Number.isInteger(number))) {
      return { error: variable.type === 'int' ? '정수를 입력하세요.' : '유한한 숫자를 입력하세요.' }
    }
    value = number
  } else {
    try {
      value = JSON.parse(typeof draft === 'string' ? draft : '') as JsonValue
    } catch {
      return { error: '올바른 JSON 객체를 입력하세요.' }
    }
    if (!runtimeObjectMatchesType(value, variable.type)) {
      return { error: `${variable.type} 형식에 맞는 JSON 객체를 입력하세요.` }
    }
  }
  return { value }
}

function runtimeObjectMatchesType(value: JsonValue, type: MacroVariableDefinition['type']): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const numeric = (source: Record<string, JsonValue>, keys: string[]) => keys.every(
    (key) => typeof source[key] === 'number' && Number.isFinite(source[key]),
  )
  if (type === 'position') return numeric(value, ['x', 'y'])
  if (type === 'rect') return numeric(value, ['left', 'top', 'right', 'bottom'])
  if (type === 'element') {
    const bounds = value.bounds
    return typeof value.id === 'string'
      && bounds !== null
      && typeof bounds === 'object'
      && !Array.isArray(bounds)
      && numeric(bounds, ['left', 'top', 'right', 'bottom'])
  }
  return false
}

function runtimeInputPlaceholder(type: MacroVariableDefinition['type']): string {
  if (type === 'position') return '{"x": 0, "y": 0}'
  if (type === 'rect') return '{"left": 0, "top": 0, "right": 100, "bottom": 100}'
  return '{"id": "element-id", "bounds": {"left": 0, "top": 0, "right": 100, "bottom": 100}}'
}

function MacroExecutionPanel({
  definitions,
  deviceId,
  boundMacroId,
  runtime,
  busy,
  onRun,
  onPause,
  onResume,
  onStop,
  onDetail,
  onEdit,
  onRename,
  onDuplicate,
  onDelete,
  onCreate,
}: {
  definitions: MacroDefinition[]
  deviceId: string
  boundMacroId: string | null
  runtime: ReturnType<typeof useMacroRuntime>
  busy: boolean
  onRun: (macro: MacroDefinition) => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onDetail: () => void
  onEdit: (macro: MacroDefinition) => void
  onRename: (macro: MacroDefinition) => void
  onDuplicate: (macro: MacroDefinition) => void
  onDelete: (macro: MacroDefinition) => void
  onCreate: () => void
}) {
  const snapshot = runtime.runtime

  return (
    <section className="integrated-macro-execution" aria-label="매크로 목록">
      {definitions.length === 0 ? (
        <div className="integrated-macro-execution__empty">
          <strong>등록된 매크로가 없습니다.</strong>
          <span>첫 매크로를 만들어 자동화 작업을 시작하세요.</span>
          <Button intent="primary" icon="plus" onClick={onCreate}>새 매크로 만들기</Button>
        </div>
      ) : (
        <div className="integrated-macro-list">
          {definitions.map((macro) => {
            const isRuntimeMacro = snapshot?.macro_definition_id === macro.id
            const hasRuntime = isRuntimeMacro && Boolean(snapshot?.runtime_id)
            const state = isRuntimeMacro ? snapshot.state : 'idle'
            const isRunning = state === 'running'
            const isPaused = state === 'paused'
            const isActive = isRunning || isPaused
            const currentNodeId = runtime.currentNodeId ?? snapshot?.current_node_id
            const currentNode = macro.nodes.find((node) => node.id === currentNodeId)
            const currentNodeLabel = currentNode
              ? currentNode.label ?? BLOCK_BY_TYPE.get(currentNode.type)?.label ?? currentNode.type
              : currentNodeId
            const description = macroDescription(macro)
            return (
              <article
                className={`integrated-macro-card${isActive ? ' is-active' : ''}${state === 'error' ? ' is-error' : ''}`}
                key={macro.id}
              >
                <div className="integrated-macro-card__main">
                  <div className="integrated-macro-card__title">
                    <strong>{macro.name}</strong>
                    {boundMacroId === macro.id && <Tag minimal intent="primary">연결됨</Tag>}
                  </div>
                  <p>{description}</p>
                  <div className="integrated-macro-card__meta">
                    <span className={`macro-status macro-status--${state}`}>
                      <i aria-hidden="true" />
                      {runtimeStateLabels[state] ?? state}
                    </span>
                    <span title={boundMacroId === macro.id ? deviceId : undefined}>
                      디바이스 · {boundMacroId === macro.id ? deviceId : '바인딩 없음'}
                    </span>
                  </div>
                  {isActive && (
                    <div className="integrated-macro-card__progress">
                      <span>현재 노드: <strong>{currentNodeLabel ?? '—'}</strong></span>
                      <span>Step: <strong>{snapshot?.step_count ?? 0}</strong></span>
                    </div>
                  )}
                  {state === 'error' && snapshot?.error && (
                    <div className="integrated-macro-card__error">{snapshot.error}</div>
                  )}
                </div>
                <div className="integrated-macro-card__actions">
                  <Button
                    small
                    icon="edit"
                    disabled={busy}
                    title="매크로 캔버스에서 편집"
                    onClick={() => onEdit(macro)}
                  >
                    편집
                  </Button>
                  {isRunning ? (
                    <Button small disabled={busy} onClick={onPause}>{ko.actions.pause}</Button>
                  ) : isPaused ? (
                    <Button small intent="success" disabled={busy} onClick={onResume}>{ko.actions.resume}</Button>
                  ) : (
                    <Button
                      small
                      icon="play"
                      intent="success"
                      disabled={busy || Boolean(snapshot && ['running', 'paused'].includes(snapshot.state))}
                      title="실행 설정 열기"
                      onClick={() => onRun(macro)}
                    >
                      {ko.actions.run}
                    </Button>
                  )}
                  {isActive && <Button small intent="danger" disabled={busy} onClick={onStop}>{ko.actions.stop}</Button>}
                  {hasRuntime && <Button small disabled={busy} onClick={onDetail}>상세</Button>}
                  <details className="integrated-macro-card__menu">
                    <summary aria-label={`${macro.name} 더보기`}>⋯</summary>
                    <div>
                      <button type="button" onClick={() => onRename(macro)}>이름 변경</button>
                      <button type="button" onClick={() => onDuplicate(macro)}>복제</button>
                      <button className="is-danger" type="button" onClick={() => onDelete(macro)}>삭제</button>
                    </div>
                  </details>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function MacroRuntimeDetail({
  macro,
  deviceId,
  runtime,
  state,
  busy,
  onBack,
  onPause,
  onResume,
  onStep,
  onStop,
  onReset,
}: {
  macro?: MacroDefinition
  deviceId: string
  runtime: ReturnType<typeof useMacroRuntime>
  state: string
  busy: boolean
  onBack: () => void
  onPause: () => void
  onResume: () => void
  onStep: () => void
  onStop: () => void
  onReset: () => void
}) {
  const [detailTab, setDetailTab] = useState<'variables' | 'trace'>('variables')
  const snapshot = runtime.runtime
  const variableEntries = Object.entries(snapshot?.variables ?? {})
  const trace = snapshot?.trace ?? []
  const activeScreen = snapshot?.active_screen_id
    ? screenLabel(snapshot.active_screen_id)
    : '—'
  const currentNodeId = runtime.currentNodeId ?? snapshot?.current_node_id
  const currentNode = macro?.nodes.find((node) => node.id === currentNodeId)
  const currentNodeLabel = currentNode
    ? currentNode.label ?? BLOCK_BY_TYPE.get(currentNode.type)?.label ?? currentNode.type
    : currentNodeId ?? '—'
  const variableTypes = new Map((macro?.variables ?? []).map((variable) => [
    variable.name,
    variable.type,
  ]))
  const isRunning = state === 'running'
  const isPaused = state === 'paused'
  const canReset = ['completed', 'stopped', 'error'].includes(state)

  return (
    <section className="integrated-macro-runtime" aria-label="매크로 실행 상세">
      <header className="integrated-macro-runtime__heading">
        <Button minimal small icon="arrow-left" onClick={onBack}>매크로 목록</Button>
        <div className="integrated-macro-runtime__identity">
          <strong>{macro?.name ?? snapshot?.macro_definition_id ?? '매크로'}</strong>
          <small>{deviceId} · {snapshot?.runtime_id ?? '활성 런타임 없음'}</small>
        </div>
        <Tag intent={state === 'running' ? 'success' : state === 'paused' ? 'warning' : 'none'}>
          {runtimeStateLabels[state] ?? state}
          {snapshot?.definition_version ? ` v${snapshot.definition_version}` : ''}
        </Tag>
      </header>
      <div className="integrated-macro-runtime__controls" aria-label="런타임 제어">
        {isRunning && <Button small disabled={busy} onClick={onPause}>{ko.actions.pause}</Button>}
        {isPaused && <Button small intent="success" disabled={busy} onClick={onResume}>{ko.actions.resume}</Button>}
        {isPaused && <Button small disabled={busy} onClick={onStep}>{ko.actions.step}</Button>}
        {(isRunning || isPaused) && (
          <Button small intent="danger" disabled={busy} onClick={onStop}>{ko.actions.stop}</Button>
        )}
        {canReset && <Button small disabled={busy} onClick={onReset}>{ko.actions.reset}</Button>}
      </div>
      <dl className="integrated-macro-runtime__summary">
        <div><dt>상태</dt><dd>{runtimeStateLabels[state] ?? state}</dd></div>
        <div><dt>시작 시각</dt><dd>{formatRuntimeTimestamp(snapshot?.started_at)}</dd></div>
        <div><dt>Current Screen</dt><dd>{activeScreen}</dd></div>
        <div><dt>Current Node</dt><dd>{currentNodeLabel}</dd></div>
        <div><dt>Step Count</dt><dd>{snapshot?.step_count ?? 0}</dd></div>
        <div className={`is-error${snapshot?.error ? ' has-error' : ''}`}>
          <dt>Error</dt><dd>{snapshot?.error ?? '—'}</dd>
        </div>
      </dl>
      <section className="integrated-macro-runtime__details">
        <div className="integrated-macro-runtime__tabs" role="tablist" aria-label="런타임 상세 데이터">
          <Button
            minimal
            small
            role="tab"
            active={detailTab === 'variables'}
            aria-selected={detailTab === 'variables'}
            onClick={() => setDetailTab('variables')}
          >
            변수 <Tag minimal>{variableEntries.length}</Tag>
          </Button>
          <Button
            minimal
            small
            role="tab"
            active={detailTab === 'trace'}
            aria-selected={detailTab === 'trace'}
            onClick={() => setDetailTab('trace')}
          >
            Trace <Tag minimal>{trace.length}</Tag>
          </Button>
        </div>
        <div className="integrated-macro-runtime__table-wrap" role="tabpanel">
          {detailTab === 'variables' ? (
            variableEntries.length > 0 ? (
              <table aria-label="런타임 변수">
                <thead><tr><th>변수명</th><th>타입</th><th>현재 값</th></tr></thead>
                <tbody>
                  {variableEntries.map(([name, value]) => (
                    <tr key={name}>
                      <td><strong>{name}</strong></td>
                      <td><code>{variableTypes.get(name) ?? runtimeValueType(value)}</code></td>
                      <td><code>{formatRuntimeValue(value)}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="integrated-macro-runtime__empty">런타임 변수가 없습니다.</div>
          ) : trace.length > 0 ? (
            <table aria-label="런타임 트레이스">
              <thead>
                <tr><th>Step</th><th>Node</th><th>상태</th><th>시작 시각</th><th>종료 시각</th><th>오류</th></tr>
              </thead>
              <tbody>
                {trace.map((entry, index) => {
                  const nodeId = runtimeTraceString(entry, 'node_id')
                  const traceNode = macro?.nodes.find((node) => node.id === nodeId)
                  const nodeLabel = traceNode
                    ? traceNode.label ?? BLOCK_BY_TYPE.get(traceNode.type)?.label ?? traceNode.type
                    : nodeId ?? '—'
                  const traceState = runtimeTraceString(entry, 'status')
                  return (
                    <tr key={`${nodeId ?? 'trace'}-${index}`}>
                      <td>{index + 1}</td>
                      <td><strong>{nodeLabel}</strong>{nodeId && <small>{nodeId}</small>}</td>
                      <td>{traceState ? runtimeStateLabels[traceState] ?? traceState : '—'}</td>
                      <td>{formatRuntimeTimestamp(runtimeTraceString(entry, 'started_at'))}</td>
                      <td>{formatRuntimeTimestamp(runtimeTraceString(entry, 'completed_at'))}</td>
                      <td className={runtimeTraceString(entry, 'error') ? 'has-error' : ''}>
                        {runtimeTraceString(entry, 'error') ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : <div className="integrated-macro-runtime__empty">실행 트레이스가 없습니다.</div>}
        </div>
      </section>
    </section>
  )
}

function runtimeTraceString(entry: Record<string, JsonValue>, key: string): string | null {
  const value = entry[key]
  return typeof value === 'string' && value ? value : null
}

function formatRuntimeTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('ko-KR')
}

function runtimeValueType(value: JsonValue): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  if (typeof value === 'object' && value.runtime_type === 'element') return 'element'
  return typeof value
}

function macroDescription(macro: MacroDefinition): string {
  const description = macro.metadata.description
  if (typeof description === 'string' && description.trim()) return description
  const updatedAt = macro.metadata.updated_at
  if (typeof updatedAt === 'string' && updatedAt.trim()) {
    const parsed = new Date(updatedAt)
    if (!Number.isNaN(parsed.getTime())) return `마지막 수정 ${parsed.toLocaleString('ko-KR')}`
  }
  return `버전 ${macro.version} · 노드 ${macro.nodes.length}개`
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
  return SEMANTIC_SCREEN_OPTIONS.find((screen) => screen.id === screenId)?.label ?? screenId
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

function contextualQuickSearchBlocks(definition: MacroDefinition | null): BlockDefinition[] {
  const staticBlocks = BLOCKS.filter((block) => ![
    'get_variable', 'set_variable', 'call_function',
  ].includes(block.type))
  if (!definition) return staticBlocks
  const variableBlocks = (definition.variables ?? []).flatMap((variable): BlockDefinition[] => [
    {
      ...BLOCK_BY_TYPE.get('get_variable')!,
      label: `${variable.name} 가져오기`,
      keywords: [variable.name, variable.type, 'get', 'variable', '변수', '가져오기'],
      presetConfig: variableNodeConfig('get_variable', variable),
      presetLabel: variableNodeLabel('get', variable.name),
    },
    {
      ...BLOCK_BY_TYPE.get('set_variable')!,
      label: `${variable.name} 설정`,
      keywords: [variable.name, variable.type, 'set', 'variable', '변수', '설정'],
      presetConfig: variableNodeConfig('set_variable', variable),
      presetLabel: variableNodeLabel('set', variable.name),
    },
  ])
  const functionBlocks = (definition.functions ?? []).map((item): BlockDefinition => ({
    ...BLOCK_BY_TYPE.get('call_function')!,
    label: item.name,
    keywords: [item.name, 'call', 'function', '함수', '호출'],
    presetConfig: functionCallConfig(item),
    presetLabel: item.name,
  }))
  return [...staticBlocks, ...variableBlocks, ...functionBlocks]
}

function variableNodeLabel(mode: 'get' | 'set', name: string) {
  return mode === 'get' ? name : `${name} 설정`
}

function functionCallConfig(functionDefinition: MacroFunctionDefinition): Record<string, JsonValue> {
  return {
    function_id: functionDefinition.id,
    inputs: structuredClone(functionDefinition.inputs),
    outputs: structuredClone(functionDefinition.outputs),
  }
}

function contextualNodeLabel(
  type: MacroNodeType,
  config: Record<string, JsonValue>,
  definition: MacroDefinition,
  fallback: string,
) {
  if (type === 'get_variable' || type === 'set_variable') {
    const name = typeof config.name === 'string' && config.name ? config.name : fallback
    return variableNodeLabel(type === 'get_variable' ? 'get' : 'set', name)
  }
  if (type === 'call_function') {
    const functionId = typeof config.function_id === 'string' ? config.function_id : ''
    return definition.functions?.find((item) => item.id === functionId)?.name ?? fallback
  }
  return fallback
}

function uniqueVariableName(prefix: string, variables: readonly MacroVariableDefinition[]) {
  const base = prefix.replace(/[^a-zA-Z0-9_가-힣]/g, '_') || 'value'
  const used = new Set(variables.map((item) => item.name))
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}_${index}`)) index += 1
  return `${base}_${index}`
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

function renameFunctionDefinition(
  functionDefinition: MacroFunctionDefinition,
  name: string,
): MacroFunctionDefinition {
  return {
    ...functionDefinition,
    name,
    nodes: functionDefinition.nodes.map((node) => node.id === functionDefinition.entry_node_id
      ? { ...node, label: `${name} / 시작` }
      : node.id === functionDefinition.return_node_id
        ? { ...node, label: `${name} / 반환` }
        : node),
  }
}

function duplicateFunctionDefinition(
  source: MacroFunctionDefinition,
  id: string,
  name: string,
): MacroFunctionDefinition {
  const ids = new Map(source.nodes.map((node) => [
    node.id,
    node.id === source.entry_node_id
      ? `${id}-entry`
      : node.id === source.return_node_id
        ? `${id}-return`
        : `${id}-${node.id}`,
  ]))
  return {
    ...structuredClone(source),
    id,
    name,
    entry_node_id: `${id}-entry`,
    return_node_id: `${id}-return`,
    nodes: source.nodes.map((node) => ({
      ...structuredClone(node),
      id: ids.get(node.id)!,
      ...(node.id === source.entry_node_id ? { label: `${name} / 시작` } : {}),
      ...(node.id === source.return_node_id ? { label: `${name} / 반환` } : {}),
    })),
    edges: source.edges.map((edge) => ({
      ...structuredClone(edge),
      id: `${id}-${edge.id}`,
      source: ids.get(edge.source) ?? edge.source,
      target: ids.get(edge.target) ?? edge.target,
    })),
  }
}

function normalizeFunctionPorts(ports: readonly MacroFunctionPort[]): MacroFunctionPort[] | null {
  const normalized = ports.map((port) => ({ ...port, id: port.id.trim() }))
  if (normalized.some((port) => !port.id)) return null
  if (new Set(normalized.map((port) => port.id)).size !== normalized.length) return null
  return normalized
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
      label: target.name,
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
          label: target.name,
          definitionLabel: target.name,
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
