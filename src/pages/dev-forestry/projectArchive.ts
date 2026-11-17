/** The portable project: project.json plus ordinary files for photographs, captures and supporting evidence. */
import { unzip, zip, type Unzipped, type Zippable } from 'fflate'
import type { OwnPose } from './exifPose'
import {
  fromBase64,
  MAX_PROJECT_FILE_BYTES,
  packProject,
  parseProject,
  readProject,
  toBase64,
  type ProjectState,
} from './projectFile'

export type ProjectAttachment = { name: string; blob: Blob }
export type ProjectPhoto = ProjectAttachment & { pose: OwnPose; recordId: string | null }
export type ProjectMedia = { title: string | null; attachments: ProjectAttachment[]; photo: ProjectPhoto | null }
export const emptyProjectMedia = (): ProjectMedia => ({ title: null, attachments: [], photo: null })

const MANIFEST = 'archive.json'
const PROJECT = 'project.json'
const MAX_ARCHIVE_ENTRIES = 4096
const MAX_PHOTO_BYTES = 25 * 1024 * 1024
const imageType = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
const imageExtension = (type: string) => (type === 'image/jpeg' ? 'jpg' : type.slice('image/'.length))
const imageTypes: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export function projectAttachmentName(name: string) {
  return (
    Array.from(name.replace(/[<>:"/\\|?*]/g, '-'), (char) => (char.charCodeAt(0) < 32 ? '-' : char))
      .join('')
      .trim()
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 200) || 'attachment'
  )
}

function checkBytes(total: number) {
  if (total > MAX_PROJECT_FILE_BYTES)
    throw new Error(`The project exceeds the ${MAX_PROJECT_FILE_BYTES / 1024 / 1024} MB size limit.`)
}

function zipAsync(entries: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => zip(entries, (error, bytes) => (error ? reject(error) : resolve(bytes))))
}

function unzipAsync(bytes: Uint8Array): Promise<Unzipped> {
  const sizes = new Map<string, number>()
  let total = 0
  return new Promise((resolve, reject) =>
    unzip(
      bytes,
      {
        filter: ({ name, originalSize }) => {
          if (sizes.size >= MAX_ARCHIVE_ENTRIES || sizes.has(name) || !safePath(name))
            throw new Error('The project ZIP contains invalid, duplicate or too many file paths.')
          sizes.set(name, originalSize)
          checkBytes((total += originalSize))
          return true
        },
      },
      (error, entries) => {
        if (error) return reject(error)
        for (const [name, bytes] of Object.entries(entries)) {
          if (bytes.byteLength !== sizes.get(name)) return reject(new Error(`Invalid ZIP entry: ${name}.`))
        }
        resolve(entries)
      },
    ),
  )
}

function safePath(path: string) {
  return (
    path.length <= 700 &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    path.split('/').every((part) => part && part !== '..' && part !== '.' && part !== '__proto__')
  )
}

/** Apply a wire-format transformation only to the project sections that can carry image data. */
function mapImages(value: unknown, transform: (entry: unknown) => unknown): unknown {
  const mapped = transform(value)
  if (mapped !== value || !value || typeof value !== 'object') return mapped
  if (Array.isArray(value)) return value.map((entry) => mapImages(entry, transform))
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapImages(entry, transform)]))
}

type ArchiveManifest = {
  format: 'pgmaps-visual-quality-zip'
  version: 1
  title: string | null
  attachments: Array<{ name: string; path: string }>
  photo: { name: string; path: string; pose: OwnPose; recordId: string | null } | null
}

export async function writeProjectArchive(
  state: ProjectState,
  media: ProjectMedia,
  savedAt = new Date(),
): Promise<Blob> {
  const project = await packProject(state, savedAt)
  const entries: Zippable = {}
  let total = 0
  let count = 0
  const put = (path: string, bytes: Uint8Array, level: 0 | 6 = 0) => {
    checkBytes((total += bytes.byteLength))
    if (++count > MAX_ARCHIVE_ENTRIES) throw new Error('The project contains too many files.')
    entries[path] = [bytes, { level }]
  }
  const byImage = new Map<string, string>()
  const extract = (value: unknown, folder: string) =>
    mapImages(value, (entry) => {
      if (typeof entry !== 'string' || !entry.startsWith('data:image/')) return entry
      const image = imageType.exec(entry)
      if (!image) return entry
      let path = byImage.get(entry)
      if (!path) {
        path = `${folder}/${byImage.size + 1}.${imageExtension(image[1])}`
        put(path, fromBase64(image[2]))
        byImage.set(entry, path)
      }
      return { $projectImage: path }
    })
  const workspace = project.workspace === null ? null : JSON.parse(project.workspace)
  if (workspace?.fields) workspace.fields = extract(workspace.fields, 'photos/field')
  const doc = {
    ...project,
    workspace,
    images: extract(project.images, 'captures/views'),
    capturedBefore: extract(project.capturedBefore, 'captures/before'),
    engineFigures: extract(project.engineFigures, 'captures/engines'),
  }

  const manifest: ArchiveManifest = {
    format: 'pgmaps-visual-quality-zip',
    version: 1,
    title: media.title,
    attachments: [],
    photo: null,
  }
  const attachmentPaths = new Map<Blob, string>()
  for (const [index, file] of media.attachments.entries()) {
    const name = projectAttachmentName(file.name)
    const path = `attachments/${index + 1}/${name}`
    checkBytes(total + file.blob.size)
    put(path, new Uint8Array(await file.blob.arrayBuffer()), /\.(txt|md|csv|json|geojson)$/i.test(name) ? 6 : 0)
    attachmentPaths.set(file.blob, path)
    manifest.attachments.push({ name, path })
  }
  if (media.photo) {
    const { name, pose, recordId, blob } = media.photo
    if (blob.size > MAX_PHOTO_BYTES) throw new Error('The open field photo exceeds 25 MB.')
    const attached = attachmentPaths.get(blob)
    const path = attached ?? 'photos/open/' + projectAttachmentName(name)
    if (!attached) {
      checkBytes(total + blob.size)
      put(path, new Uint8Array(await blob.arrayBuffer()))
    }
    manifest.photo = { name: projectAttachmentName(name), path, pose, recordId }
  }
  const encoder = new TextEncoder()
  put(PROJECT, encoder.encode(JSON.stringify(doc)), 6)
  put(MANIFEST, encoder.encode(JSON.stringify(manifest)), 6)
  const bytes = await zipAsync(entries)
  checkBytes(bytes.byteLength)
  return new Blob([bytes as BlobPart], { type: 'application/zip' })
}

