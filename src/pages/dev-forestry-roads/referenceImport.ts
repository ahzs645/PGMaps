import type { PickedFile } from '@/components/ui/picked-files'
import { parseProject } from './project'
import {
  referenceLayerKey,
  referenceVertexCount,
  MAX_REFERENCE_FEATURES,
  MAX_REFERENCE_VERTICES,
  type ReferenceFeature,
} from './referenceFeatures'
import {
  applySpatialImport,
  buildSpatialImport,
  readLooseShapefile,
  readSpatialFiles,
  shapeOf,
  type SpatialFile,
} from './spatialImport'
import type { ContextFeature, RoadProject } from './types'
import { keepCutblockBuffers, type CutblockBuffer } from './cutblockBuffers'

export const REFERENCE_ACCEPT = '.geojson,.json,.zip,.kml,.kmz,.shp,.shx,.dbf,.prj,.cpg,.pdf'
const LAYER_FILE = /\.(geojson|json|zip|kml|kmz|shp)$/i
const ROLES = { point: 'reference', line: 'reference', polygon: 'reference' } as const
export type LayerImportRole = 'reference' | 'proposed-road' | 'planned-block' | 'terrain'
export const LAYER_IMPORT_LABELS: Record<LayerImportRole, string> = {
  reference: 'Reference',
  'proposed-road': 'Proposed road',
  'planned-block': 'Planned cutblock',
  terrain: 'Terrain (replaces current)',
}
export interface LayerImportChoice {
  file: SpatialFile
  role: LayerImportRole
  buffer?: CutblockBuffer
}

/** Reference context starts hidden on reopening too; unadopted proposed lines remain available. */
export function defaultHiddenReferenceLayers(project: RoadProject) {
  return [
    ...new Set(
      (project.reference ?? [])
        .filter((f) => f.role !== 'proposed-road' || project.alignments.some((a) => a.name === f.name))
        .map(referenceLayerKey),
    ),
  ]
}

export function layerImportOptions(file: SpatialFile): LayerImportRole[] {
  if (file.pdf?.contourSurface) return ['terrain']
  // A PDF's line drawing is one painting operation, not a record: its pieces are never roads. A GIS
  // record of several parts is (one road per part, `linePartCount`).
  if (
    file.pdf?.sheet ||
    file.pdf?.classGrid ||
    file.collection.features.some((f) => f.geometry.type === 'MultiLineString' && (file.pdf || f.properties?.pdfSource))
  )
    return ['reference']
  const shapes = new Set(file.collection.features.map(shapeOf))
  if (shapes.size === 1 && shapes.has('line')) return ['reference', 'proposed-road']
  if (shapes.size === 1 && shapes.has('polygon')) return ['reference', 'planned-block']
  return ['reference']
}

/** How many single lines a file's line features hold: a multi-part record loads one road per part. */
export function linePartCount(file: SpatialFile) {
  return file.collection.features.reduce(
    (n, f) =>
      n +
      (f.geometry.type === 'MultiLineString'
        ? f.geometry.coordinates.length
        : f.geometry.type === 'LineString'
          ? 1
          : 0),
    0,
  )
}

/**
 * WGS84 [west, south, east, north] of the design inputs among the choices: proposed roads and
 * planned blocks, the ground a terrain has to cover. Null when there are none.
 */
export function designExtent(
  choices: readonly Pick<LayerImportChoice, 'file' | 'role'>[],
): [number, number, number, number] | null {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      w = Math.min(w, value[0])
      e = Math.max(e, value[0])
      s = Math.min(s, value[1])
      n = Math.max(n, value[1])
    } else value.forEach(visit)
  }
  for (const { file, role } of choices)
    if (role === 'proposed-road' || role === 'planned-block')
      for (const f of file.collection.features) if ('coordinates' in f.geometry) visit(f.geometry.coordinates)
  return Number.isFinite(w + s + e + n) ? [w, s, e, n] : null
}

/**
 * WGS84 bounds of every GIS feature the files hold, map sheets and class grids left out: where a
 * new project goes when the files have no road or block to design on. Null when there are none.
 */
export function layersExtent(files: readonly SpatialFile[]) {
  return designExtent(
    files
      .filter((file) => !file.pdf?.sheet && !file.pdf?.classGrid)
      .map((file) => ({ file, role: 'planned-block' as const })),
  )
}

