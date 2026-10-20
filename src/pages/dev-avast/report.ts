/**
 * Turns per-candidate overlay totals into the planning table: gross area,
 * coverage, the LiDAR calibration factor (Part 2), the volume source of each
 * block, slope-class volumes (Part 3), the reported volume and the notes.
 * Everything here is cheap, so report settings re-summarise without
 * re-running the overlay. Pure: no DOM or network access.
 */
import { slopeClassLabel } from './slope'
import type {
  AvastSettings,
  Calibration,
  CalibrationRow,
  Candidate,
  CandidateRaw,
  CandidateSummary,
  ReportSettings,
  RunSummary,
  VolumeSource,
} from './types'

export const DEFAULT_SETTINGS: AvastSettings = {
  slopeSource: 'dem',
  slopeBreaks: [35, 45],
  demZoom: 13,
  slopeCellMeters: 20,
  minPieceHa: 0.0001,
  projectName: '',
  sourceType: '',
  grossArea: 'field',
  coverageGoodPct: 90,
  coverageModeratePct: 70,
  coverageLowPct: 5,
  lidarMode: 'none',
  lidarFactor: 0.8093,
  lidarFactorNote: 'Blackwater calibration area (LiDAR ÷ AVAST over the same footprint)',
  directLidarMinCoveragePct: 90,
  calibrationMinCoveragePct: 95,
  calibrationOperatingAreas: [],
  volumeBasis: 'total',
  vphDecimals: 0,
  referenceTargetM3: null,
  pasteStartRow: 6,
  notesIncludeSlope: false,
  duplicates: 'flag',
  excludedOperatingAreas: [],
}

/** The wording the Dunkley workbook uses, so pasted rows read the same as existing ones. */
export const COVERAGE_NOTES = {
  good: 'Good AVAST coverage. Volume estimate is considered suitable for first-pass screening.',
  moderate: 'Moderate AVAST coverage. Volume estimate is generally useful for screening, but non-covered portions should be reviewed if this shape is advanced.',
  low: 'Low AVAST coverage. Volume estimate should be treated as incomplete and used for screening only. Additional inventory data may be required.',
  none: 'Little/no AVAST coverage. Estimated volume could not be calculated from AVAST for this proposed shape.',
} as const

export type ReportContext = {
  avastLayerNames: string[]
  lidarLayerNames: string[]
  slopeAssessed: boolean
}

export function coverageClass(percent: number, settings: Pick<ReportSettings, 'coverageGoodPct' | 'coverageModeratePct' | 'coverageLowPct'>): CandidateSummary['coverageClass'] {
  if (percent >= settings.coverageGoodPct) return 'good'
  if (percent >= settings.coverageModeratePct) return 'moderate'
  if (percent >= settings.coverageLowPct) return 'low'
  return 'none'
}

/** Rounds like Excel's ROUND so a VPH typed back in reproduces the sheet. */
export function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals
  return Math.round((value + Number.EPSILON) * scale) / scale
}

const fmt = (value: number, digits = 0) => value.toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: digits })

/**
 * Part 2's aggregate factor: total LiDAR ÷ total AVAST over the common
 * footprint, which weights blocks by volume — never the mean of per-block
 * ratios.
 */
