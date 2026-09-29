// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyMacroDefinition } from '../definition-factory'
import { functionGraphId, MAIN_GRAPH_ID } from '../graph-store'
import { useGraphEditor } from './useGraphEditor'

describe('useGraphEditor', () => {
  it('uses the same mutation API for main and function graphs', () => {
    const setSelectedNodeId = vi.fn()
    const definition = createEmptyMacroDefinition()
    const { result } = renderHook(() => useGraphEditor({
      definition,
      selectedScreenId: 'reservation_home',
      selectedNodeId: null,
      setSelectedNodeId,
    }))
    const functionId = functionGraphId('reserve')

    act(() => result.current.replaceGraphs({
      [MAIN_GRAPH_ID]: { nodes: [], edges: [] },
      [functionId]: { nodes: [], edges: [] },
    }))
    act(() => {
      result.current.addNode('wait', { x: 10, y: 20 }, undefined, undefined, MAIN_GRAPH_ID)
      result.current.addNode('wait', { x: 30, y: 40 }, undefined, undefined, functionId)
    })
    act(() => {
      result.current.addNode('wait', { x: 50, y: 60 }, undefined, undefined, functionId)
      result.current.connect({
        source: 'wait-1', sourceHandle: null, target: 'wait-2', targetHandle: null,
      }, 'exec', functionId)
    })

    expect(result.current.getGraph(MAIN_GRAPH_ID).nodes).toHaveLength(1)
    expect(result.current.getGraph(functionId).nodes).toHaveLength(2)
    expect(result.current.getGraph(functionId).edges).toHaveLength(1)

    act(() => result.current.updateNode('wait-1', (node) => ({
      ...node,
      data: { ...node.data, label: 'Updated' },
    }), functionId))
    expect(result.current.getGraph(functionId).nodes[0]?.data.label).toBe('Updated')

    act(() => result.current.deleteNode('wait-2', functionId))
    expect(result.current.getGraph(functionId).nodes).toHaveLength(1)
    expect(result.current.getGraph(functionId).edges).toHaveLength(0)
  })
})
