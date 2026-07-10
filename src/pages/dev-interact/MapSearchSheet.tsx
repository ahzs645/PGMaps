import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { cn } from '@/lib/utils'
import { neighbourhoodFeatures, parkFeatures, routeFeatures } from './data'
import { featureMatchesYearRange, layerLabel } from './geo'
import type { InteractFeature, LayerId, YearRange } from './types'

const layerOrder: LayerId[] = ['neighbourhoods', 'parks', 'routes']

const layerGlyphs: Record<LayerId, { color: string; shape: 'circle' | 'square' | 'line' }> = {
  neighbourhoods: { color: '#8b5cf6', shape: 'square' },
  parks: { color: '#22c55e', shape: 'square' },
  routes: { color: '#0ea5e9', shape: 'line' },
}

export function MapSearchSheet({
  open,
  hiddenFeatureIds,
  isolatedFeatureId,
  yearRange,
  onClose,
  onExited,
  onSelect,
}: {
  open: boolean
  hiddenFeatureIds: Set<string>
  isolatedFeatureId: string | null
  yearRange: YearRange
  onClose: () => void
  onExited: () => void
  onSelect: (feature: InteractFeature) => void
}) {
  const [query, setQuery] = useState('')
  const [presented, setPresented] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      setPresented(true)
      inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (open) return
    const frame = requestAnimationFrame(() => setPresented(false))
    const timeout = window.setTimeout(onExited, 260)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
  }, [onExited, open])

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return [...neighbourhoodFeatures.features, ...parkFeatures.features, ...routeFeatures.features].filter((feature) => {
      if (hiddenFeatureIds.has(feature.properties.id)) return false
      if (isolatedFeatureId && feature.properties.id !== isolatedFeatureId) return false
      if (!featureMatchesYearRange(feature, yearRange)) return false
      if (!normalizedQuery) return true

      const searchable = [
        feature.properties.name,
        feature.properties.description,
        feature.properties.value,
        layerLabel(feature.properties.layer),
        ...feature.properties.properties.flatMap((property) => [property.label, property.value]),
      ].join(' ').toLowerCase()

      return searchable.includes(normalizedQuery)
    })
  }, [hiddenFeatureIds, isolatedFeatureId, query, yearRange])

  const groupedRows = useMemo(() => {
    return layerOrder
      .map((layer) => ({
        layer,
        rows: rows.filter((feature) => feature.properties.layer === layer),
      }))
      .filter((group) => group.rows.length > 0)
  }, [rows])

  const selectFeature = (feature: InteractFeature) => {
    onSelect(feature)
    onClose()
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close search"
        className={cn(
          'fixed inset-0 z-[1200] bg-black/55 transition-opacity duration-250 md:hidden',
          presented ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-labelledby="map-search-title"
        data-open={open}
        className={cn(
          'fixed inset-x-0 bottom-0 z-[1210] flex h-[calc(100dvh-4.75rem)] flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.24)] transition-transform duration-250 ease-[cubic-bezier(0.32,0.72,0,1)] md:hidden',
          presented ? 'translate-y-0' : 'translate-y-[calc(100%+2rem)]',
        )}
      >
        <SearchBody
          query={query}
          groupedRows={groupedRows}
          inputRef={inputRef}
          onQueryChange={setQuery}
          onSelect={selectFeature}
          mobilePrimary
        />
      </div>

      <div
        data-open={open}
        className={cn(
          'absolute right-4 top-16 z-[70] hidden h-[min(520px,calc(100%-5rem))] w-[min(420px,calc(100%-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-[opacity,transform] duration-200 ease-out md:flex',
          presented ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
        )}
      >
        <SearchHeader onClose={onClose} compact />
        <SearchBody
          query={query}
          groupedRows={groupedRows}
          inputRef={inputRef}
          onQueryChange={setQuery}
          onSelect={selectFeature}
        />
      </div>
    </>
  )
}

function SearchHeader({ onClose, compact = false }: { onClose: () => void; compact?: boolean }) {
  return (
    <div className="shrink-0 border-b border-border">
      {!compact && (
        <div className="flex justify-center py-2 md:hidden" aria-hidden="true">
          <div className="flex">
            <span className="h-1 w-[18px] translate-x-0.5 rounded-full bg-muted-foreground/25" />
            <span className="h-1 w-[18px] -translate-x-0.5 rounded-full bg-muted-foreground/25" />
          </div>
        </div>
      )}
      <header className={cn('flex items-center justify-between gap-3 px-4 pb-3 pt-1', compact && 'py-3')}>
        <div className="min-w-0">
          <p id="map-search-title" className="truncate text-base font-semibold">Search locations</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Find visible map features</p>
        </div>
        <button type="button" className="rounded-md p-2 hover:bg-muted" onClick={onClose} aria-label="Close search">
          <X className="size-4" />
        </button>
      </header>
    </div>
  )
}

function SearchBody({
  query,
  groupedRows,
  inputRef,
  onQueryChange,
  onSelect,
  mobilePrimary = false,
}: {
  query: string
  groupedRows: Array<{ layer: LayerId; rows: InteractFeature[] }>
  inputRef: RefObject<HTMLInputElement>
  onQueryChange: (query: string) => void
  onSelect: (feature: InteractFeature) => void
  mobilePrimary?: boolean
}) {
  const resultCount = groupedRows.reduce((total, group) => total + group.rows.length, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn('shrink-0 border-b border-border p-3', mobilePrimary && 'border-b-0 px-3 pb-2 pt-3')}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search map items..."
            aria-label="Search map items"
            className={cn(
              'h-10 w-full rounded-md border border-border bg-background pl-9 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring',
              mobilePrimary && 'border-rose-300 shadow-sm focus:ring-rose-300',
            )}
          />
          {query ? (
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-muted" onClick={() => onQueryChange('')} aria-label="Clear search">
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto py-2', mobilePrimary && 'pt-1')}>
        {groupedRows.map((group) => (
          <div key={group.layer} className="pb-2">
            <div className={cn('px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground', mobilePrimary && 'px-3')}>
              {layerLabel(group.layer)}
            </div>
            {group.rows.map((feature) => (
              <button
                key={feature.properties.id}
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted',
                  mobilePrimary && 'px-3',
                )}
                onClick={() => onSelect(feature)}
              >
                <LayerGlyph layer={feature.properties.layer} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">{feature.properties.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{feature.properties.description}</div>
                </div>
              </button>
            ))}
          </div>
        ))}
        {resultCount === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No map items match that search.
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-4 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] text-xs text-muted-foreground">
        {resultCount} result{resultCount === 1 ? '' : 's'}
      </div>
    </div>
  )
}

function LayerGlyph({ layer }: { layer: LayerId }) {
  const glyph = layerGlyphs[layer]
  if (glyph.shape === 'line') {
    return <span className="h-0.5 w-5 shrink-0 rounded-full" style={{ backgroundColor: glyph.color }} aria-hidden="true" />
  }
  if (glyph.shape === 'circle') {
    return <span className="size-4 shrink-0 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: glyph.color }} aria-hidden="true" />
  }
  return <span className="size-4 shrink-0 rounded-sm border border-black/10" style={{ backgroundColor: glyph.color, opacity: 0.8 }} aria-hidden="true" />
}
