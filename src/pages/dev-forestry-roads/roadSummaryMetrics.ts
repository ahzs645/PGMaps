import { formatRoadNumber as number } from './roadFormat'
import type { StatItem } from '@/components/ui/stat-group'
import type { MetricLevel } from '@/components/ui/metric-summary'
import { massHaulDiagram } from './massHaul'
import { hasCompleteCoverage } from './analysisResult'
import { isGradeBreachFlag } from './designStandards'
import type { FullCostPreview } from './FullCostPlanningDialog'
import { incompleteReasonText, type IncompleteReason } from './sectionCompleteness'
import { materialPlanMissing } from './engineeringTypes'
import type { Alignment, RoadAnalysis, RoadProject } from './types'

/** Keys stay stable when a road's values, warnings or available measurements change. */
export interface RoadSummaryMetric extends StatItem {
  key: string
  label: string
  value: string
  note: string
  /** `hidden` rows are offered in the summary's settings without taking room until chosen. */
  defaultLevel?: MetricLevel
}

const money = (value: number) => `$${number(value, 0)}`

type SummarySource = {
  analysis: RoadAnalysis
  alignment: Alignment
  settings: RoadProject['settings']
  groundOnly: boolean
  preview: FullCostPreview | null | undefined
  record: Alignment['fullCostRecord']
  recordCurrent: boolean
  unpriced: number
  incomplete: IncompleteReason[]
  costOpen: boolean
  /** How the earthworks label says its volumes are curve-corrected; the note itself is always shown. */
  curveNote?: 'full' | 'short'
  onCost: () => void
  onIncomplete: (chainage: number) => void
}

