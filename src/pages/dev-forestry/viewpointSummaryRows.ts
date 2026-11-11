import type { MetricSummaryItem } from '@/components/ui/metric-summary'
import { formatMeasure } from '@/lib/format'
import { resolvedThresholds } from './integrity'
import { formatKm, formatPct } from './measureFormat'
import type { AlterationBreakdown, AnalysisResult, TargetPolygon } from './types'
import type { ViaAssessment } from './via'
import {
  assessObjective,
  rangeFloorFor,
  viewingZoneFor,
  visualQualityClass,
  type AlterationBasis,
  type VisualQualityClassId,
  type VisualQualityThresholds,
} from './vqo'

/**
 * The visual-quality "Viewpoint summary" rows. Everything here is read from the run, never
 * recomputed: per-station values from `perspectiveByStation` and each block's `stations`, run-wide
 * values from the run and the VIA assessment. Every percentage names the scale it was measured on,
 * because the perspective and planimetric ranges are not interchangeable (`vqo.ts`). Rows that the
 * run only has as a whole say so in their label.
 */
export type ViewpointSummaryInput = {
  result: AnalysisResult
  /** The road view's station while it is open, else the run's assessment station. */
  stationIndex: number
  /** Whether `stationIndex` is the road view's own position. */
  driving: boolean
  /** The road or viewpoint's name; "Standing at …" names a viewpoint the road view stands at. */
  viewpointName: string
  /** The block the road view faces or the sidebar selects; its share in view and slope are read. */
  block: { targetId: string; name: string } | null
  /** The landform being assessed, with the objective it carries. */
  landform: Pick<TargetPolygon, 'name' | 'objectiveId' | 'vac'> | null
  /** Where the landform's objective came from, when it was adopted from the inventory. */
  objectiveSource: 'established' | 'recommended' | 'chosen'
  thresholds: VisualQualityThresholds
  via: ViaAssessment | null
}

const km = (meters: number) => formatKm(meters, 2)
const metres = (value: number, digits = 0) =>
  formatMeasure(value, 'm', { minimumFractionDigits: digits, maximumFractionDigits: digits })

function verdictNote(
  breakdown: AlterationBreakdown,
  basis: AlterationBasis,
  objectiveId: VisualQualityClassId,
  vac: TargetPolygon['vac'],
  thresholds: VisualQualityThresholds,
) {
  const resolved = resolvedThresholds(objectiveId, basis, thresholds, vac)
  const verdict = assessObjective(breakdown.cumulativePercent, objectiveId, basis, resolved)
  const range = `${rangeFloorFor(objectiveId, basis, resolved)}–${verdict.thresholdPercent}%`
  return {
    met: verdict.met,
    note: `${verdict.objective.code} range ${range} on this scale · reads as ${
      verdict.achieved?.label.toLowerCase() ?? 'beyond maximum modification'
    }${breakdown.existingPercent > 0 ? ` · ${formatPct(breakdown.existingPercent)} already harvested` : ''}`,
  }
}

