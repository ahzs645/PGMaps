/**
 * *Scene for GIS* written: the scene's layers (`sceneGis.ts`) as a GeoPackage, a KMZ, shapefiles in a ZIP or one
 * GeoJSON, each drawn in the plan map's own colours (`planMapStyle.ts`, `ROLE_COLORS`), never a copied hex. The
 * GeoPackage carries a QGIS default style per layer (QML written by the style exchange's own writer from the same
 * symbols); the shapefiles carry the same QML beside each `.shp`, which QGIS loads with it; the KMZ one style per
 * layer. Every writer's warning comes back in `notes` for the person, as do the style writer's diagnostics.
 *
 * sql.js is passed in and fflate is pure JavaScript, so this runs in Node for the tests. No DOM or network access.
 */
import { strToU8, zipSync, type Zippable } from 'fflate'
import type { SqlJsStatic } from 'sql.js'

import { writeGeoPackage, type GeoPackageLayerStyle } from '@/lib/gis/geoPackage'
import type { KmlLayerStyle } from '@/lib/gis/kml'
import { writeKmz } from '@/lib/gis/kmz'
import { layerToGeoJson, shapeLayerFromGisLayer, type GisLayer } from '@/lib/gis/layers'
import { writeShapefileLayer } from '@/lib/gis/shapefile'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import type { StyledLayer } from '@/lib/styleExchange/model'
import { qmlForLayer } from '@/lib/styleExchange/qgis/qml'

import { MASK_COLORS, ROAD_COLOR, TREE_FREE_COLOR, VIEW_OF_INTEREST_COLORS } from './planMapStyle'
import { ROLE_COLORS } from './scene'
import { SCENE_GIS_FILES, type SceneGisFormat, type SceneGisLayerName } from './sceneGis'

/** A layer's look, in the plan map's colours. Fill opacities are the plan's own, so a GIS draws the scene as it reads. */
type LayerLook =
  | { geometry: 'polygon'; color: string; fillOpacity: number; width: number; dash?: number[] }
  | { geometry: 'line'; color: string; width: number }
  | { geometry: 'point'; color: string; size: number }

const area = (color: string, fillOpacity: number, width = 1.2, dash?: number[]): LayerLook => ({
  geometry: 'polygon',
  color,
  fillOpacity,
  width,
  ...(dash ? { dash } : {}),
})

/** The look of each layer the scene can give. */
export const SCENE_GIS_LOOKS: Record<SceneGisLayerName, LayerLook> = {
  blocks: area(ROLE_COLORS.block, 0.3, 1.8),
  landforms: area(ROLE_COLORS.landscape, 0.08, 1.6),
  existing_openings: area(ROLE_COLORS.harvested, 0.22, 1),
  masks_natural: area(MASK_COLORS.natural, 0.15),
  masks_private: area(MASK_COLORS.private, 0.15),
  masks_permanent: area(MASK_COLORS.permanent, 0.15),
  masks_retained: area(MASK_COLORS.retained, 0.15),
  tree_free_areas: area(TREE_FREE_COLOR, 0.1, 1.6, [2, 1.5]),
  road: { geometry: 'line', color: ROAD_COLOR, width: 3 },
  viewpoint: { geometry: 'point', color: ROAD_COLOR, size: 9 },
  views_of_interest: { geometry: 'point', color: VIEW_OF_INTEREST_COLORS.view, size: 8 },
  view_wedges: area(VIEW_OF_INTEREST_COLORS.view, 0.08, 1),
}

/** The look as a sheet symbol, the model the style exchange writes QML from. Widths are points. */
export function sceneGisSymbol(name: SceneGisLayerName, title: string): SheetSymbol {
  const look = SCENE_GIS_LOOKS[name]
  if (look.geometry === 'polygon')
    return {
      kind: 'area',
      label: title,
      fill: look.color,
      fillOpacity: look.fillOpacity,
      outline: [{ color: look.color, width: look.width * 0.75, ...(look.dash ? { dash: look.dash } : {}) }],
    }
  if (look.geometry === 'line')
    return { kind: 'line', label: title, layers: [{ color: look.color, width: look.width * 0.75, cap: 'round' }] }
  return {
    kind: 'point',
    label: title,
    icon: 'dot',
    size: look.size,
    color: look.color,
    halo: { color: '#ffffff', width: 1 },
  }
}

/** The look as KML draws it: one style per layer. */
export function sceneGisKmlStyle(name: SceneGisLayerName): KmlLayerStyle {
  const look = SCENE_GIS_LOOKS[name]
  if (look.geometry === 'polygon')
    return { lineColor: look.color, lineWidth: look.width, fillColor: look.color, fillOpacity: look.fillOpacity }
  if (look.geometry === 'line') return { lineColor: look.color, lineWidth: look.width }
  return { iconColor: look.color, iconScale: look.size / 9 }
}

