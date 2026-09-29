import { Callout } from '@blueprintjs/core'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../lib/api-client'
import { ConfirmDialog } from '../../components/AppDialog'
import { BLOCK_BY_TYPE, cloneDefaultConfig } from './blocks'
import { BlockPalette } from './BlockPalette'
import { flowToMacroDefinition, macroDefinitionToFlow, migrateLegacyEntry } from './graph-converters'
import { macroEditorApi } from './api'
import { MacroCanvas } from './MacroCanvas'
import { MacroToolbar } from './MacroToolbar'
import { NodeInspector } from './NodeInspector'
import { createEmptyMacroDefinition, MACRO_DRAFT_STORAGE_KEY } from './definition-factory'
import { MacroEventLog } from '../macro-runtime/MacroEventLog'
import { useMacroRuntime } from '../macro-runtime/useMacroRuntime'
import { runtimeNodeKey } from '../macro-runtime/runtime-overlay'
import type {
  BackendValidationResponse,
  MacroDefinition,
  MacroFlowEdge,
  MacroFlowNode,
  MacroNodeType,
  ValidationIssue,
} from './types'
import {
  mapBackendValidationErrors,
  validateMacroDefinition,
} from './validation'
import './macro-editor.css'

export { MACRO_DRAFT_STORAGE_KEY } from './definition-factory'

function loadDraft(): MacroDefinition {
  try {
    const stored = window.localStorage.getItem(MACRO_DRAFT_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as unknown
      if (isMacroDefinition(parsed)) return parsed
    }
  } catch {
    // A corrupt or unavailable draft must not prevent the editor from opening.
  }
  return createEmptyMacroDefinition()
}

