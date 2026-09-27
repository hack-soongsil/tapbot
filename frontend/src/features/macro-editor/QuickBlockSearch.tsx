import { createPortal } from 'react-dom'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import type { BlockDefinition } from './blocks'
import type { MacroNodeCategory, MacroNodeType } from './types'

export const QUICK_BLOCK_RECENT_KEY = 'tapbot.macro.quickBlockRecent'

const MAX_RECENT = 8
const VIEWPORT_MARGIN = 8
const EXPECTED_WIDTH = 360
const EXPECTED_HEIGHT = 480

const categoryOrder: readonly MacroNodeCategory[] = [
  'event',
  'ui',
  'action',
  'condition',
  'control',
  'validation',
]

const categoryLabels: Record<MacroNodeCategory, string> = {
  event: 'EVENT',
  ui: 'UI',
  action: 'ACTION',
  condition: 'CONDITION',
  control: 'FLOW',
  validation: 'VALIDATION',
}

export interface QuickBlockSearchProps {
  open: boolean
  screenPosition: { x: number; y: number }
  flowPosition: { x: number; y: number }
  blocks: readonly BlockDefinition[]
  onSelect: (type: MacroNodeType, position: { x: number; y: number }) => void
  onClose: () => void
}

interface SearchSection {
  id: string
  label: string
  blocks: readonly BlockDefinition[]
}

export function QuickBlockSearch({
  open,
  ...props
}: QuickBlockSearchProps) {
  return open ? <OpenQuickBlockSearch open {...props} /> : null
}

