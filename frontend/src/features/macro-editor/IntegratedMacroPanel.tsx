import { Button, ButtonGroup, Callout, Icon, Tag } from '@blueprintjs/core'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { useMacroRuntime } from '../macro-runtime/useMacroRuntime'
import {
  runtimeGraphMatches,
  runtimeNodeError,
  runtimeNodeState,
  traceGraphId,
} from '../macro-runtime/runtime-overlay'
import { ConfirmDialog } from '../../components/AppDialog'
import { BlockPalette } from './BlockPalette'
import { MacroActionButton } from './MacroActionButton'
import { MacroSaveStatus } from './MacroSaveStatus'
import { persistedSaveTimestamp, saveButtonTooltip } from './save-timestamp'
import { traceErrorCode, traceErrorEdgeId, traceErrorMessage, traceErrorOrigin, traceErrorSummary, traceGraphPath, type RuntimeTrace } from './runtime-trace'
import { BlueprintInspector } from './BlueprintInspector'
import {
  BLOCK_BY_TYPE,
  getNodePorts,
} from './blocks'
import { MacroCanvas } from './MacroCanvas'
import {
  MyBlueprintPanel,
  type BlueprintSelection,
} from './MyBlueprintPanel'
import { NodeInspector } from './NodeInspector'
import {
  NameEditorDialog,
  VariableEditorDialog,
} from './MacroEditorDialogs'
import {
  SCREEN_OPTIONS,
  SEMANTIC_SCREEN_OPTIONS,
  canonicalScreenId,
} from './screen-elements'
import type {
  JsonValue,
  MacroDefinition,
  MacroFlowNode,
  MacroVariableDefinition,
} from './types'
import './macro-editor.css'
import { ko, runtimeStateLabels } from '../../i18n/ko'
import { useMacroDialogs } from './hooks/useMacroDialogs'
import { useMacroValidation } from './hooks/useMacroValidation'
import { useGraphNavigation } from './hooks/useGraphNavigation'
import { useGraphEditor } from './hooks/useGraphEditor'
import { useFunctionGraphs } from './hooks/useFunctionGraphs'
import { MAIN_GRAPH_ID, graphIdFromFunctionId } from './graph-store'
import { useMacroDocument } from './hooks/useMacroDocument'
import { useEditorCommands } from './hooks/useEditorCommands'
import { createSearchItems } from './search-provider'
import {
  EXPANDED_BLUEPRINT_MAX_WIDTH,
  EXPANDED_BLUEPRINT_MIN_WIDTH,
  EXPANDED_CANVAS_MIN_WIDTH,
  EXPANDED_INSPECTOR_MAX_WIDTH,
  EXPANDED_INSPECTOR_MIN_WIDTH,
  EXPANDED_SPLITTER_WIDTH,
  useExpandedCanvas,
} from './hooks/useExpandedCanvas'

export interface IntegratedMacroPanelHandle {
  addFindElement(selector: Record<string, JsonValue>, label: string): boolean
}

interface IntegratedMacroPanelProps {
  deviceId: string
  runtime: ReturnType<typeof useMacroRuntime>
  onAvailabilityChange?: (available: boolean) => void
}

const DEFAULT_SCREEN_ID = SCREEN_OPTIONS[0].id

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

export const IntegratedMacroPanel = forwardRef<
  IntegratedMacroPanelHandle,
  IntegratedMacroPanelProps
