import type { MetricSummaryItem } from '@/components/ui/metric-summary'
import { formatMeasure } from '@/lib/format'
import { resolvedThresholds } from './integrity'
import { runGreenUpBasis } from './greenUp'
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
 * values from the run and the VIA assessment. Every percentage names the scale it was measured on
 * in its `qualifier`, the line under its label, because the perspective and planimetric ranges are
 * not interchangeable (`vqo.ts`). Rows that the run only has as a whole say so there too. Labels
 * stay short enough for a card; the explanation is the note. Why a provisional run withholds its
 * figures is said once, by the status row.
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
  result: AnalysisResult,
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
    }${
      breakdown.existingPercent > 0
        ? ` · ${formatPct(breakdown.existingPercent)} already harvested (green-up ${runGreenUpBasis(result).label})`
        : ''
    }`,
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
  const withheld = 'Withheld while the run is provisional; see Numerical figures'
  const rows: MetricSummaryItem[] = []

  if (station) {
    rows.push({
      key: 'viewpoint',
      label: 'Viewpoint',
      qualifier: input.driving ? 'road view' : 'assessment station',
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
      label: 'Block ground in view',
      qualifier: 'this station',
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
        label: 'Alteration here',
        qualifier: 'perspective scale',
        value: numericalReady ? 'Unknown here' : 'Withheld',
        note: numericalReady
          ? 'This station has no complete view of the landform (missing terrain or no visible green area)'
          : withheld,
        tone: numericalReady ? 'warning' : 'muted',
      })
    } else {
      const verdict = verdictNote(result, atStation, 'perspective', landform.objectiveId, landform.vac, thresholds)
      rows.push({
        key: 'perspective',
        label: 'Alteration here',
        qualifier: 'perspective scale',
        value: formatPct(atStation.cumulativePercent),
        note: `From this station, apparent area · ${verdict.note}`,
        tone: verdict.met ? 'default' : 'warning',
      })
    }

    const planimetric = result.planimetricAlteration
    if (numericalReady && planimetric) {
      const verdict = verdictNote(result, planimetric, 'planimetric', landform.objectiveId, landform.vac, thresholds)
      rows.push({
        key: 'planimetric',
        label: 'Denudation',
        qualifier: 'planimetric scale',
        value: formatPct(planimetric.cumulativePercent),
        note: `${landform.name}, flat map area from any viewpoint, of its ${
          result.landformForestedAreaMeters !== null ? 'treed area' : 'whole area (no inventory)'
        } · ${verdict.note}`,
        tone: verdict.met ? 'default' : 'warning',
      })
    } else {
      rows.push({
        key: 'planimetric',
        label: 'Denudation',
        qualifier: 'planimetric scale',
        value: 'Withheld',
        note: planimetric ? withheld : 'The run has no landform area to divide by',
        tone: planimetric ? 'muted' : 'warning',
      })
    }

    const objective = visualQualityClass(landform.objectiveId)
    rows.push({
      key: 'objective',
      label: 'Objective',
      qualifier:
        input.objectiveSource === 'established'
          ? 'established'
          : input.objectiveSource === 'recommended'
            ? 'recommended'
            : 'set in assessment',
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
      label: 'Visible distance',
      qualifier: corridor ? 'whole road' : undefined,
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
      label: 'VIA rating',
      qualifier: 'perspective scale',
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
      label: 'Mean slope · green-up',
      value: `${formatPct(block.meanSlopePercent, 0)} · ${metres(block.vegHeightMeters, 1)}`,
      // The height is the run's, weighted over the block's slope classes (1998 Step 5), not read off the mean.
      note: `${blockName}; green-up height weighted over its slope classes, not read off the mean slope`,
    })
  }

  rows.push({
    key: 'status',
    label: 'Numerical figures',
    value: numericalReady ? 'Ready' : 'Provisional',
    note: numericalReady
      ? 'The run meets the conditions for numerical figures'
      : `${result.quality?.warnings[0] ?? 'The run did not record why it is provisional.'} Alteration figures are withheld until its warnings are resolved in Assessment & report.`,
    tone: numericalReady ? 'default' : 'warning',
  })
  return rows
}

const hectares = (meters: number) =>
  formatMeasure(meters / 10_000, 'ha', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/**
 * The run's own results as cards, the figures step 3's Results panel shows: the landform's
 * alteration at the assessment station with its existing and proposed parts, how much of the
 * block and landform the whole road sees, the denudation base, and how the run was made. Read from
 * the run, never recomputed. Only `result-alteration` shows by default (`ViewpointSummary`).
 */
export function runResultMetrics(
  input: Pick<ViewpointSummaryInput, 'result' | 'block' | 'landform' | 'thresholds'>,
): MetricSummaryItem[] {
  const { result, landform, thresholds } = input
  const numericalReady = !!result.quality?.numericalReady
  const corridor = result.stations.length > 1
  const whole = corridor ? 'whole road' : 'the viewpoint'
  const block =
    result.targets.find((target) => target.targetId === input.block?.targetId && target.role === 'block') ??
    result.targets.find((target) => target.role === 'block')
  const blockName = input.block?.targetId === block?.targetId ? input.block?.name : 'the block'
  const landscape = result.targets.find((target) => target.role === 'landscape')
  const station = result.stations[result.assessmentStationIndex]
  const rows: MetricSummaryItem[] = []

  const perspective = result.perspectiveAlteration
  if (landform && perspective) {
    const verdict = numericalReady
      ? verdictNote(result, perspective, 'perspective', landform.objectiveId, landform.vac, thresholds)
      : null
    rows.push({
      key: 'result-alteration',
      label: 'Landform alteration',
      qualifier: 'perspective · the run',
      value: verdict ? formatPct(perspective.cumulativePercent) : 'Withheld',
      note: verdict
        ? `The run's figure, from the assessment station${station ? ` at ${km(station.distanceAlongMeters)}` : ''} · ${verdict.note}`
        : 'Withheld while the run is provisional; see Numerical figures',
      tone: verdict ? (verdict.met ? 'default' : 'warning') : 'muted',
    })
    if (numericalReady)
      rows.push({
        key: 'result-split',
        label: 'Existing + proposed',
        qualifier: 'perspective · the run',
        value: `${formatPct(perspective.existingPercent)} + ${formatPct(perspective.proposedPercent)}`,
        note: `Already harvested and not greened up (green-up ${runGreenUpBasis(result).label}), plus what this proposal adds; the objective is met or missed by the total`,
      })
  }

  if (block && !block.outOfRange) {
    rows.push({
      key: 'result-block-seen',
      label: 'Block ground seen',
      qualifier: whole,
      value: `${hectares(block.visibleAreaMeters)} of ${hectares(block.areaMeters)}`,
      note: `${blockName}: ground seen from anywhere on the ${corridor ? 'road' : 'viewpoint'}, flat map area`,
    })
    rows.push({
      key: 'result-apparent',
      label: 'Apparent size in view',
      qualifier: whole,
      value: formatPct(block.apparentVisiblePercent),
      note: `${blockName}: the share of its apparent size (solid angle) the terrain leaves in view`,
    })
  }

  if (landscape) {
    rows.push({
      key: 'result-landform-seen',
      label: 'Landform seen',
      qualifier: whole,
      value: `${hectares(landscape.visibleAreaMeters)} (${formatPct(landscape.visiblePercent, 0)})`,
      note: `${landform?.name ?? 'The landform'}: ${hectares(landscape.areaMeters)} in all`,
    })
    rows.push({
      key: 'result-forested',
      label: 'Forested area',
      qualifier: 'denudation base',
      value:
        landscape.forestedAreaMeters !== null
          ? `${hectares(landscape.forestedAreaMeters)} (${formatPct((landscape.forestedAreaMeters / Math.max(1, landscape.areaMeters)) * 100, 0)})`
          : 'Whole landform',
      note:
        landscape.forestedAreaMeters !== null
          ? 'The treed part of the landform (VRI), which the planimetric figure divides by'
          : 'No vegetation inventory: the planimetric figure divides by the whole landform and reads low',
      tone: landscape.forestedAreaMeters !== null ? 'default' : 'warning',
    })
  }

  rows.push({
    key: 'result-screening',
    label: 'Screening',
    value: result.canopyCoverageFraction === null ? 'Bare earth' : 'Terrain + stands',
    note:
      result.canopyCoverageFraction === null
        ? 'Standing timber is not modelled, so screened blocks read as visible'
        : 'Terrain plus inventory stand height; understorey, roadside cover and retention inside a block are not modelled',
  })
  rows.push({
    key: 'result-stations',
    label: 'Viewing stations',
    value: corridor ? `${result.stations.length} over ${km(result.corridorLengthMeters)}` : '1 (spot)',
    note: `Terrain at ${metres(result.demResolutionMeters)} per sample from ${result.demTileCount} tiles`,
  })
  return rows
}
