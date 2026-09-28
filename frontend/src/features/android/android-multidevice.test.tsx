// @vitest-environment jsdom

import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AndroidProxyStatus } from '../../types/android-debug'
import { AndroidDebugWorkspace } from './AndroidDebugWorkspace'
import { androidApi } from './android-api'
import { useAndroidDebug } from './useAndroidDebug'

vi.mock('./android-api', () => ({
  androidApi: {
    status: vi.fn(),
    debugState: vi.fn(),
    uiTree: vi.fn(),
    runVision: vi.fn(),
    saveScreenshot: vi.fn(),
    tap: vi.fn(),
    gesture: vi.fn(),
    back: vi.fn(),
    home: vi.fn(),
    macroStart: vi.fn(),
    macroPause: vi.fn(),
    macroStop: vi.fn(),
    macroReset: vi.fn(),
    macroStep: vi.fn(),
    streamUrl: vi.fn((deviceId: string) => `/api/android/${deviceId}/stream`),
    screenshotUrl: vi.fn((deviceId: string) => `/api/android/${deviceId}/screenshot`),
  },
}))

vi.mock('../timeline/timeline-api', () => ({
  timelineApi: { entries: vi.fn(() => Promise.resolve({ entries: [] })) },
}))

const offlineStatus = (deviceId: string): AndroidProxyStatus => ({
  device_id: deviceId,
  name: deviceId,
  configured: true,
  connected: false,
  error: null,
  agent: null,
  stream: null,
  macro_status: 'IDLE',
})

