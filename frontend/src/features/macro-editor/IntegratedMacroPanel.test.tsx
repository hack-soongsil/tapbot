// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macroEditorApi } from './api'
import {
  IntegratedMacroPanel,
  type IntegratedMacroPanelHandle,
} from './IntegratedMacroPanel'
import type { MacroCanvasProps } from './MacroCanvas'
import type { MacroDefinition, MacroRuntime } from './types'
import type { useMacroRuntime } from '../macro-runtime/useMacroRuntime'

vi.mock('./api', () => ({
  macroEditorApi: {
    list: vi.fn(),
    binding: vi.fn(),
    get: vi.fn(),
    save: vi.fn(),
    create: vi.fn(),
    validate: vi.fn(),
    bind: vi.fn(),
    unbind: vi.fn(),
    duplicate: vi.fn(),
    command: vi.fn(),
  },
}))

vi.mock('./MacroCanvas', () => ({
  MacroCanvas: ({ nodes, edges }: MacroCanvasProps) => (
    <div data-testid="integrated-canvas">
      {nodes.map((node) => (
        <span key={node.id} data-state={node.data.runtimeState}>{node.id}</span>
      ))}
      {edges.map((edge) => (
        <i key={edge.id} data-current={edge.className === 'runtime-current-edge'}>{edge.id}</i>
      ))}
    </div>
  ),
}))

const definition: MacroDefinition = {
  id: 'shared',
  name: 'Shared Flow',
  version: 3,
  entry_node_id: 'find',
  nodes: [{
    id: 'find',
    type: 'find_element',
    config: { selector: { view_id: 'example:id/reserve' } },
    position: { x: 0, y: 0 },
  }],
  edges: [],
  metadata: {},
}

function runtime(state: MacroRuntime['state'] = 'running'): ReturnType<typeof useMacroRuntime> {
  return {
    runtime: {
      device_id: 'phone-a',
      runtime_id: 'run-a',
      macro_definition_id: 'shared',
      definition_version: 3,
      current_node_id: 'find',
      current_edge_id: null,
      state,
      active_screen_id: 'reservation_home',
      step_count: 4,
      variables: { count: 2 },
      trace: [{ node_id: 'find', status: 'success' }],
      started_at: null,
      error: null,
    },
    nodeState: { find: 'running' },
    currentNodeId: 'find',
    currentEdgeId: null,
    events: [],
    overlay: { bounds: null, tapPoint: null, nodeId: null },
    connected: true,
    lastSequence: 1,
    refresh: vi.fn(() => Promise.resolve()),
  }
}

