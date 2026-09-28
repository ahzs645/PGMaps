import { readFileSync, readdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { normalizeProjectPackage } from '@/lib/projectPackages'
import { getProjectCollection } from '@/lib/projectCollections'

const examples = readdirSync('public/data/projects/example')
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`public/data/projects/example/${f}`, 'utf8')))
describe('story interaction examples', () => {
  it('registers twelve distinct examples with resolvable scene links and source-backed highlights', () => {
    expect(examples).toHaveLength(12)
    expect([...getProjectCollection('example')!.projectSlugs].sort()).toEqual(examples.map((p) => p.slug).sort())
    for (const raw of examples) {
      const pkg = normalizeProjectPackage(raw)!
      expect(pkg.scenes).toHaveLength(raw.scenes.length)
      for (const scene of pkg.scenes) {
        for (const item of scene.interaction?.items ?? [])
          expect(pkg.scenes.filter((s) => s.label === item.sceneLabel)).toHaveLength(1)
        for (const highlight of scene.highlights ?? []) {
          const layer = raw.workspace.layers.find((l: { id: string }) => l.id === highlight.layerId)
          const bytes = readFileSync(`public${layer.data}`)
          const data = JSON.parse((layer.data.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString())
          for (const value of highlight.values)
            expect(
              data.features.some(
                (f: { properties: Record<string, unknown> }) => String(f.properties[highlight.property]) === value,
              ),
            ).toBe(true)
        }
      }
    }
  })
  it('uses identical geographic content across editorial presentations', () => {
    const editorial = examples.filter((pkg) => pkg.slug.startsWith('example-sidecar-'))
    expect(editorial).toHaveLength(4)
    const content = (pkg: (typeof examples)[number]) => ({
      layers: pkg.workspace.layers,
      places: pkg.workspace.places,
      scenes: pkg.scenes.map((scene: Record<string, unknown>) => {
        const copy = { ...scene }
        delete copy.presentation
        return copy
      }),
    })
    for (const pkg of editorial.slice(1)) expect(content(pkg)).toEqual(content(editorial[0]))
  })
  it('retains malformed-field protection and rejects invalid shares', () => {
    const raw = structuredClone(examples[0])
    raw.scenes[0].interaction = {
      type: 'bars',
      title: 'Shares',
      items: [
        null,
        { label: 'Bad', sceneLabel: 'X', share: -1 },
        { label: 'Bad', sceneLabel: 'X', share: 1.01 },
        { label: 'Missing', sceneLabel: 'X' },
        { label: 'Zero', sceneLabel: 'X', share: 0 },
      ],
    }
    expect(normalizeProjectPackage(raw)!.scenes[0].interaction?.items).toHaveLength(1)
    raw.scenes[0].interaction.type = 'unknown'
    expect(normalizeProjectPackage(raw)!.scenes[0].interaction).toBeUndefined()
  })
  it('keeps displayed shares tied to the correct census denominator', () => {
    const source = JSON.parse(
      gunzipSync(readFileSync('public/data/boundaries/GeographyBridge/relationships.json.gz')).toString(),
    ).records
    const rows = source
      .filter(
        (r: Record<string, unknown>) =>
          r.censusLevel === 'economicRegionCode' && r.censusCode === '5950' && r.healthLevel === 'healthAuthorityCode',
      )
      .sort((a: { population: number }, b: { population: number }) => b.population - a.population)
    const bars = normalizeProjectPackage(examples.find((p) => p.slug === 'example-relationships'))!.scenes[0]
      .interaction!
    expect(bars.items.map((i) => i.share)).toEqual(
      rows.map((r: { populationShareOfCensus: number }) => r.populationShareOfCensus),
    )
    expect(bars.items.reduce((sum, item) => sum + item.share!, 0)).toBeCloseTo(1)
  })
})
