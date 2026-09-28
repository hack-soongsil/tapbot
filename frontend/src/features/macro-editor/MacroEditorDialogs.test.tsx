// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../../components/AppDialog'
import { NameEditorDialog, VariableEditorDialog } from './MacroEditorDialogs'

afterEach(cleanup)

describe('TapBot editor dialogs', () => {
  it('validates variable fields inline and submits typed defaults', () => {
    const submit = vi.fn()
    render(
      <VariableEditorDialog
        title="변수 추가"
        submitLabel="추가"
        existingNames={['count']}
        onCancel={vi.fn()}
        onSubmit={submit}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: '변수 추가' })
    fireEvent.change(within(dialog).getByLabelText('이름'), { target: { value: 'count' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '추가' }))
    expect(within(dialog).getByText('이미 존재하는 변수 이름입니다.')).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText('이름'), { target: { value: 'retries' } })
    fireEvent.change(within(dialog).getByLabelText('기본값'), { target: { value: '1.5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '추가' }))
    expect(within(dialog).getByText('정수 기본값은 정수여야 합니다.')).toBeTruthy()

    fireEvent.change(within(dialog).getByLabelText('기본값'), { target: { value: '3' } })
    fireEvent.submit(within(dialog).getByLabelText('이름').closest('form')!)
    expect(submit).toHaveBeenCalledWith({ name: 'retries', type: 'int', default: 3 })
  })

  it('validates duplicate names inside the name dialog', () => {
    const submit = vi.fn()
    render(
      <NameEditorDialog
        title="새 함수"
        label="함수 이름"
        submitLabel="생성"
        existingNames={['Reserve']}
        onCancel={vi.fn()}
        onSubmit={submit}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: '새 함수' })
    fireEvent.change(within(dialog).getByLabelText('함수 이름'), { target: { value: 'Reserve' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '생성' }))
    expect(within(dialog).getByText('이미 존재하는 함수 이름입니다.')).toBeTruthy()
  })

  it('closes with Escape and exposes a danger confirmation action', () => {
    const cancel = vi.fn()
    const confirm = vi.fn()
    render(
      <ConfirmDialog
        title="함수 삭제"
        description="함수를 삭제하시겠습니까?"
        confirmLabel="삭제"
        danger
        onCancel={cancel}
        onConfirm={confirm}
      />,
    )
    const dialog = screen.getByRole('alertdialog', { name: '함수 삭제' })
    expect(within(dialog).getByRole('button', { name: '삭제' }).className).toContain('bp6-intent-danger')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(cancel).toHaveBeenCalled()
  })
})