describe('IntegratedMacroPanel', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    vi.mocked(macroEditorApi.list).mockResolvedValue({ macros: [definition] })
    vi.mocked(macroEditorApi.binding).mockResolvedValue({
      binding: {
        device_id: 'phone-a',
        macro_definition_id: 'shared',
        enabled: true,
        config: {},
      },
      shared_device_count: 1,
    })
    vi.mocked(macroEditorApi.get).mockResolvedValue(definition)
    vi.mocked(macroEditorApi.save).mockImplementation((value) => Promise.resolve(value))
    vi.mocked(macroEditorApi.create).mockImplementation((value) => Promise.resolve(value))
    vi.mocked(macroEditorApi.validate).mockResolvedValue({ valid: true, errors: [] })
    vi.mocked(macroEditorApi.bind).mockResolvedValue({
      binding: {
        device_id: 'phone-a',
        macro_definition_id: 'shared',
        enabled: true,
        config: {},
      },
      shared_device_count: 1,
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })

  it('loads the selected device binding and decorates the running node', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)

    expect(await screen.findByTestId('integrated-canvas')).toBeTruthy()
    expect(macroEditorApi.binding).toHaveBeenCalledWith('phone-a')
    expect(screen.getByText('find').getAttribute('data-state')).toBe('running')
    fireEvent.click(screen.getByRole('tab', { name: '실행' }))
    expect(screen.getByText('실행 중 v3')).toBeTruthy()
  })

  it('separates editing and runtime controls while preserving the mounted canvas', async () => {
    const view = render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    const canvas = await screen.findByTestId('integrated-canvas')

    expect(screen.getByRole('tab', { name: '캔버스' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: '저장' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '일시정지' })).toBeNull()
    expect(screen.getByText(/현재 실행에는 저장 후 변경사항이 반영되지 않습니다/)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '실행' }))

    expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
    expect(screen.getByTestId('integrated-canvas')).toBe(canvas)
    expect(screen.getByText('Current Node').nextElementSibling?.textContent).toBe('find')
    expect(screen.getByText('Current Screen').nextElementSibling?.textContent).toBe('스터디룸 예약 메인')
    expect(screen.getByText('Step Count').nextElementSibling?.textContent).toBe('4')
    expect(screen.getByLabelText('런타임 변수').textContent).toContain('count')
    expect(screen.getByLabelText('런타임 트레이스').textContent).toContain('success')

    expect(screen.getByRole('button', { name: '실행' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '일시정지' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '계속' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '한 단계 실행' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '중지' }).hasAttribute('disabled')).toBe(false)

    view.rerender(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime('paused')} />)
    expect(screen.getByRole('button', { name: '계속' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '한 단계 실행' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '중지' }).hasAttribute('disabled')).toBe(false)

    view.rerender(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime('idle')} />)
    expect(screen.getByRole('button', { name: '실행' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '일시정지' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '한 단계 실행' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '중지' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    expect(screen.getByTestId('integrated-canvas')).toBe(canvas)
  })

  it('adds one Find Element with the selected UI text and tree path', async () => {
    const ref = createRef<IntegratedMacroPanelHandle>()
    const onAvailabilityChange = vi.fn()
    render(
      <IntegratedMacroPanel
        ref={ref}
        deviceId="phone-a"
        runtime={runtime()}
        onAvailabilityChange={onAvailabilityChange}
      />,
    )
    await screen.findByTestId('integrated-canvas')
    await waitFor(() => expect(onAvailabilityChange).toHaveBeenLastCalledWith(true))

    act(() => {
      expect(ref.current?.addFindElement(
        { text: 'Confirm', ui_tree_path: 'n0.0.1' },
        'Confirm',
      )).toBe(true)
    })
    expect(await screen.findByText('find_element-1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalled())
    const saved = vi.mocked(macroEditorApi.save).mock.calls[0]?.[0]
    const added = saved?.nodes.find((node) => node.id === 'find_element-1')
    expect(added?.config).toEqual({ selector: {
      text: 'Confirm',
      ui_tree_path: 'n0.0.1',
    } })
    const screenNodeIds = saved?.metadata.editor_screen_node_ids
    const homeNodeIds =
      screenNodeIds && typeof screenNodeIds === 'object' && !Array.isArray(screenNodeIds)
        ? screenNodeIds.reservation_home
        : null
    expect(Array.isArray(homeNodeIds) ? homeNodeIds : []).toContain('find_element-1')
    expect(JSON.stringify(added?.config)).not.toContain('bounds')
  })

  it('keeps unsaved drafts isolated per device and restores them on return', async () => {
    const ref = createRef<IntegratedMacroPanelHandle>()
    const first = render(
      <IntegratedMacroPanel ref={ref} deviceId="phone-a" runtime={runtime()} />,
    )
    await screen.findByTestId('integrated-canvas')

    act(() => {
      expect(ref.current?.addFindElement(
        { text: 'Phone A only', ui_tree_path: 'n0.2' },
        'Phone A only',
      )).toBe(true)
    })
    expect(await screen.findByText('find_element-1')).toBeTruthy()
    await waitFor(() => {
      expect(window.sessionStorage.getItem('tapbot.macro.deviceDraft.phone-a')).not.toBeNull()
    })
    first.unmount()

    const second = render(
      <IntegratedMacroPanel deviceId="phone-b" runtime={runtime()} />,
    )
    await screen.findByTestId('integrated-canvas')
    expect(screen.queryByText('find_element-1')).toBeNull()
    expect(screen.getByText('기기 · phone-b')).toBeTruthy()
    second.unmount()

    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    expect(await screen.findByText('find_element-1')).toBeTruthy()
    expect(screen.getByText('기기 · phone-a')).toBeTruthy()
  })

  it('shows one screen graph at a time with three protected lifecycle events', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    const canvas = await screen.findByTestId('integrated-canvas')

    expect(canvas.textContent).toContain('event-home-enter')
    expect(canvas.textContent).toContain('event-home-update')
    expect(canvas.textContent).toContain('event-home-exit')
    expect(canvas.textContent).not.toContain('event-detail-enter')

    fireEvent.change(screen.getByLabelText('매크로 화면'), {
      target: { value: 'reservation_detail' },
    })
    expect(canvas.textContent).toContain('event-detail-enter')
    expect(canvas.textContent).toContain('event-detail-update')
    expect(canvas.textContent).toContain('event-detail-exit')
    expect(canvas.textContent).not.toContain('event-home-enter')
  })

  it('keeps ordinary nodes isolated between the Home and Detail canvases', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    const canvas = await screen.findByTestId('integrated-canvas')

    fireEvent.click(screen.getByRole('button', { name: '대기 추가' }))
    expect(canvas.textContent).toContain('wait-1')

    fireEvent.change(screen.getByLabelText('매크로 화면'), {
      target: { value: 'reservation_detail' },
    })
    expect(canvas.textContent).not.toContain('wait-1')
    fireEvent.click(screen.getByRole('button', { name: '위치 클릭 추가' }))
    expect(canvas.textContent).toContain('click_point-1')

    fireEvent.change(screen.getByLabelText('매크로 화면'), {
      target: { value: 'reservation_home' },
    })
    expect(canvas.textContent).toContain('wait-1')
    expect(canvas.textContent).not.toContain('click_point-1')
  })

  it('keeps creation and draft controls available with no device binding', async () => {
    vi.mocked(macroEditorApi.binding).mockResolvedValue({
      binding: null,
      shared_device_count: 0,
    })
    const onAvailabilityChange = vi.fn()
    render(
      <IntegratedMacroPanel
        deviceId="phone-a"
        runtime={runtime()}
        onAvailabilityChange={onAvailabilityChange}
      />,
    )

    expect(await screen.findByText('선택된 매크로가 없습니다')).toBeTruthy()
    expect(screen.getByRole('button', { name: '새 매크로' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '초안 불러오기' })).toBeTruthy()
    expect(screen.getByLabelText('작업공간 매크로')).toBeTruthy()
    expect(screen.getByLabelText('매크로 화면')).toBeTruthy()
    expect(screen.getByLabelText('블록 팔레트')).toBeTruthy()
    expect(screen.getByLabelText('선택한 노드 설정')).toBeTruthy()
    expect(onAvailabilityChange).toHaveBeenLastCalledWith(false)
  })

  it('creates and switches to an isolated function subgraph', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    const canvas = await screen.findByTestId('integrated-canvas')

    fireEvent.click(screen.getByRole('button', { name: '새 함수' }))

    expect(screen.getByLabelText<HTMLSelectElement>('매크로 그래프').value).toBe('function-1')
    expect(canvas.textContent).toContain('function-1-entry')
    expect(canvas.textContent).toContain('function-1-return')
    expect(screen.getByLabelText<HTMLSelectElement>('매크로 화면').disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('매크로 그래프'), { target: { value: '__main__' } })
    expect(canvas.textContent).not.toContain('function-1-entry')
    expect(screen.getByLabelText('매크로 화면')).toBeTruthy()
  })

  it('updates Call Function ports when the function signature changes', async () => {
    const prompt = vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('index')
      .mockReturnValueOnce('int')
      .mockReturnValueOnce('success')
      .mockReturnValueOnce('bool')
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    await screen.findByTestId('integrated-canvas')

    fireEvent.click(screen.getByRole('button', { name: '새 함수' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 입력' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 출력' }))
    fireEvent.change(screen.getByLabelText('매크로 그래프'), { target: { value: '__main__' } })
    fireEvent.click(screen.getByRole('button', { name: '함수 호출 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalled())
    const saved = vi.mocked(macroEditorApi.save).mock.calls.at(-1)?.[0]
    expect(saved?.functions?.[0]).toMatchObject({
      inputs: [{ id: 'index', type: 'int' }],
      outputs: [{ id: 'success', type: 'bool' }],
    })
    expect(saved?.nodes.find((node) => node.type === 'call_function')?.config).toMatchObject({
      function_id: 'function-1',
      inputs: [{ id: 'index', type: 'int' }],
      outputs: [{ id: 'success', type: 'bool' }],
    })
    prompt.mockRestore()
  })

  it('creates a typed variable and configures new Set/Get nodes from it', async () => {
    const prompt = vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('count')
      .mockReturnValueOnce('int')
      .mockReturnValueOnce('0')
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    await screen.findByTestId('integrated-canvas')

    fireEvent.click(screen.getByRole('button', { name: '+ 변수' }))
    expect(screen.getByLabelText<HTMLSelectElement>('매크로 변수').value).toBe('count')
    fireEvent.click(screen.getByRole('button', { name: '변수 설정 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '변수 가져오기 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalled())
    const saved = vi.mocked(macroEditorApi.save).mock.calls.at(-1)?.[0]
    expect(saved?.variables).toEqual([{ name: 'count', type: 'int', default: 0 }])
    expect(saved?.nodes.find((node) => node.type === 'set_variable')?.config).toEqual({
      name: 'count', type: 'int', default: 0,
    })
    expect(saved?.nodes.find((node) => node.type === 'get_variable')?.config).toEqual({
      name: 'count', type: 'int',
    })
    prompt.mockRestore()
  })
})
