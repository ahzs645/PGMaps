/**
 * What the Save & export dialog offers: each output's group, file type and one-line description,
 * why one is unavailable, and how a built file turns into its preview. No DOM or network access.
 */

export type RoadExport =
  | 'project'
  | 'geojson'
  | 'csv'
  | 'report'
  | 'report-pdf'
  | 'map-pdf'
  | 'landxml'
  | 'stakeout'
  | 'shapefile'
  | 'plotbook'
  | 'terrain-landxml'
  | 'terrain-ascii'
  | 'streams-csv'
  | 'provincial-evidence'
  | 'notes'

export type ExportGroup = 'project' | 'documents' | 'gis' | 'survey'

export interface ExportItem {
  kind: RoadExport
  group: ExportGroup
  label: string
  /** File type as the user sees it, e.g. `.pdf`. */
  extension: string
  description: string
}

export const EXPORT_GROUP_LABELS: Record<ExportGroup, string> = {
  project: 'Project',
  documents: 'Documents',
  gis: 'GIS data',
  survey: 'Survey & CAD',
}

export const EXPORT_ITEMS: readonly ExportItem[] = [
  {
    kind: 'project',
    group: 'project',
    label: 'Project file',
    extension: '.road.json',
    description:
      'Everything needed to reopen this design: alternatives, design controls, templates and terrain provenance.',
  },
  {
    kind: 'notes',
    group: 'project',
    label: 'Map notes',
    extension: '.geojson',
    description: 'Your sketches, pins, lines and areas with their text and colour, in WGS84 longitude/latitude.',
  },
  {
    kind: 'report-pdf',
    group: 'documents',
    label: 'Report PDF',
    extension: '.pdf',
    description: 'Planning report: summary, profile, sections, quantities, flags and the station schedule.',
  },
  {
    kind: 'report',
    group: 'documents',
    label: 'Report HTML',
    extension: '.html',
    description: 'The same report as a web page, to read in a browser or print to PDF.',
  },
  {
    kind: 'map-pdf',
    group: 'documents',
    label: 'Map PDF',
    extension: '.pdf',
    description: 'The plan map as it is shown now, on an A4 page with the terrain source and datum.',
  },
  {
    kind: 'plotbook',
    group: 'documents',
    label: 'Plot book',
    extension: '.html',
    description: 'Drawing sheets: plan and profile, sections and schedules, laid out by Sheet setup.',
  },
  {
    kind: 'geojson',
    group: 'gis',
    label: 'GeoJSON',
    extension: '.geojson',
    description:
      'Every road alternative with its totals, plus crossings, culverts and material sites, in WGS84 longitude/latitude.',
  },
  {
    kind: 'shapefile',
    group: 'gis',
    label: 'Shapefile',
    extension: '.zip',
    description: 'Road centrelines, stations and culverts as shapefile layers, zipped with their projection files.',
  },
  {
    kind: 'csv',
    group: 'gis',
    label: 'Station CSV',
    extension: '.csv',
    description: 'One row per calculated station: levels, grade, areas, volumes and review flags.',
  },
  {
    kind: 'streams-csv',
    group: 'gis',
    label: 'Stream register',
    extension: '.csv',
    description: 'Each stream with its imported, suggested and reviewed class, channel width, reserves and evidence.',
  },
  {
    kind: 'provincial-evidence',
    group: 'gis',
    label: 'Fish & watershed evidence',
    extension: '.geojson',
    description: 'The provincial stream, fish and watershed records loaded for this project.',
  },
  {
    kind: 'landxml',
    group: 'survey',
    label: 'LandXML alignment',
    extension: '.xml',
    description: 'Horizontal and vertical alignment with cross-sections, for civil design software.',
  },
  {
    kind: 'stakeout',
    group: 'survey',
    label: 'Stakeout',
    extension: '.csv',
    description: 'Centreline and section points with grid coordinates, design levels and cut/fill, for field layout.',
  },
  {
    kind: 'terrain-landxml',
    group: 'survey',
    label: 'Terrain surface',
    extension: '.xml',
    description: 'The embedded terrain grid as a LandXML surface, with its source coordinates.',
  },
  {
    kind: 'terrain-ascii',
    group: 'survey',
    label: 'Terrain grid',
    extension: '.asc',
    description: 'The embedded terrain grid as an Esri ASCII raster.',
  },
]

export interface ExportContext {
  /** A design preview (draft, peg entry, template or cost preview) is open. */
  designPreview: boolean
  hasResults: boolean
  /** The workspace shows a terrain profile rather than a road. */
  terrainProfile: boolean
  hasTerrainGrid: boolean
  hasProvincialEvidence: boolean
  hasNotes: boolean
}

