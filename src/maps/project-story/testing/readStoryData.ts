import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

// Folders served from bcdatamapper's own site (src/config/data-hosts.json) are
// not copied into public/data, so a test reads the submodule's copy of them.
const SUBMODULE_FOLDERS: Record<string, string> = {
  '/data/census/': 'vendor/bcdatamapper/datascrapers/census/output/',
}

/** The file a story layer's `/data/...` URL names, as a path from the repository root. */
export function storyDataPath(url: string): string {
  for (const [prefix, source] of Object.entries(SUBMODULE_FOLDERS)) {
    if (url.startsWith(prefix)) return `${source}${url.slice(prefix.length)}`
  }
  return `public${url}`
}

/** Reads and parses a story layer's JSON or gzipped JSON from disk. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readStoryData(url: string): any {
  const bytes = readFileSync(storyDataPath(url))
  return JSON.parse((url.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString())
}
