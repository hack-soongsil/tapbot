// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macroEditorApi } from './api'
import { MACRO_DRAFT_STORAGE_KEY, MacroEditorPage } from './MacroEditorPage'
import type { MacroCanvasProps } from './MacroCanvas'

vi.mock('./api', () => ({
  macroEditorApi: {
    list: vi.fn(),
    get: vi.fn(),
    save: vi.fn(),
    validate: vi.fn(),
    run: vi.fn(),
    stop: vi.fn(),
  },
}))

vi.mock('./MacroCanvas', () => ({
  MacroCanvas: (props: MacroCanvasProps) => (
    <div data-testid="macro-canvas">
      <span data-testid="node-count">{props.nodes.length}</span>
      <span data-testid="edge-count">{props.edges.length}</span>
      {props.nodes.map((node) => (
        <button key={node.id} onClick={() => props.onSelectNode(node.id)}>
          Select {node.id}
        </button>
      ))}
      <button
        onClick={() => {
          const [source, target] = props.nodes
          if (source && target) {
            props.onConnect({
              source: source.id,
              target: target.id,
              sourceHandle: null,
              targetHandle: null,
            })
          }
        }}
      >
        Connect first two
      </button>
    </div>
  ),
}))

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(macroEditorApi.validate).mockResolvedValue({ valid: true, errors: [] })
  vi.mocked(macroEditorApi.save).mockImplementation((value) => Promise.resolve(value))
  vi.mocked(macroEditorApi.run).mockResolvedValue({ run_id: 'run-1', status: 'running' })
  vi.mocked(macroEditorApi.stop).mockResolvedValue({ run_id: 'run-1', status: 'stopped' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MacroEditorPage', () => {
  it('adds, connects, edits, and deletes nodes while tracking dirty state', () => {
    render(<MacroEditorPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Wait' }))
    expect(screen.getByTestId('node-count').textContent).toBe('1')
    expect(screen.getByText('Unsaved')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Duration (ms)'), { target: { value: '900' } })
    expect(screen.getByLabelText<HTMLInputElement>('Duration (ms)').value).toBe('900')

    fireEvent.click(screen.getByRole('button', { name: 'Add Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect first two' }))
    expect(screen.getByTestId('edge-count').textContent).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'Delete node' }))
    expect(screen.getByTestId('node-count').textContent).toBe('1')
    expect(screen.getByTestId('edge-count').textContent).toBe('0')
  })

  it('serializes to local storage and reloads the saved draft', async () => {
    const first = render(<MacroEditorPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalledTimes(1))
    const saved = JSON.parse(window.localStorage.getItem(MACRO_DRAFT_STORAGE_KEY) ?? '{}') as {
      nodes?: unknown[]
    }
    expect(saved.nodes).toHaveLength(1)

    first.unmount()
    render(<MacroEditorPage />)
    expect(screen.getByTestId('node-count').textContent).toBe('1')
  })

  it('maps backend validation errors onto the selected node', async () => {
    vi.mocked(macroEditorApi.validate).mockResolvedValue({
      valid: false,
      errors: [{ node_id: 'back-1', message: 'Backend rejected this node.' }],
    })
    render(<MacroEditorPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Back' }))

    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))

    await waitFor(() => expect(screen.getByText('Backend rejected this node.')).toBeTruthy())
    expect(screen.getByText('Backend validation found graph errors.')).toBeTruthy()
  })

  it('supports the Ctrl+S keyboard shortcut', async () => {
    render(<MacroEditorPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Home' }))

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => expect(macroEditorApi.save).toHaveBeenCalledTimes(1))
  })
})
