import { createPortal } from 'react-dom'
import { getTapbotOverlayRoot } from '../../components/overlay-root'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { ko, macroCategoryLabels } from '../../i18n/ko'
import { isImeKeyboardEvent } from './keyboard-events'
import type { SearchItem } from './search-provider'
import { blockSupportsPortContext, type SourcePortContext } from './port-compatibility'
import type { MacroNodeCategory } from './types'

export const QUICK_BLOCK_RECENT_KEY = 'tapbot.macro.quickBlockRecent'

const MAX_RECENT = 8
const VIEWPORT_MARGIN = 8
const EXPECTED_WIDTH = 360
const EXPECTED_HEIGHT = 600

const categoryOrder: readonly MacroNodeCategory[] = [
  'event',
  'ui',
  'action',
  'condition',
  'control',
  'validation',
  'utility',
]

export interface QuickBlockSearchProps {
  open: boolean
  screenPosition: { x: number; y: number }
  flowPosition: { x: number; y: number }
  items: readonly SearchItem[]
  sourcePortContext?: SourcePortContext | null
  onCreated?: (created: ReturnType<SearchItem['create']>, item: SearchItem) => void
  onClose: () => void
}

interface CategoryItem {
  id: string
  kind: 'category'
  category: MacroNodeCategory
  count: number
}

interface BlockItem {
  id: string
  kind: 'block'
  block: SearchItem
  location: 'recent' | 'category' | 'search'
}

type NavigationItem = CategoryItem | BlockItem

export function QuickBlockSearch({ open, ...props }: QuickBlockSearchProps) {
  return open ? <OpenQuickBlockSearch open {...props} /> : null
}

