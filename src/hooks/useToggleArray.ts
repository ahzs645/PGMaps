import { useCallback } from 'react'

export function toggleArrayItem<T>(items: readonly T[], item: T): T[] {
  return items.includes(item) ? items.filter((current) => current !== item) : [...items, item]
}

/**
 * Returns a stable callback that toggles an item's membership in a controlled
 * array prop, e.g. multi-select filter chips in map sidebars.
 */
export function useToggleArray<T>(items: readonly T[], onChange: (next: T[]) => void): (item: T) => void {
  return useCallback((item: T) => onChange(toggleArrayItem(items, item)), [items, onChange])
}
