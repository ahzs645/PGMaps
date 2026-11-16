/**
 * What the Save & export dialog offers: each output's group, file type and one-line description,
 * why one is unavailable, and how a built file turns into its preview. No DOM or network access.
 */

import { materialPlanMissing, type HaulSummary } from './engineeringTypes'
import { invalidInputMessages, type InvalidInput } from './inputErrors'

export { invalidInputRefusal } from './inputErrors'

export type RoadExport =
  | 'project'
  | 'geojson'
  | 'csv'
  | 'report'
  | 'report-pdf'
  | 'report-package'
  | 'estimate-pdf'
  | 'map-pdf'
  | 'block-sheet-pdf'
  | 'dline-sheet-pdf'
  | 'landxml'
  | 'roadeng'
  | 'roadeng-project'
  | 'dxf'
  | 'stakeout'
  | 'shapefile'
  | 'plotbook'
  | 'plotbook-pdf'
  | 'terrain-landxml'
  | 'terrain-ascii'
  | 'mass-haul-csv'
  | 'optimal-haul-csv'
  | 'optimal-areas-csv'
  | 'optimal-inputs'
  | 'softree-location-ascii'
  | 'softree-terrain-ascii'
  | 'streams-csv'
  | 'provincial-evidence'
  | 'notes'
  | 'qgis-project'
  | 'arcgis-pro'
  | 'web-map-style'
  | 'symbol-library'

export type ExportGroup = 'project' | 'documents' | 'gis' | 'survey'

export interface ExportItem {
  kind: RoadExport
  group: ExportGroup
  label: string
  /** File type as the user sees it, e.g. `.pdf`. */
  extension: string
  description: string
}

/** Outputs that print the issue stamp: who prepared them, the revision and the date of issue. */
export const STAMPED_EXPORTS: readonly RoadExport[] = [
  'report',
  'report-pdf',
  'report-package',
  'estimate-pdf',
  'plotbook',
  'plotbook-pdf',
  'map-pdf',
  'block-sheet-pdf',
  'dline-sheet-pdf',
]
/** Outputs that can hold one road or every road of the project. */
export const MULTI_ROAD_EXPORTS: readonly RoadExport[] = [
  'geojson',
  'shapefile',
  'roadeng',
  'roadeng-project',
  'report-package',
  'estimate-pdf',
  'qgis-project',
  'arcgis-pro',
  'web-map-style',
  // Its ground is the RoadEng project's terrain, kept along the roads written.
  'softree-terrain-ascii',
]
export type RoadScope = 'active' | 'all'
/** Outputs that write other programs' styles, so the browser's style library can change what they draw. */
export const STYLE_LIBRARY_EXPORTS: readonly RoadExport[] = ['shapefile', 'qgis-project', 'arcgis-pro', 'web-map-style']

/**
 * The roads a multi-road output writes. A file handed to someone else carries the road on screen
 * unless every road is asked for, so a superseded alternative or a starter line does not go with it.
 */
export function exportRoads<T extends { id: string }>(
  alignments: readonly T[],
  activeId: string,
  scope: RoadScope,
): T[] {
  if (scope === 'all') return [...alignments]
  const active = alignments.filter((alignment) => alignment.id === activeId)
  return active.length ? active : [...alignments]
}

/**
 * What an output does while a road's results leave out an invalid input (`RoadAnalysis.invalidInput`).
 *
 * - `stamp`: a document a person reads. It is written, and says prominently which input it leaves out.
 * - `refuse`: a file handed to a contractor or read by other software. It has nowhere to carry a
 *   notice its reader will see, so it is not written until the input is corrected.
 * - `unaffected`: holds no calculated design result.
 */