function OpenQuickBlockSearch({
  screenPosition,
  flowPosition,
  items,
  sourcePortContext = null,
  onCreated,
  onClose,
}: QuickBlockSearchProps) {
  const popupRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<MacroNodeCategory | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [recent, setRecent] = useState<string[]>(readRecent)
  const [popupPosition, setPopupPosition] = useState(() => clampPosition(
    screenPosition,
    EXPECTED_WIDTH,
    EXPECTED_HEIGHT,
  ))

  const searchable = useMemo(
    () => items.filter((item) => !sourcePortContext || blockSupportsPortContext(item, sourcePortContext)),
    [items, sourcePortContext],
  )
  const itemById = useMemo(
    () => new Map(searchable.map((item) => [item.id, item])),
    [searchable],
  )
  const validRecent = useMemo(
    () => recent.filter((id) => itemById.has(id)),
    [itemById, recent],
  )
  const blocksByCategory = useMemo(() => new Map(categoryOrder.map((category) => [
    category,
    searchable
      .filter((block) => block.category === category)
      .sort((a, b) => a.label.localeCompare(b.label)),
  ])), [searchable])
  const availableCategories = useMemo(
    () => categoryOrder.filter((category) => (blocksByCategory.get(category)?.length ?? 0) > 0),
    [blocksByCategory],
  )
  const recentBlocks = useMemo(() => validRecent.flatMap((id) => {
    const block = itemById.get(id)
    return block ? [block] : []
  }), [itemById, validRecent])

  const normalizedQuery = normalize(query)
  const ranked = useMemo(
    () => normalizedQuery
      ? searchable
          .map((block) => ({ block, score: scoreBlock(block, normalizedQuery) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => (
            b.score - a.score ||
            recentRank(a.block.id, validRecent) - recentRank(b.block.id, validRecent) ||
            a.block.label.localeCompare(b.block.label)
          ))
          .map((item) => item.block)
      : [],
    [normalizedQuery, searchable, validRecent],
  )

  const navigationItems = useMemo<NavigationItem[]>(() => {
    if (normalizedQuery) {
      return ranked.map((block) => ({
        id: `search-${block.id}`,
        kind: 'block',
        block,
        location: 'search',
      }))
    }
    if (activeCategory) {
      return (blocksByCategory.get(activeCategory) ?? []).map((block) => ({
        id: `category-${activeCategory}-${block.id}`,
        kind: 'block',
        block,
        location: 'category',
      }))
    }
    return [
      ...recentBlocks.map((block): BlockItem => ({
        id: `recent-${block.id}`,
        kind: 'block',
        block,
        location: 'recent',
      })),
      ...availableCategories.map((category): CategoryItem => ({
        id: `folder-${category}`,
        kind: 'category',
        category,
        count: blocksByCategory.get(category)?.length ?? 0,
      })),
    ]
  }, [activeCategory, availableCategories, blocksByCategory, normalizedQuery, ranked, recentBlocks])
  const visibleActiveIndex = Math.min(activeIndex, Math.max(0, navigationItems.length - 1))

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

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (isImeKeyboardEvent(event)) return
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', closeOnEscape, true)
    return () => document.removeEventListener('keydown', closeOnEscape, true)
  }, [onClose])

  useEffect(() => {
    const cancelSearch = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('contextmenu', cancelSearch, true)
    return () => document.removeEventListener('contextmenu', cancelSearch, true)
  }, [onClose])

  useEffect(() => {
    optionRefs.current[visibleActiveIndex]?.scrollIntoView?.({ block: 'nearest' })
  }, [navigationItems, visibleActiveIndex])

  const selectBlock = (block: SearchItem) => {
    const nextRecent = [block.id, ...validRecent.filter((id) => id !== block.id)].slice(0, MAX_RECENT)
    setRecent(nextRecent)
    writeRecent(nextRecent)
    const created = block.create(flowPosition)
    onCreated?.(created, block)
    onClose()
  }

  const openCategory = (category: MacroNodeCategory) => {
    setActiveCategory(category)
    setActiveIndex(0)
  }

  const goBack = () => {
    setActiveCategory(null)
    setActiveIndex(0)
    inputRef.current?.focus()
  }

  const activate = (item: NavigationItem | undefined) => {
    if (!item) return
    if (item.kind === 'category') openCategory(item.category)
    else selectBlock(item.block)
  }

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key === 'Backspace' && !query && activeCategory) {
      event.preventDefault()
      goBack()
      return
    }
    if (!navigationItems.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((visibleActiveIndex + 1) % navigationItems.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((visibleActiveIndex - 1 + navigationItems.length) % navigationItems.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      activate(navigationItems[visibleActiveIndex])
    }
  }

  const renderItem = (item: NavigationItem) => {
    const index = navigationItems.findIndex((candidate) => candidate.id === item.id)
    const active = index === visibleActiveIndex
    if (item.kind === 'category') {
      return (
        <button
          type="button"
          role="option"
          aria-selected={active}
          aria-label={`${macroCategoryLabels[item.category]} 폴더`}
          className={`quick-block-search__item quick-block-search__folder${active ? ' quick-block-search__item--active' : ''}`}
          key={item.id}
          ref={(element) => { optionRefs.current[index] = element }}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => openCategory(item.category)}
        >
          <span className="quick-block-search__folder-icon" aria-hidden="true">›</span>
          <span className="quick-block-search__label">{macroCategoryLabels[item.category]}</span>
          <span className="quick-block-search__count">{item.count}</span>
        </button>
      )
    }
    const path = [...item.block.categoryPath, item.block.label].join(' / ')
    return (
      <button
        type="button"
        role="option"
        aria-selected={active}
        className={`quick-block-search__item${active ? ' quick-block-search__item--active' : ''}`}
        key={item.id}
        ref={(element) => { optionRefs.current[index] = element }}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => selectBlock(item.block)}
      >
        <span className="quick-block-search__label">{item.block.label}</span>
        <span className="quick-block-search__description">
          {item.location === 'search' ? path : item.block.description ?? item.block.type}
        </span>
      </button>
    )
  }

  return createPortal(
    <div
      ref={popupRef}
      className="quick-block-search"
      role="dialog"
      aria-label={ko.quickSearch.label}
      style={{ left: popupPosition.x, top: popupPosition.y }}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={(event) => event.stopPropagation()}
    >
      <header className="quick-block-search__header">
        {!normalizedQuery && activeCategory ? (
          <>
            <button type="button" className="quick-block-search__back" onClick={goBack}>
              <span aria-hidden="true">‹</span> 뒤로
            </button>
            <strong>{macroCategoryLabels[activeCategory]}</strong>
          </>
        ) : (
          <strong>{normalizedQuery ? ko.quickSearch.results : ko.quickSearch.label}</strong>
        )}
      </header>
      <input
        ref={inputRef}
        className="quick-block-search__input"
        aria-label={ko.quickSearch.inputLabel}
        placeholder={ko.quickSearch.placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={keyDown}
        autoComplete="off"
      />
      <div className="quick-block-search__list" role="listbox" aria-label="매크로 블록">
        {!normalizedQuery && !activeCategory ? (
          <>
            {recentBlocks.length > 0 && (
              <section className="quick-block-search__section">
                <h2 className="quick-block-search__section-title">{ko.quickSearch.recent}</h2>
                {navigationItems
                  .filter((item) => item.kind === 'block' && item.location === 'recent')
                  .map(renderItem)}
              </section>
            )}
            <section className="quick-block-search__section">
              <h2 className="quick-block-search__section-title">카테고리</h2>
              {navigationItems.filter((item) => item.kind === 'category').map(renderItem)}
            </section>
          </>
        ) : navigationItems.map(renderItem)}
        {!navigationItems.length && (
          <div className="quick-block-search__empty">
            {ko.quickSearch.empty}{query.trim() ? `: “${query.trim()}”` : ''}
          </div>
        )}
      </div>
    </div>,
    getTapbotOverlayRoot(),
  )
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replaceAll('_', ' ').trim().replace(/\s+/g, ' ')
}

function scoreBlock(block: SearchItem, query: string) {
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
  const searchableText = [label, type, block.category, ...keywords, description].join(' ')
  const queryTokens = query.split(' ').filter(Boolean)
  if (queryTokens.length > 1 && queryTokens.every((token) => searchableText.includes(token))) {
    return 20
  }
  return 0
}

function recentRank(id: string, recent: readonly string[]) {
  const index = recent.indexOf(id)
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

function readRecent(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(QUICK_BLOCK_RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT)
      : []
  } catch {
    return []
  }
}

function writeRecent(types: readonly string[]) {
  try {
    window.localStorage.setItem(QUICK_BLOCK_RECENT_KEY, JSON.stringify(types))
  } catch {
    // Search remains usable when storage is unavailable.
  }
}
