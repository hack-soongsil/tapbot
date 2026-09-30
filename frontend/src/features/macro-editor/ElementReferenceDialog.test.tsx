// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElementReferenceDialog } from './ElementReferenceDialog'
import type { ScreenElementReference } from './screen-elements'

afterEach(cleanup)

describe('ElementReferenceDialog', () => {
  it('opens on the current element and displays collection parameter documentation', () => {
    render(<ElementReferenceDialog
      screenId="study_room_detail"
      elementId="time_slot"
      onClose={vi.fn()}
      onUseElement={vi.fn()}
    />)

    const dialog = screen.getByRole('dialog', { name: 'Element Reference' })
    expect(within(dialog).getByRole('heading', { name: '시간 슬롯', level: 2 })).toBeTruthy()
    expect(within(dialog).getByText('time_slot[index]')).toBeTruthy()
    expect(within(dialog).getByText('index: int')).toBeTruthy()
    expect(within(dialog).getByText('0 ~ 31')).toBeTruthy()
    expect(within(dialog).getByText('0 = 06:00, 1 = 06:30, …, 31 = 21:30')).toBeTruthy()
    expect(within(dialog).getByText('state')).toBeTruthy()
  })

  it('navigates by screen and category and searches manifest documentation', () => {
    render(<ElementReferenceDialog
      screenId="study_room_detail"
      elementId="time_slot"
      onClose={vi.fn()}
      onUseElement={vi.fn()}
    />)

    const dialog = screen.getByRole('dialog', { name: 'Element Reference' })
    expect(within(dialog).getByText('스터디룸 목록')).toBeTruthy()
    expect(within(dialog).getAllByText('기본 정보')).toHaveLength(2)
    fireEvent.click(within(dialog).getByRole('button', {
      name: '스터디룸 목록 > 스터디룸 > 스터디룸 이름',
    }))
    expect(within(dialog).getByRole('heading', { name: '스터디룸 이름', level: 2 })).toBeTruthy()
    expect(within(dialog).getByText('스터디룸 카드에 표시되는 방 이름 요소입니다.')).toBeTruthy()

    const searchInput = within(dialog).getByLabelText('엘리먼트 검색')
    fireEvent.change(searchInput, { target: { value: '예약 절차' } })
    expect(within(dialog).getByRole('button', {
      name: '스터디룸 상세 > 예약 > 예약 CTA',
    })).toBeTruthy()
    fireEvent.keyDown(searchInput, { key: 'Enter' })
    expect(within(dialog).getByRole('heading', { name: '예약 CTA', level: 2 })).toBeTruthy()
  })

  it('uses the explicitly selected reference and closes with Escape', async () => {
    const onClose = vi.fn()
    const onUseElement = vi.fn<(reference: ScreenElementReference) => void>()
    render(<ElementReferenceDialog
      screenId="study_room_detail"
      elementId="time_slot"
      onClose={onClose}
      onUseElement={onUseElement}
    />)
    const dialog = screen.getByRole('dialog', { name: 'Element Reference' })
    fireEvent.click(within(dialog).getByRole('button', {
      name: '스터디룸 목록 > 스터디룸 > 이름으로 스터디룸 카드',
    }))
    fireEvent.click(within(dialog).getByRole('button', { name: '이 요소 사용' }))
    expect(onUseElement).toHaveBeenCalledOnce()
    expect(onUseElement.mock.calls[0]?.[0].screen.id).toBe('study_room_list')
    expect(onUseElement.mock.calls[0]?.[0].category.id).toBe('room')
    expect(onUseElement.mock.calls[0]?.[0].element.id).toBe('room_card_by_name')

    fireEvent.keyDown(within(dialog).getByLabelText('엘리먼트 검색'), { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows the specified fallback when description is missing', () => {
    render(<ElementReferenceDialog
      screenId="study_room_confirm"
      elementId="title"
      onClose={vi.fn()}
      onUseElement={vi.fn()}
    />)
    expect(screen.getByText('설명이 아직 등록되지 않았습니다.')).toBeTruthy()
  })
})
