import { beforeEach, describe, expect, it, vi } from 'vitest'
const fetchJson = vi.hoisted(() => vi.fn())
vi.mock('@/lib/fetchJson', () => ({ fetchJson }))
const feature = { type: 'Feature', properties: { OBJECTID: 1, VLI_POLYGON_NO: 3 }, geometry: { type: 'Polygon', coordinates: [[[-123,53],[-122,53],[-122,54],[-123,54],[-123,53]]] } }
beforeEach(() => { vi.resetModules(); fetchJson.mockReset() })
function fixture(bad = false) {
  fetchJson.mockImplementation(async (url: string) => {
    if (url.endsWith('manifest.json')) return { schemaVersion: 2, featureCount: 2, shards: [{ file: 'units-000.geojson.gz', featureCount: 1 }, { file: 'units-001.geojson.gz', featureCount: 1 }] }
    if (url.endsWith('index.json.gz')) return [{ id: '1', bbox: [-123,53,-122,54], shard: 'units-000.geojson.gz' }, { id: '2', bbox: [-130,60,-129,61], shard: 'units-001.geojson.gz' }]
    if (url.endsWith('units-000.geojson.gz')) return { features: bad ? [] : [feature] }
    throw new Error('Should not download distant geometry')
  })
}
describe('downloaded visual inventory', () => {
  it('loads only nearby shards, shares the cache and treats an uncovered place as empty', async () => {
    fixture()
    const { queryVisualInventorySnapshot } = await import('./visualInventorySnapshot')
    expect((await queryVisualInventorySnapshot([-122.9,53.1,-122.5,53.5])).units).toHaveLength(1)
    expect((await queryVisualInventorySnapshot([-122.9,53.1,-122.5,53.5])).units).toHaveLength(1)
    expect((await queryVisualInventorySnapshot([-110,50,-109,51])).units).toEqual([])
    expect(fetchJson).toHaveBeenCalledTimes(3)
  })
  it('rejects incomplete geometry and retries a failed shard', async () => {
    fixture(true)
    const { queryVisualInventorySnapshot } = await import('./visualInventorySnapshot')
    await expect(queryVisualInventorySnapshot([-122.9,53.1,-122.5,53.5])).rejects.toThrow('Incomplete inventory shard')
    fixture()
    expect((await queryVisualInventorySnapshot([-122.9,53.1,-122.5,53.5])).units).toHaveLength(1)
  })
  it('does not apply a completed result to an aborted lookup', async () => {
    fixture()
    const { queryVisualInventorySnapshot } = await import('./visualInventorySnapshot')
    const controller = new AbortController(); controller.abort()
    await expect(queryVisualInventorySnapshot([-122.9,53.1,-122.5,53.5], controller.signal)).rejects.toThrow()
  })
})
