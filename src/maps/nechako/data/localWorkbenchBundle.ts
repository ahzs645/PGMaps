import type { FeatureCollection } from 'geojson'
import {
  checkedLocalWorkbenchRecord,
  localWorkbenchJson,
  type LocalWorkbenchRecord,
  type LocalWorkbenchSource,
} from './localWorkbench'
import { importWorkspace, normalizeGeojson, type VectorData, type Workspace } from './workspace'
import type { GisExportFormat } from './conversion'
import type { SmashProjectSummary, SmashExportLayer } from './smashProjectExport'
import type { VectorStyle } from './vectorRules'

export const LOCAL_BUNDLE_SCHEMA = 'nechako-local-bundle-v1'
export const LOCAL_BUNDLE_LIMITS = {
  compressed: 128 * 1024 * 1024,
  unpacked: 256 * 1024 * 1024,
  file: 128 * 1024 * 1024,
  files: 10000,
  records: 4000,
  manifest: 2 * 1024 * 1024,
}
type BundleFile = {
  path: string
  role: 'record' | 'original' | 'workspace' | 'layer' | 'style' | 'notes' | 'gis' | 'smash-project'
  bytes: number
  sha256: string
  mime: string
}
type BundleRecord = {
  id: string
  kind: string
  name: string
  path: string
  blobPath?: string
  source?: LocalWorkbenchSource
}
export type LocalBundleRemote = {
  name: string
  type: 'wms' | 'tiles' | 'descriptor'
  url?: string
  recordId?: string
  pixelsCached: false
}
export type LocalBundleManifest = {
  schema: typeof LOCAL_BUNDLE_SCHEMA
  name: string
  exportedAt: string
  generator: 'PGMaps Nechako browser workbench'
  records: BundleRecord[]
  files: BundleFile[]
  workspacePath?: string
  remoteResources: LocalBundleRemote[]
  relationships: { fromId: string; toId: string; kind: string; role?: string; included: boolean }[]
  gisExports?: { path: string; format: GisExportFormat; layerId: string; featureCount: number; warnings: string[] }[]
  smash?: SmashProjectSummary & { path: string }
  completeness: {
    recordCount: number
    originalFileCount: number
    materializedLayerCount: number
    partialLayerCount: number
    descriptorLayerCount: number
    privateRecordCount: number
    warnings: string[]
  }
}
export type LocalBundlePreview = {
  manifest: LocalBundleManifest
  records: LocalWorkbenchRecord[]
  workspace?: Workspace
}
const encoder = new TextEncoder()
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
function safeName(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^\.+/, '')
      .slice(0, 90) || 'item'
  )
}
function safeFileName(value: string): string {
  const parts = /^(.*)(\.[a-z0-9]{1,12})$/i.exec(value)
  return parts ? `${safeName(parts[1])}${parts[2].toLowerCase()}` : safeName(value)
}
function checkedPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 240 ||
    !/^[a-z0-9][a-z0-9._/-]*$/i.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('The archive contains an unsafe or unsupported path.')
  return value
}
export async function localBundleSha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error('Checksum verification requires HTTPS or localhost in a supported browser.')
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
function layerData(record: LocalWorkbenchRecord): FeatureCollection | undefined {
  if (record.kind !== 'layer') return undefined
  const data = object(record.data)
  if (!data) return undefined
  if (data.type === 'FeatureCollection') return normalizeGeojson(data)
  const candidate = object(data.data)
  if (candidate?.type === 'FeatureCollection') return normalizeGeojson(candidate)
  return undefined
}
function projectWorkspace(record: LocalWorkbenchRecord): Workspace | undefined {
  if (record.kind !== 'project') return undefined
  const data = object(record.data)
  if (data?.schema === 'nechako-workspace-v1') return importWorkspace(data)
  if (object(data?.workspace)?.schema === 'nechako-workspace-v1') return importWorkspace(data!.workspace)
  return undefined
}
function collectRemote(workspace: Workspace, target: LocalBundleRemote[], recordId?: string) {
  for (const layer of workspace.layers)
    target.push({
      name: layer.displayName ?? layer.layer.title,
      type: 'wms',
      url: layer.source.resource,
      recordId,
      pixelsCached: false,
    })
  for (const tile of workspace.tiles)
    for (const url of tile.urls) target.push({ name: tile.name, type: 'tiles', url, recordId, pixelsCached: false })
}

