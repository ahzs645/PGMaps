import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESCRIPTION, applyPrescription } from './prescription'
import { standFileSummary, standTreeCsv, standTreeGeoJson } from './standExport'
import { buildStand } from './standTrees'

const BLOCK: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.8, 53.9],
      [-122.799, 53.9],
      [-122.799, 53.9008],
      [-122.8, 53.9008],
      [-122.8, 53.9],
    ],
  ],
}

describe('prescribed tree files', () => {
  const stand = buildStand({ geometry: BLOCK, stands: [], clearings: [], inventory: [], anchorLatitude: 53.9 }).stand!
  const prescription = {
    ...DEFAULT_PRESCRIPTION,
    outcome: 'felled' as const,
    target: { kind: 'stemShare' as const, value: 60 },
  }
  const result = applyPrescription(stand, prescription)
  const files = [{ blockName: 'Block "A", north', stand, result, prescription }]

  it('writes one row per tree, the same tree standing before and cut or standing after', () => {
    const lines = standTreeCsv(files).trim().split('\n')
    expect(lines[0]).toBe(
      'block,tree_id,longitude,latitude,species,dbh_cm,height_m,crown_width_m,expansion,before,after,why_kept,left_as,felling_bearing_deg,clump_size_after,snag_falls_after_years',
    )
    expect(lines.length - 1).toBe(stand.trees.length)
    // Commas and quotes in a name are quoted.
    expect(lines[1].startsWith('"Block ""A"", north",')).toBe(true)
    const cut = lines.slice(1).filter((line) => line.includes(',standing,cut,'))
    expect(cut.length).toBe(result.removed.reduce((sum, flag) => sum + flag, 0))
    expect(cut.every((line) => line.includes('felled, crown left'))).toBe(true)
  })

  it('writes the same rows as GeoJSON points and sums them up per block', () => {
    const collection = JSON.parse(standTreeGeoJson(files))
    expect(collection.features).toHaveLength(stand.trees.length)
    expect(collection.features[0].geometry.type).toBe('Point')
    expect(standFileSummary(files)[0].value).toMatch(/trees: \d+ standing after harvest, \d+ cut/)
  })
})
