/** Numeric, portable comparisons of deliberately rerun drainage assumptions. */
import { distance } from './engine'
import {
  DRAINAGE_ALGORITHM_VERSION,
  parseDrainageComparisons,
  type DrainageComparisonSnapshot,
  type DrainageEvidence,
} from './drainageEvidence'
import type { DrainageSettings } from './drainageRun'
import type { PourPoint } from './drainageCatchments'

export function depressionPolicyLabel(settings: DrainageSettings): string {
  const policy = settings.depressionPolicy
  if (policy?.mode === 'preserve') return 'Preserve depressions'
  if (policy?.mode === 'depth-limited') return `Fill basins up to ${policy.maxDepthM} m`
  return 'Fill all depressions'
}
export function snapPolicyLabel(point?: Pick<PourPoint, 'snapPolicy'>): string {
  return point?.snapPolicy === 'lowest-elevation' ? 'Lowest elevation' : 'Greatest contributing area'
}
export const drainageComparisonId = (record: Pick<DrainageComparisonSnapshot, 'fingerprint' | 'createdAt'>) =>
  `${record.fingerprint}:${record.createdAt}`

export function createDrainageComparison(record: DrainageEvidence, label: string): DrainageComparisonSnapshot {
  if (record.algorithmVersion !== DRAINAGE_ALGORITHM_VERSION)
    throw Error('Re-run drainage before saving a comparison of this older calculation.')
  return parseDrainageComparisons([
    {
      ...record,
      schema: 'pgmaps-drainage-comparison-v1',
      label: label.trim(),
      culvertAreas: record.features.features
        .filter((f) => f.properties?.role === 'culvert-check')
        .map((f) => ({
          id: f.properties!.id,
          name: f.properties!.name,
          chainage: f.properties!.chainage,
          existingAreaHa: f.properties!.existingAreaHa,
          designAreaHa: f.properties!.designAreaHa,
        })),
    },
  ])[0]
}

export interface DrainageSensitivityComparison {
  changedInputs: string[]
  sameRoad: boolean
  sameCalculation: boolean
  sameRequestedPoint: boolean
  outletMovedM: number | null
  areaDeltaHa: number | null
  areaDeltaPercent: number | null
  culverts: { id: string; name: string; existingDeltaHa: number; designDeltaHa: number }[]
  cautions: string[]
}