/** A portable PGMaps backup, with optional real GIS files and a native SMASH point-note database. */
export async function createLocalWorkbenchBundle(input: {
  name?: string
  workspace?: Workspace
  records: LocalWorkbenchRecord[]
  /** Optional actual GIS files, converted in the browser. Plain backups already contain GeoJSON. */
  gisFormat?: GisExportFormat
  gisScope?: 'workspace' | 'all'
  /** Includes a native GPAP point-note project and compatible maps/forms folders. */
  smash?: boolean
  onProgress?: (message: string) => void
}): Promise<{ blob: Blob; manifest: LocalBundleManifest }> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const records = input.records.map(checkedLocalWorkbenchRecord)
  if (records.length > LOCAL_BUNDLE_LIMITS.records)
    throw new Error(`A bundle supports up to ${LOCAL_BUNDLE_LIMITS.records} local items.`)
  if (new Set(records.map((record) => record.id)).size !== records.length)
    throw new Error('Local item IDs must be unique.')
  const manifest: LocalBundleManifest = {
    schema: LOCAL_BUNDLE_SCHEMA,
    name: input.name?.trim() || 'Nechako local workbench',
    exportedAt: new Date().toISOString(),
    generator: 'PGMaps Nechako browser workbench',
    records: [],
    files: [],
    remoteResources: [],
    relationships: [],
    completeness: {
      recordCount: records.length,
      originalFileCount: 0,
      materializedLayerCount: 0,
      partialLayerCount: 0,
      descriptorLayerCount: 0,
      privateRecordCount: records.filter((record) => record.source?.access === 'private').length,
      warnings: [],
    },
  }
  let totalBytes = 0
  const smashLayers: SmashExportLayer[] = []
  const add = async (path: string, content: string | Uint8Array, role: BundleFile['role'], mime: string) => {
    checkedPath(path)
    const bytes = typeof content === 'string' ? encoder.encode(content) : content
    totalBytes += bytes.byteLength
    if (
      bytes.byteLength > LOCAL_BUNDLE_LIMITS.file ||
      totalBytes > LOCAL_BUNDLE_LIMITS.unpacked ||
      manifest.files.length >= LOCAL_BUNDLE_LIMITS.files - 1
    )
      throw new Error(
        'The bundle exceeds the browser limit of 128 MiB per file or 256 MiB unpacked. Export original files separately or select fewer items.',
      )
    manifest.files.push({ path, role, bytes: bytes.byteLength, sha256: await localBundleSha256(bytes), mime })
    zip.file(path, bytes)
  }
  const addGis = async (vector: VectorData, prefix: string) => {
    if (!input.gisFormat && !input.smash) return
    const format = input.gisFormat === 'shapefile' ? 'shp' : (input.gisFormat ?? 'gpkg')
    if (input.smash && !['gpkg', 'shp', 'geojson', 'gpx'].includes(format))
      throw new Error(
        'Choose GeoPackage, GeoJSON, Shapefile or GPX for a SMASH package. Other formats remain available as general GIS exports.',
      )
    input.onProgress?.(`Converting ${vector.name} to ${format.toUpperCase()}…`)
    const { createGisExport } = await import('./conversion')
    const result = await createGisExport(vector.data, format, `${prefix}-${safeName(vector.name)}`)
    const directory = input.smash ? 'smash/maps' : 'gis'
    let path = `${directory}/${safeFileName(result.name)}`
    if (input.smash && format === 'shp') {
      const bytes = new Uint8Array(await result.blob.arrayBuffer())
      inspectLocalZip(bytes)
      const archive = await JSZip.loadAsync(bytes, { checkCRC32: true })
      const entries = Object.values(archive.files).filter(
        (entry) => !entry.dir && /\.(?:shp|shx|dbf|prj|cpg|qix)$/i.test(entry.name),
      )
      const shape = entries.find((entry) => /\.shp$/i.test(entry.name))
      if (!shape) throw new Error('The generated Shapefile archive has no geometry file.')
      for (const entry of entries)
        await add(
          `${directory}/${prefix}/${safeFileName(entry.name)}`,
          await entry.async('uint8array'),
          'gis',
          'application/octet-stream',
        )
      path = `${directory}/${prefix}/${safeFileName(shape.name)}`
    } else
      await add(
        path,
        new Uint8Array(await result.blob.arrayBuffer()),
        'gis',
        result.blob.type || 'application/octet-stream',
      )
    const warnings = [...result.warnings]
    const { checkedVectorStyle, vectorGeometryTypes, vectorStyleFor } = await import('./vectorRules')
    const { exportStyleSld } = await import('./sldStyle')
    const geometries = vectorGeometryTypes(vector.data)
    let style: VectorStyle | undefined
    try {
      style = checkedVectorStyle(vectorStyleFor(vector))
    } catch (reason) {
      warnings.push(
        `SLD sidecars were omitted: ${reason instanceof Error ? reason.message : String(reason)} The original style metadata remains in the backup.`,
      )
    }
    const styledGeometries = geometries.filter((geometry) => style?.geometry === 'any' || style?.geometry === geometry)
    const unstyledGeometries = geometries.filter((geometry) => !styledGeometries.includes(geometry))
    if (style && unstyledGeometries.length)
      warnings.push(
        `The explicit ${style.geometry} style does not apply to ${unstyledGeometries.join(', ')} geometry. Those features remain in the GIS data without a generated SLD symbolizer.`,
      )
    let sidecarCount = 0
    for (const geometry of styledGeometries) {
      const sidecar = path.replace(/\.[^/.]+$/, `${geometries.length > 1 ? `-${geometry}` : ''}.sld`)
      let xml: string
      try {
        xml = exportStyleSld(style!, vector.name, geometry)
      } catch (reason) {
        warnings.push(
          `The ${geometry} SLD sidecar was omitted: ${reason instanceof Error ? reason.message : String(reason)} Typed and original style metadata remain in the backup; the GIS features were retained.`,
        )
        continue
      }
      await add(sidecar, xml, 'style', 'application/vnd.ogc.sld+xml')
      sidecarCount++
    }
    if (sidecarCount > 1)
      warnings.push(
        'Mixed geometries have separate, labelled SLD files. Choose the appropriate symbolizer in the receiving application.',
      )
    if (sidecarCount && style?.mode === 'gradient' && input.smash)
      warnings.push(
        'The gradient SLD uses SE Interpolate. SMASH documentation confirms single and unique-value styles; gradient rendering in SMASH has not been verified.',
      )
    if (sidecarCount && format === 'shp')
      warnings.push(
        'SLD filters keep original field names; review any field-name shortening reported by the Shapefile driver before applying them.',
      )
    if (sidecarCount && input.smash && format === 'gpkg')
      warnings.push(
        'The SLD is supplied beside the GeoPackage. SMASH also stores edited styles in its own style table; automatic sidecar adoption has not been verified.',
      )
    manifest.gisExports ??= []
    manifest.gisExports.push({ path, format, layerId: vector.id, featureCount: vector.data.features.length, warnings })
    manifest.completeness.warnings.push(...warnings.map((warning) => `${vector.name}: ${warning}`))
    if (input.smash) smashLayers.push({ id: vector.id, name: vector.name, data: vector.data, color: vector.color })
  }
  const addWorkspace = async (workspace: Workspace, path: string, prefix: string, recordId?: string) => {
    const checked = importWorkspace(workspace)
    await add(path, JSON.stringify(checked, null, 2), 'workspace', 'application/json')
    collectRemote(checked, manifest.remoteResources, recordId)
    for (let index = 0; index < checked.vectors.length; index++) {
      const vector = checked.vectors[index]
      await add(
        `layers/${prefix}-${index + 1}-${safeName(vector.name)}.geojson`,
        JSON.stringify(vector.data),
        'layer',
        'application/geo+json',
      )
      await add(
        `styles/${prefix}-${index + 1}.json`,
        JSON.stringify(
          {
            layerId: vector.id,
            name: vector.name,
            color: vector.color,
            fillOpacity: vector.fillOpacity,
            lineOpacity: vector.lineOpacity,
            lineWidth: vector.lineWidth,
            pointRadius: vector.pointRadius,
            categories: vector.categories,
            style: (vector as unknown as Record<string, unknown>).style,
          },
          null,
          2,
        ),
        'style',
        'application/json',
      )
      manifest.completeness.materializedLayerCount++
      if (!recordId || input.gisScope === 'all') await addGis(vector, `${prefix}-${index + 1}`)
    }
    manifest.completeness.warnings.push(
      ...checked.warnings.map((warning) => `${recordId ?? 'Current workspace'}: ${warning}`),
    )
  }
  if (input.workspace) {
    manifest.workspacePath = 'workspace.json'
    await addWorkspace(input.workspace, manifest.workspacePath, 'workspace')
  }
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    input.onProgress?.(`Packing ${index + 1} of ${records.length}: ${record.name}`)
    const number = String(index + 1).padStart(5, '0')
    const path = `records/${number}.json`
    const { blob, ...metadata } = record
    const entry: BundleRecord = { id: record.id, kind: record.kind, name: record.name, path, source: record.source }
    await add(path, JSON.stringify(metadata, null, 2), 'record', 'application/json')
    if (blob) {
      entry.blobPath = `originals/${number}-${safeFileName(record.filename ?? `${record.name}.bin`)}`
      await add(
        entry.blobPath,
        new Uint8Array(await blob.arrayBuffer()),
        'original',
        record.mime ?? (blob.type || 'application/octet-stream'),
      )
      manifest.completeness.originalFileCount++
    } else if (record.kind === 'attachment' || record.kind === 'geopaparazzi') {
      manifest.completeness.warnings.push(`${record.name}: metadata is saved but no original file is available.`)
    }
    manifest.records.push(entry)
    const data = object(record.data)
    const workspace = projectWorkspace(record)
    if (workspace) await addWorkspace(workspace, `projects/${number}.json`, `project-${number}`, record.id)
    const geojson = layerData(record)
    if (geojson) {
      await add(
        `layers/${number}-${safeName(record.name)}.geojson`,
        JSON.stringify(geojson),
        'layer',
        'application/geo+json',
      )
      manifest.completeness.materializedLayerCount++
      if (input.gisScope === 'all') {
        const directVector =
          typeof data?.id === 'string' &&
          typeof data.name === 'string' &&
          typeof data.color === 'string' &&
          object(data.data)?.type === 'FeatureCollection'
        const presentation = directVector ? data : object(data?.original)
        const paint = Object.fromEntries(
          ['fillOpacity', 'lineOpacity', 'lineWidth', 'pointRadius', 'categories', 'style']
            .filter((key) => presentation?.[key] !== undefined)
            .map((key) => [key, presentation![key]]),
        ) as Partial<
          Pick<VectorData, 'fillOpacity' | 'lineOpacity' | 'lineWidth' | 'pointRadius' | 'categories' | 'style'>
        >
        await addGis(
          {
            id: record.id,
            name: record.name,
            data: geojson,
            color:
              typeof presentation?.color === 'string' && /^#[a-f0-9]{6}$/i.test(presentation.color)
                ? presentation.color
                : '#0f766e',
            visible: true,
            ...paint,
          },
          `saved-${number}`,
        )
      }
      if (object(data?.materialization)?.status === 'partial') {
        manifest.completeness.partialLayerCount++
        manifest.completeness.warnings.push(`${record.name}: only the explicitly saved subset of features is included.`)
      }
    } else if (record.kind === 'layer') {
      manifest.completeness.descriptorLayerCount++
      manifest.remoteResources.push({
        name: record.name,
        type: 'descriptor',
        url: record.source?.url,
        recordId: record.id,
        pixelsCached: false,
      })
      manifest.completeness.warnings.push(
        `${record.name}: layer descriptor only; no geographic features or imagery are included.`,
      )
    }
    if (record.kind === 'style') {
      await add(
        `styles/${number}-${safeName(record.name)}.json`,
        JSON.stringify(record.data, null, 2),
        'style',
        'application/json',
      )
      if (typeof data?.originalSld === 'string')
        await add(
          `styles/${number}-${safeName(record.name)}.sld`,
          data.originalSld,
          'style',
          'application/vnd.ogc.sld+xml',
        )
      if (!data?.style || (Array.isArray(data.diagnostics) && data.diagnostics.length))
        manifest.completeness.warnings.push(
          `${record.name}: style diagnostics or unsupported source rules are preserved in its JSON.`,
        )
    }
    if (Array.isArray(data?.relationships)) {
      for (const relationship of data.relationships) {
        const link = object(relationship)
        if (typeof link?.id === 'string' && typeof link.kind === 'string') {
          const included = records.some((candidate) => candidate.id === link.id && candidate.kind === link.kind)
          manifest.relationships.push({
            fromId: record.id,
            toId: link.id,
            kind: link.kind,
            ...(typeof link.role === 'string' ? { role: link.role } : {}),
            included,
          })
          if (!included)
            manifest.completeness.warnings.push(
              `${record.name}: related ${link.kind} ${link.id} is not included in this backup.`,
            )
        }
      }
    }
  }
  if (manifest.remoteResources.length)
    manifest.completeness.warnings.unshift(
      'Remote WMS, tile and descriptor resources still require their original service and any source authorization. No remote map pixels are cached in this archive.',
    )
  if (input.smash) {
    input.onProgress?.('Writing the native SMASH point-note database…')
    const { createSmashProject } = await import('./smashProjectExport')
    const result = await createSmashProject({
      name: manifest.name,
      layers: smashLayers,
      exportedAt: manifest.exportedAt,
      camera: input.workspace?.camera,
    })
    const path = `smash/projects/${safeName(manifest.name)}.gpap`
    await add(path, result.bytes, 'smash-project', 'application/x-sqlite3')
    await add('smash/project-provenance.json', JSON.stringify(result.summary, null, 2), 'notes', 'application/json')
    await add(
      'smash/forms/pgmaps-point-notes.json',
      JSON.stringify(result.formDefinitions, null, 2),
      'notes',
      'application/json',
    )
    manifest.smash = { ...result.summary, path }
    manifest.completeness.warnings.push(...result.summary.warnings)
    await add(
      'smash/OPEN-IN-SMASH.txt',
      [
        '1. Extract this ZIP on your computer or device.',
        '2. Copy the contents of smash/projects, smash/maps and smash/forms into the matching folders of your SMASH application storage, using its file picker where required.',
        `3. Open projects/${safeName(manifest.name)}.gpap from the SMASH Projects view. It contains ${result.summary.noteCount} new point notes and the exported map-view bookmark.`,
        '4. Add the files under maps/ through the SMASH layer list. Layer visibility/order and automatic SLD adoption must be reviewed in the app; this package does not change device application settings.',
        'The forms folder contains the editable provenance fields used in the generated point notes. Original source properties are preserved in the JSON field and GIS layers.',
        'Native source GPAP originals remain under originals/ at the backup root, unchanged. They keep their original media, forms and GPS tracks.',
        'Remote WMS and tile URLs in the workbench manifest are references only. No imagery was downloaded and no authentication was included.',
        '',
        ...result.summary.warnings,
      ].join('\n'),
      'notes',
      'text/plain',
    )
  }
  manifest.completeness.warnings.push(
    'GeoJSON files contain the features available when explicitly saved. A map extent or source catalogue is not proof of a complete portal dataset.',
  )
  manifest.completeness.warnings.push(
    input.smash
      ? 'The native .gpap file is inside smash/projects/. The outer ZIP is a portable delivery archive and must be extracted before use in SMASH.'
      : 'This ZIP is a PGMaps portable workbench backup, not a newly authored native SMASH project. Original .gpap files are preserved unchanged when present.',
  )
  manifest.completeness.warnings = [...new Set(manifest.completeness.warnings)]
  await add(
    'README.txt',
    [
      manifest.name,
      'PGMaps Nechako portable local workbench',
      '',
      'Restore this ZIP with Local workbench > Review backup. Every listed file is verified with SHA-256 before any records are saved.',
      'Open the layers/*.geojson files in GIS software. Coordinates are longitude/latitude (EPSG:4326). Original files, local record IDs, source provenance and relationship metadata are retained.',
      input.smash
        ? 'See smash/OPEN-IN-SMASH.txt for the native point-note project and compatible GIS assets.'
        : 'Original .gpap files in originals/ can be opened with their original application. This ZIP itself is not a native SMASH project.',
      'The manifest describes copied bytes and remote dependencies, not source permissions or future availability. Private source content remains private even inside a portable backup.',
      '',
      ...manifest.completeness.warnings.map((warning) => `- ${warning}`),
      '',
    ].join('\n'),
    'notes',
    'text/plain',
  )
  const manifestText = JSON.stringify(manifest, null, 2)
  const manifestBytes = encoder.encode(manifestText).byteLength
  if (manifestBytes > LOCAL_BUNDLE_LIMITS.manifest)
    throw new Error(
      'The backup manifest exceeds the 2 MiB import limit. Export fewer items or original files separately.',
    )
  if (totalBytes + manifestBytes > LOCAL_BUNDLE_LIMITS.unpacked)
    throw new Error('The backup including its manifest exceeds the 256 MiB unpacked import limit.')
  zip.file('manifest.json', manifestText)
  input.onProgress?.('Compressing the verified files…')
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  if (bytes.byteLength > LOCAL_BUNDLE_LIMITS.compressed)
    throw new Error('The ZIP exceeds the 128 MiB browser import limit. Export fewer local items.')
  // Directory entries and the manifest count too; never return a bundle rejected by the reader's ZIP limits.
  inspectLocalZip(bytes)
  return { blob: new Blob([Uint8Array.from(bytes).buffer], { type: 'application/zip' }), manifest }
}

