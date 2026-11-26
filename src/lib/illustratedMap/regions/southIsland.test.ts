import { describe, expect, it } from 'vitest'
import { ORGANIC_HATCH_PRESETS } from '@pgmaps/geo-toolkit/patterns'
import { regionSheetOps, polygonPathRings, type RegionGeography } from '../regionSheet'
import southIsland from './south-island.generated.json'

describe('a real region outside BC: Te Waipounamu / South Island (Natural Earth)', () => {
  it('was built in its own projection with its lakes as holes and its checkpoints passed', () => {
    expect(southIsland.projection.epsg).toBe(2193)
    expect(southIsland.region.name).toBe('Te Waipounamu / South Island')
    // Te Anau, Wakatipu, Pukaki and the other lakes are holes in the region's land.
    expect(southIsland.bcLand.holes).toBeGreaterThanOrEqual(15)
    // Stewart Island and the other islands are their own land polygons.
    expect(southIsland.bcLand.polygons).toBeGreaterThan(10)
    const water = southIsland.checkpoints.filter((checkpoint) => !checkpoint.land).map((checkpoint) => checkpoint.id)
    expect(water).toEqual(expect.arrayContaining(['lake-te-anau-water', 'lake-wakatipu-water', 'lake-pukaki-water']))
    expect(southIsland.provenance.land).toMatchObject({ publisher: 'Natural Earth', licence: 'Public domain' })
    expect(polygonPathRings(southIsland.bcLand.d)).toHaveLength(southIsland.bcLand.polygons + southIsland.bcLand.holes)
  })

  it('composes with the page 8 recipe like BC, the hatch clipped to land and coverage', () => {
    const { ops, width, height } = regionSheetOps(southIsland as unknown as RegionGeography, {
      recipe: ORGANIC_HATCH_PRESETS['page-8-reference'].recipe,
    })
    expect([width, height]).toEqual([1100, 1300])
    expect(ops.filter((op) => op.op === 'clip')).toHaveLength(2)
    expect(ops.reduce((sum, op) => sum + (op.op === 'curves' ? op.parts.length : 0), 0)).toBeGreaterThan(20_000)
    expect(ops.some((op) => op.op === 'text' && op.text === 'Queenstown')).toBe(true)
  })
})
