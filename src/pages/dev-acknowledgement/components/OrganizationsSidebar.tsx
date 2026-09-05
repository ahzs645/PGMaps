import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import { organizations } from '../organizations'

const humanize = (value: string) => value.replace(/[_-]+/g, ' ')

type OrganizationsSidebarProps = {
  /** Currently previewed org id (highlighted in the list). */
  selectedId: string | null
  /** Load an org's campuses onto the map for preview/comparison. */
  onSelect: (id: string) => void
}

/** Preset library of documented organizations — click one to preview it on the map. */
export function OrganizationsSidebar({ selectedId, onSelect }: OrganizationsSidebarProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return organizations
    return organizations.filter(
      (org) =>
        org.name.toLowerCase().includes(needle) ||
        // The id slug catches common acronyms ("unbc", "sfu", "bcit", "icbc").
        org.id.replace(/-/g, ' ').includes(needle.replace(/-/g, ' ')) ||
        humanize(org.sector).includes(needle) ||
        org.acknowledges.some((name) => name.toLowerCase().includes(needle)),
    )
  }, [query])

  return (
    <aside className="flex flex-col rounded-lg border bg-white shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start">
      <div className="border-b p-3">
        <h2 className="text-sm font-semibold">Organizations</h2>
        <p className="mt-0.5 text-xs leading-4 text-slate-500">
          {organizations.length} examples · choose one to review its source and draft
        </p>
        <label className="mt-2 flex min-h-11 items-center gap-2 rounded-md border bg-white px-2.5">
          <Search className="h-3.5 w-3.5 flex-none text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search organizations"
            className="min-w-0 flex-1 bg-transparent text-base outline-none"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 space-y-1 p-2 lg:overflow-y-auto">
        {filtered.map((org) => (
          <button
            key={org.id}
            type="button"
            onClick={() => onSelect(org.id)}
            aria-current={selectedId === org.id}
            className={cn(
              'block min-h-11 w-full rounded-md border px-2 py-1.5 text-left transition',
              selectedId === org.id ? 'border-teal-300 bg-teal-50' : 'border-transparent hover:bg-slate-50',
            )}
          >
            <div className="break-words text-sm font-medium text-slate-900">{org.name}</div>
            <div className="truncate text-xs text-slate-500">
              {humanize(org.sector)} ·{' '}
              {org.acknowledges.length
                ? `${org.acknowledges.length} Nation${org.acknowledges.length === 1 ? '' : 's'}`
                : 'region-wide'}
            </div>
          </button>
        ))}
        {filtered.length === 0 && <div className="p-2 text-xs text-slate-500">No organizations match “{query}”.</div>}
      </div>
    </aside>
  )
}
