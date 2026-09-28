// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    delete: vi.fn(),
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
      trace: [{
        node_id: 'find',
        node_type: 'find_element',
        status: 'success',
        started_at: '2026-09-28T00:00:01Z',
        completed_at: '2026-09-28T00:00:02Z',
        error: null,
      }],
      started_at: '2026-09-28T00:00:00Z',
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
    vi.mocked(macroEditorApi.command).mockResolvedValue({ runtime: runtime().runtime! })
    vi.mocked(macroEditorApi.unbind).mockResolvedValue(undefined)
    vi.mocked(macroEditorApi.delete).mockResolvedValue(undefined)
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
    expect(screen.getByRole('tab', { name: '실행' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Shared Flow')).toBeTruthy()
    expect(screen.getByText('실행 중')).toBeTruthy()
    expect(screen.getByText(/현재 노드:/).parentElement?.textContent).toContain('Step: 4')
  })

  it('uses the macro list by default and keeps runtime tables in detail only', async () => {
    const view = render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    const canvas = await screen.findByTestId('integrated-canvas')

    expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
    expect(screen.getByTestId('integrated-canvas')).toBe(canvas)
    expect(screen.queryByText('Variables')).toBeNull()
    expect(screen.queryByText('Trace')).toBeNull()
    expect(screen.getByRole('button', { name: '일시정지' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '중지' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '상세' }))
    expect(screen.getByText('Shared Flow')).toBeTruthy()
    expect(screen.getByText('phone-a · run-a')).toBeTruthy()
    expect(screen.getByText('Current Node').nextElementSibling?.textContent).toContain('엘리먼트 찾기')
    expect(screen.getByText('Current Screen').nextElementSibling?.textContent).toBe('스터디룸 예약 메인')
    expect(screen.getByText('Step Count').nextElementSibling?.textContent).toBe('4')
    expect(screen.getByLabelText('런타임 변수').textContent).toContain('count')
    expect(screen.queryByLabelText('런타임 트레이스')).toBeNull()
    expect(screen.getByRole('button', { name: '일시정지' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Trace/ }))
    expect(screen.getByLabelText('런타임 트레이스').textContent).toContain('성공')
    expect(screen.getByLabelText('런타임 트레이스').textContent).toContain('find')
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
    await waitFor(() => expect(macroEditorApi.command).toHaveBeenCalledWith('phone-a', 'pause', undefined))
    fireEvent.click(screen.getByRole('button', { name: '매크로 목록' }))

    view.rerender(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime('paused')} />)
    expect(screen.getByRole('button', { name: '계속' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '중지' }).hasAttribute('disabled')).toBe(false)

    view.rerender(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime('completed')} />)
    fireEvent.click(screen.getByRole('button', { name: '상세' }))
    expect(screen.getByRole('button', { name: '초기화' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '매크로 목록' }))

    view.rerender(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime('idle')} />)
    expect(screen.getByRole('button', { name: '실행' }).hasAttribute('disabled')).toBe(false)
    vi.mocked(macroEditorApi.command).mockClear()
    fireEvent.click(screen.getByRole('button', { name: '실행' }))
    const dialog = screen.getByRole('dialog', { name: '매크로 실행' })
    expect(macroEditorApi.command).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '실행' }))
    await waitFor(() => expect(macroEditorApi.bind).toHaveBeenCalledWith('phone-a', 'shared'))
    expect(macroEditorApi.command).toHaveBeenCalledWith('phone-a', 'start', { variables: {} })

    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    expect(screen.getByTestId('integrated-canvas')).toBe(canvas)
    expect(screen.getByRole('button', { name: '저장' })).toBeTruthy()
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
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
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
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))

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
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))

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

  it('expands the same canvas editor and preserves edits after X or Escape closes it', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    const canvas = await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))

    fireEvent.click(screen.getByRole('button', { name: '확대' }))
    expect(screen.getByRole('dialog', { name: '매크로 캔버스 확대' })).toBeTruthy()
    expect(screen.getByTestId('integrated-canvas')).toBe(canvas)
    expect(screen.getAllByRole('separator')).toHaveLength(2)
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.click(screen.getByRole('button', { name: '대기 추가' }))
    expect(canvas.textContent).toContain('wait-1')
    fireEvent.click(screen.getByRole('button', { name: '확대 화면 닫기' }))
    expect(screen.queryByRole('dialog', { name: '매크로 캔버스 확대' })).toBeNull()
    expect(screen.getByTestId('integrated-canvas')).toBe(canvas)
    expect(canvas.textContent).toContain('wait-1')
    expect(screen.getByText('편집 중')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '확대' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '매크로 캔버스 확대' })).toBeNull()
    expect(canvas.textContent).toContain('wait-1')
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps the canvas editor available without duplicate macro management controls', async () => {
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

    await screen.findByText('Shared Flow')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    expect(await screen.findByText('선택된 매크로가 없습니다')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '새 매크로' })).toBeNull()
    expect(screen.queryByRole('button', { name: '초안 불러오기' })).toBeNull()
    expect(screen.queryByLabelText('작업공간 매크로')).toBeNull()
    expect(screen.getByLabelText('매크로 화면')).toBeTruthy()
    expect(screen.getByLabelText('블록 팔레트')).toBeTruthy()
    expect(screen.getByLabelText('선택한 노드 설정')).toBeTruthy()
    expect(onAvailabilityChange).toHaveBeenLastCalledWith(false)
  })

  it('creates and switches to an isolated function subgraph', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    const canvas = await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))

    fireEvent.click(screen.getByRole('button', { name: '새 함수' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '새 함수' })).getByRole('button', { name: '생성' }))

    expect(screen.getByLabelText<HTMLSelectElement>('매크로 그래프').value).toBe('function-1')
    expect(canvas.textContent).toContain('function-1-entry')
    expect(canvas.textContent).toContain('function-1-return')
    expect(screen.getByLabelText<HTMLSelectElement>('매크로 화면').disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('매크로 그래프'), { target: { value: '__main__' } })
    expect(canvas.textContent).not.toContain('function-1-entry')
    expect(screen.getByLabelText('매크로 화면')).toBeTruthy()
  })

  it('updates Call Function ports when the function signature changes', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))

    fireEvent.click(screen.getByRole('button', { name: '새 함수' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '새 함수' })).getByRole('button', { name: '생성' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 입력' }))
    let portDialog = screen.getByRole('dialog', { name: '입력 포트 추가' })
    fireEvent.change(within(portDialog).getByLabelText('포트 이름'), { target: { value: 'index' } })
    fireEvent.change(within(portDialog).getByRole('combobox'), { target: { value: 'int' } })
    fireEvent.click(within(portDialog).getByRole('button', { name: '추가' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 출력' }))
    portDialog = screen.getByRole('dialog', { name: '출력 포트 추가' })
    fireEvent.change(within(portDialog).getByLabelText('포트 이름'), { target: { value: 'success' } })
    fireEvent.change(within(portDialog).getByRole('combobox'), { target: { value: 'bool' } })
    fireEvent.click(within(portDialog).getByRole('button', { name: '추가' }))
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
  })

  it('creates a typed variable and configures new Set/Get nodes from it', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))

    fireEvent.click(screen.getByRole('button', { name: '+ 변수' }))
    const variableDialog = screen.getByRole('dialog', { name: '변수 추가' })
    fireEvent.change(within(variableDialog).getByLabelText('이름'), { target: { value: 'count' } })
    fireEvent.click(within(variableDialog).getByRole('button', { name: '추가' }))
    expect(screen.getByLabelText<HTMLSelectElement>('매크로 변수').value).toBe('count')
    fireEvent.click(screen.getByRole('button', { name: '실행 입력' }))
    fireEvent.click(screen.getByRole('button', { name: '변수 설정 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '변수 가져오기 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalled())
    const saved = vi.mocked(macroEditorApi.save).mock.calls.at(-1)?.[0]
    expect(saved?.variables).toEqual([{ name: 'count', type: 'int', default: 0, input: true }])
    expect(saved?.nodes.find((node) => node.type === 'set_variable')?.config).toEqual({
      name: 'count', type: 'int', default: 0,
    })
    expect(saved?.nodes.find((node) => node.type === 'get_variable')?.config).toEqual({
      name: 'count', type: 'int',
    })
  })

  it('manages named variables and functions from My Blueprint and its inspector', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    const canvas = await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    fireEvent.click(screen.getByRole('tab', { name: 'My Blueprint' }))
    const blueprint = screen.getByLabelText('My Blueprint')

    fireEvent.click(within(blueprint).getByRole('button', { name: '새 변수' }))
    let editorDialog = screen.getByRole('dialog', { name: '변수 추가' })
    fireEvent.change(within(editorDialog).getByLabelText('이름'), { target: { value: 'count' } })
    fireEvent.click(within(editorDialog).getByRole('button', { name: '추가' }))
    fireEvent.click(within(blueprint).getByRole('button', { name: 'count 변수 int' }))
    const inspector = screen.getByLabelText('My Blueprint 설정')
    expect(within(inspector).getByText('0')).toBeTruthy()

    fireEvent.click(within(blueprint).getByRole('button', { name: '새 함수' }))
    editorDialog = screen.getByRole('dialog', { name: '새 함수' })
    fireEvent.change(within(editorDialog).getByLabelText('함수 이름'), { target: { value: 'Select Time Slot' } })
    fireEvent.click(within(editorDialog).getByRole('button', { name: '생성' }))
    expect(screen.getByLabelText<HTMLSelectElement>('매크로 그래프').value).toBe('function-1')
    expect(canvas.textContent).toContain('function-1-entry')
    expect(canvas.textContent).toContain('function-1-return')
    expect(within(blueprint).getByRole('button', { name: 'Select Time Slot 함수' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Select Time Slot' }).getAttribute('aria-current')).toBe('page')
  })

  it('shows the execution empty state and starts a new macro from it', async () => {
    vi.mocked(macroEditorApi.list).mockResolvedValue({ macros: [] })
    vi.mocked(macroEditorApi.binding).mockResolvedValue({ binding: null, shared_device_count: 0 })
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime('idle')} />)

    expect(await screen.findByText('등록된 매크로가 없습니다.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '새 매크로 만들기' }))
    const createDialog = screen.getByRole('dialog', { name: '새 매크로' })
    fireEvent.change(within(createDialog).getByLabelText('매크로 이름'), { target: { value: '아침 예약' } })
    fireEvent.click(within(createDialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(macroEditorApi.create).toHaveBeenCalled())
    expect(vi.mocked(macroEditorApi.create).mock.calls[0]?.[0].name).toBe('아침 예약')
    expect(macroEditorApi.bind).toHaveBeenCalledWith('phone-a', expect.stringMatching(/^macro-/))
    expect(screen.getByRole('tab', { name: '캔버스' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('아침 예약')).toBeTruthy()
  })

  it('renames, duplicates, and deletes macros from the execution list', async () => {
    const renamed = { ...definition, name: 'Renamed Flow', version: 4 }
    const copy = { ...definition, id: 'shared-copy', name: 'Renamed Flow 복사본', version: 1 }
    vi.mocked(macroEditorApi.save).mockResolvedValue(renamed)
    vi.mocked(macroEditorApi.duplicate).mockResolvedValue(copy)
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime('idle')} />)

    await screen.findByText('Shared Flow')
    fireEvent.click(screen.getByRole('button', { name: '이름 변경' }))
    const renameDialog = screen.getByRole('dialog', { name: '매크로 이름 변경' })
    fireEvent.change(within(renameDialog).getByLabelText('매크로 이름'), { target: { value: 'Renamed Flow' } })
    fireEvent.click(within(renameDialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalledWith({
      ...definition,
      name: 'Renamed Flow',
    }))
    expect(screen.getByText('Renamed Flow')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '복제' }))
    await waitFor(() => expect(macroEditorApi.duplicate).toHaveBeenCalledWith('shared', {
      name: 'Renamed Flow 복사본',
    }))
    expect(screen.getByText('Renamed Flow 복사본')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]!)
    const deleteDialog = screen.getByRole('alertdialog', { name: '매크로 삭제' })
    expect(within(deleteDialog).getByText(/Renamed Flow 매크로를 삭제/)).toBeTruthy()
    fireEvent.click(within(deleteDialog).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(macroEditorApi.unbind).toHaveBeenCalledWith('phone-a'))
    expect(macroEditorApi.delete).toHaveBeenCalledWith('shared')
    expect(screen.queryByText('Renamed Flow')).toBeNull()
  })

  it('prevents deleting the running macro until it is stopped', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime('running')} />)

    await screen.findByText('Shared Flow')
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(await screen.findByText('실행 중인 매크로는 삭제할 수 없습니다. 먼저 중지하세요.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(macroEditorApi.delete).not.toHaveBeenCalled()
  })

  it('validates external inputs and passes only them to the new runtime', async () => {
    const inputDefinition: MacroDefinition = {
      ...definition,
      variables: [
        { name: 'enabled', type: 'bool', default: true, input: true },
        { name: 'retries', type: 'int', default: 2, input: true, description: '재시도 횟수' },
        { name: 'ratio', type: 'float', default: 1.5, input: true },
        { name: 'label', type: 'string', default: 'morning', input: true },
        { name: 'position', type: 'position', default: { x: 10, y: 20 }, input: true },
        {
          name: 'area',
          type: 'rect',
          default: { left: 0, top: 0, right: 100, bottom: 100 },
          input: true,
        },
        { name: 'target', type: 'element', input: true },
        { name: 'internal_count', type: 'int', default: 0 },
      ],
    }
    vi.mocked(macroEditorApi.list).mockResolvedValue({ macros: [inputDefinition] })
    vi.mocked(macroEditorApi.get).mockResolvedValue(inputDefinition)
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime('idle')} />)

    await screen.findByText('Shared Flow')
    fireEvent.click(screen.getByRole('button', { name: '실행' }))
    const dialog = screen.getByRole('dialog', { name: '매크로 실행' })
    expect(within(dialog).getByText('phone-a')).toBeTruthy()
    expect(within(dialog).queryByText('internal_count')).toBeNull()
    expect(within(dialog).getByLabelText(/enabled/).getAttribute('type')).toBe('checkbox')
    expect(within(dialog).getByLabelText(/retries/).getAttribute('type')).toBe('number')
    expect(within(dialog).getByLabelText(/ratio/).getAttribute('type')).toBe('number')
    expect(within(dialog).getByLabelText(/label/).getAttribute('type')).toBe('text')

    fireEvent.change(within(dialog).getByLabelText(/retries/), { target: { value: '2.5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '실행' }))
    expect(await within(dialog).findByText('정수를 입력하세요.')).toBeTruthy()
    expect(macroEditorApi.command).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText(/retries/), { target: { value: '3' } })
    fireEvent.change(within(dialog).getByLabelText(/target/), {
      target: { value: JSON.stringify({
        id: 'reserve-button',
        bounds: { left: 10, top: 20, right: 110, bottom: 70 },
      }) },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '실행' }))

    await waitFor(() => expect(macroEditorApi.command).toHaveBeenCalledWith(
      'phone-a',
      'start',
      { variables: {
        enabled: true,
        retries: 3,
        ratio: 1.5,
        label: 'morning',
        position: { x: 10, y: 20 },
        area: { left: 0, top: 0, right: 100, bottom: 100 },
        target: {
          id: 'reserve-button',
          bounds: { left: 10, top: 20, right: 110, bottom: 70 },
        },
      } },
    ))
  })
})
