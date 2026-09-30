import { describe, expect, it } from 'vitest'
import type { MacroDefinition } from './types'
import {
  formatSavedAtCompact,
  formatSavedAtFull,
  persistedSaveTimestamp,
  withPersistedSaveTimestamp,
  withoutPersistedSaveTimestamp,
} from './save-timestamp'

const definition = (metadata: MacroDefinition['metadata']): MacroDefinition => ({
  id: 'saved',
  name: 'Saved',
  version: 1,
  nodes: [],
  edges: [],
  metadata,
})

describe('save timestamps', () => {
  it('uses API updated_at and falls back only after a successful response', () => {
    const apiTimestamp = new Date(2026, 8, 30, 11, 42, 18).toISOString()
    const fallback = new Date(2026, 8, 30, 12, 0, 0)

    expect(persistedSaveTimestamp(definition({ updated_at: apiTimestamp })))
      .toBe(apiTimestamp)
    expect(withPersistedSaveTimestamp(definition({ updated_at: apiTimestamp }), fallback)
      .metadata.updated_at).toBe(apiTimestamp)
    expect(withPersistedSaveTimestamp(definition({}), fallback).metadata.updated_at)
      .toBe(fallback.toISOString())
  })

  it('formats same-day, prior-day, and tooltip timestamps in local time', () => {
    const saved = new Date(2026, 8, 30, 11, 42, 18).toISOString()

    expect(formatSavedAtCompact(saved, new Date(2026, 8, 30, 23, 0, 0))).toBe('11:42')
    expect(formatSavedAtCompact(saved, new Date(2026, 9, 1, 0, 0, 0))).toBe('09/30 11:42')
    expect(formatSavedAtFull(saved)).toBe('2026-09-30 11:42:18')
  })

  it('removes persisted timestamps when creating an unsaved copy', () => {
    const copy = withoutPersistedSaveTimestamp(definition({
      updated_at: '2026-09-30T00:00:00Z',
      saved_at: '2026-09-29T00:00:00Z',
      owner: 'tapbot',
    }))

    expect(copy.metadata).toEqual({ owner: 'tapbot' })
  })
})
