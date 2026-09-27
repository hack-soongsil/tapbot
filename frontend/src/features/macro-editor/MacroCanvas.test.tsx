// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MacroCanvas } from './MacroCanvas'
import { connectionKind } from './port-compatibility'
import type { ReactFlowInstance } from '@xyflow/react'
import type { MacroFlowEdge, MacroFlowNode } from './types'

class ResizeObserverStub implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const node: MacroFlowNode = {
  id: 'back-1',
  type: 'action',
  position: { x: 100, y: 100 },
  data: {
    nodeType: 'back',
    category: 'action',
    label: 'Back',
    config: {},
    isEntry: true,
    errors: [],
  },
}

describe('MacroCanvas', () => {
  it('accepts only equal typed data ports and exec-to-exec connections', () => {
    const typedNodes: MacroFlowNode[] = [
      flowNode('exists', 'element_exists'),
      flowNode('branch', 'branch'),
      flowNode('for', 'for_loop'),
      flowNode('semantic', 'click_screen_element'),
      flowNode('find', 'find_element'),
      flowNode('click', 'click_element'),
    ]

    expect(connectionKind(typedNodes, {
      source: 'exists', sourceHandle: 'result', target: 'branch', targetHandle: 'condition',
    })).toBe('data')
    expect(connectionKind(typedNodes, {
      source: 'for', sourceHandle: 'index', target: 'semantic', targetHandle: 'index',
    })).toBe('data')
    expect(connectionKind(typedNodes, {
      source: 'find', sourceHandle: 'element', target: 'click', targetHandle: 'element',
    })).toBe('data')
    expect(connectionKind(typedNodes, {
      source: 'for', sourceHandle: 'index', target: 'branch', targetHandle: 'condition',
    })).toBeNull()
    expect(connectionKind(typedNodes, {
      source: 'exists', sourceHandle: 'exec_out', target: 'branch', targetHandle: 'exec_in',
    })).toBe('exec')
  })

  it('renders registered React Flow macro nodes', () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <MacroCanvas
          nodes={[node]}
          edges={[]}
          onNodesChange={vi.fn()}
          onEdgesChange={vi.fn()}
          onConnect={vi.fn()}
          onSelectNode={vi.fn()}
          onDropBlock={vi.fn()}
          onReady={vi.fn()}
        />
      </div>,
    )

    expect(screen.getByText('Back')).toBeTruthy()
    expect(screen.getByText('LEGACY ENTRY')).toBeTruthy()
  })

  it('opens only from the pane and creates a block at the captured flow position', async () => {
    const onDropBlock = vi.fn()
    let instance: ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null = null
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <MacroCanvas
          nodes={[]}
          edges={[]}
          onNodesChange={vi.fn()}
          onEdgesChange={vi.fn()}
          onConnect={vi.fn()}
          onSelectNode={vi.fn()}
          onDropBlock={onDropBlock}
          onReady={(next) => { instance = next }}
        />
      </div>,
    )
    await waitFor(() => expect(instance).not.toBeNull())
    const convert = vi.spyOn(instance!, 'screenToFlowPosition').mockReturnValue({ x: 42, y: 84 })
    const pane = container.querySelector<HTMLElement>('.react-flow__pane')!
    const contextMenu = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 300,
      clientY: 220,
    })
    pane.dispatchEvent(contextMenu)

    expect(contextMenu.defaultPrevented).toBe(true)
    expect(convert).toHaveBeenCalledWith({ x: 300, y: 220 })
    expect(await screen.findByRole('dialog', { name: 'Quick block search' })).toBeTruthy()
    convert.mockReturnValue({ x: 999, y: 999 })
    fireEvent.change(screen.getByLabelText('Search macro blocks'), { target: { value: 'click point' } })
    fireEvent.click(screen.getByText('Click Point'))

    expect(onDropBlock).toHaveBeenCalledWith('click_point', { x: 42, y: 84 })
    expect(screen.queryByRole('dialog', { name: 'Quick block search' })).toBeNull()
  })

  it('does not open quick search when a node is right-clicked', async () => {
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <MacroCanvas
          nodes={[node]}
          edges={[]}
          onNodesChange={vi.fn()}
          onEdgesChange={vi.fn()}
          onConnect={vi.fn()}
          onSelectNode={vi.fn()}
          onDropBlock={vi.fn()}
          onReady={vi.fn()}
        />
      </div>,
    )
    await waitFor(() => expect(container.querySelector('.react-flow__node')).not.toBeNull())
    fireEvent.contextMenu(container.querySelector('.react-flow__node')!)
    expect(screen.queryByRole('dialog', { name: 'Quick block search' })).toBeNull()
  })
})

function flowNode(id: string, nodeType: MacroFlowNode['data']['nodeType']): MacroFlowNode {
  const category = nodeType === 'branch' || nodeType === 'for_loop'
    ? 'control'
    : nodeType === 'element_exists'
      ? 'condition'
      : nodeType === 'find_element'
        ? 'ui'
        : 'action'
  return {
    id,
    type: category,
    position: { x: 0, y: 0 },
    data: {
      nodeType,
      category,
      label: id,
      config: nodeType === 'for_loop' ? { outputs: 2 } : {},
      isEntry: false,
      errors: [],
    },
  }
}
