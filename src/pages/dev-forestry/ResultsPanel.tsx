import { Check, Mountain, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { StackedShareBar } from '@/components/ui/share-bars'
import { StatGroup } from '@/components/ui/stat-group'
import { formatMeasure, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { VisibilityProfile } from './VisibilityProfile'
import { greenUpBasisLine, runGreenUpBasis } from './greenUp'
import { formatHa, formatKm, formatPct } from './measureFormat'
import { resolvedThresholds, resolveThreshold } from './integrity'
import type { AlterationBreakdown, AnalysisResult, TargetPolygon, TargetVisibility } from './types'
import {
  VIEWING_ZONES,
  assessObjective,
  rangeFloorFor,
  visualQualityClass,
  type AlterationBasis,
  type ObjectiveVerdict,
  type VisualQualityThresholds,
} from './vqo'

/** One reported percentage, the scale it is on, and how it fares there. */
type AlterationScale = {
  basis: AlterationBasis
  title: string
  breakdown: AlterationBreakdown
  verdict: ObjectiveVerdict
  note: string
}

function VerdictBadge({ met, label }: { met: boolean; label: string }) {
  return (
    <Badge tone={met ? 'success' : 'danger'} size="sm" className="font-semibold">
      {met ? <Check className="h-3 w-3" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
      {label}
    </Badge>
  )
}

/** Visible ground split across foreground, middleground, and background. */
function ZoneBar({ target }: { target: TargetVisibility }) {
  const zones = VIEWING_ZONES.map((zone) => ({ ...zone, area: target.visibleAreaByZone[zone.id] ?? 0 })).filter(
    (zone) => zone.area > 0,
  )
  const total = zones.reduce((sum, zone) => sum + zone.area, 0)
  if (total <= 0) return null

  return (
    <div className="mt-2">
      {/* The legend below names each segment and its area, so the bar is decoration. */}
      <StackedShareBar
        className="h-2 rounded-full"
        aria-hidden="true"
        total={total}
        segments={zones.map((zone) => ({
          key: zone.id,
          value: zone.area,
          color: zone.color,
          title: `${zone.label} ${formatHa(zone.area)}`,
        }))}
      />
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
        {zones.map((zone) => (
          <span key={zone.id} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: zone.color }} />
            {zone.label} {formatHa(zone.area)}
          </span>
        ))}
      </div>
    </div>
  )
}

type ResultsPanelProps = {
  result: AnalysisResult
  targets: TargetPolygon[]
  thresholds: VisualQualityThresholds
  selectedTargetId: string | null
  onSelectTarget: (targetId: string) => void
  drivePositionMeters: number | null
  onSeek: (distanceMeters: number) => void
}

export function ResultsPanel({
  result,
  targets,
  thresholds,
  selectedTargetId,
  onSelectTarget,
  drivePositionMeters,
  onSeek,
}: ResultsPanelProps) {
  const targetsById = new Map(targets.map((target) => [target.id, target]))
  const blocks = result.targets.filter((target) => target.role === 'block')
  const landscape = result.targets.find((target) => target.role === 'landscape')
  const landformTarget = landscape ? targetsById.get(landscape.targetId) : undefined
  const isCorridor = result.stations.length > 1
  // Which green-up the existing share rests on: a field check or the model.
  const greenUpLine = greenUpBasisLine(runGreenUpBasis(result))

  // The two scales answer different questions and have different thresholds, so
  // each is judged against its own. Reporting only one of them is how a
  // perspective number ends up measured against a planimetric allowance.
  const scales: AlterationScale[] = []
  if (landformTarget) {
    const add = (basis: AlterationBasis, title: string, breakdown: AlterationBreakdown | null, note: string) => {
      if (!breakdown) return
      scales.push({
        basis,
        title,
        breakdown,
        verdict: assessObjective(
          breakdown.cumulativePercent,
          landformTarget.objectiveId,
          basis,
          resolvedThresholds(landformTarget.objectiveId, basis, thresholds, landformTarget.vac),
        ),
        note,
      })
    }

    if (result.quality?.numericalReady)
      add(
        'perspective',
        'Alteration in perspective view',
        result.perspectiveAlteration,
        'Estimated apparent-area screening ratio from the selected assessment station; not a calibrated photographic measurement.',
      )
    if (result.quality?.numericalReady)
      add(
        'planimetric',
        'Planimetric denudation',
        result.planimetricAlteration,
        `Flat map area, visible or not — the scale timber supply analyses model against.${
          landscape?.forestedAreaMeters !== null && landscape?.forestedAreaMeters !== undefined
            ? ' Divided by the landform\u2019s treed area, which is what the procedure asks for.'
            : ' Divided by the whole landform: no vegetation inventory, so the figure reads low by however much of it was never forest.'
        }${' ' + resolveThreshold(landformTarget.objectiveId, 'planimetric', thresholds, landformTarget.vac).note}`,
      )
  }

  return (
    <div className="space-y-4">
      {result.missingTileCount > 0 && (
        <InlineAlert tone="warning">
          {result.missingTileCount} of {result.demTileCount} terrain tiles did not load. Sightlines crossing them are
          unknown unless a known obstruction establishes occlusion. Numerical form fields may be withheld.
        </InlineAlert>
      )}

      {scales.length > 0 ? (
        <div className="space-y-2">
          <StatGroup
            variant="tiles"
            size="md"
            aria-label="Landform alteration"
            // One tile per row: side by side, the scale names truncate in a sidebar.
            className="grid-cols-1"
            items={scales.map((scale) => ({
              key: scale.basis,
              label: scale.title,
              value: formatPct(scale.breakdown.cumulativePercent),
              valueClassName: 'text-2xl workspace-sm:text-3xl',
              // What is already on the ground versus what this proposal adds —
              // the objective is met or missed by the total, not the increment.
              note: (
                <span className="mt-1 flex flex-col items-start gap-1">
                  <VerdictBadge met={scale.verdict.met} label={scale.verdict.met ? 'Within range' : 'Over range'} />
                  {scale.breakdown.existingPercent > 0 && (
                    <span className="tabular-nums">
                      {formatPct(scale.breakdown.existingPercent)} already harvested +{' '}
                      {formatPct(scale.breakdown.proposedPercent)} proposed
                    </span>
                  )}
                  {scale.breakdown.existingPercent > 0 && (
                    <span className="text-2xs leading-4 text-muted-foreground">{greenUpLine}</span>
                  )}
                </span>
              ),
            }))}
          />
          {scales.map((scale) => (
            <p key={scale.basis} className="text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">
                {scale.basis === 'perspective' ? 'Perspective' : 'Planimetric'}:
              </span>{' '}
              against <span className="font-medium text-foreground">{landformTarget!.name}</span>, the{' '}
              {scale.verdict.objective.label.toLowerCase()} range is{' '}
              {rangeFloorFor(
                landformTarget!.objectiveId,
                scale.basis,
                resolvedThresholds(landformTarget!.objectiveId, scale.basis, thresholds, landformTarget!.vac),
              )}
              –{scale.verdict.thresholdPercent}%. This reads as{' '}
              <span
                className="font-medium"
                style={{ color: scale.verdict.achieved?.color ?? scale.verdict.objective.color }}
              >
                {scale.verdict.achieved?.label ?? 'beyond maximum modification'}
              </span>
              . {scale.note}
            </p>
          ))}
          <p className="text-2xs leading-4 text-muted-foreground">
            Numeric range only. The regulation also weighs scale, whether the alteration looks natural, and whether it
            is rectilinear or geometric — a visual design review still decides whether the objective is achieved.
          </p>
        </div>
      ) : (
        // Provisional with a landform: the Viewpoint summary and the step headline already say so.
        !landformTarget && (
          <InlineAlert>
            Per-block percentages describe visibility, not landform alteration. Select an active, delineated landform to
            compute an alteration ratio.
          </InlineAlert>
        )
      )}

      {blocks.map((block) => {
        const target = targetsById.get(block.targetId)
        if (!target) return null
        const objective = visualQualityClass(target.objectiveId)
        const selected = selectedTargetId === block.targetId

        return (
          <div
            key={block.targetId}
            className={cn(
              'rounded-lg border p-3 transition-colors',
              selected ? 'border-primary/60 bg-muted/30' : 'border-border',
            )}
          >
            <button
              type="button"
              onClick={() => onSelectTarget(block.targetId)}
              className="flex w-full items-start justify-between gap-2 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">{target.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatHa(block.areaMeters)} · objective {objective.code}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-2xl font-bold tabular-nums text-foreground">
                  {formatNumber(block.visiblePercent)}
                  <span className="text-sm">%</span>
                </span>
                <span className="text-2xs text-muted-foreground">visible</span>
              </span>
            </button>

            {block.outOfRange ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Beyond the {formatKm(result.settings.maxViewDistanceMeters, 0)} view distance — not assessed.
              </p>
            ) : (
              <>
                <KeyValueRows
                  className="mt-2"
                  rows={[
                    {
                      label: isCorridor ? 'Seen from anywhere on the road' : 'Seen from the viewpoint',
                      value: `${formatHa(block.visibleAreaMeters)} of ${formatHa(block.areaMeters)}`,
                    },
                    {
                      label: 'Share of its apparent size in view',
                      value: formatPct(block.apparentVisiblePercent),
                    },
                    {
                      label: 'Nearest / furthest visible ground',
                      value: `${formatKm(block.nearestVisibleDistanceMeters)} / ${formatKm(
                        block.farthestVisibleDistanceMeters,
                      )}`,
                    },
                    ...(block.meanSlopePercent !== null && block.vegHeightMeters !== null
                      ? [
                          {
                            // Steeper ground shows more of the cut surface, so
                            // regeneration has to be taller before the opening
                            // reads as forest again. The height is weighted over
                            // the block's own slope classes rather than read off
                            // the mean, which is what the procedure asks for.
                            label: 'Mean slope · green-up height',
                            value: `${formatPct(block.meanSlopePercent, 0)} · ${formatMeasure(block.vegHeightMeters, 'm', { minimumFractionDigits: 1 })}`,
                          },
                        ]
                      : []),
                  ]}
                />
                <ZoneBar target={block} />

                {isCorridor && selected && (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="mb-1 text-xs font-medium text-foreground">Visible share along the road</p>
                    <VisibilityProfile
                      stations={block.stations}
                      assessmentIndex={result.assessmentStationIndex}
                      positionMeters={drivePositionMeters}
                      onSeek={onSeek}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}

      {landscape && (
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <Mountain className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            <span className="truncate text-sm font-semibold text-foreground">{landformTarget?.name ?? 'Landform'}</span>
          </div>
          <KeyValueRows
            className="mt-2"
            rows={[
              { label: 'Landform area', value: formatHa(landscape.areaMeters) },
              {
                // The denudation denominator. Where the inventory answered, it
                // is the treed part; otherwise the whole landform, which reads
                // the planimetric figure low.
                label: 'Forested area (denudation base)',
                value:
                  landscape.forestedAreaMeters !== null
                    ? `${formatHa(landscape.forestedAreaMeters)} (${formatPct(
                        (landscape.forestedAreaMeters / Math.max(1, landscape.areaMeters)) * 100,
                        0,
                      )} treed)`
                    : 'Whole landform — no inventory',
              },
              {
                label: 'Visible from the road',
                value: `${formatHa(landscape.visibleAreaMeters)} (${formatPct(landscape.visiblePercent, 0)})`,
              },
              {
                label: 'Visual absorption capability',
                value: landformTarget?.vac
                  ? `${landformTarget.vac[0].toUpperCase()}${landformTarget.vac.slice(1)}`
                  : 'Not rated',
              },
            ]}
          />
        </div>
      )}

      <div className="rounded-lg border border-border bg-muted/10 p-3">
        <KeyValueRows
          rows={[
            {
              // One line in place of the old caveat paragraph; the reason is in the tooltip.
              label: 'Screening',
              value: (
                <span
                  title={
                    result.canopyCoverageFraction === null
                      ? 'Standing timber is not modelled, so screened blocks read as visible. Screening figures from sightlines; the handbook rating is made in steps 4 and 5.'
                      : 'Terrain plus inventory stand height. Understorey, roadside cover and retention inside a block are not modelled.'
                  }
                >
                  {result.canopyCoverageFraction === null ? 'Bare earth only' : 'Terrain + stand height'}
                </span>
              ),
            },
            {
              label: 'Terrain detail',
              value: `${formatMeasure(result.demResolutionMeters, 'm', { maximumFractionDigits: 0 })} per sample · ${result.demTileCount} tiles`,
            },
            {
              label: 'Viewing stations',
              value: isCorridor
                ? `${result.stations.length} over ${formatKm(result.corridorLengthMeters)}`
                : '1 (spot)',
            },
            {
              label: 'Run time',
              value: formatMeasure(result.elapsedMs / 1000, 's', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }),
            },
          ]}
        />
      </div>
    </div>
  )
}