/** A note several files share prints once, naming the files, instead of once per file. */
export function groupNotes(notes: readonly string[]): string[] {
  const byText = new Map<string, string[]>()
  const order: string[] = []
  for (const note of new Set(notes)) {
    const match = /^(.+?\.(?:pdf|shp|geojson|json|kml|kmz|zip)): (.+)$/i.exec(note)
    const key = match ? match[2] : note
    if (!byText.has(key)) {
      byText.set(key, [])
      order.push(key)
    }
    if (match) byText.get(key)!.push(match[1])
  }
  return order.map((text) => {
    const files = byText.get(text)!
    if (files.length === 0) return text
    if (files.length === 1) return `${files[0]}: ${text}`
    return `${text} (${files.length} files: ${files.map((f) => f.split('/').at(-1)).join(', ')})`
  })
}

/** A copy's name ("x - Copy.pdf", "x (1).pdf", "Copy of x.pdf") sorts after the file it copies. */
const isCopyName = (path: string) =>
  /(?: - Copy(?: \(\d+\))?| copy| \(\d+\))\.[a-z]+$/i.test(path) || /(?:^|\/)Copy of /i.test(path)

/** Conservative suggestions shown for review: numbered operational roads and a canonical block file. */
export function suggestedLayerRole(file: SpatialFile): LayerImportRole {
  const options = layerImportOptions(file)
  if (options.length === 1) return options[0]
  const stem = file.fileName
    .split('/')
    .at(-1)!
    .replace(/\.[^.]+$/, '')
  if (
    options.includes('proposed-road') &&
    file.collection.features.every((f) => /^[A-Z]{2,}\d+\.\d{3,}$/i.test(String(f.properties?.name ?? '')))
  )
    return 'proposed-road'
  if (options.includes('planned-block') && /^[A-Z]{2,}\d+$/i.test(stem)) return 'planned-block'
  return 'reference'
}

/** Explicit import choice: make each proposed road available in the switcher and profile together. */
export function loadImportedProposedRoads(
  project: RoadProject,
  imported: ReturnType<typeof applyLayerImport>['imported'],
  newId: () => string,
) {
  let next = project
  for (const feature of imported) {
    if (!('role' in feature) || feature.role !== 'proposed-road' || feature.geometry.type !== 'LineString') continue
    if (
      next.alignments.some(
        (a) =>
          a.name === feature.name &&
          JSON.stringify(a.points.map((p) => p.coordinate)) === JSON.stringify(feature.geometry.coordinates),
      )
    )
      continue
    const file: SpatialFile = {
      fileName: 'Imported proposed roads',
      format: 'GeoJSON',
      crs: 'WGS84 longitude/latitude',
      collection: {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { name: feature.name }, geometry: feature.geometry }],
      },
    }
    next = applySpatialImport(
      next,
      buildSpatialImport(file, { line: 'road', point: null, polygon: null }, 'road'),
      newId,
    )
  }
  return next
}

