// The walkability worker's own code, run in Node, so a prebuilt mask is exactly
// what the worker would rasterize live; and the record of the files a mask set
// was built from. Read by scripts/build-walkability-factor-masks.mjs and by
// src/maps/pgdata/walkabilityFactorMasks.test.mjs (docs/walkability-factor-masks.md).
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const WORKER_PATH = path.join(PROJECT_ROOT, 'src/maps/pgdata/walkabilityLiveHeatmap.worker.js')
/** Where the masks are kept: bcdatamapper's walkability output, beside the grid they are built on. */
export const MASKS_SOURCE_PATH = path.join(
  PROJECT_ROOT,
  'vendor/bcdatamapper/datascrapers/walkability/output/heatmap/factor_masks.json',
)
/** Where the data sync puts them, and where the worker reads them. */
export const MASKS_PUBLIC_PATH = path.join(PROJECT_ROOT, 'public/data/walkability/heatmap/factor_masks.json')
export const EXISTING_GRID_URL = '/data/walkability/heatmap/citywide_mi_grid.json'
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public')

export const CONFIG_KEYS = [
  'drop_gtfs_hf',
  'narrow_civic',
  'narrow_growth',
  'drop_pop_age',
  'drop_f0',
  'drop_c0',
  'drop_f8',
  'drop_supp_poi',
]

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** The file under public/ a root-relative data URL names. */
export function publicFilePath(url) {
  const pathname = new URL(url, 'http://localhost').pathname
  const filePath = path.resolve(PUBLIC_DIR, pathname.replace(/^\/+/, ''))
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new Error(`Refusing to read outside public/: ${url}`)
  return filePath
}

/**
 * A fetch over public/ that records each file it read and that file's SHA-256,
 * keyed by the URL the worker asked for.
 */
export function recordingPublicFetch() {
  const reads = new Map()
  async function fetch(url) {
    try {
      const bytes = await readFile(publicFilePath(url))
      reads.set(new URL(url, 'http://localhost').pathname, sha256(bytes))
      const body = bytes.toString('utf8')
      return { ok: true, status: 200, json: async () => JSON.parse(body) }
    } catch (error) {
      return {
        ok: false,
        status: error?.code === 'ENOENT' ? 404 : 500,
        json: async () => {
          throw error
        },
      }
    }
  }
  return { fetch, reads }
}

/**
 * The worker's functions, loaded as a script. Its one import is `withBase`,
 * which only matters in a browser: here every URL is read from public/.
 */
export async function loadWorkerApi({ fetch = recordingPublicFetch().fetch, log = () => {} } = {}) {
  const source = await readFile(WORKER_PATH, 'utf8')
  const withBaseImport = /^import \{ withBase \} from '\.\.\/\.\.\/lib\/dataUrl'\s*$/m
  if (!withBaseImport.test(source)) throw new Error(`${WORKER_PATH} no longer imports withBase as expected`)
  const script = source.replace(withBaseImport, 'const withBase = (url) => url')
  if (/^\s*(import|export)\s/m.test(script)) {
    throw new Error(`${WORKER_PATH} has an import or export this loader does not handle`)
  }
  let lastProgress = ''
  const context = {
    console,
    fetch,
    postMessage(message) {
      if (message?.type !== 'progress' || message.progress === lastProgress) return
      lastProgress = message.progress
      log(message.progress)
    },
    self: {},
    setTimeout,
    clearTimeout,
    atob: (base64) => Buffer.from(base64, 'base64').toString('binary'),
  }
  vm.createContext(context)
  vm.runInContext(
    `${script}
globalThis.__walkabilityMaskApi = {
  FACTORS,
  LAYERS,
  CELL_M,
  NODATA,
  applyVariant,
  activeSourceFeatures,
  assignPopDensityQuintiles,
  componentMaskKey,
  fetchJson,
  factorMask,
  readArcgisProjectedBounds,
  readLayer,
}`,
    context,
    { filename: WORKER_PATH },
  )
  return context.__walkabilityMaskApi
}

export function configForMask(mask) {
  return Object.fromEntries(CONFIG_KEYS.map((key, index) => [key, Boolean(mask & (1 << index))]))
}

/** Every component mask any option combination can ask for, by the key the worker looks it up by. */
export function collectRequiredMaskSpecs(api) {
  const specsByKey = new Map()
  for (let mask = 0; mask < 1 << CONFIG_KEYS.length; mask += 1) {
    for (const factor of api.applyVariant(api.FACTORS, configForMask(mask))) {
      if (factor.mode === 'proximity') {
        for (const [distance, score] of factor.scores) {
          if (!score) continue
          specsByKey.set(api.componentMaskKey(factor, distance), { factor, distanceM: distance })
        }
      } else {
        specsByKey.set(api.componentMaskKey(factor, 20), { factor, distanceM: 20 })
        specsByKey.set(api.componentMaskKey(factor, 10), { factor, distanceM: 10 })
      }
    }
  }
  return [...specsByKey.entries()].sort(([left], [right]) => left.localeCompare(right))
}
