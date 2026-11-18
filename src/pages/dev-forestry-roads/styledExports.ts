/**
 * The styled GIS exports: the road's shapefile layers together with their look in another
 * application's own format, and the symbol catalogue as a library. Each bundle is a list of files
 * the page zips: `data/` holds the shapefiles, the styles sit beside them or reference them
 * relatively, and `README.txt` says how to open the bundle and lists what each format could not
 * carry (`ExchangeDiagnostic`s from the writers). No DOM or network access; sql.js and the PNG
 * encoder are passed in.
 */
import type { SqlJsStatic } from 'sql.js'
import { catalogueSymbolLibrary } from '@/lib/forestry/blockSheet/symbolLibrary'
import { SHEET_PRESETS } from '@/lib/forestry/blockSheet/sheets'
import { SHEET_TEMPLATES } from '@/lib/mapSheet/layout'
import { arcgisMapx } from '@/lib/styleExchange/arcgis/mapx'
import { arcgisLayerFiles } from '@/lib/styleExchange/arcgis/lyrx'
import { arcgisPagx } from '@/lib/styleExchange/arcgis/pagx'
import { arcgisStylx } from '@/lib/styleExchange/arcgis/stylx'
import {
  safeFileStem,
  type ExchangeDiagnostic,
  type ExchangeFile,
  type LayoutDocument,
  type StyleDocument,
  type SymbolLibrary,
} from '@/lib/styleExchange/model'
import { qgisProject, qgisLayoutTemplate } from '@/lib/styleExchange/qgis/qgisProject'
import { qgisLayerStyles } from '@/lib/styleExchange/qgis/qml'
import { qgisStyleLibraryXml } from '@/lib/styleExchange/qgis/qgisStyleLibrary'
import { geolibreLayerStyles, geolibreProject, geolibreStyleLibrary } from '@/lib/styleExchange/web/geolibre'
import { maplibreStyle } from '@/lib/styleExchange/web/maplibre'
import { sldLayerStyles } from '@/lib/styleExchange/web/sld'
import type { RoadExport } from './exportCatalog'
import { roadExportStyleDocument, type StyleOverrides } from './exportStyles'
import { writeShapefileLayer, type ShapeLayer } from './shapefile'

export type StyledExportKind = Extract<RoadExport, 'qgis-project' | 'arcgis-pro' | 'web-map-style' | 'symbol-library'>
export const STYLED_EXPORTS: readonly StyledExportKind[] = [
  'qgis-project',
  'arcgis-pro',
  'web-map-style',
  'symbol-library',
]
export const isStyledExport = (kind: RoadExport): kind is StyledExportKind =>
  (STYLED_EXPORTS as readonly RoadExport[]).includes(kind)

export interface StyledExportDeps {
  encodePng: (rgba: Uint8ClampedArray, width: number, height: number) => Promise<Uint8Array>
  /** sql.js, for the ArcGIS Pro style database. */
  SQL?: SqlJsStatic
}

export interface StyledExportInput {
  /** Project name: file stems, project and layout titles. */
  name: string
  layers: readonly ShapeLayer[]
  roads: readonly { name: string; color: string }[]
  /** Font glyphs URL for MapLibre labels; without it the MapLibre style draws no labels. */
  glyphs?: string
  /** Symbols from this browser's style library that replace PGMaps' own. */
  overrides?: StyleOverrides
}

export interface StyledExportBundle {
  files: ExchangeFile[]
  diagnostics: ExchangeDiagnostic[]
  /** Shapefile field warnings (`encodeDbf`). */
  dataWarnings: string[]
  document: StyleDocument | null
  library: SymbolLibrary | null
}

/** A layout for each sheet template, titled with the project, framing the data. */
export function exportLayouts(name: string, document: StyleDocument): LayoutDocument[] {
  return SHEET_TEMPLATES.map((template) => ({
    name: template.id,
    paper: Object.values(SHEET_PRESETS).find((preset) => preset.template.id === template.id)?.defaultPaper ?? 'tabloid',
    template,
    title: name,
    subtitle: 'Proposed roads',
    ...(document.extent ? { extent: document.extent } : {}),
  }))
}

/** A shapefile layer's features as GeoJSON, for the formats that carry their data inline. */
export function shapeLayerGeoJson(layer: ShapeLayer): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: layer.features.map((feature) => ({
      type: 'Feature',
      properties: { ...feature.attributes },
      geometry:
        layer.type === 'point'
          ? { type: 'Point', coordinates: (feature as { point: number[] }).point }
          : layer.type === 'polygon'
            ? { type: 'Polygon', coordinates: (feature as { parts: number[][][] }).parts }
            : { type: 'MultiLineString', coordinates: (feature as { parts: number[][][] }).parts },
    })),
  }
}

