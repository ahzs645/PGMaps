import { httpsURL, parseGeoreferenceProjectReference, type RasterRecord } from '../dev-view/catalogue'
import { GeoreferenceValidationError, parseProject, type GeoreferenceProject } from './model'

export const MAX_PUBLISHED_PROJECT_BYTES = 1_000_000

class PublishedProjectError extends Error {}

function fail(message: string): never {
  throw new PublishedProjectError(message)
}

function requirePublicURL(value: unknown, label: string): void {
  try {
    if (typeof value !== 'string' || !value.trim()) throw Error('Missing URL')
    httpsURL(value)
  } catch {
    fail(`${label} must use a public HTTPS URL without credentials.`)
  }
}

async function downloadProject(url: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
  } catch {
    signal.throwIfAborted()
    return fail('The saved alignment project could not be downloaded. Please retry.')
  }
  if (!response.ok) return fail(`The saved alignment project returned HTTP ${response.status}.`)
  requirePublicURL(response.url, 'The saved alignment project response')
  if (Number(response.headers.get('Content-Length')) > MAX_PUBLISHED_PROJECT_BYTES) {
    await response.body?.cancel()
    return fail('The saved alignment project exceeds the 1 MB limit.')
  }
  const reader = response.body?.getReader()
  if (!reader) return fail('The saved alignment project did not return a readable file.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PUBLISHED_PROJECT_BYTES) {
        await reader.cancel()
        return fail('The saved alignment project exceeds the 1 MB limit.')
      }
      chunks.push(value)
    }
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof PublishedProjectError) throw error
    return fail('The saved alignment project download was interrupted. Please retry.')
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Verifies the project and map revision before the caller downloads any original source pixels. */
export async function loadPublishedProject(
  record: RasterRecord,
  signal: AbortSignal,
): Promise<GeoreferenceProject | null> {
  const reference = parseGeoreferenceProjectReference(record.georeferenceProject)
  if (!reference) return null
  if (!record.downloads.some((download) => download.sha256?.toLowerCase() === reference.nativeSha256)) {
    return fail('The saved alignment project belongs to a different native map revision. Reload the catalogue.')
  }
  const bytes = await downloadProject(reference.url, signal)
  signal.throwIfAborted()
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer)
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (sha256 !== reference.sha256) {
    return fail('The saved alignment project checksum does not match the catalogue. Reload it before editing.')
  }
  let project: GeoreferenceProject
  try {
    project = parseProject(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    const reason =
      error instanceof GeoreferenceValidationError
        ? error.message.replace(/https?:\/\/\S+/gi, '[URL]')
        : 'The file must contain valid UTF-8 JSON.'
    return fail(`The saved alignment project is invalid. ${reason}`)
  }
  if (project.source.id !== record.id) return fail('The saved alignment project belongs to a different map.')
  if (project.source.sha256 !== reference.sourceSha256) {
    return fail('The saved alignment project source checksum does not match its published original.')
  }
  requirePublicURL(project.source.url, 'The saved alignment project source')
  if (project.source.geotiff) requirePublicURL(project.source.geotiff.url, 'The saved alignment project GeoTIFF')
  for (const evidence of project.recoveredPlacement?.evidence ?? []) {
    if (evidence.url) requirePublicURL(evidence.url, 'The saved alignment project evidence')
  }
  signal.throwIfAborted()
  return project
}
