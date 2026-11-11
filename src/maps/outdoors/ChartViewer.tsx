import { ExternalLink, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'

import type { DepthChartSet } from './bcLayers'

/**
 * A lake's scanned depth chart, shown beside the map instead of sent to a new
 * tab. The province serves each sheet as a PDF for inline display, so the
 * browser's own PDF viewer draws it in a frame, with its zoom and pan.
 *
 * The chart is a scan of a paper map and is not georeferenced: it cannot be
 * laid over the map without placing each sheet by hand. The few lakes that
 * have been digitized are drawn on the map itself, as coloured depth bands.
 */
export function ChartViewer({ chart, onClose }: { chart: DepthChartSet; onClose: () => void }) {
  const [sheetIndex, setSheetIndex] = useState(0)
  const sheet = chart.sheets[Math.min(sheetIndex, chart.sheets.length - 1)]

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside
      aria-label={`${chart.lake} depth chart`}
      className="fixed bottom-4 right-4 top-16 z-overlay flex w-[min(640px,calc(100vw-2rem))] flex-col overflow-hidden rounded-md border border-border bg-background shadow-2xl"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{chart.lake} depth chart</h2>
          <p className="text-2xs text-muted-foreground">
            {chart.surveyYear ? `Charted ${chart.surveyYear}. ` : ''}Not for navigation.
          </p>
        </div>
        <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
          <a href={sheet.url} target="_blank" rel="noreferrer" aria-label="Open this sheet in a new tab">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="Close depth chart"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>
      {chart.sheets.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5" role="tablist">
          {chart.sheets.map((entry, index) => (
            <button
              key={entry.sheet}
              type="button"
              role="tab"
              aria-selected={index === sheetIndex}
              onClick={() => setSheetIndex(index)}
              className={`rounded px-2 py-1 text-2xs font-medium transition-colors ${
                index === sheetIndex
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              Sheet {entry.sheet}
            </button>
          ))}
        </div>
      )}
      <iframe
        // A new sheet is a new document; keying it stops the last one lingering while the next loads.
        key={sheet.url}
        src={sheet.url}
        title={`${chart.lake} depth chart, sheet ${sheet.sheet}`}
        className="min-h-0 flex-1 bg-muted"
      />
    </aside>
  )
}
