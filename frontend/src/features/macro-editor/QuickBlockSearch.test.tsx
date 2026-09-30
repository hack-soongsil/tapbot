// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUICK_BLOCK_RECENT_KEY, QuickBlockSearch } from './QuickBlockSearch'
import { createSearchItems } from './search-provider'
import type { MacroNodeType } from './types'

const screenPosition = { x: 120, y: 140 }
const flowPosition = { x: 42, y: 84 }
const scrollIntoView = vi.fn()

beforeEach(() => {
  window.localStorage.clear()
  scrollIntoView.mockClear()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1_024 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
})

afterEach(cleanup)

function setup(overrides: Partial<React.ComponentProps<typeof QuickBlockSearch>> = {}) {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const items = createSearchItems(null, (type, position) => {
    onSelect(type, position)
    return { id: `${type}-created`, type, config: {} }
  })
  render(
    <QuickBlockSearch
      open
      screenPosition={screenPosition}
      flowPosition={flowPosition}
      items={items}
      onClose={onClose}
      {...overrides}
    />,
  )
  return { onSelect, onClose }
}

describe('QuickBlockSearch', () => {
  it('focuses search, matches label/type/keywords, and excludes lifecycle events', async () => {
    setup()
    const input = screen.getByLabelText<HTMLInputElement>('매크로 블록 검색')
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(screen.queryByText('화면 진입')).toBeNull()
    expect(screen.queryByText('화면 업데이트')).toBeNull()
    expect(screen.queryByText('화면 이탈')).toBeNull()

    fireEvent.change(input, { target: { value: 'click' } })
    expect(screen.getByText('위치 클릭')).toBeTruthy()
    expect(screen.getByText('엘리먼트 클릭')).toBeTruthy()
    expect(screen.queryByText('Click Screen Element')).toBeNull()
    expect(screen.getByText('영역 랜덤 클릭')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'screen element' } })
    expect(screen.getByText('화면 엘리먼트 찾기')).toBeTruthy()

    fireEvent.change(input, { target: { value: '기본 정보' } })
    expect(screen.getByText('화면 엘리먼트 찾기')).toBeTruthy()

    fireEvent.change(input, { target: { value: '예약 CTA' } })
    expect(screen.getByText('화면 엘리먼트 찾기')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'debug log' } })
    expect(screen.getByText('디버그 출력')).toBeTruthy()
  })

  it('supports arrow navigation, enter selection, and the saved flow position', () => {
    const { onSelect, onClose } = setup()
    const input = screen.getByLabelText('매크로 블록 검색')
    fireEvent.change(input, { target: { value: 'random' } })
    const options = screen.getAllByRole('option')
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('random_drag_area', flowPosition)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('navigates category folders with mouse, Enter, Backspace, and Back', () => {
    setup()
    const input = screen.getByLabelText('매크로 블록 검색')
    const rootFolders = screen.getAllByRole('option').map((option) => option.getAttribute('aria-label'))
    expect(rootFolders).toEqual([
      'UI 폴더',
      '동작 폴더',
      '조건 폴더',
      '흐름 제어 폴더',
      '검증 폴더',
      '유틸리티 폴더',
    ])

    fireEvent.click(screen.getByRole('option', { name: '동작 폴더' }))
    expect(screen.getByRole('button', { name: /뒤로/ })).toBeTruthy()
    expect(screen.getByText('위치 클릭')).toBeTruthy()
    expect(screen.queryByText('엘리먼트 찾기')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /뒤로/ }))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('button', { name: /뒤로/ })).toBeTruthy()
    expect(screen.getByText('엘리먼트 찾기')).toBeTruthy()

    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(screen.getByRole('option', { name: 'UI 폴더' })).toBeTruthy()
  })

  it('searches all folders, shows category paths, and scrolls keyboard selection into view', async () => {
    setup()
    const input = screen.getByLabelText('매크로 블록 검색')
    fireEvent.click(screen.getByRole('option', { name: '동작 폴더' }))

    fireEvent.change(input, { target: { value: 'find element' } })

    expect(screen.getByText('엘리먼트 찾기')).toBeTruthy()
    expect(screen.getByText('UI / 엘리먼트 찾기')).toBeTruthy()
    expect(screen.queryByRole('option', { name: '동작 폴더' })).toBeNull()

    scrollIntoView.mockClear()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
  })

  it('shows only blocks compatible with a dragged typed output', () => {
    const { onClose, onSelect } = setup({
      sourcePortContext: {
        source_node_id: 'find-1',
        source_port_id: 'element',
        source_port_type: 'element',
        source_direction: 'output',
      },
    })
    const input = screen.getByLabelText('매크로 블록 검색')

    fireEvent.change(input, { target: { value: 'click' } })

    expect(screen.getByText('엘리먼트 클릭')).toBeTruthy()
    expect(screen.queryByText('위치 클릭')).toBeNull()
    expect(screen.queryByText('영역 랜덤 클릭')).toBeNull()

    fireEvent.contextMenu(screen.getByRole('dialog', { name: '빠른 블록 검색' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows an empty state and closes with Escape without closing a parent modal', () => {
    const { onClose } = setup()
    const closeParentModal = vi.fn()
    window.addEventListener('keydown', closeParentModal)
    const input = screen.getByLabelText('매크로 블록 검색')
    fireEvent.change(input, { target: { value: 'foobar' } })
    expect(screen.getByText('검색 결과가 없습니다: “foobar”')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(closeParentModal).not.toHaveBeenCalled()
    window.removeEventListener('keydown', closeParentModal)
  })

  it('cancels any open search on right click without selecting a block', () => {
    const { onClose, onSelect } = setup()
    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })

    screen.getByRole('dialog', { name: '빠른 블록 검색' }).dispatchEvent(contextMenu)

    expect(contextMenu.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('selects by mouse and stores a deduplicated maximum-eight recent list', () => {
    const existing: MacroNodeType[] = [
      'branch', 'wait', 'for_loop', 'sequence', 'click_element',
      'drag_point', 'random_drag_area', 'back',
    ]
    window.localStorage.setItem(QUICK_BLOCK_RECENT_KEY, JSON.stringify(existing))
    const { onSelect } = setup()
    fireEvent.change(screen.getByLabelText('매크로 블록 검색'), { target: { value: 'click point' } })
    fireEvent.click(screen.getByText('위치 클릭'))

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

    expect(screen.queryByText('최근 사용')).toBeNull()
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['카테고리'])
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('aria-label'))).toEqual([
      'UI 폴더',
      '동작 폴더',
      '조건 폴더',
      '흐름 제어 폴더',
      '검증 폴더',
      '유틸리티 폴더',
    ])
    const popup = screen.getByRole('dialog', { name: '빠른 블록 검색' })
    expect(Number.parseFloat(popup.style.left)).toBeLessThanOrEqual(132)
    expect(Number.parseFloat(popup.style.top)).toBeGreaterThanOrEqual(8)

    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
