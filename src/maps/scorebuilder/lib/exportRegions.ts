import type { Map as MapLibreMap } from 'maplibre-gl'
import { toCsv } from '@pgmaps/geo-toolkit/export'
import { downloadText } from '@/lib/download'
import { captureMapImage } from '@/lib/mapImageCapture'
import type { ScoredBoundaryRegion, ScoreMetricDefinition, ScoreMethodSettings } from '../types'

export type ScoreBuilderExportFormat = 'csv' | 'geojson' | 'png' | 'pdf'

/** What a saved map image needs to explain its colours once it is away from the page. */
export type MapImageLegend =
  | { kind: 'gradient'; title: string; colors: readonly string[]; minLabel: string; maxLabel: string }
  | { kind: 'bivariate'; title: string; palette: readonly (readonly string[])[]; xLabel: string; yLabel: string }

export interface MapImageOptions {
  title: string
  subtitle: string
  legend?: MapImageLegend | null
  filename: string
}

const BANNER_HEIGHT = 56
const FOOTER_HEIGHT = 22

function downloadDataUrl(dataUrl: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

function drawGradientBar(
  context: CanvasRenderingContext2D,
  colors: readonly string[],
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const gradient = context.createLinearGradient(x, 0, x + width, 0)
  colors.forEach((color, index) => gradient.addColorStop(index / Math.max(1, colors.length - 1), color))
  context.fillStyle = gradient
  context.fillRect(x, y, width, height)
}

/** The legend card in the map's bottom-right corner, in CSS pixels at the given scale. */
function drawLegend(
  context: CanvasRenderingContext2D,
  legend: MapImageLegend,
  mapRight: number,
  mapBottom: number,
  scale: number,
) {
  const px = (value: number) => Math.round(value * scale)
  const width = px(220)
  const height = px(legend.kind === 'gradient' ? 66 : 92)
  const left = mapRight - width - px(12)
  const top = mapBottom - height - px(12)
  const padding = px(10)

  context.fillStyle = 'rgba(255, 255, 255, 0.94)'
  context.fillRect(left, top, width, height)
  context.textBaseline = 'top'
  context.fillStyle = '#0f172a'
  context.font = `600 ${px(12)}px system-ui, sans-serif`
  context.fillText(legend.title, left + padding, top + padding, width - padding * 2)

  context.font = `400 ${px(11)}px system-ui, sans-serif`
  context.fillStyle = '#475569'
  if (legend.kind === 'gradient') {
    const barTop = top + px(29)
    drawGradientBar(context, legend.colors, left + padding, barTop, width - padding * 2, px(9))
    context.textAlign = 'left'
    context.fillText(legend.minLabel, left + padding, barTop + px(13), (width - padding * 2) / 2)
    context.textAlign = 'right'
    context.fillText(legend.maxLabel, left + width - padding, barTop + px(13), (width - padding * 2) / 2)
    context.textAlign = 'left'
    return
  }

  // Row 0 of the palette is low Y, so it draws at the bottom of the grid.
  const cell = px(16)
  const gridTop = top + px(30)
  legend.palette.forEach((row, rowIndex) => {
    row.forEach((color, columnIndex) => {
      context.fillStyle = color
      context.fillRect(left + padding + columnIndex * cell, gridTop + (2 - rowIndex) * cell, cell, cell)
    })
  })
  const textLeft = left + padding + cell * 3 + px(10)
  const textWidth = width - (textLeft - left) - padding
  context.fillStyle = '#475569'
  context.fillText(`Up: ${legend.yLabel}`, textLeft, gridTop + px(6), textWidth)
  context.fillText(`Right: ${legend.xLabel}`, textLeft, gridTop + px(26), textWidth)
}

/** Downloads the current map view as a PNG with a title banner, legend, and attribution. */
export async function exportMapImage(map: MapLibreMap, options: MapImageOptions): Promise<void> {
  const image = await captureMapImage(map)
  const scale = image.canvas.width / image.cssWidth
  const banner = Math.round(BANNER_HEIGHT * scale)
  const footer = Math.round(FOOTER_HEIGHT * scale)
  const output = document.createElement('canvas')
  output.width = image.canvas.width
  output.height = image.canvas.height + banner + footer
  const context = output.getContext('2d')
  if (!context) throw new Error('This browser cannot create a map image.')

  context.fillStyle = '#0f172a'
  context.fillRect(0, 0, output.width, output.height)
  const inset = Math.round(16 * scale)
  context.textBaseline = 'middle'
  context.fillStyle = '#f8fafc'
  context.font = `600 ${Math.round(banner * 0.4)}px system-ui, sans-serif`
  context.fillText(options.title, inset, Math.round(banner * 0.38), output.width - inset * 2)
  context.font = `400 ${Math.round(banner * 0.24)}px system-ui, sans-serif`
  context.fillStyle = '#94a3b8'
  context.fillText(options.subtitle, inset, Math.round(banner * 0.78), output.width - inset * 2)

  context.drawImage(image.canvas, 0, banner)
  if (options.legend) drawLegend(context, options.legend, output.width, banner + image.canvas.height, scale)

  context.textBaseline = 'middle'
  context.fillStyle = '#cbd5e1'
  context.font = `400 ${Math.round(11 * scale)}px system-ui, sans-serif`
  context.fillText(
    image.attribution || 'Map data © OpenStreetMap contributors',
    inset,
    output.height - Math.round(footer / 2),
    output.width - inset * 2,
  )
  downloadDataUrl(output.toDataURL('image/png'), options.filename)
}

/** Blank rather than `NaN`: a metric with no value for a region is missing, not a number. */
function metricCell(value: number): number | string {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : ''
}

export interface RegionExportOptions {
  /** Only the metrics the view is showing; every other column would be zeros from switched-off sources. */
  metrics: ScoreMetricDefinition[]
  aggregation: ScoreMethodSettings['aggregation']
  /** The Density and Correlation labs export their lens metrics, not a score they do not show. */
  includeScores: boolean
  filenameStem: string
}

export function scoredRegionsCsv(regions: ScoredBoundaryRegion[], options: RegionExportOptions): string {
  const metricColumns = options.metrics.map((metric) => metric.label)
  const metricCells = (region: ScoredBoundaryRegion) =>
    options.metrics.map((metric) => metricCell(region.metrics[metric.key]))
  const identity = (region: ScoredBoundaryRegion) => [
    region.region.name,
    region.region.code,
    Number(region.region.areaKm2.toFixed(1)),
  ]
  const identityColumns = ['Name', 'Code', 'Area (km²)']

  if (!options.includeScores) {
    return toCsv(
      [...identityColumns, ...metricColumns],
      regions.map((region) => [...identity(region), ...metricCells(region)]),
    )
  }

  const withHealthyPlan = regions.some((region) => region.healthyPlanPriority)
  const withModules = regions.some((region) => region.moduleScores?.length)
  const header = [
    'Rank',
    'Rank confidence',
    'Rank interval',
    'Score',
    'Score interval',
    'Score method',
    'Comparison universe',
    ...(withHealthyPlan
      ? [
          'HealthyPlan demographic metric',
          'HealthyPlan environment metric',
          'HealthyPlan demographic decile',
          'HealthyPlan environment decile',
          'HealthyPlan priority score',
          'HealthyPlan priority',
        ]
      : []),
    ...(withModules ? ['Module scores'] : []),
    'Missing data flags',
    ...identityColumns,
    ...metricColumns,
  ]
  const rows = regions.map((region) => [
    region.rank,
    region.rankConfidence,
    `${region.rankInterval[0]}-${region.rankInterval[1]}`,
    Number(region.score.toFixed(1)),
    `${region.scoreInterval[0].toFixed(1)}-${region.scoreInterval[1].toFixed(1)}`,
    region.scoreMethodLabel || options.aggregation,
    region.comparisonUniverseLabel,
    ...(withHealthyPlan
      ? [
          region.healthyPlanPriority?.demographicMetric ?? '',
          region.healthyPlanPriority?.environmentMetric ?? '',
          region.healthyPlanPriority?.demographicRank ?? '',
          region.healthyPlanPriority?.environmentRank ?? '',
          region.healthyPlanPriority?.priorityScore ?? '',
          region.healthyPlanPriority ? (region.healthyPlanPriority.equityPriority ? 'yes' : 'no') : '',
        ]
      : []),
    ...(withModules
      ? [(region.moduleScores || []).map((module) => `${module.label}:${(module.rank * 100).toFixed(1)}`).join('; ')]
      : []),
    (region.missingDataFlags || []).join('; '),
    ...identity(region),
    ...metricCells(region),
  ])
  return toCsv(header, rows)
}

function regionGeoJson(regions: ScoredBoundaryRegion[], options: RegionExportOptions): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: regions.map((region) => ({
      type: 'Feature',
      geometry: region.region.feature.geometry,
      properties: {
        name: region.region.name,
        code: region.region.code,
        areaKm2: region.region.areaKm2,
        ...(options.includeScores
          ? {
              rank: region.rank,
              score: region.score,
              scoreMethod: region.scoreMethodLabel || options.aggregation,
              healthyPlanPriority: region.healthyPlanPriority,
              moduleScores: region.moduleScores,
              domainScores: region.domainScores,
              bcEnviroScreen: region.bcEnviroScreen,
              missingDataFlags: region.missingDataFlags,
              rankConfidence: region.rankConfidence,
              rankInterval: region.rankInterval,
              scoreInterval: region.scoreInterval,
              comparisonUniverse: region.comparisonUniverseLabel,
              equityAudit: region.equityAudit,
            }
          : {}),
        ...Object.fromEntries(
          options.metrics.map((metric) => {
            const value = region.metrics[metric.key]
            return [metric.key, Number.isFinite(value) ? value : null]
          }),
        ),
      },
    })),
  }
}

/** Downloads the scored regions as a CSV or GeoJSON file. */
export function exportScoredRegions(
  format: 'csv' | 'geojson',
  scoredRegions: ScoredBoundaryRegion[],
  options: RegionExportOptions,
) {
  if (format === 'csv') {
    downloadText(scoredRegionsCsv(scoredRegions, options), `${options.filenameStem}.csv`, 'text/csv')
    return
  }
  downloadText(
    JSON.stringify(regionGeoJson(scoredRegions, options), null, 2),
    `${options.filenameStem}.geojson`,
    'application/geo+json',
  )
}
