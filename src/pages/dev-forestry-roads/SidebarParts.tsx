import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolSection, type ToolSectionProps } from '@/components/ui/tool-section'
import { formatRoadStation } from './Charts'
import { isBeyondReachFlag } from './engine'
import type { RoadWorkspace } from './useRoadWorkspace'

/** Largest section reach `parseProject` accepts. */
export const MAX_SECTION_REACH_M = 100

/**
 * A sidebar section with its explanation behind an (i) in the heading, not printed under it.
 * `summary` folds it to one row that states the section's current values; content stays mounted.
 * The shared `ToolSection`, with the road designer's `toggleTestId` hook.
 */
export function RoadSection({
  toggleTestId,
  ...props
}: Omit<ToolSectionProps, 'toggleProps'> & { toggleTestId?: string }) {
  return <ToolSection {...props} toggleProps={toggleTestId ? { 'data-testid': toggleTestId } : undefined} />
}

/**
 * Stations whose batter is still in the air (or under ground) where the section reach ends. They
 * leave quantities and look like a break in the plan, so say what happened and offer the fixes.
 */
export function SectionReachAlert({ workspace }: { workspace: RoadWorkspace }) {
  const { analysis, project, update, setStation } = workspace
  const hits = analysis.stations.filter((s) => s.flags.some(isBeyondReachFlag))
  if (!hits.length) return null
  const reach = project.settings.crossSectionHalfWidth
  const span =
    hits.length === 1
      ? formatRoadStation(hits[0].chainage)
      : `${formatRoadStation(hits[0].chainage)}–${formatRoadStation(hits.at(-1)!.chainage)}`
  return (
    <InlineAlert tone="warning" title="Fill or cut too deep to close" className="mt-2">
      <span data-testid="road-section-reach-alert" className="flex items-start gap-1">
        <span>
          {span} · {hits.length} station{hits.length === 1 ? '' : 's'}. The batter does not meet the ground within the{' '}
          {reach} m section reach; shown red on the plan, left out of quantities.
        </span>
        <InfoTip label="About batters past the section reach">
          The road is too far above (fill) or below (cut) the ground for its batter to reach it inside the section.
          Bring the grade line closer to the ground, steepen the batter, or extend the reach to see how far the slope
          really runs. A forest road with this much fill or cut usually needs a different line.
        </InfoTip>
      </span>
      <span className="mt-1.5 flex flex-wrap gap-1">
        <Button size="xs" variant="outline" onClick={() => setStation(hits[0].chainage)}>
          Go to {formatRoadStation(hits[0].chainage)}
        </Button>
        {reach < MAX_SECTION_REACH_M && (
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              update((x) => ({ ...x, settings: { ...x.settings, crossSectionHalfWidth: MAX_SECTION_REACH_M } }))
            }
          >
            Extend reach to {MAX_SECTION_REACH_M} m
          </Button>
        )}
      </span>
    </InlineAlert>
  )
}