async function readArchive(file: Blob) {
  checkBytes(file.size)
  const entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()))
  const entry = (path: string) => {
    if (typeof path !== 'string' || !safePath(path) || !Object.prototype.hasOwnProperty.call(entries, path))
      throw new Error(`The project ZIP is missing a file: ${path}.`)
    return entries[path]
  }
  if (!entries[MANIFEST] || !entries[PROJECT]) throw new Error('This ZIP is missing the PGMaps project files.')
  const decoder = new TextDecoder()
  const manifest = JSON.parse(decoder.decode(entry(MANIFEST))) as ArchiveManifest | null
  if (
    manifest?.format !== 'pgmaps-visual-quality-zip' ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.attachments)
  )
    throw new Error('This version of the PGMaps project ZIP could not be read.')
  return { manifest, entry, paths: Object.keys(entries) }
}

export async function openProjectArchive(file: Blob) {
  checkBytes(file.size)
  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  if (signature[0] !== 0x50 || signature[1] !== 0x4b)
    return { ...(await parseProject(await file.text())), media: emptyProjectMedia() }

  const { manifest, entry } = await readArchive(file)
  const doc = JSON.parse(new TextDecoder().decode(entry(PROJECT))) as Record<string, unknown>
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('The project JSON could not be read.')
  const restored = new Map<string, string>()
  let restoredBytes = 0
  const restore = (value: unknown) =>
    mapImages(value, (item) => {
      if (!item || typeof item !== 'object' || !('$projectImage' in item)) return item
      const path = item.$projectImage
      if (
        typeof path !== 'string' ||
        !/^(photos\/field|captures\/(views|before|engines))\/\d+\.(jpg|png|webp)$/.test(path)
      )
        throw new Error('The project contains an invalid image reference.')
      const known = restored.get(path)
      if (known) return known
      const bytes = entry(path)
      checkBytes((restoredBytes += bytes.byteLength))
      const url = `data:${imageTypes[path.split('.').pop()!]};base64,${toBase64(bytes)}`
      restored.set(path, url)
      return url
    })
  const project = await readProject({
    ...doc,
    workspace:
      doc.workspace && typeof doc.workspace === 'object'
        ? JSON.stringify({
            ...doc.workspace,
            ...('fields' in doc.workspace ? { fields: restore(doc.workspace.fields) } : {}),
          })
        : null,
    images: restore(doc.images),
    capturedBefore: restore(doc.capturedBefore),
    engineFigures: restore(doc.engineFigures),
  })

  const blobs = new Map<string, Blob>()
  const attachment = (asset: { path: string; name: string }, folders: string[]): ProjectAttachment => {
    if (
      typeof asset?.name !== 'string' ||
      typeof asset.path !== 'string' ||
      !folders.some((folder) => asset.path.startsWith(folder))
    )
      throw new Error('The project contains an invalid attachment reference.')
    const blob = blobs.get(asset.path) ?? new Blob([entry(asset.path) as BlobPart])
    blobs.set(asset.path, blob)
    return { name: projectAttachmentName(asset.name), blob }
  }
  const attachments = manifest.attachments.map((asset) => attachment(asset, ['attachments/']))
  let photo: ProjectPhoto | null = null
  if (manifest.photo) {
    const asset = attachment(manifest.photo, ['photos/open/', 'attachments/'])
    const { pose, recordId } = manifest.photo
    if (asset.blob.size > MAX_PHOTO_BYTES || !validPose(pose))
      throw new Error('The project contains an invalid field photo or camera.')
    photo = { ...asset, pose, recordId: typeof recordId === 'string' ? recordId.slice(0, 200) : null }
  }
  return {
    ...project,
    media: { title: typeof manifest.title === 'string' ? manifest.title.slice(0, 200) : null, attachments, photo },
  }
}

function validPose(pose: OwnPose | null): pose is OwnPose {
  return (
    !!pose &&
    [pose.bearing, pose.pitch, pose.roll, pose.hfov, pose.eyeHeightMeters].every(Number.isFinite) &&
    (pose.lng === null || (Number.isFinite(pose.lng) && Math.abs(pose.lng) <= 180)) &&
    (pose.lat === null || (Number.isFinite(pose.lat) && Math.abs(pose.lat) <= 85)) &&
    (pose.altitudeMeters == null || Number.isFinite(pose.altitudeMeters)) &&
    pose.hfov > 0 &&
    pose.hfov < 180
  )
}

export async function projectArchiveFileList(file: Blob): Promise<string> {
  const { paths } = await readArchive(file)
  return paths.join('\n')
}
