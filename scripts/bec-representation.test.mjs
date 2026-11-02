import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  classifyRepresentation,
  loadPinnedStudy,
  normalizeStudy,
  parseCsv,
  sha256,
  sumRoundedIntersections,
} from './lib/becRepresentation.mjs'

const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'bec-representation')
const study = await loadPinnedStudy(join(directory, 'source'))
const units = new Map(study.data.units.map((unit) => [unit.code, unit]))

test('the pinned study retains all original units and park intersections', () => {
  assert.deepEqual(study.data.summary, {
    unitCount: 213,
    zoneCount: 16,
    intersectionCount: 2145,
    parkNameGroupCount: 882,
    finiteRatioCount: 208,
    missingIntersectionCount: 4,
    invalidRatioCount: 1,
    roundingExcessCount: 3,
    belowFivePercentCount: 70,
    atLeastThirtyPercentCount: 32,
  })
  assert.equal(units.size, 213)
  assert.equal(study.data.units.reduce((sum, unit) => sum + unit.contributors.length, 0), 2145)
  assert.equal(study.sources.length, 6)
})

test('CDFmm cannot be classified as highly represented by division by zero', () => {
  const unit = units.get('CDFmm')
  assert.equal(unit.totalAreaKm2, 0)
  assert.equal(unit.protectedAreaKm2, 187.006)
  assert.equal(unit.raw.bgc_protected_ratio, 'Inf')
  assert.equal(unit.protectedRatio, null)
  assert.equal(unit.protectedPercent, null)
  assert.equal(unit.displayPercent, null)
  assert.equal(unit.representationClass, 'invalid-denominator')
  assert.deepEqual(unit.qualityFlags, ['zero-denominator', 'non-finite-source-ratio'])
  assert.ok(unit.contributors.length > 0)
})

test('unmatched units preserve missing values without inventing zero percentages', () => {
  const missing = study.data.units.filter((unit) => unit.qualityFlags.includes('missing-intersection'))
  assert.deepEqual(missing.map((unit) => unit.code), ['CWHms2', 'ICHmc1a', 'SBPSmk', 'SBSmc1'])
  for (const unit of missing) {
    assert.ok(unit.totalAreaKm2 > 0)
    assert.equal(unit.raw.bgc_protected, '')
    assert.equal(unit.raw.bgc_protected_ratio, '')
    assert.equal(unit.protectedAreaKm2, null)
    assert.equal(unit.protectedRatio, null)
    assert.equal(unit.protectedPercent, null)
    assert.equal(unit.displayPercent, null)
    assert.equal(unit.representationClass, 'no-recorded-intersection')
    assert.deepEqual(unit.contributors, [])
  }
})

test('rounding excesses retain their source values and bound only visual marks', () => {
  const excesses = study.data.units.filter((unit) => unit.qualityFlags.includes('rounding-over-100'))
  assert.deepEqual(excesses.map((unit) => unit.code), ['BWBSvk', 'ESSFmm2', 'SWBvks'])
  for (const unit of excesses) {
    assert.equal(unit.protectedRatio, Number(unit.raw.bgc_protected_ratio))
    assert.ok(unit.protectedPercent > 100 && unit.protectedPercent < 100.001)
    const unroundedSum = unit.contributors.reduce((sum, park) => sum + park.intersectionAreaKm2, 0)
    assert.ok(unroundedSum <= unit.totalAreaKm2)
    assert.ok(unit.protectedAreaKm2 - unit.totalAreaKm2 <= unit.contributors.length * 0.0005)
    assert.equal(unit.displayPercent, 100)
    assert.equal(unit.representationClass, '30-plus')
  }
})

