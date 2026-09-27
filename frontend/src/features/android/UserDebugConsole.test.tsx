// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MacroRuntimeEvent } from '../macro-runtime/types'
import { AndroidConsolePanel } from './AndroidDebugWorkspace'
import type { AndroidDebugController } from './useAndroidDebug'

const systemEvent = {
  id: 1,
  timestamp: '2026-09-27T12:00:00Z',
  level: 'info',
  message: 'android connected',
  event_type: 'android.connected',
  category: 'android',
  status: 'success',
  trace_id: null,
  latency_ms: 3,
  payload: { device_id: 'phone' },
}

const debugEvent = (id: string, message: string, level = 'info'): MacroRuntimeEvent => ({
  event_id: id,
  device_id: 'phone',
  runtime_id: 'runtime-1',
  macro_id: 'macro-1',
  type: 'macro.user_debug',
  sequence: Number(id.replace(/\D/g, '')) || 1,
  timestamp: '2026-09-27T12:00:01Z',
  node_id: 'debug-print-1',
  edge_id: null,
  payload: { screen_id: 'reservation_home', level, message },
})

const controller = {
  events: [systemEvent],
} as unknown as AndroidDebugController

afterEach(cleanup)

describe('User Debug console', () => {
  it('is selected by default and never mixes system events into user output', async () => {
    render(
      <AndroidConsolePanel
        controller={controller}
        selectedDetection={null}
        macroEvents={[debugEvent('debug-1', 'index = 3')]}
      />,
    )

    expect(await screen.findByText('index = 3')).toBeTruthy()
    expect(screen.queryByText('android connected')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /시스템/ }))
    expect(screen.getByText('android connected')).toBeTruthy()
    expect(screen.queryByText('index = 3')).toBeNull()
  })

  it('filters levels and Clear only removes user debug rows', async () => {
    render(
      <AndroidConsolePanel
        controller={controller}
        selectedDetection={null}
        macroEvents={[
          debugEvent('debug-1', 'normal output'),
          debugEvent('debug-2', 'failed output', 'error'),
        ]}
      />,
    )
    await screen.findByText('normal output')
    fireEvent.change(screen.getByLabelText('사용자 디버그 레벨'), {
      target: { value: 'error' },
    })
    expect(screen.queryByText('normal output')).toBeNull()
    expect(screen.getByText('failed output')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    expect(await screen.findByText('아직 사용자 디버그 출력이 없습니다.')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: /시스템/ }))
    expect(screen.getByText('android connected')).toBeTruthy()
  })

  it('clears prior user logs when a new runtime starts', async () => {
    const first = debugEvent('debug-1', 'old runtime')
    const { rerender } = render(
      <AndroidConsolePanel
        controller={controller}
        selectedDetection={null}
        macroEvents={[first]}
      />,
    )
    await screen.findByText('old runtime')
    const started: MacroRuntimeEvent = {
      ...debugEvent('runtime-2', ''),
      runtime_id: 'runtime-2',
      type: 'macro.runtime.started',
      payload: {},
    }
    const next = { ...debugEvent('debug-3', 'new runtime'), runtime_id: 'runtime-2' }
    rerender(
      <AndroidConsolePanel
        controller={controller}
        selectedDetection={null}
        macroEvents={[first, started, next]}
      />,
    )

    await waitFor(() => expect(screen.queryByText('old runtime')).toBeNull())
    expect(screen.getByText('new runtime')).toBeTruthy()
  })
})
