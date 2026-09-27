import type { AndroidUiTree } from '../../types/android-debug'

export interface UiTreeDownloadArtifact {
  filename: string
  json: string
}

function filenameSegment(value: string | null, fallback: string): string {
  const normalized = value
    ?.trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return normalized || fallback
}

function filenameTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'snapshot'
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

export function createUiTreeDownload(
  tree: AndroidUiTree,
): UiTreeDownloadArtifact {
  const device = filenameSegment(tree.device_id, 'device')
  const packageName = filenameSegment(tree.package_name, 'unknown-package')
  const capturedAt = filenameTimestamp(tree.captured_at)
  return {
    filename: `tapbot-ui-tree-${device}-${packageName}-${capturedAt}.json`,
    json: `${JSON.stringify(tree, null, 2)}\n`,
  }
}

export function downloadUiTree(tree: AndroidUiTree): void {
  const artifact = createUiTreeDownload(tree)
  const objectUrl = URL.createObjectURL(
    new Blob([artifact.json], { type: 'application/json;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = artifact.filename
  link.hidden = true
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  }
}
