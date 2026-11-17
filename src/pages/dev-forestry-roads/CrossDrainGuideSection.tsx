import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { ResultRow } from '@/components/ui/result-list'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { formatRoadStation } from './Charts'
import { Field, roadFieldClass, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import { StationValue } from './roadStation'
import { DEFAULT_DESIGN_STANDARDS } from './designStandards'
import { crossDrainSpacingGuidance, switchbackChainages, type CrossDrainStretch } from './culverts/crossDrainSpacing'
import { CROSS_DRAIN_PLACEMENT, CROSS_DRAIN_SPACING, type DitchErosionHazard } from './culverts/engineeringManual'
import { curvePoints } from './profileAnnotations'
import type { RoadWorkspace } from './useRoadWorkspace'

const NOT_ENTERED = 'not-entered'
const metres = (value: number) => `${Math.round(value)} m`

const STATE_BADGE: Record<CrossDrainStretch['state'], { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  within: { label: 'Within', tone: 'success' },
  over: { label: 'Over', tone: 'warning' },
  'not-determined': { label: 'Not determined', tone: 'neutral' },
}

/**
 * The Engineering Manual's cross-drain spacing table (EM 3.5.5.6, Table 3-14) read along the active
 * road: the ditch soil's erosion hazard, which only the designer enters, and for each run between
 * culverts the grade band whose limit governs. A preview: it places no culvert.
 */
export function CrossDrainGuideSection({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: RoadWorkspace
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { project, alignment, analysis, update, setStation } = workspace
  const hazard = project.standards?.ditchErosionHazard
  const culverts = alignment.engineering?.culverts
  const read = useMemo(() => {
    if (!hazard || !(analysis.length > 0) || !analysis.stations.length) return null
    return crossDrainSpacingGuidance({
      stations: analysis.stations,
      lengthM: analysis.length,
      culverts: culverts ?? [],
      hazard,
      lowPoints: curvePoints(alignment, analysis.length, culverts ?? [])
        .filter((point) => point.kind === 'low')
        .map((point) => point.chainage),
      switchbacks: switchbackChainages(analysis.stations),
    })
  }, [hazard, analysis, alignment, culverts])
  const setHazard = (picked: string) =>
    update((x) => {
      const standards = { ...(x.standards ?? DEFAULT_DESIGN_STANDARDS) }
      delete standards.ditchErosionHazard
      return {
        ...x,
        standards:
          picked === NOT_ENTERED ? standards : { ...standards, ditchErosionHazard: picked as DitchErosionHazard },
      }
    })
  const summary = !hazard
    ? 'soil class not entered'
    : !read
      ? 'no grades'
      : read.over.length
        ? `${read.over.length} over`
        : read.notDetermined.length
          ? `${read.notDetermined.length} not determined`
          : 'within'
  return (
    <RoadSection
      title="Cross-drain spacing guide"
      summary={summary}
      open={open}
      onOpenChange={onOpenChange}
      help={`BC guidance, not a design: the Engineering Manual's maximum cross-drain spacing between watercourses by the road grade at the cross-drain and the ditch soil's erosion hazard (${CROSS_DRAIN_SPACING.locator}). Each run between culverts is held to the shortest limit of any grade band it passes through, so a run mixing 10% and 14% on high-hazard soil is held to 75 m, not the 100 m its steepest grade alone reads. The manual asks for shorter spacing at junctions, steep uphill slopes, seepage and switchbacks, and a cross-drain at low points whatever the spacing (${CROSS_DRAIN_PLACEMENT.requiredLocator}). ${CROSS_DRAIN_PLACEMENT.watercourses} (${CROSS_DRAIN_PLACEMENT.watercoursesLocator}).`}
      data-testid="road-cross-drain-guide"
    >
      <Field
        label="Ditch soil erosion hazard"
        hint="By the soil type making up more than half of the ditch. Your entry: it is never read from the terrain. Not entered leaves Review's guidance row not assessed."
      >
        <RoadSelect
          ariaLabel="Ditch soil erosion hazard"
          className={roadFieldClass}
          value={hazard ?? NOT_ENTERED}
          unsetValue={NOT_ENTERED}
          onValueChange={setHazard}
        >
          <option value={NOT_ENTERED}>Not entered</option>
          {CROSS_DRAIN_SPACING.hazards.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}: {h.soils}
            </option>
          ))}
        </RoadSelect>
      </Field>
      {read && (
        <StationValue workspace={workspace}>
          {(station) => (
            <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')} data-testid="road-cross-drain-guide-runs">
              {read.stretches.map((run) => {
                const badge = STATE_BADGE[run.state]
                const differs =
                  run.governing && run.steepestOnlyLimitM !== null && run.steepestOnlyLimitM !== run.governing.limitM
                return (
                  <li key={`${run.start}-${run.end}`} data-run-state={run.state}>
                    <ResultRow
                      accent="teal"
                      className="px-2 py-1.5 [&_span]:whitespace-normal"
                      selected={station >= run.start && station <= run.end}
                      title={
                        <span className="text-xs">
                          {formatRoadStation(run.start)}–{formatRoadStation(run.end)} · {metres(run.lengthM)}
                        </span>
                      }
                      subtitle={
                        <span className="text-2xs">
                          {run.governing
                            ? `Governs: ${metres(run.governing.limitM)} at ${run.governing.label}${differs ? ` (steepest grade alone: ${metres(run.steepestOnlyLimitM!)})` : ''}`
                            : 'No design grade'}
                          {run.unknownM > 0.5 ? ` · ${metres(run.unknownM)} without a grade` : ''}
                        </span>
                      }
                      meta={
                        <span className="text-2xs">
                          {run.bands.map((band) => `${band.label} ${metres(band.lengthM)}`).join(' · ')}
                          {run.rockLineDitchM > 0.5 ? ` · rock-line the ditch over ${metres(run.rockLineDitchM)}` : ''}
                          {run.lowPoints.map((c) => ` · low point ${formatRoadStation(c)}: place by site`).join('')}
                          {run.switchbacks
                            .map((c) => ` · switchback ${formatRoadStation(c)}: spacing by site`)
                            .join('')}
                        </span>
                      }
                      trailing={
                        <Badge tone={badge.tone} variant="outline">
                          {badge.label}
                        </Badge>
                      }
                      onClick={() => setStation((run.start + run.end) / 2)}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </StationValue>
      )}
      {hazard && (
        <p className="text-2xs leading-4 text-muted-foreground">
          Also check on the ground:{' '}
          {[...CROSS_DRAIN_PLACEMENT.requiredAt, ...CROSS_DRAIN_PLACEMENT.reduceSpacingAt]
            .filter((item) => !item.detected)
            .map((item) => item.label.toLowerCase())
            .join('; ')}
          .
        </p>
      )}
    </RoadSection>
  )
}
