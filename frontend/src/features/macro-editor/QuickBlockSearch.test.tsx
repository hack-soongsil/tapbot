// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BLOCKS } from './blocks'
import { QUICK_BLOCK_RECENT_KEY, QuickBlockSearch } from './QuickBlockSearch'
import type { MacroNodeType } from './types'

const screenPosition = { x: 120, y: 140 }
const flowPosition = { x: 42, y: 84 }

beforeEach(() => {
  window.localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1_024 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
})

afterEach(cleanup)

function setup(overrides: Partial<React.ComponentProps<typeof QuickBlockSearch>> = {}) {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  render(
    <QuickBlockSearch
      open
      screenPosition={screenPosition}
      flowPosition={flowPosition}
      blocks={BLOCKS}
      onSelect={onSelect}
      onClose={onClose}
      {...overrides}
    />,
  )
  return { onSelect, onClose }
}

describe('QuickBlockSearch', () => {
  it('focuses search, matches label/type/keywords, and excludes lifecycle events', async () => {
    setup()
    const input = screen.getByLabelText<HTMLInputElement>('Search macro blocks')
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(screen.queryByText('Screen Enter')).toBeNull()
    expect(screen.queryByText('Screen Update')).toBeNull()
    expect(screen.queryByText('Screen Exit')).toBeNull()

    fireEvent.change(input, { target: { value: 'click' } })
    expect(screen.getByText('Click Point')).toBeTruthy()
    expect(screen.getByText('Click Element')).toBeTruthy()
    expect(screen.getByText('Click Screen Element')).toBeTruthy()
    expect(screen.getByText('Random Click Area')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'button' } })
    expect(screen.getByText('Click Screen Element')).toBeTruthy()
  })

  it('supports arrow navigation, enter selection, and the saved flow position', () => {
    const { onSelect, onClose } = setup()
    const input = screen.getByLabelText('Search macro blocks')
    fireEvent.change(input, { target: { value: 'random' } })
    const options = screen.getAllByRole('option')
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('random_click_area', flowPosition)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state and closes with Escape', () => {
    const { onClose } = setup()
    const input = screen.getByLabelText('Search macro blocks')
    fireEvent.change(input, { target: { value: 'foobar' } })
    expect(screen.getByText('No blocks found for “foobar”')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('selects by mouse and stores a deduplicated maximum-eight recent list', () => {
    const existing: MacroNodeType[] = [
      'branch', 'wait', 'for_loop', 'sequence', 'click_element',
      'drag_point', 'random_drag_area', 'back',
    ]
    window.localStorage.setItem(QUICK_BLOCK_RECENT_KEY, JSON.stringify(existing))
    const { onSelect } = setup()
    fireEvent.change(screen.getByLabelText('Search macro blocks'), { target: { value: 'click point' } })
    fireEvent.click(screen.getByText('Click Point'))

    expect(onSelect).toHaveBeenCalledWith('click_point', flowPosition)
    const stored = JSON.parse(
      window.localStorage.getItem(QUICK_BLOCK_RECENT_KEY) ?? '[]',
    ) as unknown
    expect(Array.isArray(stored)).toBe(true)
    if (!Array.isArray(stored)) throw new Error('recent storage is not an array')
    expect(stored).toHaveLength(8)
    expect(stored[0]).toBe('click_point')
    expect(new Set(stored).size).toBe(8)
  })

  it('keeps category order, ignores deprecated recents, clamps to the viewport, and closes outside', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
    window.localStorage.setItem(QUICK_BLOCK_RECENT_KEY, JSON.stringify(['not_a_block']))
    const { onClose } = setup({ screenPosition: { x: 490, y: 390 } })

    expect(screen.queryByText('RECENT')).toBeNull()
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent)
    expect(headings).toEqual(['UI', 'ACTION', 'CONDITION', 'FLOW', 'VALIDATION'])
    const popup = screen.getByRole('dialog', { name: 'Quick block search' })
    expect(Number.parseFloat(popup.style.left)).toBeLessThanOrEqual(132)
    expect(Number.parseFloat(popup.style.top)).toBeGreaterThanOrEqual(8)

    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