test('classification uses original inclusive lower bounds, including 15% rather than 10%', () => {
  for (const [ratio, expected] of [
    [0, 'below-1'],
    [0.009999, 'below-1'],
    [0.01, '1-to-5'],
    [0.049999, '1-to-5'],
    [0.05, '5-to-15'],
    [0.1, '5-to-15'],
    [0.149999, '5-to-15'],
    [0.15, '15-to-30'],
    [0.299999, '15-to-30'],
    [0.3, '30-plus'],
    [1, '30-plus'],
  ]) assert.equal(classifyRepresentation(ratio, 1), expected, `ratio=${ratio}`)
  assert.equal(classifyRepresentation(null, 1), 'no-recorded-intersection')
  assert.equal(classifyRepresentation(null, 0), 'invalid-denominator')
  assert.equal(classifyRepresentation(Infinity, 1), 'invalid-denominator')
  assert.throws(() => classifyRepresentation(1.1, 1), /Out-of-range/)
  assert.throws(() => classifyRepresentation(-0.1, 1), /Out-of-range/)
  assert.deepEqual(Object.fromEntries(study.data.classes.map((entry) => [entry.id, entry.count])), {
    'no-recorded-intersection': 4,
    'below-1': 14,
    '1-to-5': 56,
    '5-to-15': 65,
    '15-to-30': 41,
    '30-plus': 32,
    'invalid-denominator': 1,
  })
})

test('park contributions reconcile with the published rounded BGC totals', () => {
  const parkComposition = new Map()
  for (const unit of study.data.units) {
    if (unit.protectedAreaKm2 !== null) {
      assert.ok(Math.abs(sumRoundedIntersections(unit.contributors) - unit.protectedAreaKm2) < 1e-8, unit.code)
      assert.ok(Math.abs(unit.contributors.reduce((sum, park) => sum + park.shareOfUnitIntersections, 0) - 1) < 1e-10, unit.code)
    }
    for (const park of unit.contributors) {
      parkComposition.set(park.sourceParkName, (parkComposition.get(park.sourceParkName) ?? 0) + park.shareOfMappedPark)
    }
  }
  for (const [name, share] of parkComposition) assert.ok(Math.abs(share - 1) < 1e-10, name)
  const moistWarmSbs = units.get('SBSmw')
  assert.equal(moistWarmSbs.contributors.length, 1)
  assert.equal(moistWarmSbs.contributors[0].parkName, 'BOBTAIL MOUNTAIN PARK')
  assert.ok(Math.abs(moistWarmSbs.protectedPercent - 0.427233170057725) < 1e-12)
})

test('normalization rejects inconsistent source joins and duplicate records', async () => {
  const representationRows = parseCsv(await readFile(join(directory, 'source/outputs/PAS_representation_by_BGC.csv'), 'utf8'))
  const areaRows = parseCsv(await readFile(join(directory, 'source/outputs/BGC_area.csv'), 'utf8'))
  const parkRows = parseCsv(await readFile(join(directory, 'source/outputs/BGC_area_by_park.csv'), 'utf8'))
  assert.throws(() => normalizeStudy([...representationRows, representationRows[0]], areaRows, parkRows), /Duplicate representation/)
  assert.throws(() => normalizeStudy(representationRows, areaRows, [...parkRows, parkRows[0]]), /Duplicate park\/BGC/)
  const changedRatio = representationRows.map((row, index) => index === 0 ? { ...row, bgc_protected_ratio: '0.5' } : row)
  assert.throws(() => normalizeStudy(changedRatio, areaRows, parkRows), /Ratio disagrees/)
  const changedArea = areaRows.map((row, index) => index === 0 ? { ...row, BGC_km2: '1' } : row)
  assert.throws(() => normalizeStudy(representationRows, changedArea, parkRows), /BGC area disagrees/)
})

test('committed snapshot and manifest are deterministic and match exact pinned sources', async () => {
  const snapshotText = await readFile(join(directory, 'representation.json'), 'utf8')
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  assert.equal(snapshotText, `${JSON.stringify(study.data, null, 2)}\n`)
  assert.deepEqual(manifest.sources, study.sources)
  assert.deepEqual(manifest.outputs, [{ path: 'representation.json', sha256: sha256(snapshotText), bytes: Buffer.byteLength(snapshotText) }])
  assert.equal(manifest.source.commit, '0066648b02db082fded8ce9cf242c56d9a8ec22f')
})
