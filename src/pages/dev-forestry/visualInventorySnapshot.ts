import { fetchJson } from '@/lib/fetchJson'
import { parseSensitivityUnits, type BcSensitivityUnit, type Bounds, type InventoryQueryResult } from './bcVisualInventory'
import { polygonBounds } from './visibility'

const ROOT = '/data/forest/visual-inventory/'
export const VISUAL_INVENTORY_PATH = ROOT + 'manifest.json'
export type VisualInventoryManifest = { schemaVersion: number; retrievedAt: string; featureCount: number; sourceLatestUpdate: number; gzipBytes: number; source: string; simplification: { toleranceMetres: number }; shards: Array<{ file: string; featureCount: number }> }
type Snapshot = { units: BcSensitivityUnit[]; manifest: VisualInventoryManifest }
type IndexRow = { id: string; bbox: Bounds; shard: string }
let indexPromise: Promise<{ manifest: VisualInventoryManifest; index: IndexRow[] }> | null = null
const shards = new Map<string, Promise<BcSensitivityUnit[]>>()
const intersects = (a: Bounds, b: Bounds) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]

/** One shared static download. A failed request can be retried; cancelled UI
 * consumers do not abort the shared request underneath other consumers. */
export async function loadVisualInventorySnapshot(bounds: Bounds): Promise<Snapshot> {
  if (!indexPromise) indexPromise = (async () => {
    const [manifest, index] = await Promise.all([
      fetchJson<VisualInventoryManifest>(ROOT + 'manifest.json', AbortSignal.timeout(30000)),
      fetchJson<IndexRow[]>(ROOT + 'index.json.gz', AbortSignal.timeout(30000)),
    ])
    if (manifest.schemaVersion !== 2 || !Array.isArray(index) || index.length !== manifest.featureCount || new Set(index.map(r => r.id)).size !== index.length) throw new Error('The inventory index is incomplete. Rebuild its snapshot.')
    return { manifest, index }
  })().catch(error => { indexPromise = null; throw error })
  const { manifest, index } = await indexPromise
  const matches = index.filter(row => intersects(row.bbox, bounds))
  const files = [...new Set(matches.map(row => row.shard))]
  const selected = new Set(matches.map(row => row.id))
  const units: BcSensitivityUnit[] = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
    while (next < files.length) {
      const file = files[next++]
      const descriptor = manifest.shards.find(shard => shard.file === file)
      if (!descriptor || !/^units-\d+\.geojson\.gz$/.test(file)) throw new Error('Invalid inventory shard index')
      let request = shards.get(file)
      if (!request) {
        request = fetchJson<unknown>(ROOT + file, AbortSignal.timeout(60000)).then(collection => {
          const parsed = parseSensitivityUnits(collection)
          if (parsed.length !== descriptor.featureCount) throw new Error('Incomplete inventory shard')
          return parsed
        }).catch(error => { shards.delete(file); throw error })
        shards.set(file, request)
        if (shards.size > 8) shards.delete(shards.keys().next().value!)
      }
      units.push(...(await request).filter(unit => selected.has(unit.id)))
    }
  }))
  if (new Set(units.map(unit => unit.id)).size !== matches.length || units.length !== matches.length) throw new Error('The inventory geometry does not match its index')
  return { units, manifest }
}

export async function queryVisualInventorySnapshot(bounds: Bounds, signal?: AbortSignal): Promise<InventoryQueryResult> {
  const { units } = await loadVisualInventorySnapshot(bounds)
  signal?.throwIfAborted()
  return { units: units.filter(unit => {
    const b = polygonBounds(unit.geometry)
    return b[0] <= bounds[2] && b[2] >= bounds[0] && b[1] <= bounds[3] && b[3] >= bounds[1]
  }), truncated: false }
}