beforeEach(() => {
  vi.mocked(androidApi.status).mockImplementation((deviceId) =>
    Promise.resolve(offlineStatus(deviceId)),
  )
  vi.mocked(androidApi.debugState).mockImplementation((deviceId) =>
    Promise.resolve({
      device_id: deviceId,
      source_id: `android:${deviceId}`,
      state: { current: 'unknown', previous: null, confidence: 0 },
      macro: { id: `macro-${deviceId}`, status: 'IDLE', step_index: 0 },
      frame: null,
      detections: [],
      vision_latency_ms: null,
      decision: {
        classifier: { state: 'unknown', confidence: 0 },
        vlm: null,
        target: null,
        final_action: null,
        blocked_reason: null,
      },
      last_action: null,
      last_action_result: null,
      error: null,
    }),
  )
  vi.mocked(androidApi.tap).mockResolvedValue({
    ok: true,
    device_id: 'device-a',
    result: {},
  })
  vi.mocked(androidApi.gesture).mockResolvedValue({
    ok: true,
    device_id: 'device-a',
    result: {},
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('multi-device Android debug UI', () => {
  it('cancels old polling and clears stale overlay selection on device change', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    vi.mocked(androidApi.status).mockImplementation((deviceId, signal) => {
      if (signal) signals.push(signal)
      return Promise.resolve(offlineStatus(deviceId))
    })
    const { result, rerender } = renderHook(
      ({ deviceId }: { deviceId: string }) => useAndroidDebug(deviceId),
      { initialProps: { deviceId: 'device-a' } },
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))
    act(() => {
      result.current.setSelectedDetectionId('old-selection')
      result.current.setHighlightedDetectionId('old-highlight')
      result.current.setSelectedUiNodeId('old-ui-node')
    })

    rerender({ deviceId: 'device-b' })
    await act(async () => vi.advanceTimersByTimeAsync(0))

    expect(signals[0]?.aborted).toBe(true)
    expect(result.current.selectedDetectionId).toBeNull()
    expect(result.current.highlightedDetectionId).toBeNull()
    expect(result.current.selectedUiNodeId).toBeNull()
    expect(result.current.debug?.device_id ?? null).not.toBe('device-a')
  })

  it('sends actions only to the selected device id', async () => {
    const { result } = renderHook(() => useAndroidDebug('device-a'))
    await act(async () => {
      await result.current.tap(12, 34)
    })
    expect(androidApi.tap).toHaveBeenCalledWith('device-a', 12, 34)
  })

  it('records click, drag, and cancellation as pointer gestures', () => {
    const tap = vi.fn()
    const gesture = vi.fn()
    const status = {
      ...offlineStatus('device-a'),
      connected: true,
      agent: {
        accessibility_enabled: true,
        capture_ready: true,
        stream_running: true,
        remote_control_enabled: true,
        agent_version: 'test',
        device: { width: 200, height: 100, rotation: 0, density: 3 },
      },
      stream: {
        running: true,
        codec: 'mjpeg',
        transport: 'http-multipart',
        width: 200,
        height: 100,
        rotation: 0,
        fps: 20,
        target_fps: 20,
        bitrate: 1000,
        clients: 1,
        capture_latency_ms: 1,
        encode_latency_ms: 1,
        frame_age_ms: 1,
      },
    } satisfies AndroidProxyStatus
    const makeController = (overrides: Record<string, unknown> = {}) =>
      ({
        deviceId: 'device-a',
        status,
        debug: null,
        events: [],
        uiTree: null,
        uiTreeError: null,
        selectedUiNodeId: null,
        error: null,
        notice: null,
        busy: null,
        selectedDetectionId: null,
        highlightedDetectionId: null,
        streamNonce: 1,
        streamFailed: false,
        setSelectedDetectionId: vi.fn(),
        setHighlightedDetectionId: vi.fn(),
        setSelectedUiNodeId: vi.fn(),
        setStreamFailed: vi.fn(),
        reconnectStream: vi.fn(),
        tap,
        gesture,
        saveScreenshot: vi.fn(),
        back: vi.fn(),
        home: vi.fn(),
        macroStart: vi.fn(),
        macroPause: vi.fn(),
        macroStop: vi.fn(),
        macroReset: vi.fn(),
        macroStep: vi.fn(),
        ...overrides,
      }) as unknown as ReturnType<typeof useAndroidDebug>

    const view = render(
      <AndroidDebugWorkspace controller={makeController()} />,
    )
    let stage = view.container.querySelector('.android-live-stage') as HTMLDivElement
    expect(view.queryByRole('button', { name: /Manual Control/ })).toBeNull()
    expect(stage.classList.contains('is-tap-mode')).toBe(true)
    expect(view.getByText('제어 준비됨')).toBeTruthy()
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(stage, { pointerId: 1, button: 0, clientX: 21, clientY: 20 })
    expect(tap).toHaveBeenCalledWith(20, 20)

    fireEvent.pointerDown(stage, { pointerId: 2, button: 0, clientX: 20, clientY: 80 })
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 30, clientY: 50 })
    fireEvent.pointerUp(stage, { pointerId: 2, button: 0, clientX: 40, clientY: 20 })
    expect(gesture).toHaveBeenCalledTimes(1)
    expect(gesture.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 20, y: 80, t_ms: 0 }),
        expect.objectContaining({ x: 40, y: 20 }),
      ]),
    )

    fireEvent.pointerDown(stage, { pointerId: 3, button: 0, clientX: 20, clientY: 80 })
    fireEvent.pointerCancel(stage, { pointerId: 3 })
    fireEvent.pointerUp(stage, { pointerId: 3, button: 0, clientX: 40, clientY: 20 })
    expect(gesture).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(stage, { pointerId: 4, button: 0, clientX: 20, clientY: 80 })
    view.rerender(
      <AndroidDebugWorkspace controller={makeController({ deviceId: 'device-b' })} />,
    )
    stage = view.container.querySelector('.android-live-stage') as HTMLDivElement
    fireEvent.pointerUp(stage, { pointerId: 4, button: 0, clientX: 40, clientY: 20 })
    expect(gesture).toHaveBeenCalledTimes(1)

    view.rerender(
      <AndroidDebugWorkspace controller={makeController()} />,
    )
    stage = view.container.querySelector('.android-live-stage') as HTMLDivElement
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(stage, { pointerId: 5, button: 0, clientX: 20, clientY: 80 })
    view.rerender(
      <AndroidDebugWorkspace controller={makeController({ streamFailed: true })} />,
    )
    stage = view.container.querySelector('.android-live-stage') as HTMLDivElement
    fireEvent.pointerUp(stage, { pointerId: 5, button: 0, clientX: 40, clientY: 20 })
    expect(gesture).toHaveBeenCalledTimes(1)
  })
})
