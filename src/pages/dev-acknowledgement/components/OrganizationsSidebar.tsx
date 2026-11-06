import { useMemo, useState } from 'react'

import { SearchInput } from '@/components/ui/map-panels'
import { ResultRow } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
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
        {/* This page stays light under a dark app theme, so colours here are fixed, not tokens. */}
        <SearchInput
          icon
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Search"
          aria-label="Search organizations"
          wrapperClassName="mt-2"
          className="min-h-11 rounded-md border-slate-200 bg-white text-slate-900 placeholder-slate-400"
        />
      </div>
      <div data-map-sidebar-scroll="true" className="max-h-[70dvh] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
        <VirtualResultList items={filtered} getKey={(org) => org.id} estimateSize={64} label="Organizations">
          {(org) => {
            const selected = selectedId === org.id
            return (
              <ResultRow
                accent="teal"
                selected={selected}
                aria-current={selected}
                onClick={() => onSelect(org.id)}
                className={cn('min-h-11 py-2 dark:hover:bg-slate-50', selected && 'dark:bg-teal-50')}
                title={<span className="whitespace-normal break-words text-slate-900">{org.name}</span>}
                subtitle={
                  <span className="text-slate-500">
                    {humanize(org.sector)} ·{' '}
                    {org.acknowledges.length
                      ? `${org.acknowledges.length} Nation${org.acknowledges.length === 1 ? '' : 's'}`
                      : 'region-wide'}
                  </span>
                }
              />
            )
          }}
        </VirtualResultList>
        {filtered.length === 0 && <div className="p-4 text-xs text-slate-500">No organizations match “{query}”.</div>}
      </div>
    </aside>
  )
}
