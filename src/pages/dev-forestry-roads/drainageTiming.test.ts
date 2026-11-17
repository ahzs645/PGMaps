/** Per-culvert time of concentration and IDF intensity in the drainage check, and its off state. */
import { describe, expect, it } from 'vitest'
import { analyzeRoad } from './engine'
import { DEFAULT_DRAINAGE_SETTINGS, runDrainage, type DrainageSettings } from './drainageRun'
import { createDrainageEvidence, drainageInputFingerprint, parseDrainageSettings } from './drainageEvidence'
import { rationalPeakFlow } from './hydrology'
import type { IdfCurve } from './idfCurve'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, localMetricGrid } from './terrain'
import { kirpichTcMin } from './timeOfConcentration'
import type { Alignment, Culvert, TerrainSource } from './types'

const grid = localMetricGrid([-122.8, 53.9])
const [x0, y0] = grid.toGrid([-122.8, 53.9])
// A hillside rising north at 15 %, with a V gully down x = 0; the road crosses it heading east.
const ground = (x: number, y: number) => 500 + 0.15 * y - 0.06 * x + 0.12 * (Math.min(Math.abs(x), 10) - 10)
const terrain: TerrainSource = {
  elevationAt: (lon, lat) => {
    const [x, y] = grid.toGrid([lon, lat])
    return ground(x - x0, y - y0)
  },
}
const road: Alignment = {
  id: 'timing',
  name: 'Timing',
  color: '#000',
  points: [
    { id: 'a', coordinate: grid.toLonLat([x0 - 150, y0]), radiusM: 0 },
    { id: 'b', coordinate: grid.toLonLat([x0 + 150, y0]), radiusM: 0 },
  ],
  vertical: [
    { id: 'v0', chainage: 0, elevation: 504, curveLength: 0 },
    { id: 'v1', chainage: 300, elevation: 492, curveLength: 0 },
  ],
  template: DEFAULT_TEMPLATE,
  overrides: [],
}
const culvert: Culvert = {
  id: 'gully',
  name: 'Gully CMP',
  kind: 'stream',
  chainage: 150,
  skewDegrees: 0,
  lengthM: 16,
  diameterM: 0.6,
  inletInvertM: null,
  outletInvertM: null,
  minCoverM: 0.3,
  unitCost: 0,
  fixedCost: 0,
}
const idf: IdfCurve = {
  stationName: 'Test station',
  stationId: '1000000',
  returnPeriodYears: 10,
  source: 'Entered by hand',
  use: 'table',
  table: [
    { durationMin: 5, intensityMmPerHr: 90 },
    { durationMin: 60, intensityMmPerHr: 25 },
    { durationMin: 1440, intensityMmPerHr: 2 },
  ],
}
const analysis = analyzeRoad(road, terrain, DEFAULT_ROAD_SETTINGS)
const run = (settings: Partial<DrainageSettings>) =>
  runDrainage({
    terrain,
    analysis,
    culverts: [culvert],
    ...grid,
    resolutionM: 1,
    settings: { ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 150, ...settings },
  })
/** Everything a run reports, as text: identical text is an identical result. */
const reported = (r: ReturnType<typeof run>) =>
  JSON.stringify([r.culverts, r.crossings, r.lowPoints, r.warnings, r.plan, r.newPonding.areaM2])

describe('per-culvert time of concentration and IDF intensity', () => {
  const off = run({})
  const on = run({ concentration: { enabled: true, slopeMethod: '10-85', minimumTcMin: 5, idf } })

  it('changes nothing while it is off', () => {
    expect(off.culverts).toHaveLength(1)
    expect(off.culverts[0].timing).toBeUndefined()
    expect(off.culverts[0].designFlowM3s).toBe(rationalPeakFlow(0.35, 50, off.culverts[0].designAreaHa))
    // Off, with a curve kept for later: the same figures, and the run is not made stale.
    const kept = run({ concentration: { enabled: false, slopeMethod: 'equal-area', minimumTcMin: 10, idf } })
    expect(reported(kept)).toBe(reported(off))
    const input = {
      alignment: road,
      roadSettings: DEFAULT_ROAD_SETTINGS,
      terrain: { kind: 'demo' as const, name: 'Test', verticalReference: 'test' } as never,
    }
    expect(
      drainageInputFingerprint({
        ...input,
        settings: { ...DEFAULT_DRAINAGE_SETTINGS, concentration: kept.settings.concentration },
      }),
    ).toBe(drainageInputFingerprint({ ...input, settings: DEFAULT_DRAINAGE_SETTINGS }))
  })

  it("reads each culvert's intensity from the IDF at its own Kirpich Tc", () => {
    const check = on.culverts[0],
      t = check.timing!
    expect(check.designAreaHa).toBe(off.culverts[0].designAreaHa)
    // The gully runs about 150 m above the road (the buffer), the ditch brings more.
    expect(t.pathLengthM).toBeGreaterThan(100)
    expect(t.pathSlope).toBeGreaterThan(0.05)
    expect(t.smoothingWindowM).toBe(12)
    expect(t.kirpichTcMin).toBeCloseTo(kirpichTcMin(t.pathLengthM, t.pathSlope!), 9)
    expect(t.tcMin).toBeGreaterThanOrEqual(5)
    expect(t.returnPeriodYears).toBe(10)
    expect(t.idf).toMatch(/^Test station \(1000000\), 10-year, table/)
    expect(check.designFlowM3s).toBeCloseTo(rationalPeakFlow(0.35, t.intensityMmPerHr, check.designAreaHa), 12)
    expect(check.adequate).toBe(check.capacityM3s >= check.designFlowM3s)
    expect(on.warnings.join(' ')).toMatch(/at its own time of concentration \(Kirpich/)
    // Streams, crossings and low points do not depend on the intensity.
    expect(JSON.stringify(on.crossings)).toBe(JSON.stringify(off.crossings))
    expect(JSON.stringify(on.lowPoints)).toBe(JSON.stringify(off.lowPoints))
  })

  it('names every flag in the warnings and carries the figures into the evidence', () => {
    const t = on.culverts[0].timing!
    for (const flag of t.flags) expect(flag).toMatch(/kirpich|slope|idf|minimum/)
    if (t.flags.length) expect(on.warnings.some((w) => w.startsWith('Gully CMP:'))).toBe(true)
    const evidence = createDrainageEvidence(on, {
      alignment: road,
      roadSettings: DEFAULT_ROAD_SETTINGS,
      terrain: { kind: 'demo', name: 'Test', verticalReference: 'test' } as never,
      settings: on.settings,
    })
    const props = evidence.features.features.find((f) => f.properties?.role === 'culvert-check')!.properties!
    expect(props.tcMin).toBe(t.tcMin)
    expect(props.intensityMmPerHr).toBe(t.intensityMmPerHr)
    expect(props.returnPeriodYears).toBe(10)
    expect(parseDrainageSettings(evidence.settings)).toEqual(on.settings)
  })

  it('refuses to run per culvert without a curve', () => {
    expect(() => run({ concentration: { enabled: true, slopeMethod: '10-85', minimumTcMin: 5 } })).toThrow(
      /no IDF curve/,
    )
  })
})
