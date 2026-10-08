import type { ReactNode } from 'react'
import type { ResolvedScaleLegend } from '../scales/legend.js'
import { cn } from '../utils.js'

/** A legend driven by the renderer's resolved scale, including unequal class widths. */
export function ScaleLegend({
  legend,
  formatValue = String,
  showMissing = true,
  className,
}: {
  legend: ResolvedScaleLegend
  formatValue?: (value: number) => ReactNode
  showMissing?: boolean
  className?: string
}) {
  return (
    <figure
      className={cn('m-0 space-y-2 text-xs text-foreground', className)}
      aria-label={legend.title ?? 'Color scale'}
    >
      {(legend.title || legend.unit) && (
        <figcaption className="font-medium">
          {legend.title}
          {legend.unit && <span className="ml-1 text-muted-foreground">({legend.unit})</span>}
        </figcaption>
      )}
      <div aria-hidden="true" className="relative flex h-3 overflow-hidden rounded border border-border">
        {legend.bins.map((bin, index) => (
          <span
            key={index}
            data-scale-bin="true"
            style={{ width: `${(bin.end - bin.start) * 100}%`, backgroundColor: bin.color }}
          />
        ))}
      </div>
      <ul className="m-0 list-none space-y-1 p-0">
        {legend.bins.map((bin, index) => (
          <li key={index} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: bin.color }}
              aria-hidden="true"
            />
            <span>
              {formatValue(bin.min)} ≤ value {bin.includesMax ? '≤' : '<'} {formatValue(bin.max)}
            </span>
          </li>
        ))}
        {showMissing && (
          <li className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-border"
              style={{ backgroundColor: legend.missing.color }}
              aria-hidden="true"
            />
            {legend.missing.label}
          </li>
        )}
      </ul>
    </figure>
  )
}