>(function IntegratedMacroPanel({ deviceId, runtime, onAvailabilityChange }, ref) {
  const [definitions, setDefinitions] = useState<MacroDefinition[]>([])
  const [definition, setDefinition] = useState<MacroDefinition | null>(null)
  const [selectedVariableName, setSelectedVariableName] = useState('')
  const [selectedBlueprint, setSelectedBlueprint] = useState<BlueprintSelection | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'blueprint' | 'blocks'>('blocks')
  const [selectedScreenId, setSelectedScreenId] = useState<string>(DEFAULT_SCREEN_ID)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageIntent, setMessageIntent] = useState<'primary' | 'success' | 'warning' | 'danger'>('primary')
  const [panelTab, setPanelTab] = useState<'canvas' | 'execution'>('execution')
  const [boundMacroId, setBoundMacroId] = useState<string | null>(null)
  const [runtimeDetailOpen, setRuntimeDetailOpen] = useState(false)
  const [runtimeErrorTrace, setRuntimeErrorTrace] = useState<RuntimeTrace | null>(null)
  const [pendingErrorFocus, setPendingErrorFocus] = useState<RuntimeTrace | null>(null)
  const handledFailure = useRef<string | null>(null)
  const errorFocusRequestEpoch = useRef(0)
  const saveInProgress = useRef(false)
  const lastSavedAt = persistedSaveTimestamp(definition)
  const {
    runSetupMacro, setRunSetupMacro,
    variableDialog, setVariableDialog,
    nameDialog, setNameDialog,
    confirmDialog, setConfirmDialog,
    editorDialogOpen,
    discardOrRun: guardUnsavedChanges,
  } = useMacroDialogs()
  const {
    issues,
    setIssues,
    validationState,
    setValidationState,
    markValidationStale,
    validateDefinition,
  } = useMacroValidation({ setMessage, setMessageIntent })
  const markChanged = useCallback(() => {
    setDirty(true)
    markValidationStale()
    setMessage(null)
  }, [markValidationStale])
  const {
    activeGraphId,
    activeGraph,
    activeFunctionId,
    graphs,
    nodeScreens, setNodeScreens,
    getGraph,
    setActiveGraphId,
    replaceGraph,
    replaceGraphs,
    removeGraph,
    mapGraphs,
    addNode,
    addConnection,
    changeNodes,
    changeEdges,
    updateNode,
    deleteNode,
    deleteSelected,
    clearGraph,
  } = useGraphEditor({
    definition,
    selectedScreenId,
    selectedNodeId,
    setSelectedNodeId,
  })
  const {
    graphNavigationStack,
    breadcrumbs,
    graphNavigationError,
    setGraphNavigationError,
    flowRef,
    openMain,
    openFunction,
    openPath,
    goBack,
    goToBreadcrumb,
    resetGraphNavigation,
    forgetGraphView,
  } = useGraphNavigation({
    definition,
    activeGraphId,
    setActiveGraphId,
    selectedNodeId,
    setSelectedNodeId,
    setSelectedBlueprint,
    panelTab,
    dialogOpen: editorDialogOpen,
  })
  const {
    createFunction,
    createFunctionNamed,
    renameFunction,
    deleteFunction,
    duplicateFunction,
    updateFunctionPorts,
    updateFunctionName,
  } = useFunctionGraphs({
    definition,
    setDefinition,
    graphs,
    getGraph,
    replaceGraph,
    removeGraph,
    mapGraphs,
    activeFunctionId,
    graphNavigationStack,
    openFunction,
    openMain,
    goToBreadcrumb,
    forgetGraphView,
    selectedBlueprint,
    setSelectedBlueprint,
    setNameDialog,
    setConfirmDialog,
    setMessage,
    setMessageIntent,
    markChanged,
  })
  const {
    canvasExpanded,
    expandedLayout,
    editorRef,
    setCanvasExpansion,
    beginExpandedResize,
    resetExpandedWidth,
  } = useExpandedCanvas({ flowRef, dialogOpen: editorDialogOpen })
  const {
    definitionForSave,
    loadDefinition,
    save,
    selectMacroNow,
    createNewNamed,
    renameMacroNamed,
    duplicateMacro,
    deleteMacroNow,
  } = useMacroDocument({
    deviceId,
    setDefinitions,
    definition,
    setDefinition,
    graphs,
    replaceGraphs,
    nodeScreens,
    setNodeScreens,
    dirty,
    setDirty,
    isNew,
    setIsNew,
    setBusy,
    setMessage,
    setMessageIntent,
    setBoundMacroId,
    issues,
    setIssues,
    validationState,
    setValidationState,
    setRuntimeErrorTrace,
    resetGraphNavigation,
    clearGraph,
    setSelectedVariableName,
    setSelectedBlueprint,
    setSelectedNodeId,
    setPanelTab,
  })

  const mainGraph = getGraph(MAIN_GRAPH_ID)
  const nodes = mainGraph.nodes

  const commands = useEditorCommands({
    deviceId,
    definition,
    setDefinition,
    definitions,
    graphs,
    graph: {
      addNode, addConnection, updateNode, deleteNode, deleteSelected,
      changeNodes, changeEdges, mapGraphs,
    },
    functions: {
      createFunction, createFunctionNamed, renameFunction, deleteFunction,
      duplicateFunction, updateFunctionPorts, updateFunctionName,
    },
    document: {
      definitionForSave, save, selectMacroNow, createNewNamed, renameMacroNamed,
      duplicateMacro, deleteMacroNow, loadDefinition,
    },
    validation: { validateDefinition },
    runtime,
    dirty,
    isNew,
    selectedVariableName,
    selectedBlueprint,
    selectedNodeId,
    variableDialog,
    nameDialog,
    boundMacroId,
    setBoundMacroId,
    setSelectedVariableName,
    setSelectedBlueprint,
    setSelectedNodeId,
    setSelectedScreenId,
    setPanelTab,
    setRuntimeDetailOpen,
    setCanvasExpansion,
    setVariableDialog,
    setNameDialog,
    setConfirmDialog,
    setRunSetupMacro,
    setBusy,
    setMessage,
    setMessageIntent,
    openMain,
    openFunction,
    openPath,
    goBack,
    goToBreadcrumb,
    guardUnsavedChanges,
    markChanged,
    selectedScreenId,
  })

  const saveMacro = useCallback(() => {
    if (!definition || busy || saveInProgress.current) return
    saveInProgress.current = true
    void commands.saveMacro().finally(() => {
      saveInProgress.current = false
    })
  }, [busy, commands, definition])

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (panelTab !== 'canvas' && !canvasExpanded) return
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (editorDialogOpen) return
      saveMacro()
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [canvasExpanded, editorDialogOpen, panelTab, saveMacro])

  useEffect(() => {
    onAvailabilityChange?.(Boolean(definition))
  }, [definition, onAvailabilityChange])

  const visibleNodeIds = useMemo(() => new Set(
    nodes
      .filter((node) => node.data.eventScreenId === selectedScreenId || (
        !node.data.isEvent && nodeScreens[node.id] === selectedScreenId
      ))
      .map((node) => node.id),
  ), [nodeScreens, nodes, selectedScreenId])

  const runtimeOverlay = runtime.graphOverlay
  const runtimeBelongsToDefinition = runtimeOverlay.macroDefinitionId === definition?.id
  const runtimeErrors = runtime.runtime?.state === 'idle' || !runtimeBelongsToDefinition
    ? [] : runtimeOverlay.errors

  const shownNodes = useMemo(() => (activeGraphId === MAIN_GRAPH_ID
    ? activeGraph.nodes.filter((node) => visibleNodeIds.has(node.id))
    : activeGraph.nodes)
    .map((node) => {
      const runtimeError = runtimeBelongsToDefinition
        ? runtimeNodeError(runtimeOverlay, activeGraphId, node.id) ?? undefined : undefined
      return {
        ...node,
        data: {
          ...node.data,
          errors: issues.filter((item) => item.nodeId === node.id).map((item) => item.message),
          runtimeError,
          runtimeState: runtimeError ? 'failure' as const : runtimeBelongsToDefinition
            ? runtimeNodeState(runtimeOverlay, activeGraphId, node.id) : 'pending',
        },
      }
    }), [activeGraph.nodes, activeGraphId, issues, runtimeBelongsToDefinition, runtimeOverlay, visibleNodeIds])

  const shownEdges = useMemo(() => {
    const graphNodes = activeGraph.nodes
    const graphEdges = activeGraphId === MAIN_GRAPH_ID
      ? activeGraph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
      : activeGraph.edges
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
        runtimeBelongsToDefinition && runtimeGraphMatches(runtimeOverlay, activeGraphId)
          && edge.id === runtimeOverlay.currentEdgeId ? 'runtime-current-edge' : '',
        runtimeErrorTrace && traceGraphId(runtimeErrorTrace) === activeGraphId
          && traceErrorEdgeId(runtimeErrorTrace) === edge.id
          ? 'runtime-error-edge' : '',
      ].filter(Boolean).join(' ') || undefined,
      animated: runtimeBelongsToDefinition && runtimeGraphMatches(runtimeOverlay, activeGraphId)
        && edge.id === runtimeOverlay.currentEdgeId,
      }
    })
  }, [activeGraph.edges, activeGraph.nodes, activeGraphId, issues, runtimeBelongsToDefinition, runtimeErrorTrace, runtimeOverlay, visibleNodeIds])

  const selectedNode = shownNodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedConnectedInputIds = new Set(
    activeGraph.edges
      .filter((edge) => edge.target === selectedNodeId && edge.data?.kind === 'data')
      .flatMap((edge) => edge.targetHandle ? [edge.targetHandle] : []),
  )
  const selectedRuntimeError = selectedNode?.data.runtimeError ?? (
    runtimeErrorTrace?.node_id === selectedNodeId
      && traceGraphId(runtimeErrorTrace) === activeGraphId
      ? runtimeErrorTrace : null
  )
  const quickSearchItems = useMemo(
    () => createSearchItems(definition, commands.createNode),
    [commands.createNode, definition],
  )


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
      const added = commands.createNode('find_element', position, { selector }, label)
      if (added) {
        setMessage(`${screenLabel(selectedScreenId)}에 ${label} 노드를 추가했습니다.`)
        setMessageIntent('success')
      }
      return Boolean(added)
    },
  }), [commands, editorRef, flowRef, selectedScreenId])

  const state = runtime.runtime?.state ?? 'idle'
  const runtimeActive = state === 'running' || state === 'paused'
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRuntimeErrorTrace(null)
      setPendingErrorFocus(null)
      handledFailure.current = null
    }, 0)
    return () => window.clearTimeout(timer)
  }, [deviceId, runtime.runtime?.runtime_id])

  const latestRuntimeFailure = useMemo(() => {
    if (runtime.runtime?.state !== 'error') return null
    return runtimeOverlay.error
  }, [runtime.runtime?.state, runtimeOverlay.error])

  const requestErrorFocus = (trace: RuntimeTrace) => {
    errorFocusRequestEpoch.current += 1
    const origin = traceErrorOrigin(trace)
    const macroId = origin.macro_definition_id ?? runtime.runtime?.macro_definition_id
    if (macroId !== definition?.id) commands.discardOrRun(() => setPendingErrorFocus(origin))
    else setPendingErrorFocus(origin)
  }

  useEffect(() => {
    if (!latestRuntimeFailure || !definition) return
    const key = JSON.stringify([runtime.runtime?.runtime_id, latestRuntimeFailure])
    if (handledFailure.current === key) return
    const requestEpoch = errorFocusRequestEpoch.current
    const timer = window.setTimeout(() => {
      if (requestEpoch !== errorFocusRequestEpoch.current) return
      handledFailure.current = key
      const macroId = latestRuntimeFailure.macro_definition_id ?? runtime.runtime?.macro_definition_id
      if ((dirty || isNew) && macroId !== definition.id) {
        setMessage('실행 오류가 발생했습니다. 오류 위치로 이동하면 다른 매크로가 열립니다.')
        setMessageIntent('warning')
        return
      }
      setPendingErrorFocus(latestRuntimeFailure)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [definition, dirty, isNew, latestRuntimeFailure, runtime.runtime?.macro_definition_id, runtime.runtime?.runtime_id])

  useEffect(() => {
    if (!pendingErrorFocus) return
    // Apply navigation on a frame boundary so the canvas can mount/measure before centering.
    const frame = window.requestAnimationFrame(() => {
      const failFocus = (message: string) => {
        setGraphNavigationError(message)
        setMessage(message)
        setMessageIntent('warning')
        setPendingErrorFocus(null)
      }
      const macroId = pendingErrorFocus.macro_definition_id ?? runtime.runtime?.macro_definition_id
      if (macroId !== definition?.id) {
        const target = definitions.find((item) => item.id === macroId)
        if (target) {
          loadDefinition(target)
          return
        }
        failFocus('오류가 발생한 매크로를 찾을 수 없습니다.')
        return
      }
      const path = traceGraphPath(pendingErrorFocus)
      const functionId = path.at(-1)
      if (path.some((id) => !definition?.functions?.some((item) => item.id === id))) {
        failFocus('오류가 발생한 함수가 삭제되었거나 현재 그래프에 없습니다.')
        return
      }
      const targetGraphId = graphIdFromFunctionId(functionId)
      const targetGraph = getGraph(targetGraphId)
      const targetNodes = targetGraph.nodes
      const node = targetNodes.find((item) => item.id === pendingErrorFocus.node_id)
      if (!node) {
        failFocus('오류가 발생한 노드가 삭제되었거나 현재 그래프에 없습니다.')
        return
      }
      if (!functionId) {
        const screenId = typeof pendingErrorFocus.screen_id === 'string'
          ? canonicalScreenId(pendingErrorFocus.screen_id)
          : node.data.eventScreenId ?? nodeScreens[node.id]
        if (screenId) setSelectedScreenId(screenId)
      }
      const select = (items: MacroFlowNode[]) => items.map((item) => ({ ...item, selected: item.id === node.id }))
      replaceGraph(targetGraphId, { ...targetGraph, nodes: select(targetGraph.nodes) })
      setPanelTab('canvas')
      setRuntimeDetailOpen(false)
      setRuntimeErrorTrace(pendingErrorFocus)
      openPath(path, node)
      setPendingErrorFocus(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [definition, definitions, getGraph, loadDefinition, nodeScreens, openPath, pendingErrorFocus, replaceGraph, runtime.runtime?.macro_definition_id, setGraphNavigationError])

  useEffect(() => {
    if (state !== 'idle') return
    const timer = window.setTimeout(() => setRuntimeErrorTrace(null), 0)
    return () => window.clearTimeout(timer)
  }, [state])

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
              commands.selectScreen(event.target.value)
              window.setTimeout(() => flowRef.current?.fitView({ duration: 200, padding: 0.2 }), 0)
            }}
          >
            {SCREEN_OPTIONS.map((screen) => (
              <option key={screen.id} value={screen.id}>{screen.label}</option>
            ))}
          </select>}
          {panelTab === 'canvas' && (
            <>
              <MacroSaveStatus dirty={dirty} lastSavedAt={lastSavedAt} />
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
            <MacroActionButton icon="tick" label={ko.actions.validate} disabled={!definition || busy} onClick={() => void commands.validateMacro()} />
            <MacroActionButton icon="zoom-to-fit" label={ko.actions.fitView} disabled={!definition} onClick={() => void flowRef.current?.fitView({ duration: 200, padding: 0.2 })} />
            <MacroActionButton icon="floppy-disk" label={ko.actions.save} tooltip={saveButtonTooltip(lastSavedAt)} intent="primary" disabled={!definition || busy} onClick={saveMacro} />
            <MacroActionButton
              icon="maximize"
              label="확대"
              disabled={!definition}
              onClick={() => setCanvasExpansion(true)}
            />
            <select
              aria-label="매크로 그래프"
              value={activeFunctionId ?? '__main__'}
              disabled={!definition}
              onChange={(event) => {
                const functionId = event.target.value === '__main__' ? null : event.target.value
                if (functionId) commands.openFunction(functionId)
                else commands.openMain()
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
            <Button small intent="primary" icon="plus" disabled={busy} onClick={commands.requestCreateMacro}>새 매크로</Button>
          </ButtonGroup>
        )}
      </header>
      {message && <Callout className="integrated-macro-message" compact intent={messageIntent}>{message}</Callout>}
      {latestRuntimeFailure && (
        <Callout compact intent="danger" className="integrated-macro-message">
          {traceErrorSummary(latestRuntimeFailure)}
          <Button small icon="locate" onClick={() => requestErrorFocus(latestRuntimeFailure)}>오류 위치로 이동</Button>
          <MacroActionButton icon="reset" label="초기화" disabled={busy} onClick={() => void commands.executeRuntime('reset')} />
          <MacroActionButton
            icon="play"
            label="다시 실행"
            intent="success"
            disabled={busy || !definitionForSave || definitionForSave.id !== runtime.runtime?.macro_definition_id}
            onClick={() => { if (definitionForSave) setRunSetupMacro(definitionForSave) }}
          />
        </Callout>
      )}
      {runtimeErrors.length > 1 && (
        <section className="macro-runtime-error-list" aria-label="Runtime Error List">
          <strong>Runtime Errors · {runtimeErrors.length}</strong>
          {runtimeErrors.map((entry, index) => {
            const macroId = entry.macro_definition_id ?? runtime.runtime?.macro_definition_id
            const source = definition?.id === macroId ? definition : definitions.find((item) => item.id === macroId)
            const path = traceGraphPath(entry)
            const graph = source?.functions?.find((item) => item.id === path.at(-1))
            const node = (graph?.nodes ?? source?.nodes)?.find((item) => item.id === entry.node_id)
            const label = node?.label ?? (node ? BLOCK_BY_TYPE.get(node.type)?.label : null)
              ?? (typeof entry.node_id === 'string' ? entry.node_id : '노드')
            const graphLabel = ['Main', ...path.map((id) => source?.functions?.find((item) => item.id === id)?.name ?? id)].join(' > ')
            return <button type="button" key={index} onClick={() => requestErrorFocus(entry)}>
              <strong>{label}</strong> · {graphLabel} · <code>{traceErrorCode(entry)}</code> · {traceErrorSummary(entry)}
            </button>
          })}
        </section>
      )}
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
                <MacroSaveStatus dirty={dirty} lastSavedAt={lastSavedAt} />
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
                  commands.selectScreen(event.target.value)
                  window.setTimeout(() => flowRef.current?.fitView({ duration: 200, padding: 0.2 }), 0)
                }}
              >
                {SCREEN_OPTIONS.map((screen) => (
                  <option key={screen.id} value={screen.id}>{screen.label}</option>
                ))}
              </select>
              <span />
              <MacroActionButton icon="tick" label={ko.actions.validate} disabled={!definition || busy} onClick={() => void commands.validateMacro()} />
              <MacroActionButton icon="zoom-to-fit" label={ko.actions.fitView} disabled={!definition} onClick={() => void flowRef.current?.fitView({ duration: 200, padding: 0.2 })} />
              <MacroActionButton icon="floppy-disk" label={ko.actions.save} tooltip={saveButtonTooltip(lastSavedAt)} intent="primary" disabled={!definition || busy} onClick={saveMacro} />
              <MacroActionButton
                minimal
                icon="cross"
                label="확대 화면 닫기"
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
            gridTemplateColumns: `${expandedLayout.blueprintWidth}px ${EXPANDED_SPLITTER_WIDTH}px minmax(${EXPANDED_CANVAS_MIN_WIDTH}px, 1fr) ${EXPANDED_SPLITTER_WIDTH}px ${expandedLayout.inspectorWidth}px`,
          } : undefined}
        >
          <nav className="macro-graph-breadcrumb" aria-label="매크로 그래프 경로">
            {breadcrumbs.map((item, index) => {
              const current = index === breadcrumbs.length - 1
              return (
                <span className="macro-graph-breadcrumb__segment" key={`${item.graphId}-${index}`}>
                  {index > 0 && <span className="macro-graph-breadcrumb__separator" aria-hidden="true">›</span>}
                  {current ? (
                    <span className="macro-graph-breadcrumb__item is-current" aria-current="page" title={item.label}>{item.label}</span>
                  ) : (
                    <button
                      type="button"
                      className="macro-graph-breadcrumb__item"
                      title={item.label}
                      onClick={() => commands.goToBreadcrumb(index)}
                    >{item.label}</button>
                  )}
                </span>
              )
            })}
            {graphNavigationError && (
              <span role="status" className="macro-graph-navigation-error">{graphNavigationError}</span>
            )}
          </nav>
          <div className="macro-sidebar">
            <div className="macro-sidebar__tabs" role="tablist" aria-label="캔버스 탐색기">
              <button type="button" role="tab" aria-selected={sidebarTab === 'blueprint'} onClick={() => setSidebarTab('blueprint')}>My Blueprint</button>
              <button type="button" role="tab" aria-selected={sidebarTab === 'blocks'} onClick={() => setSidebarTab('blocks')}>Blocks</button>
            </div>
            <div hidden={sidebarTab !== 'blueprint'} className="macro-sidebar__panel">
              <MyBlueprintPanel
                definition={definition}
                selection={selectedBlueprint}
                onSelect={commands.selectBlueprint}
                onOpenFunction={commands.openFunction}
                onAddVariable={commands.requestCreateVariable}
                onEditVariable={commands.requestEditVariable}
                onDeleteVariable={commands.requestDeleteVariable}
                onCreateVariableNode={commands.createVariableNode}
                onToggleVariableInput={commands.toggleVariableInput}
                onAddFunction={commands.requestCreateFunction}
                onRenameFunction={commands.requestRenameFunction}
                onDuplicateFunction={commands.duplicateFunction}
                onDeleteFunction={commands.requestDeleteFunction}
              />
            </div>
            <div hidden={sidebarTab !== 'blocks'} className="macro-sidebar__panel">
              <BlockPalette onAdd={commands.createNode} />
            </div>
          </div>
          {canvasExpanded && (
            <div
              className="macro-canvas-expanded-splitter is-palette-splitter"
              role="separator"
              aria-label="My Blueprint/Blocks와 캔버스 크기 조절"
              aria-orientation="vertical"
              aria-valuemin={EXPANDED_BLUEPRINT_MIN_WIDTH}
              aria-valuemax={EXPANDED_BLUEPRINT_MAX_WIDTH}
              aria-valuenow={expandedLayout.blueprintWidth}
              onPointerDown={(event) => beginExpandedResize('blueprint', event)}
              onDoubleClick={() => resetExpandedWidth('blueprint')}
            />
          )}
          {definition ? (
            <MacroCanvas
            nodes={shownNodes}
            edges={shownEdges}
            onNodesChange={commands.changeNodes}
            onEdgesChange={commands.changeEdges}
            onConnect={commands.connectPorts}
            onSelectNode={commands.selectNode}
            onDropBlock={commands.createNode}
            onDropBlueprintItem={commands.createNodeFromBlueprint}
            onPromoteToVariable={commands.requestPromoteVariable}
            quickSearchItems={quickSearchItems}
            variables={definition.variables ?? []}
            onUpdateNodeConfig={(nodeId, config) => {
              commands.updateNodeConfig(nodeId, config)
            }}
            dialogOpen={editorDialogOpen}
            onOpenFunction={commands.openFunction}
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
              aria-valuemin={EXPANDED_INSPECTOR_MIN_WIDTH}
              aria-valuemax={EXPANDED_INSPECTOR_MAX_WIDTH}
              aria-valuenow={expandedLayout.inspectorWidth}
              onPointerDown={(event) => beginExpandedResize('inspector', event)}
              onDoubleClick={() => resetExpandedWidth('inspector')}
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
              onEditVariable={commands.requestEditVariable}
              onDeleteVariable={commands.requestDeleteVariable}
              onRenameFunction={commands.requestRenameFunction}
              onUpdateFunctionPorts={commands.updateFunctionPorts}
              onOpenFunction={commands.openFunction}
              onDeleteFunction={commands.requestDeleteFunction}
            />
          ) : <NodeInspector
          node={selectedNode}
          connectedInputIds={selectedConnectedInputIds}
          runtimeError={selectedRuntimeError}
          onFocusErrorNode={(nodeId) => {
            if (selectedRuntimeError) setPendingErrorFocus({ ...selectedRuntimeError, node_id: nodeId, screen_id: null })
          }}
          issues={issues.filter((item) => item.nodeId === selectedNodeId)}
          onUpdateConfig={(config) => {
            if (!selectedNodeId) return
            commands.updateNodeConfig(selectedNodeId, config)
          }}
          onUpdateLabel={(label) => {
            if (!selectedNodeId) return
            commands.updateNodeLabel(selectedNodeId, label)
          }}
          onSetEntry={() => undefined}
          onDelete={commands.deleteSelectedNode}
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
              onPause={() => void commands.executeRuntime('pause')}
              onResume={() => void commands.executeRuntime('resume')}
              onStep={() => void commands.executeRuntime('step')}
              onStop={() => void commands.executeRuntime('stop')}
              onReset={() => void commands.executeRuntime('reset')}
              onTraceError={requestErrorFocus}
            />
          ) : (
            <MacroExecutionPanel
              definitions={definitions}
              deviceId={deviceId}
              boundMacroId={boundMacroId}
              runtime={runtime}
              busy={busy}
              onRun={setRunSetupMacro}
              onPause={() => void commands.executeRuntime('pause')}
              onResume={() => void commands.executeRuntime('resume')}
              onStop={() => void commands.executeRuntime('stop')}
              onDetail={() => setRuntimeDetailOpen(true)}
              onEdit={commands.editMacro}
              onRename={commands.requestRenameMacro}
              onDuplicate={(macro) => void commands.duplicateMacro(macro)}
              onDelete={commands.requestDeleteMacro}
              onUnbind={() => commands.discardOrRun(() => commands.selectMacro(''))}
              onCreate={commands.requestCreateMacro}
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
            const started = await commands.runMacro(runSetupMacro, inputVariables)
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
          onSubmit={commands.submitVariable}
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
          onSubmit={commands.submitName}
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
  onUnbind,
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
  onUnbind: () => void
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
            const currentNodeId = runtime.graphOverlay.currentNodeId ?? snapshot?.current_node_id
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
                    {hasRuntime ? (
                      <button
                        type="button"
                        className={`macro-status macro-status--${state}`}
                        title="실행 정보 보기"
                        aria-label={`${macro.name} 실행 정보 보기`}
                        disabled={busy}
                        onClick={onDetail}
                      >
                        <i aria-hidden="true" />
                        {runtimeStateLabels[state] ?? state}
                      </button>
                    ) : (
                      <span className={`macro-status macro-status--${state}`}>
                        <i aria-hidden="true" />
                        {runtimeStateLabels[state] ?? state}
                      </span>
                    )}
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
                  <MacroActionButton
                    icon="edit"
                    label="편집"
                    disabled={busy}
                    onClick={() => onEdit(macro)}
                  />
                  {isRunning ? (
                    <MacroActionButton icon="pause" label={ko.actions.pause} disabled={busy} onClick={onPause} />
                  ) : isPaused ? (
                    <MacroActionButton icon="play" label={ko.actions.resume} intent="success" disabled={busy} onClick={onResume} />
                  ) : (
                    <MacroActionButton
                      icon="play"
                      label={ko.actions.run}
                      intent="success"
                      disabled={busy || Boolean(snapshot && ['running', 'paused'].includes(snapshot.state))}
                      onClick={() => onRun(macro)}
                    />
                  )}
                  {isActive && <MacroActionButton icon="stop" label={ko.actions.stop} intent="danger" disabled={busy} onClick={onStop} />}
                  <details className="integrated-macro-card__menu">
                    <summary aria-label="더보기" title="더보기"><Icon icon="more" /></summary>
                    <div>
                      <button type="button" disabled={busy} onClick={() => onRename(macro)}>이름 변경</button>
                      <button type="button" disabled={busy} onClick={() => onDuplicate(macro)}>복제</button>
                      <button className="is-danger" type="button" disabled={busy} onClick={() => onDelete(macro)}>삭제</button>
                      <button type="button" disabled={busy || boundMacroId !== macro.id || isActive} onClick={onUnbind}>바인딩 해제</button>
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
  onTraceError,
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
  onTraceError: (trace: RuntimeTrace) => void
}) {
  const [detailTab, setDetailTab] = useState<'variables' | 'trace'>('variables')
  const snapshot = runtime.runtime
  const variableEntries = Object.entries(snapshot?.variables ?? {})
  const trace = runtime.graphOverlay.traces
  const activeScreen = runtime.graphOverlay.activeScreenId
    ? screenLabel(runtime.graphOverlay.activeScreenId)
    : '—'
  const currentNodeId = runtime.graphOverlay.currentNodeId ?? snapshot?.current_node_id
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
                  const graphId = traceGraphPath(entry).at(-1)
                  const traceNodes = graphId ? macro?.functions?.find((item) => item.id === graphId)?.nodes : macro?.nodes
                  const traceNode = traceNodes?.find((node) => node.id === nodeId)
                  const nodeLabel = traceNode
                    ? traceNode.label ?? BLOCK_BY_TYPE.get(traceNode.type)?.label ?? traceNode.type
                    : nodeId ?? '—'
                  const traceState = runtimeTraceString(entry, 'status')
                  const error = traceErrorMessage(entry)
                  return (
                    <tr
                      key={`${nodeId ?? 'trace'}-${index}`}
                      className={error ? 'runtime-trace-error' : undefined}
                      tabIndex={error ? 0 : undefined}
                      aria-label={error ? `${nodeId} 오류 위치로 이동` : undefined}
                      onClick={error ? () => onTraceError(entry) : undefined}
                      onKeyDown={error ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onTraceError(entry)
                        }
                      } : undefined}
                    >
                      <td>{typeof entry.step === 'number' ? entry.step : index + 1}</td>
                      <td><strong>{nodeLabel}</strong>{nodeId && <small>{nodeId}</small>}</td>
                      <td>{traceState ? runtimeStateLabels[traceState] ?? traceState : '—'}</td>
                      <td>{formatRuntimeTimestamp(runtimeTraceString(entry, 'started_at'))}</td>
                      <td>{formatRuntimeTimestamp(runtimeTraceString(entry, 'completed_at'))}</td>
                      <td className={error ? 'has-error' : ''}>
                        {error ?? '—'}
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

function screenLabel(screenId: string) {
  const canonicalId = canonicalScreenId(screenId)
  return SEMANTIC_SCREEN_OPTIONS.find((screen) => screen.id === canonicalId)?.label ?? canonicalId
}
