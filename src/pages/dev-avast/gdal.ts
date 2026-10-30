/**
 * GDAL (gdal3.js, WebAssembly in its own worker) for the formats a planner
 * actually has: File Geodatabase folders, shapefiles, GeoPackages, GeoJSON,
 * KML and zips of any of them — and for writing the result back out as a
 * File Geodatabase ArcGIS Pro can open.
 *
 * gdal3.js mounts its inputs with WORKERFS, which reads the browser's File
 * objects lazily, so a 100 MB .gdb is not copied into memory. Each mount
 * replaces the last, so every input is mounted together and re-mounted when
 * the set changes (or after an export used the mount for its own files).
 */
import type { BBox } from './types'

type GdalModule = typeof import('gdal3.js')
type Gdal = Awaited<ReturnType<GdalModule['default']>>
type GdalDataset = Awaited<ReturnType<Gdal['open']>>['datasets'][number]

let gdalPromise: Promise<Gdal> | null = null

export function loadGdal(): Promise<Gdal> {
  gdalPromise ??= (async () => {
    const [{ default: initGdalJs }, js, data, wasm] = await Promise.all([
      import('gdal3.js'),
      import('gdal3.js/dist/package/gdal3.js?url'),
      import('gdal3.js/dist/package/gdal3WebAssembly.data?url'),
      import('gdal3.js/dist/package/gdal3WebAssembly.wasm?url'),
    ])
    return initGdalJs({ paths: { js: js.default, data: data.default, wasm: wasm.default } })
  })().catch((error) => {
    gdalPromise = null
    throw error
  })
  return gdalPromise
}

export type SourceFile = { file: File; path: string }

export type DetectedDataset = {
  id: string
  label: string
  kind: 'gdb' | 'shapefile' | 'file' | 'zip'
  /** Path relative to the mount root, without the leading `/input/`. */
  relativePath: string
  /** For a zip: the dataset inside it, e.g. `PG_Avast.gdb`. */
  innerPath?: string
  files: SourceFile[]
}

export type LayerField = { name: string; type: string }

export type LayerInfo = {
  name: string
  featureCount: number
  geometryType: string | null
  fields: LayerField[]
  crs: string | null
  epsg: number | null
}

const SHAPEFILE_PARTS = new Set(['shp', 'shx', 'dbf', 'prj', 'cpg', 'qix'])
const SINGLE_FILE = new Set(['geojson', 'json', 'gpkg', 'kml', 'fgb', 'gml', 'sqlite'])

const extension = (path: string) => path.split('.').pop()?.toLowerCase() ?? ''
const basename = (path: string) => path.split('/').pop() ?? path

/**
 * Files from a picker, a folder picker or a drop, with their relative paths.
 * Anything that is not part of a readable dataset is left out — a folder of
 * AVAST deliverables also carries Power BI and Excel files GDAL would try to
 * parse.
 */
export function detectDatasets(files: SourceFile[], idPrefix: string): DetectedDataset[] {
  const datasets: DetectedDataset[] = []
  const gdbFiles = new Map<string, SourceFile[]>()
  const loose: SourceFile[] = []
  for (const entry of files) {
    const parts = entry.path.split('/')
    const gdbIndex = parts.findIndex((part) => part.toLowerCase().endsWith('.gdb'))
    if (gdbIndex >= 0 && gdbIndex < parts.length - 1) {
      const root = parts.slice(0, gdbIndex + 1).join('/')
      gdbFiles.set(root, [...(gdbFiles.get(root) ?? []), entry])
    } else loose.push(entry)
  }
  for (const [root, members] of gdbFiles) {
    datasets.push({
      id: `${idPrefix}-${datasets.length}`,
      label: basename(root),
      kind: 'gdb',
      relativePath: root,
      files: members,
    })
  }
  for (const entry of loose) {
    const ext = extension(entry.path)
    if (ext === 'shp') {
      const stem = entry.path.slice(0, -4)
      const parts = loose.filter(
        (other) =>
          other.path.slice(0, other.path.lastIndexOf('.')) === stem && SHAPEFILE_PARTS.has(extension(other.path)),
      )
      datasets.push({
        id: `${idPrefix}-${datasets.length}`,
        label: basename(entry.path),
        kind: 'shapefile',
        relativePath: entry.path,
        files: parts,
      })
    } else if (SINGLE_FILE.has(ext)) {
      datasets.push({
        id: `${idPrefix}-${datasets.length}`,
        label: basename(entry.path),
        kind: 'file',
        relativePath: entry.path,
        files: [entry],
      })
    } else if (ext === 'zip') {
      datasets.push({
        id: `${idPrefix}-${datasets.length}`,
        label: basename(entry.path),
        kind: 'zip',
        relativePath: entry.path,
        files: [entry],
      })
    }
  }
  return datasets
}

