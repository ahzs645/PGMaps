import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkVolumeExample, recoveredExampleVolume, volumeExampleColour, type VolumeExample } from './example'
const data: VolumeExample = JSON.parse(readFileSync(new URL('./example.generated.json', import.meta.url), 'utf8'))
describe('completed, field-backed volume example', () => {
  it('keeps the Québec dataset separate and preserves native spatial support and exclusions', () => {
    expect(checkVolumeExample(data)).toBe(data)
    expect(data.source.note).toContain('169 matched')
    expect(data.map.centre[0]).toBeCloseTo(-71.171278, 5)
    expect(data.map.crs).toBe(2949)
    const { nodata, nonforest, outside_domain, negative } = data.map.exclusions
    expect(nodata + nonforest + data.map.cells.features.length).toBe(10000)
    expect(outside_domain + negative + data.map.supported_cells).toBe(data.map.cells.features.length)
    expect(data.map.supported_cells).toBe(7639)
    expect(data.map.cells.features.filter((f) => f.properties.volume_m3_ha === null)).toHaveLength(1434)
    for (const f of data.map.cells.features) {
      expect(f.geometry.coordinates[0]).toHaveLength(5)
      expect(f.geometry.coordinates[0][0]).toEqual(f.geometry.coordinates[0][4])
    }
    expect(() => checkVolumeExample({ ...data, map: { ...data.map, cell_area_ha: 0.25 } })).toThrow('support mismatch')
  })
  it('recomputes spatial validation error from the actual held-out predictions and verifies fold coverage', () => {
    const refs = data.references.features.map((f) => f.properties)
    expect(refs).toHaveLength(169)
    const allIds = data.model.diagnostics.folds.flatMap((f) => f.test_ids)
    expect(new Set(allIds).size).toBe(refs.length)
    expect(allIds.length).toBe(refs.length)
    for (const fold of data.model.diagnostics.folds) {
      expect(fold.train_n + fold.test_n).toBe(refs.length)
      expect(
        refs
          .filter((r) => r.fold === fold.fold)
          .map((r) => r.id)
          .sort(),
      ).toEqual([...fold.test_ids].sort())
    }
    const errors = refs.map((r) => r.cv_m3_ha - r.observed_m3_ha)
    const rmse = Math.sqrt(errors.reduce((s, v) => s + v ** 2, 0) / refs.length)
    expect(rmse).toBeCloseTo(data.model.diagnostics.rmse_m3_ha, 8)
    expect(rmse).toBeCloseTo(53.8389492, 5)
    expect(errors.reduce((s, v) => s + v, 0) / refs.length).toBeCloseTo(-0.7612619, 5)
  })
  it('sums m³/ha over 0.04 ha cells and applies only explicit scenario assumptions', () => {
    const total = data.map.cells.features.reduce((sum, f) => sum + (f.properties.volume_m3_ha ?? 0) * 0.04, 0)
    expect(total).toBeCloseTo(35272.22, 2)
    expect(data.map.supported_area_ha).toBe(305.56)
    expect(recoveredExampleVolume(total, 20, 90)).toBeCloseTo(total * 0.72, 6)
    expect(recoveredExampleVolume(total, 100, 90)).toBe(0)
    expect(() => recoveredExampleVolume(total, -1, 90)).toThrow()
    expect(volumeExampleColour(null)).toBe('#94a3b8')
    expect(volumeExampleColour(250)).toBe(volumeExampleColour(17, 'height'))
  })
})
