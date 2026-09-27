import { Button, ButtonGroup, Callout, Tag } from '@blueprintjs/core'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { macroEditorApi } from './api'
import { BLOCK_BY_TYPE, cloneDefaultConfig } from './blocks'
import { flowToMacroDefinition, macroDefinitionToFlow } from './graph-converters'
import { MacroCanvas } from './MacroCanvas'
import type { useMacroRuntime } from '../macro-runtime/useMacroRuntime'
import type {
  JsonValue,
  MacroDefinition,
  MacroFlowEdge,
  MacroFlowNode,
} from './types'

export interface IntegratedMacroPanelHandle {
  addElement(selector: Record<string, JsonValue>, label: string, kind: 'find' | 'tap'): boolean
}

interface IntegratedMacroPanelProps {
  deviceId: string
  runtime: ReturnType<typeof useMacroRuntime>
}

export const IntegratedMacroPanel = forwardRef<
  IntegratedMacroPanelHandle,
  IntegratedMacroPanelProps
>(function IntegratedMacroPanel({ deviceId, runtime }, ref) {
  const [definitions, setDefinitions] = useState<MacroDefinition[]>([])
  const [definition, setDefinition] = useState<MacroDefinition | null>(null)
  const [nodes, setNodes] = useState<MacroFlowNode[]>([])
  const [edges, setEdges] = useState<MacroFlowEdge[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = async (macroId: string) => {
    const next = await macroEditorApi.get(macroId)
    const flow = macroDefinitionToFlow(next)
    setDefinition(next)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    setDirty(false)
  }

  useEffect(() => {
    let active = true
    void Promise.all([macroEditorApi.list(), macroEditorApi.binding(deviceId)])
      .then(async ([listed, binding]) => {
        if (!active) return
        setDefinitions(listed.macros)
        if (!binding.binding) {
          setDefinition(null)
          setNodes([])
          setEdges([])
          return
        }
        const next = await macroEditorApi.get(binding.binding.macro_definition_id)
        if (!active) return
        const flow = macroDefinitionToFlow(next)
        setDefinition(next)
        setNodes(flow.nodes)
        setEdges(flow.edges)
        setDirty(false)
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Macro could not be loaded.')
      })
    return () => { active = false }
  }, [deviceId])

  useImperativeHandle(ref, () => ({
    addElement(selector, label, kind) {
      if (!definition) return false
      const nodeType = kind === 'tap' ? 'click_element' : 'find_element'
      const block = BLOCK_BY_TYPE.get(nodeType)
      if (!block) return false
      setNodes((current) => {
        const id = uniqueNodeId(nodeType, current)
        const config: Record<string, JsonValue> = kind === 'tap'
          ? {
              selector,
              resolve: { strategy: 'best_match', require_enabled: true, require_visible: true },
              click: { mode: 'center', duration_ms: 70 },
            }
          : { selector }
        if (!definition.event_entry_node_ids && !definition.entry_node_id) {
          setDefinition((value) => value ? { ...value, entry_node_id: id } : value)
        }
        return [...current, {
          id,
          type: block.category,
          position: { x: 100 + (current.length % 3) * 220, y: 100 + Math.floor(current.length / 3) * 150 },
          data: {
            nodeType,
            category: block.category,
            label,
            definitionLabel: label,
            config,
            isEntry: false,
            errors: [],
          },
        }]
      })
      setDirty(true)
      setMessage(`${label} added as ${kind === 'tap' ? 'Tap Element' : 'Find Element'}.`)
      return true
    },
  }), [definition])

  const shownNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      isEntry: node.id === definition?.entry_node_id,
      runtimeState: runtime.nodeState[node.id] ?? 'pending',
    },
  })), [definition?.entry_node_id, nodes, runtime.nodeState])
  const shownEdges = useMemo(() => edges.map((edge) => ({
    ...edge,
    className: [
      edge.data?.kind === 'data' ? 'macro-edge--data' : '',
      edge.id === runtime.currentEdgeId ? 'runtime-current-edge' : '',
    ].filter(Boolean).join(' ') || undefined,
    animated: edge.id === runtime.currentEdgeId,
  })), [edges, runtime.currentEdgeId])

  const addNode = (type: MacroFlowNode['data']['nodeType'], position: { x: number; y: number }) => {
    const block = BLOCK_BY_TYPE.get(type)
    if (!block) return
    setNodes((current) => [...current, {
      id: uniqueNodeId(type, current),
      type: block.category,
      position,
      data: {
        nodeType: type,
        category: block.category,
        label: block.label,
        config: cloneDefaultConfig(type),
        isEntry: false,
        errors: [],
      },
    }])
    setDirty(true)
  }

  const save = async () => {
    if (!definition) return null
    setBusy(true)
    try {
      const saved = await macroEditorApi.save(flowToMacroDefinition(definition, nodes, edges))
      setDefinition(saved)
      setDefinitions((current) => current.map((item) => item.id === saved.id ? saved : item))
      setDirty(false)
      setMessage('Macro saved. Runtime snapshots already in progress are unchanged.')
      return saved
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Macro could not be saved.')
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
      if (name === 'start' && dirty && !(await save())) return
      await macroEditorApi.command(deviceId, name)
      await runtime.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not ${name} macro.`)
    } finally {
      setBusy(false)
    }
  }

  const selectMacro = async (macroId: string) => {
    if (!macroId || (dirty && !window.confirm('Discard unsaved macro changes?'))) return
    setBusy(true)
    try {
      await macroEditorApi.bind(deviceId, macroId)
      await load(macroId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Macro binding could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  const duplicate = async () => {
    if (!definition) return
    setBusy(true)
    try {
      const copy = await macroEditorApi.duplicate(definition.id, {
        name: `${definition.name} — ${deviceId}`,
      })
      await macroEditorApi.bind(deviceId, copy.id)
      setDefinitions((current) => [...current, copy])
      await load(copy.id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Macro could not be duplicated.')
    } finally {
      setBusy(false)
    }
  }

  const state = runtime.runtime?.state ?? 'idle'
  const active = state === 'running' || state === 'paused'
  return (
    <section className="integrated-macro-panel" aria-label="Macro Canvas" data-editor-pane="macro">
      <header className="integrated-macro-toolbar">
        <div>
          <strong>Macro Canvas</strong>
          <select
            aria-label="Workspace macro"
            value={definition?.id ?? ''}
            disabled={busy}
            onChange={(event) => void selectMacro(event.target.value)}
          >
            <option value="">No macro bound</option>
            {definitions.map((item) => (
              <option key={item.id} value={item.id}>{item.name} v{item.version}</option>
            ))}
          </select>
          {dirty && <Tag intent="warning" minimal>Editing</Tag>}
          <Tag intent={state === 'running' ? 'success' : state === 'paused' ? 'warning' : 'none'} minimal>
            {state}{runtime.runtime?.definition_version ? ` v${runtime.runtime.definition_version}` : ''}
          </Tag>
          <Tag intent={runtime.connected ? 'success' : 'warning'} minimal>
            {runtime.connected ? 'LIVE' : 'RECONNECTING'}
          </Tag>
        </div>
        <ButtonGroup minimal>
          <Button small disabled={!definition || busy} onClick={() => void save()}>Save</Button>
          <Button small disabled={!definition || busy} onClick={() => void duplicate()}>Duplicate</Button>
          <Button small intent="success" disabled={!definition || busy || active} onClick={() => void command('start')}>Run</Button>
          <Button small disabled={busy || state !== 'running'} onClick={() => void command('pause')}>Pause</Button>
          <Button small disabled={busy || state !== 'paused'} onClick={() => void command('resume')}>Resume</Button>
          <Button small disabled={busy || (state !== 'idle' && state !== 'paused')} onClick={() => void command('step')}>Step</Button>
          <Button small intent="danger" disabled={busy || !active} onClick={() => void command('stop')}>Stop</Button>
          <Button small disabled={busy || !['error', 'stopped', 'completed'].includes(state)} onClick={() => void command('reset')}>Reset</Button>
        </ButtonGroup>
      </header>
      {message && <Callout compact intent={message.includes('Could not') ? 'danger' : 'primary'}>{message}</Callout>}
      {definition ? (
        <MacroCanvas
          nodes={shownNodes}
          edges={shownEdges}
          onNodesChange={(changes: NodeChange<MacroFlowNode>[]) => {
            setNodes((current) => applyNodeChanges(changes, current))
            if (changes.some((change) => change.type !== 'select' && change.type !== 'dimensions')) setDirty(true)
          }}
          onEdgesChange={(changes: EdgeChange<MacroFlowEdge>[]) => {
            setEdges((current) => applyEdgeChanges(changes, current))
            if (changes.some((change) => change.type !== 'select')) setDirty(true)
          }}
          onConnect={(connection: Connection, kind: 'exec' | 'data' = 'exec') => {
            setEdges((current) => addEdge({ ...connection, id: uniqueEdgeId(connection, current), data: { errors: [], kind } }, current))
            setDirty(true)
          }}
          onSelectNode={() => undefined}
          onDropBlock={addNode}
          onReady={() => undefined}
        />
      ) : (
        <div className="android-panel-empty">Bind a macro from the toolbar to start editing.</div>
      )}
    </section>
  )
})

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
