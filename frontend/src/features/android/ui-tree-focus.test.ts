import { describe, expect, it } from 'vitest'
import type { AndroidUiNode } from '../../types/android-debug'
import {
  findDeepestUiNodeAtPoint,
  framePointToUiTreePoint,
  restoreUiNodeSelection,
  scaleUiBounds,
  uiNodeSelectorHint,
} from './ui-tree-focus'

function uiNode(
  id: string,
  depth: number,
  bounds: AndroidUiNode['bounds'],
  visible = true,
): AndroidUiNode {
  return {
    node_id: id,
    parent_id: null,
    depth,
    class_name: 'android.view.View',
    text: null,
    content_description: null,
    view_id_resource_name: null,
    package_name: 'test',
    bounds,
    clickable: false,
    enabled: true,
    focusable: false,
    focused: false,
    selected: false,
    checked: false,
    checkable: false,
    scrollable: false,
    editable: false,
    visible_to_user: visible,
    password: false,
    child_count: 0,
    children: [],
  }
}

describe('UI tree live-screen focus mapping', () => {
  it('selects the deepest visible node containing the device point', () => {
    const nodes = [
      uiNode('root', 0, { left: 0, top: 0, right: 200, bottom: 100 }),
      uiNode('child', 1, { left: 20, top: 10, right: 180, bottom: 90 }),
      uiNode('deep', 2, { left: 40, top: 20, right: 160, bottom: 80 }),
      uiNode('hidden', 3, { left: 50, top: 30, right: 150, bottom: 70 }, false),
    ]

    expect(findDeepestUiNodeAtPoint(nodes, 100, 50)?.node_id).toBe('deep')
    expect(findDeepestUiNodeAtPoint(nodes, 199, 99)?.node_id).toBe('root')
    expect(findDeepestUiNodeAtPoint(nodes, 250, 50)).toBeNull()
  })

  it('uses tighter bounds when overlapping nodes have the same depth', () => {
    const nodes = [
      uiNode('wide', 1, { left: 0, top: 0, right: 200, bottom: 100 }),
      uiNode('tight', 1, { left: 90, top: 40, right: 110, bottom: 60 }),
    ]
    expect(findDeepestUiNodeAtPoint(nodes, 100, 50)?.node_id).toBe('tight')
  })

  it('maps bounds and points between UI-tree and rendered frame geometries', () => {
    expect(
      scaleUiBounds({ left: 20, top: 10, right: 100, bottom: 50 }, 200, 100, 400, 300),
    ).toEqual({ left: 40, top: 30, right: 200, bottom: 150 })
    expect(framePointToUiTreePoint({ x: 200, y: 150 }, 400, 300, 200, 100)).toEqual({
      x: 100,
      y: 50,
    })
  })

  it('restores a refreshed selection by path, then semantics and nearest bounds', () => {
    const previous = {
      ...uiNode('old-path', 2, { left: 80, top: 40, right: 120, bottom: 60 }),
      text: '예약',
    }
    const samePath = { ...previous, text: '예약 처리 중' }
    expect(restoreUiNodeSelection(previous, [samePath])).toBe(samePath)

    const far = {
      ...previous,
      node_id: 'new-far',
      bounds: { left: 0, top: 0, right: 40, bottom: 20 },
    }
    const near = { ...previous, node_id: 'new-near' }
    expect(restoreUiNodeSelection(previous, [far, near])?.node_id).toBe('new-near')
  })

  it('builds the same text and tree-path hint for Find and Click Element actions', () => {
    const selected = {
      ...uiNode('n0.1.2', 2, { left: 10, top: 10, right: 50, bottom: 30 }),
      text: '예약하기',
    }
    expect(uiNodeSelectorHint(selected)).toEqual({
      text: '예약하기',
      ui_tree_path: 'n0.1.2',
    })
  })
})
