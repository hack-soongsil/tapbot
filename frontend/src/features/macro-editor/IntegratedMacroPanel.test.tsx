// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macroEditorApi } from './api'
import {
  IntegratedMacroPanel,
  type IntegratedMacroPanelHandle,
} from './IntegratedMacroPanel'
import type { MacroCanvasProps } from './MacroCanvas'
import type { MacroDefinition } from './types'
import type { useMacroRuntime } from '../macro-runtime/useMacroRuntime'

vi.mock('./api', () => ({
  macroEditorApi: {
    list: vi.fn(),
    binding: vi.fn(),
    get: vi.fn(),
    save: vi.fn(),
    bind: vi.fn(),
    duplicate: vi.fn(),
    command: vi.fn(),
  },
}))

vi.mock('./MacroCanvas', () => ({
  MacroCanvas: ({ nodes, edges }: MacroCanvasProps) => (
    <div data-testid="integrated-canvas">
      {nodes.map((node) => (
        <span key={node.id} data-state={node.data.runtimeState}>{node.id}</span>
      ))}
      {edges.map((edge) => (
        <i key={edge.id} data-current={edge.className === 'runtime-current-edge'}>{edge.id}</i>
      ))}
    </div>
  ),
}))

const definition: MacroDefinition = {
  id: 'shared',
  name: 'Shared Flow',
  version: 3,
  entry_node_id: 'find',
  nodes: [{
    id: 'find',
    type: 'find_element',
    config: { selector: { view_id: 'example:id/reserve' } },
    position: { x: 0, y: 0 },
  }],
  edges: [],
  metadata: {},
}

function runtime(): ReturnType<typeof useMacroRuntime> {
  return {
    runtime: {
      device_id: 'phone-a',
      runtime_id: 'run-a',
      macro_definition_id: 'shared',
      definition_version: 3,
      current_node_id: 'find',
      current_edge_id: null,
      state: 'running',
      step_count: 0,
      variables: {},
      trace: [],
      started_at: null,
      error: null,
    },
    nodeState: { find: 'running' },
    currentNodeId: 'find',
    currentEdgeId: null,
    events: [],
    overlay: { bounds: null, tapPoint: null, nodeId: null },
    connected: true,
    lastSequence: 1,
    refresh: vi.fn(() => Promise.resolve()),
  }
}

describe('IntegratedMacroPanel', () => {
  beforeEach(() => {
    vi.mocked(macroEditorApi.list).mockResolvedValue({ macros: [definition] })
    vi.mocked(macroEditorApi.binding).mockResolvedValue({
      binding: {
        device_id: 'phone-a',
        macro_definition_id: 'shared',
        enabled: true,
        config: {},
      },
      shared_device_count: 1,
    })
    vi.mocked(macroEditorApi.get).mockResolvedValue(definition)
    vi.mocked(macroEditorApi.save).mockImplementation((value) => Promise.resolve(value))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('loads the selected device binding and decorates the running node', async () => {
    render(<IntegratedMacroPanel deviceId="phone-a" runtime={runtime()} />)

    expect(await screen.findByTestId('integrated-canvas')).toBeTruthy()
    expect(macroEditorApi.binding).toHaveBeenCalledWith('phone-a')
    expect(screen.getByText('find').getAttribute('data-state')).toBe('running')
    expect(screen.getByText('running v3')).toBeTruthy()
  })

  it('adds a stable selected-element selector and saves it without bounds', async () => {
    const ref = createRef<IntegratedMacroPanelHandle>()
    render(<IntegratedMacroPanel ref={ref} deviceId="phone-a" runtime={runtime()} />)
    await screen.findByTestId('integrated-canvas')

    act(() => {
      expect(ref.current?.addElement(
        { view_id: 'example:id/confirm' },
        'Confirm',
        'tap',
      )).toBe(true)
    })
    expect(await screen.findByText('click_element-1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalled())
    const saved = vi.mocked(macroEditorApi.save).mock.calls[0]?.[0]
    const added = saved?.nodes.find((node) => node.id === 'click_element-1')
    expect(added?.config.selector).toEqual({ view_id: 'example:id/confirm' })
    expect(JSON.stringify(added?.config)).not.toContain('bounds')
  })
})
