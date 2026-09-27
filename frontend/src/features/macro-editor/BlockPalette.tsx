import { Button } from '@blueprintjs/core'
import type { DragEvent } from 'react'
import { BLOCKS } from './blocks'
import type { MacroNodeType } from './types'

export const MACRO_BLOCK_MIME = 'application/x-tapbot-macro-node'

const categories: Array<{ id: string; label: string; types: readonly MacroNodeType[] }> = [
  { id: 'input', label: 'INPUT', types: ['click_point', 'drag_point', 'random_click_area', 'random_drag_area'] },
  { id: 'flow', label: 'FLOW', types: ['for_loop', 'branch', 'sequence', 'wait', 'retry', 'repeat', 'stop'] },
  { id: 'ui', label: 'UI', types: ['element_exists', 'click_element', 'click_screen_element', 'find_element', 'require_element'] },
  { id: 'validation', label: 'VALIDATION', types: ['wait_for_element', 'wait_for_state', 'assert_element'] },
]

export interface BlockPaletteProps {
  onAdd: (type: MacroNodeType) => void
}

export function BlockPalette({ onAdd }: BlockPaletteProps) {
  const startDrag = (event: DragEvent<HTMLButtonElement>, type: MacroNodeType) => {
    event.dataTransfer.setData(MACRO_BLOCK_MIME, type)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <aside className="macro-palette" aria-label="Block palette">
      <div className="macro-section-heading">
        <span>Blocks</span>
        <small>Drag or add</small>
      </div>
      <div className="macro-palette__body">
        {categories.map((category) => (
          <section className="macro-palette__group" key={category.id}>
            <h2>{category.label}</h2>
            {BLOCKS.filter(
              (block) => block.palette && category.types.includes(block.type),
            ).map((block) => (
              <Button
                className={`macro-palette__block is-${category.id}`}
                key={block.type}
                minimal
                fill
                draggable
                onDragStart={(event) => startDrag(event, block.type)}
                onClick={() => onAdd(block.type)}
                aria-label={`Add ${block.label}`}
              >
                <span>{block.label}</span>
                <code>{block.type}</code>
              </Button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  )
}
