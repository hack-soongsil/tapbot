// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MacroCanvas } from './MacroCanvas'
import type { MacroFlowNode } from './types'

class ResizeObserverStub implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(cleanup)

describe('MacroCanvas', () => {
  it('renders registered React Flow macro nodes', () => {
    const nodes: MacroFlowNode[] = [
      {
        id: 'back-1',
        type: 'action',
        position: { x: 100, y: 100 },
        data: {
          nodeType: 'back',
          category: 'action',
          label: 'Back',
          config: {},
          isEntry: true,
          errors: [],
        },
      },
    ]

    render(
      <div style={{ width: 800, height: 600 }}>
        <MacroCanvas
          nodes={nodes}
          edges={[]}
          onNodesChange={vi.fn()}
          onEdgesChange={vi.fn()}
          onConnect={vi.fn()}
          onSelectNode={vi.fn()}
          onDropBlock={vi.fn()}
          onReady={vi.fn()}
        />
      </div>,
    )

    expect(screen.getByText('Back')).toBeTruthy()
    expect(screen.getByText('ENTRY')).toBeTruthy()
  })
})
