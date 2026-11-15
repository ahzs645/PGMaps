/**
 * The map's camera keys (N, U, R and ?) and the shortcut list the `?` sheet prints. The key
 * reading takes a plain event shape so the tests need no DOM.
 */

export type MapCameraAction = 'north' | 'topDown' | 'reset' | 'help'

export interface KeyLike {
  key: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  repeat?: boolean
  defaultPrevented?: boolean
  isComposing?: boolean
}

const ACTIONS: Readonly<Record<string, MapCameraAction>> = {
  n: 'north',
  u: 'topDown',
  r: 'reset',
  '?': 'help',
}

/**
 * The camera action a key press asks for, or null. Presses with Ctrl, Cmd or Alt belong to the
 * browser and the page (Cmd+R reloads), and so does a press another handler already took.
 */
export function mapCameraAction(event: KeyLike): MapCameraAction | null {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return null
  if (event.repeat) return null
  return ACTIONS[event.key.length === 1 ? event.key.toLowerCase() : event.key] ?? null
}

/** The parts of an event target this module reads; an `Element` satisfies it. */
export interface TargetLike {
  tagName?: string
  isContentEditable?: boolean
  closest?: (selector: string) => unknown
}

/** True when keys typed at `target` are text or belong to a dialog, a menu or a listbox. */
export function keyBelongsElsewhere(target: TargetLike | null | undefined): boolean {
  if (!target) return false
  const tag = target.tagName?.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return Boolean(
    target.closest?.(
      '[contenteditable=""], [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], [role="textbox"]',
    ),
  )
}

/** Every map's keys, in the order the shortcut sheet lists them. */
export const MAP_SHORTCUTS: ReadonlyArray<{ group: string; keys: string[]; action: string }> = [
  { group: 'Camera', keys: ['N'], action: 'Turn north up' },
  { group: 'Camera', keys: ['U'], action: 'Look straight down' },
  { group: 'Camera', keys: ['R'], action: 'Back to where the map started' },
  { group: 'Camera', keys: ['Right-drag'], action: 'Turn and tilt' },
  { group: 'Camera', keys: ['Ctrl', 'Drag'], action: 'Turn and tilt (one-button mouse or trackpad)' },
  { group: 'Camera', keys: ['Shift', '←', '→'], action: 'Turn' },
  { group: 'Camera', keys: ['Shift', '↑', '↓'], action: 'Tilt' },
  { group: 'Move and zoom', keys: ['Drag'], action: 'Pan' },
  { group: 'Move and zoom', keys: ['←', '↑', '→', '↓'], action: 'Pan (after clicking the map)' },
  { group: 'Move and zoom', keys: ['Scroll'], action: 'Zoom' },
  { group: 'Move and zoom', keys: ['+', '−'], action: 'Zoom in or out (after clicking the map)' },
  { group: 'Move and zoom', keys: ['Double-click'], action: 'Zoom in' },
  { group: 'Move and zoom', keys: ['Shift', 'Drag'], action: 'Zoom to a box' },
  { group: 'Map menu', keys: ['Right-click'], action: 'Coordinates, copy, what’s here, colour vision' },
  { group: 'Map menu', keys: ['Long-press'], action: 'The same menu on a touch screen' },
  { group: 'Map menu', keys: ['?'], action: 'This list' },
]
