import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { boxDiagnostics, rgbFeatures, validateComparisonData, type ComparisonData } from './data'
import { sameCamera } from './ComparisonMap'
import { COMPARISON_MODELS } from './registry'
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const data: ComparisonData = {
  benchmark: read('../treeBenchmarks.generated.json'),
  rgb: read('./rgb.generated.json'),
  shapes: read('./shapes.generated.json'),
  provenance: read('./provenance.generated.json'),
}
describe('executed model comparison data', () => {
  it('verifies source alignment and all original shape returns', () => {
    expect(() => validateComparisonData(data, data.provenance.source_sha256)).not.toThrow()
    expect(data.shapes.crops.reduce((n, c) => n + c.points.length, 0)).toBe(7109)
    expect(() => validateComparisonData(data, 'another tile')).toThrow('different LiDAR tile')
    const changed = structuredClone(data)
    changed.rgb.samples[0].georeference_pixels_verified = false
    expect(() => validateComparisonData(changed, data.provenance.source_sha256)).toThrow('georeference')
  })
  it('reproduces all four Python box-matching runs at the saved thresholds', () => {
    for (const sample of data.rgb.samples)
      for (const [id, run] of Object.entries(sample.models)) {
        const reference = read(`../../../../docs/research/hf-tree-model-tests/${id}-${sample.id}.json`)
        for (const expected of reference.metrics) {
          const actual = boxDiagnostics(run.predictions, sample.truth, expected.score_threshold)
          expect(actual.predictions).toBe(expected.predictions)
          expect(actual.matched).toBe(expected.true_positives)
          expect(actual.falsePositives).toBe(expected.false_positives)
          expect(actual.missed).toBe(expected.missed)
          expect(actual.precision).toBeCloseTo(expected.precision, 12)
          expect(actual.recall).toBeCloseTo(expected.recall, 12)
        }
      }
  })
  it('keeps foreign RGB fixtures at their actual locations, with masks and threshold filtering', () => {
    const osbs = data.rgb.samples.find((s) => s.id === 'osbs')!,
      sjer = data.rgb.samples.find((s) => s.id === 'sjer')!
    expect(osbs.centre[0]).toBeLessThan(-80)
    expect(osbs.centre[0]).toBeGreaterThan(-83)
    expect(osbs.centre[1]).toBeLessThan(31)
    expect(sjer.centre[0]).toBeLessThan(-118)
    expect(sjer.centre[1]).toBeGreaterThan(36)
    expect(rgbFeatures(osbs, 'deepforest', 0.25, true).features).toHaveLength(55)
    const masks = rgbFeatures(osbs, 'canopy-maskrcnn', 0.25, true),
      boxes = rgbFeatures(osbs, 'canopy-maskrcnn', 0.25, false)
    expect(masks.features).toHaveLength(25)
    expect(masks.features[0].geometry.type).toBe('MultiPolygon')
    expect(boxes.features[0].geometry.type).toBe('Polygon')
  })
  it('does not double-count duplicate detections and keeps missing precision explicit', () => {
    const p = { box: [0, 0, 10, 10], score: 0.9 }
    expect(boxDiagnostics([p, { ...p, score: 0.8 }], [[0, 0, 10, 10]], 0.25)).toMatchObject({
      matched: 1,
      falsePositives: 1,
      missed: 0,
    })
    expect(boxDiagnostics([], [[0, 0, 10, 10]], 0.25).precision).toBeNull()
  })
  it('never advertises unavailable neural checkpoints as completed predictions', () => {
    for (const id of ['segment-any-tree', 'forestformer3d', 'forpt', 'canopy-mask2former', 'canopy-sam3', 'treelearn'])
      expect(COMPARISON_MODELS.find((m) => m.id === id)?.status).not.toBe('completed')
  })
  it('suppresses numerical camera echoes while retaining real view changes', () => {
    const c = { dx: 0, dy: 0, zoom: 19, bearing: 0, pitch: 50 }
    expect(sameCamera(c, { ...c, dx: 1e-10, zoom: 19 + 1e-7 })).toBe(true)
    expect(sameCamera(c, { ...c, pitch: 0 })).toBe(false)
    expect(sameCamera(c, { ...c, dx: 0.0001 })).toBe(false)
  })
})