/** Shapefiles under `data/`, with their field warnings. */
function dataFiles(layers: readonly ShapeLayer[], folder = 'data/') {
  const files: ExchangeFile[] = []
  const warnings: string[] = []
  for (const layer of layers) {
    const written = writeShapefileLayer(layer)
    warnings.push(...written.warnings)
    for (const [name, bytes] of Object.entries(written.files))
      files.push({ path: `${folder}${name}`, content: bytes, mime: 'application/octet-stream' })
  }
  return { files, warnings }
}

const within = (folder: string, files: ExchangeFile[]) =>
  files.map((file) => ({ ...file, path: `${folder}${file.path}` }))

const FORMAT_NAMES: Record<ExchangeDiagnostic['format'], string> = {
  qml: 'QGIS layer style (.qml)',
  'qgis-style': 'QGIS style library',
  qgs: 'QGIS project',
  qpt: 'QGIS layout template (.qpt)',
  sld: 'SLD',
  maplibre: 'MapLibre style',
  geolibre: 'GeoLibre',
  lyrx: 'ArcGIS Pro layer file (.lyrx)',
  mapx: 'ArcGIS Pro map (.mapx)',
  pagx: 'ArcGIS Pro layout (.pagx)',
  stylx: 'ArcGIS Pro style (.stylx)',
  kml: 'KML',
}

/** The bundle's README: how to open it, then every approximation grouped by format. */
export function bundleReadme(title: string, opening: string[], diagnostics: readonly ExchangeDiagnostic[]): string {
  const lines = [title, '='.repeat(title.length), '', ...opening, '']
  const byFormat = new Map<string, ExchangeDiagnostic[]>()
  for (const diagnostic of diagnostics) {
    const list = byFormat.get(diagnostic.format) ?? []
    list.push(diagnostic)
    byFormat.set(diagnostic.format, list)
  }
  if (!byFormat.size) lines.push('Every symbol was written exactly in every format.')
  else {
    lines.push('What each format could not carry exactly', '----------------------------------------', '')
    for (const [format, list] of byFormat) {
      lines.push(`${FORMAT_NAMES[format as ExchangeDiagnostic['format']] ?? format}:`)
      const seen = new Set<string>()
      for (const diagnostic of list) {
        const text = `  - ${diagnostic.subject ? `${diagnostic.subject}: ` : ''}${diagnostic.message}`
        if (!seen.has(text)) lines.push(text)
        seen.add(text)
      }
      lines.push('')
    }
  }
  return lines.join('\n') + '\n'
}

const readmeFile = (text: string): ExchangeFile => ({ path: 'README.txt', content: text, mime: 'text/plain' })

/**
 * Styles that ride along inside the plain shapefile zip, one of each per layer beside its `.shp`:
 * a `.qml` QGIS loads with the layer, an `.sld`, and a `.lyrx` that reads the shapefile next to it.
 */
export function shapefileStyleSidecars(
  name: string,
  layers: readonly ShapeLayer[],
  roads: readonly { name: string; color: string }[],
  overrides: StyleOverrides = {},
): { files: ExchangeFile[]; diagnostics: ExchangeDiagnostic[] } {
  const document = roadExportStyleDocument(name, layers, roads, overrides)
  const results = [qgisLayerStyles(document), sldLayerStyles(document), arcgisLayerFiles(document, { dataFolder: '.' })]
  return { files: results.flatMap((r) => r.files), diagnostics: results.flatMap((r) => r.diagnostics) }
}

