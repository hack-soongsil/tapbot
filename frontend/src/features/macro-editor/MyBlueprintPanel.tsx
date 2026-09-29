import { Button } from '@blueprintjs/core'
import { createPortal } from 'react-dom'
import { useEffect, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { getTapbotOverlayRoot } from '../../components/overlay-root'
import type { MacroDefinition, MacroVariableDefinition } from './types'
import {
  MACRO_BLUEPRINT_MIME,
  type BlueprintDragItem,
} from './blueprint-dnd'

export type BlueprintSelection =
  | { kind: 'variable'; id: string }
  | { kind: 'function'; id: string }

interface MyBlueprintPanelProps {
  definition: Pick<MacroDefinition, 'variables' | 'functions'> | null
  selection: BlueprintSelection | null
  onSelect: (selection: BlueprintSelection) => void
  onOpenFunction: (functionId: string) => void
  onAddVariable: () => void
  onEditVariable: (variableName: string) => void
  onDeleteVariable: (variableName: string) => void
  onCreateVariableNode: (variableName: string, mode: 'get' | 'set') => void
  onToggleVariableInput: (variableName: string) => void
  onAddFunction: () => void
  onRenameFunction: (functionId: string) => void
  onDuplicateFunction: (functionId: string) => void
  onDeleteFunction: (functionId: string) => void
}

export function MyBlueprintPanel({
  definition,
  selection,
  onSelect,
  onOpenFunction,
  onAddVariable,
  onEditVariable,
  onDeleteVariable,
  onCreateVariableNode,
  onToggleVariableInput,
  onAddFunction,
  onRenameFunction,
  onDuplicateFunction,
  onDeleteFunction,
}: MyBlueprintPanelProps) {
  const [menu, setMenu] = useState<BlueprintContextMenu | null>(null)
  const variables = definition?.variables ?? []
  const functions = definition?.functions ?? []

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close, { once: true })
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  const startVariableDrag = (
    event: DragEvent<HTMLButtonElement>,
    variable: MacroVariableDefinition,
  ) => {
    const mode = event.altKey ? 'set' : event.ctrlKey || event.metaKey ? 'get' : undefined
    setBlueprintDragData(event, { kind: 'variable', id: variable.name, mode })
  }

  return (
    <aside className="my-blueprint" aria-label="My Blueprint">
      <div className="macro-section-heading my-blueprint__heading">
        <span>My Blueprint</span>
        <div>
          <Button minimal icon="add" aria-label="새 변수" title="변수 추가" onClick={onAddVariable}>변수</Button>
          <Button minimal icon="add" aria-label="새 함수" title="함수 추가" onClick={onAddFunction}>함수</Button>
        </div>
      </div>
      <div className="my-blueprint__body">
        <BlueprintGroup title="변수" count={variables.length}>
          {variables.map((variable) => (
            <button
              type="button"
              draggable
              key={variable.name}
              className={`my-blueprint__item${selection?.kind === 'variable' && selection.id === variable.name ? ' is-selected' : ''}`}
              aria-label={`${variable.name} 변수 ${variable.type}`}
              title={variable.name}
              onClick={() => onSelect({ kind: 'variable', id: variable.name })}
              onContextMenu={(event) => {
                event.preventDefault()
                onSelect({ kind: 'variable', id: variable.name })
                setMenu({ kind: 'variable', variableName: variable.name, x: event.clientX, y: event.clientY })
              }}
              onDragStart={(event) => startVariableDrag(event, variable)}
            >
              <span className={`blueprint-type-dot blueprint-type--${variable.type}`} aria-hidden="true" />
              <strong>{variable.name}</strong>
              <code>{variable.type}</code>
            </button>
          ))}
          {variables.length === 0 && <EmptyRow>변수가 없습니다.</EmptyRow>}
        </BlueprintGroup>
        <BlueprintGroup title="함수" count={functions.length}>
          {functions.map((item) => (
            <button
              type="button"
              draggable
              key={item.id}
              className={`my-blueprint__item is-function${selection?.kind === 'function' && selection.id === item.id ? ' is-selected' : ''}`}
              aria-label={`${item.name} 함수`}
              title={item.name}
              onClick={() => onSelect({ kind: 'function', id: item.id })}
              onDoubleClick={() => onOpenFunction(item.id)}
              onContextMenu={(event) => openFunctionMenu(event, item.id, setMenu)}
              onDragStart={(event) => setBlueprintDragData(event, { kind: 'function', id: item.id })}
            >
              <span className="my-blueprint__function-icon" aria-hidden="true">ƒ</span>
              <strong>{item.name}</strong>
              <code>{item.inputs.length} → {item.outputs.length}</code>
            </button>
          ))}
          {functions.length === 0 && <EmptyRow>함수가 없습니다.</EmptyRow>}
        </BlueprintGroup>
      </div>
      {menu && createPortal((
        <div
          className="my-blueprint__context-menu"
          role="menu"
          aria-label={menu.kind === 'variable' ? '변수 메뉴' : '함수 메뉴'}
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {menu.kind === 'variable' ? (
            <>
              <button type="button" role="menuitem" onClick={() => { onCreateVariableNode(menu.variableName, 'get'); setMenu(null) }}>가져오기 노드 추가</button>
              <button type="button" role="menuitem" onClick={() => { onCreateVariableNode(menu.variableName, 'set'); setMenu(null) }}>설정 노드 추가</button>
              <button type="button" role="menuitem" onClick={() => { onEditVariable(menu.variableName); setMenu(null) }}>편집</button>
              <button type="button" role="menuitem" onClick={() => { onToggleVariableInput(menu.variableName); setMenu(null) }}>실행 입력 전환</button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => { onDeleteVariable(menu.variableName); setMenu(null) }}>삭제</button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => { onRenameFunction(menu.functionId); setMenu(null) }}>이름 변경</button>
              <button type="button" role="menuitem" onClick={() => { onDuplicateFunction(menu.functionId); setMenu(null) }}>복제</button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => { onDeleteFunction(menu.functionId); setMenu(null) }}>삭제</button>
            </>
          )}
        </div>
      ), getTapbotOverlayRoot())}
    </aside>
  )
}

function BlueprintGroup({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: ReactNode
}) {
  return (
    <section className="my-blueprint__group">
      <h2><span>{title}</span><small>{count}</small></h2>
      {children}
    </section>
  )
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <div className="my-blueprint__empty">{children}</div>
}

function setBlueprintDragData(
  event: DragEvent<HTMLButtonElement>,
  item: BlueprintDragItem,
) {
  event.dataTransfer.setData(MACRO_BLUEPRINT_MIME, JSON.stringify(item))
  event.dataTransfer.effectAllowed = 'copy'
}

function openFunctionMenu(
  event: MouseEvent<HTMLButtonElement>,
  functionId: string,
  setMenu: (menu: BlueprintContextMenu) => void,
) {
  event.preventDefault()
  setMenu({ kind: 'function', functionId, x: event.clientX, y: event.clientY })
}

type BlueprintContextMenu =
  | { kind: 'variable'; variableName: string; x: number; y: number }
  | { kind: 'function'; functionId: string; x: number; y: number }
