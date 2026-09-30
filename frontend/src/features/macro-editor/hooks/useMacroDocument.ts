import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import { macroEditorApi } from '../api'
import { createEmptyMacroDefinition, MACRO_DRAFT_STORAGE_KEY } from '../definition-factory'
import {
  migrateLegacyEntry,
} from '../graph-converters'
import { normalizeDefinitionGraphs, serializeDefinitionGraphs } from '../graph-store-converters'
import { synchronizeFunctionCalls } from '../function-model'
import {
  EMPTY_GRAPH,
  type GraphFlow,
  type GraphId,
} from '../graph-store'
import {
  clearDeviceDraft,
  deriveNodeScreens,
  persistDeviceDraft,
  readDeviceDraft,
  serializeNodeScreens,
  synchronizeVariableNodes,
} from '../macro-document-model'
import type { MacroValidationState } from './useMacroValidation'
import type { RuntimeTrace } from '../runtime-trace'
import type { MacroDefinition, ValidationIssue } from '../types'
import { withPersistedSaveTimestamp } from '../save-timestamp'

type MessageIntent = 'primary' | 'success' | 'warning' | 'danger'

function showError(
  error: unknown,
  fallback: string,
  setMessage: Dispatch<SetStateAction<string | null>>,
  setMessageIntent: Dispatch<SetStateAction<MessageIntent>>,
) {
  setMessage(error instanceof Error ? error.message : fallback)
  setMessageIntent('danger')
}

