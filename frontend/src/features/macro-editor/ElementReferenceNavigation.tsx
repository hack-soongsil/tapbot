import { useEffect, useMemo, useRef } from 'react'
import {
  SEMANTIC_SCREEN_OPTIONS,
  allElementReferences,
  categoriesForScreen,
  type ScreenElementReference,
} from './screen-elements'

interface ElementReferenceNavigationProps {
  query: string
  selected: ScreenElementReference
  onQueryChange: (query: string) => void
  onSelect: (reference: ScreenElementReference) => void
}

export function ElementReferenceNavigation({
  query,
  selected,
  onQueryChange,
  onSelect,
}: ElementReferenceNavigationProps) {
  const selectedButtonRef = useRef<HTMLButtonElement>(null)
  const references = useMemo(() => allElementReferences(), [])
  const filtered = useMemo(() => {
    const normalized = normalize(query)
    if (!normalized) return references
    return references.filter((reference) => referenceSearchText(reference).includes(normalized))
  }, [query, references])
  useEffect(() => {
    selectedButtonRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected.element.id, selected.screen.id])

  return (
    <nav className="element-reference-nav" aria-label="화면 엘리먼트 탐색">
      <label className="element-reference-search">
        <span>검색</span>
        <input
          autoFocus
          type="search"
          value={query}
          placeholder="이름, ID, 카테고리, 설명 검색"
          aria-label="엘리먼트 검색"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || filtered.length === 0) return
            event.preventDefault()
            onSelect(filtered[0]!)
          }}
        />
      </label>
      <div className="element-reference-tree">
        {SEMANTIC_SCREEN_OPTIONS.map((screen) => {
          const screenReferences = filtered.filter((reference) => reference.screen.id === screen.id)
          if (screenReferences.length === 0) return null
          return (
            <section className="element-reference-screen" key={screen.id}>
              <h3>{screen.label}</h3>
              {categoriesForScreen(screen.id).map((category) => {
                const categoryReferences = screenReferences
                  .filter((reference) => reference.category.id === category.id)
                if (categoryReferences.length === 0) return null
                return (
                  <div className="element-reference-category" key={category.id}>
                    <h4>{category.label}</h4>
                    <ul>
                      {categoryReferences.map((reference) => {
                        const active = selected.screen.id === reference.screen.id
                          && selected.element.id === reference.element.id
                        return (
                          <li key={`${reference.screen.id}:${reference.element.id}`}>
                            <button
                              ref={active ? selectedButtonRef : undefined}
                              type="button"
                              className={active ? 'is-active' : undefined}
                              aria-label={`${reference.screen.label} > ${category.label} > ${reference.element.label}`}
                              aria-current={active ? 'true' : undefined}
                              onClick={() => onSelect(reference)}
                            >
                              <span>{reference.element.label}</span>
                              <code>{reference.element.id}</code>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </section>
          )
        })}
        {filtered.length === 0 && (
          <p className="element-reference-empty">검색 결과가 없습니다.</p>
        )}
      </div>
    </nav>
  )
}

function referenceSearchText(reference: ScreenElementReference): string {
  return normalize([
    reference.element.label,
    reference.element.id,
    reference.category.label,
    reference.element.description ?? '',
    ...reference.element.usage,
  ].join(' '))
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replaceAll('_', ' ').trim().replace(/\s+/g, ' ')
}
