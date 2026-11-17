/**
 * The visual-quality project file: everything in progress in one file, to open again and carry on. The scene (blocks,
 * landforms, road or viewpoint, views of interest, settings, the review and its hand edits), every saved view here
 * and at other places with its screenshot, analysed figure and before-harvest render, another engine's finished
 * figures, the assessment workspace, and the package's recipe and renderer. Not in it: terrain, the inventories and
 * the run, which are read and made again.
 *
 * The JSON reader still accepts inline pictures. A figure's rasters (a class code per pixel, tens of megabytes raw) are
 * gzipped one by one and written as base64, so a dozen views fit in a file a browser can read. No DOM access: the
 * gzip is the platform's `CompressionStream`, which Node has too.
 */
import type { SavedDriveView } from './previewState'
import { parseScene, serializeScene, type ForestryScene } from './scene'

export const PROJECT_FORMAT = 'pgmaps-visual-quality-project'
export const PROJECT_VERSION = 1
export const PROJECT_FILE_EXTENSION = '.pgvq.zip'
/** The largest project file opened, bytes. */
export const MAX_PROJECT_FILE_BYTES = 400 * 1024 * 1024
/** Saved views kept per place, the page's own limit. */
const MAX_VIEWS_PER_PLACE = 12
/** Places with shelved views kept: a project is one assessment, not a library. */
const MAX_PLACES = 64

/** A saved view's picture and what was kept with it; the page knows the rest of its shape (`ViewImage`). */
export type ProjectImage = { dataUrl: string; width: number; height: number; caption: string } & Record<string, unknown>

export interface ProjectState {
  scene: ForestryScene
  /** The views saved where the scene stands now. */
  views: SavedDriveView[]
  /** Views saved at other places, by the fingerprint of the scene they were saved in. */
  shelved: Array<{ key: string; views: SavedDriveView[] }>
  /** Each saved view's screenshot, figure and viewpoint record, by view id. */
  images: Record<string, ProjectImage>
  /** Before-harvest renders taken where a view stands, by view id. */
  capturedBefore: Record<string, unknown>
  /** Another engine's finished figures, by render job key. */
  engineFigures: Record<string, unknown>
  /** The assessment workspace as its own file's text (`serializeTools`), or null. */
  workspace: string | null
  /** The package's choices: who draws the figures and the recipe. */
  pkg: { renderer: string | null; recipeId: string | null }
}

export interface ProjectSummary {
  savedAt: string | null
  views: number
  /** Views whose picture came back with them. */
  pictures: number
  /** What was in the file and could not be read, each named. */
  dropped: string[]
}

const TYPED = {
  Uint8ClampedArray,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int16Array,
  Int32Array,
  Float32Array,
  Float64Array,
} as const
type TypedName = keyof typeof TYPED
type Typed = InstanceType<(typeof TYPED)[TypedName]>

const typedName = (value: unknown): TypedName | null => {
  if (!ArrayBuffer.isView(value) || value instanceof DataView) return null
  const name = value.constructor.name as TypedName
  return name in TYPED ? name : null
}

async function through(bytes: Uint8Array, stream: { readable: ReadableStream; writable: WritableStream }) {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream)
  return new Uint8Array(await new Response(piped).arrayBuffer())
}
const gzip = (bytes: Uint8Array) => through(bytes, new CompressionStream('gzip'))
const gunzip = (bytes: Uint8Array) => through(bytes, new DecompressionStream('gzip'))

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(binary)
}
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** `value` as plain JSON: typed arrays gzipped, sets and maps spelled out, functions and `undefined` left out. */
async function pack(value: unknown): Promise<unknown> {
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value
  const name = typedName(value)
  if (name) {
    const array = value as Typed
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
    return { $typed: name, gz: toBase64(await gzip(bytes)) }
  }
  if (Array.isArray(value)) return Promise.all(value.map(pack))
  if (value instanceof Set) return { $set: await Promise.all([...value].map(pack)) }
  if (value instanceof Map) return { $map: await Promise.all([...value].map((entry) => pack(entry))) }
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const packed = await pack(entry)
    if (packed !== undefined) out[key] = packed
  }
  return out
}

/** The inverse of `pack`. A typed array that does not read back throws: a figure with a wrong raster is worse than none. */
async function unpack(value: unknown): Promise<unknown> {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return Promise.all(value.map(unpack))
  const record = value as Record<string, unknown>
  if (typeof record.$typed === 'string' && typeof record.gz === 'string') {
    const make = TYPED[record.$typed as TypedName]
    if (!make) throw new Error(`an array of a kind this PGMaps does not read (${record.$typed})`)
    const bytes = await gunzip(fromBase64(record.gz))
    if (bytes.byteLength % make.BYTES_PER_ELEMENT) throw new Error('an array of the wrong length')
    return new make(bytes.buffer, bytes.byteOffset, bytes.byteLength / make.BYTES_PER_ELEMENT)
  }
  if (Array.isArray(record.$set)) return new Set(await Promise.all(record.$set.map(unpack)))
  if (Array.isArray(record.$map))
    return new Map((await Promise.all(record.$map.map(unpack))) as Array<[unknown, unknown]>)
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(record)) out[key] = await unpack(entry)
  return out
}