/**
 * Looks inside zips for the datasets they hold — a zipped .gdb folder, or one
 * or more shapefiles — so GDAL can open each through /vsizip/. A zip whose
 * contents cannot be listed is left for GDAL to try as a whole.
 */
export async function expandZips(datasets: DetectedDataset[]): Promise<DetectedDataset[]> {
  const out: DetectedDataset[] = []
  for (const dataset of datasets) {
    if (dataset.kind !== 'zip') {
      out.push(dataset)
      continue
    }
    try {
      const { default: JSZip } = await import('jszip')
      const zip = await JSZip.loadAsync(dataset.files[0].file)
      const names = Object.keys(zip.files)
      const inner = new Set<string>()
      for (const name of names) {
        const parts = name.split('/')
        const gdb = parts.findIndex((part) => part.toLowerCase().endsWith('.gdb'))
        if (gdb >= 0 && gdb < parts.length - 1) inner.add(parts.slice(0, gdb + 1).join('/'))
        else if (/\.(shp|geojson|gpkg|kml|fgb)$/i.test(name) && !name.startsWith('__MACOSX/')) inner.add(name)
      }
      if (!inner.size) {
        out.push(dataset)
        continue
      }
      ;[...inner].forEach((innerPath, index) =>
        out.push({
          ...dataset,
          id: `${dataset.id}z${index}`,
          label: basename(innerPath),
          innerPath,
          kind: innerPath.toLowerCase().endsWith('.gdb') ? 'gdb' : 'zip',
        }),
      )
    } catch {
      out.push(dataset)
    }
  }
  return out
}

/** Picker files, keeping a folder picker's relative paths. */
export function filesFromInput(list: FileList | null): SourceFile[] {
  return [...(list ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name }))
}

/** Files from a drop, walking dropped folders (a .gdb is a folder). */
export async function filesFromDrop(transfer: DataTransfer): Promise<SourceFile[]> {
  const entries = [...transfer.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry)
  if (!entries.length) return filesFromInput(transfer.files)
  const out: SourceFile[] = []
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      out.push({ file, path: `${prefix}${entry.name}` })
      return
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    const children: FileSystemEntry[] = []
    // readEntries returns at most 100 entries per call.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (!batch.length) break
      children.push(...batch)
    }
    for (const child of children) await walk(child, `${prefix}${entry.name}/`)
  }
  for (const entry of entries) await walk(entry, '')
  return out
}

/**
 * One GDAL operation at a time. A mount closes every open dataset, so two
 * inputs being read at once would otherwise pull the files out from under
 * each other.
 */
let queue: Promise<unknown> = Promise.resolve()
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.catch(() => undefined)
  return run
}

/** Borrow the shared GDAL worker exclusively and invalidate its cached mount before replacing inputs. */
export function withBrowserGdal<T>(work: (gdal: Gdal) => Promise<T>): Promise<T> {
  return exclusive(async () => {
    const gdal = await loadGdal()
    await closeAll(gdal)
    mountedKey = ''
    mountedSets = []
    // The caller closes the dataset handles it opens before resolving.
    return work(gdal)
  })
}

let mountedKey = ''
let mountedSets: DetectedDataset[] = []
const openDatasets = new Map<string, GdalDataset>()

async function closeAll(gdal: Gdal) {
  for (const dataset of openDatasets.values()) {
    try {
      await gdal.close(dataset)
    } catch {
      // A dataset whose mount is already gone cannot be closed twice.
    }
  }
  openDatasets.clear()
}

const mountName = (dataset: DetectedDataset, path: string) => `${dataset.id}/${path}`

/** Mounts every dataset in one WORKERFS mount, replacing whatever was mounted. */
async function ensureMounted(gdal: Gdal, datasets: DetectedDataset[]) {
  const key = datasets.map((dataset) => `${dataset.id}:${dataset.files.length}`).join('|')
  if (key === mountedKey && datasets.every((dataset) => mountedSets.includes(dataset))) return
  await closeAll(gdal)
  const files = datasets.flatMap((dataset) =>
    dataset.files.map(
      (entry) => new File([entry.file], mountName(dataset, entry.path), { lastModified: entry.file.lastModified }),
    ),
  )
  // gdal3.js opens the first file of each name group while mounting; the
  // datasets are opened properly by path below, so those handles are dropped.
  const result = await gdal.open(files as unknown as FileList).catch(() => ({ datasets: [] as GdalDataset[] }))
  for (const dataset of result.datasets) await gdal.close(dataset).catch(() => undefined)
  mountedKey = key
  mountedSets = datasets
}

