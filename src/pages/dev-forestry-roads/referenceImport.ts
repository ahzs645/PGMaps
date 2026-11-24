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
  // A PDF's line drawing is one painting operation, not a record: its pieces are never roads. A GIS
  // record of several parts is (one road per part, `linePartCount`).
  if (
    file.pdf?.sheet ||
    file.pdf?.classGrid ||
    file.pdf?.imageMosaic ||
    file.collection.features.some((f) => f.geometry.type === 'MultiLineString' && (file.pdf || f.properties?.pdfSource))
  )
    return ['reference']
  const shapes = new Set(file.collection.features.map(shapeOf))
  if (shapes.size === 1 && shapes.has('line')) return ['reference', 'proposed-road']
  if (shapes.size === 1 && shapes.has('polygon')) return ['reference', 'planned-block']
  return ['reference']
}

/** Two sheets whose frame corners all lie this close show the same map frame. */
export const SAME_FRAME_M = 10
/** A registration fit this much tighter than another sheet's of the same frame is preferred, and said. */
export const REGISTRATION_PREFERENCE_M = 0.3

/**
 * A sheet saved again by another program can carry rounded registration points, so its layers sit a
 * metre or two off the original export's. Where two sheets show the same frame, the import notes
 * say which is registered less tightly, and a class raster or image layer both offer is taken from
 * the tighter one. Changes `files` in place; nothing is dropped.
 */
