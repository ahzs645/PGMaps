import { formatRoadNumber as number } from './roadFormat'
import type { StatItem } from '@/components/ui/stat-group'
import { hasCompleteCoverage } from './analysisResult'
import { isGradeBreachFlag } from './designStandards'
import type { FullCostPreview } from './FullCostPlanningDialog'
import { incompleteReasonText, type IncompleteReason } from './sectionCompleteness'
import type { Alignment, RoadAnalysis, RoadProject } from './types'

/** Keys stay stable when a road's values, warnings or available measurements change. */
export interface RoadSummaryMetric extends StatItem {
  key: string
  label: string
  value: string
  note: string
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
      value: elevations ? `${number(low, 0)}–${number(high, 0)} m` : 'Missing',
      note: elevations
        ? `${number(high - low)} m vertical range across ${elevations} stations`
        : 'No sampled ground elevations',
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
