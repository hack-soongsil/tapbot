// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { devicesApi } from './api'
import { DeviceSelector } from './DeviceSelector'
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
  it('auto-selects only one clearly online device', () => {
    expect(chooseInitialDevice([onlineDevice()], undefined, null)).toBe('galaxy-s21')
    expect(
      chooseInitialDevice(
        [onlineDevice(), onlineDevice('galaxy-s22')],
        undefined,
        null,
      ),
    ).toBeNull()
    expect(chooseInitialDevice([offlineDevice()], undefined, null)).toBeNull()
  })

  it('restores a remembered device even when it is offline', () => {
    const devices = [onlineDevice(), offlineDevice()]
    expect(chooseInitialDevice(devices, undefined, 'note10')).toBe('note10')
    expect(chooseInitialDevice(devices, 'note10', null)).toBe('note10')
  })
})

describe('DeviceSelector', () => {
  const renderSelector = (
    devices: AndroidDeviceSummary[],
    overrides: Partial<React.ComponentProps<typeof DeviceSelector>> = {},
  ) => {
    const props: React.ComponentProps<typeof DeviceSelector> = {
      devices,
      selectedDeviceId: null,
      discovering: false,
      message: null,
      detail: null,
      onSelect: vi.fn(),
      onRefresh: vi.fn().mockResolvedValue(undefined),
      onAddManual: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }
    return { ...render(<DeviceSelector {...props} />), props }
  }

  it('shows friendly device data while hiding network implementation details', () => {
    const { props } = renderSelector([onlineDevice(), offlineDevice()])

    expect(screen.getByText('Galaxy S21')).toBeTruthy()
    expect(screen.getByText('Galaxy Note10')).toBeTruthy()
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByText('Offline')).toBeTruthy()
    expect(screen.getByText('Automatic')).toBeTruthy()
    expect(screen.getByText('Manual')).toBeTruthy()
    expect(screen.queryByText(/100\.64\.0\.10/)).toBeNull()
    expect(screen.queryByText(/Tailscale/)).toBeNull()

    fireEvent.click(screen.getByText('Galaxy Note10'))
    expect(props.onSelect).toHaveBeenCalledWith('note10')
  })

  it('shows a useful empty state and refresh loading state', () => {
    const { rerender, props } = renderSelector([])
    expect(screen.getByText('No TapBot devices found.')).toBeTruthy()

    rerender(<DeviceSelector {...props} discovering />)
    expect(
      screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('keeps raw discovery errors and manual endpoint input in Advanced', async () => {
    const onAddManual = vi.fn().mockResolvedValue(undefined)
    renderSelector([onlineDevice()], {
      message: 'Automatic device discovery is unavailable.',
      detail: 'Tailscale CLI is not installed',
      onAddManual,
    })

    expect(screen.getByText('Automatic device discovery is unavailable.')).toBeTruthy()
    expect(screen.queryByText('Tailscale CLI is not installed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.getByText(/Install Tailscale/)).toBeTruthy()
    fireEvent.click(screen.getByText('Technical details'))
    expect(screen.getByText('Tailscale CLI is not installed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add manual device' }))

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'My phone' },
    })
    fireEvent.change(screen.getByLabelText('Endpoint URL'), {
      target: { value: 'http://phone.test:8765' },
    })
    fireEvent.change(screen.getByLabelText('Agent token (optional)'), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }))

    await waitFor(() =>
      expect(onAddManual).toHaveBeenCalledWith({
        name: 'My phone',
        endpoint: 'http://phone.test:8765',
        token: 'secret',
      }),
    )
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
      'Could not refresh devices. Existing devices are still available.',
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
    expect(result.current.error).toBe('No TapBot devices found.')
  })
})

describe('relative last seen', () => {
  it('formats recent and older observations', () => {
    const now = Date.parse('2026-09-27T03:00:00Z')
    expect(relativeLastSeen('2026-09-27T02:59:55Z', now)).toBe('Last seen just now')
    expect(relativeLastSeen('2026-09-27T02:58:00Z', now)).toBe('Last seen 2 min ago')
  })
})
