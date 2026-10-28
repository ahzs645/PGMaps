import { Check, Link2, Plus, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { LayerSwatch } from '@/components/ui/layer-list-item'
import { EmptyHint, ResultRow } from '@/components/ui/result-list'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { formatBytes, formatDate, formatNumber } from '@/lib/format'
import { GEO_FILE_ACCEPT, GEO_FILE_FORMATS } from '@/lib/geoFileImport'
import { CATALOG, CATALOG_SOURCE, LARGE_LAYER_BYTES, type CatalogEntry } from './catalog'
import { fallbackColor } from './layerData'

const GEOMETRY_NOUNS = { fill: 'Areas', line: 'Lines', point: 'Points' } as const

/**
 * Felt's "Add data": the library of synced City of Prince George layers, each
 * one click from the map, plus a file upload and a GeoJSON URL. Files are read
 * in the page and never leave it.
 */
export function AddDataDialog({
  open,
  onOpenChange,
  addedIds,
  busy,
  error,
  onAddCatalog,
  onFiles,
  onUrl,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  addedIds: ReadonlySet<string>
  busy: boolean
  error: string | null
  onAddCatalog: (entry: CatalogEntry) => void
  onFiles: (files: File[]) => void
  onUrl: (url: string) => void
}) {
  const [query, setQuery] = useState('')
  const [url, setUrl] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const matches = CATALOG.filter(
      (entry) => !normalized || `${entry.name} ${entry.category}`.toLowerCase().includes(normalized),
    )
    const byCategory = new Map<string, CatalogEntry[]>()
    for (const entry of matches) byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), entry])
    return [...byCategory.entries()]
  }, [query])

  return (
    <PanelDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add data"
      subtitle={`${CATALOG.length} layers from the ${CATALOG_SOURCE}, or your own file`}
      className="sm:max-h-[86vh] sm:w-[min(640px,calc(100vw-2rem))] sm:max-w-[640px]"
      bodyClassName="p-0 sm:p-0"
      contentProps={{ 'data-dev-data-library': 'true' }}
      toolbar={
        <SearchInput
          icon
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Search layers…"
          aria-label="Search the data library"
          data-map-search-input="false"
        />
      }
    >
      <section className="space-y-3 border-b border-border p-4" aria-label="Upload your own data">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-muted disabled:opacity-60"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="size-4" aria-hidden="true" />
            {busy ? 'Reading file…' : 'Upload a file'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={GEO_FILE_ACCEPT}
            multiple
            className="sr-only"
            aria-label="Choose files to upload"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (files.length > 0) onFiles(files)
            }}
          />
          <span className="text-xs text-muted-foreground">or drop it anywhere on the map.</span>
        </div>
        <p className="text-xs text-muted-foreground">{GEO_FILE_FORMATS}. Files stay in this browser tab.</p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (url.trim()) onUrl(url.trim())
          }}
        >
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border px-2">
            <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…/data.geojson"
              aria-label="GeoJSON URL"
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="rounded-md border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            Add URL
          </button>
        </form>
        {error && (
          <InlineAlert tone="error" title="Could not add that data">
            {error}
          </InlineAlert>
        )}
      </section>

      <div aria-label="Data library" role="region">
        {groups.length === 0 && (
          <div className="p-4">
            <EmptyHint>No layers match “{query}”.</EmptyHint>
          </div>
        )}
        {groups.map(([category, entries]) => (
          <section key={category} aria-label={category}>
            <h3 className="sticky top-0 z-[1] border-b border-border bg-background/95 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {category}
            </h3>
            <div className="divide-y divide-border">
              {entries.map((entry) => {
                const added = addedIds.has(entry.id)
                const large = entry.bytes > LARGE_LAYER_BYTES
                return (
                  <ResultRow
                    key={entry.id}
                    data-library-item={entry.id}
                    aria-label={added ? `${entry.name}, added` : `Add ${entry.name}`}
                    selected={added}
                    accent="teal"
                    leading={
                      <span className="mt-1 flex w-5 justify-center">
                        <LayerSwatch color={fallbackColor(entry.id)} shape={entry.geometry} />
                      </span>
                    }
                    title={entry.name}
                    subtitle={`${GEOMETRY_NOUNS[entry.geometry]} · ${formatNumber(entry.rowCount)} rows · ${formatBytes(entry.bytes)}${large ? ' · large, slow to load' : ''}`}
                    meta={entry.snapshotDate ? `Snapshot ${formatDate(`${entry.snapshotDate}T12:00:00`)}` : undefined}
                    trailing={
                      added ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                          <Check className="size-3.5" aria-hidden="true" /> Added
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                          <Plus className="size-3.5" aria-hidden="true" /> Add
                        </span>
                      )
                    }
                    disabled={added}
                    onClick={() => onAddCatalog(entry)}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </PanelDialog>
  )
}