export function useMacroDocument({
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
}: {
  deviceId: string
  setDefinitions: Dispatch<SetStateAction<MacroDefinition[]>>
  definition: MacroDefinition | null
  setDefinition: Dispatch<SetStateAction<MacroDefinition | null>>
  graphs: Record<string, GraphFlow>
  replaceGraphs: (graphs: Record<string, GraphFlow>, activeGraphId?: GraphId) => void
  nodeScreens: Record<string, string>
  setNodeScreens: Dispatch<SetStateAction<Record<string, string>>>
  dirty: boolean
  setDirty: Dispatch<SetStateAction<boolean>>
  isNew: boolean
  setIsNew: Dispatch<SetStateAction<boolean>>
  setBusy: Dispatch<SetStateAction<boolean>>
  setMessage: Dispatch<SetStateAction<string | null>>
  setMessageIntent: Dispatch<SetStateAction<MessageIntent>>
  setBoundMacroId: Dispatch<SetStateAction<string | null>>
  issues: ValidationIssue[]
  setIssues: Dispatch<SetStateAction<ValidationIssue[]>>
  validationState: MacroValidationState
  setValidationState: Dispatch<SetStateAction<MacroValidationState>>
  setRuntimeErrorTrace: Dispatch<SetStateAction<RuntimeTrace | null>>
  resetGraphNavigation: () => void
  clearGraph: () => void
  setSelectedVariableName: Dispatch<SetStateAction<string>>
  setSelectedBlueprint: Dispatch<SetStateAction<null | { kind: 'variable' | 'function'; id: string }>>
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
  setPanelTab: Dispatch<SetStateAction<'canvas' | 'execution'>>
}) {
  const loadDefinition = useCallback((source: MacroDefinition, newDefinition = false) => {
    setRuntimeErrorTrace(null)
    const next = synchronizeVariableNodes(synchronizeFunctionCalls(migrateLegacyEntry(source)))
    const nextGraphs = normalizeDefinitionGraphs(next)
    const flow = nextGraphs.main ?? EMPTY_GRAPH
    setDefinition(next)
    replaceGraphs(nextGraphs)
    resetGraphNavigation()
    setSelectedVariableName(next.variables?.[0]?.name ?? '')
    setSelectedBlueprint(null)
    setNodeScreens(deriveNodeScreens(next, flow.nodes, flow.edges))
    setSelectedNodeId(null)
    setIssues([])
    setDirty(false)
    setValidationState({ status: 'unknown', errorCount: 0 })
    setIsNew(newDefinition)
  }, [replaceGraphs, resetGraphNavigation, setDefinition, setDirty, setIsNew, setIssues, setNodeScreens, setRuntimeErrorTrace, setSelectedBlueprint, setSelectedNodeId, setSelectedVariableName, setValidationState])

  const definitionForSave = useMemo(() => {
    if (!definition) return null
    const mainGraph = graphs.main
    return synchronizeVariableNodes(synchronizeFunctionCalls(serializeDefinitionGraphs({
      ...definition,
      metadata: {
        ...definition.metadata,
        editor_screen_node_ids: serializeNodeScreens(nodeScreens, mainGraph?.nodes ?? []),
      },
    }, graphs)))
  }, [definition, graphs, nodeScreens])

  useEffect(() => {
    let active = true
    void Promise.all([macroEditorApi.list(), macroEditorApi.binding(deviceId)])
      .then(async ([listed, binding]) => {
        if (!active) return
        setDefinitions(listed.macros)
        setBoundMacroId(binding.binding?.macro_definition_id ?? null)
        const draft = readDeviceDraft(deviceId)
        const draftMatchesBinding = draft && (
          (draft.isNew && !binding.binding)
          || draft.definition.id === binding.binding?.macro_definition_id
        )
        if (draft && draftMatchesBinding) {
          loadDefinition(draft.definition, draft.isNew)
          setDirty(true)
          return
        }
        if (!binding.binding) {
          setDefinition(null)
          clearGraph()
          resetGraphNavigation()
          return
        }
        const next = await macroEditorApi.get(binding.binding.macro_definition_id)
        if (active) loadDefinition(next)
      })
      .catch((error: unknown) => {
        if (active) showError(error, '매크로를 불러오지 못했습니다.', setMessage, setMessageIntent)
      })
    return () => { active = false }
  }, [clearGraph, deviceId, loadDefinition, resetGraphNavigation, setBoundMacroId, setDefinition, setDefinitions, setDirty, setMessage, setMessageIntent])

  useEffect(() => {
    if (!definitionForSave || (!dirty && !isNew)) return
    persistDeviceDraft(deviceId, { definition: definitionForSave, isNew })
  }, [definitionForSave, deviceId, dirty, isNew])

  const save = useCallback(async () => {
    if (!definitionForSave) return null
    const priorValidation = validationState
    const priorIssues = issues
    setBusy(true)
    window.localStorage.setItem(MACRO_DRAFT_STORAGE_KEY, JSON.stringify(definitionForSave))
    try {
      const saved = withPersistedSaveTimestamp(isNew
        ? await macroEditorApi.create(definitionForSave)
        : await macroEditorApi.save(definitionForSave))
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
      setDefinitions((current) => [...current.filter((item) => item.id !== saved.id), saved])
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
  }, [definitionForSave, deviceId, isNew, issues, loadDefinition, setBoundMacroId, setBusy, setDefinitions, setIssues, setMessage, setMessageIntent, setValidationState, validationState])

  const selectMacroNow = useCallback(async (macroId: string) => {
    setBusy(true)
    try {
      if (!macroId) {
        await macroEditorApi.unbind(deviceId)
        setBoundMacroId(null)
        clearDeviceDraft(deviceId)
        setDefinition(null)
        clearGraph()
        resetGraphNavigation()
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
  }, [clearGraph, deviceId, loadDefinition, resetGraphNavigation, setBoundMacroId, setBusy, setDefinition, setMessage, setMessageIntent, setSelectedNodeId, setSelectedVariableName])

  const createNewNamed = useCallback(async (name: string) => {
    const suffix = Date.now().toString(36)
    setBusy(true)
    setMessage(null)
    try {
      const created = withPersistedSaveTimestamp(
        await macroEditorApi.create(createEmptyMacroDefinition(`macro-${suffix}`, name)),
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
  }, [deviceId, loadDefinition, setBoundMacroId, setBusy, setDefinitions, setMessage, setMessageIntent, setPanelTab])

  const renameMacroNamed = useCallback(async (macro: MacroDefinition, name: string) => {
    if (name === macro.name) return
    setBusy(true)
    setMessage(null)
    try {
      const saved = withPersistedSaveTimestamp(await macroEditorApi.save({ ...macro, name }))
      setDefinitions((current) => current.map((item) => item.id === saved.id ? saved : item))
      if (definition?.id === saved.id) {
        if (dirty) setDefinition((current) => current ? {
          ...current,
          name: saved.name,
          version: saved.version,
          metadata: saved.metadata,
        } : current)
        else loadDefinition(saved)
      }
      setMessage(`${macro.name}의 이름을 ${saved.name}(으)로 변경했습니다.`)
      setMessageIntent('success')
    } catch (error) {
      showError(error, '매크로 이름을 변경하지 못했습니다.', setMessage, setMessageIntent)
    } finally {
      setBusy(false)
    }
  }, [definition, dirty, loadDefinition, setBusy, setDefinition, setDefinitions, setMessage, setMessageIntent])

  const duplicateMacro = useCallback(async (macro: MacroDefinition) => {
    setBusy(true)
    setMessage(null)
    try {
      const copy = withPersistedSaveTimestamp(
        await macroEditorApi.duplicate(macro.id, { name: `${macro.name} 복사본` }),
      )
      setDefinitions((current) => [...current, copy])
      setMessage(`${macro.name} 매크로를 복제했습니다.`)
      setMessageIntent('success')
    } catch (error) {
      showError(error, '매크로를 복제하지 못했습니다.', setMessage, setMessageIntent)
    } finally {
      setBusy(false)
    }
  }, [setBusy, setDefinitions, setMessage, setMessageIntent])

  const deleteMacroNow = useCallback(async (macro: MacroDefinition, boundMacroId: string | null) => {
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
        clearGraph()
        resetGraphNavigation()
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
  }, [clearGraph, definition, deviceId, resetGraphNavigation, setBoundMacroId, setBusy, setDefinition, setDefinitions, setMessage, setMessageIntent, setSelectedNodeId, setSelectedVariableName])

  return {
    definitionForSave,
    loadDefinition,
    save,
    selectMacroNow,
    createNewNamed,
    renameMacroNamed,
    duplicateMacro,
    deleteMacroNow,
  }
}
