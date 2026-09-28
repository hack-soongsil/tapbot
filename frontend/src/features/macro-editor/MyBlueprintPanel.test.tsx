// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MACRO_BLUEPRINT_MIME } from './blueprint-dnd'
import { MyBlueprintPanel } from './MyBlueprintPanel'

afterEach(cleanup)

const variables = [
  { name: 'count', type: 'int' as const, default: 0 },
  { name: 'target', type: 'element' as const },
]
const functions = [{
  id: 'reserve',
  name: 'Reserve',
  inputs: [{ id: 'index', type: 'int' as const }],
  outputs: [{ id: 'success', type: 'bool' as const }],
  nodes: [],
  edges: [],
  entry_node_id: 'reserve-entry',
  return_node_id: 'reserve-return',
}]

function setup() {
  const props = {
    variables,
    functions,
    selection: null,
    onSelect: vi.fn(),
    onOpenFunction: vi.fn(),
    onAddVariable: vi.fn(),
    onAddFunction: vi.fn(),
    onRenameFunction: vi.fn(),
    onDuplicateFunction: vi.fn(),
    onDeleteFunction: vi.fn(),
  }
  render(<MyBlueprintPanel {...props} />)
  return props
}

describe('MyBlueprintPanel', () => {
  it('lists typed variables and opens a function graph on double click', () => {
    const props = setup()

    fireEvent.click(screen.getByRole('button', { name: 'count 변수 int' }))
    expect(props.onSelect).toHaveBeenCalledWith({ kind: 'variable', id: 'count' })
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Reserve 함수' }))
    expect(props.onOpenFunction).toHaveBeenCalledWith('reserve')
  })

  it('encodes default, Get, Set, and function canvas drags', () => {
    setup()
    const setData = vi.fn()
    const variable = screen.getByRole('button', { name: 'count 변수 int' })

    fireEvent.dragStart(variable, { dataTransfer: { setData, effectAllowed: 'none' } })
    expect(setData).toHaveBeenLastCalledWith(
      MACRO_BLUEPRINT_MIME,
      JSON.stringify({ kind: 'variable', id: 'count' }),
    )
    dispatchDrag(variable, { setData, ctrlKey: true })
    expect(setData).toHaveBeenLastCalledWith(
      MACRO_BLUEPRINT_MIME,
      JSON.stringify({ kind: 'variable', id: 'count', mode: 'get' }),
    )
    dispatchDrag(variable, { setData, altKey: true })
    expect(setData).toHaveBeenLastCalledWith(
      MACRO_BLUEPRINT_MIME,
      JSON.stringify({ kind: 'variable', id: 'count', mode: 'set' }),
    )

    fireEvent.dragStart(screen.getByRole('button', { name: 'Reserve 함수' }), {
      dataTransfer: { setData, effectAllowed: 'none' },
    })
    expect(setData).toHaveBeenLastCalledWith(
      MACRO_BLUEPRINT_MIME,
      JSON.stringify({ kind: 'function', id: 'reserve' }),
    )
  })

  it('provides function rename, duplicate, and delete from the context menu', () => {
    const props = setup()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Reserve 함수' }), {
      clientX: 120,
      clientY: 90,
    })

    fireEvent.click(screen.getByRole('menuitem', { name: '복제' }))
    expect(props.onDuplicateFunction).toHaveBeenCalledWith('reserve')
  })
})

function dispatchDrag(
  target: Element,
  modifiers: { setData: ReturnType<typeof vi.fn>; ctrlKey?: boolean; altKey?: boolean },
) {
  const event = new Event('dragstart', { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    ctrlKey: { value: modifiers.ctrlKey === true },
    metaKey: { value: false },
    altKey: { value: modifiers.altKey === true },
    dataTransfer: { value: { setData: modifiers.setData, effectAllowed: 'none' } },
  })
  fireEvent(target, event)
}
