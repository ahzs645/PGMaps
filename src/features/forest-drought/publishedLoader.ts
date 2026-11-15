/**
 * Loads the pinned forDRAT table for any page: fetched through `withBase`, checked against its
 * pinned SHA-256 and parsed by `parsePublishedCsv`. A mismatch withholds every rating. PGMaps'
 * own code, not part of the fork snapshot (`scripts/forest-drought/forks.lock.json`).
 */
import { withBase } from '@/lib/dataUrl'
import { PUBLISHED_SOURCE, parsePublishedCsv, type PublishedDataset } from './published'

// The source revision is in the URL so an older cached CSV cannot shadow a newly pinned one.
export const publishedCsvUrl = () => `${withBase(PUBLISHED_SOURCE.csvPath)}?v=${PUBLISHED_SOURCE.sha256}`

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error('Checking the published data requires a secure browser context. Use HTTPS or localhost.')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

/** The verified, parsed table, or an error that says why the ratings are withheld. */
export async function loadPublishedDataset(signal?: AbortSignal): Promise<PublishedDataset> {
  const url = publishedCsvUrl()
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Published data could not load (HTTP ${response.status}).`)
  const bytes = await response.arrayBuffer()
  if ((await sha256Hex(bytes)) !== PUBLISHED_SOURCE.sha256) {
    // The service worker caches any 200 response for this URL. Drop a corrupt copy so the
    // retry fetches the network instead of waiting for background revalidation.
    await globalThis.caches
      ?.open('pgmaps-data-v1')
      .then((cache) => cache.delete(url))
      .catch(() => undefined)
    throw new Error(
      'The published table does not match its pinned source checksum. Results have been withheld; reload or report this data-version mismatch.',
    )
  }
  return parsePublishedCsv(new TextDecoder().decode(bytes))
}
