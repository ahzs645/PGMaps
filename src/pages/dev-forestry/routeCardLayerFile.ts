/**
 * Reading a reviewer's own layer for the route card: a zipped shapefile or GeoJSON in the browser, and a File
 * Geodatabase or GeoPackage (zipped, as the BC Fisher Habitat Working Group publishes its regional retention layer)
 * through gdal3.js (`dev-avast/gdal.ts`), reading only the features around the block through the layer's spatial
 * index: a region's 700,000 fisher polygons are never loaded. The file stays in this browser; only the answers the
 * rows take from it are kept (`imported.ts`).
 */
import { growBounds, type PlanarBounds } from '@/lib/forestry/routeCard/geometry'
import { importedFeatures } from '@/lib/forestry/routeCard/imported'
import type { ReadFeature } from '@/lib/forestry/routeCard/query'
import { ROUTE_CARD_ROWS } from '@/lib/forestry/routeCard/rows'

/** How far round the block a layer is read, metres: the widest search a not-public row asks for. */
const READ_MARGIN_METERS = 600

export type LayerFileRead = {
  features: ReadFeature[]
  /** What was read: the file, and the layer inside it when it held several. */
  label: string
  /** The layer's own version, when it carries one (the fisher layer's `Version`, e.g. 210215). */
  version: string | null
  /** Fields the layer stores as real numbers, which the route card tool prints with a decimal ("0.0"). */
  realFields: Set<string>
}

/** The fields the bundled rows name in an imported file (`importField`), to choose a geodatabase's layer by. */
const IMPORT_FIELDS = new Set(
  ROUTE_CARD_ROWS.flatMap((row) =>
    row.source.kind === 'notPublic' && row.source.importField ? [row.source.importField.toLowerCase()] : [],
  ),
)

const versionOf = (features: readonly ReadFeature[]) => {
  const value = features.find((feature) => feature.props.Version !== undefined)?.props.Version
  return value === undefined || value === null ? null : String(value)
}

async function zipHoldsDatabase(file: File): Promise<boolean> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)
  return Object.keys(zip.files).some((name) => /\.gdb\//i.test(name) || /\.gpkg$/i.test(name))
}

async function readWithGdal(file: File, bounds: PlanarBounds): Promise<LayerFileRead> {
  const gdal = await import('@/pages/dev-avast/gdal')
  const all = await gdal.expandZips(gdal.detectDatasets([{ file, path: file.name }], 'route-card'))
  const dataset =
    all.find((entry) => entry.kind === 'gdb') ?? all.find((entry) => /\.gpkg$/i.test(entry.label)) ?? all[0]
  if (!dataset) throw new Error('No geodatabase or GeoPackage found in the file.')
  const layers = (await gdal.listLayers(all, dataset)).filter((layer) => layer.geometryType)
  if (!layers.length) throw new Error(`${dataset.label} holds no layer with shapes.`)
  // The layer the rows name fields of, else the largest.
  const score = (layer: (typeof layers)[number]) =>
    layer.fields.filter((field) => IMPORT_FIELDS.has(field.name.toLowerCase())).length * 1e9 + layer.featureCount
  const layer = [...layers].sort((a, b) => score(b) - score(a))[0]
  const [w, s, e, n] = growBounds(bounds, READ_MARGIN_METERS)
  const collection = await gdal.readLayer(all, dataset, layer.name, { fields: [], boxes: [[w, s, e, n]] })
  // gdal3.js answers in BC Albers already (`readLayer`'s -t_srs EPSG:3005).
  const features = importedFeatures(collection, 'albers')
  return {
    features,
    label: layers.length > 1 ? `${file.name}, layer ${layer.name}` : file.name,
    version: versionOf(features),
    realFields: new Set(layer.fields.filter((field) => /real/i.test(field.type)).map((field) => field.name)),
  }
}

/** A picked layer file, read round the block (`bounds`, BC Albers) where the format allows. */
export async function readRouteCardLayerFile(file: File, bounds: PlanarBounds): Promise<LayerFileRead> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.gpkg') || (name.endsWith('.zip') && (await zipHoldsDatabase(file))))
    return readWithGdal(file, bounds)
  if (name.endsWith('.zip')) {
    const shp = (await import('shpjs')).default
    const features = importedFeatures(await shp(await file.arrayBuffer()))
    return { features, label: file.name, version: versionOf(features), realFields: new Set() }
  }
  if (name.endsWith('.geojson') || name.endsWith('.json')) {
    const features = importedFeatures(JSON.parse(await file.text()))
    return { features, label: file.name, version: versionOf(features), realFields: new Set() }
  }
  throw new Error('Choose a zipped shapefile or File Geodatabase (.zip), a GeoPackage (.gpkg) or a GeoJSON file.')
}