/** Every file of one styled export. */
export async function styledExportBundle(
  kind: StyledExportKind,
  input: StyledExportInput,
  deps: StyledExportDeps,
): Promise<StyledExportBundle> {
  const stem = safeFileStem(input.name)
  if (kind === 'symbol-library') {
    const library = catalogueSymbolLibrary()
    if (!deps.SQL) throw Error('The ArcGIS Pro style needs sql.js, which did not load.')
    const parts = [
      { folder: 'qgis/', result: qgisStyleLibraryXml(library) },
      { folder: 'arcgis/', result: arcgisStylx(library, deps.SQL) },
      { folder: 'geolibre/', result: geolibreStyleLibrary(library) },
    ]
    const diagnostics = parts.flatMap((part) => part.result.diagnostics)
    const files = parts.flatMap((part) => within(part.folder, part.result.files))
    files.push(
      readmeFile(
        bundleReadme(
          `${library.name}: ${library.symbols.length} symbols`,
          [
            'qgis/      QGIS: Settings > Style Manager > Import/Export > Import Items, and choose the .xml file.',
            'arcgis/    ArcGIS Pro: Catalog pane > Styles > Add > Add Style, and choose the .stylx file.',
            'geolibre/  GeoLibre: Settings > Style Manager > Import, and choose the .json file.',
            '',
            'Point icons are PGMaps drawings carried as vector shapes or SVG, never symbol-font glyphs.',
          ],
          diagnostics,
        ),
      ),
    )
    return { files, diagnostics, dataWarnings: [], document: null, library }
  }

  const document = roadExportStyleDocument(input.name, input.layers, input.roads, input.overrides)
  const layouts = exportLayouts(input.name, document)
  const data = dataFiles(input.layers)
  const files: ExchangeFile[] = []
  const diagnostics: ExchangeDiagnostic[] = []
  const take = (result: { files: ExchangeFile[]; diagnostics: ExchangeDiagnostic[] }, folder = '') => {
    files.push(...within(folder, result.files))
    diagnostics.push(...result.diagnostics)
  }
  let opening: string[]
  if (kind === 'qgis-project') {
    files.push(...data.files)
    // A .qml beside each shapefile loads with it, so the data keeps its look opened on its own.
    take(qgisLayerStyles(document), 'data/')
    take(qgisProject(document, { layouts }))
    for (const layout of layouts) take(qgisLayoutTemplate(layout, document), 'layouts/')
    opening = [
      `Open ${stem}.qgz in QGIS 3.28 or later. The layers read data/ beside it, so keep the folder together.`,
      'Each layer in data/ also has its own .qml: dragged into QGIS alone, a shapefile takes its style with it.',
      'layouts/ holds the block sheet layouts as print templates: Project > New Print Layout > Add Items from Template.',
      'The operating-plan template includes branding and locator spaces to fill in QGIS; the populated locator is in the Block map sheet PDF.',
    ]
  } else if (kind === 'arcgis-pro') {
    files.push(...data.files)
    take(arcgisLayerFiles(document, { dataFolder: 'data' }))
    take(arcgisMapx(document, { dataFolder: 'data' }))
    // Beside the .mapx, not in a folder: their maps read data\ by the same relative path.
    for (const layout of layouts) take(arcgisPagx(layout, document, { dataFolder: 'data' }))
    if (deps.SQL) take(arcgisStylx(catalogueSymbolLibrary(), deps.SQL), 'styles/')
    opening = [
      `Import ${stem}.mapx (Insert > Import Map) for every layer at once, or add one .lyrx at a time.`,
      'The layer files read the shapefiles in data/ by relative path: keep the folder together.',
      'The .pagx files are the block sheet layouts (Insert > Import Layout). styles/ holds every PGMaps map symbol',
      'as a style: Catalog pane > Styles > Add > Add Style.',
      'The operating-plan template includes branding and locator spaces to fill in Pro; the populated locator is in the Block map sheet PDF.',
      'These files follow the published CIM specification; they were checked against Esri sample files, not in',
      'ArcGIS Pro itself.',
    ]
  } else {
    const geojson = Object.fromEntries(input.layers.map((layer) => [layer.name, shapeLayerGeoJson(layer)]))
    take(await maplibreStyle(document, geojson, { encodePng: deps.encodePng, glyphs: input.glyphs }), 'maplibre/')
    take(geolibreProject(document, geojson, { layout: layouts[1] ?? layouts[0] }), 'geolibre/')
    take(geolibreLayerStyles(document), 'geolibre/')
    take(sldLayerStyles(document), 'sld/')
    files.push(
      ...within(
        'geojson/',
        Object.entries(geojson).map(([id, collection]) => ({
          path: `${id}.geojson`,
          content: JSON.stringify(collection),
          mime: 'application/geo+json',
        })),
      ),
    )
    opening = [
      'maplibre/  A MapLibre GL style (v8) with the data inline and its sprite sheets. Serve the folder over',
      '           HTTP and load style.json; the sprite is read relative to it.',
      `geolibre/  Open ${stem}.geolibre in GeoLibre (Project > Open). The .geolibre.style.json files style the`,
      '           GeoJSON files in geojson/ one at a time.',
      'sld/       One SLD 1.1 per layer, for GeoServer or QGIS (Layer Properties > Style > Load Style).',
      'geojson/   The layers as GeoJSON, WGS84 longitude/latitude.',
    ]
  }
  const replaced = Object.values(input.overrides ?? {}).map((symbol) => symbol.label)
  if (replaced.length)
    opening.push(
      '',
      `Drawn with styles from this browser's style library instead of PGMaps' own: ${replaced.join(', ')}.`,
    )
  files.push(readmeFile(bundleReadme(`${input.name}: styled GIS export`, opening, diagnostics)))
  return { files, diagnostics, dataWarnings: data.warnings, document, library: null }
}
