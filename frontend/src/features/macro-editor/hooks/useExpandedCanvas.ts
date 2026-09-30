import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import { isEditableKeyboardTarget, isImeKeyboardEvent } from '../keyboard-events'
import type { MacroFlowEdge, MacroFlowNode } from '../types'

const STORAGE_KEY = 'tapbot.macro.expandedLayout.v1'
export const EXPANDED_BLUEPRINT_MIN_WIDTH = 220
export const EXPANDED_BLUEPRINT_DEFAULT_WIDTH = 280
export const EXPANDED_BLUEPRINT_MAX_WIDTH = 420
export const EXPANDED_INSPECTOR_MIN_WIDTH = 260
export const EXPANDED_INSPECTOR_DEFAULT_WIDTH = 320
export const EXPANDED_INSPECTOR_MAX_WIDTH = 480
export const EXPANDED_CANVAS_MIN_WIDTH = 420
export const EXPANDED_SPLITTER_WIDTH = 8

interface ExpandedLayout {
  blueprintWidth: number
  inspectorWidth: number
}

const DEFAULT_LAYOUT: ExpandedLayout = {
  blueprintWidth: EXPANDED_BLUEPRINT_DEFAULT_WIDTH,
  inspectorWidth: EXPANDED_INSPECTOR_DEFAULT_WIDTH,
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

function storedWidth(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readLayout(): ExpandedLayout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ExpandedLayout>
    return {
      blueprintWidth: clamp(storedWidth(stored.blueprintWidth, EXPANDED_BLUEPRINT_DEFAULT_WIDTH), EXPANDED_BLUEPRINT_MIN_WIDTH, EXPANDED_BLUEPRINT_MAX_WIDTH),
      inspectorWidth: clamp(storedWidth(stored.inspectorWidth, EXPANDED_INSPECTOR_DEFAULT_WIDTH), EXPANDED_INSPECTOR_MIN_WIDTH, EXPANDED_INSPECTOR_MAX_WIDTH),
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

function constrainLayout(layout: ExpandedLayout, containerWidth: number): ExpandedLayout {
  const blueprintWidth = clamp(layout.blueprintWidth, EXPANDED_BLUEPRINT_MIN_WIDTH, EXPANDED_BLUEPRINT_MAX_WIDTH)
  const inspectorWidth = clamp(layout.inspectorWidth, EXPANDED_INSPECTOR_MIN_WIDTH, EXPANDED_INSPECTOR_MAX_WIDTH)
  if (containerWidth <= 0) return { blueprintWidth, inspectorWidth }

  const sideWidthBudget = Math.floor(containerWidth - EXPANDED_CANVAS_MIN_WIDTH - (EXPANDED_SPLITTER_WIDTH * 2))
  const minimumSideWidth = EXPANDED_BLUEPRINT_MIN_WIDTH + EXPANDED_INSPECTOR_MIN_WIDTH
  if (sideWidthBudget < minimumSideWidth || blueprintWidth + inspectorWidth <= sideWidthBudget) {
    return { blueprintWidth, inspectorWidth }
  }

  const overflow = blueprintWidth + inspectorWidth - sideWidthBudget
  const blueprintSlack = blueprintWidth - EXPANDED_BLUEPRINT_MIN_WIDTH
  const inspectorSlack = inspectorWidth - EXPANDED_INSPECTOR_MIN_WIDTH
  const totalSlack = blueprintSlack + inspectorSlack
  const blueprintReduction = totalSlack > 0
    ? Math.min(blueprintSlack, Math.ceil(overflow * (blueprintSlack / totalSlack)))
    : 0
  return {
    blueprintWidth: blueprintWidth - blueprintReduction,
    inspectorWidth: Math.max(EXPANDED_INSPECTOR_MIN_WIDTH, inspectorWidth - (overflow - blueprintReduction)),
  }
}

export function useExpandedCanvas({
  flowRef,
  dialogOpen,
}: {
  flowRef: RefObject<ReactFlowInstance<MacroFlowNode, MacroFlowEdge> | null>
  dialogOpen: boolean
}) {
  const [canvasExpanded, setCanvasExpanded] = useState(false)
  const [expandedLayout, setExpandedLayout] = useState<ExpandedLayout>(readLayout)
  const editorRef = useRef<HTMLDivElement>(null)

  const setCanvasExpansion = useCallback((expanded: boolean) => {
    const viewport = flowRef.current?.getViewport()
    setCanvasExpanded(expanded)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (viewport) void flowRef.current?.setViewport(viewport, { duration: 0 })
      })
    })
  }, [flowRef])

  useEffect(() => {
    if (!canvasExpanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (isImeKeyboardEvent(event) || isEditableKeyboardTarget(event.target)) return
      if (event.key === 'Escape' && !dialogOpen) setCanvasExpansion(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [canvasExpanded, dialogOpen, setCanvasExpansion])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(expandedLayout))
    } catch {
      // The editor remains usable when storage is unavailable.
    }
  }, [expandedLayout])

  useEffect(() => {
    const editor = editorRef.current
    if (!canvasExpanded || !editor || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const width = editor.getBoundingClientRect().width
      if (width > 0) setExpandedLayout((current) => constrainLayout(current, width))
    })
    observer.observe(editor)
    return () => observer.disconnect()
  }, [canvasExpanded])

  const beginExpandedResize = useCallback((
    side: 'blueprint' | 'inspector',
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startLayout = expandedLayout
    const startWidth = side === 'blueprint' ? startLayout.blueprintWidth : startLayout.inspectorWidth
    const move = (pointerEvent: PointerEvent) => {
      const containerWidth = editorRef.current?.getBoundingClientRect().width || window.innerWidth * 0.95
      const delta = pointerEvent.clientX - startX
      const requested = side === 'blueprint' ? startWidth + delta : startWidth - delta
      const minimum = side === 'blueprint' ? EXPANDED_BLUEPRINT_MIN_WIDTH : EXPANDED_INSPECTOR_MIN_WIDTH
      const maximum = side === 'blueprint' ? EXPANDED_BLUEPRINT_MAX_WIDTH : EXPANDED_INSPECTOR_MAX_WIDTH
      const otherWidth = side === 'blueprint' ? startLayout.inspectorWidth : startLayout.blueprintWidth
      const canvasSafeMaximum = Math.floor(containerWidth - otherWidth - EXPANDED_CANVAS_MIN_WIDTH - (EXPANDED_SPLITTER_WIDTH * 2))
      const next = clamp(requested, minimum, Math.max(minimum, Math.min(maximum, canvasSafeMaximum)))
      setExpandedLayout((current) => side === 'blueprint'
        ? { ...current, blueprintWidth: next }
        : { ...current, inspectorWidth: next })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.classList.remove('macro-canvas-is-resizing')
    }
    document.body.classList.add('macro-canvas-is-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }, [expandedLayout])

  const resetExpandedWidth = useCallback((side: 'blueprint' | 'inspector') => {
    const containerWidth = editorRef.current?.getBoundingClientRect().width || window.innerWidth * 0.95
    setExpandedLayout((current) => constrainLayout({
      ...current,
      [side === 'blueprint' ? 'blueprintWidth' : 'inspectorWidth']: side === 'blueprint'
        ? EXPANDED_BLUEPRINT_DEFAULT_WIDTH
        : EXPANDED_INSPECTOR_DEFAULT_WIDTH,
    }, containerWidth))
  }, [])

  return {
    canvasExpanded,
    expandedLayout,
    editorRef,
    setCanvasExpansion,
    beginExpandedResize,
    resetExpandedWidth,
  }
}