/** Each file is a layer. Sidecars must have the same stem in the same directory. */
export async function readReferenceImport(picked: readonly PickedFile[], signal?: AbortSignal): Promise<SpatialFile[]> {
  const files = picked.filter(
    ({ path }) => !path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX'),
  )
  const byPath = new Map(files.map(({ path, file }) => [path.toLowerCase(), file]))
  const layers = files.filter(({ path }) => LAYER_FILE.test(path)).sort((a, b) => a.path.localeCompare(b.path))
  // Originals first, so an identical copy is the one named and left out.
  const pdfs = files
    .filter(({ path }) => /\.pdf$/i.test(path))
    .sort((a, b) => Number(isCopyName(a.path)) - Number(isCopyName(b.path)) || a.path.localeCompare(b.path))
  if (!layers.length && !pdfs.length)
    throw Error('Choose a Canfor map PDF, a folder with shapefiles, GeoJSON, KML, KMZ or a shapefile ZIP.')

  const decoded: SpatialFile[] = []
  for (const { file, path } of layers) {
    signal?.throwIfAborted()
    const stem = path.slice(0, -4).toLowerCase()
    const read = /\.shp$/i.test(path)
      ? [
          await readLooseShapefile(file, path, {
            prj: byPath.get(stem + '.prj'),
            dbf: byPath.get(stem + '.dbf'),
            cpg: byPath.get(stem + '.cpg'),
          }),
        ]
      : await readSpatialFiles(file, path)
    decoded.push(...read)
  }
  const blockIds = decoded.flatMap((file) => {
    const match = /^([A-Z]{2,}\d+)\.shp$/i.exec(file.fileName.split('/').at(-1)!)
    return match && file.collection.features.every((f) => shapeOf(f) === 'polygon') ? [match[1].toUpperCase()] : []
  })
  if (blockIds.length === 1) {
    for (const layer of decoded) {
      const others = layer.collection.features.flatMap((f) => {
        const match = /^([A-Z]{2,}\d+)\.\d+/.exec(String(f.properties?.name ?? ''))
        return match && match[1] !== blockIds[0] ? [match[1]] : []
      })
      if (others.length) {
        layer.selected = false
        layer.notices = [
          `${layer.fileName}: names ${[...new Set(others)].join(', ')} beside block ${blockIds[0]}; left unselected for review.`,
        ]
      }
    }
  }
  if (pdfs.length) {
    const { importGeoPdf } = await import('@/lib/geoPdf/client')
    const seen = new Map<string, string>()
    const classKinds = new Set<string>()
    const preferred = pdfs.find((p) => /Field_Layout/i.test(p.path)) ?? pdfs[0]
    for (const { file, path } of pdfs) {
      signal?.throwIfAborted()
      // Hash first: an identical copy is named and skipped before its JPEG tiles are decoded.
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const copyOf = seen.get(hash)
      if (copyOf) {
        if (decoded[0]) (decoded[0].notices ??= []).push(`${path}: identical to ${copyOf}; duplicate left out.`)
        continue
      }
      const result = await importGeoPdf(
        file,
        path,
        { maxFeatures: MAX_REFERENCE_FEATURES, maxVertices: MAX_REFERENCE_VERTICES },
        signal,
      )
      const duplicate = seen.get(result.sha256)
      if (duplicate) {
        if (decoded[0]) (decoded[0].notices ??= []).push(`${path}: identical to ${duplicate}; duplicate left out.`)
        continue
      }
      seen.set(result.sha256, path)
      let featureBudget = MAX_REFERENCE_FEATURES,
        vertexBudget = MAX_REFERENCE_VERTICES
      const added: SpatialFile[] = result.layers.map((layer) => {
        const full = `${path}/Page ${layer.source.page}/${layer.name}`
        const vertices = layer.features.reduce(
          (sum, f) => sum + referenceVertexCount({ geometry: f.geometry as ReferenceFeature['geometry'] }),
          0,
        )
        // A contour surface replaces the terrain, so it is never chosen for the person here.
        const requested = layer.contourSurface
          ? false
          : layer.classGrid
            ? !classKinds.has(layer.classGrid.kind)
            : path === preferred.path && (layer.name === 'Map sheet' || (!layers.length && layer.selected))
        if (layer.classGrid) classKinds.add(layer.classGrid.kind)
        const selected = requested && layer.features.length <= featureBudget && vertices <= vertexBudget
        if (selected) {
          featureBudget -= layer.features.length
          vertexBudget -= vertices
        }
        return {
          fileName: full.length <= 200 ? full : `${result.sha256.slice(0, 16)}/${full.slice(-180)}`,
          format: 'GeoPDF',
          crs: 'Embedded projected map registration → WGS84',
          collection: { type: 'FeatureCollection', features: layer.features },
          pdf: {
            source: layer.source,
            note: layer.note,
            sheet: layer.sheet,
            classGrid: layer.classGrid,
            contourSurface: layer.contourSurface,
            selected,
          },
        }
      })
      if (added[0]) added[0].notices = result.notices.map((note) => `${path}: ${note}`)
      decoded.push(...added)
    }
    // A template draws the same contours on several sheets. Offer one terrain: the field sheet's,
    // else the one with the most labelled lines, and name the others.
    const surfaces = decoded.filter((file) => file.pdf?.contourSurface)
    if (surfaces.length > 1) {
      const labelled = (file: SpatialFile) => file.pdf!.contourSurface!.assignment.labelledLines
      const kept =
        surfaces.find((file) => /Field_Layout/i.test(file.pdf!.source.file)) ??
        surfaces.reduce((best, file) => (labelled(file) > labelled(best) ? file : best))
      const others = surfaces.filter((file) => file !== kept)
      decoded.splice(0, decoded.length, ...decoded.filter((file) => !others.includes(file)))
      ;(kept.notices ??= []).push(
        `Terrain from contours: using ${kept.pdf!.source.file} (${labelled(kept)} labelled lines); the same contours on ${others
          .map((file) => `${file.pdf!.source.file} (${labelled(file)})`)
          .join(', ')} were left out.`,
      )
    }
  }
  return decoded
}

