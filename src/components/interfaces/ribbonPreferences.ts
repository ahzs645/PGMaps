import { useEffect, useMemo, useState } from 'react'
import { list, object, text } from '@/lib/jsonGuards'
import type { WorkspaceLayout, WorkspaceToolbar } from './workspaceLayouts'
import type { RibbonTool } from './ribbonToolCatalog'

export type RibbonTab = WorkspaceToolbar['groups'][number]
export type RibbonSection = NonNullable<RibbonTab['sections']>[number] & { preferenceKey?: string }
export const groupKey = (section: RibbonSection) => section.preferenceKey ?? section.label

/** Occurrences distinguish groups that share a caption, including after a personal reorder. */
function identifyGroups(toolbar: WorkspaceToolbar): WorkspaceToolbar {
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
const storageKey = (layoutId: string) => `pgmaps-road-ribbon-order:${layoutId}`
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

function readPreferences(id: string) {
  try {
    return parsePreferences(localStorage.getItem(storageKey(id)))
  } catch {
    return []
  }
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

function applyPreferences(toolbar: WorkspaceToolbar, prefs: Preferences): WorkspaceToolbar {
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

export function useRibbonPreferences(layout: WorkspaceLayout) {
  const [entry, setEntry] = useState(() => ({ id: layout.id, prefs: readPreferences(layout.id) }))
  if (entry.id !== layout.id) setEntry({ id: layout.id, prefs: readPreferences(layout.id) })
  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (event.key === storageKey(layout.id) || event.key === null) {
        setEntry({ id: layout.id, prefs: readPreferences(layout.id) })
      }
    }
    window.addEventListener('storage', receive)
    return () => window.removeEventListener('storage', receive)
  }, [layout.id])
  const defaults = useMemo(() => layout.toolbar && identifyGroups(layout.toolbar), [layout.toolbar])
  const toolbar = useMemo(
    () => defaults && applyPreferences(defaults, entry.id === layout.id ? entry.prefs : []),
    [defaults, layout.id, entry],
  )

  function save(draft: WorkspaceToolbar) {
    if (!defaults) return
    const prefs = preferencesFor(defaults, draft)
    setEntry({ id: layout.id, prefs })
    try {
      if (prefs.length) localStorage.setItem(storageKey(layout.id), JSON.stringify(prefs))
      else localStorage.removeItem(storageKey(layout.id))
      return true
    } catch {
      return false
    }
  }
  return { defaults, toolbar, save }
}
