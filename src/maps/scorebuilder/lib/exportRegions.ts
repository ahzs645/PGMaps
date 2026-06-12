import type { Map as MapLibreMap } from 'maplibre-gl'
import type { ScoredBoundaryRegion, ScoreMetricDefinition, ScoreMethodSettings } from '../types'

export type ScoreBuilderExportFormat = 'csv' | 'geojson' | 'png' | 'pdf'

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

function downloadDataUrl(dataUrl: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

/**
 * Downloads the current map view as a PNG with a title banner.
 *
 * The map canvas is captured inside a `render` callback because the WebGL
 * context is created without `preserveDrawingBuffer` — outside a render
 * frame the buffer would read back blank.
 */
export function exportMapImage(map: MapLibreMap, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    map.once('render', () => {
      try {
        const source = map.getCanvas()
        const banner = 56
        const output = document.createElement('canvas')
        output.width = source.width
        output.height = source.height + banner
        const context = output.getContext('2d')
        if (!context) throw new Error('Canvas 2D context unavailable')
        context.fillStyle = '#0f172a'
        context.fillRect(0, 0, output.width, banner)
        context.fillStyle = '#f8fafc'
        context.font = `600 ${Math.round(banner * 0.4)}px system-ui, sans-serif`
        context.textBaseline = 'middle'
        context.fillText(title, 16, Math.round(banner * 0.38))
        context.font = `400 ${Math.round(banner * 0.24)}px system-ui, sans-serif`
        context.fillStyle = '#94a3b8'
        context.fillText(`PGMaps Index Lab · ${new Date().toISOString().slice(0, 10)}`, 16, Math.round(banner * 0.78))
        context.drawImage(source, 0, banner)
        downloadDataUrl(output.toDataURL('image/png'), 'score-builder-map.png')
        resolve()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    map.triggerRepaint()
  })
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
