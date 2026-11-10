import { describe, expect, it } from 'vitest'
import { EXAMPLE_RIGGING } from './cableMechanics'
import { DEFAULT_REACH_SETTINGS, maxReachCsv, maxReachGeoJson, maxReachSteps, validReachSettings } from './cableReach'
import type { ReachResult, ReachSettings } from './cableReach'
import { runCooperatively, runToCompletion } from './cooperative'
import { analyzeCable, distance, offsetCoordinate } from './engine'
import type { Coordinate, TerrainSource } from './types'

const center: Coordinate = [-122.72, 53.89]
const from = (lng: number, lat: number) => distance(center, [lng, lat])
/** Bearing from the landing, degrees clockwise from north. */
const bearingOf = (lng: number, lat: number) => {
  const dx = (lng - center[0]) * Math.cos((center[1] * Math.PI) / 180),
    dy = lat - center[1]
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
}
const settings: ReachSettings = {
  ...DEFAULT_REACH_SETTINGS,
  bearingStepDeg: 90,
  yarderHeightM: 18,
  tailholdHeightM: 8,
  deflectionPercent: 3,
  minimumClearanceM: 1,
  minLengthM: 50,
  maxLengthM: 600,
  candidateStepM: 10,
}
const run = (terrain: TerrainSource, s: Partial<ReachSettings> = {}, rigging = null as typeof EXAMPLE_RIGGING | null) =>
  runToCompletion(maxReachSteps(center, terrain, { ...settings, ...s }, rigging))

