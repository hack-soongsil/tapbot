// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SystemStatusContext } from '../app/system-status'
import { SELECTED_DEVICE_STORAGE_KEY } from '../features/devices/hooks'
import type { SystemStatusContextValue } from '../types/system'
import { Header } from './Header'

const systemStatus: SystemStatusContextValue = {
  backend: null,
  backendState: 'online',
  backendError: null,
  refresh: vi.fn(),
}

function renderHeader(path = '/debug') {
  return render(
    <SystemStatusContext.Provider value={systemStatus}>
      <MemoryRouter initialEntries={[path]}>
        <Header />
      </MemoryRouter>
    </SystemStatusContext.Provider>,
  )
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('Header navigation', () => {
  it('shows device, Android debug, and camera tabs without a device selector', () => {
    renderHeader('/debug')

    expect(screen.getByRole('link', { name: '디바이스' }).classList.contains('active')).toBe(true)
    expect(screen.getByRole('link', { name: '안드로이드 디버그' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '로봇 카메라' })).toBeTruthy()
    expect(screen.queryByLabelText('작업 디바이스')).toBeNull()
    expect(screen.queryByRole('button', { name: '기기 새로고침' })).toBeNull()
  })

  it('keeps the current device as the Android debug tab target', () => {
    renderHeader('/debug/android/galaxy-s21')

    const debug = screen.getByRole('link', { name: '안드로이드 디버그' })
    expect(debug.getAttribute('href')).toBe('/debug/android/galaxy-s21')
    expect(debug.classList.contains('active')).toBe(true)
  })

  it('links back to the most recently opened device from the device tab', () => {
    window.localStorage.setItem(SELECTED_DEVICE_STORAGE_KEY, 'note10')
    renderHeader('/debug')

    expect(screen.getByRole('link', { name: '안드로이드 디버그' }).getAttribute('href'))
      .toBe('/debug/android/note10')
  })
})
