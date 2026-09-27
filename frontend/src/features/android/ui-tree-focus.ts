import type { AndroidUiBounds, AndroidUiNode } from '../../types/android-debug'

function boundsArea(bounds: AndroidUiBounds): number {
  return (
    Math.max(0, bounds.right - bounds.left) * Math.max(0, bounds.bottom - bounds.top)
  )
}

function containsPoint(bounds: AndroidUiBounds, x: number, y: number): boolean {
  return (
    bounds.right > bounds.left &&
    bounds.bottom > bounds.top &&
    x >= bounds.left &&
    x < bounds.right &&
    y >= bounds.top &&
    y < bounds.bottom
  )
}

/** Resolve overlapping accessibility nodes by depth, then by tighter bounds. */
export function findDeepestUiNodeAtPoint(
  nodes: readonly AndroidUiNode[],
  x: number,
  y: number,
): AndroidUiNode | null {
  return (
    nodes
      .filter((node) => node.visible_to_user && containsPoint(node.bounds, x, y))
      .sort(
        (left, right) =>
          right.depth - left.depth ||
          boundsArea(left.bounds) - boundsArea(right.bounds),
      )[0] ?? null
  )
}

export function scaleUiBounds(
  bounds: AndroidUiBounds,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): AndroidUiBounds | null {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return null
  }
  const scaleX = targetWidth / sourceWidth
  const scaleY = targetHeight / sourceHeight
  return {
    left: bounds.left * scaleX,
    top: bounds.top * scaleY,
    right: bounds.right * scaleX,
    bottom: bounds.bottom * scaleY,
  }
}

export function framePointToUiTreePoint(
  point: { x: number; y: number },
  frameWidth: number,
  frameHeight: number,
  treeWidth: number,
  treeHeight: number,
): { x: number; y: number } | null {
  if (frameWidth <= 0 || frameHeight <= 0 || treeWidth <= 0 || treeHeight <= 0) {
    return null
  }
  return {
    x: point.x * (treeWidth / frameWidth),
    y: point.y * (treeHeight / frameHeight),
  }
}

function sameNonEmpty(left: string | null, right: string | null): boolean {
  return Boolean(left && right && left === right)
}

function centerDistance(left: AndroidUiNode, right: AndroidUiNode): number {
  const leftX = (left.bounds.left + left.bounds.right) / 2
  const leftY = (left.bounds.top + left.bounds.bottom) / 2
  const rightX = (right.bounds.left + right.bounds.right) / 2
  const rightY = (right.bounds.top + right.bounds.bottom) / 2
  return Math.hypot(leftX - rightX, leftY - rightY)
}

/**
 * Keep selection through refreshed snapshots. Node ids/paths are preferred as
 * a hint, while stable accessibility fields and nearby bounds provide a
 * fallback when an agent rebuilds the tree with new ids.
 */
export function restoreUiNodeSelection(
  previous: AndroidUiNode,
  nextNodes: readonly AndroidUiNode[],
): AndroidUiNode | null {
  const samePath = nextNodes.find((node) => node.node_id === previous.node_id)
  if (samePath) return samePath

  const candidates = nextNodes.filter((node) => {
    const hasSemanticMatch =
      sameNonEmpty(node.view_id_resource_name, previous.view_id_resource_name) ||
      sameNonEmpty(node.content_description, previous.content_description) ||
      sameNonEmpty(node.text, previous.text)
    return (
      hasSemanticMatch ||
      (node.class_name === previous.class_name && node.depth === previous.depth)
    )
  })
  const score = (node: AndroidUiNode) =>
    (sameNonEmpty(node.view_id_resource_name, previous.view_id_resource_name)
      ? 120
      : 0) +
    (sameNonEmpty(node.content_description, previous.content_description) ? 100 : 0) +
    (sameNonEmpty(node.text, previous.text) ? 80 : 0) +
    (node.class_name === previous.class_name ? 20 : 0) +
    (node.depth === previous.depth ? 10 : 0)

  return (
    candidates.sort(
      (left, right) =>
        score(right) - score(left) ||
        centerDistance(left, previous) - centerDistance(right, previous),
    )[0] ?? null
  )
}

/** Stable editor payload: semantic text plus snapshot path as a disambiguation hint. */
export function uiNodeSelectorHint(node: AndroidUiNode): Record<string, string | boolean> {
  return {
    text: node.text ?? '',
    ui_tree_path: node.node_id,
  }
}
