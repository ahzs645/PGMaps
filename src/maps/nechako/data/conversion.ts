import { downloadBlob } from '@/lib/download'
import { normalizeGeojson } from './workspace'
import { importFilename, parseImportJson } from './importValues'
import type { FeatureCollection } from 'geojson'

export type GisImportLayer = { name: string; data: FeatureCollection; sourceFile: string; sourceCrs?: string }
export type GisImportResult = {
  layers: GisImportLayer[]
  warnings: string[]
  original?: unknown
  archiveEntries?: string[]
}
export type GisExportFormat =
  | 'gpkg'
  | 'shp'
  | 'shapefile'
  | 'kml'
  | 'kmz'
  | 'gpx'
  | 'geojson'
  | 'sqlite'
  | 'spatialite'
  | 'gml'
export type GisExportResult = { name: string; blob: Blob; warnings: string[] }
const MAX_INPUT = 50 * 1024 * 1024
const MAX_EXPANDED = 100 * 1024 * 1024
const VECTOR_FILE = /\.(shp|geojson|json|gpkg|gml|kml|gpx|sqlite|db|fgb)$/i
const SIDECAR = /\.(shx|dbf|prj|cpg|qix|xsd)$/i

/** Browser files only. No app endpoint and no upload fallback. */
export async function convertFiles(files: File[], sourceCrs?: string): Promise<GisImportResult> {
  if (!files.length) throw new Error('Choose one or more GIS files.')
  if (files.reduce((total, file) => total + file.size, 0) > MAX_INPUT)
    throw new Error('Import at most 50 MiB of source files.')
  if (files.some((file) => /\.gpap$/i.test(file.name)))
    throw new Error('Use the Geopaparazzi / SMASH importer to preserve notes, forms, media and track relationships.')
  if (files.every((file) => /\.(geojson|json)$/i.test(file.name))) {
    const originals = await Promise.all(files.map(async (file) => parseImportJson(await file.text())))
    return {
      layers: originals.map((original, index) => ({
        name: files[index].name,
        sourceFile: files[index].name,
        data: normalizeGeojson(original, sourceCrs),
        sourceCrs,
      })),
      warnings: ['Integer JSON values outside JavaScript’s exact range are retained as decimal strings.'],
      original: originals.length === 1 ? originals[0] : originals,
    }
  }
  const expanded: { file: File; path: string; original: string }[] = []
  const archiveEntries: string[] = []
  let expandedBytes = 0
  for (const [index, file] of files.entries()) {
    if (/\.(zip|kmz)$/i.test(file.name)) {
      const { readBoundedLocalZip } = await import('./localWorkbenchBundle')
      const archiveBytes = new Uint8Array(await file.arrayBuffer())
      const entries = await readBoundedLocalZip(archiveBytes, {
        maxEntries: 5000,
        maxCompressedBytes: MAX_INPUT,
        maxFileBytes: MAX_EXPANDED,
        maxTotalBytes: MAX_EXPANDED - expandedBytes,
      })
      for (const [entryName, bytes] of entries) {
        expandedBytes += bytes.byteLength
        if (expandedBytes > MAX_EXPANDED) throw new Error('Expanded GIS input exceeds 100 MiB.')
        archiveEntries.push(`${file.name}/${entryName}`)
        if (
          entryName.startsWith('__MACOSX/') ||
          (!VECTOR_FILE.test(entryName) && !SIDECAR.test(entryName) && !/\.gdb\//i.test(entryName))
        )
          continue
        const path = `archive${index}/${entryName}`
        expanded.push({ file: new File([new Uint8Array(bytes)], path), path, original: file.name })
      }
    } else {
      const path = file.webkitRelativePath || file.name
      expandedBytes += file.size
      if (expandedBytes > MAX_EXPANDED) throw new Error('Expanded GIS input exceeds 100 MiB.')
      expanded.push({ file: new File([file], path, { lastModified: file.lastModified }), path, original: file.name })
    }
  }
  if (!expanded.length) throw new Error('No supported vector datasets were found in the selected files.')
  if (new Set(expanded.map((entry) => entry.path.toLowerCase())).size !== expanded.length)
    throw new Error('Two source files have the same path. Import those datasets separately.')
  for (const entry of expanded) {
    if (!/\.(gml|kml|gpx|xsd)$/i.test(entry.path)) continue
    // Null stripping also finds ASCII declarations in UTF-16/32 XML before native parsing.
    const xml = (await entry.file.text()).split(String.fromCharCode(0)).join('')
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))
      throw new Error('XML files containing DOCTYPE or entity declarations are not accepted.')
  }
  const candidates = new Map<string, string>()
  for (const entry of expanded) {
    const gdb = entry.path.match(/^(.*?\.gdb)\//i)
    if (gdb) candidates.set(gdb[1], entry.original)
    else if (VECTOR_FILE.test(entry.path)) candidates.set(entry.path, entry.original)
  }
  if (!candidates.size) throw new Error('No readable vector file was found; include the .shp with its sidecars.')
  const { withBrowserGdal } = await import('@/pages/dev-avast/gdal')
  return withBrowserGdal(async (gdal) => {
    const mounted = await gdal
      .open(expanded.map((entry) => entry.file) as unknown as FileList)
      .catch(() => ({ datasets: [] }))
    for (const dataset of mounted.datasets) await gdal.close(dataset).catch(() => undefined)
    const layers: GisImportLayer[] = []
    const warnings: string[] = []
    for (const [path, original] of candidates) {
      const opened = await gdal.open(`/input/${path}`)
      try {
        if (!opened.datasets.length) throw new Error(`GDAL could not open ${path}.`)
        for (const dataset of opened.datasets) {
          const info = (await gdal.ogrinfo(dataset, ['-so', '-al'])) as {
            layers?: {
              name: string
              featureCount?: number
              geometryFields?: { coordinateSystem?: { wkt?: string } }[]
            }[]
          }
          if (!info.layers?.length) throw new Error(`${path} contains no vector layers.`)
          for (const layer of info.layers) {
            if (layer.featureCount !== undefined && layer.featureCount > 100000)
              throw new Error(`${layer.name} exceeds the 100,000-feature browser import limit.`)
            if (
              !sourceCrs &&
              !layer.geometryFields?.[0]?.coordinateSystem?.wkt &&
              !/\.(kml|gpx|geojson|json)$/i.test(path)
            )
              throw new Error(`${layer.name} has no declared CRS. Choose its known source CRS and retry.`)
            const output = await gdal.ogr2ogr(
              dataset,
              [
                '-f',
                'GeoJSON',
                '-t_srs',
                'EPSG:4326',
                '-preserve_fid',
                '-mapFieldType',
                'Integer64=String',
                '-lco',
                'RFC7946=YES',
                '-lco',
                'COORDINATE_PRECISION=15',
                ...(sourceCrs ? ['-s_srs', sourceCrs] : []),
                layer.name,
              ],
              `nechako_import_${crypto.randomUUID().replace(/-/g, '')}`,
            )
            const raw = parseImportJson(new TextDecoder().decode(await gdal.getFileBytes(output)))
            layers.push({
              name: layer.name,
              sourceFile: original,
              sourceCrs: sourceCrs || layer.geometryFields?.[0]?.coordinateSystem?.wkt,
              data: normalizeGeojson(raw),
            })
          }
        }
      } finally {
        for (const dataset of opened.datasets) await gdal.close(dataset).catch(() => undefined)
      }
    }
    warnings.push(
      'Converted in this browser with GDAL. Geometry is WGS84; 64-bit integer attributes are decimal strings. Original files remain unchanged.',
    )
    return { layers, warnings, archiveEntries }
  })
}