describe('maximum-reach radial search', () => {
  it('finds the analytic reach over a convex slope falling away from the landing', () => {
    // Ground drops as c·d². With 18/8 m supports and a 3 % sag the line to D clears 1 m only while
    // K = c·D² + 0.12·D ≤ 24 + 2√119 (minimum of 18 − 10t − K·t(1 − t) over the span).
    const c = 0.001
    const result = run({ elevationAt: (lng, lat) => 500 - c * from(lng, lat) ** 2 })
    const k = 24 + 2 * Math.sqrt(119)
    const exact = (-0.12 + Math.sqrt(0.12 ** 2 + 4 * c * k)) / (2 * c)
    expect(exact).toBeCloseTo(162.3, 1)
    for (const spoke of result.spokes) {
      expect(spoke.status).toBe('clear')
      expect(spoke.limitedBy).toBe('clearance')
      expect(spoke.reachM!).toBeLessThanOrEqual(exact)
      expect(spoke.reachM!).toBeGreaterThan(exact - settings.candidateStepM)
      expect(distance(spoke.line!.start, spoke.line!.end)).toBeCloseTo(spoke.reachM!, 6)
      // The adopted D-line clears on its own profile too.
      expect(
        analyzeCable(spoke.line!, { elevationAt: (lng, lat) => 500 - c * from(lng, lat) ** 2 }).minClearance!,
      ).toBeGreaterThan(0.99)
    }
    expect(result.envelope).toHaveLength(result.spokes.length + 1)
    expect(result.envelope[0]).toEqual(result.envelope.at(-1))
  })

  it('stops a bearing at a ridge and reports the cap where nothing limits the line', () => {
    const ridge: TerrainSource = {
      elevationAt: (lng, lat) => {
        const d = from(lng, lat)
        return Math.abs(bearingOf(lng, lat) - 90) < 10 && d > 175 && d < 185 ? 530 : 500
      },
    }
    const result = run(ridge, { maxLengthM: 300 })
    const east = result.spokes.find((spoke) => spoke.bearingDeg === 90)!
    // A tailhold on the ridge top itself clears; nothing past the ridge does.
    expect(east.reachM!).toBeLessThan(185)
    expect(east.reachM!).toBeGreaterThanOrEqual(170)
    expect(east.limitedBy).toBe('clearance')
    for (const spoke of result.spokes.filter((x) => x.bearingDeg !== 90)) {
      expect(spoke.reachM).toBe(300)
      expect(spoke.limitedBy).toBe('max-length')
    }
  })

  it('keeps unknown ground unknown and offers only a lower bound before the gap', () => {
    const hole: TerrainSource = {
      elevationAt: (lng, lat) => {
        const d = from(lng, lat)
        return d > 119 && d < 130 ? NaN : 500
      },
    }
    const result = run(hole)
    for (const spoke of result.spokes) {
      expect(spoke.status).toBe('unknown')
      expect(spoke.limitedBy).toBe('unknown-terrain')
      expect(spoke.reachM).toBeNull()
      expect(spoke.unknownFromM!).toBeGreaterThan(118)
      expect(spoke.unknownFromM!).toBeLessThan(122)
      expect(spoke.knownFeasibleM!).toBeLessThan(spoke.unknownFromM!)
      expect(spoke.knownFeasibleM!).toBeGreaterThan(100)
    }
    const csv = maxReachCsv(result)
    expect(csv).toContain('known_feasible_m is a lower bound, not the reach')
    expect(maxReachGeoJson(result).features[0].properties).toMatchObject({ lower_bound_spokes: 4 })
    // Unknown ground at the landing leaves nothing to test.
    const noLanding = run({ elevationAt: (lng, lat) => (from(lng, lat) < 1 ? NaN : 500) })
    expect(noLanding.spokes.every((spoke) => spoke.line === null && spoke.status === 'unknown')).toBe(true)
  })

  it('uses the loaded carriage path and tension with rigging', () => {
    const flat: TerrainSource = { elevationAt: () => 500 }
    const geometric = run(flat, { maxLengthM: 800 })
    const rope = run(flat, { maxLengthM: 800, bearingStepDeg: 180 }, EXAMPLE_RIGGING)
    expect(rope.rigging).toMatchObject({ minClearanceM: settings.minimumClearanceM })
    for (const spoke of rope.spokes) {
      expect(spoke.limitedBy).toBe('clearance')
      expect(spoke.line!.sagModel).toBe('mechanics')
      // The adopted line reproduces the search on its own samples (to the nearest sample).
      const own = analyzeCable(spoke.line!, flat).mechanics!
      expect(own.minLoadClearance!).toBeGreaterThan(settings.minimumClearanceM - 0.05)
      const beyond = analyzeCable(
        { ...spoke.line!, end: offsetCoordinate(center, spoke.bearingDeg, spoke.reachM! + 10) },
        flat,
      ).mechanics!
      expect(beyond.minLoadClearance!).toBeLessThan(settings.minimumClearanceM)
    }
    // A 3.5 t turn at 141 kN sags more than 3 % on these spans, so the loaded reach is shorter.
    expect(rope.spokes[0].reachM!).toBeLessThan(geometric.spokes[0].reachM!)
    // A base tension that the load raises past the allowable stops every line on tension.
    const overloaded = run(
      flat,
      { maxLengthM: 200, bearingStepDeg: 180 },
      {
        ...EXAMPLE_RIGGING,
        tensionMode: 'base',
        baseTensionKN: 120,
      },
    )
    expect(overloaded.spokes.every((spoke) => spoke.status === 'conflict' && spoke.limitedBy === 'tension')).toBe(true)
  })

  it('validates its inputs, caps the fan and runs in cancellable slices', async () => {
    expect(() => validReachSettings({ ...settings, minLengthM: 700 })).toThrow(/shortest line/)
    expect(() => validReachSettings({ ...settings, maxLengthM: 5000 })).toThrow(/Farthest tailhold/)
    expect(() => run({ elevationAt: () => 0 }, {}, { ...EXAMPLE_RIGGING, safetyFactor: 0 })).toThrow(/Safety factor/)
    const capped = run({ elevationAt: () => 500 }, { bearingStepDeg: 1, maxLengthM: 100 })
    expect(capped.spokes).toHaveLength(72)
    expect(capped.warnings[0]).toMatch(/72 spokes/)
    const sector: ReachResult = run(
      { elevationAt: () => 500 },
      { startBearingDeg: 10, sweepDeg: 40, bearingStepDeg: 20 },
    )
    expect(sector.spokes.map((spoke) => spoke.bearingDeg)).toEqual([10, 30, 50])
    expect(sector.envelope[0]).toEqual(center)
    expect(sector.envelope.at(-1)).toEqual(center)
    const controller = new AbortController()
    let slices = 0
    const pending = runCooperatively(
      maxReachSteps(center, { elevationAt: () => 500 }, { ...settings, bearingStepDeg: 5 }, EXAMPLE_RIGGING),
      {
        signal: controller.signal,
        sliceMs: 0,
        onProgress: () => {
          if (++slices === 3) controller.abort()
        },
      },
    )
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