/** The same project document underlies standalone JSON and the project ZIP. */
export async function packProject(state: ProjectState, savedAt = new Date()) {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: savedAt.toISOString(),
    note: 'A PGMaps visual-quality project. Terrain, the inventories and the run are not in the file: they are read and made again when it is opened.',
    scene: JSON.parse(serializeScene(state.scene)),
    views: state.views,
    shelved: state.shelved,
    images: await pack(state.images),
    capturedBefore: await pack(state.capturedBefore),
    engineFigures: await pack(state.engineFigures),
    workspace: state.workspace,
    package: state.pkg,
  }
}

export async function serializeProject(state: ProjectState, savedAt = new Date()): Promise<string> {
  return JSON.stringify(await packProject(state, savedAt))
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined)

/** One saved view as read: its id kept (its picture is found by it), its numbers checked; null when it does not read. */
function readView(entry: unknown): SavedDriveView | null {
  if (!entry || typeof entry !== 'object') return null
  const v = entry as Partial<SavedDriveView>
  if (typeof v.id !== 'string' || !v.id || v.id.length > 200) return null
  if (![v.positionMeters, v.yaw, v.tilt, v.treeHeightMeters, v.roadClearWidthMeters].every(finite)) return null
  const designName = text(v.designName, 120)?.trim()
  return {
    id: v.id,
    name: text(v.name, 200) ?? 'View',
    positionMeters: Math.max(0, v.positionMeters!),
    lookAtTargetId: typeof v.lookAtTargetId === 'string' ? v.lookAtTargetId : null,
    ...(finite(v.lookBearing) ? { lookBearing: ((v.lookBearing % 360) + 360) % 360 } : {}),
    yaw: ((v.yaw! % 360) + 360) % 360,
    tilt: Math.max(-89, Math.min(89, v.tilt!)),
    treeHeightMeters: v.treeHeightMeters!,
    roadClearWidthMeters: v.roadClearWidthMeters!,
    harvestPhase: v.harvestPhase === 'before' ? 'before' : 'after',
    ...(typeof v.existingForest === 'boolean' ? { existingForest: v.existingForest } : {}),
    ...(typeof v.projectRecordedHeights === 'boolean' ? { projectRecordedHeights: v.projectRecordedHeights } : {}),
    ...(finite(v.growthMetersPerYear) ? { growthMetersPerYear: v.growthMetersPerYear } : {}),
    ...(finite(v.regenerationLagYears) ? { regenerationLagYears: v.regenerationLagYears } : {}),
    ...(designName ? { designName } : {}),
    ...(typeof v.plannedViewId === 'string' ? { plannedViewId: v.plannedViewId } : {}),
    ...(typeof v.plannedKey === 'string' ? { plannedKey: v.plannedKey } : {}),
  }
}
const readViews = (value: unknown) =>
  (Array.isArray(value) ? value : []).slice(0, MAX_VIEWS_PER_PLACE).flatMap((entry) => readView(entry) ?? [])

const isPicture = (value: unknown): value is { dataUrl: string; width: number; height: number } => {
  const picture = value as { dataUrl?: unknown; width?: unknown; height?: unknown } | null
  return (
    !!picture &&
    typeof picture.dataUrl === 'string' &&
    /^data:image\/(png|jpeg);base64,/.test(picture.dataUrl) &&
    finite(picture.width) &&
    finite(picture.height) &&
    picture.width > 0 &&
    picture.height > 0
  )
}
/** A class raster as a figure holds one (`ClassRaster`): one code a pixel, as many as its width and height say. */
const isRaster = (value: unknown): boolean => {
  const raster = value as { codes?: unknown; width?: unknown; height?: unknown } | null
  if (!raster || !(raster.codes instanceof Uint8Array) || !finite(raster.width) || !finite(raster.height)) return false
  return raster.width > 0 && raster.height > 0 && raster.codes.length === raster.width * raster.height
}

/**
 * The project in a file's text, checked: the scene through the scene's own reader, each view's numbers, each
 * picture's type and size, each figure's class raster against its stated size. What does not read is left out and
 * named in `summary.dropped`, never repaired; a file that is not a project, or is from a newer PGMaps, is refused.
 */
export async function parseProject(input: string): Promise<{ state: ProjectState; summary: ProjectSummary }> {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(input) as Record<string, unknown>
  } catch {
    throw new Error('This is not a project file: it is not JSON.')
  }
  return readProject(raw)
}

