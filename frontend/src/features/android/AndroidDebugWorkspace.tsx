import {
  Button,
  Callout,
  Card,
  Divider,
  Elevation,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AndroidDebugState,
  AndroidPointerPoint,
  AndroidUiBounds,
  AndroidUiNode,
} from '../../types/android-debug'
import type { VisionDetection } from '../../types/vision'
import { androidApi } from './android-api'
import { appendSampledPoint, isTapPath, mapPointerToFrame } from './pointer-gesture'
import { downloadUiTree } from './ui-tree-download'
import {
  findDeepestUiNodeAtPoint,
  framePointToUiTreePoint,
  scaleUiBounds,
  uiNodeSelectorHint,
} from './ui-tree-focus'
import {
  buildCompressedHierarchy,
  countCompressedRows,
  isActionableUiNode,
  isMeaningfulUiNode,
} from './ui-tree/hierarchy-compression'
import type { CompressedHierarchyRow } from './ui-tree/hierarchy-compression'
import type { AndroidDebugController } from './useAndroidDebug'
import { useMacroRuntime } from '../macro-runtime/useMacroRuntime'
import { MacroEventLog } from '../macro-runtime/MacroEventLog'
import type { MacroRuntimeEvent } from '../macro-runtime/types'
import {
  IntegratedMacroPanel,
  type IntegratedMacroPanelHandle,
} from '../macro-editor/IntegratedMacroPanel'
import { ko } from '../../i18n/ko'

interface AndroidDebugWorkspaceProps {
  controller: AndroidDebugController
  /** Kept for call-site compatibility; device switching is handled by /debug. */
  devices?: readonly unknown[]
  /** Kept for call-site compatibility; no selector is rendered in this workspace. */
  onDeviceChange?: (deviceId: string) => void
}

interface AndroidOverlayProps {
  width: number
  height: number
  detections: VisionDetection[]
  selectedId: string | null
  highlightedId: string | null
  plannedPoint: { x: number; y: number } | null
  uiBounds: AndroidUiBounds | null
  uiLabel: string | null
  pointerPath: AndroidPointerPoint[]
}

interface StableGeometry {
  width: number
  height: number
}

interface PointerBoundsSnapshot {
  left: number
  top: number
  width: number
  height: number
}

const DEFAULT_PHONE_GEOMETRY: StableGeometry = { width: 1080, height: 2280 }
const WORKSPACE_LAYOUT_STORAGE_KEY = 'tapbot.workspace.layout.v1'
const WORKSPACE_SPLITTER_SIZE = 8
const WORKSPACE_MAX_PANEL_FRACTION = 0.75
const WORKSPACE_MIN_MAIN_HEIGHT = 280
const WORKSPACE_LAYOUT_DEFAULTS = {
  liveScreenWidth: 380,
  uiTreeWidth: 270,
  inspectorWidth: 270,
  consoleHeight: 210,
} as const
const WORKSPACE_LAYOUT_MINIMUMS = {
  liveScreenWidth: 320,
  macroCanvasWidth: 420,
  uiTreeWidth: 220,
  inspectorWidth: 240,
  consoleHeight: 140,
} as const

interface WorkspaceLayout {
  liveScreenWidth: number
  uiTreeWidth: number
  inspectorWidth: number
  consoleHeight: number
}

type WorkspaceSplitter = 'live-macro' | 'macro-tree' | 'tree-inspector' | 'main-console'

interface WorkspaceResizeDrag {
  splitter: WorkspaceSplitter
  pointerId: number
  startX: number
  startY: number
  startLayout: WorkspaceLayout
  workspaceWidth: number
  workspaceHeight: number
  previousCursor: string
  previousUserSelect: string
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function loadWorkspaceLayout(): WorkspaceLayout {
  if (typeof window === 'undefined') return { ...WORKSPACE_LAYOUT_DEFAULTS }
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY) ?? 'null',
    ) as Partial<Record<keyof WorkspaceLayout, unknown>> | null
    if (!stored) return { ...WORKSPACE_LAYOUT_DEFAULTS }
    const read = (key: keyof WorkspaceLayout): number => {
      const value = stored[key]
      return typeof value === 'number' && Number.isFinite(value)
        ? value
        : WORKSPACE_LAYOUT_DEFAULTS[key]
    }
    return {
      liveScreenWidth: read('liveScreenWidth'),
      uiTreeWidth: read('uiTreeWidth'),
      inspectorWidth: read('inspectorWidth'),
      consoleHeight: read('consoleHeight'),
    }
  } catch {
    return { ...WORKSPACE_LAYOUT_DEFAULTS }
  }
}

function constrainWorkspaceLayout(
  layout: WorkspaceLayout,
  workspaceWidth: number,
  workspaceHeight: number,
): WorkspaceLayout {
  const widthLimit =
    workspaceWidth > 0
      ? workspaceWidth * WORKSPACE_MAX_PANEL_FRACTION
      : Number.POSITIVE_INFINITY
  let liveScreenWidth = clamp(
    layout.liveScreenWidth,
    WORKSPACE_LAYOUT_MINIMUMS.liveScreenWidth,
    widthLimit,
  )
  let uiTreeWidth = clamp(
    layout.uiTreeWidth,
    WORKSPACE_LAYOUT_MINIMUMS.uiTreeWidth,
    widthLimit,
  )
  let inspectorWidth = clamp(
    layout.inspectorWidth,
    WORKSPACE_LAYOUT_MINIMUMS.inspectorWidth,
    widthLimit,
  )

  if (workspaceWidth > 0) {
    const availableFixedWidth = Math.max(
      WORKSPACE_LAYOUT_MINIMUMS.liveScreenWidth +
        WORKSPACE_LAYOUT_MINIMUMS.uiTreeWidth +
        WORKSPACE_LAYOUT_MINIMUMS.inspectorWidth,
      workspaceWidth -
        WORKSPACE_SPLITTER_SIZE * 3 -
        WORKSPACE_LAYOUT_MINIMUMS.macroCanvasWidth,
    )
    const fixedWidth = liveScreenWidth + uiTreeWidth + inspectorWidth
    if (fixedWidth > availableFixedWidth) {
      const liveHeadroom = liveScreenWidth - WORKSPACE_LAYOUT_MINIMUMS.liveScreenWidth
      const treeHeadroom = uiTreeWidth - WORKSPACE_LAYOUT_MINIMUMS.uiTreeWidth
      const inspectorHeadroom =
        inspectorWidth - WORKSPACE_LAYOUT_MINIMUMS.inspectorWidth
      const totalHeadroom = liveHeadroom + treeHeadroom + inspectorHeadroom
      if (totalHeadroom > 0) {
        const reductionRatio = Math.min(
          1,
          (fixedWidth - availableFixedWidth) / totalHeadroom,
        )
        liveScreenWidth -= liveHeadroom * reductionRatio
        uiTreeWidth -= treeHeadroom * reductionRatio
        inspectorWidth -= inspectorHeadroom * reductionRatio
      }
    }
  }

  const consoleMaximum =
    workspaceHeight > 0
      ? Math.min(
          workspaceHeight * WORKSPACE_MAX_PANEL_FRACTION,
          workspaceHeight - WORKSPACE_SPLITTER_SIZE - WORKSPACE_MIN_MAIN_HEIGHT,
        )
      : Number.POSITIVE_INFINITY
  return {
    liveScreenWidth: Math.round(liveScreenWidth),
    uiTreeWidth: Math.round(uiTreeWidth),
    inspectorWidth: Math.round(inspectorWidth),
    consoleHeight: Math.round(
      clamp(
        layout.consoleHeight,
        WORKSPACE_LAYOUT_MINIMUMS.consoleHeight,
        consoleMaximum,
      ),
    ),
  }
}