export function roadSummaryMetrics(source: SummarySource): RoadSummaryMetric[] {
  const { analysis, alignment, settings, groundOnly, preview, record, incomplete } = source
  let low = Infinity,
    high = -Infinity,
    lowGrade = Infinity,
    highGrade = -Infinity
  let elevations = 0,
    grades = 0
  for (const station of analysis.stations) {
    if (station.groundElevation !== null) {
      low = Math.min(low, station.groundElevation)
      high = Math.max(high, station.groundElevation)
      elevations++
    }
    if (station.gradePercent !== null) {
      lowGrade = Math.min(lowGrade, station.gradePercent)
      highGrade = Math.max(highGrade, station.gradePercent)
      grades++
    }
  }
  const first = analysis.stations[0]
  const last = analysis.stations.at(-1)
  const startElevation = (groundOnly ? first?.groundElevation : first?.designElevation) ?? null
  const endElevation = (groundOnly ? last?.groundElevation : last?.designElevation) ?? null
  const elevationChange = startElevation !== null && endElevation !== null ? endElevation - startElevation : null
  const overallGrade =
    analysis.length > 0 && analysis.stations.length > 1 && elevationChange !== null
      ? (100 * elevationChange) / analysis.length
      : null
  const recorded = alignment.fileGround?.points ?? []
  const metrics: RoadSummaryMetric[] = [
    {
      key: 'length',
      label: 'Length',
      value: `${number(analysis.length, 0)} m`,
      note: `${alignment.points.length} alignment points · ${analysis.stations.length} calculation stations`,
    },
    {
      key: 'elevation',
      label: 'Ground elevation',
      // A design opened without terrain is a mode, not a fault: say where its ground comes from.
      value: elevations
        ? `${number(low, 0)}–${number(high, 0)} m`
        : recorded.length >= 2
          ? `${number(Math.min(...recorded.map((p) => p[1])), 0)}–${number(Math.max(...recorded.map((p) => p[1])), 0)} m`
          : 'No terrain',
      note: elevations
        ? `${number(high - low)} m vertical range across ${elevations} stations`
        : recorded.length >= 2
          ? `Along the centreline, from ${alignment.fileGround!.source}; no terrain loaded`
          : 'Design only: no terrain under this road',
    },
    {
      key: 'grade',
      label: groundOnly ? 'Max ground grade' : 'Max design grade',
      value: grades ? `${number(analysis.maxGradePercent)}%` : 'Missing',
      note: `Design grade limit ${number(settings.maxGradePercent)}%`,
      tone: (
        groundOnly
          ? analysis.maxGradePercent > settings.maxGradePercent
          : analysis.stations.some((s) => s.flags.some(isGradeBreachFlag))
      )
        ? 'warning'
        : 'default',
    },
    {
      key: 'overall-grade',
      label: 'Overall grade',
      value: overallGrade !== null ? `${number(overallGrade)}%` : 'Missing',
      note:
        overallGrade !== null
          ? `${groundOnly ? 'Ground' : 'Design'} elevation change ${number(elevationChange)} m over ${number(analysis.length, 0)} m · positive uphill, negative downhill`
          : 'Requires a non-zero road length and elevations at both ends',
    },
  ]
  if (groundOnly) {
    metrics.push({
      key: 'grade-range',
      label: 'Grade range',
      value: grades ? `${number(lowGrade)} to ${number(highGrade)}%` : 'Missing',
      note: `${grades} sampled station grades`,
    })
    return metrics
  }

  const calculated = analysis.stations.length > 0
  const stale = calculated && !!analysis.invalidInput
  const covered = hasCompleteCoverage(analysis)
  const haul = analysis.engineering?.haul.optimizationStatus
  let costLabel = covered || !calculated ? 'Base engineering estimate' : 'Base engineering estimate · partial coverage'
  let costValue = calculated ? money(analysis.estimatedCost) : 'Unavailable'
  let costNote = `Cut $${number(settings.cutRate, 2)}/m³ · Fill $${number(settings.fillRate, 2)}/m³`
  if (preview) {
    costLabel = 'Candidate complete cost'
    costValue =
      preview.totalCost !== null
        ? money(preview.totalCost)
        : preview.status === 'infeasible'
          ? 'Not feasible'
          : 'Unpriced'
    costNote = preview.alignment.name
  } else if (record) {
    costLabel = 'Complete access cost'
    costValue = source.recordCurrent ? money(record.totalCost) : 'Recalculate'
    costNote = `${record.candidateName} · ${record.asOf}`
  } else {
    if (stale) costLabel = 'Estimate · invalid input left out'
    else if (haul === 'infeasible' || haul === 'unsolved') costLabel = 'Incomplete estimate'
    else if (source.unpriced) costLabel = `Estimate · ${source.unpriced} unpriced`
    if (haul === 'infeasible') costValue = 'Material plan infeasible'
    if (haul === 'unsolved') costValue = 'Material plan not solved'
  }
  metrics.push(
    {
      key: 'earthworks',
      // AGENTS.md: every surface that shows a volume says when it is curve-corrected.
      label: `${stale ? 'Cut / fill · invalid input left out' : covered ? 'Cut / fill' : 'Covered cut / fill'}${
        analysis.curvatureCorrection?.applied ? (source.curveNote === 'short' ? ' · curve' : ' · curve-corrected') : ''
      }`,
      value: calculated ? `${number(analysis.cutVolumeM3, 0)} / ${number(analysis.fillVolumeM3, 0)} m³` : 'Unavailable',
      note: calculated ? `Surfacing volume ${number(analysis.surfaceVolumeM3, 0)} m³` : 'No calculated sections',
      tone: stale ? 'warning' : 'default',
    },
    {
      key: 'cost',
      label: costLabel,
      value: costValue,
      note: costNote,
      tone: stale && !preview && !record ? 'warning' : 'default',
      onToggle: preview || record || calculated ? source.onCost : undefined,
      pressed: source.costOpen,
      toggleLabel: preview || record ? 'Review complete route costs' : 'Show how the covered estimate is calculated',
    },
    ...massMetrics(analysis),
    {
      key: 'coverage',
      label: 'Complete sections',
      value: `${number(analysis.coveragePercent)}%`,
      note: `${number(analysis.completeLength, 0)} of ${number(analysis.length, 0)} m covered`,
      tone: covered ? 'default' : 'warning',
      ...(incomplete.length
        ? {
            onToggle: () => source.onIncomplete(incomplete[0].firstChainage),
            pressed: false,
            toggleLabel: `Show the first incomplete section. ${incompleteReasonText(incomplete)}`,
          }
        : {}),
    },
  )
  return metrics
}

const MASS_CLOSED_M3 = 0.05