export type InvalidInputRule = 'stamp' | 'refuse' | 'unaffected'
export const INVALID_INPUT_RULES: Record<RoadExport, InvalidInputRule> = {
  project: 'unaffected',
  notes: 'unaffected',
  'terrain-landxml': 'unaffected',
  'terrain-ascii': 'unaffected',
  // The RoadEng terrain's ground and drawn layers: no calculated design result.
  'softree-terrain-ascii': 'unaffected',
  'streams-csv': 'unaffected',
  'provincial-evidence': 'unaffected',
  report: 'stamp',
  'report-pdf': 'stamp',
  // Its reports are stamped; a plot-book part is refused while an input is invalid, as the plot book is.
  'report-package': 'stamp',
  'estimate-pdf': 'stamp',
  'map-pdf': 'stamp',
  'block-sheet-pdf': 'stamp',
  // No road input reaches a D-line; the D-line's own invalid inputs refuse it (`dLineSheetUnavailable`).
  'dline-sheet-pdf': 'unaffected',
  plotbook: 'refuse',
  'plotbook-pdf': 'refuse',
  landxml: 'refuse',
  roadeng: 'refuse',
  'roadeng-project': 'refuse',
  dxf: 'refuse',
  stakeout: 'refuse',
  csv: 'refuse',
  geojson: 'refuse',
  shapefile: 'refuse',
  'qgis-project': 'refuse',
  'arcgis-pro': 'refuse',
  'web-map-style': 'refuse',
  'mass-haul-csv': 'refuse',
  'optimal-haul-csv': 'refuse',
  'optimal-areas-csv': 'refuse',
  // Inputs only, but read by Softree Optimal beside the areas file it must match.
  'optimal-inputs': 'refuse',
  'softree-location-ascii': 'refuse',
  // The catalogue's symbols only: no road result goes in it.
  'symbol-library': 'unaffected',
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
    description:
      'Planning report: issue stamp, readiness checks, profile, sections, quantities, flags and the station schedule.',
  },
  {
    kind: 'report-package',
    group: 'documents',
    label: 'Report package',
    extension: '.pdf / .zip',
    description:
      'One PDF for one road or every road, with a cover and contents: choose which report sections, plot-book chapters and block sheets go in the package, in an appendix PDF of their own, or nowhere.',
  },
  {
    kind: 'estimate-pdf',
    group: 'documents',
    label: 'Preliminary estimate',
    extension: '.pdf',
    description:
      'Each road priced low, medium and high on copies of it, from the fixes Review offers for sections that do not close, beside its estimate as imported, with your cross-drain and end-haul allowances.',
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
    kind: 'block-sheet-pdf',
    group: 'documents',
    label: 'Block map sheet',
    extension: '.pdf',
    description:
      'A printed block map: field layout, LiDAR slope, canopy height or hillshade, 1:50,000 access or imagery, with block information, legend and roads.',
  },
  {
    kind: 'dline-sheet-pdf',
    group: 'documents',
    label: 'D-line sheet',
    extension: '.pdf',
    description:
      'The D-line on screen on one page: profile with supports and load path, a plan strip, the support and stake-out table, limits, rigging and assumptions.',
  },
  {
    kind: 'plotbook-pdf',
    group: 'documents',
    label: 'Plot book PDF',
    extension: '.pdf',
    description: 'Drawing sheets: plan and profile, sections and schedules, laid out by Sheet setup.',
  },
  {
    kind: 'plotbook',
    group: 'documents',
    label: 'Plot book HTML',
    extension: '.html',
    description: 'The same drawing sheets as a web page, to read in a browser or print.',
  },
  {
    kind: 'geojson',
    group: 'gis',
    label: 'GeoJSON',
    extension: '.geojson',
    description:
      'The road on screen, or every road, with totals, crossings, culverts and material sites, in WGS84 longitude/latitude.',
  },
  {
    kind: 'shapefile',
    group: 'gis',
    label: 'Shapefile',
    extension: '.zip',
    description:
      'Road centrelines, stations and culverts as shapefile layers, zipped with their projection files and a QGIS (.qml), SLD and ArcGIS Pro (.lyrx) style beside each. One road or all.',
  },
  {
    kind: 'qgis-project',
    group: 'gis',
    label: 'QGIS project',
    extension: '.zip',
    description:
      'The roads, culverts, stations, streams, existing roads and constraints drawn with the plan’s symbols as a QGIS project (.qgz), with the block sheet layouts as print templates.',
  },
  {
    kind: 'arcgis-pro',
    group: 'gis',
    label: 'ArcGIS Pro map',
    extension: '.zip',
    description:
      'The same layers with an ArcGIS Pro layer file (.lyrx) each, a map (.mapx), the block sheet layouts (.pagx) and the map symbols as a style (.stylx).',
  },
  {
    kind: 'web-map-style',
    group: 'gis',
    label: 'Web map styles',
    extension: '.zip',
    description:
      'The same layers as a MapLibre style with its sprites, a GeoLibre project and SLD styles for GeoServer, with the data as GeoJSON.',
  },
  {
    kind: 'symbol-library',
    group: 'gis',
    label: 'Symbol library',
    extension: '.zip',
    description:
      'Every map symbol PGMaps draws, as a QGIS style library, an ArcGIS Pro style (.stylx) and a GeoLibre style library.',
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
    description: 'Horizontal and vertical alignment with cross-sections and superelevation, for civil design software.',
  },
  {
    kind: 'roadeng',
    group: 'survey',
    label: 'RoadEng design',
    extension: '.dsnx',
    description: 'Horizontal and vertical alignment of each road as a Softree RoadEng design, in grid metres.',
  },
  {
    kind: 'roadeng-project',
    group: 'survey',
    label: 'RoadEng project',
    extension: '.zip',
    description: "Each road's design with its terrain and the project's drawn layers, as a zipped RoadEng project.",
  },
  {
    kind: 'dxf',
    group: 'survey',
    label: 'CAD drawing (DXF)',
    extension: '.dxf',
    description:
      'Plan centreline with true arcs, 3D edge, ditch and catch lines, station labels, and the profile and cross-sections at true scale, as AutoCAD R12 DXF.',
  },
  {
    kind: 'stakeout',
    group: 'survey',
    label: 'Stakeout',
    extension: '.csv',
    description: 'Centreline and section points with grid coordinates, design levels and cut/fill, for field layout.',
  },
  {
    kind: 'softree-location-ascii',
    group: 'survey',
    label: 'Softree location ASCII',
    extension: '.txt',
    description:
      'Ground, prepared ground and subgrade section points at every station, with RoadEng point codes, as a RoadEng location ASCII coordinate file for staking.',
  },
  {
    kind: 'mass-haul-csv',
    group: 'survey',
    label: 'RoadEng mass haul',
    extension: '.csv',
    description:
      'Balance items of the mass-haul curve, as RoadEng’s Mass Haul export: free haul, over haul, borrow and waste, with stations, centroids and over-haul.',
  },
  {
    kind: 'optimal-haul-csv',
    group: 'survey',
    label: 'RoadEng optimal haul',
    extension: '.csv',
    description:
      'The solved material plan as RoadEng’s Optimal Haul export: cost, volume, pit and movement summaries, movement details and the detailed movement summary.',
  },
  {
    kind: 'optimal-areas-csv',
    group: 'survey',
    label: 'Softree Optimal areas',
    extension: '.csv',
    description: 'Cut and fill areas by material at each station, as the Areas file Softree Optimal reads.',
  },
  {
    kind: 'optimal-inputs',
    group: 'survey',
    label: 'Softree Optimal inputs',
    extension: '.zip',
    description: 'Materials, pits and haul cost model as Softree Optimal API CSV files.',
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
  {
    kind: 'softree-terrain-ascii',
    group: 'survey',
    label: 'Softree terrain ASCII',
    extension: '.txt',
    description:
      'The ground points and drawn layers of the RoadEng project export, one line per point, as RoadEng’s terrain ASCII file.',
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
  /** The project has at least one stream, so the stream register has a row to write. */
  hasStreams: boolean
  hasNotes: boolean
  /**
   * The project holds no road yet, only a terrain with a grid (one opened from a RoadEng `.terx`):
   * the RoadEng project export writes that terrain whole, with its layers.
   */
  terrainOnly?: boolean
  /** Why the D-line sheet cannot be made (no D-line, or its own inputs are invalid); null when it can. */
  dLineSheetUnavailable?: string | null
  /** Why the Optimal Haul export cannot be made (haul off, plan not solved); null or absent when it can. */
  optimalHaulUnavailable?: string | null
  /** The invalid input the roads an output would write leave out, if any. */
  invalidInput?: (kind: RoadExport) => InvalidInput | undefined
}

/** Why the Optimal Haul export cannot be made from a road's haul result, or null when it can. */
export function optimalHaulUnavailable(
  haul: Pick<HaulSummary, 'enabled' | 'optimizationStatus'> | null | undefined,
): string | null {
  if (!haul?.enabled) return 'Turn on haul allocation first.'
  if (materialPlanMissing(haul)) return 'The material plan was not calculated.'
  return null
}

/** The invalid input an output is affected by, under its rule; undefined when it is unaffected. */
const invalidFor = (kind: RoadExport, context: ExportContext) =>
  INVALID_INPUT_RULES[kind] === 'unaffected' ? undefined : context.invalidInput?.(kind)

/** Why an output cannot be made right now, or null when it can. */
export function exportUnavailable(kind: RoadExport, context: ExportContext): string | null {
  // The symbol library holds the catalogue, which needs no road.
  if (kind === 'project' || kind === 'symbol-library') return null
  // Notes are drawn, not calculated, so they export whatever state the road is in.
  if (kind === 'notes') return context.hasNotes ? null : 'Draw a note on the plan first.'
  if (context.designPreview) return 'Finish or close the design preview first.'
  if (kind === 'roadeng-project' && context.terrainOnly && !context.terrainProfile) return null
  if (!context.hasResults) return 'No calculated results yet.'
  if (kind === 'dline-sheet-pdf' && context.dLineSheetUnavailable !== null)
    return context.dLineSheetUnavailable ?? 'Draw a D-line in Review first.'
  if (
    context.terrainProfile &&
    [
      'plotbook',
      'plotbook-pdf',
      'report-package',
      'estimate-pdf',
      'landxml',
      'roadeng',
      'roadeng-project',
      'dxf',
      'stakeout',
      'mass-haul-csv',
      'optimal-haul-csv',
      'optimal-areas-csv',
      'optimal-inputs',
      'softree-location-ascii',
      'softree-terrain-ascii',
    ].includes(kind)
  )
    return 'Return to the road first.'
  if ((kind === 'terrain-landxml' || kind === 'terrain-ascii') && !context.hasTerrainGrid)
    return 'Needs an imported or prepared terrain grid.'
  if (kind === 'optimal-haul-csv' && context.optimalHaulUnavailable) return context.optimalHaulUnavailable
  if (kind === 'provincial-evidence' && !context.hasProvincialEvidence) return 'Load provincial stream evidence first.'
  if (kind === 'streams-csv' && !context.hasStreams)
    return 'No streams in this project yet. Import or load streams first.'
  const invalid = invalidFor(kind, context)
  if (invalid && INVALID_INPUT_RULES[kind] === 'refuse')
    return `Correct the invalid input first. ${invalidInputMessages(invalid).join(' ')}`
  return null
}

/** What an available output says about itself: a stamped document names the input it leaves out. */
export function exportStampNote(kind: RoadExport, context: ExportContext): string | null {
  const invalid = invalidFor(kind, context)
  if (!invalid || INVALID_INPUT_RULES[kind] !== 'stamp' || exportUnavailable(kind, context)) return null
  const count = invalidInputMessages(invalid).length
  return `Stamped: leaves out ${count === 1 ? 'an invalid input' : `${count} invalid inputs`}. ${invalidInputMessages(invalid).join(' ')}`
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
