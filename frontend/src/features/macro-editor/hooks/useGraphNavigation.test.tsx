// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { functionGraphId, MAIN_GRAPH_ID } from '../graph-store'
import type { MacroDefinition } from '../types'
import { useGraphNavigation } from './useGraphNavigation'

const definition: MacroDefinition = {
  id: 'navigation', name: 'Navigation', version: 1, entry_node_id: 'stop', metadata: {},
  nodes: [{ id: 'stop', type: 'stop', config: {} }], edges: [],
  functions: ['reserve', 'slot'].map((id) => ({
    id, name: id === 'reserve' ? 'Reserve' : 'Slot', inputs: [], outputs: [],
    entry_node_id: `${id}-entry`, return_node_id: `${id}-return`, nodes: [], edges: [],
  })),
}

describe('useGraphNavigation', () => {
  it('keeps GraphId breadcrumbs and the selected graph on one navigation path', () => {
    const setActiveGraphId = vi.fn()
    const { result } = renderHook(() => useGraphNavigation({
      definition,
      activeGraphId: MAIN_GRAPH_ID,
      setActiveGraphId,
      selectedNodeId: null,
      setSelectedNodeId: vi.fn(),
      setSelectedBlueprint: vi.fn(),
      panelTab: 'canvas',
      dialogOpen: false,
    }))

    act(() => result.current.openFunction('reserve'))
    act(() => result.current.openFunction('slot'))
    expect(result.current.breadcrumbs.map((item) => item.graphId)).toEqual([
      MAIN_GRAPH_ID, functionGraphId('reserve'), functionGraphId('slot'),
    ])
    expect(setActiveGraphId).toHaveBeenLastCalledWith(functionGraphId('slot'))

    act(() => result.current.goToBreadcrumb(1))
    expect(result.current.breadcrumbs.map((item) => item.label)).toEqual(['Main', 'Reserve'])
    expect(setActiveGraphId).toHaveBeenLastCalledWith(functionGraphId('reserve'))

    act(() => result.current.openMain())
    expect(result.current.breadcrumbs.map((item) => item.graphId)).toEqual([MAIN_GRAPH_ID])
    expect(setActiveGraphId).toHaveBeenLastCalledWith(MAIN_GRAPH_ID)
  })

  it('rejects deleted function targets without changing the active graph', () => {
    const setActiveGraphId = vi.fn()
    const { result } = renderHook(() => useGraphNavigation({
      definition, activeGraphId: MAIN_GRAPH_ID, setActiveGraphId,
      selectedNodeId: null, setSelectedNodeId: vi.fn(), setSelectedBlueprint: vi.fn(),
      panelTab: 'canvas', dialogOpen: false,
    }))

    act(() => result.current.openFunction('deleted'))
    expect(result.current.graphNavigationError).toContain('deleted')
    expect(result.current.breadcrumbs).toHaveLength(1)
    expect(setActiveGraphId).not.toHaveBeenCalled()
  })
})