export async function readProject(
  raw: Record<string, unknown>,
): Promise<{ state: ProjectState; summary: ProjectSummary }> {
  if (!raw || raw.format !== PROJECT_FORMAT)
    throw new Error('This is not a visual-quality project file. Choose one saved as Project in Save & export.')
  if (!finite(raw.version) || raw.version < 1) throw new Error('The project file states no version.')
  if (raw.version > PROJECT_VERSION)
    throw new Error(`The project was saved by a newer PGMaps (file version ${raw.version}). Update and open it again.`)
  const scene = parseScene(raw.scene)
  if (!scene) throw new Error('The project’s scene could not be read.')
  const dropped: string[] = []

  const views = readViews(raw.views)
  const shelved = (Array.isArray(raw.shelved) ? raw.shelved : []).slice(0, MAX_PLACES).flatMap((entry) => {
    const place = entry as { key?: unknown; views?: unknown } | null
    const placed = readViews(place?.views)
    return place && typeof place.key === 'string' && place.key && placed.length
      ? [{ key: place.key, views: placed }]
      : []
  })
  const known = new Map([...views, ...shelved.flatMap((entry) => entry.views)].map((view) => [view.id, view.name]))
  const stated =
    (Array.isArray(raw.views) ? raw.views.length : 0) +
    (Array.isArray(raw.shelved)
      ? raw.shelved.reduce(
          (sum: number, e) =>
            sum + (Array.isArray((e as { views?: unknown })?.views) ? (e as { views: unknown[] }).views.length : 0),
          0,
        )
      : 0)
  if (stated > known.size)
    dropped.push(`${stated - known.size} saved view${stated - known.size === 1 ? '' : 's'} that did not read`)

  /** One keyed record of the file, each entry unpacked on its own so one bad entry costs only itself. */
  const records = async <T>(
    value: unknown,
    what: (key: string) => string,
    keep: (entry: unknown, key: string) => T | string,
  ) => {
    const out: Record<string, T> = {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out
    for (const [key, packed] of Object.entries(value as Record<string, unknown>)) {
      try {
        const kept = keep(await unpack(packed), key)
        if (typeof kept === 'string') dropped.push(`${what(key)}: ${kept}`)
        else out[key] = kept
      } catch (error) {
        dropped.push(`${what(key)}: ${error instanceof Error ? error.message : 'it did not read'}`)
      }
    }
    return out
  }
  const figureProblem = (figure: unknown): string | null => {
    if (figure === undefined) return null
    const f = figure as { classes?: unknown; frameImage?: unknown } | null
    if (!f || !isRaster(f.classes)) return 'its figure’s class pass is not the size it states'
    if (f.frameImage !== undefined && !isPicture(f.frameImage)) return 'its framed picture is not a picture'
    return null
  }
  const images = await records<ProjectImage>(
    Object.fromEntries(Object.entries((raw.images ?? {}) as object).filter(([id]) => known.has(id))),
    (id) => known.get(id) ?? id,
    (entry, id) => {
      if (!isPicture(entry)) return 'its screenshot is not a picture'
      const image = entry as ProjectImage
      const problem = figureProblem(image.figure)
      if (!problem) return { ...image, caption: text(image.caption, 400) ?? '' }
      // The screenshot is good and the figure is not: the view comes back without its analysis sheet, and says so.
      dropped.push(`${known.get(id) ?? id}’s analysis sheet: ${problem}`)
      const rest = { ...image }
      delete rest.figure
      return { ...rest, caption: text(image.caption, 400) ?? '', figureError: 'Not read from the project file.' }
    },
  )
  const capturedBefore = await records<unknown>(
    Object.fromEntries(Object.entries((raw.capturedBefore ?? {}) as object).filter(([id]) => known.has(id))),
    (id) => `${known.get(id) ?? id}’s before-harvest render`,
    (entry) => (isPicture((entry as { render?: unknown } | null)?.render) ? entry : 'it is not a picture'),
  )
  const engineFigures = await records<unknown>(
    raw.engineFigures,
    () => 'An engine’s figure',
    (entry) => figureProblem(entry) ?? (entry === undefined ? 'it is empty' : entry),
  )
  const pkg = (raw.package ?? {}) as { renderer?: unknown; recipeId?: unknown }
  return {
    state: {
      scene,
      views,
      shelved,
      images,
      capturedBefore,
      engineFigures,
      workspace: typeof raw.workspace === 'string' ? raw.workspace : null,
      pkg: { renderer: text(pkg.renderer, 60) ?? null, recipeId: text(pkg.recipeId, 200) ?? null },
    },
    summary: {
      savedAt: text(raw.savedAt, 40) ?? null,
      views: known.size,
      pictures: [...known.keys()].filter((id) => images[id]).length,
      dropped,
    },
  }
}

/** One line for the page after a project opens: what came back, and what did not. */
export function projectOpenedLine(name: string, summary: ProjectSummary): string {
  const views = summary.views
    ? `${summary.views} saved view${summary.views === 1 ? '' : 's'}, ${summary.pictures} with ${summary.pictures === 1 ? 'its picture' : 'their pictures'}`
    : 'no saved views'
  const left = summary.dropped.length ? ` Not read: ${summary.dropped.join('; ')}.` : ''
  return `Opened ${name}: ${views}. The run is made again when a file needs it.${left}`
}