export function calibrate(
  candidates: Candidate[],
  raws: Map<string, CandidateRaw>,
  settings: Pick<ReportSettings, 'calibrationMinCoveragePct' | 'calibrationOperatingAreas'>,
  eligible: (candidate: Candidate) => boolean = () => true,
): Calibration {
  const areas = new Set(settings.calibrationOperatingAreas)
  const rows: CalibrationRow[] = []
  for (const candidate of candidates) {
    const raw = raws.get(candidate.key)
    if (!raw?.common || !eligible(candidate)) continue
    if (areas.size && !areas.has(candidate.operatingArea || raw.avast.operatingArea)) continue
    const commonPct = (100 * raw.common.areaHa) / candidate.geometryHa
    if (commonPct < settings.calibrationMinCoveragePct) continue
    rows.push({
      key: candidate.key,
      id: candidate.id,
      operatingArea: candidate.operatingArea || raw.avast.operatingArea,
      commonAreaHa: raw.common.areaHa,
      avastVolume: raw.common.avastVolume,
      lidarVolume: raw.common.lidarVolume,
      factor: raw.common.avastVolume > 0 ? raw.common.lidarVolume / raw.common.avastVolume : null,
    })
  }
  const commonAreaHa = rows.reduce((sum, row) => sum + row.commonAreaHa, 0)
  const avastVolume = rows.reduce((sum, row) => sum + row.avastVolume, 0)
  const lidarVolume = rows.reduce((sum, row) => sum + row.lidarVolume, 0)
  return {
    rows,
    commonAreaHa,
    avastVolume,
    lidarVolume,
    avastWeighted: commonAreaHa > 0 ? avastVolume / commonAreaHa : null,
    lidarWeighted: commonAreaHa > 0 ? lidarVolume / commonAreaHa : null,
    factor: avastVolume > 0 ? lidarVolume / avastVolume : null,
  }
}

