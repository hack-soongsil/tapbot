// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getNodePorts } from './blocks'
import { NodeInspector } from './NodeInspector'
import type { MacroFlowNode } from './types'

afterEach(cleanup)

const timeSlotNode: MacroFlowNode = {
  id: 'find-slot',
  type: 'ui',
  position: { x: 0, y: 0 },
  data: {
    nodeType: 'find_screen_element',
    category: 'ui',
    label: '시간 슬롯 찾기',
    config: {
      screen_id: 'reservation_detail',
      element_id: 'time_slot',
      params: { index: 6 },
    },
    isEntry: false,
    errors: [],
  },
}

describe('NodeInspector semantic screen elements', () => {
  it('shows structured runtime diagnostics and falsy actual input values without tooltips', () => {
    render(<NodeInspector
      node={timeSlotNode} issues={[]} onUpdateConfig={vi.fn()} onUpdateLabel={vi.fn()}
      onSetEntry={vi.fn()} onDelete={vi.fn()}
      runtimeError={{
        node_id: 'find-slot', node_type: 'find_screen_element', graph_path: ['main', 'reserve'],
        graph_path_labels: ['Main', 'ReserveRoom'], function_id: 'reserve', function_name: 'ReserveRoom',
        caller_node_id: 'call-reserve', function_inputs: { requested_index: 6 },
        screen_id: 'reservation_detail', status: 'failure', error: 'wrong input',
        input_summary: { configured: true }, resolved_inputs: { index: false },
        error_payload: {
          code: 'INPUT_TYPE_MISMATCH', message: '입력값의 타입이 올바르지 않습니다.',
          graph_path: ['Main', 'ReserveRoom'], screen_id: 'reservation_detail',
          node_id: 'find-slot', node_type: 'find_screen_element', node_label: '시간 슬롯 찾기',
          port_id: 'index', expected_type: 'int', actual_type: 'bool', input_values: { index: false },
          config: { element_id: 'time_slot' }, actual_value: false,
          details: { reason: 'Index must be an integer' }, hint: '정수 인덱스를 연결하세요.',
          source_node_id: 'for_loop-1', source_port_id: 'index',
        },
      }}
    />)
    const error = within(screen.getByLabelText('Runtime Error'))
    expect(error.getByText('Error Code').nextElementSibling?.textContent).toBe('INPUT_TYPE_MISMATCH')
    expect(error.getByText('Node ID').nextElementSibling?.textContent).toBe('find-slot')
    expect(error.getByText('Node Type').nextElementSibling?.textContent).toBe('find_screen_element')
    expect(error.getByText('Node Label').nextElementSibling?.textContent).toBe('시간 슬롯 찾기')
    expect(error.getByText('그래프 경로').nextElementSibling?.textContent).toBe('Main > ReserveRoom')
    expect(error.getByText('Function ID').nextElementSibling?.textContent).toBe('reserve')
    expect(error.getByText('Caller Node ID').nextElementSibling?.textContent).toBe('call-reserve')
    expect(error.getByText('실패 Port').nextElementSibling?.textContent).toBe('index')
    expect(error.getByText('Source Node ID').nextElementSibling?.textContent).toBe('for_loop-1')
    expect(error.getByText('Source Port ID').nextElementSibling?.textContent).toBe('index')
    expect(error.getByText('Expected').nextElementSibling?.textContent).toBe('int')
    expect(error.getByText('Actual').nextElementSibling?.textContent).toBe('bool')
    expect(error.getByText('실제 입력값').nextElementSibling?.textContent).toContain('"index": false')
    expect(error.getByText('실패 Port 값').nextElementSibling?.textContent).toBe('false')
    expect(error.getByText('Screen').nextElementSibling?.textContent).toContain('reservation_detail')
    expect(error.getByText('Hint').nextElementSibling?.textContent).toBe('정수 인덱스를 연결하세요.')
    expect(error.getByText('Function Inputs').nextElementSibling?.textContent).toContain('requested_index')
  })
  it('offers Reservation Detail Time Slot with a non-negative literal index', () => {
    const onUpdateConfig = vi.fn()
    render(
      <NodeInspector
        node={timeSlotNode}
        issues={[]}
        onUpdateConfig={onUpdateConfig}
        onUpdateLabel={vi.fn()}
        onSetEntry={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const screenSelect = screen.getByLabelText<HTMLSelectElement>('화면')
    expect(screenSelect.value).toBe('reservation_detail')
    expect([...screenSelect.options].map((option) => option.value)).toContain('study_room_detail')
    const element = screen.getByLabelText<HTMLSelectElement>('엘리먼트')
    expect(element.value).toBe('time_slot')
    expect(element.selectedOptions[0]?.textContent).toBe('시간 슬롯')

    const index = screen.getByLabelText<HTMLInputElement>('인덱스')
    expect(index.type).toBe('number')
    expect(index.min).toBe('0')
    expect(index.valueAsNumber).toBe(6)
    fireEvent.change(index, { target: { value: '8' } })

    expect(onUpdateConfig).toHaveBeenCalledWith({
      ...timeSlotNode.data.config,
      params: { index: 8 },
    })
  })

  it('exposes the int input and Element/bool outputs used by data wires', () => {
    const ports = getNodePorts('find_screen_element', timeSlotNode.data.config)

    expect(ports.inputs).toContainEqual({ id: 'index', type: 'int', optional: true })
    expect(ports.outputs).toEqual(expect.arrayContaining([
      { id: 'element', type: 'element' },
      { id: 'found', type: 'bool' },
    ]))
  })

  it('edits a Study Room List card selector by room name', () => {
    const onUpdateConfig = vi.fn()
    const roomNode: MacroFlowNode = {
      ...timeSlotNode,
      id: 'find-room',
      data: {
        ...timeSlotNode.data,
        config: {
          screen_id: 'study_room_list',
          element_id: 'room_card_by_name',
          params: { name: '스터디룸 2B' },
        },
      },
    }
    render(
      <NodeInspector
        node={roomNode}
        issues={[]}
        onUpdateConfig={onUpdateConfig}
        onUpdateLabel={vi.fn()}
        onSetEntry={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const name = screen.getByLabelText<HTMLInputElement>('이름')
    expect(name.value).toBe('스터디룸 2B')
    fireEvent.change(name, { target: { value: '스터디룸 2C' } })

    expect(onUpdateConfig).toHaveBeenCalledWith({
      ...roomNode.data.config,
      params: { name: '스터디룸 2C' },
    })
  })
})

describe('NodeInspector Debug Print settings', () => {
  it('edits the fallback message and supported log level', () => {
    const onUpdateConfig = vi.fn()
    const debugNode: MacroFlowNode = {
      id: 'debug-1',
      type: 'utility',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'debug_print',
        category: 'utility',
        label: 'Debug Print',
        config: { message: 'fallback', level: 'info' },
        isEntry: false,
        errors: [],
      },
    }
    render(
      <NodeInspector
        node={debugNode}
        issues={[]}
        onUpdateConfig={onUpdateConfig}
        onUpdateLabel={vi.fn()}
        onSetEntry={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const level = screen.getByLabelText<HTMLSelectElement>('레벨')
    expect([...level.options].map((option) => option.value)).toEqual([
      'debug', 'info', 'warning', 'error',
    ])
    fireEvent.change(level, { target: { value: 'warning' } })
    expect(onUpdateConfig).toHaveBeenCalledWith({ message: 'fallback', level: 'warning' })

    fireEvent.change(screen.getByLabelText('메시지'), { target: { value: 'connected value fallback' } })
    expect(onUpdateConfig).toHaveBeenCalledWith({ message: 'connected value fallback', level: 'info' })
  })
})
