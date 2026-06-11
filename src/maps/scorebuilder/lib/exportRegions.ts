import type { ScoredBoundaryRegion, ScoreMetricDefinition, ScoreMethodSettings } from '../types'

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/** Downloads the scored regions as a CSV or GeoJSON file. */
export function exportScoredRegions(
  format: 'csv' | 'geojson',
  scoredRegions: ScoredBoundaryRegion[],
  metrics: ScoreMetricDefinition[],
  aggregation: ScoreMethodSettings['aggregation'],
) {
  if (format === 'csv') {
    const metricKeys = metrics.map((m) => m.key)
    const header = [
      'Rank',
      'Rank confidence',
      'Rank interval',
      'Score',
      'Score interval',
      'Score method',
      'Comparison universe',
      'HealthyPlan demographic metric',
      'HealthyPlan environment metric',
      'HealthyPlan demographic decile',
      'HealthyPlan environment decile',
      'HealthyPlan priority score',
      'HealthyPlan priority',
      'Module scores',
      'Missing data flags',
      'Name',
      'Code',
      'Area (km²)',
      ...metrics.map((m) => m.label),
    ]
    const rows = scoredRegions.map((r) => [
      r.rank,
      r.rankConfidence,
      `${r.rankInterval[0]}-${r.rankInterval[1]}`,
      r.score.toFixed(1),
      `${r.scoreInterval[0].toFixed(1)}-${r.scoreInterval[1].toFixed(1)}`,
      r.scoreMethodLabel || aggregation,
      r.comparisonUniverseLabel,
      r.healthyPlanPriority?.demographicMetric ?? '',
      r.healthyPlanPriority?.environmentMetric ?? '',
      r.healthyPlanPriority?.demographicRank ?? '',
      r.healthyPlanPriority?.environmentRank ?? '',
      r.healthyPlanPriority?.priorityScore ?? '',
      r.healthyPlanPriority?.equityPriority ? 'yes' : r.healthyPlanPriority ? 'no' : '',
      (r.moduleScores || []).map((module) => `${module.label}:${(module.rank * 100).toFixed(1)}`).join('; '),
      (r.missingDataFlags || []).join('; '),
      r.region.name,
      r.region.code,
      r.region.areaKm2.toFixed(1),
      ...metricKeys.map((k) => r.metrics[k].toFixed(4)),
    ])
    const csv = [header.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n')
    downloadBlob(csv, 'score-builder-regions.csv', 'text/csv')
  } else {
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: scoredRegions.map((r) => ({
        type: 'Feature',
        geometry: r.region.feature.geometry,
        properties: {
          rank: r.rank,
          name: r.region.name,
          code: r.region.code,
          score: r.score,
          scoreMethod: r.scoreMethodLabel || aggregation,
          healthyPlanPriority: r.healthyPlanPriority,
          moduleScores: r.moduleScores,
          domainScores: r.domainScores,
          missingDataFlags: r.missingDataFlags,
          rankConfidence: r.rankConfidence,
          rankInterval: r.rankInterval,
          scoreInterval: r.scoreInterval,
          comparisonUniverse: r.comparisonUniverseLabel,
          equityAudit: r.equityAudit,
          areaKm2: r.region.areaKm2,
          ...Object.fromEntries(metrics.map((m) => [m.key, r.metrics[m.key]])),
        },
      })),
    }
    downloadBlob(JSON.stringify(fc, null, 2), 'score-builder-regions.geojson', 'application/geo+json')
  }
}