export function MacroEditorPage() {
  const query = useMemo(() => new URLSearchParams(window.location.search), [])
  const runtimeDeviceId = query.get('device_id')
  const requestedMacroId = query.get('macro_id')
  const [initialState] = useState(() => {
    const definition = migrateLegacyEntry(loadDraft())
    return { definition, flow: macroDefinitionToFlow(definition) }
  })
  const initial = initialState.definition
  const initialFlow = initialState.flow
  const [meta, setMeta] = useState(() => ({
    id: initial.id,
    name: initial.name,
    version: initial.version,
    entry_node_id: initial.entry_node_id,
    screen: initial.screen,
    event_entry_node_ids: initial.event_entry_node_ids,
    screen_event_entry_node_ids: initial.screen_event_entry_node_ids,
    functions: initial.functions,
    variables: initial.variables,
    metadata: initial.metadata,
  }))
  const [nodes, setNodes] = useState<MacroFlowNode[]>(initialFlow.nodes)
  const [edges, setEdges] = useState<MacroFlowEdge[]>(initialFlow.edges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [dirty, setDirty] = useState(false)
  const [validationState, setValidationState] = useState<{
    status: 'unknown' | 'valid' | 'invalid' | 'stale'
    errorCount: number
  }>({ status: 'unknown', errorCount: 0 })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageIntent, setMessageIntent] = useState<'success' | 'warning' | 'danger'>('success')
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null)
  const liveRuntime = useMacroRuntime(runtimeDeviceId)
  const flowRef = useRef<ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null>(null)

  useEffect(() => {
    if (!requestedMacroId) return
    let active = true
    void macroEditorApi.get(requestedMacroId).then((next) => {
      if (!active) return
      const normalized = migrateLegacyEntry(next)
      const flow = macroDefinitionToFlow(normalized)
      setMeta({
        id: normalized.id,
        name: normalized.name,
        version: normalized.version,
        entry_node_id: normalized.entry_node_id,
        screen: normalized.screen,
        event_entry_node_ids: normalized.event_entry_node_ids,
        screen_event_entry_node_ids: normalized.screen_event_entry_node_ids,
        functions: normalized.functions,
        variables: normalized.variables,
        metadata: normalized.metadata,
      })
      setNodes(flow.nodes)
      setEdges(flow.edges)
      setDirty(false)
      setIssues([])
      setValidationState({ status: 'unknown', errorCount: 0 })
      setMessage(null)
    }).catch((error: unknown) => {
      if (!active) return
      setMessage(errorMessage(error, '기기 매크로를 불러오지 못했습니다.'))
      setMessageIntent('danger')
    })
    return () => { active = false }
  }, [requestedMacroId])

  const definition = useMemo(
    () => flowToMacroDefinition(meta, nodes, edges),
    [edges, meta, nodes],
  )
  const shownNodes = useMemo(
    () => nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isEntry: Boolean(meta.entry_node_id) && node.id === meta.entry_node_id,
        errors: issues.filter((issue) => issue.nodeId === node.id).map((issue) => issue.message),
        runtimeState: liveRuntime.graphOverlay.nodeStates[runtimeNodeKey('main', node.id)] ?? 'pending',
      },
    })),
    [issues, liveRuntime.graphOverlay.nodeStates, meta.entry_node_id, nodes],
  )
  const selectedNode = shownNodes.find((node) => node.id === selectedNodeId) ?? null
  const shownEdges = useMemo(
    () => edges.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        errors: issues.filter((issue) => issue.edgeId === edge.id).map((issue) => issue.message),
      },
      className: [
        edge.data?.kind === 'data' ? 'macro-edge--data' : '',
        liveRuntime.graphOverlay.currentGraphId === 'main'
          && edge.id === liveRuntime.graphOverlay.currentEdgeId ? 'runtime-current-edge' : '',
      ].filter(Boolean).join(' ') || undefined,
      animated: (liveRuntime.graphOverlay.currentGraphId === 'main'
        && edge.id === liveRuntime.graphOverlay.currentEdgeId) || issues.some((issue) => issue.edgeId === edge.id),
      style: issues.some((issue) => issue.edgeId === edge.id)
        ? { stroke: 'var(--danger)' }
        : undefined,
    })),
    [edges, issues, liveRuntime.graphOverlay.currentEdgeId, liveRuntime.graphOverlay.currentGraphId],
  )

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    if (!dirty) return
    const warnForInternalLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return
      const target = event.target
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.target === '_blank') return
      const destination = new URL(anchor.href, window.location.href)
      if (destination.origin !== window.location.origin) return
      event.preventDefault()
      event.stopPropagation()
      setDiscardAction(() => () => window.location.assign(destination.href))
    }
    document.addEventListener('click', warnForInternalLink, true)
    return () => document.removeEventListener('click', warnForInternalLink, true)
  }, [dirty])

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        document.querySelector<HTMLButtonElement>('.macro-save-button')?.click()
      }
    }
    window.addEventListener('keydown', saveShortcut)
    return () => window.removeEventListener('keydown', saveShortcut)
  }, [])

  const markChanged = () => {
    setDirty(true)
    setValidationState((current) => current.status === 'unknown'
      ? current
      : { ...current, status: 'stale' })
    setMessage(null)
  }

  const discardOrRun = (action: () => void) => {
    if (!dirty) action()
    else setDiscardAction(() => action)
  }

  const addNode = useCallback((type: MacroNodeType, position?: { x: number; y: number }) => {
    const block = BLOCK_BY_TYPE.get(type)
    if (!block) return null
    const id = nextNodeId(type, nodes)
    const config = cloneDefaultConfig(type)
    const node: MacroFlowNode = {
      id,
      type: block.category,
      position: position ?? { x: 120 + (nodes.length % 3) * 240, y: 100 + Math.floor(nodes.length / 3) * 170 },
      data: {
        nodeType: type,
        category: block.category,
        label: block.label,
        definitionLabel: undefined,
        config,
        isEntry: false,
        errors: [],
      },
    }
    setSelectedNodeId(id)
    setNodes((current) => [...current, node])
    markChanged()
    return { id, type, config }
  }, [nodes])

  const changeNodes = (changes: NodeChange<MacroFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
    if (changes.some((change) => change.type !== 'select' && change.type !== 'dimensions')) {
      markChanged()
    }
    const removed = changes.find(
      (change) => change.type === 'remove' && change.id === selectedNodeId,
    )
    if (removed) setSelectedNodeId(null)
  }

  const changeEdges = (changes: EdgeChange<MacroFlowEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current))
    if (changes.some((change) => change.type !== 'select')) markChanged()
  }

  const connect = (connection: Connection, kind: 'exec' | 'data' = 'exec') => {
    setEdges((current) => addEdge({
      ...connection,
      id: nextEdgeId(connection.source, connection.target, current),
      data: { errors: [], kind },
    }, current))
    markChanged()
  }

  const updateSelected = (update: Partial<MacroFlowNode['data']>) => {
    if (!selectedNodeId) return
    setNodes((current) => current.map((node) =>
      node.id === selectedNodeId ? { ...node, data: { ...node.data, ...update } } : node,
    ))
    markChanged()
  }

  const deleteSelected = () => {
    if (!selectedNodeId) return
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId))
    setEdges((current) => current.filter(
      (edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId,
    ))
    setSelectedNodeId(null)
    markChanged()
  }

  const validateClient = () => {
    const next = validateMacroDefinition(definition)
    setIssues(next)
    return next
  }

  const validate = async (forExecution = false) => {
    const clientIssues = validateClient()
    if (clientIssues.length > 0) {
      setValidationState({ status: 'invalid', errorCount: clientIssues.length })
      show(
        forExecution
          ? `검증 오류 ${clientIssues.length}개가 있어 실행할 수 없습니다.`
          : `그래프 검증 오류 ${clientIssues.length}개를 발견했습니다.`,
        'danger',
      )
      return false
    }
    try {
      const response = await macroEditorApi.validate(definition)
      const backendIssues = mapBackendValidationErrors(response)
      setIssues(backendIssues)
      if (!response.valid || backendIssues.length > 0) {
        const errorCount = Math.max(1, backendIssues.length)
        setValidationState({ status: 'invalid', errorCount })
        show(
          forExecution
            ? `검증 오류 ${errorCount}개가 있어 실행할 수 없습니다.`
            : `백엔드 그래프 검증 오류 ${errorCount}개를 발견했습니다.`,
          'danger',
        )
        return false
      }
      setValidationState({ status: 'valid', errorCount: 0 })
      show('그래프가 유효합니다.', 'success')
    } catch (error) {
      const backendIssues = issuesFromApiError(error)
      if (backendIssues.length > 0) {
        setIssues(backendIssues)
        setValidationState({ status: 'invalid', errorCount: backendIssues.length })
        show(
          forExecution
            ? `검증 오류 ${backendIssues.length}개가 있어 실행할 수 없습니다.`
            : `백엔드 그래프 검증 오류 ${backendIssues.length}개를 발견했습니다.`,
          'danger',
        )
        return false
      }
      setValidationState({ status: 'unknown', errorCount: 0 })
      show('클라이언트 검증은 통과했지만 백엔드 검증을 사용할 수 없습니다.', 'warning')
      return false
    }
    return true
  }

  const save = async () => {
    setBusy(true)
    window.localStorage.setItem(MACRO_DRAFT_STORAGE_KEY, JSON.stringify(definition))
    try {
      const saved = await macroEditorApi.save(definition)
      setMeta((current) => ({ ...current, version: saved.version }))
      show(
        validationState.status === 'invalid'
          ? `저장됨 · 검증 오류 ${validationState.errorCount}개`
          : '매크로를 저장했습니다.',
        validationState.status === 'invalid' ? 'warning' : 'success',
      )
    } catch (error) {
      const backendIssues = issuesFromApiError(error)
      if (backendIssues.length > 0) {
        setIssues(backendIssues)
        show('로컬에는 저장했지만 백엔드가 매크로 형식을 거부했습니다.', 'danger')
      } else {
        show('로컬에 저장했습니다. 백엔드 매크로 저장소는 사용할 수 없습니다.', 'warning')
      }
    } finally {
      setDirty(false)
      setBusy(false)
    }
  }

  const run = async () => {
    if (!runtimeDeviceId) {
      show('실행하려면 기기에서 이 매크로를 여세요.', 'warning')
      return
    }
    if (!(await validate(true))) return
    setBusy(true)
    try {
      const saved = await macroEditorApi.save(definition)
      setMeta((current) => ({ ...current, version: saved.version }))
      window.localStorage.setItem(MACRO_DRAFT_STORAGE_KEY, JSON.stringify(definition))
      setDirty(false)
      await macroEditorApi.bind(runtimeDeviceId, definition.id)
      const response = await macroEditorApi.command(runtimeDeviceId, 'start')
      setRunStatus(response.runtime.state)
      show(`${runtimeDeviceId}에서 매크로를 시작했습니다.`, 'success')
    } catch (error) {
      show(errorMessage(error, '매크로 CRUD가 활성화될 때까지 실행 API를 사용할 수 없습니다.'), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    if (!runtimeDeviceId) {
      show('실행 상태를 제어하려면 기기에서 이 매크로를 여세요.', 'warning')
      return
    }
    setBusy(true)
    try {
      const response = await macroEditorApi.command(runtimeDeviceId, 'stop')
      setRunStatus(response.runtime.state)
      show('매크로를 중지했습니다.', 'success')
    } catch (error) {
      show(errorMessage(error, '매크로를 중지하지 못했습니다.'), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const runtimeCommand = async (name: 'pause' | 'resume' | 'step' | 'reset') => {
    if (!runtimeDeviceId) {
      show('실행 상태를 제어하려면 기기에서 이 매크로를 여세요.', 'warning')
      return
    }
    setBusy(true)
    try {
      const response = await macroEditorApi.command(runtimeDeviceId, name)
      setRunStatus(response.runtime.state)
      await liveRuntime.refresh()
    } catch (error) {
      show(errorMessage(error, `Could not ${name} the macro.`), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    discardOrRun(() => loadDefinition(createEmptyMacroDefinition()))
  }

  const loadSavedDraft = () => {
    discardOrRun(() => {
      loadDefinition(loadDraft())
      show('최신 로컬 초안을 불러왔습니다.', 'success')
    })
  }

  const duplicate = () => {
    setMeta((current) => ({
      ...current,
      id: `${current.id}-copy`,
      name: `${current.name} 복사본`,
      version: 1,
    }))
    markChanged()
    show('저장되지 않은 복사본을 만들었습니다.', 'success')
  }

  const loadDefinition = (next: MacroDefinition) => {
    const normalized = migrateLegacyEntry(next)
    const flow = macroDefinitionToFlow(normalized)
    setMeta({
      id: normalized.id,
      name: normalized.name,
      version: normalized.version,
      entry_node_id: normalized.entry_node_id,
      screen: normalized.screen,
      event_entry_node_ids: normalized.event_entry_node_ids,
      screen_event_entry_node_ids: normalized.screen_event_entry_node_ids,
      functions: normalized.functions,
      variables: normalized.variables,
      metadata: normalized.metadata,
    })
    setNodes(flow.nodes)
    setEdges(flow.edges)
    setSelectedNodeId(null)
    setIssues([])
    setDirty(false)
    setValidationState({ status: 'unknown', errorCount: 0 })
    setMessage(null)
  }

  const show = (nextMessage: string, intent: typeof messageIntent) => {
    setMessage(nextMessage)
    setMessageIntent(intent)
  }

  return (
    <div className="macro-editor-page">
      <MacroToolbar
        name={meta.name}
        dirty={dirty}
        validationStatus={validationState.status}
        validationErrorCount={validationState.errorCount}
        busy={busy}
        runStatus={liveRuntime.runtime?.state ?? runStatus}
        runtimeVersion={liveRuntime.runtime?.definition_version}
        onNameChange={(name) => {
          setMeta((current) => ({ ...current, name }))
          markChanged()
        }}
        onNew={reset}
        onLoad={loadSavedDraft}
        onDuplicate={duplicate}
        onValidate={() => void validate()}
        onSave={() => void save()}
        onRun={() => void run()}
        onStop={() => void stop()}
        onPause={() => void runtimeCommand('pause')}
        onResume={() => void runtimeCommand('resume')}
        onStep={() => void runtimeCommand('step')}
        onReset={() => void runtimeCommand('reset')}
        onFitView={() => void flowRef.current?.fitView({ duration: 250, padding: 0.2 })}
      />
      {message && <Callout className="macro-editor-message" intent={messageIntent}>{message}</Callout>}
      <div className="macro-editor-layout">
        <BlockPalette onAdd={addNode} />
        <MacroCanvas
          nodes={shownNodes}
          edges={shownEdges}
          onNodesChange={changeNodes}
          onEdgesChange={changeEdges}
          onConnect={connect}
          onSelectNode={setSelectedNodeId}
          onDropBlock={addNode}
          variables={meta.variables ?? []}
          onUpdateNodeConfig={(nodeId, config) => {
            setNodes((current) => current.map((node) =>
              node.id === nodeId
                ? { ...node, data: { ...node.data, config } }
                : node,
            ))
            markChanged()
          }}
          onReady={(instance) => { flowRef.current = instance }}
        />
        <NodeInspector
          node={selectedNode}
          issues={issues.filter((issue) => issue.nodeId === selectedNodeId)}
          onUpdateConfig={(config) => updateSelected({ config })}
          onUpdateLabel={(label) => updateSelected({ label, definitionLabel: label })}
          onSetEntry={() => {
            if (!selectedNodeId) return
            setMeta((current) => ({ ...current, entry_node_id: selectedNodeId }))
            markChanged()
          }}
          onDelete={deleteSelected}
          functions={definition.functions ?? []}
          variables={definition.variables ?? []}
        />
      </div>
      {runtimeDeviceId && (
        <div className="macro-runtime-bottom">
          <span className={liveRuntime.connected ? 'is-connected' : 'is-disconnected'}>
            {liveRuntime.connected ? '실시간 연결' : '다시 연결 중'} · {liveRuntime.runtime?.runtime_id ?? '실행 없음'}
          </span>
          <MacroEventLog events={liveRuntime.events} />
        </div>
      )}
      {issues.some((issue) => !issue.nodeId && !issue.edgeId) && (
        <div className="macro-global-errors" role="alert">
          {issues.filter((issue) => !issue.nodeId && !issue.edgeId).map((issue, index) => (
            <span key={`${issue.source}-${index}`}>{issue.message}</span>
          ))}
        </div>
      )}
      {discardAction && (
        <ConfirmDialog
          title="변경사항 버리기"
          description="저장하지 않은 매크로 변경 사항을 버릴까요?"
          confirmLabel="버리기"
          danger
          onCancel={() => setDiscardAction(null)}
          onConfirm={() => {
            const action = discardAction
            setDiscardAction(null)
            action()
          }}
        />
      )}
    </div>
  )
}

function nextNodeId(type: MacroNodeType, nodes: MacroFlowNode[]) {
  const used = new Set(nodes.map((node) => node.id))
  let index = 1
  while (used.has(`${type}-${index}`)) index += 1
  return `${type}-${index}`
}

function nextEdgeId(source: string, target: string, edges: MacroFlowEdge[]) {
  const base = `${source}-${target}`
  const used = new Set(edges.map((edge) => edge.id))
  let index = 1
  while (used.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

function issuesFromApiError(error: unknown): ValidationIssue[] {
  if (!(error instanceof ApiError)) return []
  const details = error.details
  if (!details || typeof details !== 'object') return []
  const candidate = details as Partial<BackendValidationResponse>
  return Array.isArray(candidate.errors)
    ? mapBackendValidationErrors({ valid: false, errors: candidate.errors })
    : []
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function isMacroDefinition(value: unknown): value is MacroDefinition {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MacroDefinition>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.version === 'number' &&
    (typeof candidate.entry_node_id === 'string' || (
      typeof candidate.event_entry_node_ids === 'object' &&
      candidate.event_entry_node_ids !== null
    ) || (
      typeof candidate.screen_event_entry_node_ids === 'object' &&
      candidate.screen_event_entry_node_ids !== null
    )) &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    typeof candidate.metadata === 'object' &&
    candidate.metadata !== null
  )
}
