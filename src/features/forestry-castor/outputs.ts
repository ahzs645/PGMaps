// SPDX-License-Identifier: Apache-2.0
import proj4 from 'proj4'
import pointOnFeature from '@turf/point-on-feature'
import type { Feature, FeatureCollection, Geometry, Point, Polygon } from 'geojson'
import type { CastorPixel, CastorProject, CastorResult, CastorSnapshot } from './types'
import { encodeCastorGeoTiff } from './geotiff'
import { serializeCastorSession } from './persistence'

export type CastorReport =
  | 'harvest'
  | 'stock'
  | 'constraints'
  | 'pixels'
  | 'blocks'
  | 'landings'
  | 'salvage'
  | 'uncertainty'
export type CastorMetric =
  | 'harvestYear'
  | 'harvestVolume'
  | 'constrainedYears'
  | 'constrainedPeriods'
  | 'constrained'
  | 'age'
  | 'volume'
  | 'height'
  | 'eca'
export const CASTOR_METRICS: Record<CastorMetric, { label: string; units: string }> = {
  harvestYear: { label: 'Most recent harvest year', units: 'calendar year' },
  harvestVolume: { label: 'Cumulative harvested volume', units: 'm³ / cell' },
  constrainedYears: { label: 'Time constrained', units: 'years' },
  constrainedPeriods: { label: 'Periods constrained', units: 'periods' },
  constrained: { label: 'Constrained this period', units: '0 or 1' },
  age: { label: 'Stand age', units: 'years' },
  volume: { label: 'Standing merchantable volume', units: 'm³/ha' },
  height: { label: 'Stand height', units: 'm' },
  eca: { label: 'Equivalent clearcut area', units: 'fraction' },
}