/** Keep arbitrary source IDs in ordinary fields as well as the format's own feature ID. */
export function gisExportInput(data: FeatureCollection): { data: FeatureCollection; warnings: string[] } {
  if (!data.features.some((feature) => feature.id !== undefined)) return { data, warnings: [] }
  const keys = new Set(
    data.features.flatMap((feature) => Object.keys(feature.properties ?? {}).map((key) => key.toLowerCase())),
  )
  const unique = (base: string) => {
    let candidate = base,
      suffix = 1
    while (keys.has(candidate)) candidate = `${base}${suffix++}`
    keys.add(candidate)
    return candidate
  }
  const idField = unique('pgm_id'),
    typeField = unique('pgm_idtyp')
  return {
    data: {
      ...data,
      features: data.features.map((feature) =>
        feature.id === undefined
          ? feature
          : {
              ...feature,
              properties: { ...feature.properties, [idField]: String(feature.id), [typeField]: typeof feature.id },
            },
      ),
    },
    warnings: [
      `Source feature IDs and their types are retained in ${idField} and ${typeField}; the destination format may assign its own feature IDs.`,
    ],
  }
}

/** Returns actual GIS bytes for downloads and portable local project packages. */
export async function createGisExport(
  data: FeatureCollection,
  requestedFormat: GisExportFormat,
  name = 'nechako-layer',
): Promise<GisExportResult> {
  const checked = normalizeGeojson(data)
  const format = requestedFormat === 'shapefile' ? 'shp' : requestedFormat
  const stem =
    importFilename(name)
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w-]/g, '_')
      .slice(0, 100) || 'nechako-layer'
  if (format === 'geojson')
    return {
      name: `${stem}.geojson`,
      blob: new Blob([JSON.stringify(checked)], { type: 'application/geo+json' }),
      warnings: [],
    }
  const drivers = {
    gpkg: 'GPKG',
    shp: 'ESRI Shapefile',
    kml: 'KML',
    kmz: 'KML',
    gpx: 'GPX',
    sqlite: 'SQLite',
    spatialite: 'SQLite',
    gml: 'GML',
  }
  if (!(format in drivers)) throw new Error('Choose a supported GIS export format.')
  if (
    format === 'gpx' &&
    checked.features.some(
      (feature) => !feature.geometry || !['Point', 'LineString', 'MultiLineString'].includes(feature.geometry.type),
    )
  )
    throw new Error(
      'GPX supports points and lines. Export polygon or mixed unsupported geometry as GeoPackage or GeoJSON.',
    )
  const preserved = gisExportInput(checked)
  const { withBrowserGdal } = await import('@/pages/dev-avast/gdal')
  return withBrowserGdal(async (gdal) => {
    const input = new File([JSON.stringify(preserved.data)], 'input.geojson', { type: 'application/geo+json' })
    const opened = await gdal.open(input)
    try {
      const dataset = opened.datasets[0]
      if (!dataset) throw new Error('GDAL could not read the export features.')
      const unique = `nechako_export_${crypto.randomUUID().replace(/-/g, '')}`
      const output = await gdal.ogr2ogr(
        dataset,
        [
          '-f',
          drivers[format],
          '-nln',
          stem,
          '-s_srs',
          'EPSG:4326',
          '-t_srs',
          'EPSG:4326',
          ...(['gpkg', 'sqlite', 'spatialite'].includes(format) ? ['-preserve_fid'] : []),
          ...(format === 'gpx' ? ['-dsco', 'GPX_USE_EXTENSIONS=YES'] : []),
          ...(format === 'shp' ? ['-lco', 'ENCODING=UTF-8'] : []),
          ...(format === 'spatialite' ? ['-dsco', 'SPATIALITE=YES'] : []),
        ],
        unique,
      )
      if (format === 'shp' || format === 'gml') {
        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()
        const outputFiles = (await gdal.getOutputFiles()).filter(
          (file) => file.path.startsWith(`/output/${unique}.`) || file.path.startsWith(`/output/${unique}/`),
        )
        if (!outputFiles.some((file) => file.path.toLowerCase().endsWith(`.${format}`)))
          throw new Error(`The ${format.toUpperCase()} export did not produce its geometry file.`)
        for (const file of outputFiles) {
          const bytes = await gdal.getFileBytes(file.path)
          const filename = file.path.split('/').pop()!.replace(unique, stem)
          // GML references its XSD by the generated basename; rename both together.
          zip.file(filename, format === 'gml' ? new TextDecoder().decode(bytes).split(unique).join(stem) : bytes)
        }
        zip.file('original.geojson', JSON.stringify(checked))
        zip.file(
          'README.txt',
          `${format.toUpperCase()} can encode field names and types differently from GeoJSON. original.geojson preserves the full input properties and IDs. Coordinates are WGS84.\n`,
        )
        return {
          name: `${stem}${format === 'gml' ? '.gml' : ''}.zip`,
          blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }),
          warnings: [
            ...preserved.warnings,
            `${format.toUpperCase()} limits may change field names or types; the ZIP also contains original.geojson.`,
          ],
        }
      }
      const bytes = await gdal.getFileBytes(output)
      if (format === 'kmz') {
        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()
        zip.file('doc.kml', bytes)
        return {
          name: `${stem}.kmz`,
          blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }),
          warnings: [
            ...preserved.warnings,
            'KML supports fewer attribute types than GeoJSON. Keep the original GeoJSON with this export.',
          ],
        }
      }
      const extension = format === 'spatialite' ? 'sqlite' : format
      return {
        name: `${stem}.${extension}`,
        blob: new Blob([new Uint8Array(bytes)], {
          type:
            format === 'gpkg'
              ? 'application/geopackage+sqlite3'
              : ['sqlite', 'spatialite'].includes(format)
                ? 'application/vnd.sqlite3'
                : 'application/xml',
        }),
        warnings: [
          ...preserved.warnings,
          ...(['kml', 'gpx'].includes(format)
            ? ['KML/GPX support fewer attribute types than GeoJSON. Keep the original GeoJSON with this export.']
            : []),
        ],
      }
    } finally {
      for (const dataset of opened.datasets) await gdal.close(dataset).catch(() => undefined)
    }
  })
}

export async function exportGis(data: FeatureCollection, format: string) {
  const result = await createGisExport(data, format as GisExportFormat)
  downloadBlob(result.blob, result.name)
  return result
}