export function viewpointSummaryMetrics(input: ViewpointSummaryInput): MetricSummaryItem[] {
  const { result, landform, thresholds, via } = input
  const index = Math.max(0, Math.min(input.stationIndex, result.stations.length - 1))
  const station = result.stations[index]
  const corridor = result.stations.length > 1
  const numericalReady = !!result.quality?.numericalReady
  const block =
    result.targets.find((target) => target.targetId === input.block?.targetId && target.role === 'block') ??
    result.targets.find((target) => target.role === 'block')
  const blockName = input.block?.targetId === block?.targetId ? input.block?.name : 'the block'
  const here = input.driving ? 'road view station' : 'assessment station'
  const rows: MetricSummaryItem[] = []

  if (station) {
    rows.push({
      key: 'viewpoint',
      label: 'Viewpoint',
      value: corridor ? `${km(station.distanceAlongMeters)} along` : 'Spot',
      note: `${input.viewpointName || 'The road'} · ${here} · ground ${
        Number.isFinite(station.groundElevationMeters) ? metres(station.groundElevationMeters) : 'unknown'
      } + ${metres(result.settings.observerHeightMeters, 1)} eye height`,
    })
  }

  const exposure = block?.stations[index]
  if (block && exposure) {
    const incomplete = (exposure.unknownPercent ?? 0) > 0
    rows.push({
      key: 'in-view',
      label: 'Block ground in view here',
      value: incomplete ? 'Terrain incomplete' : formatPct(exposure.visiblePercent, 0),
      note: `${blockName}: the share of its ground the terrain lets this station see, not the share of the screen${
        incomplete ? `; ${formatPct(exposure.unknownPercent, 0)} of it is over missing terrain` : ''
      }`,
      tone: incomplete ? 'warning' : 'default',
    })
  }

  if (landform) {
    const atStation = result.perspectiveByStation[index] ?? null
    if (!numericalReady || !atStation) {
      rows.push({
        key: 'perspective',
        label: 'Perspective alteration here · perspective scale',
        value: numericalReady ? 'Unknown here' : 'Withheld',
        note: numericalReady
          ? 'This station has no complete view of the landform (missing terrain or no visible green area)'
          : 'The run is provisional: resolve its warnings in Assessment & report for a numerical figure',
        tone: 'warning',
      })
    } else {
      const verdict = verdictNote(atStation, 'perspective', landform.objectiveId, landform.vac, thresholds)
      rows.push({
        key: 'perspective',
        label: 'Perspective alteration here · perspective scale',
        value: formatPct(atStation.cumulativePercent),
        note: `From this station, apparent area · ${verdict.note}`,
        tone: verdict.met ? 'default' : 'warning',
      })
    }

    const planimetric = result.planimetricAlteration
    if (numericalReady && planimetric) {
      const verdict = verdictNote(planimetric, 'planimetric', landform.objectiveId, landform.vac, thresholds)
      rows.push({
        key: 'planimetric',
        label: 'Planimetric denudation · planimetric scale',
        value: formatPct(planimetric.cumulativePercent),
        note: `${landform.name}, flat map area from any viewpoint, of its ${
          result.landformForestedAreaMeters !== null ? 'treed area' : 'whole area (no inventory)'
        } · ${verdict.note}`,
        tone: verdict.met ? 'default' : 'warning',
      })
    } else {
      rows.push({
        key: 'planimetric',
        label: 'Planimetric denudation · planimetric scale',
        value: 'Withheld',
        note: planimetric
          ? 'The run is provisional: resolve its warnings in Assessment & report for a numerical figure'
          : 'The run has no landform area to divide by',
        tone: 'warning',
      })
    }

    const objective = visualQualityClass(landform.objectiveId)
    rows.push({
      key: 'objective',
      label: 'Visual quality objective',
      value: `${objective.code} · ${objective.label}`,
      note:
        input.objectiveSource === 'established'
          ? `Established (EVQO) in the visual landscape inventory for ${landform.name}`
          : input.objectiveSource === 'recommended'
            ? `Recommended in the visual landscape inventory; no objective is established for ${landform.name}`
            : `Set for ${landform.name} in this assessment, not read from the inventory`,
    })
  }

  if (block && block.nearestVisibleDistanceMeters !== null && block.farthestVisibleDistanceMeters !== null) {
    const near = viewingZoneFor(block.nearestVisibleDistanceMeters)
    const far = viewingZoneFor(block.farthestVisibleDistanceMeters)
    rows.push({
      key: 'distance',
      label: corridor ? 'Visible ground distance · whole road' : 'Visible ground distance',
      value: `${formatKm(block.nearestVisibleDistanceMeters, 1)} – ${formatKm(block.farthestVisibleDistanceMeters, 1)}`,
      note: `${blockName}, nearest to farthest visible ground · ${
        near.id === far.id ? near.label.toLowerCase() : `${near.label.toLowerCase()} to ${far.label.toLowerCase()}`
      }${corridor ? ' · measured over every station, not this one alone' : ''}`,
    })
  }

  if (via) {
    const rated = via.rating
    rows.push({
      key: 'via',
      label: 'VIA rating · perspective scale',
      value: rated ? rated.label : via.initialPercent === null ? 'Not rated' : 'In review',
      note: [
        `X ${via.initialPercent === null ? '—' : formatPct(via.initialPercent)}`,
        `adjusted ${via.adjusted ? formatPct(via.adjusted.percent) : '—'}`,
        via.adjusted?.classId ? visualQualityClass(via.adjusted.classId).code : null,
        `objective ${via.objective.code}`,
        !rated && via.missing.length ? `next: ${via.missing[0]}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      tone: rated?.tone ?? 'default',
    })
  }

  if (block && block.meanSlopePercent !== null && block.vegHeightMeters !== null) {
    rows.push({
      key: 'slope',
      label: 'Mean slope · green-up height',
      value: `${formatPct(block.meanSlopePercent, 0)} · ${metres(block.vegHeightMeters, 1)}`,
      // The height is the run's, weighted over the block's slope classes (1998 Step 5), not read off the mean.
      note: `${blockName}; green-up height weighted over its slope classes, not read off the mean slope`,
    })
  }

  rows.push({
    key: 'status',
    label: 'Numerical status',
    value: numericalReady ? 'Ready' : 'Provisional',
    note: numericalReady
      ? 'The run meets the conditions for numerical figures'
      : (result.quality?.warnings[0] ?? 'The run did not record why it is provisional'),
    tone: numericalReady ? 'default' : 'warning',
  })
  return rows
}
