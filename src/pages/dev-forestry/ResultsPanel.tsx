import { Check, Mountain, TriangleAlert, X } from 'lucide-react'

import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'

import { VisibilityProfile } from './VisibilityProfile'
import type { AnalysisResult, TargetPolygon, TargetVisibility } from './types'
import { VIEWING_ZONES, assessObjective, visualQualityClass, type VisualQualityThresholds } from './vqo'

function hectares(squareMeters: number): string {
  return `${(squareMeters / 10000).toLocaleString('en-CA', { maximumFractionDigits: 1 })} ha`
}

function kilometres(meters: number | null): string {
  return meters === null ? '—' : `${(meters / 1000).toFixed(2)} km`
}

function VerdictBadge({ met, label }: { met: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold',
        met
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
          : 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
      )}
    >
      {met ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </span>
  )
}

/** Visible ground split across foreground, middleground, and background. */
function ZoneBar({ target }: { target: TargetVisibility }) {
  const total = VIEWING_ZONES.reduce((sum, zone) => sum + (target.visibleAreaByZone[zone.id] ?? 0), 0)
  if (total <= 0) return null

  return (
    <div className="mt-2">
      {/* A 2px surface gap keeps adjacent segments from reading as one block. */}
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {VIEWING_ZONES.map((zone) => {
          const area = target.visibleAreaByZone[zone.id] ?? 0
          if (area <= 0) return null
          return (
            <span
              key={zone.id}
              className="h-full"
              style={{ backgroundColor: zone.color, width: `${(area / total) * 100}%` }}
            />
          )
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {VIEWING_ZONES.map((zone) => {
          const area = target.visibleAreaByZone[zone.id] ?? 0
          if (area <= 0) return null
          return (
            <span key={zone.id} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: zone.color }} />
              {zone.label} {hectares(area)}
            </span>
          )
        })}
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
  const landscapeTarget = landscape ? targetsById.get(landscape.targetId) : undefined
  const isCorridor = result.stations.length > 1

  const denudation = result.perspectiveDenudationPercent
  const verdict =
    denudation !== null && landscapeTarget ? assessObjective(denudation, landscapeTarget.objectiveId, thresholds) : null

  return (
    <div className="space-y-4">
      {result.missingTileCount > 0 && (
        <InlineAlert tone="warning">
          {result.missingTileCount} of {result.demTileCount} terrain tiles did not load. Sightlines crossing them are
          reported as clear, so these numbers read high.
        </InlineAlert>
      )}

      {verdict ? (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Altered share of the visible landscape</p>
              <p className="mt-0.5 text-3xl font-bold tabular-nums text-foreground">
                {denudation!.toFixed(1)}
                <span className="text-lg font-semibold">%</span>
              </p>
            </div>
            <VerdictBadge met={verdict.met} label={verdict.met ? 'Meets objective' : 'Exceeds objective'} />
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Measured from the assessment viewpoint against{' '}
            <span className="font-medium text-foreground">{landscapeTarget!.name}</span>. The{' '}
            {verdict.objective.label.toLowerCase()} objective allows {verdict.thresholdPercent}%; this alteration reads
            as{' '}
            <span className="font-medium" style={{ color: verdict.achieved?.color ?? verdict.objective.color }}>
              {verdict.achieved?.label ?? 'beyond maximum modification'}
            </span>
            .
          </p>
        </div>
      ) : (
        <InlineAlert>
          Percentages below are the share of each block that can be seen. A visual quality objective is written against
          the altered share of the <em>visible landscape</em>, so add a polygon as a visual landscape unit to get that
          number.
        </InlineAlert>
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
                  {hectares(block.areaMeters)} · objective {objective.code}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-2xl font-bold tabular-nums text-foreground">
                  {block.visiblePercent.toFixed(0)}
                  <span className="text-sm">%</span>
                </span>
                <span className="text-[11px] text-muted-foreground">visible</span>
              </span>
            </button>

            {block.outOfRange ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Beyond the {(result.settings.maxViewDistanceMeters / 1000).toFixed(0)} km view distance — not assessed.
              </p>
            ) : (
              <>
                <KeyValueRows
                  className="mt-2"
                  rows={[
                    {
                      label: isCorridor ? 'Seen from anywhere on the road' : 'Seen from the viewpoint',
                      value: `${hectares(block.visibleAreaMeters)} of ${hectares(block.areaMeters)}`,
                    },
                    {
                      label: 'Share of its apparent size in view',
                      value: `${block.apparentVisiblePercent.toFixed(1)}%`,
                    },
                    {
                      label: 'Nearest / furthest visible ground',
                      value: `${kilometres(block.nearestVisibleDistanceMeters)} / ${kilometres(
                        block.farthestVisibleDistanceMeters,
                      )}`,
                    },
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
            <span className="truncate text-sm font-semibold text-foreground">
              {landscapeTarget?.name ?? 'Visual landscape unit'}
            </span>
          </div>
          <KeyValueRows
            className="mt-2"
            rows={[
              { label: 'Unit area', value: hectares(landscape.areaMeters) },
              {
                label: 'Visible from the road',
                value: `${hectares(landscape.visibleAreaMeters)} (${landscape.visiblePercent.toFixed(0)}%)`,
              },
            ]}
          />
        </div>
      )}

      <div className="rounded-lg border border-border bg-muted/10 p-3">
        <KeyValueRows
          rows={[
            {
              label: 'Terrain detail',
              value: `${result.demResolutionMeters.toFixed(0)} m per sample · ${result.demTileCount} tiles`,
            },
            {
              label: 'Viewing stations',
              value: isCorridor
                ? `${result.stations.length} over ${(result.corridorLengthMeters / 1000).toFixed(2)} km`
                : '1 (spot)',
            },
            { label: 'Run time', value: `${(result.elapsedMs / 1000).toFixed(1)} s` },
          ]}
        />
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
          <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
          Bare-earth terrain only — standing timber, screening vegetation, and roadside cover are not modelled. This is
          a screening tool, not a visual impact assessment.
        </p>
      </div>
    </div>
  )
}
