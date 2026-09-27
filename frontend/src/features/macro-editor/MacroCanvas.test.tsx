// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MacroCanvas } from './MacroCanvas'
import { BLOCK_BY_TYPE, cloneDefaultConfig } from './blocks'
import {
  blockSupportsPortContext,
  connectionForCreatedNode,
  connectionKind,
  sourcePortContext,
} from './port-compatibility'
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
      flowNode('semantic', 'find_screen_element'),
      flowNode('find', 'find_element'),
      flowNode('click', 'click_element'),
      flowNode('debug', 'debug_print'),
    ]

    expect(connectionKind(typedNodes, {
      source: 'exists', sourceHandle: 'result', target: 'branch', targetHandle: 'condition',
    })).toBe('data')
    expect(connectionKind(typedNodes, {
      source: 'for', sourceHandle: 'index', target: 'semantic', targetHandle: 'index',
    })).toBe('data')
    expect(connectionKind(typedNodes, {
      source: 'semantic', sourceHandle: 'element', target: 'click', targetHandle: 'element',
    })).toBe('data')
    expect(connectionKind(typedNodes, {
      source: 'semantic', sourceHandle: 'found', target: 'branch', targetHandle: 'condition',
    })).toBe('data')
    expect(connectionKind(typedNodes, {
      source: 'find', sourceHandle: 'element', target: 'click', targetHandle: 'element',
    })).toBe('data')
    expect(connectionKind(typedNodes, {
      source: 'for', sourceHandle: 'index', target: 'branch', targetHandle: 'condition',
    })).toBeNull()
    expect(connectionKind(typedNodes, {
      source: 'for', sourceHandle: 'index', target: 'debug', targetHandle: 'value',
    })).toBe('data')
    expect(connectionKind(typedNodes, {
      source: 'exists', sourceHandle: 'result', target: 'debug', targetHandle: 'value',
    })).toBe('data')
    expect(connectionKind(typedNodes, {
      source: 'exists', sourceHandle: 'exec_out', target: 'branch', targetHandle: 'exec_in',
    })).toBe('exec')
  })

  it('resolves typed drag contexts and creates connections in both directions', () => {
    const typedNodes = [
      flowNode('find', 'find_element'),
      flowNode('branch', 'branch'),
      flowNode('for', 'for_loop'),
    ]
    const elementOutput = sourcePortContext(typedNodes, 'find', 'element', 'source')!
    const clickBlock = BLOCK_BY_TYPE.get('click_element')!
    const pointBlock = BLOCK_BY_TYPE.get('click_point')!
    expect(blockSupportsPortContext(clickBlock, elementOutput)).toBe(true)
    expect(blockSupportsPortContext(pointBlock, elementOutput)).toBe(false)
    expect(connectionForCreatedNode(elementOutput, {
      id: 'click-1',
      type: 'click_element',
      config: cloneDefaultConfig('click_element'),
    })).toEqual({
      connection: {
        source: 'find',
        sourceHandle: 'element',
        target: 'click-1',
        targetHandle: 'element',
      },
      kind: 'data',
    })

    const boolInput = sourcePortContext(typedNodes, 'branch', 'condition', 'target')!
    expect(connectionForCreatedNode(boolInput, {
      id: 'exists-1',
      type: 'element_exists',
      config: cloneDefaultConfig('element_exists'),
    })).toEqual({
      connection: {
        source: 'exists-1',
        sourceHandle: 'result',
        target: 'branch',
        targetHandle: 'condition',
      },
      kind: 'data',
    })

    const intOutput = sourcePortContext(typedNodes, 'for', 'index', 'source')!
    expect(connectionForCreatedNode(intOutput, {
      id: 'semantic-1',
      type: 'find_screen_element',
      config: cloneDefaultConfig('find_screen_element'),
    })?.connection.targetHandle).toBe('index')

    const execOutput = sourcePortContext(typedNodes, 'find', 'exec_out', 'source')!
    expect(connectionForCreatedNode(execOutput, {
      id: 'branch-1',
      type: 'branch',
      config: cloneDefaultConfig('branch'),
    })).toEqual({
      connection: {
        source: 'find',
        sourceHandle: 'exec_out',
        target: 'branch-1',
        targetHandle: 'exec_in',
      },
      kind: 'exec',
    })
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

    expect(screen.getByText('뒤로')).toBeTruthy()
    expect(screen.getByText('레거시 시작점')).toBeTruthy()
  })

  it('renders readable left inputs, right outputs, typed data ports, and output-only events', () => {
    const forNode = flowNode('for', 'for_loop')
    forNode.data.label = 'For'
    const eventNode: MacroFlowNode = {
      ...flowNode('home-enter', 'screen_enter'),
      type: 'event',
      data: {
        ...flowNode('home-enter', 'screen_enter').data,
        category: 'event',
        label: 'Reservation Home / Enter',
        isEvent: true,
        eventKind: 'enter',
      },
    }
    render(
      <div style={{ width: 800, height: 600 }}>
        <MacroCanvas
          nodes={[forNode, eventNode]}
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

    const renderedFor = screen.getByLabelText('For 반복 매크로 노드')
    expect(within(renderedFor).getByText('반복')).toBeTruthy()
    expect(within(renderedFor).getByText('인덱스')).toBeTruthy()
    expect(within(renderedFor).getByText('완료')).toBeTruthy()
    expect(renderedFor.querySelectorAll('.react-flow__handle-left')).toHaveLength(1)
    expect(renderedFor.querySelectorAll('.react-flow__handle-right')).toHaveLength(3)
    expect(renderedFor.querySelector('[data-port-type="int"]')?.textContent).toContain('정수')

    const renderedEvent = screen.getByLabelText('스터디룸 예약 메인 / 화면 진입 매크로 노드')
    expect(renderedEvent.querySelectorAll('.react-flow__handle-left')).toHaveLength(0)
    expect(renderedEvent.querySelectorAll('.react-flow__handle-right')).toHaveLength(1)
    expect(within(renderedEvent).getByText('실행')).toBeTruthy()
    expect(within(renderedEvent).getByText('진입')).toBeTruthy()
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
    expect(await screen.findByRole('dialog', { name: '빠른 블록 검색' })).toBeTruthy()
    convert.mockReturnValue({ x: 999, y: 999 })
    fireEvent.change(screen.getByLabelText('매크로 블록 검색'), { target: { value: 'click point' } })
    fireEvent.click(screen.getByText('위치 클릭'))

    expect(onDropBlock).toHaveBeenCalledWith('click_point', { x: 42, y: 84 })
    expect(screen.queryByRole('dialog', { name: '빠른 블록 검색' })).toBeNull()
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
    expect(screen.queryByRole('dialog', { name: '빠른 블록 검색' })).toBeNull()
  })

})

function flowNode(id: string, nodeType: MacroFlowNode['data']['nodeType']): MacroFlowNode {
  const category = nodeType === 'branch' || nodeType === 'for_loop'
    ? 'control'
    : nodeType === 'debug_print'
      ? 'validation'
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