/** Rejects oversized entries before JSZip inflates them. ZIP64 and split archives are outside this bounded format. */
export function inspectLocalZip(
  bytes: Uint8Array,
  limits: { maxEntries?: number; maxFileBytes?: number; maxTotalBytes?: number; maxCompressedBytes?: number } = {},
) {
  const maximum = {
    maxEntries: LOCAL_BUNDLE_LIMITS.files,
    maxFileBytes: LOCAL_BUNDLE_LIMITS.file,
    maxTotalBytes: LOCAL_BUNDLE_LIMITS.unpacked,
    maxCompressedBytes: LOCAL_BUNDLE_LIMITS.compressed,
    ...limits,
  }
  if (bytes.byteLength > maximum.maxCompressedBytes) throw new Error('The ZIP exceeds the compressed size limit.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65557); offset--) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.byteLength
    ) {
      end = offset
      break
    }
  }
  if (end < 0) throw new Error('This file is not a supported ZIP archive.')
  const count = view.getUint16(end + 10, true)
  const size = view.getUint32(end + 12, true)
  let cursor = view.getUint32(end + 16, true)
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    count > maximum.maxEntries ||
    cursor + size !== end
  )
    throw new Error('Split, ZIP64 or oversized archives are not supported.')
  let total = 0
  const names = new Set<string>()
  const entries: { name: string; compressedBytes: number; uncompressedBytes: number; crc32: number }[] = []
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Invalid ZIP directory.')
    const length = view.getUint16(cursor + 28, true)
    const extra = view.getUint16(cursor + 30, true)
    const comment = view.getUint16(cursor + 32, true)
    const unpacked = view.getUint32(cursor + 24, true)
    const compressed = view.getUint32(cursor + 20, true)
    if (
      cursor + 46 + length + extra + comment > end ||
      view.getUint16(cursor + 8, true) & 1 ||
      unpacked > maximum.maxFileBytes ||
      compressed > maximum.maxCompressedBytes
    )
      throw new Error('Encrypted or oversized archive entries are not supported.')
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + length))
    const path = name.endsWith('/') ? name.slice(0, -1) : name
    if (
      !path ||
      path.length > 1000 ||
      /^[a-z]:|^[/\\]/i.test(path) ||
      path.includes('\\') ||
      [...path].some((character) => character.charCodeAt(0) < 32) ||
      path.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('The ZIP contains an unsafe path.')
    if (names.has(name)) throw new Error('Duplicate archive paths are not supported.')
    names.add(name)
    total += unpacked
    if (total > maximum.maxTotalBytes) throw new Error('The archive exceeds its unpacked size limit.')
    if (name === 'manifest.json' && unpacked > LOCAL_BUNDLE_LIMITS.manifest)
      throw new Error('The archive manifest is too large.')
    entries.push({
      name,
      compressedBytes: compressed,
      uncompressedBytes: unpacked,
      crc32: view.getUint32(cursor + 16, true),
    })
    cursor += 46 + length + extra + comment
  }
  if (cursor !== end) throw new Error('Invalid ZIP directory length.')
  return { entries, uncompressedBytes: total }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