/**
 * The mass-haul chart's figures as optional summary rows, hidden until chosen (RoadEng's results
 * panel lists them beside the costs): the end balance, the haul plan's volumes by class, and what no
 * site had room for. A plan that allocated nothing never reads as zero haul or nothing unplaced.
 * Cut-to-fill and borrow are compacted m³; waste stays in bank m³ apart.
 */
function massMetrics(analysis: RoadAnalysis): RoadSummaryMetric[] {
  const diagram = massHaulDiagram(analysis)
  const haul = analysis.engineering?.haul
  const allocated = !!haul?.enabled && !materialPlanMissing(haul)
  const notAllocated = !haul?.enabled ? 'Haul off' : 'Plan not solved'
  const end: RoadSummaryMetric = {
    key: 'mass-end',
    label: 'End balance',
    value: diagram.endBalanceM3 === null ? 'Unavailable' : `${number(diagram.endBalanceM3, 0)} m³`,
    note: [
      diagram.haul
        ? Math.abs(diagram.haul.closingM3) <= MASS_CLOSED_M3
          ? 'Closes at 0 m³ after borrow and waste'
          : `${number(diagram.haul.closingM3, 0)} m³ after borrow and waste`
        : 'Usable compacted cut less fill at the road end',
      diagram.unknownLengthM > 0 ? `leaves out ${number(diagram.unknownLengthM, 0)} m of unknown earthwork` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    defaultLevel: 'hidden',
  }
  if (!haul || !allocated)
    return [
      end,
      {
        key: 'haul',
        label: 'Free / over / end haul',
        value: notAllocated,
        note: 'Turn on material haul',
        defaultLevel: 'hidden',
      },
      {
        key: 'unplaced',
        label: 'No site with room',
        value: notAllocated,
        note: 'Turn on material haul',
        defaultLevel: 'hidden',
      },
    ]
  const waste = haul.wasteFreeHaulBankM3 + haul.wasteOverhaulBankM3 + haul.wasteEndHaulBankM3
  const unplaced = [
    haul.unallocatedWasteM3 > MASS_CLOSED_M3 && `${number(haul.unallocatedWasteM3, 0)} bank m³ cut`,
    haul.unallocatedBorrowM3 > MASS_CLOSED_M3 && `${number(haul.unallocatedBorrowM3, 0)} m³ fill`,
  ].filter((part): part is string => !!part)
  return [
    end,
    {
      key: 'haul',
      label: `Free / over / end haul${haul.complete ? '' : ' · covered'}`,
      value: `${number(haul.freeHaulM3, 0)} / ${number(haul.overhaulM3, 0)} / ${number(haul.endHaulM3, 0)} m³`,
      note: `Compacted m³ · ${number(haul.haulM3Km, 0)} m³·km${
        haul.borrowCompactedM3 > 0 ? ` · borrow ${number(haul.borrowCompactedM3, 0)} m³` : ''
      }${waste > 0 ? ` · waste ${number(waste, 0)} bank m³ hauled` : ''}`,
      defaultLevel: 'hidden',
    },
    {
      key: 'unplaced',
      label: 'No site with room',
      value: unplaced.length ? unplaced.join(' · ') : 'None',
      note: unplaced.length
        ? 'Cut no waste site can take, or fill no borrow site can supply'
        : 'Every surplus and deficit found a site',
      tone: unplaced.length ? 'warning' : 'default',
      defaultLevel: 'hidden',
    },
  ]
}

/**
 * Ground at a chainage from [chainage, elevation] pairs (a road's `fileGround`), straight between
 * them; null outside them.
 */
export function groundAlong(pairs: readonly (readonly [number, number])[], chainage: number): number | null {
  if (pairs.length < 2 || chainage < pairs[0][0] - 1e-6 || chainage > pairs[pairs.length - 1][0] + 1e-6) return null
  let low = 0,
    high = pairs.length - 1
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (pairs[mid][0] <= chainage) low = mid
    else high = mid
  }
  const [c0, z0] = pairs[low],
    [c1, z1] = pairs[high]
  return c1 > c0 ? z0 + ((z1 - z0) * (chainage - c0)) / (c1 - c0) : z0
}