const reportKeys = {
  harvest: 'harvestReport',
  stock: 'growingStockReport',
  constraints: 'zoneManagement',
  pixels: 'harvestPixelList',
  blocks: 'harvestBlockList',
  landings: 'landings',
  salvage: 'salvageReport',
  uncertainty: 'uncertainty',
} as const
const emptyColumns: Record<CastorReport, string[]> = {
  harvest: ['scenario', 'period', 'year', 'compartment', 'targetM3', 'volumeM3', 'areaHa'],
  stock: ['scenario', 'period', 'year', 'compartment', 'phase', 'stockM3'],
  constraints: ['scenario', 'period', 'year', 'constraintId', 'phase', 'actualPercent', 'met'],
  pixels: ['period', 'year', 'pixelId', 'blockId', 'compartment', 'type', 'areaHa', 'volumeM3'],
  blocks: ['period', 'year', 'blockId', 'compartment', 'type', 'areaHa', 'volumeM3'],
  landings: ['period', 'year', 'blockId', 'pixelId', 'x', 'y', 'source'],
  salvage: ['period', 'year', 'compartment', 'availableM3', 'harvestedM3', 'remainingM3'],
  uncertainty: [
    'period',
    'year',
    'compartment',
    'flowId',
    'targetM3',
    'p05M3',
    'medianM3',
    'p95M3',
    'probabilityTarget',
  ],
}
/** Text cells are escaped for both CSV syntax and spreadsheet formula interpretation. */
export function castorCsvCell(value: unknown): string {
  if (value === undefined || value === null) return ''
  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const safe = typeof value === 'string' && /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
export function castorReportCsv(result: CastorResult, report: CastorReport): string {
  const rows = result[reportKeys[report]] as unknown as Array<Record<string, unknown>>
  const columns = rows.length ? [...new Set(rows.flatMap((row) => Object.keys(row)))] : emptyColumns[report]
  return (
    [
      columns.map(castorCsvCell).join(','),
      ...rows.map((row) => columns.map((column) => castorCsvCell(row[column])).join(',')),
    ].join('\r\n') + '\r\n'
  )
}

function snapshot(result: CastorResult, period: number): CastorSnapshot {
  const found = result.snapshots.find((item) => item.period === period)
  if (!found) throw new Error(`No simulation snapshot exists for period ${period}.`)
  return found
}
export function castorMetricValues(result: CastorResult, period: number, metric: CastorMetric): Array<number | null> {
  const row = snapshot(result, period)
  if (metric === 'harvestVolume') {
    const index = new Map(result.finalPixels.map((pixel, position) => [pixel.id, position]))
    const cumulative = new Array<number>(result.finalPixels.length).fill(0)
    for (const event of result.harvestPixelList) {
      const position = index.get(event.pixelId)
      if (event.period <= period && position !== undefined) cumulative[position] += event.volumeM3
    }
    return cumulative
  }
  const fields: Record<CastorMetric, keyof CastorSnapshot> = {
    harvestYear: 'harvestedYear',
    harvestVolume: 'harvestedVolumeM3',
    constrainedYears: 'constrainedYears',
    constrainedPeriods: 'constrainedPeriods',
    constrained: 'constrained',
    age: 'age',
    volume: 'volume',
    height: 'height',
    eca: 'eca',
  }
  if (!(metric in fields)) throw new Error('Unknown Castor spatial output.')
  return row[fields[metric]] as Array<number | null>
}

const BC_ALBERS =
  '+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs'
export function castorToLonLat(project: CastorProject): ((coordinate: [number, number]) => [number, number]) | null {
  const crs = project.grid?.crs ?? project.crs
  if (!crs) return null
  let definition = crs
  const epsg = Number(/^EPSG:(\d+)$/i.exec(crs)?.[1] ?? 0)
  if (epsg === 3005) definition = BC_ALBERS
  else if (epsg >= 26901 && epsg <= 26923) definition = `+proj=utm +zone=${epsg - 26900} +datum=NAD83 +units=m +no_defs`
  else if (epsg >= 32601 && epsg <= 32660) definition = `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`
  else if (epsg >= 32701 && epsg <= 32760)
    definition = `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`
  else if (epsg >= 3154 && epsg <= 3160) definition = `+proj=utm +zone=${epsg - 3147} +ellps=GRS80 +units=m +no_defs`
  let converter: proj4.Converter
  try {
    const projection = new proj4.Proj(definition) as unknown as { units?: string; to_meter?: number; projName?: string }
    if (
      projection.projName === 'longlat' ||
      projection.projName === 'geocent' ||
      (projection.units !== undefined && projection.units !== 'm') ||
      (projection.to_meter !== undefined && Math.abs(projection.to_meter - 1) > 1e-12)
    )
      throw new Error('Inventory x/y and grid cell sizes require a projected CRS in metres.')
    converter = proj4(definition, 'EPSG:4326')
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('projected CRS in metres')) throw cause
    throw new Error(
      `The browser has no coordinate definition for ${crs}. Supply a supported projected CRS or WGS84 GeoJSON geometry.`,
    )
  }
  return (coordinate) => {
    const result = converter.forward(coordinate) as [number, number]
    if (!result.every(Number.isFinite) || Math.abs(result[0]) > 180 || Math.abs(result[1]) > 90)
      throw new Error('Projected inventory coordinates cannot be converted to valid longitude/latitude.')
    return result
  }
}
function pixelGeometry(
  project: CastorProject,
  pixel: CastorPixel,
  transform: ReturnType<typeof castorToLonLat>,
): Geometry | null {
  if (pixel.geometry) return pixel.geometry
  const grid = project.grid
  if (grid && pixel.gridIndex !== undefined && transform) {
    const x = grid.originX + (pixel.gridIndex % grid.width) * grid.cellSize
    const y = grid.originY - Math.floor(pixel.gridIndex / grid.width) * grid.cellSize
    const ring = [
      [x, y],
      [x, y - grid.cellSize],
      [x + grid.cellSize, y - grid.cellSize],
      [x + grid.cellSize, y],
      [x, y],
    ].map((xy) => transform(xy as [number, number]))
    return { type: 'Polygon', coordinates: [ring] } as Polygon
  }
  if (pixel.x !== undefined && pixel.y !== undefined && transform)
    return { type: 'Point', coordinates: transform([pixel.x, pixel.y]) }
  return null
}

