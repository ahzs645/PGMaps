/**
 * Writes the style-exchange fixture as QGIS would receive it, for `qgis-check.py` to open in QGIS:
 * `data/<id>.shp` (+ .dbf/.shx/.prj/.cpg) beside `data/<id>.qml`, the `.qgz` project, the `.qpt`
 * layout template, the catalogue as a QGIS style library and `manifest.json` with what QGIS should
 * find (renderer, rule counts, symbol layer classes, and the rule PGMaps draws each feature with).
 *
 * Usage: npx tsx scripts/style-exchange/write-fixture-export.ts <output folder>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { catalogueSymbolLibrary } from '../../src/lib/forestry/blockSheet/symbolLibrary'
import type { SheetSymbol } from '../../src/lib/mapSheet/symbols'
import { writeShapefileLayer, type ShapeField, type ShapeLayer } from '../../src/pages/dev-forestry-roads/shapefile'
import type { Coordinate } from '../../src/pages/dev-forestry-roads/types'
import { FIXTURE_DATA, FIXTURE_DOCUMENT, FIXTURE_LAYOUT, FIXTURE_LIBRARY } from '../../src/lib/styleExchange/fixtures'
import { ruleFor, type StyledLayer } from '../../src/lib/styleExchange/model'
import { qgisLayerStyles, rendererKind } from '../../src/lib/styleExchange/qgis/qml'
import { qgisLayoutTemplate, qgisProject } from '../../src/lib/styleExchange/qgis/qgisProject'
import { qgisStyleLibraryXml } from '../../src/lib/styleExchange/qgis/qgisStyleLibrary'

const out = path.resolve(process.argv[2] ?? 'style-exchange-qgis')
mkdirSync(path.join(out, 'data'), { recursive: true })
const write = (file: string, content: string | Uint8Array) => writeFileSync(path.join(out, file), content)

function shapeLayer(layer: StyledLayer): ShapeLayer {
  const fields: ShapeField[] = layer.fields.map((field) =>
    field.type === 'number'
      ? { name: field.name, type: 'N', length: 19, decimals: 6 }
      : { name: field.name, type: 'C', length: 80 },
  )
  const features = FIXTURE_DATA[layer.id].features
  const attributes = (f: GeoJSON.Feature) => (f.properties ?? {}) as Record<string, unknown>
  if (layer.geometry === 'point')
    return {
      name: layer.id,
      type: 'point',
      fields,
      features: features.map((f) => ({
        point: (f.geometry as GeoJSON.Point).coordinates as Coordinate,
        attributes: attributes(f),
      })),
    }
  const parts = (f: GeoJSON.Feature) =>
    (f.geometry.type === 'Polygon'
      ? f.geometry.coordinates
      : [(f.geometry as GeoJSON.LineString).coordinates]) as Coordinate[][]
  return {
    name: layer.id,
    type: layer.geometry === 'line' ? 'polyline' : 'polygon',
    fields,
    features: features.map((f) => ({ parts: parts(f), attributes: attributes(f) })),
  }
}

/** The QGIS symbol layer classes our writer gives a symbol, bottom first. */
function symbolLayerClasses(symbol: SheetSymbol): string[] {
  if (symbol.kind === 'line')
    return [...symbol.layers.map(() => 'SimpleLine'), ...(symbol.markers ?? []).map(() => 'MarkerLine')]
  if (symbol.kind === 'point') return ['SvgMarker']
  if (symbol.kind === 'class') return ['SimpleFill']
  return [
    ...(symbol.fill ? ['SimpleFill'] : []),
    ...(symbol.hatches ?? []).map(() => 'LinePatternFill'),
    ...(symbol.markerFill ? ['PointPatternFill'] : []),
    ...symbol.outline.map(() => 'SimpleLine'),
  ]
}

for (const layer of FIXTURE_DOCUMENT.layers) {
  const { files, warnings } = writeShapefileLayer(shapeLayer(layer))
  if (warnings.length) console.warn(layer.id, warnings)
  for (const [name, bytes] of Object.entries(files)) write(`data/${name.replace(/^.*\./, `${layer.id}.`)}`, bytes)
}
for (const file of qgisLayerStyles(FIXTURE_DOCUMENT).files) write(`data/${file.path}`, file.content)
const project = qgisProject(FIXTURE_DOCUMENT, { layouts: [FIXTURE_LAYOUT] })
for (const file of project.files) write(file.path, file.content)
const template = qgisLayoutTemplate(FIXTURE_LAYOUT, FIXTURE_DOCUMENT)
for (const file of template.files) write(file.path, file.content)
const catalogue = catalogueSymbolLibrary()
const library = qgisStyleLibraryXml(catalogue)
write('catalogue-library.xml', library.files[0].content)
write('fixture-library.xml', qgisStyleLibraryXml(FIXTURE_LIBRARY).files[0].content)

const manifest = {
  project: project.files[0].path,
  template: template.files[0].path,
  layoutName: FIXTURE_LAYOUT.name,
  librarySymbols: catalogue.symbols.length,
  layers: FIXTURE_DOCUMENT.layers.map((layer) => ({
    id: layer.id,
    name: layer.name,
    renderer: rendererKind(layer),
    rules: layer.rules.map((rule) => ({ label: rule.label, classes: symbolLayerClasses(rule.symbol) })),
    labelField: layer.label?.field ?? null,
    features: FIXTURE_DATA[layer.id].features.map((f) => ({
      properties: f.properties,
      rule: ruleFor(layer, f.properties ?? {})?.label ?? null,
    })),
  })),
  diagnostics: [...project.diagnostics, ...template.diagnostics, ...library.diagnostics],
}
write('manifest.json', JSON.stringify(manifest, null, 2))
console.log(`Wrote the QGIS fixture export to ${out}`)
