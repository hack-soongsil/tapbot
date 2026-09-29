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
import { runtimeGraphOverlayFromSnapshot } from '../macro-runtime/runtime-overlay'

const flowInstance = vi.hoisted(() => ({
  getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
  setViewport: vi.fn(() => Promise.resolve(true)),
  fitView: vi.fn(() => Promise.resolve(true)),
  setCenter: vi.fn(() => Promise.resolve(true)),
}))

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
  MacroCanvas: ({
    nodes,
    edges,
    onReady,
    onSelectNode,
    onOpenFunction,
    onNodesChange,
    onDropBlueprintItem,
  }: MacroCanvasProps) => {
    onReady(flowInstance as never)
    return (
      <div data-testid="integrated-canvas">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-state={node.data.runtimeState}
            onClick={() => onSelectNode(node.id)}
            onDoubleClick={() => {
              if (node.data.nodeType === 'call_function') {
                const id = node.data.config.function_id
                onOpenFunction?.(typeof id === 'string' ? id : undefined)
              }
            }}
          >{node.id}</button>
        ))}
        {edges.map((edge) => (
          <i key={edge.id} data-current={edge.className === 'runtime-current-edge'} data-error={edge.className?.includes('runtime-error-edge')}>{edge.id}</i>
        ))}
        <button
          type="button"
          onClick={() => {
            const first = nodes[0]
            if (first) onNodesChange([{ type: 'remove', id: first.id }])
          }}
        >Remove entry node</button>
        <button
          type="button"
          onClick={() => onDropBlueprintItem?.(
            { kind: 'function', id: 'function-1' },
            { x: 40, y: 60 },
          )}
        >Drop function-1</button>
      </div>
    )
  },
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
  const snapshot: MacroRuntime = {
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
    }
  return {
    runtime: snapshot,
    graphOverlay: runtimeGraphOverlayFromSnapshot(snapshot),
    events: [],
    overlay: { bounds: null, tapPoint: null, nodeId: null },
    connected: true,
    lastSequence: 1,
    refresh: vi.fn(() => Promise.resolve()),
  }
}

function syncRuntimeOverlay(view: ReturnType<typeof useMacroRuntime>) {
  if (view.runtime) view.graphOverlay = runtimeGraphOverlayFromSnapshot(view.runtime, view.graphOverlay)
  return view
}

