import { useEffect, useMemo, useState } from 'react'
import { list, object, text } from '@/lib/jsonGuards'
import { useWorkspaceKit } from './workspaceKit'
import type { AnyLayout, AnyToolbar } from './workspaceLayoutSchema'

type WorkspaceToolbar = AnyToolbar
type RibbonTool = string
export type RibbonTab = WorkspaceToolbar['groups'][number]
export type RibbonSection = NonNullable<RibbonTab['sections']>[number] & { preferenceKey?: string }
export const groupKey = (section: RibbonSection) => section.preferenceKey ?? section.label

/** Occurrences distinguish groups that share a caption, including after a personal reorder. */
function identifyGroups<T extends WorkspaceToolbar>(toolbar: T): T {
  return {
    ...toolbar,
    groups: toolbar.groups.map((tab) => {
      if (!tab.sections) return tab
      const occurrences = new Map<string, number>()
      return {
        ...tab,
        sections: tab.sections.map((section) => {
          const occurrence = occurrences.get(section.label) ?? 0
          occurrences.set(section.label, occurrence + 1)
          return { ...section, preferenceKey: JSON.stringify([section.label, occurrence]) }
        }),
      }
    }),
  }
}
/** Each tool keeps its own arrangements: `pgmaps-road-ribbon-order:<layout>`, `pgmaps-visuals-…`. */
const storageKey = (storage: string, layoutId: string) => `pgmaps-${storage}-ribbon-order:${layoutId}`
/** The tabs' order lives under its own key, so arrangements saved before tabs could move still read. */
const tabOrderKey = (storage: string, layoutId: string) => `pgmaps-${storage}-ribbon-tabs:${layoutId}`
type Preferences = { tab: string; order?: string[]; sections: { label: string; items: string[]; more: string[] }[] }[]

const names = (value: unknown, label: string) => list(value, label).map((name) => text(name, label, 400))

/** A personal ribbon arrangement from browser storage. Anything malformed resets to the served layout. */
function parsePreferences(raw: string | null): Preferences {
  if (!raw) return []
  try {
    return list(JSON.parse(raw), 'Ribbon preferences', 100).map((entry) => {
      const tab = object(entry, 'Ribbon tab')
      return {
        tab: text(tab.tab, 'Ribbon tab name'),
        ...(tab.order === undefined ? {} : { order: names(tab.order, 'Ribbon group order') }),
        sections: list(tab.sections, 'Ribbon groups', 100).map((value) => {
          const section = object(value, 'Ribbon group')
          return {
            label: text(section.label, 'Ribbon group name'),
            items: names(section.items, 'Ribbon group tools'),
            more: names(section.more, 'Ribbon group settings'),
          }
        }),
      }
    })
  } catch {
    return []
  }
}

function readPreferences(storage: string, id: string) {
  try {
    return parsePreferences(localStorage.getItem(storageKey(storage, id)))
  } catch {
    return []
  }
}

function readTabOrder(storage: string, id: string): string[] {
  try {
    const raw = localStorage.getItem(tabOrderKey(storage, id))
    return raw ? names(JSON.parse(raw), 'Ribbon tab order').slice(0, 100) : []
  } catch {
    return []
  }
}

/** Move one entry of a list to another place, as a drag across the tab row does. */
export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list]
  const result = [...list]
  const [moved] = result.splice(from, 1)
  result.splice(to, 0, moved)
  return result
}

/**
 * The tabs in a saved order. Names the served layout no longer has are dropped; tabs it gained keep
 * their served place relative to the tab before them, so a new tab does not land at the end.
 */
export function orderTabs<T extends WorkspaceToolbar>(toolbar: T, order: readonly string[]): T {
  if (!order.length) return toolbar
  const byLabel = new Map(toolbar.groups.map((tab) => [tab.label, tab]))
  const groups = order.flatMap((label) => {
    const tab = byLabel.get(label)
    byLabel.delete(label)
    return tab ? [tab] : []
  })
  toolbar.groups.forEach((tab, index) => {
    if (!byLabel.has(tab.label)) return
    const before = toolbar.groups[index - 1]
    const at = before ? groups.indexOf(before) + 1 : 0
    groups.splice(at, 0, tab)
  })
  return sameOrder(
    groups.map((tab) => tab.label),
    toolbar.groups.map((tab) => tab.label),
  )
    ? toolbar
    : { ...toolbar, groups }
}

/** The tab order to store: nothing when it is the served one, so a later served change still applies. */
export function tabOrderFor(base: WorkspaceToolbar, draft: WorkspaceToolbar): string[] {
  const order = draft.groups.map((tab) => tab.label)
  return sameOrder(
    order,
    base.groups.map((tab) => tab.label),
  )
    ? []
    : order
}

