import { RoadSelect } from './Controls'
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
  const options = alignments.map((road, i) => {
    const result = analyses.get(road.id)
    const cost = result && !alternativeCostLabel(result) ? money(result.estimatedCost) : null
    // A native option is text only, so the road's colour is shown beside the select instead.
    return { value: road.id, title: road.name, label: cost ? `${names[i]} · ${cost}` : names[i] }
  })
  return (
    <nav
      aria-label="Switch road"
      className={`flex min-w-0 items-center gap-1 ${className}`}
      data-testid="road-switcher"
    >
      <span className="size-2 shrink-0 rounded-full" style={{ background: colors.get(activeId) }} aria-hidden />
      <RoadSelect
        className="h-7 min-w-0 flex-1 touch:h-9 md:max-w-80"
        value={activeId}
        onValueChange={onSelect}
        options={options}
        disabled={disabled}
        ariaLabel="Viewing road"
      />
      <button
        type="button"
        onClick={onCompare}
        title="Compare all roads"
        className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground touch:h-9"
      >
        <Columns3 aria-hidden="true" className="size-3.5" />
        Compare all
      </button>
    </nav>
  )
}
