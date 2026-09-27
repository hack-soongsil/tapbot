// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMacroEvents } from './useMacroEvents'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  listeners = new Map<string, EventListener>()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener)
  }

  removeEventListener(type: string) {
    this.listeners.delete(type)
  }

  close() {
    this.closed = true
  }
}

describe('useMacroEvents', () => {
  afterEach(() => {
    cleanup()
    FakeEventSource.instances = []
    vi.unstubAllGlobals()
  })

  it('closes the previous device subscription on device switch', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn()
    const reconnect = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ deviceId }) => useMacroEvents(deviceId, onEvent, reconnect),
      { initialProps: { deviceId: 'phone-a' } },
    )
    const first = FakeEventSource.instances[0]
    if (!first) throw new Error('first EventSource was not created')

    rerender({ deviceId: 'phone-b' })

    expect(first.closed).toBe(true)
    expect(FakeEventSource.instances[1]?.url).toContain('phone-b')
    unmount()
    expect(FakeEventSource.instances[1]?.closed).toBe(true)
  })
})