/** Why an output cannot be made right now, or null when it can. */
export function exportUnavailable(kind: RoadExport, context: ExportContext): string | null {
  if (kind === 'project') return null
  // Notes are drawn, not calculated, so they export whatever state the road is in.
  if (kind === 'notes') return context.hasNotes ? null : 'Draw a note on the plan first.'
  if (context.designPreview) return 'Finish or close the design preview first.'
  if (!context.hasResults) return 'No calculated results yet.'
  if (context.terrainProfile && ['plotbook', 'landxml', 'stakeout'].includes(kind)) return 'Return to the road first.'
  if ((kind === 'terrain-landxml' || kind === 'terrain-ascii') && !context.hasTerrainGrid)
    return 'Needs an imported or prepared terrain grid.'
  if (kind === 'provincial-evidence' && !context.hasProvincialEvidence) return 'Load provincial stream evidence first.'
  return null
}

type Position = [number, number]

export interface GeometryLayer {
  name: string
  points: Position[]
  lines: Position[][]
}

export type ExportPreview =
  | { type: 'html'; html: string }
  | { type: 'image'; src: string; width: number; height: number }
  | { type: 'table'; header: string[]; rows: string[][]; total: number }
  | { type: 'geometry'; layers: GeometryLayer[] }
  | { type: 'text'; text: string; lines: number; bytes: number }

const PREVIEW_ROWS = 40
const PREVIEW_LINES = 80

/** Splits CSV text on commas and newlines outside quotes; `""` inside quotes is a quote. */
export function parseCsv(text: string, limit = Infinity): { rows: string[][]; total: number } {
  const rows: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false,
    total = 0
  const endRow = () => {
    row.push(field)
    field = ''
    if (row.length > 1 || row[0] !== '') {
      total++
      if (rows.length < limit) rows.push(row)
    }
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') endRow()
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) endRow()
  return { rows, total }
}

export function csvPreview(text: string): ExportPreview {
  const { rows, total } = parseCsv(text, PREVIEW_ROWS + 1)
  return { type: 'table', header: rows[0] ?? [], rows: rows.slice(1), total: Math.max(0, total - 1) }
}

export function textPreview(text: string): ExportPreview {
  let lines = 1,
    cut = -1
  for (let i = 0; i < text.length; i++)
    if (text[i] === '\n') {
      if (lines === PREVIEW_LINES) cut = i
      lines++
    }
  return {
    type: 'text',
    text: cut < 0 ? text : text.slice(0, cut),
    lines,
    bytes: new TextEncoder().encode(text).length,
  }
}

type GeoJsonGeometry = { type: string; coordinates?: unknown; geometries?: GeoJsonGeometry[] }

function collect(geometry: GeoJsonGeometry | null | undefined, layer: GeometryLayer) {
  if (!geometry) return
  const c = geometry.coordinates as never
  switch (geometry.type) {
    case 'Point':
      layer.points.push(c)
      break
    case 'MultiPoint':
      layer.points.push(...(c as Position[]))
      break
    case 'LineString':
      layer.lines.push(c)
      break
    case 'MultiLineString':
    case 'Polygon':
      layer.lines.push(...(c as Position[][]))
      break
    case 'MultiPolygon':
      for (const polygon of c as Position[][][]) layer.lines.push(...polygon)
      break
    case 'GeometryCollection':
      for (const part of geometry.geometries ?? []) collect(part, layer)
  }
}

/** Groups a FeatureCollection's geometry by the features' `kind` (or `type`) property. */
export function geoJsonPreview(collection: {
  features: { geometry: GeoJsonGeometry | null; properties?: Record<string, unknown> | null }[]
}): ExportPreview {
  const layers = new Map<string, GeometryLayer>()
  for (const feature of collection.features) {
    const name = String(feature.properties?.kind ?? feature.properties?.type ?? feature.geometry?.type ?? 'feature')
    const layer = layers.get(name) ?? { name, points: [], lines: [] }
    layers.set(name, layer)
    collect(feature.geometry, layer)
  }
  return { type: 'geometry', layers: [...layers.values()] }
}

/** Fits geometry into a `width` × `height` box, keeping metres square at the data's latitude. */
export function fitGeometry(layers: GeometryLayer[], width: number, height: number, padding = 8) {
  const all = layers.flatMap((layer) => [...layer.points, ...layer.lines.flat()])
  if (!all.length) return null
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const [x, y] of all) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const squash = Math.cos((((minY + maxY) / 2) * Math.PI) / 180)
  const spanX = Math.max((maxX - minX) * squash, 1e-9),
    spanY = Math.max(maxY - minY, 1e-9)
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY)
  const offsetX = (width - spanX * scale) / 2,
    offsetY = (height - spanY * scale) / 2
  return ([x, y]: Position): Position => [offsetX + (x - minX) * squash * scale, height - offsetY - (y - minY) * scale]
}
