/**
 * What the labs show of a spatial autocorrelation run: cluster colours and names, the
 * plain reading of a global Moran's I, and the export columns. DOM-free.
 */
import type { GlobalMoranResult, LisaClass, SpatialPatternSummary } from './spatialAutocorrelation'

/** Regions the run could not include: no value, or no neighbour with one. */
export type ClusterMapClass = LisaClass | 'none'

/** Map order for the legend: the two kinds of cluster, the two kinds of outlier, the rest. */
export const CLUSTER_MAP_CLASSES: readonly ClusterMapClass[] = ['HH', 'LL', 'HL', 'LH', 'ns', 'none']

// GeoDa's LISA colours, so a cluster map reads the way the method's users expect.
export const CLUSTER_COLORS: Record<ClusterMapClass, string> = {
  HH: '#d7191c',
  LL: '#2c7bb6',
  HL: '#fdae61',
  LH: '#abd9e9',
  ns: '#e5e7eb',
  none: '#3f3f46',
}

export const CLUSTER_LABELS: Record<ClusterMapClass, string> = {
  HH: 'High among high',
  LL: 'Low among low',
  HL: 'High among low',
  LH: 'Low among high',
  ns: 'Not significant',
  none: 'Not analysed',
}

/** One fill per drawn region; a region the run left out is drawn as not analysed. */
export function clusterFillColors(
  regionIds: readonly string[],
  clusterById: ReadonlyMap<string, LisaClass>,
): Record<string, string> {
  const colors: Record<string, string> = {}
  for (const id of regionIds) colors[id] = CLUSTER_COLORS[clusterById.get(id) ?? 'none']
  return colors
}

/** Counts per map class over the drawn regions, `none` included. */
export function clusterMapCounts(
  regionIds: readonly string[],
  clusterById: ReadonlyMap<string, LisaClass>,
): Record<ClusterMapClass, number> {
  const counts: Record<ClusterMapClass, number> = { HH: 0, LL: 0, HL: 0, LH: 0, ns: 0, none: 0 }
  for (const id of regionIds) counts[clusterById.get(id) ?? 'none'] += 1
  return counts
}

/** "p = 0.004", or "p ≤ 0.001" at the floor a permutation count allows. */
export function formatPermutationP(p: number, permutations: number): string {
  if (!Number.isFinite(p)) return 'p not tested'
  const floor = 1 / (permutations + 1)
  if (p <= floor + 1e-12) return `p ≤ ${floor.toFixed(3)}`
  return `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`
}

function figures(result: GlobalMoranResult): string {
  return `Moran's I ${result.I.toFixed(2)}, ${formatPermutationP(result.pPermutation, result.permutations)}`
}

const SIGNIFICANT = 0.05

/** One plain sentence on a variable's global Moran's I. */
export function describeGlobalPattern(result: GlobalMoranResult): string {
  if (result.pPermutation <= SIGNIFICANT && result.I > result.expected) {
    return `Clustered: neighbouring regions have similar values (${figures(result)}).`
  }
  if (result.pPermutation <= SIGNIFICANT) {
    return `Dispersed: neighbouring regions tend to differ more than chance (${figures(result)}).`
  }
  return `No clear spatial pattern: neighbours are about as alike as random regions (${figures(result)}).`
}

/** One plain sentence on the Moran's I of a regression's residuals. */
export function describeResidualPattern(result: GlobalMoranResult): string {
  if (result.pPermutation <= SIGNIFICANT && result.I > result.expected) {
    return `Residuals cluster on the map (${figures(result)}): the relationship differs by place, and because neighbouring regions are alike, r overstates the evidence.`
  }
  if (result.pPermutation <= SIGNIFICANT) {
    return `Residuals alternate between neighbours (${figures(result)}): neighbouring regions fall on opposite sides of the line.`
  }
  return `Residuals show no clear spatial pattern (${figures(result)}): the line fits about as well everywhere.`
}

/** The cluster columns a region export carries while the cluster map is shown. */
export interface ClusterExportColumns {
  /** What the clusters were computed on, for the column headings. */
  variableLabel: string
  values: ReadonlyMap<string, { cluster: ClusterMapClass; localI: number | null; p: number | null }>
}

export function clusterExportColumns(summary: SpatialPatternSummary, variableLabel: string): ClusterExportColumns {
  const values = new Map<string, { cluster: ClusterMapClass; localI: number | null; p: number | null }>()
  const local = summary.local
  if (local) {
    local.ids.forEach((id, i) => {
      values.set(id, { cluster: local.cluster[i], localI: local.I[i], p: local.pPermutation[i] })
    })
  }
  return { variableLabel, values }
}
