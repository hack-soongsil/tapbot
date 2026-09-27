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
import { BLOCK_BY_TYPE, cloneDefaultConfig } from './blocks'
import { BlockPalette } from './BlockPalette'
import { flowToMacroDefinition, macroDefinitionToFlow } from './graph-converters'
import { macroEditorApi } from './api'
import { MacroCanvas } from './MacroCanvas'
import { MacroToolbar } from './MacroToolbar'
import { NodeInspector } from './NodeInspector'
import { MacroEventLog } from '../macro-runtime/MacroEventLog'
import { useMacroRuntime } from '../macro-runtime/useMacroRuntime'
import type {
  BackendValidationResponse,
  JsonValue,
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
import '@xyflow/react/dist/style.css'
import './macro-editor.css'

export const MACRO_DRAFT_STORAGE_KEY = 'tapbot.macro-editor.draft.v1'

const screenMatch = (screenId: string): Record<string, JsonValue> => (
  screenId === 'reservation_detail'
    ? {
        all: [
          { text: '한 칸은 30분입니다. 예약된 시간은 선택할 수 없어요' },
          { text: '초기화' },
          { text_regex: '^[0-9]{4}년 [0-9]{1,2}월 [0-9]{1,2}일\\([월화수목금토일]\\)$' },
        ],
      }
    : {
        all: [
          { content_description: '예약 내역' },
          { content_description: '공지' },
          { content_description: '예약' },
          { content_description: '마이' },
          { text_regex: '^(월|화|수|목|금|토|일) [0-9]{1,2}$', min_count: 1 },
        ],
      }
)

const emptyDefinition = (): MacroDefinition => ({
  id: 'untitled-macro',
  name: 'Untitled Macro',
  version: 1,
  screen: {
    id: 'reservation_home',
    match: screenMatch('reservation_home'),
  },
  event_entry_node_ids: {
    enter: 'event-enter',
    update: 'event-update',
    exit: 'event-exit',
  },
  nodes: [
    { id: 'event-enter', type: 'screen_enter', config: {}, position: { x: 80, y: 60 } },
    { id: 'event-update', type: 'screen_update', config: { interval_ms: 1_000, skip_if_running: true }, position: { x: 340, y: 60 } },
    { id: 'event-exit', type: 'screen_exit', config: {}, position: { x: 600, y: 60 } },
  ],
  edges: [],
  metadata: {},
})

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
  return emptyDefinition()
}

