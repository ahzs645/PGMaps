import { Aperture, Eye, EyeOff } from 'lucide-react'
import { formatCompact, radiusFor } from './data'

// Felt-style graduated-circle legend row. Renders max / mid / min circles sized
// proportionally to the active attribute, with value labels and the row's
// classification + visibility controls — mirroring Felt's `data-legend` markup.
export function SewageLegend({
  caption,
  color,
  domain,
  visible,
  onToggleVisible,
}: {
  caption: string
  color: string
  domain: [number, number]
  visible: boolean
  onToggleVisible: () => void
}) {
  const [lo, hi] = domain
  const stops = [hi, (hi + lo) / 2, lo] // largest → smallest, like "4.93K · 2.47K · 10"
  const maxRadius = 26
  const trackHeight = maxRadius * 2

  return (
    <div
      role="listitem"
      data-legend="item"
      data-legend-row="true"
      className={cnRow(visible)}
    >
      <div data-legend-row-frame="true" className="flex items-start justify-between gap-2">
        <div data-legend-content="true" className="flex items-end gap-4 pl-1 pt-1">
          {stops.map((value, index) => {
            const radius = radiusFor(value, domain, 5, maxRadius)
            return (
              <div key={index} className="flex flex-col items-center gap-1.5">
                <span className="flex items-end justify-center" style={{ height: trackHeight }}>
                  <span
                    className="rounded-full border border-white shadow-sm"
                    style={{
                      width: radius * 2,
                      height: radius * 2,
                      backgroundColor: color,
                      opacity: visible ? 0.78 : 0.3,
                    }}
                  />
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{formatCompact(value)}</span>
              </div>
            )
          })}
        </div>
        <div data-legend-end-overlay="true" className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Classification"
          >
            <Aperture className="size-4" />
          </button>
          <button
            type="button"
            onClick={onToggleVisible}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Toggle legend item visibility"
            aria-pressed={visible}
          >
            {visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </button>
        </div>
      </div>
      <label data-legend="caption" className="mt-2 block text-xs font-medium text-foreground">
        {caption}
      </label>
    </div>
  )
}

function cnRow(visible: boolean): string {
  return `rounded-md border border-border bg-background p-3 shadow-sm${visible ? '' : ' opacity-70'}`
}
