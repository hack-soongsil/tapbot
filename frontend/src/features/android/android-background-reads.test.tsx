// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { androidApi } from './android-api'
import { timelineApi } from '../timeline/timeline-api'
import { useAndroidDebug } from './useAndroidDebug'

vi.mock('./android-api', () => ({
  androidApi: {
    status: vi.fn(),
    debugState: vi.fn(),
    runVision: vi.fn(),
    uiTree: vi.fn(),
  },
}))
vi.mock('../timeline/timeline-api', () => ({
  timelineApi: { entries: vi.fn() },
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.mocked(androidApi.status).mockResolvedValue({
    device_id: 'phone',
    name: 'Phone',
    configured: true,
    connected: true,
    error: null,
    stream: null,
    macro_status: 'IDLE',
    agent: {
      accessibility_enabled: true,
      capture_ready: true,
      remote_control_enabled: true,
      stream_running: true,
      agent_version: '0.4.2',
      device: { width: 1080, height: 2400, rotation: 0, density: 3 },
    },
  })
  vi.mocked(androidApi.debugState).mockResolvedValue({ device_id: 'phone' } as never)
  vi.mocked(androidApi.runVision).mockResolvedValue({ device_id: 'phone' } as never)
  vi.mocked(androidApi.uiTree).mockResolvedValue({
    device_id: 'phone',
    nodes: [],
  } as never)
  vi.mocked(timelineApi.entries).mockResolvedValue({ entries: [] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('pauses competing tree and vision reads, keeps status live, and resumes reads afterward', async () => {
  const hook = renderHook(() => useAndroidDebug('phone'))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20)
  })
  expect(androidApi.uiTree).toHaveBeenCalled()
  expect(androidApi.runVision).toHaveBeenCalled()
  const trees = vi.mocked(androidApi.uiTree).mock.calls.length
  const vision = vi.mocked(androidApi.runVision).mock.calls.length
  const status = vi.mocked(androidApi.status).mock.calls.length

  act(() => hook.result.current.setBackgroundReadsPaused(true))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500)
  })
  expect(androidApi.uiTree).toHaveBeenCalledTimes(trees)
  expect(androidApi.runVision).toHaveBeenCalledTimes(vision)
  expect(vi.mocked(androidApi.status).mock.calls.length).toBeGreaterThan(status)
  expect(hook.result.current.status?.connected).toBe(true)

  act(() => hook.result.current.setBackgroundReadsPaused(false))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20)
  })
  expect(vi.mocked(androidApi.uiTree).mock.calls.length).toBeGreaterThan(trees)
  expect(vi.mocked(androidApi.runVision).mock.calls.length).toBeGreaterThan(vision)
})
