// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

    expect(screen.getByLabelText<HTMLSelectElement>('화면').value).toBe('reservation_detail')
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
