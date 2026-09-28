// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MacroCanvas } from './MacroCanvas'
import { MACRO_BLUEPRINT_MIME } from './blueprint-dnd'
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

    expect(screen.getByText('뒤로')).toBeTruthy()
    expect(screen.getByText('시작점')).toBeTruthy()
    expect(screen.queryByText('back')).toBeNull()
    expect(container.querySelector('.macro-node__type')).toBeNull()
    expect(container.querySelector('.react-flow__pane')?.classList.contains('draggable')).toBe(true)
    expect(container.querySelector('.react-flow__node')?.classList.contains('draggable')).toBe(true)
    expect(container.querySelector('.react-flow__node')?.classList.contains('selectable')).toBe(true)
    expect(container.querySelector('.react-flow__handle')?.classList.contains('connectable')).toBe(true)
  })

  it('renders border-attached pin rows for event and branch nodes', () => {
    const eventNode = flowNode('event', 'screen_enter')
    eventNode.type = 'event'
    eventNode.data.category = 'event'
    eventNode.data.label = '스터디룸 예약 메인 / Enter'
    const branchNode = flowNode('branch-layout', 'branch')
    branchNode.data.label = 'Branch'

    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <MacroCanvas
          nodes={[eventNode, branchNode]}
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

    const event = screen.getByLabelText('스터디룸 예약 메인 / Enter 매크로 노드')
    expect(event.querySelectorAll('.macro-node__pin-row')).toHaveLength(1)
    expect(event.querySelectorAll('[data-port-direction="input"]')).toHaveLength(0)
    expect(event.querySelectorAll('[data-port-direction="output"]')).toHaveLength(1)
    expect(event.querySelector('.react-flow__handle-right')).toBeTruthy()
    expect(event.querySelector('.macro-node__visual-pin--exec')).toBeTruthy()
    expect(event.querySelector('.macro-node__port-hitbox')).toBeTruthy()

    const branch = screen.getByLabelText('분기 매크로 노드')
    expect(branch.querySelectorAll('.macro-node__pin-row')).toHaveLength(2)
    expect(branch.querySelectorAll('[data-port-direction="input"]')).toHaveLength(2)
    expect(branch.querySelectorAll('[data-port-direction="output"]')).toHaveLength(2)
    expect(branch.querySelectorAll('.react-flow__handle-left')).toHaveLength(2)
    expect(branch.querySelectorAll('.react-flow__handle-right')).toHaveLength(2)
    expect(branch.querySelector('[data-port-kind="data"]')).toBeTruthy()
    expect(branch.querySelector('[data-port-kind="exec"]')).toBeTruthy()
    expect(branch.querySelector('.macro-node__visual-pin--data')).toBeTruthy()
    const inputPort = branch.querySelector<HTMLElement>('[data-port-direction="input"]')!
    const outputPort = branch.querySelector<HTMLElement>('[data-port-direction="output"]')!
    expect(inputPort.firstElementChild?.classList.contains('macro-node__port-hitbox')).toBe(true)
    expect(inputPort.children[1]?.classList.contains('macro-node__visual-pin')).toBe(true)
    expect(outputPort.firstElementChild?.classList.contains('macro-node__port-hitbox')).toBe(true)
    expect(outputPort.lastElementChild?.classList.contains('macro-node__visual-pin')).toBe(true)
    expect(container.querySelector('.macro-node__ports')).toBeNull()
    expect(container.querySelector('.macro-node__port-column')).toBeNull()
  })

  it('converts palette drops from screen coordinates into flow coordinates', async () => {
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
    const convert = vi.spyOn(instance!, 'screenToFlowPosition').mockReturnValue({ x: 64, y: 96 })
    const canvas = container.querySelector<HTMLElement>('.react-flow')!
    const dataTransfer = {
      dropEffect: 'none',
      getData: vi.fn().mockReturnValue('click_point'),
    } as unknown as DataTransfer

    fireEvent.dragOver(canvas, { dataTransfer })
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperties(dropEvent, {
      clientX: { value: 420 },
      clientY: { value: 260 },
      dataTransfer: { value: dataTransfer },
    })
    fireEvent(canvas, dropEvent)

    expect(convert).toHaveBeenCalledWith({ x: 420, y: 260 })
    expect(onDropBlock).toHaveBeenCalledWith('click_point', { x: 64, y: 96 })
  })

  it('renders readable left inputs, right outputs, typed data ports, and output-only events', () => {
    const forNode = flowNode('for', 'for_loop')
    forNode.data.label = 'For'
    const branchNode = flowNode('branch', 'branch')
    branchNode.data.label = 'Branch'
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
          nodes={[forNode, branchNode, eventNode]}
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
    expect(renderedFor.querySelector('[data-port-type="int"]')?.getAttribute('title')).toContain('정수')

    const renderedBranch = screen.getByLabelText('분기 매크로 노드')
    expect(within(renderedBranch).getByText('조건')).toBeTruthy()
    expect(within(renderedBranch).getByText('참')).toBeTruthy()
    expect(within(renderedBranch).getByText('거짓')).toBeTruthy()
    expect(renderedBranch.querySelectorAll('.react-flow__handle-left')).toHaveLength(2)
    expect(renderedBranch.querySelectorAll('.react-flow__handle-right')).toHaveLength(2)

    const renderedEvent = screen.getByLabelText('스터디룸 예약 메인 / 화면 진입 매크로 노드')
    expect(renderedEvent.querySelectorAll('.react-flow__handle-left')).toHaveLength(0)
    expect(renderedEvent.querySelectorAll('.react-flow__handle-right')).toHaveLength(1)
    expect(within(renderedEvent).getByText('실행')).toBeTruthy()
    expect(within(renderedEvent).getByText('스터디룸 예약 메인 / 화면 진입')).toBeTruthy()
    expect(within(renderedEvent).getByText('이벤트')).toBeTruthy()
  })

  it('styles variable and function nodes with dedicated Blueprint categories', () => {
    const variableNode = flowNode('variable', 'set_variable')
    variableNode.data.label = 'Set Variable'
    variableNode.data.config = { name: 'count', type: 'int', default: 0 }
    const functionNode = flowNode('function', 'call_function')
    functionNode.data.label = 'Call Function'
    functionNode.data.config = {
      function_id: 'reserve',
      inputs: [{ id: 'room', type: 'string' }],
      outputs: [{ id: 'success', type: 'bool' }],
    }
    render(
      <div style={{ width: 800, height: 600 }}>
        <MacroCanvas
          nodes={[variableNode, functionNode]}
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

    const renderedVariable = screen.getByLabelText('변수 설정 매크로 노드')
    expect(renderedVariable.classList.contains('macro-node--kind-variable')).toBe(true)
    expect(within(renderedVariable).getByText('변수')).toBeTruthy()
    const renderedFunction = screen.getByLabelText('함수 호출 매크로 노드')
    expect(renderedFunction.classList.contains('macro-node--kind-function')).toBe(true)
    expect(within(renderedFunction).getByText('함수')).toBeTruthy()
    expect(renderedFunction.querySelectorAll('.react-flow__handle-left')).toHaveLength(2)
    expect(renderedFunction.querySelectorAll('.react-flow__handle-right')).toHaveLength(2)
  })

  it('uses the active expanded canvas instance for pane Quick Search coordinates', async () => {
    const onDropBlock = vi.fn()
    let instance: ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null = null
    const { container } = render(
      <div className="integrated-macro-editor is-expanded" style={{ width: 800, height: 600 }}>
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
    const quickSearch = await screen.findByRole('dialog', { name: '빠른 블록 검색' })
    expect(quickSearch.closest('#tapbot-overlay-root')).toBeTruthy()
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

  it('dismisses canvas popups while an editor dialog is open', async () => {
    let instance: ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null = null
    const props = {
      nodes: [],
      edges: [],
      onNodesChange: vi.fn(),
      onEdgesChange: vi.fn(),
      onConnect: vi.fn(),
      onSelectNode: vi.fn(),
      onDropBlock: vi.fn(),
      onReady: (next: ReactFlowInstance<MacroFlowNode, MacroFlowEdge>) => { instance = next },
    }
    const { container, rerender } = render(
      <div style={{ width: 800, height: 600 }}><MacroCanvas {...props} /></div>,
    )
    await waitFor(() => expect(instance).not.toBeNull())
    fireEvent.contextMenu(container.querySelector('.react-flow__pane')!, {
      clientX: 260,
      clientY: 190,
    })
    expect(await screen.findByRole('dialog', { name: '빠른 블록 검색' })).toBeTruthy()

    rerender(
      <div style={{ width: 800, height: 600 }}><MacroCanvas {...props} dialogOpen /></div>,
    )
    expect(screen.queryByRole('dialog', { name: '빠른 블록 검색' })).toBeNull()
    rerender(<div style={{ width: 800, height: 600 }}><MacroCanvas {...props} /></div>)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '빠른 블록 검색' })).toBeNull())
  })

  it('offers Get or Set when a variable is dropped without a modifier', async () => {
    const onDropBlueprintItem = vi.fn()
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
          onDropBlock={vi.fn()}
          onDropBlueprintItem={onDropBlueprintItem}
          onReady={(next) => { instance = next }}
        />
      </div>,
    )
    await waitFor(() => expect(instance).not.toBeNull())
    vi.spyOn(instance!, 'screenToFlowPosition').mockReturnValue({ x: 70, y: 90 })
    const dataTransfer = {
      dropEffect: 'none',
      getData: vi.fn((format: string) => format === MACRO_BLUEPRINT_MIME
        ? JSON.stringify({ kind: 'variable', id: 'count' })
        : ''),
    } as unknown as DataTransfer
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperties(dropEvent, {
      clientX: { value: 400 },
      clientY: { value: 260 },
      dataTransfer: { value: dataTransfer },
    })

    fireEvent(container.querySelector('.react-flow')!, dropEvent)
    const menu = await screen.findByRole('menu', { name: 'count 변수 노드 선택' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Get' }))

    expect(onDropBlueprintItem).toHaveBeenCalledWith(
      { kind: 'variable', id: 'count', mode: 'get' },
      { x: 70, y: 90 },
    )
  })

  it('offers Promote to Variable from a typed data pin', async () => {
    const onPromoteToVariable = vi.fn()
    let instance: ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null = null
    render(
      <div style={{ width: 800, height: 600 }}>
        <MacroCanvas
          nodes={[flowNode('for', 'for_loop')]}
          edges={[]}
          onNodesChange={vi.fn()}
          onEdgesChange={vi.fn()}
          onConnect={vi.fn()}
          onSelectNode={vi.fn()}
          onDropBlock={vi.fn()}
          onPromoteToVariable={onPromoteToVariable}
          onReady={(next) => { instance = next }}
        />
      </div>,
    )
    await waitFor(() => expect(instance).not.toBeNull())
    vi.spyOn(instance!, 'screenToFlowPosition').mockReturnValue({ x: 120, y: 160 })
    const handle = screen.getByLabelText('출력 인덱스 정수 포트')

    fireEvent.contextMenu(handle.closest('.macro-node__port')!, { clientX: 500, clientY: 320 })
    fireEvent.click(await screen.findByRole('menuitem', { name: '변수로 승격' }))

    expect(onPromoteToVariable).toHaveBeenCalledWith({
      nodeId: 'for',
      portId: 'index',
      portType: 'int',
      direction: 'output',
    }, { x: 120, y: 160 })
  })

  it('creates contextual variable blocks selected by variable name in Quick Search', async () => {
    const onDropQuickBlock = vi.fn()
    let instance: ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null = null
    const variableBlock = {
      ...BLOCK_BY_TYPE.get('get_variable')!,
      label: 'count 가져오기',
      keywords: ['count', 'variable'],
      presetConfig: { name: 'count', type: 'int' as const },
      presetLabel: 'count',
    }
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <MacroCanvas
          nodes={[]}
          edges={[]}
          onNodesChange={vi.fn()}
          onEdgesChange={vi.fn()}
          onConnect={vi.fn()}
          onSelectNode={vi.fn()}
          onDropBlock={vi.fn()}
          quickSearchBlocks={[variableBlock]}
          onDropQuickBlock={onDropQuickBlock}
          onReady={(next) => { instance = next }}
        />
      </div>,
    )
    await waitFor(() => expect(instance).not.toBeNull())
    vi.spyOn(instance!, 'screenToFlowPosition').mockReturnValue({ x: 45, y: 55 })
    fireEvent.contextMenu(container.querySelector('.react-flow__pane')!, {
      clientX: 260,
      clientY: 190,
    })
    fireEvent.change(await screen.findByLabelText('매크로 블록 검색'), {
      target: { value: 'count' },
    })
    fireEvent.click(screen.getByText('count 가져오기'))

    expect(onDropQuickBlock).toHaveBeenCalledWith(variableBlock, { x: 45, y: 55 })
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
