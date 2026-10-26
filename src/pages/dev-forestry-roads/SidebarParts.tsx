import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { formatRoadStation } from './Charts'
import { isBeyondReachFlag } from './engine'
import type { RoadWorkspace } from './useRoadWorkspace'

/** Largest section reach `parseProject` accepts. */
export const MAX_SECTION_REACH_M = 100

/** A sidebar section with its explanation behind an (i) in the heading, not printed under it. */
export function RoadSection({
  title,
  help,
  actions,
  children,
  ...props
}: {
  title: string
  help?: ReactNode
  actions?: ReactNode
  children: ReactNode
} & Record<`data-${string}`, string>) {
  return (
    <SidebarSection
      title={title}
      className="px-3 py-3"
      actions={
        (help || actions) && (
          <>
            {actions}
            {help && <InfoTip label={`About ${title.toLowerCase()}`}>{help}</InfoTip>}
          </>
        )
      }
      {...props}
    >
      {children}
    </SidebarSection>
  )
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
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStation(hits[0].chainage)}>
          Go to {formatRoadStation(hits[0].chainage)}
        </Button>
        {reach < MAX_SECTION_REACH_M && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
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