function OpenQuickBlockSearch({
  screenPosition,
  flowPosition,
  blocks,
  onSelect,
  onClose,
}: QuickBlockSearchProps) {
  const popupRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [recent, setRecent] = useState<MacroNodeType[]>(readRecent)
  const [popupPosition, setPopupPosition] = useState(() => clampPosition(
    screenPosition,
    EXPECTED_WIDTH,
    EXPECTED_HEIGHT,
  ))

  const searchable = useMemo(
    () => blocks.filter((block) => block.quickSearch ?? block.palette),
    [blocks],
  )
  const blockByType = useMemo(
    () => new Map(searchable.map((block) => [block.type, block])),
    [searchable],
  )
  const validRecent = useMemo(
    () => recent.filter((type) => blockByType.has(type)),
    [blockByType, recent],
  )

  useEffect(() => {
    const focus = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(focus)
  }, [])

  useLayoutEffect(() => {
    if (!popupRef.current) return
    const bounds = popupRef.current.getBoundingClientRect()
    setPopupPosition(clampPosition(
      screenPosition,
      bounds.width || EXPECTED_WIDTH,
      bounds.height || EXPECTED_HEIGHT,
    ))
  }, [screenPosition])

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!popupRef.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', closeOutside, true)
    return () => document.removeEventListener('pointerdown', closeOutside, true)
  }, [onClose])

  const normalizedQuery = normalize(query)
  const ranked = useMemo(
    () => normalizedQuery
      ? searchable
          .map((block) => ({ block, score: scoreBlock(block, normalizedQuery) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => (
            b.score - a.score ||
            recentRank(a.block.type, validRecent) - recentRank(b.block.type, validRecent) ||
            a.block.label.localeCompare(b.block.label)
          ))
          .map((item) => item.block)
      : [],
    [normalizedQuery, searchable, validRecent],
  )
  const sections = useMemo<SearchSection[]>(() => {
    if (normalizedQuery) {
      return ranked.length ? [{ id: 'results', label: 'RESULTS', blocks: ranked }] : []
    }
    const next: SearchSection[] = []
    const recentBlocks = validRecent.flatMap((type) => {
      const block = blockByType.get(type)
      return block ? [block] : []
    })
    if (recentBlocks.length) next.push({ id: 'recent', label: 'RECENT', blocks: recentBlocks })
    for (const category of categoryOrder) {
      const categoryBlocks = searchable
        .filter((block) => block.category === category)
        .sort((a, b) => a.label.localeCompare(b.label))
      if (categoryBlocks.length) {
        next.push({ id: category, label: categoryLabels[category], blocks: categoryBlocks })
      }
    }
    return next
  }, [blockByType, normalizedQuery, ranked, searchable, validRecent])
  const visibleBlocks = useMemo(() => sections.flatMap((section) => section.blocks), [sections])

  const select = (block: BlockDefinition) => {
    const nextRecent = [block.type, ...validRecent.filter((type) => type !== block.type)].slice(0, MAX_RECENT)
    setRecent(nextRecent)
    writeRecent(nextRecent)
    onSelect(block.type, flowPosition)
    onClose()
  }
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (!visibleBlocks.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % visibleBlocks.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + visibleBlocks.length) % visibleBlocks.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      select(visibleBlocks[Math.min(activeIndex, visibleBlocks.length - 1)]!)
    }
  }

  let optionIndex = -1
  return createPortal(
    <div
      ref={popupRef}
      className="quick-block-search"
      role="dialog"
      aria-label="Quick block search"
      style={{ left: popupPosition.x, top: popupPosition.y }}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        className="quick-block-search__input"
        aria-label="Search macro blocks"
        placeholder="Search blocks..."
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={keyDown}
        autoComplete="off"
      />
      <div className="quick-block-search__list" role="listbox" aria-label="Macro blocks">
        {sections.map((section) => (
          <section className="quick-block-search__section" key={section.id}>
            <h2 className="quick-block-search__section-title">{section.label}</h2>
            {section.blocks.map((block) => {
              optionIndex += 1
              const index = optionIndex
              const active = index === activeIndex
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`quick-block-search__item${active ? ' quick-block-search__item--active' : ''}`}
                  key={`${section.id}-${block.type}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(block)}
                >
                  <span className="quick-block-search__label">{block.label}</span>
                  <span className="quick-block-search__description">
                    <b>{categoryLabels[block.category]}</b>
                    {block.description ? ` · ${block.description}` : ` · ${block.type}`}
                  </span>
                </button>
              )
            })}
          </section>
        ))}
        {!visibleBlocks.length && (
          <div className="quick-block-search__empty">
            No blocks found{query.trim() ? ` for “${query.trim()}”` : ''}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replaceAll('_', ' ').trim().replace(/\s+/g, ' ')
}

function scoreBlock(block: BlockDefinition, query: string) {
  const label = normalize(block.label)
  const type = normalize(block.type)
  const keywords = block.keywords?.map(normalize) ?? []
  const description = normalize(block.description ?? '')
  if (label === query) return 100
  if (label.startsWith(query)) return 80
  if (type === query) return 75
  if (type.startsWith(query)) return 60
  if (label.includes(query)) return 50
  if (keywords.some((keyword) => keyword === query)) return 40
  if (keywords.some((keyword) => keyword.includes(query))) return 30
  if (description.includes(query)) return 10
  return 0
}

function recentRank(type: MacroNodeType, recent: readonly MacroNodeType[]) {
  const index = recent.indexOf(type)
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

function clampPosition(position: { x: number; y: number }, width: number, height: number) {
  const viewportWidth = Math.max(0, window.innerWidth)
  const viewportHeight = Math.max(0, window.innerHeight)
  let x = position.x
  let y = position.y
  if (x + width > viewportWidth - VIEWPORT_MARGIN) x = position.x - width
  if (y + height > viewportHeight - VIEWPORT_MARGIN) y = position.y - height
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(x, Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN))),
    y: Math.max(VIEWPORT_MARGIN, Math.min(y, Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN))),
  }
}

function readRecent(): MacroNodeType[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(QUICK_BLOCK_RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(value)
      ? value.filter((item): item is MacroNodeType => typeof item === 'string').slice(0, MAX_RECENT)
      : []
  } catch {
    return []
  }
}

function writeRecent(types: readonly MacroNodeType[]) {
  try {
    window.localStorage.setItem(QUICK_BLOCK_RECENT_KEY, JSON.stringify(types))
  } catch {
    // Search remains usable when storage is unavailable.
  }
}
