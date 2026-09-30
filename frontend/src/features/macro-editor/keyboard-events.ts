export function isImeKeyboardEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('input, textarea, select, [contenteditable="true"]') !== null
}
