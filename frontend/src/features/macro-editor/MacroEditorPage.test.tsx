// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macroEditorApi } from './api'
import { MACRO_DRAFT_STORAGE_KEY, MacroEditorPage } from './MacroEditorPage'
import { formatSavedAtCompact, formatSavedAtFull } from './save-timestamp'
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
      <button
        onClick={() => {
          const first = props.nodes[0]
          if (first) props.onNodesChange([{ type: 'remove', id: first.id }])
        }}
      >
        Remove entry node
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
    expect(screen.getByText('저장 안 됨')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('지속 시간(ms)'), { target: { value: '900' } })
    expect(screen.getByLabelText<HTMLInputElement>('지속 시간(ms)').value).toBe('900')

    fireEvent.click(screen.getByRole('button', { name: '위치 클릭 추가' }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect first two' }))
    expect(screen.getByTestId('edge-count').textContent).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: '노드 삭제' }))
    expect(screen.getByTestId('node-count').textContent).toBe('7')
    expect(screen.getByTestId('edge-count').textContent).toBe('0')
  })

  it('shows only sampling mode for Click Element', () => {
    render(<MacroEditorPage />)

    fireEvent.click(screen.getByRole('button', { name: '엘리먼트 클릭 추가' }))
    fireEvent.change(screen.getByLabelText('클릭 샘플링 방식'), {
      target: { value: 'normal' },
    })

    expect(screen.getByLabelText<HTMLSelectElement>('클릭 샘플링 방식').value).toBe('normal')
    expect(screen.queryByLabelText('텍스트')).toBeNull()
    expect(screen.queryByLabelText('UI 트리 경로')).toBeNull()
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
    expect(saved).toHaveProperty('screen_event_entry_node_ids.study_room_list.enter', 'event-study-room-list-enter')
    expect(saved).toHaveProperty('screen_event_entry_node_ids.study_room_detail.enter', 'event-study-room-detail-enter')
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
    expect(screen.getByText('백엔드 그래프 검증 오류 1개를 발견했습니다.')).toBeTruthy()
  })

  it('supports the Ctrl+S keyboard shortcut', async () => {
    const savedAt = new Date(2026, 8, 30, 11, 42, 18).toISOString()
    vi.mocked(macroEditorApi.save).mockImplementation((value) => Promise.resolve({
      ...value,
      metadata: { ...value.metadata, updated_at: savedAt },
    }))
    render(<MacroEditorPage />)
    fireEvent.click(screen.getByRole('button', { name: '위치 클릭 추가' }))

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText(`저장됨 · ${formatSavedAtCompact(savedAt)}`)).toBeTruthy()
  })

  it('keeps the successful save time visible while the graph is dirty', async () => {
    const savedAt = new Date(2026, 8, 30, 11, 42, 18).toISOString()
    vi.mocked(macroEditorApi.save).mockImplementation((value) => Promise.resolve({
      ...value,
      metadata: { ...value.metadata, updated_at: savedAt },
    }))
    render(<MacroEditorPage />)
    fireEvent.click(screen.getByRole('button', { name: '위치 클릭 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(
      screen.getByLabelText(`저장됨 · ${formatSavedAtCompact(savedAt)}`),
    ).toBeTruthy())
    expect(screen.getByRole('button', { name: '저장' }).getAttribute('title'))
      .toBe(`저장\n마지막 저장: ${formatSavedAtFull(savedAt)}`)

    fireEvent.click(screen.getByRole('button', { name: '대기 추가' }))
    expect(screen.getByLabelText(
      `저장 안 됨 · 마지막 저장 ${formatSavedAtCompact(savedAt)}`,
    )).toBeTruthy()
  })

  it('does not change the prior save time or clear dirty state when persistence fails', async () => {
    const savedAt = new Date(2026, 8, 30, 11, 42, 18).toISOString()
    vi.mocked(macroEditorApi.save).mockImplementationOnce((value) => Promise.resolve({
      ...value,
      metadata: { ...value.metadata, updated_at: savedAt },
    }))
    render(<MacroEditorPage />)
    fireEvent.click(screen.getByRole('button', { name: '위치 클릭 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '대기 추가' }))
    vi.mocked(macroEditorApi.save).mockRejectedValueOnce(new Error('save failed'))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText(
      `저장 안 됨 · 마지막 저장 ${formatSavedAtCompact(savedAt)}`,
    )).toBeTruthy()
    expect(screen.getByRole('button', { name: '저장' }).getAttribute('title'))
      .toContain(formatSavedAtFull(savedAt))
  })

  it('restores the backend updated_at timestamp on initial load', async () => {
    const savedAt = new Date(2026, 8, 29, 18, 5, 4).toISOString()
    window.history.pushState({}, '', '/macro-editor?macro_id=saved')
    vi.mocked(macroEditorApi.get).mockResolvedValue({
      id: 'saved', name: 'Saved', version: 2, nodes: [], edges: [],
      metadata: { updated_at: savedAt },
    })

    render(<MacroEditorPage />)

    await waitFor(() => expect(
      screen.getByLabelText(`저장됨 · ${formatSavedAtCompact(savedAt)}`),
    ).toBeTruthy())
    window.history.pushState({}, '', '/macro-editor')
  })

  it('saves an invalid graph without calling the validation endpoint', async () => {
    render(<MacroEditorPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove entry node' }))
    fireEvent.click(screen.getByRole('button', { name: '검증' }))

    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalledTimes(1))
    expect(macroEditorApi.validate).not.toHaveBeenCalled()
    expect(screen.getByText(/저장됨 · 검증 오류 \d+개/)).toBeTruthy()
    expect(screen.getAllByText(/검증 오류 \d+개/).length).toBeGreaterThan(0)
    expect(window.localStorage.getItem(MACRO_DRAFT_STORAGE_KEY)).not.toBeNull()
  })

  it('tracks saved and validation status independently', async () => {
    render(<MacroEditorPage />)
    expect(screen.getByText('저장됨')).toBeTruthy()
    expect(screen.getByText('검증 안 됨')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '검증' }))
    await waitFor(() => expect(screen.getByText('검증됨')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '대기 추가' }))
    expect(screen.getByText('저장 안 됨')).toBeTruthy()
    expect(screen.getByText('검증 결과 오래됨')).toBeTruthy()
  })
})