function sameOrder(a: readonly string[] = [], b: readonly string[] = []) {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

/** Store only groups the user touched. The hosted catalog still owns membership and field behavior. */
function preferencesFor(base: WorkspaceToolbar, draft: WorkspaceToolbar): Preferences {
  return draft.groups.flatMap((tab) => {
    const original = base.groups.find((group) => group.label === tab.label)?.sections
    if (!original || !tab.sections) return []
    const order = tab.sections.map(groupKey)
    const reordered = !sameOrder(order, original.map(groupKey))
    const sections = tab.sections.flatMap((section) => {
      const source = original.find((candidate) => groupKey(candidate) === groupKey(section))
      if (!source || (sameOrder(source.items, section.items) && sameOrder(source.more, section.more))) return []
      return [{ label: groupKey(section), items: section.items, more: section.more ?? [] }]
    })
    return reordered || sections.length ? [{ tab: tab.label, order: reordered ? order : undefined, sections }] : []
  })
}

function reconcileSection(source: RibbonSection, saved: Preferences[number]['sections'][number]): RibbonSection {
  const available = new Set<RibbonTool>([...source.items, ...(source.more ?? [])])
  const valid = (id: string): id is RibbonTool => available.has(id as RibbonTool)
  const savedMore = new Set(saved.more)
  const items = [...new Set([...saved.items.filter(valid), ...source.items.filter((id) => !savedMore.has(id))])]
  const more = [...new Set([...saved.more.filter(valid), ...(source.more ?? [])])].filter((id) => !items.includes(id))
  return {
    ...source,
    items,
    more,
    primary: source.primary && items.includes(source.primary) ? source.primary : undefined,
  }
}

function applyPreferences<T extends WorkspaceToolbar>(toolbar: T, prefs: Preferences): T {
  if (!prefs.length) return toolbar
  return {
    ...toolbar,
    groups: toolbar.groups.map((tab) => {
      const saved = prefs.find((entry) => entry.tab === tab.label)
      if (!saved || !tab.sections) return tab
      const sections = tab.sections.map((section) => {
        const edit = saved.sections.find((candidate) => candidate.label === groupKey(section))
        return edit ? reconcileSection(section, edit) : section
      })
      if (saved.order) {
        const sequence = new Map(saved.order.map((label, index) => [label, index]))
        const last = saved.order.length
        sections.sort((a, b) => (sequence.get(groupKey(a)) ?? last) - (sequence.get(groupKey(b)) ?? last))
      }
      return { ...tab, sections }
    }),
  }
}

const read = (storage: string, id: string) => ({
  id,
  prefs: readPreferences(storage, id),
  tabs: readTabOrder(storage, id),
})

export function useRibbonPreferences<L extends AnyLayout>(layout: L) {
  const { storage } = useWorkspaceKit()
  const [entry, setEntry] = useState(() => read(storage, layout.id))
  if (entry.id !== layout.id) setEntry(read(storage, layout.id))
  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (
        event.key === storageKey(storage, layout.id) ||
        event.key === tabOrderKey(storage, layout.id) ||
        event.key === null
      ) {
        setEntry(read(storage, layout.id))
      }
    }
    window.addEventListener('storage', receive)
    return () => window.removeEventListener('storage', receive)
  }, [storage, layout.id])
  type Toolbar = NonNullable<L['toolbar']>
  const defaults = useMemo(
    () => (layout.toolbar ? identifyGroups(layout.toolbar as Toolbar) : undefined),
    [layout.toolbar],
  )
  const toolbar = useMemo(() => {
    if (!defaults) return defaults
    const current = entry.id === layout.id ? entry : { prefs: [], tabs: [] }
    return orderTabs(applyPreferences(defaults, current.prefs), current.tabs)
  }, [defaults, layout.id, entry])

  function store(key: string, value: unknown[]) {
    if (value.length) localStorage.setItem(key, JSON.stringify(value))
    else localStorage.removeItem(key)
  }

  function save(draft: WorkspaceToolbar) {
    if (!defaults) return
    const prefs = preferencesFor(defaults, draft)
    const tabs = tabOrderFor(defaults, draft)
    setEntry({ id: layout.id, prefs, tabs })
    try {
      store(storageKey(storage, layout.id), prefs)
      store(tabOrderKey(storage, layout.id), tabs)
      return true
    } catch {
      return false
    }
  }

  /** Reorder the tabs alone, as a drag across the tab row does; each group's own arrangement stays. */
  function reorderTabs(order: readonly string[]) {
    if (!defaults) return
    const tabs = tabOrderFor(defaults, orderTabs(defaults, order))
    setEntry((previous) => ({ ...previous, id: layout.id, tabs }))
    try {
      store(tabOrderKey(storage, layout.id), tabs)
      return true
    } catch {
      return false
    }
  }
  return { defaults, toolbar, save, reorderTabs }
}