export function castorSpatialGeoJson(
  project: CastorProject,
  result: CastorResult,
  period: number,
  metric: CastorMetric,
): FeatureCollection {
  const values = castorMetricValues(result, period, metric),
    state = snapshot(result, period)
  if (values.length !== project.pixels.length) throw new Error('The result does not match this inventory.')
  const transform = castorToLonLat(project),
    features: Feature[] = []
  project.pixels.forEach((pixel, index) => {
    const geometry = pixelGeometry(project, pixel, transform)
    if (geometry)
      features.push({
        type: 'Feature',
        id: pixel.id,
        geometry,
        properties: {
          id: pixel.id,
          pixelId: pixel.id,
          blockId: pixel.blockId,
          compartment: pixel.compartment,
          value: values[index],
          metric,
          units: CASTOR_METRICS[metric].units,
          period,
          year: state.year,
        },
      })
  })
  return { type: 'FeatureCollection', features }
}

export function castorLandingsGeoJson(
  project: CastorProject,
  result: CastorResult,
  period?: number,
): FeatureCollection<Point> {
  const transform = castorToLonLat(project),
    pixels = new Map(project.pixels.map((pixel) => [pixel.id, pixel]))
  const features: Array<Feature<Point>> = []
  for (const landing of result.landings) {
    if (period !== undefined && landing.period !== period) continue
    const pixel = pixels.get(landing.pixelId)
    let coordinates: number[] | undefined
    if (landing.x !== undefined && landing.y !== undefined && transform) coordinates = transform([landing.x, landing.y])
    else if (pixel) {
      const geometry = pixelGeometry(project, pixel, transform)
      if (geometry?.type === 'Point') coordinates = geometry.coordinates
      else if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon')
        coordinates = pointOnFeature({ type: 'Feature', properties: {}, geometry }).geometry.coordinates
    }
    if (coordinates)
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: {
          ...landing,
          status:
            landing.source === 'provided'
              ? 'Provided planning landing'
              : 'Candidate harvest-cell landing; field review required',
        },
      })
  }
  return { type: 'FeatureCollection', features }
}

export async function castorGeoTiff(
  project: CastorProject,
  result: CastorResult,
  period: number,
  metric: CastorMetric,
): Promise<Blob> {
  if (!project.grid) throw new Error('GeoTIFF export requires a regular grid with an explicit CRS and cell placement.')
  castorToLonLat(project)
  const values = castorMetricValues(result, period, metric)
  const gridValues: Array<number | null> = new Array(project.grid.width * project.grid.height).fill(null)
  project.pixels.forEach((pixel, index) => {
    if (pixel.gridIndex === undefined)
      throw new Error(`Pixel ${pixel.id} has no grid index; it cannot be placed in a raster.`)
    gridValues[pixel.gridIndex] = values[index]
  })
  const buffer = encodeCastorGeoTiff(
    project.grid,
    gridValues,
    JSON.stringify({
      model: result.modelVersion,
      scenario: result.scenario,
      period,
      metric,
      units: CASTOR_METRICS[metric].units,
      noData: -9999,
    }),
  )
  return new Blob([buffer], { type: 'image/tiff' })
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  )
}
export function castorHtmlReport(project: CastorProject, result: CastorResult): string {
  const summary = Object.entries(result.summary)
    .map(
      ([key, value]) =>
        `<tr><th>${escapeHtml(key)}</th><td>${value.toLocaleString('en-CA', { maximumFractionDigits: 3 })}</td></tr>`,
    )
    .join('')
  const notes = [...project.provenance.notes, ...result.assumptions, ...result.warnings]
  const sections = (Object.keys(reportKeys) as CastorReport[])
    .map((key) => {
      const rows = result[reportKeys[key]] as unknown as Array<Record<string, unknown>>
      const columns = rows.length ? Object.keys(rows[0]) : emptyColumns[key]
      const body = rows
        .slice(0, 500)
        .map(
          (row) =>
            `<tr>${columns.map((column) => `<td>${escapeHtml(row[column] == null ? '' : String(row[column]))}</td>`).join('')}</tr>`,
        )
        .join('')
      return `<h2>${escapeHtml(key)} (${rows.length} rows)</h2>${rows.length > 500 ? '<p>The first 500 rows are shown here. The accompanying CSV contains every row.</p>' : ''}<div class="table"><table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`
    })
    .join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(result.scenario)} — Castor report</title><style>body{font:15px system-ui;color:#17352b;max-width:1200px;margin:40px auto;padding:0 24px}h1,h2{color:#164f3b}table{border-collapse:collapse;font-size:12px;width:100%}th,td{padding:8px;border:1px solid #d6e2dc;text-align:left;white-space:nowrap}.table{overflow:auto}li{margin:.5em 0}@media print{body{margin:0;max-width:none}.table{overflow:visible}h2{break-after:avoid}tr{break-inside:avoid}}</style><h1>${escapeHtml(result.scenario)}</h1><p>${escapeHtml(project.name)} · ${escapeHtml(result.modelVersion)}</p><p>${escapeHtml(project.description)}</p><p>Source: ${escapeHtml(project.provenance.source)}${project.provenance.revision ? ` (${escapeHtml(project.provenance.revision)})` : ''}</p><h2>Run summary</h2><table>${summary}</table><h2>Assumptions and limitations</h2><ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>${sections}<h2>Reproducibility</h2><p>The bundle includes project/session JSON, complete CSV reports, spatial outputs and an inventory of files. This browser adaptation is not a complete numerical validation of the SpaDES module.</p></html>`
}

