// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemStatusContext } from '../app/system-status'
import { devicesApi } from '../features/devices/api'
import { SELECTED_DEVICE_STORAGE_KEY } from '../features/devices/hooks'
import type { AndroidDeviceSummary, AndroidDiscoveryStatus } from '../features/devices/types'
import type { SystemStatusContextValue } from '../types/system'
import { Header } from './Header'

vi.mock('../features/devices/api', () => ({
  devicesApi: {
    list: vi.fn(),
    refresh: vi.fn(),
  },
}))

const discovery: AndroidDiscoveryStatus = {
  enabled: true,
  provider: 'tailscale',
  tailscale_available: true,
  last_refresh: '2026-09-27T03:00:00Z',
  discovered_peer_count: 2,
  discovered_agent_count: 2,
  last_error: null,
}

function device(id: string, name: string, connected: boolean): AndroidDeviceSummary {
  return {
    id,
    name,
    endpoint: `http://${id}:8765`,
    source: 'tailscale',
    connected,
    connection_state: connected ? 'online' : 'offline',
    last_seen_at: '2026-09-27T03:00:00Z',
    capture_ready: connected,
    stream_running: connected,
    accessibility_enabled: connected,
    remote_control_enabled: connected,
    macro_status: 'IDLE',
    last_error: connected ? null : 'offline',
  }
}

const systemStatus: SystemStatusContextValue = {
  backend: null,
  backendState: 'online',
  backendError: null,
  refresh: vi.fn(),
}

function LocationProbe() {
  return <output aria-label="현재 경로">{useLocation().pathname}</output>
}

function renderHeader(path = '/debug/android/galaxy-s21') {
  return render(
    <SystemStatusContext.Provider value={systemStatus}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<><Header /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </SystemStatusContext.Provider>,
  )
}

describe('Header device selector', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.mocked(devicesApi.list).mockResolvedValue({
      devices: [
        device('galaxy-s21', 'Galaxy S21', true),
        device('note10', 'Galaxy Note10', false),
      ],
      default_device_id: 'galaxy-s21',
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  it('shows all devices with connection state and switches the active route', async () => {
    renderHeader()

    const selector = await screen.findByLabelText<HTMLSelectElement>('작업 디바이스')
    expect(selector.value).toBe('galaxy-s21')
    expect(screen.getByRole('option', { name: /Galaxy S21.*온라인/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /Galaxy Note10.*오프라인/ })).toBeTruthy()

    fireEvent.change(selector, { target: { value: 'note10' } })

    await waitFor(() => {
      expect(screen.getByLabelText('현재 경로').textContent).toBe('/debug/android/note10')
    })
    expect(window.localStorage.getItem(SELECTED_DEVICE_STORAGE_KEY)).toBe('note10')
  })

  it('refreshes the compact selector without a separate device panel', async () => {
    const refreshed = {
      devices: [device('pixel-9', 'Pixel 9', true)],
      default_device_id: 'pixel-9',
      discovery,
    }
    vi.mocked(devicesApi.refresh).mockImplementation(() => {
      vi.mocked(devicesApi.list).mockResolvedValue(refreshed)
      return Promise.resolve(refreshed)
    })
    renderHeader('/debug')
    await screen.findByLabelText('작업 디바이스')

    fireEvent.click(screen.getByRole('button', { name: '기기 새로고침' }))

    expect(await screen.findByRole('option', { name: /Pixel 9.*온라인/ })).toBeTruthy()
    expect(screen.queryByText('Nearby and Configured')).toBeNull()
    expect(screen.queryByText('Advanced')).toBeNull()
  })

  it('shows an empty state when no connected device exists', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue({ devices: [], default_device_id: null })
    renderHeader('/debug')

    expect(await screen.findByRole('option', { name: '연결된 디바이스 없음' })).toBeTruthy()
  })
})