type ZipStreamFile = import('jszip').JSZipObject & {
  internalStream(type: 'uint8array'): import('jszip').JSZipStreamHelper<Uint8Array>
}

/** Bounded expansion, including forged size declarations. CRC is checked while streaming each entry. */
export async function readBoundedLocalZip(
  bytes: Uint8Array,
  limits: Parameters<typeof inspectLocalZip>[1] = {},
  onProgress?: (message: string) => void,
): Promise<Map<string, Uint8Array>> {
  const inspection = inspectLocalZip(bytes, limits)
  const { default: JSZip } = await import('jszip')
  // Automatic CRC checking expands everything before a caller can bound actual output. Do it during the stream.
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false })
  const files = new Map<string, Uint8Array>()
  for (let index = 0; index < inspection.entries.length; index++) {
    const entry = inspection.entries[index]
    if (entry.name.endsWith('/')) {
      if (entry.uncompressedBytes !== 0 || entry.crc32 !== 0)
        throw new Error('Archive directories cannot contain file data.')
      continue
    }
    const item = zip.file(entry.name) as ZipStreamFile | null
    if (!item || (item.unsafeOriginalName && item.unsafeOriginalName !== entry.name))
      throw new Error('The archive contains an unsafe or inconsistent file path.')
    onProgress?.(`Reading archive file ${index + 1} of ${inspection.entries.length}`)
    const content = await new Promise<Uint8Array>((resolve, reject) => {
      const stream = item.internalStream('uint8array')
      let chunks: Uint8Array[] = []
      let size = 0
      let crc = 0xffffffff
      let settled = false
      const fail = (reason: unknown) => {
        if (settled) return
        settled = true
        chunks = []
        stream.pause()
        reject(reason)
      }
      stream.on('data', (chunk) => {
        if (settled) return
        size += chunk.byteLength
        if (size > entry.uncompressedBytes) {
          fail(new Error(`Archive file exceeds its declared expansion bound: ${entry.name}.`))
          return
        }
        for (const value of chunk) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8)
        chunks.push(chunk)
      })
      stream.on('error', fail)
      stream.on('end', () => {
        if (settled) return
        if (size !== entry.uncompressedBytes || (crc ^ 0xffffffff) >>> 0 !== entry.crc32) {
          fail(new Error(`CRC32 or size verification failed: ${entry.name}.`))
          return
        }
        settled = true
        const output = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          output.set(chunk, offset)
          offset += chunk.byteLength
        }
        chunks = []
        resolve(output)
      })
      stream.resume()
    })
    files.set(entry.name, content)
  }
  return files
}
function checkedManifest(value: unknown): LocalBundleManifest {
  const manifest = object(value)
  if (
    manifest?.schema !== LOCAL_BUNDLE_SCHEMA ||
    typeof manifest.name !== 'string' ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.records) ||
    manifest.files.length > LOCAL_BUNDLE_LIMITS.files ||
    manifest.records.length > LOCAL_BUNDLE_LIMITS.records ||
    !Array.isArray(manifest.remoteResources) ||
    !Array.isArray(manifest.relationships)
  )
    throw new Error('This ZIP is not a supported Nechako local workbench backup.')
  const paths = new Set<string>()
  for (const value of manifest.files) {
    const file = object(value)
    const path = checkedPath(file?.path)
    if (
      paths.has(path) ||
      path === 'manifest.json' ||
      typeof file?.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      Number(file.bytes) < 0 ||
      Number(file.bytes) > LOCAL_BUNDLE_LIMITS.file ||
      typeof file.mime !== 'string'
    )
      throw new Error('Invalid or duplicate archive file metadata.')
    paths.add(path)
  }
  const ids = new Set<string>()
  for (const value of manifest.records) {
    const record = object(value)
    if (
      typeof record?.id !== 'string' ||
      ids.has(record.id) ||
      typeof record.kind !== 'string' ||
      !paths.has(checkedPath(record.path)) ||
      (record.blobPath !== undefined && !paths.has(checkedPath(record.blobPath)))
    )
      throw new Error('Invalid archive record mapping.')
    ids.add(record.id)
  }
  if (manifest.workspacePath !== undefined && !paths.has(checkedPath(manifest.workspacePath)))
    throw new Error('The archive workspace is missing.')
  const completeness = object(manifest.completeness)
  if (!Array.isArray(completeness?.warnings) || !completeness.warnings.every((item) => typeof item === 'string'))
    throw new Error('The archive completeness report is invalid.')
  for (const key of [
    'recordCount',
    'originalFileCount',
    'materializedLayerCount',
    'partialLayerCount',
    'descriptorLayerCount',
    'privateRecordCount',
  ])
    if (!Number.isSafeInteger(completeness[key]) || Number(completeness[key]) < 0)
      throw new Error('Invalid archive completeness counts.')
  if (completeness.recordCount !== manifest.records.length)
    throw new Error('The archive record count does not match its manifest.')
  return manifest as unknown as LocalBundleManifest
}