async function datasetHandle(gdal: Gdal, all: DetectedDataset[], dataset: DetectedDataset): Promise<GdalDataset> {
  await ensureMounted(gdal, all)
  const existing = openDatasets.get(dataset.id)
  if (existing) return existing
  const zipped = extension(dataset.relativePath) === 'zip'
  const path = `/input/${mountName(dataset, dataset.relativePath)}${dataset.innerPath ? `/${dataset.innerPath}` : ''}`
  const opened = await gdal.open(path, [], zipped ? ['vsizip'] : [])
  const handle = opened.datasets[0]
  if (!handle)
    throw new Error(
      `GDAL could not open ${dataset.label}${opened.errors.length ? `: ${JSON.stringify(opened.errors[0])}` : ''}`,
    )
  openDatasets.set(dataset.id, handle)
  return handle
}

type OgrInfo = {
  layers: Array<{
    name: string
    featureCount: number
    fields: Array<{ name: string; type: string }>
    geometryFields: Array<{
      type: string
      coordinateSystem?: { wkt?: string; projjson?: { id?: { code?: number }; name?: string } }
    }>
  }>
}

export function listLayers(all: DetectedDataset[], dataset: DetectedDataset): Promise<LayerInfo[]> {
  return exclusive(() => listLayersNow(all, dataset))
}

async function listLayersNow(all: DetectedDataset[], dataset: DetectedDataset): Promise<LayerInfo[]> {
  const gdal = await loadGdal()
  const handle = await datasetHandle(gdal, all, dataset)
  const info = (await gdal.ogrinfo(handle, ['-so', '-al'])) as OgrInfo
  return info.layers.map((layer) => {
    const geometry = layer.geometryFields[0]
    const crs = geometry?.coordinateSystem
    return {
      name: layer.name,
      featureCount: layer.featureCount,
      geometryType: geometry?.type ?? null,
      fields: layer.fields.map((field) => ({ name: field.name, type: field.type })),
      crs: crs?.projjson?.name ?? (crs?.wkt ? 'Custom CRS' : null),
      epsg: crs?.projjson?.id?.code ?? null,
    }
  })
}

let outputCounter = 0

async function readGeoJson(gdal: Gdal, options: string[], handle: GdalDataset): Promise<GeoJSON.FeatureCollection> {
  outputCounter += 1
  const output = await gdal.ogr2ogr(
    handle,
    ['-f', 'GeoJSON', '-lco', 'RFC7946=NO', '-lco', 'COORDINATE_PRECISION=3', ...options],
    `read${outputCounter}`,
  )
  const bytes = await gdal.getFileBytes(output)
  return JSON.parse(new TextDecoder().decode(bytes)) as GeoJSON.FeatureCollection
}

/**
 * A layer as BC Albers GeoJSON with only the named attributes. With `boxes`,
 * only features touching one of them are read, through the layer's spatial
 * index — the AVAST layer for a whole region never has to be loaded.
 */
export function readLayer(
  all: DetectedDataset[],
  dataset: DetectedDataset,
  layer: string,
  options: { fields: string[]; boxes?: BBox[]; assumeEpsg?: number },
): Promise<GeoJSON.FeatureCollection> {
  return exclusive(() => readLayerNow(all, dataset, layer, options))
}

async function readLayerNow(
  all: DetectedDataset[],
  dataset: DetectedDataset,
  layer: string,
  options: { fields: string[]; boxes?: BBox[]; assumeEpsg?: number },
): Promise<GeoJSON.FeatureCollection> {
  const gdal = await loadGdal()
  const handle = await datasetHandle(gdal, all, dataset)
  const base = [
    '-preserve_fid',
    '-dim',
    'XY',
    '-t_srs',
    'EPSG:3005',
    '-nlt',
    'PROMOTE_TO_MULTI',
    ...(options.assumeEpsg ? ['-s_srs', `EPSG:${options.assumeEpsg}`] : []),
    ...(options.fields.length ? ['-select', options.fields.join(',')] : []),
  ]
  if (!options.boxes) return readGeoJson(gdal, [...base, layer], handle)
  const seen = new Set<string | number>()
  const features: GeoJSON.Feature[] = []
  for (const box of options.boxes) {
    const part = await readGeoJson(
      gdal,
      [...base, '-spat', ...box.map(String), '-spat_srs', 'EPSG:3005', layer],
      handle,
    )
    for (const feature of part.features) {
      const id = feature.id ?? JSON.stringify(feature.properties)
      if (seen.has(id)) continue
      seen.add(id)
      features.push(feature)
    }
  }
  return { type: 'FeatureCollection', features }
}

