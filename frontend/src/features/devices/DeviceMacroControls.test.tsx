// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macroEditorApi } from '../macro-editor/api'
import { DeviceMacroControls } from './DeviceMacroControls'

vi.mock('../macro-editor/api', () => ({
  macroEditorApi: {
    list: vi.fn(),
    binding: vi.fn(),
    runtime: vi.fn(),
    bind: vi.fn(),
    unbind: vi.fn(),
    command: vi.fn(),
  },
}))

const macro = {
  id: 'shared',
  name: 'Shared flow',
  version: 3,
  nodes: [],
  edges: [],
  entry_node_id: '',
  metadata: {},
}

const binding = {
  device_id: 'phone-a',
  macro_definition_id: 'shared',
  enabled: true,
  config: {},
}

const runtime = {
  device_id: 'phone-a',
  runtime_id: null,
  macro_definition_id: 'shared',
  definition_version: 3,
  current_node_id: null,
  current_edge_id: null,
  state: 'idle' as const,
  step_count: 0,
  variables: {},
  trace: [],
  started_at: null,
  error: null,
}

describe('DeviceMacroControls', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.mocked(macroEditorApi.list).mockResolvedValue({ macros: [macro] })
    vi.mocked(macroEditorApi.binding).mockResolvedValue({
      binding,
      shared_device_count: 2,
    })
    vi.mocked(macroEditorApi.runtime).mockResolvedValue({ runtime })
    vi.mocked(macroEditorApi.bind).mockResolvedValue({
      binding,
      shared_device_count: 2,
    })
    vi.mocked(macroEditorApi.command).mockResolvedValue({
      runtime: { ...runtime, state: 'running' },
    })
  })

  it('shows a shared binding and starts only the selected device runtime', async () => {
    render(<DeviceMacroControls deviceId="phone-a" />)

    expect(await screen.findByDisplayValue('Shared flow v3')).toBeTruthy()
    expect(screen.getByText('Shared by 2 devices')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => {
      expect(macroEditorApi.command).toHaveBeenCalledWith('phone-a', 'start')
    })
    expect(await screen.findByText('running')).toBeTruthy()
  })
})