/** Deltas are descriptive; changes in road, outlet, source and truncation are explicitly carried with them. */
export function compareDrainageRuns(
  baseline: DrainageComparisonSnapshot,
  candidate: DrainageComparisonSnapshot,
): DrainageSensitivityComparison {
  const changedInputs: string[] = []
  const sameCalculation = !!baseline.algorithmVersion && baseline.algorithmVersion === candidate.algorithmVersion
  if (baseline.algorithmVersion !== candidate.algorithmVersion) changedInputs.push('Calculation version')
  const sameRoad =
    baseline.alignmentId === candidate.alignmentId && baseline.roadFingerprint === candidate.roadFingerprint
  if (!sameRoad) changedInputs.push('Road geometry or road settings')
  if (JSON.stringify(baseline.terrain) !== JSON.stringify(candidate.terrain))
    changedInputs.push('Terrain source or resolution')
  const keys: (keyof DrainageSettings)[] = [
    'bufferM',
    'workingResolutionM',
    'rainfallMmPerHr',
    'runoffCoefficient',
    'manningN',
    'streamThresholdHa',
  ]
  const labels = [
    'Upslope buffer',
    'Requested grid resolution',
    'Rainfall',
    'Runoff coefficient',
    'Pipe roughness',
    'Stream threshold',
  ]
  keys.forEach((key, i) => {
    if (baseline.settings[key] !== candidate.settings[key]) changedInputs.push(labels[i])
  })
  if (depressionPolicyLabel(baseline.settings) !== depressionPolicyLabel(candidate.settings))
    changedInputs.push('Depression treatment')
  const before = baseline.selectedCatchment,
    after = candidate.selectedCatchment
  const sameRequestedPoint =
    !!baseline.pourPoint &&
    !!candidate.pourPoint &&
    distance(baseline.pourPoint.coordinate, candidate.pourPoint.coordinate) < 0.01
  if (
    !!baseline.pourPoint !== !!candidate.pourPoint ||
    (baseline.pourPoint && candidate.pourPoint && !sameRequestedPoint)
  )
    changedInputs.push('Requested outlet')
  if (baseline.pourPoint?.surface !== candidate.pourPoint?.surface) changedInputs.push('Catchment surface')
  if ((baseline.pourPoint?.snapRadiusM ?? 0) !== (candidate.pourPoint?.snapRadiusM ?? 0))
    changedInputs.push('Snap radius')
  if (snapPolicyLabel(baseline.pourPoint) !== snapPolicyLabel(candidate.pourPoint)) changedInputs.push('Snap policy')
  if (baseline.grid.cellM !== candidate.grid.cellM) changedInputs.push('Actual grid resolution')
  if (baseline.watershedMinAreaHa !== candidate.watershedMinAreaHa) changedInputs.push('Watershed display threshold')
  const outletMovedM = before && after ? distance(before.snappedCoordinate, after.snappedCoordinate) : null
  // A different requested location or road is a different question; don't present its difference as sensitivity.
  const comparable = sameCalculation && sameRoad && sameRequestedPoint && before && after
  const areaDeltaHa = comparable ? after.areaHa - before.areaHa : null
  const areaDeltaPercent =
    comparable && before.areaHa > 0 ? ((after.areaHa - before.areaHa) / before.areaHa) * 100 : null
  const cautions: string[] = []
  if (!sameCalculation) cautions.push('Calculation versions differ or are unknown; area deltas are withheld.')
  if (!sameRoad) cautions.push('The road or its settings changed; area deltas are withheld.')
  if (baseline.pourPoint && candidate.pourPoint && !sameRequestedPoint)
    cautions.push('Different requested outlets; selected-catchment deltas are withheld.')
  if (!baseline.pourPoint || !candidate.pourPoint)
    cautions.push('Select the same pour point in both runs to compare its contributing area.')
  else if (!before || !after)
    cautions.push(
      'An outlet was not resolved in at least one run; selected-catchment deltas are unavailable. Review the saved run warnings.',
    )
  if (outletMovedM !== null && outletMovedM > 0.01)
    cautions.push(`The selected outlet moved ${outletMovedM.toFixed(2)} m; the area difference includes that movement.`)
  if (before?.truncated || after?.truncated)
    cautions.push('A catchment touches the sampled edge or missing terrain; its area may be incomplete.')
  if (!baseline.terrain.immutable || !candidate.terrain.immutable)
    cautions.push('Unchecksummed terrain is historical evidence and may not be reproducible.')
  const culverts =
    sameCalculation && sameRoad
      ? candidate.culvertAreas.flatMap((current) => {
          const previous = baseline.culvertAreas.find((c) => c.id === current.id)
          return previous
            ? [
                {
                  id: current.id,
                  name: current.name,
                  existingDeltaHa: current.existingAreaHa - previous.existingAreaHa,
                  designDeltaHa: current.designAreaHa - previous.designAreaHa,
                },
              ]
            : []
        })
      : []
  return {
    changedInputs,
    sameRoad,
    sameCalculation,
    sameRequestedPoint,
    outletMovedM,
    areaDeltaHa,
    areaDeltaPercent,
    culverts,
    cautions,
  }
}

export function drainageComparisonsExport(records: DrainageComparisonSnapshot[], baselineId: string) {
  const snapshots = parseDrainageComparisons(records)
  const baseline = snapshots.find((r) => drainageComparisonId(r) === baselineId)
  if (!baseline) throw Error('Select a saved drainage baseline before exporting comparisons.')
  return {
    schema: 'pgmaps-drainage-sensitivity-v1',
    status: 'historical-comparison',
    baselineId,
    interpretation:
      'Saved runs describe their recorded inputs. Deltas do not establish accuracy or RoadEng equivalence. Outlet movement and coverage limits accompany each comparison.',
    runs: snapshots.map((record) => ({ record, comparison: compareDrainageRuns(baseline, record) })),
  }
}
