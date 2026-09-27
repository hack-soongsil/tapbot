// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AndroidUiTree } from '../../types/android-debug'
import { createUiTreeDownload, downloadUiTree } from './ui-tree-download'

const originalCreateObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  'createObjectURL',
)
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  'revokeObjectURL',
)

function snapshot(overrides: Partial<AndroidUiTree> = {}): AndroidUiTree {
  const root = {
    node_id: 'root',
    parent_id: null,
    depth: 0,
    class_name: 'android.widget.FrameLayout',
    text: null,
    content_description: null,
    view_id_resource_name: null,
    package_name: 'com.example.app',
    bounds: { left: 0, top: 0, right: 1080, bottom: 2280 },
    clickable: false,
    enabled: true,
    focusable: false,
    focused: false,
    selected: false,
    checked: false,
    checkable: false,
    scrollable: false,
    editable: false,
    visible_to_user: true,
    password: false,
    child_count: 0,
    children: [],
  }
  return {
    ok: true,
    request_id: 'request-1',
    device_id: 'note 10/test',
    source_id: 'android-agent',
    captured_at: '2026-09-27T09:15:30.123Z',
    package_name: 'com.example.app',
    window_title: 'Example',
    rotation: 0,
    screen_width: 1080,
    screen_height: 2280,
    node_count: 1,
    truncated: false,
    root,
    nodes: [root],
    ...overrides,
  }
}

describe('UI tree download artifact', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL')
    }
    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })

  it('creates a safe timestamped JSON filename and preserves the full snapshot', () => {
    const tree = snapshot()
    const artifact = createUiTreeDownload(tree)

    expect(artifact.filename).toBe(
      'tapbot-ui-tree-note-10-test-com.example.app-20260927T091530Z.json',
    )
    expect(JSON.parse(artifact.json)).toEqual(tree)
    expect(artifact.json.endsWith('\n')).toBe(true)
  })

  it('uses stable fallbacks for missing package and invalid capture time', () => {
    const artifact = createUiTreeDownload(
      snapshot({ package_name: null, captured_at: 'invalid' }),
    )

    expect(artifact.filename).toBe(
      'tapbot-ui-tree-note-10-test-unknown-package-snapshot.json',
    )
  })

  it('clicks a temporary JSON download and revokes its object URL', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:ui-tree')
    const revokeObjectURL = vi.fn<(url: string) => void>(() => undefined)
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    const downloads: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download)
      expect(this.href).toBe('blob:ui-tree')
    })

    downloadUiTree(snapshot())

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(createObjectURL.mock.calls[0]?.[0].type).toBe(
      'application/json;charset=utf-8',
    )
    expect(downloads).toEqual([
      'tapbot-ui-tree-note-10-test-com.example.app-20260927T091530Z.json',
    ])
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:ui-tree')
  })
})
