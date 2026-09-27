// @vitest-environment jsdom

import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { devicesApi } from './api'
import { relativeLastSeen } from './format'
import { chooseInitialDevice, useDevices } from './hooks'
import type { AndroidDeviceSummary, AndroidDiscoveryStatus } from './types'

vi.mock('./api', () => ({
  devicesApi: {
    list: vi.fn(),
    refresh: vi.fn(),
    discoveryStatus: vi.fn(),
    addManual: vi.fn(),
  },
}))

const onlineDevice = (id = 'galaxy-s21'): AndroidDeviceSummary => ({
  id,
  name: 'Galaxy S21',
  endpoint: 'http://100.64.0.10:8765',
  source: 'tailscale',
  connected: true,
  connection_state: 'online',
  last_seen_at: '2026-09-27T03:00:00Z',
  capture_ready: true,
  stream_running: true,
  accessibility_enabled: true,
  remote_control_enabled: true,
  macro_status: 'IDLE',
  last_error: null,
})

const offlineDevice = (id = 'note10'): AndroidDeviceSummary => ({
  ...onlineDevice(id),
  name: 'Galaxy Note10',
  source: 'manual',
  connected: false,
  connection_state: 'offline',
  last_seen_at: '2026-09-27T02:58:00Z',
  stream_running: false,
  last_error: 'offline',
})

const discovery: AndroidDiscoveryStatus = {
  enabled: true,
  provider: 'tailscale',
  tailscale_available: true,
  last_refresh: '2026-09-27T03:00:00Z',
  discovered_peer_count: 2,
  discovered_agent_count: 1,
  last_error: null,
}

beforeEach(() => {
  vi.mocked(devicesApi.list).mockResolvedValue({
    devices: [onlineDevice()],
    default_device_id: 'galaxy-s21',
  })
  vi.mocked(devicesApi.discoveryStatus).mockResolvedValue(discovery)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('device selection policy', () => {
  it('auto-selects the first online device', () => {
    expect(chooseInitialDevice([onlineDevice()], undefined, null)).toBe('galaxy-s21')
    expect(
      chooseInitialDevice(
        [onlineDevice(), onlineDevice('galaxy-s22')],
        undefined,
        null,
      ),
    ).toBe('galaxy-s21')
    expect(chooseInitialDevice([offlineDevice()], undefined, null)).toBeNull()
  })

  it('restores a remembered device even when it is offline', () => {
    const devices = [onlineDevice(), offlineDevice()]
    expect(chooseInitialDevice(devices, undefined, 'note10')).toBe('note10')
    expect(chooseInitialDevice(devices, 'note10', null)).toBe('note10')
  })
})

describe('useDevices', () => {
  it('preserves the current device list when refresh fails', async () => {
    vi.mocked(devicesApi.refresh).mockRejectedValue(new Error('raw network failure'))
    const { result } = renderHook(() => useDevices())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.devices).toHaveLength(1)

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.devices).toHaveLength(1)
    expect(result.current.error).toBe(
      '기기를 새로고침하지 못했습니다. 기존 기기 목록은 계속 사용할 수 있습니다.',
    )
    expect(result.current.detail).toBe('raw network failure')
  })

  it('reports discovery progress without clearing offline devices', async () => {
    let finish: ((value: never) => void) | undefined
    vi.mocked(devicesApi.list).mockResolvedValue({
      devices: [offlineDevice()],
      default_device_id: null,
    })
    vi.mocked(devicesApi.refresh).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    )
    const { result } = renderHook(() => useDevices())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let request: Promise<void>
    act(() => {
      request = result.current.refresh()
    })
    expect(result.current.discovering).toBe(true)
    expect(result.current.devices[0]?.connection_state).toBe('offline')

    await act(async () => {
      finish?.({
        devices: [offlineDevice()],
        default_device_id: null,
        discovery: { ...discovery, discovered_agent_count: 0 },
      } as never)
      await request
    })
    expect(result.current.discovering).toBe(false)
    expect(result.current.error).toBe('TapBot 기기를 찾지 못했습니다.')
  })
})

describe('relative last seen', () => {
  it('formats recent and older observations', () => {
    const now = Date.parse('2026-09-27T03:00:00Z')
    expect(relativeLastSeen('2026-09-27T02:59:55Z', now)).toBe('방금 확인됨')
    expect(relativeLastSeen('2026-09-27T02:58:00Z', now)).toBe('2분 전에 확인됨')
  })
})