export type OutputLayer = {
  name: string
  /** BC Albers features; geometry null for attribute-only tables. */
  features: GeoJSON.Feature[]
  table?: boolean
  /** Numeric fields written as integers; every other numeric field is a double. */
  integers?: string[]
}

/**
 * GeoJSON carries no schema: GDAL types a column of whole numbers as Integer
 * and an all-null column as String. Columns no feature fills are left out
 * (LiDAR fields on a run without LiDAR), and every double is written with a
 * decimal point so `278` reads as a Real, not an Integer.
 */
export function layerGeoJson(layer: OutputLayer): string {
  const keys = [...new Set(layer.features.flatMap((feature) => Object.keys(feature.properties ?? {})))]
  const filled = keys.filter((key) =>
    layer.features.some((feature) => feature.properties?.[key] !== null && feature.properties?.[key] !== undefined),
  )
  const doubles = new Set(
    filled.filter(
      (key) =>
        !layer.integers?.includes(key) &&
        layer.features.every((feature) => {
          const value = feature.properties?.[key]
          return value === null || value === undefined || typeof value === 'number'
        }),
    ),
  )
  const MARK = '__real__'
  const features = layer.features.map((feature) => ({
    ...feature,
    properties: Object.fromEntries(
      filled.map((key) => {
        const value = feature.properties?.[key] ?? null
        return [
          key,
          doubles.has(key) && typeof value === 'number' && Number.isInteger(value) ? `${MARK}${value}` : value,
        ]
      }),
    ),
  }))
  return JSON.stringify({
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3005' } },
    features,
  }).replace(new RegExp(`"${MARK}(-?\\d+)"`, 'g'), '$1.0')
}

/**
 * Writes the layers into one File Geodatabase and returns it zipped as
 * `<gdbName>.gdb/…`, ready to unzip and add to ArcGIS Pro or QGIS.
 */
export function writeGeodatabase(
  gdbName: string,
  layers: OutputLayer[],
  onProgress?: (message: string) => void,
): Promise<Blob> {
  return exclusive(() => writeGeodatabaseNow(gdbName, layers, onProgress))
}

async function writeGeodatabaseNow(
  gdbName: string,
  layers: OutputLayer[],
  onProgress?: (message: string) => void,
): Promise<Blob> {
  const gdal = await loadGdal()
  await closeAll(gdal)
  // The export borrows the mount; inputs are re-mounted on the next read.
  mountedKey = ''
  const files = layers.map(
    (layer, index) =>
      new File([layerGeoJson(layer)], `out${index}_${layer.name}.geojson`, { type: 'application/geo+json' }),
  )
  const opened = await gdal.open(files as unknown as FileList)
  outputCounter += 1
  const target = `gdb${outputCounter}`
  try {
    for (const [index, layer] of layers.entries()) {
      onProgress?.(`Writing ${layer.name}`)
      const source = opened.datasets.find((dataset) => dataset.path.startsWith(`out${index}_`))
      if (!source) throw new Error(`GDAL could not read the ${layer.name} layer back`)
      await gdal.ogr2ogr(
        source,
        [
          '-f',
          'OpenFileGDB',
          ...(index > 0 ? ['-update'] : []),
          '-nln',
          layer.name,
          '-a_srs',
          'EPSG:3005',
          '-nlt',
          layer.table ? 'NONE' : 'MULTIPOLYGON',
          ...(layer.table ? [] : ['-lco', 'GEOMETRY_NAME=SHAPE']),
        ],
        target,
      )
    }
  } finally {
    for (const dataset of opened.datasets) await gdal.close(dataset).catch(() => undefined)
  }
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const prefix = `/output/${target}.gdb/`
  for (const file of await gdal.getOutputFiles()) {
    if (!file.path.startsWith(prefix)) continue
    zip.file(`${gdbName}.gdb/${file.path.slice(prefix.length)}`, await gdal.getFileBytes(file.path))
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
