// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { androidApi } from '../android/android-api'
import { SELECTED_DEVICE_STORAGE_KEY } from './hooks'
import type { AndroidDeviceSummary } from './types'
import { DeviceGrid } from './DeviceGrid'

const online: AndroidDeviceSummary = {
  id: 'galaxy-s21',
  name: 'Galaxy S21',
  endpoint: 'http://galaxy-s21.test:8765',
  source: 'tailscale',
  connected: true,
  connection_state: 'online',
  last_seen_at: '2026-09-27T03:00:00Z',
  capture_ready: true,
  stream_running: true,
  screen_width: 1080,
  screen_height: 2280,
  stream_fps: 8,
  accessibility_enabled: true,
  remote_control_enabled: true,
  macro_status: 'RUNNING',
  last_error: null,
}

const offline: AndroidDeviceSummary = {
  ...online,
  id: 'emulator-5554',
  name: 'Emulator 5554',
  connected: false,
  connection_state: 'offline',
  capture_ready: false,
  stream_running: false,
  stream_fps: null,
  macro_status: 'IDLE',
  last_error: 'offline',
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IntersectionObserver', undefined)
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('DeviceGrid', () => {
  it('shows live online previews and an offline placeholder with device status', () => {
    render(
      <MemoryRouter>
        <DeviceGrid devices={[online, offline]} refreshing={false} onRefresh={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByAltText('Galaxy S21 실시간 화면')).toBeTruthy()
    expect(screen.getAllByText('1080×2280')).toHaveLength(2)
    expect(screen.getByText('8.0 FPS · 프리뷰 2 FPS')).toBeTruthy()
    expect(screen.getByText('매크로: 실행 중')).toBeTruthy()
    expect(screen.getByText('Offline')).toBeTruthy()
    expect(screen.getByText('매크로: 대기')).toBeTruthy()
  })

  it('renders legacy device summaries that omit screen metrics without crashing', () => {
    const legacyDevice: AndroidDeviceSummary = {
      ...online,
      id: 'legacy-agent',
      name: 'Legacy Agent',
      screen_width: undefined,
      screen_height: undefined,
      stream_fps: undefined,
    }

    render(
      <MemoryRouter>
        <DeviceGrid devices={[legacyDevice]} refreshing={false} onRefresh={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Legacy Agent')).toBeTruthy()
    expect(screen.getByText('해상도 —')).toBeTruthy()
    expect(screen.getByText('FPS —')).toBeTruthy()
  })

  it('requests at most one preview frame at a time and schedules the next after load', async () => {
    const url = vi.spyOn(androidApi, 'screenshotUrl')
    render(
      <MemoryRouter>
        <DeviceGrid devices={[online]} refreshing={false} onRefresh={vi.fn()} />
      </MemoryRouter>,
    )
    const image = screen.getByAltText('Galaxy S21 실시간 화면')
    expect(url).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTimeAsync(2_000))
    expect(url).toHaveBeenCalledTimes(1)

    fireEvent.load(image)
    await act(async () => vi.advanceTimersByTimeAsync(499))
    expect(url).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(url).toHaveBeenCalledTimes(2)
  })

  it('opens debug from the card and remembers the selected device', () => {
    render(
      <MemoryRouter>
        <DeviceGrid devices={[online]} refreshing={false} onRefresh={vi.fn()} />
      </MemoryRouter>,
    )

    const open = screen.getByRole('link', { name: '디버그 열기' })
    expect(open.getAttribute('href')).toBe('/debug/android/galaxy-s21')
    fireEvent.click(open)
    expect(window.localStorage.getItem(SELECTED_DEVICE_STORAGE_KEY)).toBe('galaxy-s21')
  })

  it('retries an offline device through the shared refresh action', () => {
    const refresh = vi.fn()
    render(
      <MemoryRouter>
        <DeviceGrid devices={[offline]} refreshing={false} onRefresh={refresh} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '다시 연결' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
