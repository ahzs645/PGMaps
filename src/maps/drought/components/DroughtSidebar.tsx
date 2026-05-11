import { CalendarDays, Database, ExternalLink, Layers } from 'lucide-react'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { DROUGHT_LEVELS } from '../constants'
import type { DroughtFeature, DroughtManifest } from '../types'

interface DroughtSidebarProps {
  className?: string
  manifest: DroughtManifest | null
  selectedYear: number
  availableYears: number[]
  visibleCount: number
  totalCount: number
  loading: boolean
  error: string | null
  selectedFeature: DroughtFeature | null
  onYearChange: (year: number) => void
  onClearSelection: () => void
}

export function DroughtSidebar({
  className,
  manifest,
  selectedYear,
  availableYears,
  visibleCount,
  totalCount,
  loading,
  error,
  selectedFeature,
  onYearChange,
  onClearSelection,
}: DroughtSidebarProps) {
  const selectedYearInfo = manifest?.years.find((item) => item.year === selectedYear)

  return (
    <aside className={cn('flex h-full flex-col overflow-hidden bg-background', className)}>
      <div className="border-b border-border p-4">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Layers className="h-3.5 w-3.5" />
          B.C. Drought Portal
        </div>
        <h1 className="text-xl font-semibold text-foreground">Historical Drought Levels</h1>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">
          Drought basin polygons from the provincial time-lapse services, normalized for PGMaps.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section className="space-y-2">
          <label className="text-xs font-semibold text-foreground" htmlFor="drought-year">
            Year
          </label>
          <AppSelect
            id="drought-year"
            value={String(selectedYear)}
            onValueChange={(value) => onYearChange(Number(value))}
            options={availableYears.map((year) => ({ value: String(year), label: year }))}
            disabled={availableYears.length === 0}
          />
        </section>

        <section className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Database className="h-3.5 w-3.5" />
              Visible
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">{visibleCount.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              Year rows
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">{totalCount.toLocaleString()}</div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Legend</h2>
          <div className="space-y-2">
            {DROUGHT_LEVELS.map((item) => (
              <div key={item.level} className="flex items-center gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-black/10 text-sm font-bold text-black"
                  style={{ backgroundColor: item.color }}
                >
                  {item.level}
                </span>
                <span className="text-sm text-foreground">{item.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <span
                className="h-8 w-8 shrink-0 rounded-md border border-black/10"
                style={{ backgroundColor: '#8a8f98' }}
              />
              <span className="text-sm text-foreground">Not updated / no numeric level</span>
            </div>
          </div>
        </section>

        {selectedFeature && (
          <section className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">{selectedFeature.properties.basinName || 'Drought basin'}</h2>
              <button
                type="button"
                onClick={onClearSelection}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Level</dt>
                <dd className="font-medium text-foreground">{selectedFeature.properties.droughtLevelRaw ?? 'Not updated'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Start</dt>
                <dd className="font-medium text-foreground">{selectedFeature.properties.startDate ?? 'Unknown'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">End</dt>
                <dd className="font-medium text-foreground">{selectedFeature.properties.endDate ?? 'Unknown'}</dd>
              </div>
            </dl>
          </section>
        )}

        {selectedYearInfo && (
          <section className="space-y-2 text-xs text-muted-foreground">
            <div>Source range: {selectedYearInfo.startDate ?? 'unknown'} to {selectedYearInfo.endDate ?? 'unknown'}</div>
            <a
              href={selectedYearInfo.layerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              ArcGIS REST layer
              <ExternalLink className="h-3 w-3" />
            </a>
          </section>
        )}

        {loading && <div className="text-sm text-muted-foreground">Loading drought polygons...</div>}
        {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      </div>
    </aside>
  )
}
