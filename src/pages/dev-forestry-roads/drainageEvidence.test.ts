import { describe, expect, it } from 'vitest'
import {
  createDrainageEvidence,
  drainageEvidenceGeoJson,
  drainageEvidenceNeedsRecompute,
  drainageInputFingerprint,
  drainageReportHtml,
  parseDrainageProjectState,
  parseDrainageSettings,
  type DrainageFingerprintInput,
} from './drainageEvidence'
import { DEFAULT_DRAINAGE_SETTINGS, runDrainage } from './drainageRun'
import { analyzeRoad, offsetCoordinate } from './engine'
import type { Alignment, RoadSettings } from './types'

const origin: [number, number] = [-122, 53]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 20,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 1,
  fillRate: 1,
  surfacingRate: 1,
  clearingRate: 1,
  shrinkFactor: 1,
}
const alignment: Alignment = {
  id: 'a',
  name: 'Audit',
  color: '#abc',
  points: [
    { id: 'p0', coordinate: origin, radiusM: 0 },
    { id: 'p1', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
  ],
  vertical: [],
  template: {
    leftWidth: 3,
    rightWidth: 3,
    crossfallPercent: 0,
    cutSlope: 1,
    fillSlope: 1,
    ditchWidth: 0,
    ditchDepth: 0,
    surfaceDepth: 0,
  },
  overrides: [],
}
const terrain = { elevationAt: (_lon: number, lat: number) => 800 + (lat - origin[1]) * 1000 }
const toGrid = ([lon, lat]: [number, number]): [number, number] => [
  (lon - origin[0]) * 66000,
  (lat - origin[1]) * 111000,
]
const toLonLat = ([x, y]: [number, number]): [number, number] => [origin[0] + x / 66000, origin[1] + y / 111000]
const input: DrainageFingerprintInput = {
  alignment,
  roadSettings: settings,
  terrain: { kind: 'demo', name: 'Test plane', resolutionM: 1, verticalReference: 'Synthetic' },
  settings: { ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 20 },
  pourPoint: { coordinate: origin, snapRadiusM: 5, surface: 'existing' },
  watershedMinAreaHa: 0.01,
}
function evidence() {
  const run = runDrainage({
    terrain,
    analysis: analyzeRoad(alignment, terrain, settings),
    culverts: [],
    toGrid,
    toLonLat,
    resolutionM: 1,
    settings: input.settings,
    pourPoint: input.pourPoint,
    watershedMinAreaHa: input.watershedMinAreaHa,
  })
  return { run, record: createDrainageEvidence(run, input, '2026-10-30T20:00:00.000Z') }
}
describe('portable drainage evidence', () => {
  it('retains inputs and exact catchment/review geometry without serializing accumulation or grid values', () => {
    const { record } = evidence()
    const state = {
      settings: input.settings,
      pourPoint: input.pourPoint,
      watershedMinAreaHa: input.watershedMinAreaHa,
      records: [record],
    }
    const restored = parseDrainageProjectState(JSON.parse(JSON.stringify(state)))
    expect(restored).toEqual(state)
    expect(JSON.stringify(record)).not.toMatch(/accumulation|directions|"values"/)
    expect(record.features.features.some((f) => f.properties?.role === 'catchment')).toBe(true)
    expect(record.terrain.verticalReference).toBe('Synthetic')
    expect(record.fingerprint).toBe(drainageInputFingerprint(input))
  })
  it('detects changed geometry, rainfall, point, terrain and datum, independent of object-key order', () => {
    const baseline = drainageInputFingerprint(input)
    expect(
      drainageInputFingerprint({
        ...input,
        settings: { bufferM: 20, streamThresholdHa: 1, manningN: 0.024, runoffCoefficient: 0.35, rainfallMmPerHr: 50 },
      }),
    ).toBe(baseline)
    expect(drainageInputFingerprint({ ...input, settings: { ...input.settings, rainfallMmPerHr: 70 } })).not.toBe(
      baseline,
    )
    expect(
      drainageInputFingerprint({
        ...input,
        alignment: {
          ...alignment,
          points: [...alignment.points, { id: 'p2', coordinate: offsetCoordinate(origin, 90, 50), radiusM: 0 }],
        },
      }),
    ).not.toBe(baseline)
    expect(
      drainageInputFingerprint({ ...input, terrain: { ...input.terrain, verticalReference: 'Changed datum' } }),
    ).not.toBe(baseline)
    expect(drainageInputFingerprint({ ...input, pourPoint: { ...input.pourPoint!, snapRadiusM: 20 } })).not.toBe(
      baseline,
    )
  })
  it('refuses to export stale evidence as current and attaches provenance to each GeoJSON feature', () => {
    const { record } = evidence()
    expect(() => drainageEvidenceGeoJson(record, 'stale')).toThrow(/out of date/)
    const exported = drainageEvidenceGeoJson(record, record.fingerprint)
    expect(exported.features[0].properties).toMatchObject({
      fingerprint: record.fingerprint,
      createdAt: record.createdAt,
      terrain: 'Test plane',
    })
  })
  it('validates portable settings, duplicates and geometry before accepting restored evidence', () => {
    expect(() => parseDrainageSettings({ ...input.settings, runoffCoefficient: 1.1 })).toThrow(/Runoff/)
    const { record } = evidence()
    expect(() => parseDrainageProjectState({ settings: input.settings, records: [record, record] })).toThrow(
      /duplicate/,
    )
    const invalid = JSON.parse(JSON.stringify(record))
    invalid.features.features[0].geometry.coordinates = [999, 99]
    expect(() => parseDrainageProjectState({ settings: input.settings, records: [invalid] })).toThrow()
  })
  it('requires a fresh live run for regional terrain even when metadata fingerprints match', () => {
    const { run } = evidence()
    const regionalInput = { ...input, terrain: { ...input.terrain, kind: 'regional' as const } }
    const record = createDrainageEvidence(run, regionalInput)
    expect(record.terrain.immutable).toBe(false)
    expect(drainageEvidenceNeedsRecompute(record, regionalInput.terrain)).toBe(true)
    expect(() => drainageEvidenceGeoJson(record, record.fingerprint)).toThrow(/unchecksummed live terrain/)
    expect(drainageEvidenceGeoJson(record, record.fingerprint, { hasLiveRun: true }).features.length).toBeGreaterThan(0)
    expect(drainageReportHtml(record, record.fingerprint)).toMatch(/Historical \/ out of date/)
    expect(drainageReportHtml(record, record.fingerprint, { hasLiveRun: true })).toMatch(/Inputs match/)
  })
  it('retains individual culvert metrics and escapes user text in the report', () => {
    const { run } = evidence()
    run.culverts.push({
      id: 'pipe',
      name: '<script>alert(1)</script>',
      chainage: 50,
      designAreaHa: 1,
      existingAreaHa: 2,
      designFlowM3s: 0.25,
      capacityM3s: 0.2,
      slope: 0.01,
      slopeAssumed: false,
      diameterM: 0.4,
      minimumDiameterM: 0.5,
      adequate: false,
    })
    const record = createDrainageEvidence(run, input)
    const pipe = record.features.features.find((f) => f.properties?.role === 'culvert-check')!
    expect(pipe.properties).toMatchObject({
      designFlowM3s: 0.25,
      capacityM3s: 0.2,
      minimumDiameterM: 0.5,
      adequate: false,
    })
    const html = drainageReportHtml(record, record.fingerprint)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('0.25 / 0.2')
  })
})
