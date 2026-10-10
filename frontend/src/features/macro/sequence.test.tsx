// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import presetJson from '../../../../backend/tapbot/macro/presets/ssutoday-2c.json'
import type { AndroidUiNode } from '../../types/android-debug'
import { sequenceApi } from './sequence-api'
import { SequenceEditorPanel } from './SequenceEditorPanel'
import { useSequenceEditor } from './useSequenceEditor'
import type { SequenceDefinition, SequenceRuntime } from './sequence-model'

vi.mock('./sequence-api', () => ({
  sequenceApi: {
    list: vi.fn(),
    save: vi.fn(),
    runtime: vi.fn(),
    start: vi.fn(),
    command: vi.fn(),
  },
}))

const preset = presetJson as SequenceDefinition
const idle: SequenceRuntime = {
  status: 'IDLE',
  sequence_id: null,
  step_id: null,
  completed_steps: 0,
  total_steps: 0,
  iteration: 0,
  repeat_count: 0,
  error: null,
  outcome_unknown: false,
}
const node = {
  text: 'Next',
  password: false,
  view_id_resource_name: 'example:id/next',
} as AndroidUiNode

function Harness({
  deviceId = 'phone',
  selectedNode = null,
}: {
  deviceId?: string
  selectedNode?: AndroidUiNode | null
}) {
  const editor = useSequenceEditor(deviceId, 1080, 2400, 0)
  return (
    <SequenceEditorPanel
      editor={editor}
      selectedNode={selectedNode}
      packageName="com.ssutoday"
      roomName={null}
      ready
    />
  )
}

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(sequenceApi.list).mockResolvedValue({ sequences: [preset] })
  vi.mocked(sequenceApi.runtime).mockResolvedValue(idle)
  vi.mocked(sequenceApi.save).mockImplementation((value) => Promise.resolve(value))
  vi.mocked(sequenceApi.start).mockImplementation((_, value) =>
    Promise.resolve({
      ...idle,
      status: 'COMPLETED',
      sequence_id: value.id,
    }),
  )
  vi.mocked(sequenceApi.command).mockResolvedValue(idle)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('click presets', () => {
  it('saves the user-defined component order without sending input', async () => {
    const view = render(<Harness selectedNode={node} />)
    await waitFor(() => expect(view.getByText(preset.name)).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: '선택한 UI 컴포넌트 추가' }))
    fireEvent.change(view.getByLabelText('1단계 이름'), { target: { value: 'First' } })
    fireEvent.click(view.getByRole('button', { name: '선택한 UI 컴포넌트 추가' }))
    fireEvent.change(view.getByLabelText('2단계 이름'), { target: { value: 'Second' } })
    fireEvent.click(view.getByLabelText('2단계 위로'))
    fireEvent.click(view.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(sequenceApi.save).toHaveBeenCalledOnce())
    const saved = vi.mocked(sequenceApi.save).mock.calls[0]![0]
    expect(saved.steps.map((step) => step.label)).toEqual(['Second', 'First'])
    expect(saved.steps[0]?.selector).toEqual({
      text: 'Next',
      view_id: 'example:id/next',
    })
    expect(sequenceApi.start).not.toHaveBeenCalled()
  })

  it('updates both booking intervals and runs their matching click steps', async () => {
    const view = render(<Harness />)
    await waitFor(() => expect(view.getByText(preset.name)).toBeTruthy())
    fireEvent.change(view.getByLabelText('저장한 프리셋'), {
      target: { value: preset.id },
    })
    fireEvent.change(view.getByLabelText('2번째 예약 종료 시각'), {
      target: { value: '16:00' },
    })
    fireEvent.change(view.getByLabelText('2번째 예약 시작 시각'), {
      target: { value: '15:00' },
    })
    fireEvent.click(view.getByRole('button', { name: '프리셋 실행' }))
    await waitFor(() => expect(sequenceApi.start).toHaveBeenCalledOnce())
    const value = vi.mocked(sequenceApi.start).mock.calls[0]![1]
    expect(value.booking_ranges).toEqual([
      { start_time: '12:00', end_time: '14:00' },
      { start_time: '15:00', end_time: '16:00' },
    ])
    expect(value.steps.find((step) => step.id === 'start-2')?.selector).toEqual({
      time_slot: '15:00',
    })
    expect(value.steps.find((step) => step.id === 'end-2')?.selector).toEqual({
      time_slot: '15:30',
    })
    expect(value.steps.find((step) => step.id === 'confirm-2')?.required_text).toBe(
      '15:00 ~ 16:00',
    )
    expect(value.steps.at(-1)?.selector).toEqual({ text: '예약 화면으로' })
    expect(vi.mocked(sequenceApi.save).mock.calls[0]![0]).toEqual(value)
  })

  it('does not start a stale device after switching during save', async () => {
    let resolveSave!: (value: SequenceDefinition) => void
    vi.mocked(sequenceApi.save).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    const view = renderHook(({ id }) => useSequenceEditor(id, 1080, 2400, 0), {
      initialProps: { id: 'phone-a' },
    })
    await waitFor(() => expect(view.result.current.presets).toHaveLength(1))
    act(() => view.result.current.addPoint(10, 20))
    const saved = view.result.current.definition
    let pending!: Promise<void>
    act(() => {
      pending = view.result.current.start()
    })
    view.rerender({ id: 'phone-b' })
    await act(async () => {
      resolveSave(saved)
      await pending
    })
    expect(sequenceApi.start).not.toHaveBeenCalled()
    expect(view.result.current.runtime?.status ?? 'IDLE').toBe('IDLE')
  })

  it('shows the confirmation pause and resumes explicitly', async () => {
    vi.mocked(sequenceApi.runtime).mockResolvedValue({
      ...idle,
      status: 'PAUSED',
      pause_reason: '휴대폰 확인',
    })
    const view = render(<Harness />)
    await waitFor(() => expect(view.getByText(/휴대폰 확인 ·/)).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: '계속 실행' }))
    await waitFor(() =>
      expect(sequenceApi.command).toHaveBeenCalledWith('phone', 'resume'),
    )
  })
})