export function MacroEditorPage() {
  const query = useMemo(() => new URLSearchParams(window.location.search), [])
  const runtimeDeviceId = query.get('device_id')
  const requestedMacroId = query.get('macro_id')
  const [initialState] = useState(() => {
    const definition = loadDraft()
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
    metadata: initial.metadata,
  }))
  const [nodes, setNodes] = useState<MacroFlowNode[]>(initialFlow.nodes)
  const [edges, setEdges] = useState<MacroFlowEdge[]>(initialFlow.edges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageIntent, setMessageIntent] = useState<'success' | 'warning' | 'danger'>('success')
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const liveRuntime = useMacroRuntime(runtimeDeviceId)
  const flowRef = useRef<ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null>(null)

  useEffect(() => {
    if (!requestedMacroId) return
    let active = true
    void macroEditorApi.get(requestedMacroId).then((next) => {
      if (!active) return
      const flow = macroDefinitionToFlow(next)
      setMeta({
        id: next.id,
        name: next.name,
        version: next.version,
        entry_node_id: next.entry_node_id,
        screen: next.screen,
        event_entry_node_ids: next.event_entry_node_ids,
        metadata: next.metadata,
      })
      setNodes(flow.nodes)
      setEdges(flow.edges)
      setDirty(false)
      setMessage(null)
    }).catch((error: unknown) => {
      if (!active) return
      setMessage(errorMessage(error, 'Could not load the device macro.'))
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
        runtimeState: liveRuntime.nodeState[node.id] ?? 'pending',
      },
    })),
    [issues, liveRuntime.nodeState, meta.entry_node_id, nodes],
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
        edge.id === liveRuntime.currentEdgeId ? 'runtime-current-edge' : '',
      ].filter(Boolean).join(' ') || undefined,
      animated: edge.id === liveRuntime.currentEdgeId || issues.some((issue) => issue.edgeId === edge.id),
      style: issues.some((issue) => issue.edgeId === edge.id)
        ? { stroke: 'var(--danger)' }
        : undefined,
    })),
    [edges, issues, liveRuntime.currentEdgeId],
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
      if (!window.confirm('Discard unsaved macro changes?')) {
        event.preventDefault()
        event.stopPropagation()
      }
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
    setMessage(null)
  }

  const addNode = useCallback((type: MacroNodeType, position?: { x: number; y: number }) => {
    const block = BLOCK_BY_TYPE.get(type)
    if (!block) return
    setNodes((current) => {
      const id = nextNodeId(type, current)
      const node: MacroFlowNode = {
        id,
        type: block.category,
        position: position ?? { x: 120 + (current.length % 3) * 240, y: 100 + Math.floor(current.length / 3) * 170 },
        data: {
          nodeType: type,
          category: block.category,
          label: block.label,
          definitionLabel: undefined,
          config: cloneDefaultConfig(type),
          isEntry: false,
          errors: [],
        },
      }
      setSelectedNodeId(id)
      return [...current, node]
    })
    markChanged()
  }, [])

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

  const validate = async () => {
    const clientIssues = validateClient()
    if (clientIssues.length > 0) {
      show('Fix validation errors before saving or running.', 'danger')
      return false
    }
    try {
      const response = await macroEditorApi.validate(definition)
      const backendIssues = mapBackendValidationErrors(response)
      setIssues(backendIssues)
      if (!response.valid || backendIssues.length > 0) {
        show('Backend validation found graph errors.', 'danger')
        return false
      }
      show('Graph is valid.', 'success')
    } catch (error) {
      const backendIssues = issuesFromApiError(error)
      if (backendIssues.length > 0) {
        setIssues(backendIssues)
        show('Backend validation found graph errors.', 'danger')
        return false
      }
      show('Client validation passed. Backend validation is unavailable.', 'warning')
    }
    return true
  }

  const save = async () => {
    const clientIssues = validateClient()
    if (clientIssues.length > 0) {
      show('Fix validation errors before saving.', 'danger')
      return
    }
    setBusy(true)
    window.localStorage.setItem(MACRO_DRAFT_STORAGE_KEY, JSON.stringify(definition))
    try {
      const response = await macroEditorApi.validate(definition)
      const backendIssues = mapBackendValidationErrors(response)
      if (!response.valid || backendIssues.length > 0) {
        setIssues(backendIssues)
        show('Saved locally, but backend validation rejected the graph.', 'danger')
        return
      }
      const saved = await macroEditorApi.save(definition)
      setMeta((current) => ({ ...current, version: saved.version }))
      setIssues([])
      show('Macro saved.', 'success')
    } catch (error) {
      const backendIssues = issuesFromApiError(error)
      if (backendIssues.length > 0) {
        setIssues(backendIssues)
        show('Saved locally, but backend validation rejected the graph.', 'danger')
      } else {
        show('Saved locally. Backend macro storage is unavailable.', 'warning')
      }
    } finally {
      setDirty(false)
      setBusy(false)
    }
  }

  const run = async () => {
    if (!runtimeDeviceId) {
      show('Open this macro from a device to run it.', 'warning')
      return
    }
    if (!(await validate())) return
    setBusy(true)
    try {
      const saved = await macroEditorApi.save(definition)
      setMeta((current) => ({ ...current, version: saved.version }))
      window.localStorage.setItem(MACRO_DRAFT_STORAGE_KEY, JSON.stringify(definition))
      setDirty(false)
      await macroEditorApi.bind(runtimeDeviceId, definition.id)
      const response = await macroEditorApi.command(runtimeDeviceId, 'start')
      setRunStatus(response.runtime.state)
      show(`Macro started on ${runtimeDeviceId}.`, 'success')
    } catch (error) {
      show(errorMessage(error, 'Run API is unavailable until macro CRUD is enabled.'), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    if (!runtimeDeviceId) {
      show('Open this macro from a device to control its runtime.', 'warning')
      return
    }
    setBusy(true)
    try {
      const response = await macroEditorApi.command(runtimeDeviceId, 'stop')
      setRunStatus(response.runtime.state)
      show('Macro stopped.', 'success')
    } catch (error) {
      show(errorMessage(error, 'Could not stop the macro.'), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const runtimeCommand = async (name: 'pause' | 'resume' | 'step' | 'reset') => {
    if (!runtimeDeviceId) {
      show('Open this macro from a device to control its runtime.', 'warning')
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
    if (dirty && !window.confirm('Discard unsaved macro changes?')) return
    loadDefinition(emptyDefinition())
  }

  const loadSavedDraft = () => {
    if (dirty && !window.confirm('Discard unsaved macro changes?')) return
    loadDefinition(loadDraft())
    show('Loaded the latest local draft.', 'success')
  }

  const duplicate = () => {
    setMeta((current) => ({
      ...current,
      id: `${current.id}-copy`,
      name: `${current.name} Copy`,
      version: 1,
    }))
    setDirty(true)
    show('Created an unsaved copy.', 'success')
  }

  const loadDefinition = (next: MacroDefinition) => {
    const flow = macroDefinitionToFlow(next)
    setMeta({
      id: next.id,
      name: next.name,
      version: next.version,
      entry_node_id: next.entry_node_id,
      screen: next.screen,
      event_entry_node_ids: next.event_entry_node_ids,
      metadata: next.metadata,
    })
    setNodes(flow.nodes)
    setEdges(flow.edges)
    setSelectedNodeId(null)
    setIssues([])
    setDirty(false)
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
        busy={busy}
        runStatus={liveRuntime.runtime?.state ?? runStatus}
        runtimeVersion={liveRuntime.runtime?.definition_version}
        screenId={meta.screen?.id}
        onNameChange={(name) => {
          setMeta((current) => ({ ...current, name }))
          markChanged()
        }}
        onScreenChange={(screenId) => {
          setMeta((current) => ({
            ...current,
            screen: { id: screenId, match: screenMatch(screenId) },
          }))
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
        />
      </div>
      {runtimeDeviceId && (
        <div className="macro-runtime-bottom">
          <span className={liveRuntime.connected ? 'is-connected' : 'is-disconnected'}>
            {liveRuntime.connected ? 'Live' : 'Reconnecting'} · {liveRuntime.runtime?.runtime_id ?? 'No runtime'}
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
    )) &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    typeof candidate.metadata === 'object' &&
    candidate.metadata !== null
  )
}