function resizeWorkspaceLayout(
  splitter: WorkspaceSplitter,
  start: WorkspaceLayout,
  deltaX: number,
  deltaY: number,
  workspaceWidth: number,
  workspaceHeight: number,
): WorkspaceLayout {
  const next = { ...start }
  if (splitter === 'live-macro') next.liveScreenWidth += deltaX
  if (splitter === 'macro-tree') next.uiTreeWidth -= deltaX
  if (splitter === 'tree-inspector') {
    next.uiTreeWidth += deltaX
    next.inspectorWidth -= deltaX
  }
  if (splitter === 'main-console') next.consoleHeight -= deltaY
  return constrainWorkspaceLayout(next, workspaceWidth, workspaceHeight)
}

function validGeometry(
  width: number | null | undefined,
  height: number | null | undefined,
): StableGeometry | null {
  return typeof width === 'number' &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === 'number' &&
    Number.isFinite(height) &&
    height > 0
    ? { width, height }
    : null
}

function AndroidOverlay({
  width,
  height,
  detections,
  selectedId,
  highlightedId,
  plannedPoint,
  uiBounds,
  uiLabel,
  pointerPath,
}: AndroidOverlayProps) {
  const scale = Math.max(width, height) / 900
  const pointerStart = pointerPath[0]
  const pointerEnd = pointerPath.at(-1)
  return (
    <svg
      className="android-screen-overlay"
      viewBox={`0 0 ${width.toString()} ${height.toString()}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {detections.map((detection) => (
        <g
          key={detection.id}
          className={[
            'android-detection-box',
            detection.id === selectedId ? 'is-selected' : '',
            detection.id === highlightedId ? 'is-highlighted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <rect
            x={detection.bbox.x}
            y={detection.bbox.y}
            width={detection.bbox.width}
            height={detection.bbox.height}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={detection.bbox.x}
            y={Math.max(detection.bbox.y - 6 * scale, 13 * scale)}
          >
            {detection.label} · {(detection.confidence * 100).toFixed(1)}%
          </text>
        </g>
      ))}
      {uiBounds && (
        <g className="android-ui-node-box">
          <rect
            x={uiBounds.left}
            y={uiBounds.top}
            width={uiBounds.right - uiBounds.left}
            height={uiBounds.bottom - uiBounds.top}
            vectorEffect="non-scaling-stroke"
          />
          {uiLabel && (
            <text x={uiBounds.left} y={Math.max(uiBounds.top - 6 * scale, 13 * scale)}>
              {uiLabel}
            </text>
          )}
          <circle
            cx={(uiBounds.left + uiBounds.right) / 2}
            cy={(uiBounds.top + uiBounds.bottom) / 2}
            r={Math.max(5 * scale, 3)}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
      {plannedPoint && (
        <g className="android-planned-tap">
          <circle
            cx={plannedPoint.x}
            cy={plannedPoint.y}
            r={Math.max(10 * scale, 5)}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={`M ${plannedPoint.x - 16 * scale} ${plannedPoint.y} H ${plannedPoint.x + 16 * scale} M ${plannedPoint.x} ${plannedPoint.y - 16 * scale} V ${plannedPoint.y + 16 * scale}`}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
      {pointerStart && pointerEnd && (
        <g className="android-pointer-path">
          {pointerPath.length > 1 && (
            <polyline
              points={pointerPath.map((point) => `${point.x},${point.y}`).join(' ')}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <circle
            className="android-pointer-path__start"
            cx={pointerStart.x}
            cy={pointerStart.y}
            r={Math.max(7 * scale, 4)}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            className="android-pointer-path__current"
            cx={pointerEnd.x}
            cy={pointerEnd.y}
            r={Math.max(9 * scale, 5)}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
    </svg>
  )
}

function pretty(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function macroIntent(status: string | undefined) {
  if (status === 'RUNNING' || status === 'STEPPING') return 'success' as const
  if (status === 'PAUSED') return 'warning' as const
  return 'none' as const
}

export function AndroidDebugWorkspace({ controller }: AndroidDebugWorkspaceProps) {
  const { status, debug, setSelectedUiNodeId } = controller
  const liveMacro = useMacroRuntime(controller.deviceId)
  const macroPanelRef = useRef<IntegratedMacroPanelHandle>(null)
  const [macroCanvasAvailable, setMacroCanvasAvailable] = useState(false)
  const workspaceGridRef = useRef<HTMLDivElement>(null)
  const workspaceResizeDrag = useRef<WorkspaceResizeDrag | null>(null)
  const [activeSplitter, setActiveSplitter] = useState<WorkspaceSplitter | null>(null)
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 })
  const [workspaceLayout, setWorkspaceLayout] =
    useState<WorkspaceLayout>(loadWorkspaceLayout)
  const effectiveWorkspaceLayout = useMemo(
    () =>
      constrainWorkspaceLayout(
        workspaceLayout,
        workspaceSize.width,
        workspaceSize.height,
      ),
    [workspaceLayout, workspaceSize.height, workspaceSize.width],
  )
  const workspaceGridStyle = {
    '--tapbot-live-screen-width': `${effectiveWorkspaceLayout.liveScreenWidth.toString()}px`,
    '--tapbot-ui-tree-width': `${effectiveWorkspaceLayout.uiTreeWidth.toString()}px`,
    '--tapbot-inspector-width': `${effectiveWorkspaceLayout.inspectorWidth.toString()}px`,
    '--tapbot-console-height': `${effectiveWorkspaceLayout.consoleHeight.toString()}px`,
  } as CSSProperties

  useEffect(() => {
    const grid = workspaceGridRef.current
    if (!grid) return
    const updateSize = () => {
      const bounds = grid.getBoundingClientRect()
      setWorkspaceSize({ width: bounds.width, height: bounds.height })
    }
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WORKSPACE_LAYOUT_STORAGE_KEY,
        JSON.stringify(workspaceLayout),
      )
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }, [workspaceLayout])

  const finishWorkspaceResize = useCallback(() => {
    const drag = workspaceResizeDrag.current
    if (!drag) return
    workspaceResizeDrag.current = null
    setActiveSplitter(null)
    document.body.classList.remove('is-resizing-workspace')
    document.body.style.cursor = drag.previousCursor
    document.body.style.userSelect = drag.previousUserSelect
  }, [])

  useEffect(() => finishWorkspaceResize, [finishWorkspaceResize])

  const beginWorkspaceResize = useCallback(
    (splitter: WorkspaceSplitter, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const bounds = workspaceGridRef.current?.getBoundingClientRect()
      if (!bounds) return
      const cursor = splitter === 'main-console' ? 'row-resize' : 'col-resize'
      workspaceResizeDrag.current = {
        splitter,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLayout: constrainWorkspaceLayout(
          effectiveWorkspaceLayout,
          bounds.width,
          bounds.height,
        ),
        workspaceWidth: bounds.width,
        workspaceHeight: bounds.height,
        previousCursor: document.body.style.cursor,
        previousUserSelect: document.body.style.userSelect,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setActiveSplitter(splitter)
      document.body.classList.add('is-resizing-workspace')
      document.body.style.cursor = cursor
      document.body.style.userSelect = 'none'
    },
    [effectiveWorkspaceLayout],
  )

  const moveWorkspaceResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = workspaceResizeDrag.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      setWorkspaceLayout(
        resizeWorkspaceLayout(
          drag.splitter,
          drag.startLayout,
          event.clientX - drag.startX,
          event.clientY - drag.startY,
          drag.workspaceWidth,
          drag.workspaceHeight,
        ),
      )
    },
    [],
  )

  const endWorkspaceResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (workspaceResizeDrag.current?.pointerId !== event.pointerId) return
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      finishWorkspaceResize()
    },
    [finishWorkspaceResize],
  )

  const resetWorkspaceSplitter = useCallback((splitter: WorkspaceSplitter) => {
    setWorkspaceLayout((current) => {
      if (splitter === 'live-macro') {
        return {
          ...current,
          liveScreenWidth: WORKSPACE_LAYOUT_DEFAULTS.liveScreenWidth,
        }
      }
      if (splitter === 'macro-tree') {
        return { ...current, uiTreeWidth: WORKSPACE_LAYOUT_DEFAULTS.uiTreeWidth }
      }
      if (splitter === 'tree-inspector') {
        return {
          ...current,
          uiTreeWidth: WORKSPACE_LAYOUT_DEFAULTS.uiTreeWidth,
          inspectorWidth: WORKSPACE_LAYOUT_DEFAULTS.inspectorWidth,
        }
      }
      return { ...current, consoleHeight: WORKSPACE_LAYOUT_DEFAULTS.consoleHeight }
    })
  }, [])

  const resizeWorkspaceWithKeyboard = useCallback(
    (splitter: WorkspaceSplitter, event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Home') {
        event.preventDefault()
        resetWorkspaceSplitter(splitter)
        return
      }
      const horizontal = splitter === 'main-console'
      const delta = 16
      const deltaX =
        event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0
      const deltaY =
        event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0
      if ((horizontal && deltaY === 0) || (!horizontal && deltaX === 0)) return
      event.preventDefault()
      const bounds = workspaceGridRef.current?.getBoundingClientRect()
      if (!bounds) return
      setWorkspaceLayout((current) =>
        resizeWorkspaceLayout(
          splitter,
          constrainWorkspaceLayout(current, bounds.width, bounds.height),
          deltaX,
          deltaY,
          bounds.width,
          bounds.height,
        ),
      )
    },
    [resetWorkspaceSplitter],
  )
  const currentGeometry = useMemo(
    () =>
      validGeometry(status?.stream?.width, status?.stream?.height) ??
      validGeometry(status?.agent?.device.width, status?.agent?.device.height) ??
      validGeometry(debug?.frame?.width, debug?.frame?.height),
    [debug?.frame, status?.agent?.device, status?.stream],
  )
  const [stableGeometry, setStableGeometry] = useState<StableGeometry>(
    () => currentGeometry ?? DEFAULT_PHONE_GEOMETRY,
  )
  const frameWidth = stableGeometry.width
  const frameHeight = stableGeometry.height
  const canControl = Boolean(
    status?.connected &&
    status.agent?.accessibility_enabled &&
    status.agent.remote_control_enabled,
  )
  const useStream = Boolean(status?.stream?.running && !controller.streamFailed)
  const imageSource = useStream
    ? androidApi.streamUrl(controller.deviceId ?? '', controller.streamNonce)
    : androidApi.screenshotUrl(
        controller.deviceId ?? '',
        debug?.frame?.frame_id ?? controller.streamNonce,
      )
  const macroTapPoint = liveMacro.overlay.tapPoint
  const plannedPoint = macroTapPoint
    ? { x: macroTapPoint[0], y: macroTapPoint[1] }
    : (debug?.decision.target?.screen ?? null)
  const selected = useMemo(
    () =>
      debug?.detections.find(
        (detection) => detection.id === controller.selectedDetectionId,
      ) ?? null,
    [controller.selectedDetectionId, debug?.detections],
  )
  const selectedUiNode = useMemo(
    () =>
      controller.uiTree?.nodes.find(
        (node) => node.node_id === controller.selectedUiNodeId,
      ) ?? null,
    [controller.selectedUiNodeId, controller.uiTree?.nodes],
  )
  const [hoveredUiNodeId, setHoveredUiNodeId] = useState<string | null>(null)
  const hoveredUiNode = useMemo(
    () =>
      controller.uiTree?.nodes.find((node) => node.node_id === hoveredUiNodeId) ?? null,
    [controller.uiTree?.nodes, hoveredUiNodeId],
  )
  const overlayUiNode = hoveredUiNode ?? selectedUiNode
  const selectedUiBoundsFromTree =
    controller.uiTree && overlayUiNode
      ? scaleUiBounds(
          overlayUiNode.bounds,
          controller.uiTree.screen_width,
          controller.uiTree.screen_height,
          frameWidth,
          frameHeight,
        )
      : null
  const macroBounds = liveMacro.overlay.bounds
  const selectedUiBounds =
    selectedUiBoundsFromTree ??
    (macroBounds
      ? {
          left: macroBounds[0],
          top: macroBounds[1],
          right: macroBounds[2],
          bottom: macroBounds[3],
        }
      : null)
  const selectedUiLabel = overlayUiNode
    ? (overlayUiNode.text ??
      overlayUiNode.content_description ??
      shortClassName(overlayUiNode.class_name))
    : macroBounds
      ? `매크로 · ${liveMacro.overlay.nodeId ?? '탭'}`
      : null
  const overlayFrameMatches =
    !debug?.frame ||
    (debug.frame.width === frameWidth && debug.frame.height === frameHeight)
  const [recordingPath, setRecordingPath] = useState<AndroidPointerPoint[]>([])
  const [recentPath, setRecentPath] = useState<AndroidPointerPoint[]>([])
  const [inspectMode, setInspectMode] = useState(false)
  const isRecording = recordingPath.length > 0
  const activePointer = useRef<{
    id: number
    startedAt: number
    points: AndroidPointerPoint[]
    bounds: PointerBoundsSnapshot
    frameWidth: number
    frameHeight: number
  } | null>(null)
  const recentPathTimer = useRef<number | null>(null)

  const cancelPointerRecording = useCallback(() => {
    activePointer.current = null
    setRecordingPath([])
  }, [])

  useEffect(() => {
    activePointer.current = null
    const reset = window.setTimeout(() => {
      setRecordingPath([])
      setRecentPath([])
      setHoveredUiNodeId(null)
      setInspectMode(false)
      setMacroCanvasAvailable(false)
    }, 0)
    return () => window.clearTimeout(reset)
  }, [controller.deviceId])

  useEffect(() => {
    if (!currentGeometry || isRecording) return undefined
    const update = window.setTimeout(() => {
      if (activePointer.current) return
      setStableGeometry((previous) =>
        previous.width === currentGeometry.width &&
        previous.height === currentGeometry.height
          ? previous
          : currentGeometry,
      )
    }, 0)
    return () => window.clearTimeout(update)
  }, [currentGeometry, isRecording])

  useEffect(() => {
    if (!canControl || controller.streamFailed) {
      activePointer.current = null
      const reset = window.setTimeout(() => setRecordingPath([]), 0)
      return () => window.clearTimeout(reset)
    }
    return undefined
  }, [canControl, controller.streamFailed])

  useEffect(
    () => () => {
      if (recentPathTimer.current !== null) {
        window.clearTimeout(recentPathTimer.current)
      }
    },
    [],
  )

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setHoveredUiNodeId(null)
      setSelectedUiNodeId(null)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [setSelectedUiNodeId])

  const eventPoint = (
    event: ReactPointerEvent<HTMLDivElement>,
    bounds: PointerBoundsSnapshot,
    width: number,
    height: number,
  ): { x: number; y: number } | null =>
    mapPointerToFrame(event.clientX, event.clientY, bounds, width, height)

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (!inspectMode && !canControl)) return
    const rect = event.currentTarget.getBoundingClientRect()
    const bounds = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }
    const point = eventPoint(event, bounds, frameWidth, frameHeight)
    event.preventDefault()
    if (inspectMode) {
      const tree = controller.uiTree
      const treePoint =
        tree && point
          ? framePointToUiTreePoint(
              point,
              frameWidth,
              frameHeight,
              tree.screen_width,
              tree.screen_height,
            )
          : null
      const node =
        tree && treePoint
          ? findDeepestUiNodeAtPoint(tree.nodes, treePoint.x, treePoint.y)
          : null
      setHoveredUiNodeId(null)
      controller.setSelectedUiNodeId(node?.node_id ?? null)
      return
    }
    if (!point) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const first = { ...point, t_ms: 0 }
    activePointer.current = {
      id: event.pointerId,
      startedAt: performance.now(),
      points: [first],
      bounds,
      frameWidth,
      frameHeight,
    }
    setRecordingPath([first])
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = activePointer.current
    if (!active || active.id !== event.pointerId) return
    const point = eventPoint(
      event,
      active.bounds,
      active.frameWidth,
      active.frameHeight,
    )
    if (!point) return
    event.preventDefault()
    const sampled = appendSampledPoint(active.points, {
      ...point,
      t_ms: Math.max(0, Math.round(performance.now() - active.startedAt)),
    })
    if (sampled !== active.points) {
      active.points = sampled
      setRecordingPath(sampled)
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = activePointer.current
    if (!active || active.id !== event.pointerId) return
    event.preventDefault()
    const fallback = active.points.at(-1)
    if (!fallback) {
      cancelPointerRecording()
      return
    }
    const mapped =
      eventPoint(event, active.bounds, active.frameWidth, active.frameHeight) ??
      fallback
    const elapsed = Math.max(1, Math.round(performance.now() - active.startedAt))
    const completed = appendSampledPoint(
      active.points,
      { x: mapped.x, y: mapped.y, t_ms: elapsed },
      { force: true },
    )
    activePointer.current = null
    setRecordingPath([])
    setRecentPath(completed)
    if (recentPathTimer.current !== null) window.clearTimeout(recentPathTimer.current)
    recentPathTimer.current = window.setTimeout(() => setRecentPath([]), 900)
    const first = completed[0]
    if (!first) return
    if (isTapPath(completed)) {
      void controller.tap(first.x, first.y)
    } else {
      void controller.gesture(completed)
    }
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointer.current?.id !== event.pointerId) return
    event.preventDefault()
    cancelPointerRecording()
  }

  return (
    <section className="android-debug-workspace" aria-labelledby="android-debug-title">
      <div className="android-debug-heading">
        <div>
          <span>PC 제어 화면</span>
          <h1 id="android-debug-title">{ko.panels.androidRemoteDebug}</h1>
        </div>
        <div className="android-debug-heading__tags">
          <Tag intent={status?.connected ? 'success' : 'danger'} minimal>
            안드로이드 {status?.connected ? '온라인' : '오프라인'}
          </Tag>
          <Tag intent={status?.stream?.running ? 'success' : 'warning'} minimal>
            스트림 {status?.stream?.running ? '실시간' : '대체 모드'}
          </Tag>
          <Tag intent={controller.uiTree ? 'success' : 'none'} minimal>
            {ko.panels.uiTree} {controller.uiTree ? '정상' : '—'}
          </Tag>
          <Tag intent={macroIntent(debug?.macro.status)} minimal>
            매크로 {debug?.macro.status ?? '대기'}
          </Tag>
        </div>
      </div>

      <div
        ref={workspaceGridRef}
        className="android-debug-grid"
        data-workspace-region="main"
        style={workspaceGridStyle}
      >
        <Card
          className="android-live-card"
          elevation={Elevation.ONE}
          data-editor-pane="live"
        >
          <header className="android-card-heading">
            <div>
              <span>기준 화면 소스</span>
              <strong>{ko.panels.androidLiveScreen}</strong>
            </div>
            <div>
              <Button
                minimal
                small
                icon="selection"
                text="요소 검사"
                active={inspectMode}
                intent={inspectMode ? 'primary' : 'none'}
                disabled={!controller.uiTree}
                aria-pressed={inspectMode}
                onClick={() => {
                  cancelPointerRecording()
                  setRecentPath([])
                  setInspectMode((current) => !current)
                }}
              />
              {frameWidth > 0 && frameHeight > 0 && (
                <Tag minimal>
                  {frameWidth} × {frameHeight}
                </Tag>
              )}
              <Tag minimal>{status?.stream?.fps?.toFixed(1) ?? '—'} FPS</Tag>
              <Tag minimal>{status?.stream?.frame_age_ms?.toFixed(0) ?? '—'} ms</Tag>
            </div>
          </header>

          <div className="android-live-shell">
            <div
              className={`android-live-stage ${
                inspectMode ? 'is-inspect-mode' : canControl ? 'is-tap-mode' : ''
              }`}
              style={{
                aspectRatio: `${frameWidth.toString()} / ${frameHeight.toString()}`,
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onContextMenu={(event) => event.preventDefault()}
              role={canControl || inspectMode ? 'button' : undefined}
              tabIndex={canControl || inspectMode ? 0 : undefined}
              aria-label={inspectMode ? '실시간 화면에서 UI 요소 검사' : undefined}
              data-geometry={`${frameWidth.toString()}x${frameHeight.toString()}`}
            >
              <img
                src={status?.connected ? imageSource : undefined}
                alt="안드로이드 실시간 화면"
                draggable={false}
                onError={() => {
                  if (useStream) controller.setStreamFailed(true)
                }}
              />
              <AndroidOverlay
                width={frameWidth}
                height={frameHeight}
                detections={overlayFrameMatches ? (debug?.detections ?? []) : []}
                selectedId={controller.selectedDetectionId}
                highlightedId={controller.highlightedDetectionId}
                plannedPoint={overlayFrameMatches ? plannedPoint : null}
                uiBounds={selectedUiBounds}
                uiLabel={selectedUiLabel}
                pointerPath={recordingPath.length > 0 ? recordingPath : recentPath}
              />
              <div className="android-live-badges">
                <Tag intent={useStream ? 'success' : 'warning'} minimal>
                  {useStream ? 'MJPEG 실시간' : '스크린샷 대체 모드'}
                </Tag>
                <Tag intent={canControl ? 'success' : 'warning'}>
                  {inspectMode
                    ? '요소 검사 모드'
                    : canControl
                      ? '제어 준비됨'
                      : '제어할 수 없음'}
                </Tag>
                {!overlayFrameMatches && (
                  <Tag intent="warning">OVERLAY GEOMETRY STALE</Tag>
                )}
              </div>
              <div
                className={`android-screen-empty ${status?.connected ? 'is-hidden' : ''}`}
                aria-hidden={status?.connected}
              >
                {status === null ? <Spinner size={36} /> : null}
                <strong>{status === null ? '연결 중' : '안드로이드 연결 불가'}</strong>
                <span>
                  {status?.error ?? '안드로이드 에이전트 상태를 기다리는 중입니다.'}
                </span>
              </div>
            </div>
          </div>

          <div className="android-control-bar">
            <Button
              icon="camera"
              text="스크린샷"
              loading={controller.busy === 'Screenshot'}
              disabled={!status?.connected}
              onClick={() => void controller.saveScreenshot()}
            />
            <Button
              icon="undo"
              text="뒤로"
              loading={controller.busy === 'Back'}
              disabled={!canControl}
              onClick={() => void controller.back()}
            />
            <Button
              icon="home"
              text="홈"
              loading={controller.busy === 'Home'}
              disabled={!canControl}
              onClick={() => void controller.home()}
            />
            <Button
              className={controller.streamFailed ? '' : 'is-placeholder-control'}
              icon="refresh"
              text="스트림 다시 연결"
              disabled={!controller.streamFailed}
              onClick={controller.reconnectStream}
            />
          </div>
        </Card>

        <div
          className={`android-workspace-splitter is-live-macro${activeSplitter === 'live-macro' ? ' is-active' : ''}`}
          role="separator"
          aria-label="Live Screen과 Macro Canvas 크기 조절"
          aria-orientation="vertical"
          aria-valuemin={WORKSPACE_LAYOUT_MINIMUMS.liveScreenWidth}
          aria-valuenow={effectiveWorkspaceLayout.liveScreenWidth}
          tabIndex={0}
          onPointerDown={(event) => beginWorkspaceResize('live-macro', event)}
          onPointerMove={moveWorkspaceResize}
          onPointerUp={endWorkspaceResize}
          onPointerCancel={endWorkspaceResize}
          onDoubleClick={() => resetWorkspaceSplitter('live-macro')}
          onKeyDown={(event) => resizeWorkspaceWithKeyboard('live-macro', event)}
        />

        {controller.deviceId && (
          <IntegratedMacroPanel
            key={`macro-${controller.deviceId}`}
            ref={macroPanelRef}
            deviceId={controller.deviceId}
            runtime={liveMacro}
            onAvailabilityChange={setMacroCanvasAvailable}
          />
        )}

        <div
          className={`android-workspace-splitter is-macro-tree${activeSplitter === 'macro-tree' ? ' is-active' : ''}`}
          role="separator"
          aria-label="Macro Canvas와 UI Tree 크기 조절"
          aria-orientation="vertical"
          aria-valuemin={WORKSPACE_LAYOUT_MINIMUMS.uiTreeWidth}
          aria-valuenow={effectiveWorkspaceLayout.uiTreeWidth}
          tabIndex={0}
          onPointerDown={(event) => beginWorkspaceResize('macro-tree', event)}
          onPointerMove={moveWorkspaceResize}
          onPointerUp={endWorkspaceResize}
          onPointerCancel={endWorkspaceResize}
          onDoubleClick={() => resetWorkspaceSplitter('macro-tree')}
          onKeyDown={(event) => resizeWorkspaceWithKeyboard('macro-tree', event)}
        />

        <Card
          className="android-hierarchy-pane"
          elevation={Elevation.ONE}
          data-editor-pane="hierarchy"
        >
          <UiTreeHierarchy
            key={controller.deviceId ?? 'no-device'}
            controller={controller}
            onHoverNode={setHoveredUiNodeId}
          />
        </Card>

        <div
          className={`android-workspace-splitter is-tree-inspector${activeSplitter === 'tree-inspector' ? ' is-active' : ''}`}
          role="separator"
          aria-label="UI Tree와 Node Inspector 크기 조절"
          aria-orientation="vertical"
          aria-valuemin={WORKSPACE_LAYOUT_MINIMUMS.uiTreeWidth}
          aria-valuenow={effectiveWorkspaceLayout.uiTreeWidth}
          tabIndex={0}
          onPointerDown={(event) => beginWorkspaceResize('tree-inspector', event)}
          onPointerMove={moveWorkspaceResize}
          onPointerUp={endWorkspaceResize}
          onPointerCancel={endWorkspaceResize}
          onDoubleClick={() => resetWorkspaceSplitter('tree-inspector')}
          onKeyDown={(event) => resizeWorkspaceWithKeyboard('tree-inspector', event)}
        />

        <Card
          className="android-node-inspector-pane"
          elevation={Elevation.ONE}
          data-editor-pane="inspector"
        >
          <UiNodeInspector
            controller={controller}
            node={selectedUiNode}
            frameWidth={frameWidth}
            frameHeight={frameHeight}
            macroCanvasAvailable={macroCanvasAvailable}
            onAddFindElement={() => {
              if (!selectedUiNode) return
              macroPanelRef.current?.addFindElement(
                uiNodeSelectorHint(selectedUiNode),
                nodeTitle(selectedUiNode),
              )
            }}
          />
          <InspectorMessages controller={controller} />
        </Card>

        <div
          className={`android-workspace-splitter is-main-console${activeSplitter === 'main-console' ? ' is-active' : ''}`}
          role="separator"
          aria-label="Main 영역과 Console 높이 조절"
          aria-orientation="horizontal"
          aria-valuemin={WORKSPACE_LAYOUT_MINIMUMS.consoleHeight}
          aria-valuenow={effectiveWorkspaceLayout.consoleHeight}
          tabIndex={0}
          onPointerDown={(event) => beginWorkspaceResize('main-console', event)}
          onPointerMove={moveWorkspaceResize}
          onPointerUp={endWorkspaceResize}
          onPointerCancel={endWorkspaceResize}
          onDoubleClick={() => resetWorkspaceSplitter('main-console')}
          onKeyDown={(event) => resizeWorkspaceWithKeyboard('main-console', event)}
        />

        <AndroidConsolePanel
          key={`console-${controller.deviceId ?? 'no-device'}`}
          controller={controller}
          selectedDetection={selected}
          macroEvents={liveMacro.events}
        />
      </div>
    </section>
  )
}

type ConsoleTab = 'system' | 'user' | 'vision' | 'macro'
type UserDebugLevel = 'all' | 'debug' | 'info' | 'warning' | 'error'

function shortClassName(className: string | null): string {
  return className?.split('.').at(-1) ?? 'Node'
}

function nodeTitle(node: AndroidUiNode): string {
  return node.text ?? node.content_description ?? shortClassName(node.class_name)
}

function nodeFingerprint(node: AndroidUiNode): string {
  return JSON.stringify([
    node.view_id_resource_name,
    node.content_description,
    node.text,
    node.class_name,
    node.depth,
  ])
}

function hierarchyRoot(root: AndroidUiNode, nodes: AndroidUiNode[]): AndroidUiNode {
  if (root.children?.length || nodes.length <= 1) return root
  const copies = new Map(
    nodes.map((node) => [node.node_id, { ...node, children: [] as AndroidUiNode[] }]),
  )
  for (const node of copies.values()) {
    if (node.parent_id) copies.get(node.parent_id)?.children?.push(node)
  }
  return copies.get(root.node_id) ?? root
}

function nodeMatches(node: AndroidUiNode, query: string): boolean {
  if (!query) return true
  return [
    node.text,
    node.content_description,
    node.view_id_resource_name,
    node.class_name,
    node.node_id,
  ].some((value) => value?.toLocaleLowerCase().includes(query))
}

function collectMatchingBranches(
  node: AndroidUiNode,
  predicate: (node: AndroidUiNode) => boolean,
  matches: Set<string>,
): boolean {
  let included = predicate(node)
  for (const child of node.children ?? []) {
    if (collectMatchingBranches(child, predicate, matches)) included = true
  }
  if (included) matches.add(node.node_id)
  return included
}

function preferredSelector(node: AndroidUiNode): string {
  if (node.view_id_resource_name)
    return `viewId == ${JSON.stringify(node.view_id_resource_name)}`
  if (node.content_description)
    return `contentDescription == ${JSON.stringify(node.content_description)}`
  if (node.text)
    return `text == ${JSON.stringify(node.text)}${node.clickable ? ' && clickable == true' : ''}`
  if (node.class_name) return `className == ${JSON.stringify(node.class_name)}`
  return `snapshotNode == ${JSON.stringify(node.node_id)}`
}

function UiNodeFindAction({
  disabled,
  macroCanvasAvailable,
  onAddFindElement,
}: {
  disabled: boolean
  macroCanvasAvailable: boolean
  onAddFindElement: () => void
}) {
  return (
    <div className="android-node-actions" aria-label="매크로 엘리먼트 액션">
      <Button
        small
        icon="add"
        text="Find Element 추가"
        disabled={disabled}
        onClick={onAddFindElement}
      />
      {!macroCanvasAvailable && (
        <small className="android-node-action-message">활성 매크로가 없습니다</small>
      )}
    </div>
  )
}

function InspectorMessages({ controller }: { controller: AndroidDebugController }) {
  const { status } = controller
  const hasMessages = Boolean(
    (status && !status.configured) || controller.error || controller.notice,
  )
  return (
    <div
      className={`android-debug-message-slot${hasMessages ? '' : ' is-empty'}`}
      aria-live="polite"
    >
      {status && !status.configured && (
        <Callout intent="warning" title="안드로이드 에이전트가 설정되지 않았습니다">
          PC 백엔드에서 안드로이드 에이전트를 설정하세요.
        </Callout>
      )}
      {controller.error && (
        <Callout intent="danger" title="안드로이드 디버그 오류">
          {controller.error}
        </Callout>
      )}
      {controller.notice && <Callout intent="success">{controller.notice}</Callout>}
      {(!status || status.configured) && !controller.error && !controller.notice && (
        <span className="android-message-placeholder" aria-hidden="true">
          No active messages.
        </span>
      )}
    </div>
  )
}

function UiTreeHierarchy({
  controller,
  onHoverNode,
}: {
  controller: AndroidDebugController
  onHoverNode: (nodeId: string | null) => void
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [visibleOnly, setVisibleOnly] = useState(true)
  const [clickableOnly, setClickableOnly] = useState(false)
  const [enabledOnly, setEnabledOnly] = useState(false)
  const [compressChains, setCompressChains] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const normalized = query.trim().toLocaleLowerCase()
  const tree = useMemo(
    () =>
      controller.uiTree
        ? hierarchyRoot(controller.uiTree.root, controller.uiTree.nodes)
        : null,
    [controller.uiTree],
  )

  const isResult = (node: AndroidUiNode) =>
    (!visibleOnly || node.visible_to_user) &&
    (!clickableOnly || node.clickable) &&
    (!enabledOnly || node.enabled) &&
    nodeMatches(node, normalized)
  const hierarchy = useMemo(() => {
    if (!tree) return null
    const visibleBranchIds = new Set<string>()
    const selectedBranchIds = new Set<string>()
    const result = (node: AndroidUiNode) =>
      (!visibleOnly || node.visible_to_user) &&
      (!clickableOnly || node.clickable) &&
      (!enabledOnly || node.enabled) &&
      nodeMatches(node, normalized)
    collectMatchingBranches(tree, result, visibleBranchIds)
    collectMatchingBranches(
      tree,
      (candidate) => candidate.node_id === controller.selectedUiNodeId,
      selectedBranchIds,
    )
    if (!visibleBranchIds.has(tree.node_id)) {
      return { root: null, selectedBranchIds, rowCount: 0 }
    }
    const root = buildCompressedHierarchy(tree, {
      compress: compressChains,
      includeNode: (node) => visibleBranchIds.has(node.node_id),
    })
    return { root, selectedBranchIds, rowCount: countCompressedRows(root) }
  }, [
    clickableOnly,
    compressChains,
    controller.selectedUiNodeId,
    enabledOnly,
    normalized,
    tree,
    visibleOnly,
  ])

  const toggleExpanded = (row: CompressedHierarchyRow) => {
    const terminal = row.chain.at(-1)
    if (!terminal) return
    const key = nodeFingerprint(terminal)
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  useEffect(() => {
    if (!controller.selectedUiNodeId) return
    const selected = scrollContainerRef.current?.querySelector<HTMLElement>(
      '[data-ui-node-selected="true"]',
    )
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [controller.selectedUiNodeId, hierarchy])

  return (
    <section className="android-hierarchy-panel" aria-label={ko.panels.uiTreeHierarchy}>
      <header className="android-editor-section-heading">
        <div>
          <strong>{ko.panels.uiTreeHierarchy}</strong>
          <small>
            {tree?.package_name ?? controller.uiTree?.package_name ?? '패키지 없음'}
          </small>
        </div>
        <span className="android-tree-heading-actions">
          <Button
            minimal
            small
            icon="download"
            text="다운로드"
            aria-label="UI 트리 JSON 다운로드"
            disabled={!controller.uiTree}
            onClick={() => {
              if (controller.uiTree) downloadUiTree(controller.uiTree)
            }}
          />
          <Button
            minimal
            small
            icon="refresh"
            aria-label="UI 트리 새로고침"
            loading={controller.uiTreeLoading}
            disabled={!controller.deviceId}
            onClick={() => void controller.refreshUiTree()}
          />
        </span>
      </header>
      <div className="android-tree-status">
        <span>노드 {controller.uiTree?.node_count ?? 0}개</span>
        {hierarchy?.root && <span>· 행 {hierarchy.rowCount}개</span>}
        <span>
          {controller.uiTree?.captured_at
            ? new Date(controller.uiTree.captured_at).toLocaleTimeString()
            : '캡처되지 않음'}
        </span>
        {controller.uiTree?.truncated && (
          <Tag intent="warning" minimal>
            일부 생략됨
          </Tag>
        )}
      </div>
      <input
        className="android-tree-search"
        aria-label="UI 트리 검색"
        value={query}
        placeholder="텍스트, 클래스, 뷰 ID 검색…"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="android-tree-filters">
        <label>
          <input
            type="checkbox"
            checked={visibleOnly}
            onChange={(event) => setVisibleOnly(event.currentTarget.checked)}
          />
          표시된 노드
        </label>
        <label>
          <input
            type="checkbox"
            checked={clickableOnly}
            onChange={(event) => setClickableOnly(event.currentTarget.checked)}
          />
          클릭 가능
        </label>
        <label>
          <input
            type="checkbox"
            checked={enabledOnly}
            onChange={(event) => setEnabledOnly(event.currentTarget.checked)}
          />
          활성화
        </label>
        <label className="android-tree-compression-toggle">
          <input
            type="checkbox"
            checked={compressChains}
            onChange={(event) => setCompressChains(event.currentTarget.checked)}
          />
          체인 압축
        </label>
      </div>
      <div
        ref={scrollContainerRef}
        className="android-hierarchy-scroll"
        onClick={(event) => {
          if (event.target === event.currentTarget) controller.setSelectedUiNodeId(null)
        }}
      >
        {controller.uiTreeLoading && !tree && (
          <div className="android-panel-empty">UI 트리 불러오는 중…</div>
        )}
        {controller.uiTreeError && (
          <Callout intent="warning" title="UI 트리를 사용할 수 없음">
            {controller.uiTreeError}
          </Callout>
        )}
        {hierarchy?.root && (
          <CompressedHierarchyRowView
            row={hierarchy.root}
            depth={0}
            expanded={expanded}
            searchActive={Boolean(normalized)}
            isResult={isResult}
            selectedBranchIds={hierarchy.selectedBranchIds}
            selectedNodeId={controller.selectedUiNodeId}
            onToggle={toggleExpanded}
            onSelect={controller.setSelectedUiNodeId}
            onHover={onHoverNode}
          />
        )}
        {!controller.uiTreeLoading && !controller.uiTreeError && !tree && (
          <div className="android-panel-empty">UI 트리 스냅샷이 없습니다.</div>
        )}
        {tree && !hierarchy?.root && (
          <div className="android-panel-empty">일치하는 UI 노드가 없습니다.</div>
        )}
      </div>
    </section>
  )
}

function CompressedHierarchyRowView({
  row,
  depth,
  expanded,
  searchActive,
  isResult,
  selectedBranchIds,
  selectedNodeId,
  onToggle,
  onSelect,
  onHover,
}: {
  row: CompressedHierarchyRow
  depth: number
  expanded: Set<string>
  searchActive: boolean
  isResult: (node: AndroidUiNode) => boolean
  selectedBranchIds: Set<string>
  selectedNodeId: string | null
  onToggle: (row: CompressedHierarchyRow) => void
  onSelect: (nodeId: string | null) => void
  onHover: (nodeId: string | null) => void
}) {
  const terminal = row.chain.at(-1)
  if (!terminal) return null
  const key = nodeFingerprint(terminal)
  const open =
    searchActive ||
    selectedBranchIds.has(row.terminalNodeId) ||
    (depth === 0 ? !expanded.has(key) : expanded.has(key))
  const rowLabel = row.chain.map((node) => nodeTitle(node)).join(' / ')
  return (
    <div className="android-hierarchy-branch">
      <div
        className="android-hierarchy-row android-compressed-hierarchy-row"
        style={{ paddingLeft: `${(depth * 14).toString()}px` }}
      >
        <button
          className="android-tree-chevron"
          type="button"
          aria-label={`${open ? '접기' : '펼치기'} ${rowLabel}`}
          disabled={row.children.length === 0}
          onClick={() => onToggle(row)}
        >
          {row.children.length ? (open ? '▾' : '▸') : '·'}
        </button>
        <div className="android-tree-chain" aria-label={rowLabel}>
          {row.chain.map((node, index) => {
            const content = node.text?.trim() || node.content_description?.trim()
            const selected = node.node_id === selectedNodeId
            const actionable = isActionableUiNode(node)
            const meaningful = isMeaningfulUiNode(node)
            return (
              <span key={node.node_id} className="android-tree-chain-item">
                {index > 0 && (
                  <span className="android-tree-chain-separator" aria-hidden="true">
                    /
                  </span>
                )}
                <button
                  className={[
                    'android-tree-segment',
                    selected ? 'is-selected' : '',
                    searchActive && isResult(node) ? 'is-search-match' : '',
                    actionable ? 'is-actionable' : '',
                    !actionable && !meaningful ? 'is-wrapper' : '',
                    !node.visible_to_user || !node.enabled ? 'is-muted' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  type="button"
                  data-ui-node-id={node.node_id}
                  data-ui-node-selected={selected ? 'true' : undefined}
                  title={`${node.class_name ?? 'Unknown class'}\nnode_id=${node.node_id}\nbounds=[${node.bounds.left}, ${node.bounds.top}, ${node.bounds.right}, ${node.bounds.bottom}]`}
                  onClick={() => onSelect(node.node_id)}
                  onMouseEnter={() => onHover(node.node_id)}
                  onMouseLeave={() => onHover(null)}
                >
                  <span>{shortClassName(node.class_name)}</span>
                  {content && (
                    <span className="android-tree-segment-preview">
                      “{content.length > 32 ? `${content.slice(0, 32)}…` : content}”
                    </span>
                  )}
                </button>
              </span>
            )
          })}
        </div>
        {row.children.length > 0 && (
          <span className="android-tree-child-count">{row.children.length}</span>
        )}
      </div>
      {open &&
        row.children.map((child) => (
          <CompressedHierarchyRowView
            key={child.id}
            row={child}
            depth={depth + 1}
            expanded={expanded}
            searchActive={searchActive}
            isResult={isResult}
            selectedBranchIds={selectedBranchIds}
            selectedNodeId={selectedNodeId}
            onToggle={onToggle}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
    </div>
  )
}

function UiNodeInspector({
  controller,
  node,
  frameWidth,
  frameHeight,
  macroCanvasAvailable,
  onAddFindElement,
}: {
  controller: AndroidDebugController
  node: AndroidUiNode | null
  frameWidth: number
  frameHeight: number
  macroCanvasAvailable: boolean
  onAddFindElement: () => void
}) {
  if (!node) {
    return (
      <section className="android-node-inspector" aria-label={ko.panels.nodeInspector}>
        <header className="android-editor-section-heading">
          <strong>{ko.panels.nodeInspector}</strong>
        </header>
        <div className="android-node-inspector-scroll">
          <div className="android-panel-empty">검사할 UI 노드를 선택하세요.</div>
          <UiNodeFindAction
            disabled
            macroCanvasAvailable={macroCanvasAvailable}
            onAddFindElement={onAddFindElement}
          />
        </div>
      </section>
    )
  }
  const { bounds } = node
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  const geometryMatches =
    controller.uiTree?.screen_width === frameWidth &&
    controller.uiTree.screen_height === frameHeight
  const inViewport =
    geometryMatches &&
    width > 0 &&
    height > 0 &&
    bounds.left >= 0 &&
    bounds.top >= 0 &&
    bounds.right <= frameWidth &&
    bounds.bottom <= frameHeight
  const centerX = (bounds.left + bounds.right) / 2
  const centerY = (bounds.top + bounds.bottom) / 2
  const fields = [
    { label: '노드 ID', value: node.node_id, code: true },
    { label: '부모', value: node.parent_id ?? '—', code: true },
    { label: '깊이', value: node.depth.toString(), code: true },
    { label: '클래스', value: node.class_name ?? '—', code: true },
    { label: '패키지', value: node.package_name ?? '—', code: true },
    { label: '텍스트', value: node.text ?? '—', code: false },
    { label: '설명', value: node.content_description ?? '—', code: false },
    { label: '뷰 ID', value: node.view_id_resource_name ?? '—', code: true },
    {
      label: '경계',
      value: `${bounds.left}, ${bounds.top} → ${bounds.right}, ${bounds.bottom}`,
      code: true,
    },
    { label: '크기', value: `${width} × ${height}`, code: true },
    {
      label: '중앙',
      value: `${centerX.toFixed(1)}, ${centerY.toFixed(1)}`,
      code: true,
    },
  ]
  const states = [
    ['clickable', node.clickable],
    ['enabled', node.enabled],
    ['focusable', node.focusable],
    ['focused', node.focused],
    ['selected', node.selected],
    ['checked', node.checked],
    ['checkable', node.checkable],
    ['scrollable', node.scrollable],
    ['editable', node.editable],
    ['visible', node.visible_to_user],
    ['password', node.password],
  ] as const
  return (
    <section className="android-node-inspector" aria-label={ko.panels.nodeInspector}>
      <header className="android-editor-section-heading">
        <div>
          <strong>{ko.panels.nodeInspector}</strong>
          <small>{nodeTitle(node)}</small>
        </div>
        {!inViewport && <Tag intent="warning">화면 밖</Tag>}
      </header>
      <div className="android-node-inspector-scroll">
        <dl className="android-node-fields">
          {fields.map(({ label, value, code }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={code ? 'code-text' : undefined} title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="android-node-state-flags">
          {states.map(([label, active]) => (
            <span key={label} className={active ? 'is-active' : ''}>
              {label}
            </span>
          ))}
        </div>
        <label className="android-selector-preview">
          <span>권장 선택자</span>
          <textarea readOnly rows={2} value={preferredSelector(node)} />
        </label>
        <UiNodeFindAction
          disabled={!macroCanvasAvailable}
          macroCanvasAvailable={macroCanvasAvailable}
          onAddFindElement={onAddFindElement}
        />
      </div>
    </section>
  )
}

function VisionInspector({
  controller,
  selectedDetection,
}: {
  controller: AndroidDebugController
  selectedDetection: VisionDetection | null
}) {
  const detections = controller.debug?.detections ?? []
  return (
    <section className="android-tab-inspector" aria-label="Vision Inspector">
      <header className="android-editor-section-heading">
        <strong>Detections</strong>
        <Tag minimal>{detections.length}</Tag>
      </header>
      <div className="android-detection-list">
        {detections.map((detection) => (
          <Button
            key={detection.id}
            minimal
            fill
            alignText="left"
            active={detection.id === controller.selectedDetectionId}
            onClick={() => controller.setSelectedDetectionId(detection.id)}
            onMouseEnter={() => controller.setHighlightedDetectionId(detection.id)}
            onMouseLeave={() => controller.setHighlightedDetectionId(null)}
          >
            <span>
              <strong>{detection.label}</strong>
              <small>
                x {detection.center.x.toFixed(0)} · y {detection.center.y.toFixed(0)}
              </small>
            </span>
            <Tag minimal>{(detection.confidence * 100).toFixed(1)}%</Tag>
          </Button>
        ))}
        {!detections.length && (
          <div className="android-panel-empty">아직 감지 결과가 없습니다.</div>
        )}
      </div>
      <div className="android-selected-detection">
        {selectedDetection
          ? `${selectedDetection.label} · bbox ${selectedDetection.bbox.x},${selectedDetection.bbox.y}, ${selectedDetection.bbox.width}×${selectedDetection.bbox.height}`
          : 'No detection selected.'}
      </div>
    </section>
  )
}

function MacroInspector({ controller }: { controller: AndroidDebugController }) {
  const { debug, status } = controller
  return (
    <section className="android-tab-inspector" aria-label="Macro Inspector">
      <header className="android-editor-section-heading">
        <strong>Macro / Debug State</strong>
        <Tag intent={macroIntent(debug?.macro.status)} minimal>
          {debug?.macro.status ?? 'IDLE'}
        </Tag>
      </header>
      <StateRows status={status} debug={debug} />
      <Divider />
      <section className="android-decision-debug">
        <h2>Decision</h2>
        <dl>
          <div>
            <dt>Classifier</dt>
            <dd>{pretty(debug?.decision.classifier)}</dd>
          </div>
          <div>
            <dt>VLM</dt>
            <dd>{pretty(debug?.decision.vlm)}</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>{pretty(debug?.decision.target)}</dd>
          </div>
          <div>
            <dt>Final action</dt>
            <dd>{pretty(debug?.decision.final_action)}</dd>
          </div>
          {debug?.decision.blocked_reason && (
            <div className="is-blocked">
              <dt>Blocked</dt>
              <dd>{debug.decision.blocked_reason}</dd>
            </div>
          )}
        </dl>
      </section>
    </section>
  )
}

export function AndroidConsolePanel({
  controller,
  selectedDetection,
  macroEvents,
}: {
  controller: AndroidDebugController
  selectedDetection: VisionDetection | null
  macroEvents: ReturnType<typeof useMacroRuntime>['events']
}) {
  const [tab, setTab] = useState<ConsoleTab>('user')
  const [dismissedUserEvents, setDismissedUserEvents] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [level, setLevel] = useState<UserDebugLevel>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [clearOnStart, setClearOnStart] = useState(true)
  const userLogBody = useRef<HTMLDivElement | null>(null)

  const userLogs = useMemo(() => {
    let lastRuntimeStart = -1
    if (clearOnStart) {
      for (let index = macroEvents.length - 1; index >= 0; index -= 1) {
        if (macroEvents[index]?.type === 'macro.runtime.started') {
          lastRuntimeStart = index
          break
        }
      }
    }
    return macroEvents
      .slice(lastRuntimeStart + 1)
      .filter(
        (event) =>
          event.type === 'macro.user_debug' && !dismissedUserEvents.has(event.event_id),
      )
      .slice(-500)
  }, [clearOnStart, dismissedUserEvents, macroEvents])

  const shownUserLogs = useMemo(
    () =>
      userLogs.filter((event) => level === 'all' || userDebugLevel(event) === level),
    [level, userLogs],
  )

  useEffect(() => {
    if (tab !== 'user' || !autoScroll || !userLogBody.current) return
    userLogBody.current.scrollTop = userLogBody.current.scrollHeight
  }, [autoScroll, shownUserLogs, tab])

  return (
    <Card
      className="android-console-panel"
      elevation={Elevation.ONE}
      data-workspace-region="bottom"
    >
      <header className="android-card-heading">
        <div>
          <span>{ko.panels.console}</span>
          <strong>
            {tab === 'system'
              ? ko.panels.system
              : tab === 'user'
                ? ko.panels.userDebug
                : tab === 'vision'
                  ? '비전'
                  : '매크로'}
          </strong>
        </div>
        <div className="android-console-tabs" role="tablist" aria-label="하단 패널">
          {(['system', 'user', 'vision', 'macro'] as const).map((value) => (
            <Button
              key={value}
              minimal
              small
              active={tab === value}
              role="tab"
              aria-selected={tab === value}
              text={
                value === 'system'
                  ? `${ko.panels.system} (${controller.events.length.toString()})`
                  : value === 'user'
                    ? `${ko.panels.userDebug} (${userLogs.length.toString()})`
                    : value === 'vision'
                      ? '비전'
                      : '매크로'
              }
              onClick={() => setTab(value)}
            />
          ))}
        </div>
      </header>
      <div className="android-console-content">
        {tab === 'system' && (
          <div className="android-event-list">
            {controller.events.length ? (
              controller.events.map((event) => (
                <div key={event.id} className={`android-event-row is-${event.status}`}>
                  <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                  <Tag minimal>{event.category}</Tag>
                  <span>{event.message}</span>
                  <small>
                    {event.latency_ms === null
                      ? event.status
                      : `${event.latency_ms.toFixed(1)} ms`}
                  </small>
                </div>
              ))
            ) : (
              <div className="android-panel-empty">아직 디버그 이벤트가 없습니다.</div>
            )}
          </div>
        )}
        {tab === 'vision' && (
          <VisionInspector
            controller={controller}
            selectedDetection={selectedDetection}
          />
        )}
        {tab === 'macro' && (
          <div className="android-macro-events-tab">
            <MacroEventLog events={macroEvents} />
            <MacroInspector controller={controller} />
          </div>
        )}
        {tab === 'user' && (
          <section className="user-debug-console" aria-label="사용자 디버그 콘솔">
            <header className="user-debug-console__toolbar">
              <select
                aria-label="사용자 디버그 레벨"
                value={level}
                onChange={(event) => setLevel(event.target.value as UserDebugLevel)}
              >
                <option value="all">모든 레벨</option>
                <option value="debug">디버그</option>
                <option value="info">정보</option>
                <option value="warning">경고</option>
                <option value="error">오류</option>
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(event) => setAutoScroll(event.target.checked)}
                />
                자동 스크롤
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={clearOnStart}
                  onChange={(event) => setClearOnStart(event.target.checked)}
                />
                실행 시 비우기
              </label>
              <Button
                small
                minimal
                icon="trash"
                onClick={() =>
                  setDismissedUserEvents((current) => {
                    const next = new Set(current)
                    userLogs.forEach((event) => next.add(event.event_id))
                    return next
                  })
                }
              >
                지우기
              </Button>
            </header>
            <div className="user-debug-console__body" ref={userLogBody}>
              {shownUserLogs.length > 0 ? (
                shownUserLogs.map((event) => {
                  const eventLevel = userDebugLevel(event)
                  return (
                    <div
                      key={event.event_id}
                      className={`user-debug-row is-${eventLevel}`}
                    >
                      <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                      <Tag minimal intent={userDebugIntent(eventLevel)}>
                        {eventLevel}
                      </Tag>
                      <span>{userDebugMessage(event)}</span>
                      <small title={event.runtime_id}>{event.node_id ?? 'debug'}</small>
                    </div>
                  )
                })
              ) : (
                <div className="android-panel-empty">
                  아직 사용자 디버그 출력이 없습니다.
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </Card>
  )
}

function userDebugLevel(event: MacroRuntimeEvent): Exclude<UserDebugLevel, 'all'> {
  const level = event.payload.level
  return level === 'debug' || level === 'warning' || level === 'error' ? level : 'info'
}

function userDebugMessage(event: MacroRuntimeEvent) {
  return typeof event.payload.message === 'string' ? event.payload.message : ''
}

function userDebugIntent(level: Exclude<UserDebugLevel, 'all'>) {
  if (level === 'warning') return 'warning' as const
  if (level === 'error') return 'danger' as const
  if (level === 'info') return 'primary' as const
  return 'none' as const
}

function StateRows({
  status,
  debug,
}: {
  status: AndroidDebugController['status']
  debug: AndroidDebugState | null
}) {
  const rows = [
    ['Current state', debug?.state.current ?? 'unknown'],
    ['Previous state', debug?.state.previous ?? '—'],
    ['Confidence', `${((debug?.state.confidence ?? 0) * 100).toFixed(1)}%`],
    ['Detector results', (debug?.detections.length ?? 0).toString()],
    ['Macro ID', debug?.macro.id ?? '—'],
    ['Step index', (debug?.macro.step_index ?? 0).toString()],
    ['Last action', pretty(debug?.last_action)],
    ['Action result', pretty(debug?.last_action_result)],
    ['Accessibility', status?.agent?.accessibility_enabled ? 'Enabled' : 'Disabled'],
    ['Capture', status?.agent?.capture_ready ? 'Ready' : 'Not ready'],
    ['Remote control', status?.agent?.remote_control_enabled ? 'Enabled' : 'Disabled'],
    ['Rotation', `${status?.agent?.device.rotation ?? 0}°`],
    ['Agent version', status?.agent?.agent_version ?? '—'],
  ]
  return (
    <dl className="android-state-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
