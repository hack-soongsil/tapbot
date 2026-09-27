// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macroEditorApi } from './api'
import { MACRO_DRAFT_STORAGE_KEY, MacroEditorPage } from './MacroEditorPage'
import type { MacroCanvasProps } from './MacroCanvas'

vi.mock('./api', () => ({
  macroEditorApi: {
    list: vi.fn(),
    get: vi.fn(),
    save: vi.fn(),
    validate: vi.fn(),
    run: vi.fn(),
    stop: vi.fn(),
  },
}))

vi.mock('./MacroCanvas', () => ({
  MacroCanvas: (props: MacroCanvasProps) => (
    <div data-testid="macro-canvas">
      <span data-testid="node-count">{props.nodes.length}</span>
      <span data-testid="edge-count">{props.edges.length}</span>
      {props.nodes.map((node) => (
        <button key={node.id} onClick={() => props.onSelectNode(node.id)}>
          Select {node.id}
        </button>
      ))}
      <button
        onClick={() => {
          const [source, target] = props.nodes.slice(-2)
          if (source && target) {
            props.onConnect({
              source: source.id,
              target: target.id,
              sourceHandle: null,
              targetHandle: null,
            })
          }
        }}
      >
        Connect first two
      </button>
    </div>
  ),
}))

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(macroEditorApi.validate).mockResolvedValue({ valid: true, errors: [] })
  vi.mocked(macroEditorApi.save).mockImplementation((value) => Promise.resolve(value))
  vi.mocked(macroEditorApi.run).mockResolvedValue({ run_id: 'run-1', status: 'running' })
  vi.mocked(macroEditorApi.stop).mockResolvedValue({ run_id: 'run-1', status: 'stopped' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MacroEditorPage', () => {
  it('adds, connects, edits, and deletes nodes while tracking dirty state', () => {
    render(<MacroEditorPage />)

    fireEvent.click(screen.getByRole('button', { name: '대기 추가' }))
    expect(screen.getByTestId('node-count').textContent).toBe('7')
    expect(screen.getByText('저장되지 않음')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('지속 시간(ms)'), { target: { value: '900' } })
    expect(screen.getByLabelText<HTMLInputElement>('지속 시간(ms)').value).toBe('900')

    fireEvent.click(screen.getByRole('button', { name: '위치 클릭 추가' }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect first two' }))
    expect(screen.getByTestId('edge-count').textContent).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: '노드 삭제' }))
    expect(screen.getByTestId('node-count').textContent).toBe('7')
    expect(screen.getByTestId('edge-count').textContent).toBe('0')
  })

  it('shows only text, tree path, and sampling mode for Click Element', () => {
    render(<MacroEditorPage />)

    fireEvent.click(screen.getByRole('button', { name: '엘리먼트 클릭 추가' }))
    fireEvent.change(screen.getByLabelText('텍스트'), { target: { value: 'Confirm' } })
    fireEvent.change(screen.getByLabelText('UI 트리 경로'), {
      target: { value: 'n0.0.1' },
    })
    fireEvent.change(screen.getByLabelText('클릭 샘플링 방식'), {
      target: { value: 'normal' },
    })

    expect(screen.getByLabelText<HTMLInputElement>('텍스트').value).toBe('Confirm')
    expect(screen.getByLabelText<HTMLInputElement>('UI 트리 경로').value).toBe('n0.0.1')
    expect(screen.getByLabelText<HTMLSelectElement>('클릭 샘플링 방식').value).toBe('normal')
    expect(screen.queryByLabelText('텍스트 정규식')).toBeNull()
    expect(screen.queryByLabelText('콘텐츠 설명')).toBeNull()
    expect(screen.queryByLabelText('뷰 ID')).toBeNull()
    expect(screen.queryByLabelText('클래스 이름')).toBeNull()
    expect(screen.queryByLabelText('Resolve strategy')).toBeNull()
    expect(screen.queryByLabelText('지속 시간(ms)')).toBeNull()
  })

  it('serializes to local storage and reloads the saved draft', async () => {
    const first = render(<MacroEditorPage />)
    fireEvent.click(screen.getByRole('button', { name: '위치 클릭 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalledTimes(1))
    const saved = JSON.parse(window.localStorage.getItem(MACRO_DRAFT_STORAGE_KEY) ?? '{}') as {
      nodes?: unknown[]
    }
    expect(saved.nodes).toHaveLength(7)
    expect(saved).toHaveProperty('screen_event_entry_node_ids.reservation_home.enter', 'event-home-enter')
    expect(saved).toHaveProperty('screen_event_entry_node_ids.reservation_detail.enter', 'event-detail-enter')
    expect(saved).not.toHaveProperty('event_entry_node_ids')

    first.unmount()
    render(<MacroEditorPage />)
    expect(screen.getByTestId('node-count').textContent).toBe('7')
  })

  it('maps backend validation errors onto the selected node', async () => {
    vi.mocked(macroEditorApi.validate).mockResolvedValue({
      valid: false,
      errors: [{ node_id: 'click_point-1', message: 'Backend rejected this node.' }],
    })
    render(<MacroEditorPage />)
    fireEvent.click(screen.getByRole('button', { name: '위치 클릭 추가' }))

    fireEvent.click(screen.getByRole('button', { name: '검증' }))

    await waitFor(() => expect(screen.getByText('Backend rejected this node.')).toBeTruthy())
    expect(screen.getByText('백엔드 검증에서 그래프 오류를 발견했습니다.')).toBeTruthy()
  })

  it('supports the Ctrl+S keyboard shortcut', async () => {
    render(<MacroEditorPage />)
    fireEvent.click(screen.getByRole('button', { name: '위치 클릭 추가' }))

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalledTimes(1))
  })
})
