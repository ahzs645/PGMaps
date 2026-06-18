import { useMemo, useState } from 'react'
import { ExternalLink, MapPin, Search } from 'lucide-react'

import { organizations } from '../organizations'

const humanize = (value: string) => value.replace(/[_-]+/g, ' ')

type OrganizationsPanelProps = {
  /** Load an org's campuses onto the Map & Nations tab for comparison. */
  onLoadOrg: (id: string) => void
}

export function OrganizationsPanel({ onLoadOrg }: OrganizationsPanelProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return organizations
    return organizations.filter((org) => (
      org.name.toLowerCase().includes(needle)
      || org.sector.includes(needle)
      || org.acknowledges.some((name) => name.toLowerCase().includes(needle))
    ))
  }, [query])

  return (
    <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Documented organizations</h2>
          <p className="mt-1 text-sm text-slate-600">
            {organizations.length} tracked acknowledgements. Each stores the Nations the organization names plus a link to
            the official source — load one onto the map to compare it against what the engine resolves.
          </p>
        </div>
        <label className="flex min-h-10 items-center gap-2 rounded-md border bg-white px-3 shadow-sm sm:w-72">
          <Search className="h-4 w-4 flex-none text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, sector, or Nation"
            aria-label="Search organizations"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((org) => (
          <article key={org.id} className="flex flex-col rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">{org.name}</h3>
                <div className="mt-1 flex flex-wrap gap-1">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">{humanize(org.sector)}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">{humanize(org.framing)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onLoadOrg(org.id)}
                className="inline-flex flex-none items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-teal-800 transition hover:border-teal-300"
              >
                <MapPin className="h-3.5 w-3.5" />
                Load on map
              </button>
            </div>

            {org.note && <p className="mt-2 text-xs leading-5 text-slate-500">{org.note}</p>}

            <div className="mt-2 text-xs leading-5 text-slate-700">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Names ({org.acknowledges.length})</span>{' '}
              {org.acknowledges.length ? org.acknowledges.join(', ') : <span className="text-slate-400">Region-wide — no specific Nations</span>}
            </div>

            <div className="mt-3 flex items-center justify-between border-t pt-2 text-xs">
              <span className="text-slate-500">{org.campuses.length} campus point{org.campuses.length === 1 ? '' : 's'}</span>
              <a href={org.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-teal-800">
                Official source <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </article>
        ))}
        {filtered.length === 0 && (
          <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">No organizations match “{query}”.</div>
        )}
      </div>
    </main>
  )
}
