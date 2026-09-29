// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyMacroDefinition } from '../definition-factory'
import type { JsonValue, MacroNodeType } from '../types'
import type { EditorCommandDependencies, EditorCommandRecord } from './useEditorCommands'
import { useEditorCommands } from './useEditorCommands'

function dependencies(overrides: Partial<EditorCommandDependencies> = {}) {
  const definition = {
    ...createEmptyMacroDefinition(),
    variables: [{ name: 'count', type: 'int' as const, default: 0 }],
  }
  const graph = {
    addNode: vi.fn((
      type: MacroNodeType,
      _position?: { x: number; y: number },
      config?: Record<string, JsonValue>,
    ) => ({ id: `${type}-1`, type, config: config ?? {} })),
    addConnection: vi.fn(),
    updateNode: vi.fn(),
    deleteNode: vi.fn(),
    deleteSelected: vi.fn(),
    changeNodes: vi.fn(),
    changeEdges: vi.fn(),
    mapGraphs: vi.fn(),
  }
  const deps = {
    deviceId: 'phone-a', definition, setDefinition: vi.fn(), definitions: [definition],
    graphs: { main: { nodes: [], edges: [] } }, graph,
    functions: {
      createFunction: vi.fn(), createFunctionNamed: vi.fn(), renameFunction: vi.fn(),
      deleteFunction: vi.fn(), duplicateFunction: vi.fn(), updateFunctionPorts: vi.fn(),
      updateFunctionName: vi.fn(),
    },
    document: {
      definitionForSave: definition, save: vi.fn(), selectMacroNow: vi.fn(),
      createNewNamed: vi.fn(), renameMacroNamed: vi.fn(), duplicateMacro: vi.fn(),
      deleteMacroNow: vi.fn(), loadDefinition: vi.fn(),
    },
    validation: { validateDefinition: vi.fn() },
    runtime: { runtime: null, refresh: vi.fn() },
    dirty: false, isNew: false, selectedVariableName: '', selectedBlueprint: null,
    selectedNodeId: null, variableDialog: null, nameDialog: null, boundMacroId: null,
    setBoundMacroId: vi.fn(), setSelectedVariableName: vi.fn(), setSelectedBlueprint: vi.fn(),
    setSelectedNodeId: vi.fn(), setSelectedScreenId: vi.fn(), setPanelTab: vi.fn(),
    setRuntimeDetailOpen: vi.fn(), setCanvasExpansion: vi.fn(), setVariableDialog: vi.fn(),
    setNameDialog: vi.fn(), setConfirmDialog: vi.fn(), setRunSetupMacro: vi.fn(),
    setBusy: vi.fn(), setMessage: vi.fn(), setMessageIntent: vi.fn(),
    openMain: vi.fn(), openFunction: vi.fn(), openPath: vi.fn(), goBack: vi.fn(),
    goToBreadcrumb: vi.fn(), guardUnsavedChanges: vi.fn(),
    markChanged: vi.fn(), selectedScreenId: 'reservation_home',
    ...overrides,
  } as unknown as EditorCommandDependencies
  return { deps, graph }
}

describe('useEditorCommands', () => {
  it('routes graph mutations through one dirty/validation transaction boundary', () => {
    const committed: EditorCommandRecord[] = []
    const onCommandCommitted = (record: EditorCommandRecord) => { committed.push(record) }
    const { deps, graph } = dependencies({ onCommandCommitted })
    const { result } = renderHook(() => useEditorCommands(deps))

    act(() => { result.current.createNode('wait', { x: 10, y: 20 }) })
    expect(graph.addNode).toHaveBeenCalledWith('wait', { x: 10, y: 20 }, undefined, undefined)
    expect(deps.markChanged).toHaveBeenCalledTimes(1)

    act(() => result.current.changeNodes([{ type: 'select', id: 'wait-1', selected: true }]))
    expect(deps.markChanged).toHaveBeenCalledTimes(1)
    act(() => result.current.changeNodes([{ type: 'position', id: 'wait-1', position: { x: 20, y: 30 } }]))
    expect(deps.markChanged).toHaveBeenCalledTimes(2)
    expect(committed.map((record) => record.name)).toEqual([
      'create-node', 'change-nodes',
    ])
  })

  it('atomically creates a promoted variable, node, connection, and selection', () => {
    const variableDialog = {
      mode: 'promote' as const,
      suggestedName: 'enabled', suggestedType: 'bool' as const,
      port: { nodeId: 'branch-1', portId: 'condition', portType: 'bool' as const, direction: 'input' as const },
      position: { x: 50, y: 60 },
    }
    const { deps, graph } = dependencies({ variableDialog })
    const { result } = renderHook(() => useEditorCommands(deps))

    act(() => result.current.submitVariable({ name: 'enabled', type: 'bool', default: false }))

    expect(deps.setDefinition).toHaveBeenCalled()
    expect(graph.addNode).toHaveBeenCalledWith(
      'get_variable', { x: 50, y: 60 },
      { name: 'enabled', type: 'bool' }, 'enabled',
    )
    expect(graph.addConnection).toHaveBeenCalledWith({
      source: 'get_variable-1', sourceHandle: 'value',
      target: 'branch-1', targetHandle: 'condition',
    }, 'data')
    expect(deps.setSelectedBlueprint).toHaveBeenCalledWith({ kind: 'variable', id: 'enabled' })
    expect(deps.setVariableDialog).toHaveBeenCalledWith(null)
  })
})
