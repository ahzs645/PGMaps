import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { normalizeProjectPackage } from '@/lib/projectPackages'

const raw = JSON.parse(readFileSync('public/data/projects/bc-connected-geographies.json', 'utf8'))
const pkg = normalizeProjectPackage(raw)!
function readData(url: string) {
  const bytes = readFileSync(`public${url}`)
  return JSON.parse((url.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString())
}

describe('connected geographies story', () => {
  it('preserves the six scenes and every authored layer', () => {
    expect(pkg.workspace?.type).toBe('story-map')
    expect(pkg.scenes).toHaveLength(6)
    if (pkg.workspace?.type !== 'story-map') throw new Error('Missing workspace')
    expect(pkg.workspace.layers.map(l => l.id)).toEqual(raw.workspace.layers.map((l: { id: string }) => l.id))
    expect(new Set(pkg.layers.map(l => l.id))).toEqual(new Set(pkg.workspace.layers.map(l => l.id)))
  })

  it('resolves highlights and attribute profiles against deployed snapshots', () => {
    if (pkg.workspace?.type !== 'story-map') throw new Error('Missing workspace')
    const layers = new Map(pkg.workspace.layers.map(l => [l.id, l]))
    for (const scene of pkg.scenes) {
      for (const id of scene.visibleLayerIds) expect(layers.has(id)).toBe(true)
      for (const h of scene.highlights ?? []) {
        expect(scene.visibleLayerIds).toContain(h.layerId)
        const features = readData(layers.get(h.layerId)!.data).features
        for (const value of h.values) expect(features.some((f: GeoJSON.Feature) => String(f.properties?.[h.property]) === String(value))).toBe(true)
      }
    }
    const economic = layers.get('economic-regions')!
    const join = economic.attributes!
    const profiles = readData(join.data).records
    expect(profiles).toHaveLength(8)
    for (const f of readData(economic.data).features) {
      const match = profiles.find((r: Record<string, unknown>) => r[join.attributeProperty] === f.properties[join.boundaryProperty])
      expect(match?.profile).toBeTruthy()
    }
    const manifest = readData('/data/boundaries/GeographyBridge/manifest.json')
    expect(manifest.counts.unresolvedHealthBlocks).toBe(533)
    expect(profiles.reduce((sum: number, r: { unresolvedDbCount: number }) => sum + r.unresolvedDbCount, 0)).toBe(533)
    expect(pkg.scenes[4].callout?.value).toBe('533 blocks')
  })
})
