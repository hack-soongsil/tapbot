export const TAPBOT_OVERLAY_ROOT_ID = 'tapbot-overlay-root'

export function getTapbotOverlayRoot(): HTMLElement {
  const existing = document.getElementById(TAPBOT_OVERLAY_ROOT_ID)
  if (existing) return existing

  const root = document.createElement('div')
  root.id = TAPBOT_OVERLAY_ROOT_ID
  document.body.appendChild(root)
  return root
}
