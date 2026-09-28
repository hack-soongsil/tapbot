import { Button } from '@blueprintjs/core'
import type { DragEvent } from 'react'
import { BLOCKS } from './blocks'
import type { MacroNodeType } from './types'
import { macroCategoryLabels } from '../../i18n/ko'

export const MACRO_BLOCK_MIME = 'application/x-tapbot-macro-node'

const categories: Array<{ id: string; label: string; types: readonly MacroNodeType[] }> = [
  { id: 'input', label: '입력', types: ['click_point', 'drag_point', 'random_click_area', 'random_drag_area'] },
  { id: 'flow', label: macroCategoryLabels.control, types: ['for_loop', 'branch', 'sequence', 'wait', 'retry', 'repeat', 'stop'] },
  { id: 'ui', label: macroCategoryLabels.ui, types: ['element_exists', 'find_element', 'find_screen_element', 'click_element', 'require_element'] },
  { id: 'validation', label: macroCategoryLabels.validation, types: ['wait_for_element', 'wait_for_state', 'assert_element'] },
  { id: 'utility', label: macroCategoryLabels.utility, types: ['debug_print'] },
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
    <aside className="macro-palette" aria-label="블록 팔레트">
      <div className="macro-section-heading">
        <span>블록</span>
        <small>드래그하거나 추가</small>
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
                aria-label={`${block.label} 추가`}
                title={`${block.label} · ${block.type}`}
              >
                <span className="macro-palette__block-content">
                  <strong className="macro-palette__block-name">{block.label}</strong>
                  {block.description && (
                    <span className="macro-palette__block-description">
                      {block.description}
                    </span>
                  )}
                </span>
              </Button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  )
}