export async function castorReportBundle(project: CastorProject, result: CastorResult): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('session.json', serializeCastorSession(project, result.config, result))
  zip.file('project.json', JSON.stringify(project, null, 2))
  zip.file('result.json', JSON.stringify(result))
  zip.file('report.html', castorHtmlReport(project, result))
  for (const key of Object.keys(reportKeys) as CastorReport[])
    zip.file(`reports/${key}.csv`, castorReportCsv(result, key))
  zip.file('spatial/landings.geojson', JSON.stringify(castorLandingsGeoJson(project, result)))
  const last = result.snapshots[result.snapshots.length - 1]
  if (!last) throw new Error('Cannot export a run without snapshots.')
  const spatialNotes: string[] = []
  for (const metric of Object.keys(CASTOR_METRICS) as CastorMetric[]) {
    const data = castorSpatialGeoJson(project, result, last.period, metric)
    if (data.features.length) zip.file(`spatial/final-${metric}.geojson`, JSON.stringify(data))
    else if (!spatialNotes.length)
      spatialNotes.push('No georeferenced pixel geometry was provided; no geographic location has been invented.')
    if (project.grid)
      zip.file(
        `rasters/final-${metric}.tif`,
        await (await castorGeoTiff(project, result, last.period, metric)).arrayBuffer(),
      )
  }
  if (!project.grid)
    spatialNotes.push(
      'No regular grid was provided. GeoTIFF output requires explicit cell placements, resolution and CRS.',
    )
  const files = [...Object.keys(zip.files).filter((name) => !zip.files[name].dir), 'manifest.json', 'README.txt']
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        schema: 'pgmaps-castor-output-v1',
        modelVersion: result.modelVersion,
        scenario: result.scenario,
        source: project.provenance,
        spatialNotes,
        snapshotPeriods: result.snapshots.map((row) => row.period),
        rasterPeriod: last.period,
        rasterUnits: CASTOR_METRICS,
        files,
        allPeriods: 'Every period is retained in result.json; spatial/rasters contain final-period views.',
      },
      null,
      2,
    ),
  )
  zip.file(
    'README.txt',
    'PGMaps forestryCastor output bundle\n\nOpen report.html in a browser or print it to PDF. Reports/ CSVs contain every output row. session.json restores the exact inputs and settings; rerun to verify results. result.json retains all period snapshots. Spatial GeoJSON uses WGS84; Float64 GeoTIFFs preserve the input projected grid, with -9999 as NoData. Landings are planning candidates, not designed roads.\n\n' +
      spatialNotes.join('\n'),
  )
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
