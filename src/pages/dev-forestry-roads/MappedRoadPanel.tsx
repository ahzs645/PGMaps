import { useMemo } from 'react'
import { Copy, Crosshair, Mountain, Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { formatRoadStation } from './Charts'
import { BEND_CHORD_M, MAX_JOIN_GAP_M, reviewMappedRoad, SUSTAINED_GRADE_WINDOW_M } from './mappedRoad'
import { RoadOnTerrainFinder } from './RoadOnTerrainFinder'
import { RoadSection } from './SidebarParts'
import type { RoadWorkspace } from './useRoadWorkspace'

const metres = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.round(value)} m`)
const percent = (value: number, digits = 1) => `${value.toFixed(digits)}%`

/**
 * The active road is a mapped road loaded from context: what it is, how it was prepared, and how
 * its ground grades and bends sit against this project's own limits.
 */
export function MappedRoadPanel({
  workspace,
  full,
  onCopyAsDesign,
  onCompareRoutes,
  onLocate,
  onStation,
  onLoadTerrain,
  onPreviewTerrainRoad,
}: {
  workspace: RoadWorkspace
  full: boolean
  onCopyAsDesign: () => void
  onCompareRoutes: () => void
  onLocate?: () => void
  onStation: (chainage: number) => void
  /** Reloads regional terrain over the project's roads; offered when the terrain misses part of this one. */
  onLoadTerrain?: () => void
  /** Shows a road found on the terrain over the plan; null clears it. */
  onPreviewTerrainRoad?: (overlay: GeoJSON.FeatureCollection | null) => void
}) {
  const { alignment, analysis, project } = workspace
  const origin = alignment.mappedRoad
  const review = useMemo(
    () => reviewMappedRoad(analysis, project.settings, project.terrain.resolutionM),
    [analysis, project.settings, project.terrain.resolutionM],
  )
  if (!origin) return null
  const { maxGradePercent, minRadius } = project.settings
  const joins = origin.joinGapsM.length
  return (
    <RoadSection
      title="Mapped road"
      data-testid="mapped-road-panel"
      help={
        <>
          This road is a mapped record loaded as it is drawn. Its formation follows the sampled ground, so the profile
          and grades describe the mapped line on this terrain. It is not a design: its line is held as recorded, and its
          quantities and cost are not a construction estimate. Copy it as a design to edit it.
          <br />
          Grades are read over {SUSTAINED_GRADE_WINDOW_M} m of road so one terrain cell cannot make a steep pitch. Bends
          are the circle through points {BEND_CHORD_M} m either side along the mapped line, so a digitized corner reads
          as the bend it implies.
        </>
      }
    >
      <div className="space-y-2">
        <KeyValueRows
          variant="grid"
          valueClassName="tabular-nums"
          rows={[
            { key: 'road', label: 'Record', value: origin.roadName },
            origin.forestFileId
              ? {
                  key: 'permit',
                  label: 'Permit / section',
                  value: `${origin.forestFileId}${origin.roadSectionId ? ` / ${origin.roadSectionId}` : ''}`,
                }
              : null,
            {
              key: 'parts',
              label: 'Parts joined',
              value: `${origin.contextIds.length}${joins ? ` · ${joins} gap${joins === 1 ? '' : 's'} bridged (${origin.joinGapsM.map((g) => `${g} m`).join(', ')})` : ''}`,
            },
            {
              key: 'vertices',
              label: 'Vertices',
              value: `${alignment.points.length} of ${origin.sourceVertexCount} · thinned at ${origin.thinningToleranceM} m`,
            },
            { key: 'length', label: 'Length', value: metres(review.lengthM) },
          ]}
        />
        {origin.partsLeftOut > 0 && (
          <InlineAlert tone="warning">
            {origin.partsLeftOut} other part{origin.partsLeftOut === 1 ? '' : 's'} of this section had no end within{' '}
            {MAX_JOIN_GAP_M} m of the joined line and {origin.partsLeftOut === 1 ? 'was' : 'were'} left out.
          </InlineAlert>
        )}
        {review.terrainCoveragePercent < 99.5 && (
          <InlineAlert tone="warning">
            The terrain covers {percent(review.terrainCoveragePercent, 0)} of this road. Grades are missing where it
            runs off the terrain.
          </InlineAlert>
        )}
        {review.coarseTerrain && (
          <InlineAlert tone="info">
            The terrain is {project.terrain.resolutionM.toFixed(0)} m. It smooths short pitches, so read these grades as
            a floor. Import LiDAR (GeoTIFF, LAS or LAZ) under Terrain for the road&apos;s real grades.
          </InlineAlert>
        )}
        {onLoadTerrain && review.terrainCoveragePercent < 99.5 && (
          <Button size="sm" variant="outline" className="w-full gap-1" onClick={onLoadTerrain}>
            <Mountain className="size-3" /> Load regional terrain over this road
          </Button>
        )}
        <div className="flex items-center gap-1 pt-1">
          <p className="text-xs font-semibold">Against this project&apos;s limits</p>
          <InfoTip label="About the mapped-road review">
            The grade limit ({percent(maxGradePercent, 0)}) and minimum radius ({minRadius} m) are this project&apos;s
            design settings, not the standard the road was built to. A road over them is not wrong; it was built to
            different limits, for different traffic, or the map line is off the road bench.
          </InfoTip>
        </div>
        <KeyValueRows
          variant="grid"
          valueClassName="tabular-nums"
          rows={[
            {
              key: 'steepest',
              label: `Steepest ${SUSTAINED_GRADE_WINDOW_M} m`,
              value: review.steepest ? (
                <button
                  type="button"
                  className="underline decoration-dotted underline-offset-2"
                  onClick={() => onStation(review.steepest!.chainage)}
                >
                  {percent(review.steepest.gradePercent)} at {formatRoadStation(review.steepest.chainage)}
                </button>
              ) : (
                '—'
              ),
            },
            {
              key: 'over',
              label: `Over ${percent(maxGradePercent, 0)}`,
              value: `${metres(review.overLimitM)}${review.lengthM ? ` (${percent((review.overLimitM / review.lengthM) * 100, 0)})` : ''}`,
            },
            {
              key: 'bend',
              label: 'Tightest bend',
              value: review.tightestBend ? (
                <button
                  type="button"
                  className="underline decoration-dotted underline-offset-2"
                  onClick={() => onStation(review.tightestBend!.chainage)}
                >
                  ≈{Math.round(review.tightestBend.radiusM)} m at {formatRoadStation(review.tightestBend.chainage)}
                </button>
              ) : (
                'straight'
              ),
            },
            minRadius > 0
              ? { key: 'tight', label: `Under ${minRadius} m radius`, value: metres(review.belowMinRadiusM) }
              : null,
            { key: 'streams', label: 'Stream crossings', value: String(review.streamCrossings) },
          ]}
        />
        {review.overLimitRanges.length > 0 && (
          <ul className="space-y-0.5 text-xs" aria-label="Lengths over the grade limit">
            {review.overLimitRanges.slice(0, 6).map((range) => (
              <li key={range.start}>
                <button
                  type="button"
                  className="tabular-nums text-danger underline decoration-dotted underline-offset-2"
                  onClick={() => onStation(range.start)}
                >
                  {formatRoadStation(range.start)}–{formatRoadStation(range.end)} · up to{' '}
                  {percent(range.maxGradePercent)}
                </button>
              </li>
            ))}
            {review.overLimitRanges.length > 6 && (
              <li className="text-muted-foreground">and {review.overLimitRanges.length - 6} more</li>
            )}
          </ul>
        )}
        <RoadOnTerrainFinder workspace={workspace} onPreview={onPreviewTerrainRoad} onStation={onStation} />
        <div className="grid grid-cols-2 gap-1 pt-1">
          <Button size="sm" variant="outline" className="gap-1 px-1" disabled={full} onClick={onCopyAsDesign}>
            <Copy className="size-3" /> Copy as design
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 px-1"
            disabled={full || review.lengthM <= 0}
            title="Search terrain-cost routes between this road's ends with the route settings below"
            onClick={onCompareRoutes}
          >
            <Route className="size-3" /> Compare routes
          </Button>
        </div>
        {onLocate && (
          <Button size="sm" variant="ghost" className="w-full gap-1" onClick={onLocate}>
            <Crosshair className="size-3" /> Show on map
          </Button>
        )}
      </div>
    </RoadSection>
  )
}
