import { useMemo } from 'react'

import { numberColumn, textColumn } from '@/components/map/tableColumns'
import { defineTableSource, useMapTable } from '@/components/map/useMapTable'
import { formatMeasure } from '@/lib/format'

import { ASSESSMENT_VIEWPOINT_COLOR, INVENTORY_COLORS } from './planMapStyle'
import type { ReverseRoadResult } from './reverseViewshed'
import { ROLE_COLORS, targetAreaHectares } from './scene'
import type { AnalysisResult, TargetPolygon, TargetRole } from './types'
import type { ViewpointCandidate } from './viewpointInventory'
import { polygonBounds } from './visibility'
import { visualQualityClass } from './vqo'

const ROLE_LABELS: Record<TargetRole, string> = {
  block: 'Cutblock',
  landscape: 'Landform',
  harvested: 'Existing opening',
}

const TARGET_COLUMNS = [
  textColumn<TargetPolygon>('name', 'Name', (target) => target.name),
  textColumn<TargetPolygon>('role', 'Kind', (target) => ROLE_LABELS[target.role]),
  textColumn<TargetPolygon>('objective', 'Objective', (target) =>
    target.role === 'harvested' ? null : visualQualityClass(target.objectiveId).label,
  ),
  numberColumn<TargetPolygon>('area', 'Area (ha)', (target) => targetAreaHectares(target), {
    format: (value) => formatMeasure(value, null, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  }),
  textColumn<TargetPolygon>('source', 'Source', (target) => target.source),
]

type ViewpointRow = ViewpointCandidate & { seenPercent: number | null }

const VIEWPOINT_COLUMNS = [
  textColumn<ViewpointRow>('name', 'Name', (row) => row.name),
  textColumn<ViewpointRow>('kind', 'Kind', (row) => (row.kind === 'rec-site' ? 'Rec site' : 'VLI viewpoint')),
  numberColumn<ViewpointRow>('distance', 'From the block (km)', (row) => row.distanceMeters / 1000, {
    format: (value) => formatMeasure(value, null, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  }),
  textColumn<ViewpointRow>('arrow', 'Arrow', (row) =>
    row.arrow ? (row.arrow.aims ? 'Points at the block' : `${Math.round(row.arrow.offsetDegrees)}° off`) : null,
  ),
  numberColumn<ViewpointRow>('seen', 'Block seen (%)', (row) => row.seenPercent, {
    format: (value) => formatMeasure(value, null, { maximumFractionDigits: 0 }),
  }),
]

type StationRow = {
  id: string
  number: number
  lng: number
  lat: number
  alongKm: number
  groundMeters: number
  alterationPercent: number | null
  assessment: boolean
}

const STATION_COLUMNS = [
  numberColumn<StationRow>('number', 'Station', (row) => row.number),
  numberColumn<StationRow>('along', 'Along the road (km)', (row) => row.alongKm, {
    format: (value) => formatMeasure(value, null, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  }),
  numberColumn<StationRow>('ground', 'Ground (m)', (row) => row.groundMeters, {
    format: (value) => formatMeasure(value, null, { maximumFractionDigits: 0 }),
  }),
  numberColumn<StationRow>('alteration', 'Alteration in view (%)', (row) => row.alterationPercent, {
    format: (value) => formatMeasure(value, null, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  }),
  textColumn<StationRow>('assessment', 'Assessment viewpoint', (row) => (row.assessment ? 'Yes' : null)),
]

/**
 * The shared table view of what the plan map draws: the scene's polygons, the
 * inventory viewpoints and rec sites around the selected block, and the run's
 * viewing stations. Rows are the ones on the map now.
 */
export function useVisualQualityTable({
  targets,
  candidates,
  checks,
  result,
  selectedTargetId,
  onSelectTarget,
}: {
  targets: readonly TargetPolygon[]
  candidates: readonly ViewpointCandidate[]
  /** The last "Check which of them see the block" rows, by candidate key. */
  checks: ReadonlyMap<string, ReverseRoadResult>
  result: AnalysisResult | null
  selectedTargetId: string | null
  onSelectTarget: (id: string) => void
}) {
  const sources = useMemo(() => {
    const viewpointRows: ViewpointRow[] = candidates.map((candidate) => ({
      ...candidate,
      seenPercent: checks.get(candidate.key)?.maxVisiblePercent ?? null,
    }))
    const stationRows: StationRow[] = (result?.stations ?? []).map((station, index) => ({
      id: `station-${index + 1}`,
      number: index + 1,
      lng: station.lng,
      lat: station.lat,
      alongKm: station.distanceAlongMeters / 1000,
      groundMeters: station.groundElevationMeters,
      alterationPercent: result?.perspectiveByStation[index]?.cumulativePercent ?? null,
      assessment: index === result?.assessmentStationIndex,
    }))
    return [
      ...(targets.length
        ? [
            defineTableSource<TargetPolygon>({
              id: 'polygons',
              label: 'Blocks, landforms and openings',
              color: ROLE_COLORS.block,
              shape: 'fill',
              rows: [...targets],
              columns: TARGET_COLUMNS,
              getRowId: (target) => target.id,
              getRowBounds: (target) => polygonBounds(target.geometry),
              getRowCenter: (target) => {
                const [west, south, east, north] = polygonBounds(target.geometry)
                return [(west + east) / 2, (south + north) / 2]
              },
            }),
          ]
        : []),
      ...(viewpointRows.length
        ? [
            defineTableSource<ViewpointRow>({
              id: 'viewpoints',
              label: 'Viewpoints and rec sites',
              color: INVENTORY_COLORS.viewpoint,
              shape: 'point',
              rows: viewpointRows,
              columns: VIEWPOINT_COLUMNS,
              getRowId: (row) => row.key,
              getRowCenter: (row) => [row.lng, row.lat],
            }),
          ]
        : []),
      ...(stationRows.length
        ? [
            defineTableSource<StationRow>({
              id: 'stations',
              label: 'Viewing stations',
              color: ASSESSMENT_VIEWPOINT_COLOR,
              shape: 'point',
              rows: stationRows,
              columns: STATION_COLUMNS,
              getRowId: (row) => row.id,
              getRowCenter: (row) => [row.lng, row.lat],
            }),
          ]
        : []),
    ]
  }, [targets, candidates, checks, result])

  return useMapTable({
    sources,
    selectedRowId: selectedTargetId,
    onSelectRow: (row: TargetPolygon | ViewpointRow | StationRow, source) => {
      if (source.id === 'polygons') onSelectTarget((row as TargetPolygon).id)
    },
  })
}
