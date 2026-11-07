import { Columns3 } from 'lucide-react'
import { distinctRoadColors } from './roadColors'
import { shortRoadNames } from './roadNames'
import { alternativeCostLabel } from './alternativeCosts'
import type { Alignment, RoadAnalysis } from './types'

const money = (value: number) =>
  value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2)}M` : `$${Math.round(value / 1000)}k`

/**
 * Stays on screen whichever tab or view is open, so every chart and table can be flipped between roads.
 * It belongs in the header line: a row of its own takes enough height to fold the charts' legends and bands.
 */
export function RoadSwitcher({
  alignments,
  analyses,
  activeId,
  disabled,
  onSelect,
  onCompare,
  className = '',
}: {
  alignments: Alignment[]
  analyses: Map<string, RoadAnalysis>
  activeId: string
  disabled?: boolean
  onSelect: (id: string) => void
  onCompare: () => void
  className?: string
}) {
  if (alignments.length < 2) return null
  const names = shortRoadNames(alignments.map((road) => road.name))
  const colors = distinctRoadColors(alignments)
  return (
    <nav
      aria-label="Switch road"
      className={`flex min-w-0 items-center gap-1 overflow-x-auto ${className}`}
      data-testid="road-switcher"
    >
      {alignments.map((road, i) => {
        const result = analyses.get(road.id)
        const cost = result && !alternativeCostLabel(result) ? money(result.estimatedCost) : null
        const active = road.id === activeId
        return (
          <button
            key={road.id}
            type="button"
            title={road.name}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onSelect(road.id)}
            className={`flex h-7 max-w-52 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors disabled:opacity-60 touch:h-9 ${
              active ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted'
            }`}
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: colors.get(road.id) }} aria-hidden />
            <span className="min-w-0 truncate">{names[i]}</span>
            {cost && <span className="shrink-0 tabular-nums text-muted-foreground">{cost}</span>}
          </button>
        )
      })}
      <button
        type="button"
        onClick={onCompare}
        className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground touch:h-9"
      >
        <Columns3 aria-hidden="true" className="size-3.5" />
        Compare all
      </button>
    </nav>
  )
}
