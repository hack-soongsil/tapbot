// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlueprintInspector } from './BlueprintInspector'

afterEach(cleanup)

const shared = {
  onEditVariable: vi.fn(),
  onDeleteVariable: vi.fn(),
  onRenameFunction: vi.fn(),
  onUpdateFunctionPorts: vi.fn(),
  onOpenFunction: vi.fn(),
  onDeleteFunction: vi.fn(),
}

describe('BlueprintInspector', () => {
  it('opens the variable editor dialog from the inspector', () => {
    render(
      <BlueprintInspector
        {...shared}
        selection={{ kind: 'variable', id: 'count' }}
        variable={{ name: 'count', type: 'int', default: 0 }}
      />,
    )

    expect(screen.getAllByText('count')).toHaveLength(2)
    expect(screen.getByText('int')).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '편집' }))

    expect(shared.onEditVariable).toHaveBeenCalledWith('count')
  })

  it('edits a function signature and opens its graph', () => {
    const definition = {
      id: 'reserve',
      name: 'Reserve',
      inputs: [{ id: 'index', type: 'int' as const }],
      outputs: [{ id: 'success', type: 'bool' as const }],
      nodes: [],
      edges: [],
      entry_node_id: 'reserve-entry',
      return_node_id: 'reserve-return',
    }
    render(
      <BlueprintInspector
        {...shared}
        selection={{ kind: 'function', id: definition.id }}
        functionDefinition={definition}
      />,
    )

    fireEvent.change(screen.getByLabelText('Inputs 1 이름'), { target: { value: 'slot' } })
    expect(shared.onUpdateFunctionPorts).toHaveBeenCalledWith(
      'reserve',
      'inputs',
      [{ id: 'slot', type: 'int' }],
    )
    fireEvent.click(screen.getByLabelText('Outputs 1 필수'))
    expect(shared.onUpdateFunctionPorts).toHaveBeenCalledWith(
      'reserve',
      'outputs',
      [{ id: 'success', type: 'bool', required: true }],
    )
    fireEvent.change(screen.getByLabelText('Outputs 1 기본값'), { target: { value: 'true' } })
    fireEvent.blur(screen.getByLabelText('Outputs 1 기본값'))
    expect(shared.onUpdateFunctionPorts).toHaveBeenCalledWith(
      'reserve',
      'outputs',
      [{ id: 'success', type: 'bool', default: true }],
    )
    fireEvent.click(screen.getByRole('button', { name: '함수 그래프 열기' }))
    expect(shared.onOpenFunction).toHaveBeenCalledWith('reserve')
    fireEvent.click(screen.getByRole('button', { name: '이름 변경' }))
    expect(shared.onRenameFunction).toHaveBeenCalledWith('reserve')
  })
})
