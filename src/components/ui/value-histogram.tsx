/**
 * A compact histogram: equal-width bars from `histogram()` (`src/lib/histogram.ts`, DOM-free), the
 * domain's ends under it, and optional marker lines (a mean, a threshold). Bars take the theme's
 * primary colour unless the page colours them by value (`barColor`, e.g. a map's own ramp, which
 * stays fixed under a theme as legend colours do). Counts outside the domain and missing values are
 * stated, never drawn as bars.
 */
import type { CSSProperties } from 'react'
import { histogramPeak, type Histogram, type HistogramBin } from '@/lib/histogram'
import { cn } from '@/lib/utils'

export interface HistogramMarker {
  value: number
  label: string
  /** `muted` for a reference line (a threshold), `strong` for the reading itself (a mean). */
  tone?: 'strong' | 'muted'
}

export interface ValueHistogramProps {
  histogram: Histogram
  /** What the bars count, for screen readers and each bar's tooltip ("pixels"). */
  unit?: string
  /** Accessible name of the chart. */
  label: string
  formatValue?: (value: number) => string
  /** A bar's colour from its bin; the theme's primary when omitted. */
  barColor?: (bin: HistogramBin) => string
  markers?: readonly HistogramMarker[]
  /** Bar area height in pixels. */
  height?: number
  /** Show "n below · n above · n missing" under the axis when any are non-zero. */
  showOutside?: boolean
  className?: string
  'data-testid'?: string
}

const defaultFormat = (value: number) => value.toFixed(2)

export function ValueHistogram({
  histogram: h,
  unit = 'values',
  label,
  formatValue = defaultFormat,
  barColor,
  markers = [],
  height = 64,
  showOutside = true,
  className,
  'data-testid': testId,
}: ValueHistogramProps) {
  const peak = histogramPeak(h)
  const shown = markers.filter((marker) => Number.isFinite(marker.value))
  const [low, high] = h.domain
  const at = (value: number) => ((value - low) / (high - low)) * 100
  const outside = [
    h.below > 0 && `${h.below} below ${formatValue(low)}`,
    h.above > 0 && `${h.above} above ${formatValue(high)}`,
    h.missing > 0 && `${h.missing} missing`,
  ].filter(Boolean)
  const summary = `${label}: ${h.binned} ${unit} from ${formatValue(low)} to ${formatValue(high)}${
    shown.length ? `; ${shown.map((m) => `${m.label} ${formatValue(m.value)}`).join(', ')}` : ''
  }`
  return (
    <figure className={cn('m-0 min-w-0 text-2xs', className)} data-testid={testId}>
      <div className="relative w-full border-b border-border" style={{ height }} role="img" aria-label={summary}>
        <div className="absolute inset-0 flex items-end gap-px">
          {h.bins.map((bin, i) => {
            const style: CSSProperties = { height: peak ? `${(bin.count / peak) * 100}%` : 0 }
            if (barColor) style.backgroundColor = barColor(bin)
            return (
              <div
                key={i}
                className={cn('min-w-0 flex-1 rounded-t-sm', !barColor && 'bg-primary/70')}
                style={style}
                title={`${formatValue(bin.from)} to ${formatValue(bin.to)}: ${bin.count} ${unit}`}
                data-count={bin.count}
              />
            )
          })}
        </div>
        {shown
          .filter((marker) => marker.value >= low && marker.value <= high)
          .map((marker) => (
            <div
              key={`${marker.label}-${marker.value}`}
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-y-0 w-px',
                marker.tone === 'muted' ? 'border-l border-dashed border-muted-foreground' : 'bg-foreground',
              )}
              style={{ left: `${at(marker.value)}%` }}
              title={`${marker.label} ${formatValue(marker.value)}`}
            />
          ))}
      </div>
      <figcaption className="mt-0.5 flex justify-between gap-2 text-3xs tabular-nums text-muted-foreground">
        <span>{formatValue(low)}</span>
        {shown.length > 0 && (
          <span className="truncate">
            {shown.map((marker) => `${marker.label} ${formatValue(marker.value)}`).join(' · ')}
          </span>
        )}
        <span>{formatValue(high)}</span>
      </figcaption>
      {showOutside && outside.length > 0 && (
        <p className="mt-0.5 text-3xs text-muted-foreground">{outside.join(' · ')}</p>
      )}
    </figure>
  )
}