/** Each layer's QGIS default style, and the style writer's diagnostics as plain lines. */
export function sceneGisQml(layers: readonly GisLayer[]): { styles: Record<string, string>; notes: string[] } {
  const styles: Record<string, string> = {}
  const notes: string[] = []
  for (const layer of layers) {
    const name = layer.name as SceneGisLayerName
    const title = layer.title ?? layer.name
    const styled: StyledLayer = {
      id: layer.name,
      name: title,
      geometry: layer.geometry,
      fields: [],
      rules: [{ label: title, filter: null, symbol: sceneGisSymbol(name, title) }],
    }
    const { qml, diagnostics } = qmlForLayer(styled)
    styles[layer.name] = qml
    for (const diagnostic of diagnostics) notes.push(`${title} style: ${diagnostic.message}`)
  }
  return { styles, notes }
}

/** The writer's file: its bytes, name and type, and every warning to show beside it. */
export type SceneGisFile = { bytes: Uint8Array; fileName: string; mime: string; notes: string[] }

/**
 * dBase keeps field names in capitals: a shapefile's `area_ha` is `AREA_HA`. That change alone is said once, in the
 * README, rather than once per field; any other change to a name is kept as the writer worded it.
 */
const caseOnlyRename = /^(\S+) (\S+): written as (\S+); a dBase field name is up to 10 capitals, digits or _\.$/

function shapefileZip(layers: readonly GisLayer[], qml: Record<string, string>, readme: (notes: string[]) => string) {
  const entries: Zippable = {}
  const notes: string[] = []
  for (const layer of layers) {
    const shape = shapeLayerFromGisLayer(layer)
    const { files, warnings } = writeShapefileLayer(shape.layer)
    for (const [path, bytes] of Object.entries(files)) entries[path] = bytes
    if (qml[layer.name]) entries[`${shape.layer.name}.qml`] = strToU8(qml[layer.name])
    for (const warning of [...shape.warnings, ...warnings]) {
      const renamed = caseOnlyRename.exec(warning)
      if (renamed && renamed[3] === renamed[2].toUpperCase()) continue
      notes.push(warning)
    }
  }
  entries['README.txt'] = strToU8(readme(notes))
  return { bytes: zipSync(entries, { level: 6 }), notes }
}

/**
 * Writes the scene's layers in a format. `SQL` is needed for the GeoPackage only. `title` names the KMZ document and
 * the README. Throws the writers' own errors (a coordinate that is not WGS84 longitude and latitude, say).
 */
export function writeSceneGis(
  layers: readonly GisLayer[],
  format: SceneGisFormat,
  options: { title: string; SQL?: SqlJsStatic; now?: Date },
): SceneGisFile {
  const { fileName, mime } = SCENE_GIS_FILES[format]
  const now = options.now ?? new Date()
  if (format === 'geojson') {
    // One collection: every feature names its layer, so a GIS can split it again by `layer`.
    const collection = {
      type: 'FeatureCollection',
      name: options.title,
      features: layers.flatMap((layer) =>
        layerToGeoJson(layer).features.map((feature) => ({
          ...feature,
          properties: { layer: layer.name, layer_title: layer.title ?? layer.name, ...feature.properties },
        })),
      ),
    }
    return { bytes: strToU8(JSON.stringify(collection, null, 1)), fileName, mime, notes: [] }
  }
  if (format === 'kmz') {
    const { bytes, warnings } = writeKmz(layers, {
      name: options.title,
      description: 'The visual quality scene from PGMaps: its shapes only, no run figures.',
      styles: Object.fromEntries(
        layers.map((layer) => [layer.name, sceneGisKmlStyle(layer.name as SceneGisLayerName)]),
      ),
      modified: now,
    })
    return { bytes, fileName, mime, notes: warnings }
  }
  const { styles: qml, notes: styleNotes } = sceneGisQml(layers)
  if (format === 'gpkg') {
    if (!options.SQL) throw new Error('The GeoPackage writer needs SQLite, which did not load.')
    const styles: Record<string, GeoPackageLayerStyle> = Object.fromEntries(
      Object.entries(qml).map(([name, text]) => [name, { qml: text }]),
    )
    const { bytes, warnings } = writeGeoPackage(options.SQL, layers, { styles, lastChange: now })
    return { bytes, fileName, mime, notes: [...warnings, ...styleNotes] }
  }
  const { bytes, notes } = shapefileZip(layers, qml, (warnings) =>
    [
      options.title,
      '',
      'Shapefiles of the visual quality scene from PGMaps, one per layer, in WGS84 longitude and latitude.',
      'Each .qml beside a .shp is its QGIS style, which QGIS loads with it. dBase keeps field names in capitals.',
      'The scene only: no run figures, visibility samples or inventory.',
      '',
      ...layers.map((layer) => `${layer.name}: ${layer.title ?? layer.name}, ${layer.features.length} feature(s)`),
      ...(warnings.length ? ['', 'Not written as given:', ...warnings] : []),
      '',
    ].join('\n'),
  )
  return { bytes, fileName, mime, notes: [...notes, ...styleNotes] }
}