/** Imports a batch as one edit and refreshes only features belonging to the same source paths. */
export function applyLayerImport(project: RoadProject, choices: readonly LayerImportChoice[], newId: () => string) {
  const keys = new Set(choices.map(({ file }) => file.fileName))
  const reference = (project.reference ?? []).filter((feature) => !keys.has(referenceLayerKey(feature)))
  const context = project.context.filter((feature) => !feature.layerSource || !keys.has(feature.layerSource))
  const blocks: ContextFeature[] = []
  const imported = []
  for (const { file, role } of choices) {
    if (!layerImportOptions(file).includes(role))
      throw Error(`${file.fileName} cannot be used as ${LAYER_IMPORT_LABELS[role]}.`)
    // Terrain is adopted by the page (it asks for the vertical datum); it adds no layer.
    if (role === 'terrain') continue
    const planned = role === 'planned-block'
    const features = file.collection.features.map((feature) => ({
      ...feature,
      ...(planned ? { id: undefined } : {}),
      properties: {
        ...feature.properties,
        sourceAttributes: feature.properties?.sourceAttributes ?? feature.properties,
        ...(file.pdf ? { pdfSource: file.pdf.source } : {}),
        kind: planned ? 'harvest' : 'reference',
        ...(planned ? { harvestEvidence: { source: 'user', status: 'proposed', yearMethod: 'unknown' } } : {}),
      },
    }))
    const result = buildSpatialImport(
      { ...file, collection: { type: 'FeatureCollection', features } },
      ROLES,
      planned ? 'cutblocks' : 'reference',
    )
    if (planned) {
      // Match by source record and part in the same file; geometry/name edits otherwise get new IDs.
      const identity = (feature: ContextFeature) =>
        JSON.stringify([feature.harvestEvidence?.sourceId, feature.geometry])
      const ids = new Map(
        project.context
          .filter((feature) => feature.layerSource === file.fileName)
          .map((feature) => [identity(feature), feature.id]),
      )
      blocks.push(
        ...result.context.map((feature) => {
          const harvestEvidence = feature.harvestEvidence && {
            ...feature.harvestEvidence,
            sourceId: `${file.fileName}/${feature.harvestEvidence.sourceId}`,
          }
          const block = { ...feature, harvestEvidence, layerSource: file.fileName }
          return { ...block, id: ids.get(identity(block)) ?? newId() }
        }),
      )
    } else {
      imported.push(
        ...result.reference.map((feature) => ({
          ...feature,
          id: newId(),
          ...(role === 'proposed-road' ? { role } : {}),
        })),
      )
    }
  }
  const nextReference = [...reference, ...imported]
  const nextContext = [...context, ...blocks]
  const requested = choices.flatMap(({ role, buffer }) => (role === 'planned-block' && buffer ? [buffer] : []))
  const remaining = (project.cutblockBuffers ?? []).filter(({ layer }) => !keys.has(layer))
  const cutblockBuffers = keepCutblockBuffers([...remaining, ...requested], nextContext, nextReference)
  if (requested.some((buffer) => !cutblockBuffers.includes(buffer)))
    throw Error('Choose an available polygon layer for each cutblock buffer.')
  return {
    project: parseProject({
      ...project,
      context: nextContext,
      reference: nextReference,
      cutblockBuffers,
      ...(blocks.length ? { harvestHistoryYear: project.harvestHistoryYear ?? new Date().getFullYear() } : {}),
    }),
    imported: [...imported, ...blocks],
  }
}

/** Deleting an imported layer also drops its buffer association. A linked source remains a layer. */
export function removeImportedLayer(project: RoadProject, key: string): RoadProject {
  return parseProject({
    ...project,
    reference: project.reference?.filter((feature) => referenceLayerKey(feature) !== key),
    context: project.context.filter((feature) => feature.layerSource !== key),
  })
}
