import { describe, expect, it } from 'vitest'
import { organicHatchRecipe } from '@pgmaps/geo-toolkit/patterns'
import { standaloneSheetSvg } from '@/lib/mapSheet/renderSvg'
import geography from './geography.generated.json'
import { pathPointLists, polygonPathRings, regionSheetOps, type RegionGeography } from './regionSheet'

/** A square island with a lake, beside an islet, in a 300 × 200 frame. */
const island: RegionGeography = {
  artboard: { width: 300, height: 200 },
  projection: { name: 'Test' },
  land: {
    d: 'M20,20 L180,20 L180,180 L20,180 Z M80,80 L120,80 L120,120 L80,120 Z M220,60 L260,60 L260,100 L220,100 Z',
  },
  bcLand: {
    d: 'M20,20 L180,20 L180,180 L20,180 Z M80,80 L120,80 L120,120 L80,120 Z M220,60 L260,60 L260,100 L220,100 Z',
  },
  coastalCoverage: { d: 'M0,0 L300,0 L300,140 L0,140 Z' },
  roads: [{ d: 'M30,170 L170,170' }],
  places: [{ id: 'harbour', name: 'Hárbour', point: [40, 160] }],
}

describe('region sheet', () => {
  it('reads polygon and line paths', () => {
    expect(polygonPathRings(island.land.d)).toHaveLength(3)
    expect(pathPointLists('M1,2 L3,4 M5 6 L7 8')).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
      [
        [5, 6],
        [7, 8],
      ],
    ])
  })

  it('clips the hatch to the region land with its lake holes, then to the coverage', () => {
    const { ops } = regionSheetOps(island, { recipe: organicHatchRecipe({ scale: 0.5 }) })
    const clips = ops.flatMap((op, i) => (op.op === 'clip' ? [i] : []))
    expect(clips).toHaveLength(2)
    const [landClip, coverageClip] = clips.map((i) => ops[i] as { parts: unknown[] })
    expect(landClip.parts).toHaveLength(3)
    expect(coverageClip.parts).toHaveLength(1)
    const firstCurve = ops.findIndex((op) => op.op === 'curves')
    expect(firstCurve).toBeGreaterThan(clips[1])
    expect(ops.filter((op) => op.op === 'restore')).toHaveLength(2)
    const all = regionSheetOps(island, { coverage: 'region' }).ops
    expect(all.filter((op) => op.op === 'clip')).toHaveLength(1)
    const svg = standaloneSheetSvg(ops, 300, 200)
    expect(svg).toContain('clip-rule="evenodd"')
    expect(svg).toContain('Hárbour')
  })

  it('draws the BC geography with the reference recipe', () => {
    const { ops, width } = regionSheetOps(geography as unknown as RegionGeography, { places: ['vancouver'] })
    expect(width).toBe(1536)
    const strokes = ops.reduce((sum, op) => sum + (op.op === 'curves' ? op.parts.length : 0), 0)
    expect(strokes).toBeGreaterThan(20_000)
    expect(ops.some((op) => op.op === 'text' && op.text === 'Vancouver')).toBe(true)
  })
})
