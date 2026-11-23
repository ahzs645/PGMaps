import type { KeyboardEvent } from 'react'

/**
 * `VirtualResultList` moves between rows on the arrow keys, Home and End wherever focus is in a row. A row that holds
 * its own fields (a dropdown, a number, a date, a note) wraps them in an element with this `onKeyDown`, so those keys
 * stay with the field: a select opens, a caret moves, a date steps.
 */
export function keepFieldKeysInRow(event: KeyboardEvent<HTMLElement>) {
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, select, [role="combobox"], [contenteditable="true"]')) event.stopPropagation()
}