export function summarize(
  candidates: Candidate[],
  raws: Map<string, CandidateRaw>,
  settings: AvastSettings,
  context: ReportContext,
): RunSummary {
  const excludedAreas = new Set(settings.excludedOperatingAreas)
  const seen = new Set<string>()
  const duplicateKeys = new Set<string>()
  for (const candidate of candidates) {
    const id = candidate.id.trim()
    if (!id) continue
    if (seen.has(id)) duplicateKeys.add(candidate.key)
    seen.add(id)
  }
  const isExcluded = (candidate: Candidate) => {
    const raw = raws.get(candidate.key)
    return excludedAreas.has(candidate.operatingArea || raw?.avast.operatingArea || '')
  }

  const lidarActive = settings.lidarMode !== 'none' && context.lidarLayerNames.length > 0
  const calibration = settings.lidarMode === 'calibrate' && lidarActive
    ? calibrate(candidates, raws, settings, (candidate) => !duplicateKeys.has(candidate.key))
    : null
  const factor = settings.lidarMode === 'factor'
    ? settings.lidarFactor
    : settings.lidarMode === 'calibrate'
      ? calibration?.factor ?? null
      : null
  const breaks = settings.slopeBreaks
  const avastName = context.avastLayerNames.join(' + ') || 'AVAST'
  const lidarName = context.lidarLayerNames.join(' + ') || 'LiDAR'

  const summaries: CandidateSummary[] = []
  for (const candidate of candidates) {
    const raw = raws.get(candidate.key)
    if (!raw) continue
    const duplicate = duplicateKeys.has(candidate.key)
    const warnings = [...raw.warnings]
    const useField = settings.grossArea === 'field' && candidate.fieldHa !== null && candidate.fieldHa > 0
    const grossHa = useField ? candidate.fieldHa! : candidate.geometryHa
    const avastCoveragePct = grossHa > 0 ? (100 * raw.avast.coveredHa) / grossHa : 0
    const lidarCoveragePct = raw.lidar && grossHa > 0 ? (100 * raw.lidar.coveredHa) / grossHa : null
    const cover = coverageClass(avastCoveragePct, settings)

    let volumeSource: VolumeSource = 'AVAST Raw'
    let finalVolume = raw.avast.volume
    let classVolume = raw.avast.byClass ? [...raw.avast.byClass.volume] as [number, number, number] : null
    let classAreaHa = raw.avast.byClass ? [...raw.avast.byClass.areaHa] as [number, number, number] : null
    let unclassifiedVolume = raw.avast.byClass?.unclassifiedVolume ?? 0
    let coveredHa = raw.avast.coveredHa
    if (lidarActive && raw.lidar && lidarCoveragePct !== null && lidarCoveragePct >= settings.directLidarMinCoveragePct) {
      // Direct LiDAR is already the reference estimate; the factor never applies to it.
      volumeSource = 'LiDAR'
      finalVolume = raw.lidar.volume
      classVolume = raw.lidar.byClass ? [...raw.lidar.byClass.volume] as [number, number, number] : null
      classAreaHa = raw.lidar.byClass ? [...raw.lidar.byClass.areaHa] as [number, number, number] : null
      unclassifiedVolume = raw.lidar.byClass?.unclassifiedVolume ?? 0
      coveredHa = raw.lidar.coveredHa
    } else if (factor !== null) {
      // The factor calibrates volume per slope class too. It never changes area.
      volumeSource = 'AVAST - LiDAR Adjusted'
      finalVolume = raw.avast.volume * factor
      classVolume = classVolume ? classVolume.map((value) => value * factor) as [number, number, number] : null
      unclassifiedVolume *= factor
    }

    let reportedVolume = finalVolume
    let reportedHa = coveredHa
    if (settings.volumeBasis !== 'total') {
      if (classVolume && classAreaHa) {
        const take = settings.volumeBasis === 'class1' ? 1 : 2
        reportedVolume = classVolume.slice(0, take).reduce((sum, value) => sum + value, 0)
        reportedHa = classAreaHa.slice(0, take).reduce((sum, value) => sum + value, 0)
      } else warnings.push('Slope was not assessed, so the reported volume is the total.')
    }
    const preferredVph = reportedHa > 0 ? roundTo(reportedVolume / reportedHa, settings.vphDecimals) : null

    if (classVolume) {
      const classSum = classVolume.reduce((sum, value) => sum + value, 0) + unclassifiedVolume
      if (Math.abs(classSum - finalVolume) > Math.max(1, finalVolume * 0.005)) {
        warnings.push(`Slope classes sum to ${fmt(classSum)} m³ against a total of ${fmt(finalVolume)} m³.`)
      }
      if (unclassifiedVolume > Math.max(1, finalVolume * 0.005)) {
        warnings.push(`${fmt(unclassifiedVolume)} m³ sits where the DEM had no data and has no slope class.`)
      }
    }

    const estimateSource = volumeSource === 'LiDAR'
      ? `LiDAR volume · ${lidarName}`
      : volumeSource === 'AVAST - LiDAR Adjusted'
        ? `AVAST × LiDAR factor ${roundTo(factor!, 4)} · ${avastName}`
        : `AVAST estimate · ${avastName}`

    const notes: string[] = []
    if (volumeSource === 'LiDAR') notes.push(`LiDAR-supported volume used directly (${fmt(lidarCoveragePct ?? 0, 1)}% LiDAR coverage); AVAST-only volume kept for reference.`)
    if (volumeSource === 'AVAST - LiDAR Adjusted') notes.push(`AVAST volume adjusted by LiDAR factor ${roundTo(factor!, 4)}.`)
    if (raw.avast.coveredHa === 0) notes.push('No AVAST coverage (0 ha).')
    if (!useField && settings.grossArea === 'field') notes.push('Merch area missing; gross area taken from the polygon.')
    if (settings.volumeBasis !== 'total' && classVolume) {
      notes.push(`Reported volume is the ${settings.volumeBasis === 'class1' ? slopeClassLabel(1, breaks) : `≤${breaks[1]}%`} slope portion.`)
    }
    notes.push(COVERAGE_NOTES[cover])
    if (settings.notesIncludeSlope && classVolume && finalVolume > 0) {
      const share = classVolume.map((value) => fmt((100 * value) / finalVolume))
      notes.push(`Slope: ${share[0]}% of volume ${slopeClassLabel(1, breaks)}, ${share[1]}% ${slopeClassLabel(2, breaks)}, ${share[2]}% ${slopeClassLabel(3, breaks)}.`)
    }
    if (raw.overlapHa > 0.01) notes.push(`${fmt(raw.overlapHa, 2)} ha covered by more than one AVAST source; counted once.`)

    summaries.push({
      key: candidate.key,
      id: candidate.id,
      operatingArea: candidate.operatingArea || raw.avast.operatingArea,
      sourceType: candidate.sourceType || settings.sourceType,
      sourceName: candidate.sourceName,
      grossHa,
      grossFromGeometry: !useField,
      avastCoveredHa: raw.avast.coveredHa,
      avastCoveragePct,
      avastRawVolume: raw.avast.volume,
      weightedAvastM3ha: raw.avast.coveredHa > 0 ? raw.avast.volume / raw.avast.coveredHa : null,
      lidarCoveredHa: raw.lidar?.coveredHa ?? null,
      lidarCoveragePct,
      lidarVolume: raw.lidar?.volume ?? null,
      factor: volumeSource === 'AVAST - LiDAR Adjusted' ? factor : null,
      volumeSource,
      finalVolume,
      classVolume,
      classAreaHa,
      unclassifiedVolume,
      reportedVolume,
      preferredVph,
      coverageClass: cover,
      estimateSource,
      notes: notes.join(' '),
      duplicate,
      excluded: isExcluded(candidate),
      warnings,
    })
  }

  const reportable = summaries.filter((row) => !row.excluded && !(row.duplicate && settings.duplicates === 'drop'))
  const counted = reportable.filter((row) => !row.duplicate)
  const byArea = new Map<string, { operatingArea: string; blocks: number; volume: number; class1: number | null }>()
  for (const row of counted) {
    const entry = byArea.get(row.operatingArea) ?? { operatingArea: row.operatingArea, blocks: 0, volume: 0, class1: context.slopeAssessed ? 0 : null }
    entry.blocks += 1
    entry.volume += row.reportedVolume
    if (entry.class1 !== null) entry.class1 += row.classVolume?.[0] ?? 0
    byArea.set(row.operatingArea, entry)
  }

  const qa: string[] = []
  const blankIds = candidates.filter((candidate) => !candidate.id.trim()).length
  if (blankIds) qa.push(`${blankIds} candidate${blankIds === 1 ? ' has' : 's have'} no Block ID.`)
  if (duplicateKeys.size) {
    const ids = [...new Set(summaries.filter((row) => row.duplicate).map((row) => row.id))]
    qa.push(`Duplicate Block IDs ${settings.duplicates === 'drop' ? 'dropped' : 'flagged and left out of totals'}: ${ids.join(', ')}.`)
  }
  const lowCoverage = counted.filter((row) => row.coverageClass === 'low' || row.coverageClass === 'none')
  if (lowCoverage.length) qa.push(`${lowCoverage.length} block${lowCoverage.length === 1 ? '' : 's'} below ${settings.coverageModeratePct}% AVAST coverage: ${lowCoverage.map((row) => row.id).join(', ')}.`)
  if (settings.lidarMode === 'calibrate' && lidarActive && !calibration?.rows.length) {
    qa.push(`No block has ${settings.calibrationMinCoveragePct}% common AVAST + LiDAR coverage, so no calibration factor could be derived; AVAST volumes are raw.`)
  }
  const warned = summaries.filter((row) => row.warnings.length).length
  if (warned) qa.push(`${warned} block${warned === 1 ? ' has' : 's have'} geometry or reconciliation warnings — see the block list.`)

  return {
    candidates: summaries,
    calibration,
    factor,
    byOperatingArea: [...byArea.values()],
    totals: {
      blocks: counted.length,
      volume: counted.reduce((sum, row) => sum + row.reportedVolume, 0),
      avastRawVolume: counted.reduce((sum, row) => sum + row.avastRawVolume, 0),
      grossHa: counted.reduce((sum, row) => sum + row.grossHa, 0),
      coveredHa: counted.reduce((sum, row) => sum + row.avastCoveredHa, 0),
    },
    qa,
  }
}

/** Rows the workbook and paste output carry, in input order. */
export function reportRows(summary: RunSummary, settings: Pick<ReportSettings, 'duplicates'>): CandidateSummary[] {
  return summary.candidates.filter((row) => !row.excluded && !(row.duplicate && settings.duplicates === 'drop'))
}