export function preferTighterRegistration(files: SpatialFile[]): void {
  const pdfs = files.filter((file) => file.pdf)
  const fit = (file: SpatialFile) => file.pdf!.source.registrationErrorM
  const name = (file: SpatialFile) => file.pdf!.source.file.split('/').at(-1)!
  const kindOf = (file: SpatialFile) =>
    file.pdf!.classGrid
      ? `class:${file.pdf!.classGrid.kind}`
      : file.pdf!.imageMosaic
        ? `image:${file.pdf!.imageMosaic.kind}`
        : null
  for (const kind of new Set(pdfs.map(kindOf))) {
    if (!kind) continue
    const offered = pdfs.filter((file) => kindOf(file) === kind)
    const chosen = offered.find((file) => file.pdf!.selected)
    const best = offered.reduce((a, b) => (fit(b) < fit(a) ? b : a))
    if (!chosen || best === chosen || fit(chosen) - fit(best) <= REGISTRATION_PREFERENCE_M) continue
    chosen.pdf!.selected = false
    best.pdf!.selected = true
    ;(best.notices ??= []).push(
      `${name(best)}: chosen over ${name(chosen)} for the same layer, because its registration points fit ${fit(best).toFixed(1)} m against ${fit(chosen).toFixed(1)} m.`,
    )
  }
  const metres = (a: number[], b: number[]) =>
    Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111_320
  const frames = pdfs.flatMap((file) => {
    const geometry = file.collection.features[0]?.geometry
    return file.pdf!.sheet && !file.pdf!.classGrid && geometry?.type === 'Polygon'
      ? [{ file, corners: geometry.coordinates[0].slice(0, 4) }]
      : []
  })
  for (const worse of frames) {
    const better = frames
      .filter(
        (other) =>
          other !== worse &&
          fit(worse.file) - fit(other.file) > REGISTRATION_PREFERENCE_M &&
          other.corners.length === worse.corners.length &&
          other.corners.every((corner, i) => metres(corner, worse.corners[i]) <= SAME_FRAME_M),
      )
      .reduce<(typeof frames)[number] | null>((a, b) => (!a || fit(b.file) < fit(a.file) ? b : a), null)
    if (better)
      (worse.file.notices ??= []).push(
        `${name(worse.file)} shows the same map frame as ${name(better.file)}, but its registration points fit ${fit(worse.file).toFixed(1)} m against ${fit(better.file).toFixed(1)} m, so its layers can sit about that far off. Use ${name(better.file)}'s layers where both offer one.`,
      )
  }
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
      .filter((file) => !file.pdf?.sheet && !file.pdf?.classGrid && !file.pdf?.imageMosaic)
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

/**
 * Which Forest Operations Map layer a record comes from, by the published schema's own keys
 * (`WHSE_FOREST_TENURE.FOM_ROAD_SECTION_SP` and `FOM_CUTBLOCK_SP`). A shapefile's DBF cuts field
 * names to ten characters (`FOM_RS_SYS`, `CUT_BLOCK_`), so the keys are matched by prefix. Every FOM
 * road section and cutblock is a proposal; its retention areas are not matched and stay reference.
 */
export function fomLayerOf(feature: GeoJSON.Feature): 'road-section' | 'cutblock' | null {
  const keys = Object.keys(feature.properties ?? {}).map((key) => key.toUpperCase())
  if (!keys.includes('FOM_ID')) return null
  if (keys.some((key) => key.startsWith('FOM_RS_SYS') || key.startsWith('ROAD_SECTI'))) return 'road-section'
  if (keys.some((key) => key.startsWith('FOM_C_SYS') || key.startsWith('CUT_BLOCK_'))) return 'cutblock'
  return null
}

/**
 * Conservative suggestions shown for review: numbered operational roads, a canonical block file, and
 * the Forest Operations Map's own road sections and cutblocks.
 */
export function suggestedLayerRole(file: SpatialFile): LayerImportRole {
  const options = layerImportOptions(file)
  if (options.length === 1) return options[0]
  const fom = file.collection.features.length ? fomLayerOf(file.collection.features[0]) : null
  if (fom && file.collection.features.every((f) => fomLayerOf(f) === fom)) {
    if (fom === 'road-section' && options.includes('proposed-road')) return 'proposed-road'
    if (fom === 'cutblock' && options.includes('planned-block')) return 'planned-block'
  }
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
  if (options.includes('planned-block') && PLAN_FILE.test(stem) && hasBlockKey(file)) return 'planned-block'
  return 'reference'
}

/** A file named as a plan or proposal: "5 Year Plan", "proposed blocks", "FDP", "draft". */
const PLAN_FILE = /plan|propos|draft|fdp|\bfom\b|(^|[^a-z])fsp([^a-z]|$)/i
/** A block's own identifier field, DBF-truncated names included (`CUT_BLOCK_`, `CUTBLOCK_I`). */
const BLOCK_KEY = /^(block(_?(id|no|num|name))?|blk(_?(id|no|num))?|cut_?block(_?(id|no|num|i))?_?|opening_?id)$/i
const hasBlockKey = (file: SpatialFile) =>
  file.collection.features.some((f) =>
    Object.keys(f.properties?.sourceAttributes ?? f.properties ?? {}).some((key) => BLOCK_KEY.test(key)),
  )

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

/** A shapefile's own sidecars: read with it (`.shx`, `.dbf`, `.prj`, `.cpg`) or not needed (indexes, metadata). */
const SHAPEFILE_SIDECAR = /\.(shx|dbf|prj|cpg|sbn|sbx|qix|fix|atx|ain|aih|ixs|mxs|qmd|shp\.xml)$/i

/** What a file left unread is, in a word, for the import's "Not read" note. */
function unreadKind(name: string) {
  if (/^~\$/.test(name)) return 'Office lock file'
  if (/\.lock$/i.test(name)) return 'ArcGIS lock file'
  if (/\.(docx?|rtf|odt)$/i.test(name)) return 'Word document'
  if (/\.(xlsx?|xlsm|csv|ods)$/i.test(name)) return 'spreadsheet'
  if (/\.(png|jpe?g|tiff?|gif|heic|webp)$/i.test(name)) return 'picture'
  return null
}

/**
 * One note naming what a picked folder held that the import does not read, so a skipped file is never
 * silent. A shapefile's sidecars are read with it or not needed, and are not named. Null when every
 * file was read.
 */
export function unreadFilesNote(paths: readonly string[]): string | null {
  const unread = paths.filter(
    (path) => !LAYER_FILE.test(path) && !/\.pdf$/i.test(path) && !SHAPEFILE_SIDECAR.test(path),
  )
  if (!unread.length) return null
  const byKind = new Map<string, string[]>()
  for (const path of unread) {
    const name = path.split('/').at(-1)!
    const kind = unreadKind(name) ?? 'not a map layer'
    byKind.set(kind, [...(byKind.get(kind) ?? []), name])
  }
  const parts = [...byKind].map(([kind, names]) =>
    /lock file$/.test(kind)
      ? `${names.length} ${kind}${names.length === 1 ? '' : 's'}`
      : `${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''} (${kind})`,
  )
  return `Not read: ${parts.join('; ')}.`
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
  const unread = unreadFilesNote(files.map(({ path }) => path))
  if (!layers.length && !pdfs.length)
    throw Error(
      `Nothing here is a map layer. Choose a map PDF, shapefiles (or a folder or ZIP holding them), GeoJSON, KML or KMZ.${unread ? ` ${unread}` : ''}`,
    )

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
  // Where the GIS layers lie, read before the sheets join `decoded`: a sheet away from them is not ticked.
  const gisExtent = layersExtent(decoded)
  if (pdfs.length) {
    const { importGeoPdf } = await import('@/lib/geoPdf/client')
    const seen = new Map<string, string>()
    // The first class raster and the first ticked image layer of each kind start selected.
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
            : layer.imageMosaic
              ? layer.selected && !classKinds.has(`image:${layer.imageMosaic.kind}`)
              : path === preferred.path && (layer.name === 'Map sheet' || (!layers.length && layer.selected))
        if (layer.classGrid) classKinds.add(layer.classGrid.kind)
        if (layer.imageMosaic) classKinds.add(`image:${layer.imageMosaic.kind}`)
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
            imageMosaic: layer.imageMosaic,
            contourSurface: layer.contourSurface,
            ...(layer.assumedVerticalDatum ? { assumedVerticalDatum: layer.assumedVerticalDatum } : {}),
            selected,
          },
        }
      })
      if (added[0]) added[0].notices = result.notices.map((note) => `${path}: ${note}`)
      decoded.push(...added)
    }
    preferTighterRegistration(decoded)
    tickSheetsByFrame(decoded, gisExtent)
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
  if (unread && decoded[0]) (decoded[0].notices ??= []).push(unread)
  return decoded
}