describe('IntegratedMacroPanel', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
    flowInstance.getViewport.mockReset().mockReturnValue({ x: 0, y: 0, zoom: 1 })
    flowInstance.setViewport.mockReset().mockResolvedValue(true)
    flowInstance.fitView.mockReset().mockResolvedValue(true)
    flowInstance.setCenter.mockReset().mockResolvedValue(true)
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
    window.localStorage.clear()
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

    expect(screen.queryByRole('button', { name: '상세' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Shared Flow 실행 정보 보기' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Shared Flow 실행 정보 보기' }))
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

  it('exposes Edit as a primary card action and opens that macro at the Main canvas', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime('idle')} />)
    await screen.findByTestId('integrated-canvas')

    const card = screen.getByText('Shared Flow').closest('article')!
    const edit = within(card).getByRole('button', { name: '편집' })
    const run = within(card).getByRole('button', { name: '실행' })
    expect(edit.getAttribute('title')).toBe('편집')
    expect(run.getAttribute('title')).toBe('실행')
    expect(edit.textContent).toBe('')
    expect(run.textContent).toBe('')
    expect(edit.querySelector('.bp6-icon-edit')).toBeTruthy()
    expect(run.querySelector('.bp6-icon-play')).toBeTruthy()
    const more = within(card).getByLabelText('더보기')
    expect(more.getAttribute('title')).toBe('더보기')
    expect(more.textContent).toBe('')
    const menu = more.closest('details')!
    expect(within(menu).queryByText('캔버스에서 편집')).toBeNull()
    expect(within(menu).queryByRole('button', { name: /^(편집|실행)$/ })).toBeNull()
    expect(within(menu).getByRole('button', { name: '이름 변경' })).toBeTruthy()
    expect(within(menu).getByRole('button', { name: '바인딩 해제' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    fireEvent.click(screen.getByRole('tab', { name: 'My Blueprint' }))
    fireEvent.click(within(screen.getByLabelText('My Blueprint')).getByRole('button', { name: '새 함수' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '새 함수' })).getByRole('button', { name: '생성' }))
    expect(screen.getByLabelText<HTMLSelectElement>('매크로 그래프').value).toBe('function-1')
    fireEvent.click(screen.getByRole('tab', { name: '실행' }))

    fireEvent.click(screen.getByRole('button', { name: '편집' }))
    const discard = screen.getByRole('alertdialog', { name: '변경사항 버리기' })
    fireEvent.click(within(discard).getByRole('button', { name: '버리기' }))

    await waitFor(() => expect(macroEditorApi.get).toHaveBeenLastCalledWith('shared'))
    expect(screen.getByRole('tab', { name: '캔버스' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByLabelText<HTMLSelectElement>('매크로 그래프').value).toBe('__main__')
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

  it('persists an invalid graph while keeping execution validation separate', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime('idle')} />)
    await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove entry node' }))
    fireEvent.click(screen.getByRole('button', { name: '검증' }))

    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalledTimes(1))
    expect(macroEditorApi.validate).not.toHaveBeenCalled()
    expect(macroEditorApi.bind).not.toHaveBeenCalled()
    expect(screen.getByText(/저장됨 · 검증 오류 \d+개 · 기기 연결 차단됨/)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '실행' }))
    fireEvent.click(screen.getByRole('button', { name: '실행' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '매크로 실행' }))
      .getByRole('button', { name: '실행' }))
    expect(await screen.findByText(/검증 오류 \d+개가 있어 실행할 수 없습니다/)).toBeTruthy()
    expect(macroEditorApi.command).not.toHaveBeenCalled()
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
    expect(screen.getByText('저장 안 됨')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '확대' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '매크로 캔버스 확대' })).toBeNull()
    expect(canvas.textContent).toContain('wait-1')
    expect(document.body.style.overflow).toBe('')
  })

  it('restores, constrains, saves, and resets expanded side widths', async () => {
    window.localStorage.setItem('tapbot.macro.expandedLayout.v1', JSON.stringify({
      blueprintWidth: 360,
      inspectorWidth: 410,
    }))
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    fireEvent.click(screen.getByRole('button', { name: '확대' }))

    const blueprintSplitter = screen.getByRole('separator', { name: 'My Blueprint/Blocks와 캔버스 크기 조절' })
    const inspectorSplitter = screen.getByRole('separator', { name: '캔버스와 인스펙터 크기 조절' })
    const editor = document.getElementById('integrated-macro-editor')!
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 1500,
      bottom: 800,
      left: 0,
      width: 1500,
      height: 800,
      toJSON: () => ({}),
    })
    Object.defineProperty(blueprintSplitter, 'setPointerCapture', { value: vi.fn() })
    Object.defineProperty(inspectorSplitter, 'setPointerCapture', { value: vi.fn() })

    expect(blueprintSplitter.getAttribute('aria-valuenow')).toBe('360')
    expect(inspectorSplitter.getAttribute('aria-valuenow')).toBe('410')

    fireEvent.pointerDown(blueprintSplitter, { pointerId: 1, clientX: 360 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 1360 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(blueprintSplitter.getAttribute('aria-valuenow')).toBe('420')

    fireEvent.pointerDown(inspectorSplitter, { pointerId: 2, clientX: 1000 })
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 0 })
    fireEvent.pointerUp(window, { pointerId: 2 })
    expect(inspectorSplitter.getAttribute('aria-valuenow')).toBe('480')
    expect(editor.style.gridTemplateColumns).toContain('minmax(420px, 1fr)')

    await waitFor(() => expect(JSON.parse(
      window.localStorage.getItem('tapbot.macro.expandedLayout.v1') ?? '{}',
    )).toEqual({ blueprintWidth: 420, inspectorWidth: 480 }))

    fireEvent.doubleClick(blueprintSplitter)
    fireEvent.doubleClick(inspectorSplitter)
    expect(blueprintSplitter.getAttribute('aria-valuenow')).toBe('280')
    expect(inspectorSplitter.getAttribute('aria-valuenow')).toBe('320')
  })

  it('layers editor dialogs above the expanded canvas and closes the child first with Escape', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    fireEvent.click(screen.getByRole('button', { name: '확대' }))

    fireEvent.click(screen.getByRole('tab', { name: 'My Blueprint' }))
    const blueprint = screen.getByLabelText('My Blueprint')
    fireEvent.click(within(blueprint).getByRole('button', { name: '새 변수' }))
    const variableDialog = screen.getByRole('dialog', { name: '변수 추가' })
    const dialogPortal = variableDialog.closest('.tapbot-dialog-portal')
    expect(dialogPortal?.parentElement?.id).toBe('tapbot-overlay-root')
    expect(dialogPortal?.querySelector('.bp6-overlay-backdrop')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '매크로 캔버스 확대' })).toBeTruthy()

    fireEvent.keyDown(variableDialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '변수 추가' })).toBeNull())
    expect(screen.getByRole('dialog', { name: '매크로 캔버스 확대' })).toBeTruthy()

    fireEvent.click(within(blueprint).getByRole('button', { name: '새 함수' }))
    const functionDialog = screen.getByRole('dialog', { name: '새 함수' })
    expect(functionDialog.closest('.tapbot-dialog-portal')?.parentElement?.id).toBe('tapbot-overlay-root')
    expect(within(functionDialog).getByLabelText('함수 이름')).toBeTruthy()
    fireEvent.click(within(functionDialog).getByRole('button', { name: '취소' }))
    expect(screen.getByRole('dialog', { name: '매크로 캔버스 확대' })).toBeTruthy()
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

  it('keeps variable and function management out of the canvas toolbar', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))

    const toolbar = document.querySelector<HTMLElement>('.integrated-macro-toolbar__actions')!
    expect(within(toolbar).queryByLabelText('매크로 변수')).toBeNull()
    for (const name of [
      '+ 변수', '변수 수정', '변수 설정 추가', '변수 가져오기 추가', '실행 입력',
      '새 함수', '함수 호출 추가', '함수 이름 변경', '함수 삭제',
    ]) {
      expect(within(toolbar).queryByRole('button', { name })).toBeNull()
    }
    expect(within(toolbar).getByRole('button', { name: '검증' })).toBeTruthy()
    expect(within(toolbar).getByRole('button', { name: '화면 맞춤' })).toBeTruthy()
    expect(within(toolbar).getByRole('button', { name: '저장' })).toBeTruthy()
    expect(within(toolbar).getByRole('button', { name: '확대' })).toBeTruthy()
  })

  it('creates and switches to an isolated function subgraph', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    const canvas = await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    fireEvent.click(screen.getByRole('tab', { name: 'My Blueprint' }))

    fireEvent.click(within(screen.getByLabelText('My Blueprint')).getByRole('button', { name: '새 함수' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '새 함수' })).getByRole('button', { name: '생성' }))

    expect(screen.getByLabelText<HTMLSelectElement>('매크로 그래프').value).toBe('function-1')
    expect(canvas.textContent).toContain('function-1-entry')
    expect(canvas.textContent).toContain('function-1-return')
    expect(screen.getByLabelText<HTMLSelectElement>('매크로 화면').disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('매크로 그래프'), { target: { value: '__main__' } })
    expect(canvas.textContent).not.toContain('function-1-entry')
    expect(screen.getByLabelText('매크로 화면')).toBeTruthy()
  })

  it('navigates nested function breadcrumbs and restores each graph view state', async () => {
    const mainViewport = { x: 12, y: 24, zoom: 1.1 }
    const reserveViewport = { x: 120, y: 80, zoom: 1.45 }
    const slotViewport = { x: -30, y: 60, zoom: 1.8 }
    flowInstance.getViewport
      .mockReturnValueOnce(mainViewport)
      .mockReturnValueOnce(reserveViewport)
      .mockReturnValueOnce(slotViewport)

    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    const canvas = await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    fireEvent.click(screen.getByRole('tab', { name: 'My Blueprint' }))
    const blueprint = screen.getByLabelText('My Blueprint')

    fireEvent.click(within(blueprint).getByRole('button', { name: '새 함수' }))
    let nameDialog = screen.getByRole('dialog', { name: '새 함수' })
    fireEvent.change(within(nameDialog).getByLabelText('함수 이름'), { target: { value: 'Reserve' } })
    fireEvent.click(within(nameDialog).getByRole('button', { name: '생성' }))
    fireEvent.click(within(canvas).getByRole('button', { name: 'function-1-entry' }))

    fireEvent.click(within(blueprint).getByRole('button', { name: '새 함수' }))
    nameDialog = screen.getByRole('dialog', { name: '새 함수' })
    fireEvent.change(within(nameDialog).getByLabelText('함수 이름'), { target: { value: 'Select Time Slot' } })
    fireEvent.click(within(nameDialog).getByRole('button', { name: '생성' }))

    const breadcrumb = screen.getByRole('navigation', { name: '매크로 그래프 경로' })
    expect(document.getElementById('integrated-macro-editor')?.firstElementChild).toBe(breadcrumb)
    expect(within(breadcrumb).getByRole('button', { name: 'Main' })).toBeTruthy()
    expect(within(breadcrumb).getByRole('button', { name: 'Reserve' })).toBeTruthy()
    expect(within(breadcrumb).getByText('Select Time Slot').getAttribute('aria-current')).toBe('page')
    expect(within(breadcrumb).queryByRole('button', { name: 'Select Time Slot' })).toBeNull()

    fireEvent.click(within(screen.getByLabelText('My Blueprint 설정')).getByRole('button', { name: '이름 변경' }))
    nameDialog = screen.getByRole('dialog', { name: '함수 이름 변경' })
    fireEvent.change(within(nameDialog).getByLabelText('함수 이름'), { target: { value: 'Slot Finder' } })
    fireEvent.click(within(nameDialog).getByRole('button', { name: '저장' }))
    expect(within(breadcrumb).getByText('Slot Finder').getAttribute('aria-current')).toBe('page')

    fireEvent.click(within(breadcrumb).getByRole('button', { name: 'Reserve' }))
    expect(canvas.textContent).toContain('function-1-entry')
    expect(canvas.textContent).not.toContain('function-2-entry')
    expect(within(screen.getByLabelText('선택한 노드 설정')).getByDisplayValue('function-1-entry')).toBeTruthy()
    await waitFor(() => expect(flowInstance.setViewport).toHaveBeenCalledWith(reserveViewport, { duration: 0 }))

    fireEvent.click(within(breadcrumb).getByRole('button', { name: 'Main' }))
    expect(canvas.textContent).not.toContain('function-1-entry')
    expect(within(breadcrumb).getByText('Main').getAttribute('aria-current')).toBe('page')
    expect(within(breadcrumb).queryByRole('button', { name: 'Main' })).toBeNull()
    await waitFor(() => expect(flowInstance.setViewport).toHaveBeenCalledWith(mainViewport, { duration: 0 }))
  })

  it('opens nested call nodes through shared navigation and restores graph selection and viewport', async () => {
    const functions = ['first', 'second'].map((id): NonNullable<MacroDefinition['functions']>[number] => ({
      id, name: id, inputs: [], outputs: [],
      entry_node_id: `${id}-entry`, return_node_id: `${id}-return`,
      nodes: [
        { id: `${id}-entry`, type: 'function_entry', config: {} },
        { id: `${id}-return`, type: 'function_return', config: {} },
        ...(id === 'first' ? [{ id: 'nested-call', type: 'call_function' as const, config: { function_id: 'second' } }] : []),
      ],
      edges: [],
    }))
    vi.mocked(macroEditorApi.get).mockResolvedValue({
      ...definition,
      nodes: [{ id: 'main-call', type: 'call_function', config: { function_id: 'first' } }],
      entry_node_id: 'main-call', functions,
    })
    const mainViewport = { x: 25, y: 40, zoom: 1.2 }
    const firstViewport = { x: -50, y: 90, zoom: 0.8 }
    flowInstance.getViewport.mockReturnValue(mainViewport)
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    const canvas = await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    const breadcrumb = screen.getByRole('navigation', { name: '매크로 그래프 경로' })

    fireEvent.click(within(canvas).getByRole('button', { name: 'main-call' }))
    expect(breadcrumb.textContent).toBe('Main')
    fireEvent.doubleClick(within(canvas).getByRole('button', { name: 'main-call' }))
    expect(breadcrumb.textContent).toBe('Main›first')
    await waitFor(() => expect(flowInstance.fitView).toHaveBeenCalled())

    flowInstance.getViewport.mockReturnValue(firstViewport)
    fireEvent.click(within(canvas).getByRole('button', { name: 'nested-call' }))
    fireEvent.doubleClick(within(canvas).getByRole('button', { name: 'nested-call' }))
    expect(breadcrumb.textContent).toBe('Main›first›second')
    fireEvent.click(within(breadcrumb).getByRole('button', { name: 'first' }))
    expect(within(screen.getByLabelText('선택한 노드 설정')).getByDisplayValue('nested-call')).toBeTruthy()
    await waitFor(() => expect(flowInstance.setViewport).toHaveBeenCalledWith(firstViewport, { duration: 0 }))

    fireEvent.click(within(breadcrumb).getByRole('button', { name: 'Main' }))
    expect(within(screen.getByLabelText('선택한 노드 설정')).getByDisplayValue('main-call')).toBeTruthy()
    await waitFor(() => expect(flowInstance.setViewport).toHaveBeenCalledWith(mainViewport, { duration: 0 }))

    fireEvent.click(screen.getByRole('tab', { name: 'My Blueprint' }))
    fireEvent.doubleClick(within(screen.getByLabelText('My Blueprint')).getByRole('button', { name: 'first 함수' }))
    expect(breadcrumb.textContent).toBe('Main›first')
    expect(within(screen.getByLabelText('선택한 노드 설정')).getByDisplayValue('nested-call')).toBeTruthy()
  })

  it('automatically focuses the original nested failure and navigates again from its trace row', async () => {
    const functions = ['reserve', 'slot'].map((id): NonNullable<MacroDefinition['functions']>[number] => ({
      id, name: id === 'reserve' ? 'Reserve' : 'SelectTimeSlot', inputs: [], outputs: [],
      entry_node_id: `${id}-entry`, return_node_id: `${id}-return`,
      nodes: [
        { id: `${id}-entry`, type: 'function_entry', config: {} },
        { id: `${id}-return`, type: 'function_return', config: {} },
        { id: 'find', type: 'wait', config: { duration_ms: 1 }, position: { x: 400, y: 200 } },
      ], edges: [],
    }))
    vi.mocked(macroEditorApi.get).mockResolvedValue({ ...definition, functions })
    const view = render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    await screen.findByTestId('integrated-canvas')
    const failed = runtime('error')
    const origin = {
      node_id: 'find', node_type: 'wait', status: 'failure', step: 4,
      graph_path: ['main', 'reserve', 'slot'], timestamp: '2026-09-29T01:00:00Z',
      error: 'slot failed', input_summary: { duration_ms: 1 }, output_summary: {},
      error_payload: { type: 'RuntimeError', message: 'slot failed' },
    }
    failed.runtime!.trace = [{ ...origin, node_id: 'call', graph_path: ['main'], error_payload: { cause: origin } }]
    failed.runtime!.error = 'slot failed'
    view.rerender(<IntegratedMacroPanel deviceId="phone-a" runtime={syncRuntimeOverlay(failed)} />)
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('매크로 그래프').value).toBe('slot'))
    expect(screen.getByRole('navigation', { name: '매크로 그래프 경로' }).textContent).toBe('Main›Reserve›SelectTimeSlot')
    expect(within(screen.getByLabelText('선택한 노드 설정')).getByDisplayValue('find')).toBeTruthy()
    expect(screen.getByLabelText('Runtime Error').textContent).toContain('duration_ms')
    await waitFor(() => expect(flowInstance.setCenter).toHaveBeenCalledWith(510, 250, { zoom: 1, duration: 200 }))
    expect(flowInstance.fitView).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('navigation', { name: '매크로 그래프 경로' })).getByRole('button', { name: 'Main' }))
    expect(screen.getByLabelText<HTMLSelectElement>('매크로 그래프').value).toBe('__main__')

    fireEvent.click(screen.getByRole('tab', { name: '실행' }))
    fireEvent.click(screen.getByRole('button', { name: 'Shared Flow 실행 정보 보기' }))
    fireEvent.click(screen.getByRole('tab', { name: /Trace/ }))
    fireEvent.keyDown(screen.getByLabelText('call 오류 위치로 이동'), { key: 'Enter' })
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('매크로 그래프').value).toBe('slot'))
    expect(screen.getByLabelText('Runtime Error').textContent).toContain('slot failed')
  })

  it('switches the error screen, highlights its edge and focuses either endpoint', async () => {
    vi.mocked(macroEditorApi.get).mockResolvedValue({
      ...definition,
      nodes: [...definition.nodes, { id: 'source', type: 'wait', config: {} }],
      edges: [{ id: 'bad-edge', source: 'source', target: 'find' }],
      metadata: { editor_screen_node_ids: { reservation_detail: ['find', 'source'] } },
    })
    const failed = runtime('error')
    failed.runtime!.trace = [{
      node_id: 'find', status: 'failure', graph_path: ['main'], screen_id: 'reservation_detail',
      error: 'edge failed', error_payload: { edge_id: 'bad-edge', source: 'source', target: 'find' },
    }]
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={syncRuntimeOverlay(failed)} />)
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('매크로 화면').value).toBe('reservation_detail'))
    expect(screen.getByLabelText('Runtime Error')).toBeTruthy()
    expect(screen.getByText('bad-edge').getAttribute('data-error')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '출발 노드로 이동' }))
    await waitFor(() => expect(within(screen.getByLabelText('선택한 노드 설정')).getByDisplayValue('source')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '도착 노드로 이동' }))
    await waitFor(() => expect(within(screen.getByLabelText('선택한 노드 설정')).getByDisplayValue('find')).toBeTruthy())
  })

  it('shows every runtime error in the list and opens details when selecting a failed node', async () => {
    vi.mocked(macroEditorApi.get).mockResolvedValue({ ...definition, nodes: [
      ...definition.nodes, { id: 'other', type: 'wait', label: 'Second node', config: {} },
    ] })
    const failed = runtime('error')
    failed.runtime!.trace = ['find', 'other'].map((id, index) => ({
      node_id: id, graph_path: ['main'], status: 'failure', step: index + 1,
      error: `Failure at ${id}`, error_payload: { code: `ERROR_${id}` },
    }))
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={syncRuntimeOverlay(failed)} />)
    const list = await screen.findByLabelText('Runtime Error List')
    expect(list.textContent).toContain('Second node')
    expect(list.textContent).toContain('Main')
    fireEvent.click(within(list).getByRole('button', { name: /ERROR_find/ }))
    await waitFor(() => expect(screen.getByLabelText('Runtime Error').textContent).toContain('ERROR_find'))
    fireEvent.click(within(screen.getByTestId('integrated-canvas')).getByRole('button', { name: 'other' }))
    expect(screen.getByLabelText('Runtime Error').textContent).toContain('ERROR_other')
  })

  it('allows reset and saves corrections before rerunning after a runtime failure', async () => {
    const failed = runtime('error')
    failed.runtime!.error = 'failed'
    failed.runtime!.trace = [{ node_id: 'find', graph_path: ['main'], status: 'failure', error: 'failed' }]
    const view = render(<IntegratedMacroPanel deviceId="phone-a" runtime={syncRuntimeOverlay(failed)} />)
    await screen.findByLabelText('Runtime Error')
    const canvas = screen.getByTestId('integrated-canvas')
    expect(within(canvas).getByRole('button', { name: 'find' }).getAttribute('data-state')).toBe('failure')
    fireEvent.click(screen.getByRole('button', { name: '초기화' }))
    await waitFor(() => expect(macroEditorApi.command).toHaveBeenCalledWith('phone-a', 'reset', undefined))
    await waitFor(() => expect(screen.getByRole('button', { name: '다시 실행' }).hasAttribute('disabled')).toBe(false))
    fireEvent.change(screen.getByLabelText('표시 이름'), { target: { value: 'Corrected node' } })
    fireEvent.click(screen.getByRole('button', { name: '다시 실행' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '매크로 실행' })).getByRole('button', { name: '실행' }))
    await waitFor(() => expect(macroEditorApi.command).toHaveBeenCalledWith('phone-a', 'start', { variables: {} }))
    expect(macroEditorApi.save).toHaveBeenCalled()
    expect(vi.mocked(macroEditorApi.save).mock.calls.at(-1)?.[0].nodes.find((node) => node.id === 'find')?.label).toBe('Corrected node')
    const restarted = runtime('running')
    restarted.runtime!.runtime_id = 'run-b'
    restarted.runtime!.trace = []
    view.rerender(<IntegratedMacroPanel deviceId="phone-a" runtime={syncRuntimeOverlay(restarted)} />)
    await waitFor(() => expect(screen.queryByLabelText('Runtime Error')).toBeNull())
    expect(within(canvas).getByRole('button', { name: 'find' }).getAttribute('data-state')).toBe('running')
  })

  it.each([undefined, 'deleted-function'])('stays on the graph and reports invalid function reference %s', async (functionId) => {
    vi.mocked(macroEditorApi.get).mockResolvedValue({
      ...definition,
      nodes: [{ id: 'broken-call', type: 'call_function', config: functionId ? { function_id: functionId } : {} }],
      entry_node_id: 'broken-call',
    })
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    const canvas = await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    fireEvent.doubleClick(within(canvas).getByRole('button', { name: 'broken-call' }))

    expect(within(screen.getByRole('navigation', { name: '매크로 그래프 경로' })).getByText('Main').getAttribute('aria-current')).toBe('page')
    expect(screen.getByText(functionId
      ? `함수 ${functionId}를 찾을 수 없습니다. 삭제되었거나 참조가 올바르지 않습니다.`
      : '호출할 함수가 지정되지 않았습니다.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(flowInstance.fitView).not.toHaveBeenCalled()
  })

  it('returns to Main when a function in the active breadcrumb path is deleted', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    fireEvent.click(screen.getByRole('tab', { name: 'My Blueprint' }))
    const blueprint = screen.getByLabelText('My Blueprint')

    for (const name of ['Reserve', 'Select Time Slot']) {
      fireEvent.click(within(blueprint).getByRole('button', { name: '새 함수' }))
      const dialog = screen.getByRole('dialog', { name: '새 함수' })
      fireEvent.change(within(dialog).getByLabelText('함수 이름'), { target: { value: name } })
      fireEvent.click(within(dialog).getByRole('button', { name: '생성' }))
    }

    fireEvent.click(within(blueprint).getByRole('button', { name: 'Reserve 함수' }))
    fireEvent.click(within(screen.getByLabelText('My Blueprint 설정')).getByRole('button', { name: '삭제' }))
    const confirm = screen.getByRole('alertdialog', { name: '함수 삭제' })
    fireEvent.click(within(confirm).getByRole('button', { name: '삭제' }))

    const breadcrumb = screen.getByRole('navigation', { name: '매크로 그래프 경로' })
    expect(within(breadcrumb).getByText('Main').getAttribute('aria-current')).toBe('page')
    expect(within(breadcrumb).queryByText('Reserve')).toBeNull()
    expect(within(breadcrumb).queryByText('Select Time Slot')).toBeNull()
    expect(screen.getByLabelText<HTMLSelectElement>('매크로 그래프').value).toBe('__main__')
  })

  it('updates Call Function ports when the function signature changes', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)
    await screen.findByTestId('integrated-canvas')
    fireEvent.click(screen.getByRole('tab', { name: '캔버스' }))
    fireEvent.click(screen.getByRole('tab', { name: 'My Blueprint' }))
    const blueprint = screen.getByLabelText('My Blueprint')

    fireEvent.click(within(blueprint).getByRole('button', { name: '새 함수' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '새 함수' })).getByRole('button', { name: '생성' }))
    const inspector = screen.getByLabelText('My Blueprint 설정')
    fireEvent.click(within(inspector).getByRole('button', { name: '+ Add Input' }))
    fireEvent.change(within(inspector).getByLabelText('Inputs 1 이름'), { target: { value: 'index' } })
    fireEvent.change(within(inspector).getByLabelText('Inputs 1 타입'), { target: { value: 'int' } })
    fireEvent.click(within(inspector).getByRole('button', { name: '+ Add Output' }))
    fireEvent.change(within(inspector).getByLabelText('Outputs 1 이름'), { target: { value: 'success' } })
    fireEvent.change(within(inspector).getByLabelText('Outputs 1 타입'), { target: { value: 'bool' } })
    fireEvent.change(screen.getByLabelText('매크로 그래프'), { target: { value: '__main__' } })
    fireEvent.click(screen.getByRole('button', { name: 'Drop function-1' }))
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
    fireEvent.click(screen.getByRole('tab', { name: 'My Blueprint' }))
    const blueprint = screen.getByLabelText('My Blueprint')

    fireEvent.click(within(blueprint).getByRole('button', { name: '새 변수' }))
    const variableDialog = screen.getByRole('dialog', { name: '변수 추가' })
    fireEvent.change(within(variableDialog).getByLabelText('이름'), { target: { value: 'count' } })
    fireEvent.click(within(variableDialog).getByLabelText('실행 입력으로 사용'))
    fireEvent.click(within(variableDialog).getByRole('button', { name: '추가' }))
    const variable = within(blueprint).getByRole('button', { name: 'count 변수 int' })
    fireEvent.contextMenu(variable)
    fireEvent.click(screen.getByRole('menuitem', { name: '설정 노드 추가' }))
    fireEvent.contextMenu(variable)
    fireEvent.click(screen.getByRole('menuitem', { name: '가져오기 노드 추가' }))
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
    const breadcrumb = screen.getByRole('navigation', { name: '매크로 그래프 경로' })
    expect(within(breadcrumb).getByText('Select Time Slot').getAttribute('aria-current')).toBe('page')
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
    expect(screen.getByRole('button', { name: '바인딩 해제' }).hasAttribute('disabled')).toBe(true)
  })

  it('unbinds the device from the card menu without deleting the macro', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime('idle')} />)
    await screen.findByText('Shared Flow')

    fireEvent.click(screen.getByLabelText('더보기'))
    fireEvent.click(screen.getByRole('button', { name: '바인딩 해제' }))

    await waitFor(() => expect(macroEditorApi.unbind).toHaveBeenCalledWith('phone-a'))
    await waitFor(() => expect(screen.queryByText('연결됨')).toBeNull())
    expect(screen.getByText('Shared Flow')).toBeTruthy()
    expect(screen.getByRole('button', { name: '바인딩 해제' }).hasAttribute('disabled')).toBe(true)
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
