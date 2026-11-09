/**
 * Undo and redo keys, read the way each platform's own apps read them: ⌘Z / ⇧⌘Z on Apple
 * devices, Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) elsewhere. Ctrl on a Mac and the Windows key on a
 * PC are left alone, since neither means undo there.
 */
export type HistoryAction = 'undo' | 'redo'

type KeyInput = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

export function historyShortcut(event: KeyInput, apple: boolean): HistoryAction | null {
  if (event.altKey || !(apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return null
  const key = event.key.toLowerCase()
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && !apple && !event.shiftKey) return 'redo'
  return null
}

/** Shortcut text for titles and `aria-keyshortcuts`. */
export function historyShortcutLabels(apple: boolean) {
  return apple
    ? { undo: '⌘Z', redo: '⇧⌘Z', undoAria: 'Meta+Z', redoAria: 'Meta+Shift+Z' }
    : { undo: 'Ctrl+Z', redo: 'Ctrl+Y', undoAria: 'Control+Z', redoAria: 'Control+Y Control+Shift+Z' }
}

export function isApplePlatform(nav: { platform?: string; userAgentData?: { platform?: string } } = navigator) {
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || '')
}

/** Text fields keep their own undo; the shortcut is the road's only outside them. */
export function keepsNativeUndo(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  if (target.closest('[contenteditable=""], [contenteditable="true"], textarea, select')) return true
  if (target instanceof HTMLInputElement)
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type)
  // A dialog over the workspace owns the keyboard; undoing the road behind it would be invisible.
  return !!target.closest('[role="dialog"], [role="alertdialog"]')
}