/**
 * Ticks the map sheet of every frame not already shown: sheets of one block (slope, canopy, field
 * layout) share a frame and keep the one already chosen, while overview sheets of different areas are
 * each ticked. With GIS layers in the import, only frames over them are added. Changes `files` in place.
 */
export function tickSheetsByFrame(
  files: SpatialFile[],
  extent: readonly [number, number, number, number] | null,
): void {
  const frames = files.flatMap((file) => {
    const geometry = file.collection.features[0]?.geometry
    return file.pdf?.sheet && !file.pdf.classGrid && !file.pdf.imageMosaic && geometry?.type === 'Polygon'
      ? [{ file, corners: geometry.coordinates[0].slice(0, 4) }]
      : []
  })
  const metres = (a: number[], b: number[]) =>
    Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111_320
  const sameFrame = (a: number[][], b: number[][]) =>
    a.length === b.length && a.every((corner, i) => metres(corner, b[i]) <= SAME_FRAME_M)
  const shown = frames.filter(({ file }) => file.pdf!.selected)
  for (const frame of frames) {
    if (frame.file.pdf!.selected || shown.some((other) => sameFrame(other.corners, frame.corners))) continue
    if (extent) {
      const xs = frame.corners.map((c) => c[0]),
        ys = frame.corners.map((c) => c[1])
      if (
        Math.max(...xs) < extent[0] ||
        Math.min(...xs) > extent[2] ||
        Math.max(...ys) < extent[1] ||
        Math.min(...ys) > extent[3]
      )
        continue
    }
    frame.file.pdf!.selected = true
    shown.push(frame)
  }
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
        // The mapping step may have marked a row harvested, with its year; otherwise a block is proposed.
        ...(planned
          ? {
              harvestEvidence: feature.properties?.harvestEvidence ?? {
                source: 'user',
                status: 'proposed',
                yearMethod: 'unknown',
              },
            }
          : {}),
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
