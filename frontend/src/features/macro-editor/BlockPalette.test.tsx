// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockPalette, MACRO_BLOCK_MIME } from './BlockPalette'

afterEach(cleanup)

describe('BlockPalette', () => {
  it('shows readable labels and one-line descriptions without exposing internal type ids', () => {
    render(<BlockPalette onAdd={vi.fn()} />)

    const palette = screen.getByLabelText('블록 팔레트')
    const forButton = within(palette).getByRole('button', { name: 'For 반복 추가' })
    expect(within(forButton).getByText('For 반복')).toBeTruthy()
    expect(within(forButton).getByText('인덱스 변수를 갱신하며 흐름을 반복합니다.')).toBeTruthy()
    expect(palette.textContent).not.toContain('for_loop')
    expect(forButton.title).toContain('for_loop')
  })

  it('keeps click and drag block creation behavior', () => {
    const onAdd = vi.fn()
    render(<BlockPalette onAdd={onAdd} />)
    const button = screen.getByRole('button', { name: '대기 추가' })
    fireEvent.click(button)
    expect(onAdd).toHaveBeenCalledWith('wait')

    const setData = vi.fn()
    fireEvent.dragStart(button, {
      dataTransfer: { setData, effectAllowed: 'none' },
    })
    expect(setData).toHaveBeenCalledWith(MACRO_BLOCK_MIME, 'wait')
  })
})