/** Read/review only: no persistence, map changes or remote requests. */
export async function readLocalWorkbenchBundle(
  file: Blob,
  onProgress?: (message: string) => void,
): Promise<LocalBundlePreview> {
  if (file.size > LOCAL_BUNDLE_LIMITS.compressed) throw new Error('Choose a backup ZIP no larger than 128 MiB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const contents = await readBoundedLocalZip(bytes, {}, onProgress)
  const manifestFile = contents.get('manifest.json')
  if (!manifestFile) throw new Error('The ZIP has no local workbench manifest.')
  const manifestText = new TextDecoder('utf-8', { fatal: true }).decode(manifestFile)
  if (manifestFile.byteLength > LOCAL_BUNDLE_LIMITS.manifest) throw new Error('The archive manifest is too large.')
  const manifest = checkedManifest(JSON.parse(manifestText))
  const declared = new Set(['manifest.json', ...manifest.files.map((entry) => entry.path)])
  for (const path of contents.keys())
    if (!declared.has(path)) throw new Error('The archive contains an unlisted or unsafe file.')
  for (let index = 0; index < manifest.files.length; index++) {
    const entry = manifest.files[index]
    onProgress?.(`Verifying file ${index + 1} of ${manifest.files.length}`)
    const content = contents.get(entry.path)
    if (!content) throw new Error(`A required archive file is missing: ${entry.path}`)
    if (content.byteLength !== entry.bytes || (await localBundleSha256(content)) !== entry.sha256)
      throw new Error(`Checksum verification failed: ${entry.path}. No local items were changed.`)
  }
  const json = (path: string) =>
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contents.get(path)!)) as unknown
  const records = manifest.records.map((entry) => {
    const input = object(json(entry.path))
    if (!input || input.id !== entry.id || input.kind !== entry.kind || input.blob !== undefined)
      throw new Error('Archive record identity does not match its manifest.')
    const binary = entry.blobPath ? contents.get(entry.blobPath) : undefined
    const record = checkedLocalWorkbenchRecord({
      ...input,
      ...(binary
        ? {
            blob: new Blob([Uint8Array.from(binary).buffer], {
              type: typeof input.mime === 'string' ? input.mime : '',
            }),
          }
        : {}),
    } as LocalWorkbenchRecord)
    localWorkbenchJson(record.data)
    return record
  })
  const workspace = manifest.workspacePath ? importWorkspace(json(manifest.workspacePath)) : undefined
  return { manifest, records, workspace }
}
