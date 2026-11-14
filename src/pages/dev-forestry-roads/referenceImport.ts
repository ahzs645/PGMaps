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
import type { Alignment, ContextFeature, RoadProject } from './types'
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
  if (
    file.pdf?.sheet ||
    file.pdf?.classGrid ||
    file.collection.features.some((f) => f.geometry.type === 'MultiLineString')
  )
    return ['reference']
  const shapes = new Set(file.collection.features.map(shapeOf))
  if (shapes.size === 1 && shapes.has('line')) return ['reference', 'proposed-road']
  if (shapes.size === 1 && shapes.has('polygon')) return ['reference', 'planned-block']
  return ['reference']
}

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

/**
 * The design road a proposed line became. `edited: false` is a road that still has the line's own
 * vertices, whatever it is called now; failing that, the road that still carries the line's name
 * has been edited since (`edited: true`). Null when no design road came from the line.
 */
export function designRoadForProposedLine(
  line: { name: string; geometry: { type: string; coordinates: unknown } },
  alignments: readonly Alignment[],
): { road: Alignment; edited: boolean } | null {
  if (line.geometry.type !== 'LineString') return null
  const vertices = line.geometry.coordinates as readonly (readonly number[])[]
  const same = (road: Alignment) =>
    road.points.length === vertices.length &&
    road.points.every(
      ({ coordinate }, i) =>
        Math.abs(coordinate[0] - vertices[i][0]) < 1e-9 && Math.abs(coordinate[1] - vertices[i][1]) < 1e-9,
    )
  const unchanged = alignments.find(same)
  if (unchanged) return { road: unchanged, edited: false }
  const named = alignments.find((road) => road.name === line.name)
  return named ? { road: named, edited: true } : null
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
  const pdfs = files.filter(({ path }) => /\.pdf$/i.test(path)).sort((a, b) => a.path.localeCompare(b.path))
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
