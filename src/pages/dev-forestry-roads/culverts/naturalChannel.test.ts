import { describe, expect, it } from 'vitest'
import type { Culvert } from '../engineeringTypes'
import type { Coordinate, Crossing, TerrainSource } from '../types'
import {
  bankfullAreaCheck,
  type BankfullReading,
  channelWidthEvidence,
  crossingForCulvert,
  locateChannelSection,
  readBankfull,
  readCrossingChannel,
  sampleChannelSection,
  streamWidthRatioCheck,
} from './naturalChannel'

const ORIGIN: Coordinate = [-122.75, 53.9]
const KX = Math.cos(ORIGIN[1] * (Math.PI / 180)) * 6371008.8 * (Math.PI / 180)
const KY = 6371008.8 * (Math.PI / 180)
const at = (x: number, y: number): Coordinate => [ORIGIN[0] + x / KX, ORIGIN[1] + y / KY]

/** A terrain whose cross-profile `z(x)` (x east, m) rises `along` m per m to the north. */
function terrain(z: (x: number) => number, along = 0.05): TerrainSource {
  return {
    elevationAt(lng, lat) {
      const x = (lng - ORIGIN[0]) * KX,
        y = (lat - ORIGIN[1]) * KY
      return z(x) + along * y
    },
  }
}

/** 3 m bed with a slight V, 1:1 banks to 1 m, then a 2 % floodplain. Bankfull top width 4.85 m. */
const trapezoid = (x: number) => {
  const a = Math.abs(x)
  if (a <= 1.5) return 0.05 * a
  if (a <= 2.425) return 0.075 + (a - 1.5)
  return 1 + 0.02 * (a - 2.425)
}
/** A V of 1:2 sides cut 1 m into a plain: bankfull 4 m wide, area 2 m². */
const vNotch = (x: number) => {
  const a = Math.abs(x)
  return a <= 2 ? 0.5 * a : 1 + 0.01 * (a - 2)
}
const STREAM: Coordinate[] = [at(0, -100), at(0, 100)]

const sectionOver = (z: (x: number) => number, cellSizeM: number, centreY = 20) =>
  sampleChannelSection({ terrain: terrain(z), centre: at(0, centreY), downstreamBearingDeg: 180, cellSizeM })

describe('sampling', () => {
  it('never samples finer than the terrain cell', () => {
    const s = sampleChannelSection({
      terrain: terrain(trapezoid),
      centre: at(0, 0),
      downstreamBearingDeg: 180,
      cellSizeM: 1,
      spacingM: 0.2,
    })
    expect(s.spacingM).toBe(1)
    expect(s.samples).toHaveLength(41)
  })

  it('puts negative offsets on the left bank looking downstream', () => {
    // Flowing south, the left bank is east.
    const s = sampleChannelSection({
      terrain: terrain((x) => x, 0),
      centre: at(0, 0),
      downstreamBearingDeg: 180,
      cellSizeM: 1,
    })
    const left = s.samples[0]
    expect(left.offsetM).toBe(-20)
    expect(left.elevationM).toBeCloseTo(20, 3)
  })

  it('takes the section upstream, read from the terrain, whichever way the line was drawn', () => {
    const t = terrain(trapezoid)
    const forward = locateChannelSection({ terrain: t, streamLine: STREAM, crossing: at(0, 0), cellSizeM: 1 })!
    const backward = locateChannelSection({
      terrain: t,
      streamLine: [...STREAM].reverse(),
      crossing: at(0, 0),
      cellSizeM: 1,
    })!
    for (const l of [forward, backward]) {
      expect(l.upstreamFrom).toBe('terrain')
      expect((l.centre[1] - ORIGIN[1]) * KY).toBeCloseTo(20, 3)
      expect(l.downstreamBearingDeg).toBeCloseTo(180, 3)
    }
    const flat = locateChannelSection({
      terrain: terrain(trapezoid, 0),
      streamLine: STREAM,
      crossing: at(0, 0),
      cellSizeM: 1,
    })!
    expect(flat.upstreamFrom).toBe('line-order')
    expect(flat.note).toMatch(/could not tell/)
  })
})

describe('candidate bankfull', () => {
  it('reads a trapezoid channel with a floodplain bench', () => {
    const r = readBankfull(sectionOver(trapezoid, 0.25))
    expect(r.state).toBe('read')
    expect(r.widthM!).toBeCloseTo(4.85, 0)
    expect(Math.abs(r.widthM! - 4.85)).toBeLessThan(0.2)
    expect(r.maxDepthM!).toBeCloseTo(1, 2)
    // ∫(1 − z) dx over the channel = 3.743 m².
    expect(Math.abs(r.areaM2! - 3.743) / 3.743).toBeLessThan(0.05)
    expect(r.thalweg!.offsetM).toBe(0)
    expect(r.lowerBound).toBe(false)
    expect(r.usable).toBe(true)
    expect(r.flags.map((f) => f.id)).toEqual([])
  })

  it('places each bank within a cell on 1 m cells', () => {
    // Interpolating across the cell that holds the bank top widens the channel: 5.95 m for 4.85 m.
    const r = readBankfull(sectionOver(trapezoid, 1))
    expect(r.state).toBe('read')
    expect(Math.abs(r.leftBankOffsetM! + 2.425)).toBeLessThan(1)
    expect(Math.abs(r.rightBankOffsetM! - 2.425)).toBeLessThan(1)
    expect(r.widthM!).toBeGreaterThan(4.85)
    expect(r.usable).toBe(true)
  })

  it('reads a V-notch', () => {
    const r = readBankfull(sectionOver(vNotch, 0.5))
    expect(r.state).toBe('read')
    expect(r.widthM!).toBeCloseTo(4, 1)
    expect(r.maxDepthM!).toBeCloseTo(1, 2)
    expect(r.areaM2!).toBeCloseTo(2, 1)
    expect(r.widthDepthRatio!).toBeCloseTo(8, 0)
  })

  it('takes the thalweg nearest the stream line, not the first lowest sample', () => {
    // A side pocket 6 m east as deep as the channel 1 m west of the line.
    const z = (x: number) => Math.min(1 + 0.02 * Math.abs(x + 1), 0.5 * Math.abs(x + 1), 0.5 * Math.abs(x - 6))
    const r = readBankfull(sectionOver(z, 0.5))
    // Flowing south, west is the right bank: x = −1 is offset +1.
    expect(r.thalweg!.offsetM).toBe(1)
    expect(r.thalweg!.how).toMatch(/2 runs/)
    expect(r.state).toBe('read')
    expect(r.widthM!).toBeCloseTo(4, 1)
  })

  it('leaves a gap unknown: a bench beyond a gap is not read', () => {
    const gappy = (x: number) => (x > 3 && x < 6 ? NaN : trapezoid(x))
    const r = readBankfull(sectionOver(gappy, 0.25))
    expect(r.state).toBe('not-read')
    expect(r.reason).toMatch(/gap/)
    expect(r.widthM).toBeNull()
    expect(r.usable).toBe(false)
  })

  it('reads past a gap the water never reaches, and says the gap is there', () => {
    const gappy = (x: number) => (x > 15 ? NaN : trapezoid(x))
    const r = readBankfull(sectionOver(gappy, 0.25))
    expect(r.state).toBe('read')
    expect(r.flags.map((f) => f.id)).toContain('gap')
  })

  it('flags terrain too coarse for the channel and offers no width', () => {
    const r = readBankfull(sectionOver(trapezoid, 5))
    expect(r.usable).toBe(false)
    expect(r.flags.find((f) => f.id === 'coarse')?.text).toMatch(/Cells of 5 m/)
  })

  it('flags a level bed as a possible water surface and makes depth and area lower bounds', () => {
    const flatBed = (x: number) => (Math.abs(x) <= 1.5 ? 0 : trapezoid(x))
    const r = readBankfull(sectionOver(flatBed, 0.25))
    expect(r.state).toBe('read')
    expect(r.lowerBound).toBe(true)
    expect(r.flags.find((f) => f.id === 'level-bed')?.text).toMatch(/water surface/)
    expect(r.usable).toBe(true)
  })

  it('does not read a section with no bench', () => {
    const r = readBankfull(sectionOver((x) => 0.5 * Math.abs(x), 1))
    expect(r.state).toBe('not-read')
    expect(r.flags.map((f) => f.id)).toContain('no-bench')
  })

  it('does not read a channel off the mapped line', () => {
    // The ground falls away past the window: the channel is 12 m west.
    const r = readBankfull(sectionOver((x) => vNotch(x + 12), 1))
    expect(r.state).toBe('not-read')
    expect(r.flags.map((f) => f.id)).toContain('thalweg-at-edge')
  })

  it('reads a crossing end to end', () => {
    const out = readCrossingChannel({
      terrain: terrain(vNotch),
      streamLine: STREAM,
      crossing: at(0, 0),
      cellSizeM: 0.5,
    })!
    expect(out.location.upstreamFrom).toBe('terrain')
    expect(out.reading.widthM!).toBeCloseTo(4, 1)
  })
})

const culvert = (patch: Partial<Culvert> = {}): Culvert => ({
  id: 'c1',
  name: 'Culvert 1',
  kind: 'stream',
  chainage: 100,
  skewDegrees: 0,
  lengthM: 12,
  diameterM: 1.4,
  inletInvertM: 803.4,
  outletInvertM: 803.1,
  minCoverM: 0.6,
  unitCost: 400,
  fixedCost: 1500,
  ...patch,
})

const reading = (patch: Partial<BankfullReading> = {}): BankfullReading => ({
  state: 'read',
  widthM: 1.2,
  meanDepthM: 0.42,
  maxDepthM: 0.5,
  areaM2: 0.5,
  stageM: 100.5,
  leftBankOffsetM: -0.6,
  rightBankOffsetM: 0.6,
  widthDepthRatio: 2.9,
  benchIndex: 40,
  thalweg: { offsetM: 0, elevationM: 100, how: '' },
  lowerBound: false,
  usable: true,
  flags: [],
  method: '',
  section: { centre: ORIGIN, downstreamBearingDeg: 0, spacingM: 1, cellSizeM: 1, samples: [] },
  ...patch,
})

describe('3 × bankfull area check', () => {
  it('meets and fails the Engineering Manual example', () => {
    // EM 3.6.7: A = 0.5 m², Ac = 1.5 m², a 1400 mm pipe (1.54 m²).
    expect(bankfullAreaCheck({ culvert: culvert(), reading: reading() })!.state).toBe('met')
    const small = bankfullAreaCheck({ culvert: culvert({ diameterM: 1.2 }), reading: reading() })!
    expect(small.state).toBe('not-met')
    expect(small.result).toMatch(/Needs 1.5 m²/)
  })

  it('is not assessed without a usable reading', () => {
    expect(bankfullAreaCheck({ culvert: culvert(), reading: null })!.state).toBe('not-assessed')
    expect(bankfullAreaCheck({ culvert: culvert(), reading: reading({ usable: false }) })!.state).toBe('not-assessed')
    expect(
      bankfullAreaCheck({ culvert: culvert(), reading: reading({ state: 'not-read', areaM2: null, reason: 'x' }) })!
        .state,
    ).toBe('not-assessed')
    expect(bankfullAreaCheck({ culvert: culvert({ embedmentM: 0.6 }), reading: reading() })!.state).toBe('not-assessed')
  })

  it('never passes on a lower-bound area', () => {
    expect(bankfullAreaCheck({ culvert: culvert(), reading: reading({ lowerBound: true }) })!.state).toBe(
      'not-assessed',
    )
    expect(
      bankfullAreaCheck({ culvert: culvert({ diameterM: 1.2 }), reading: reading({ lowerBound: true }) })!.state,
    ).toBe('not-met')
  })

  it('is a note on a major culvert and absent for a cross-drain', () => {
    expect(bankfullAreaCheck({ culvert: culvert(), reading: reading(), major: true })!.state).toBe('note')
    expect(bankfullAreaCheck({ culvert: culvert({ kind: 'cross-drain' }), reading: reading() })).toBeNull()
  })
})

describe('stream width ratio screen', () => {
  const evidence = (w: number) => channelWidthEvidence(w, null)
  it('bands channel width over culvert width', () => {
    expect(streamWidthRatioCheck({ culvert: culvert(), channel: evidence(1.2) })!.state).toBe('met')
    const moderate = streamWidthRatioCheck({ culvert: culvert(), channel: evidence(1.6) })!
    expect(moderate.state).toBe('not-met')
    expect(moderate.result).toMatch(/moderate \(3 points\)/)
    expect(streamWidthRatioCheck({ culvert: culvert(), channel: evidence(2) })!.result).toMatch(/high \(6 points\)/)
    // Two barrels side by side add their widths.
    expect(streamWidthRatioCheck({ culvert: culvert({ barrels: 2 }), channel: evidence(2) })!.state).toBe('met')
  })

  it('is not assessed without a width, a note on an open-bottom arch, absent for a cross-drain', () => {
    expect(streamWidthRatioCheck({ culvert: culvert(), channel: null })!.state).toBe('not-assessed')
    expect(
      streamWidthRatioCheck({ culvert: culvert({ shape: 'open-bottom-arch', spanM: 3 }), channel: evidence(2) })!.state,
    ).toBe('note')
    expect(streamWidthRatioCheck({ culvert: culvert({ kind: 'cross-drain' }), channel: evidence(2) })).toBeNull()
  })

  it('prefers the recorded width and never offers an unusable candidate', () => {
    expect(channelWidthEvidence(2.5, reading())!.source).toBe('recorded')
    expect(channelWidthEvidence(null, reading())!.source).toBe('terrain')
    expect(channelWidthEvidence(null, reading({ usable: false }))).toBeNull()
  })
})

describe('crossingForCulvert', () => {
  const crossing = (id: string, featureId: string, chainage: number): Crossing => ({
    id,
    featureId,
    name: featureId,
    kind: 'stream',
    chainage,
    coordinate: ORIGIN,
  })
  it("takes the culvert's own stream, else the nearest within reach", () => {
    const list = [crossing('a', 's1', 90), crossing('b', 's2', 101)]
    expect(crossingForCulvert({ chainage: 100, sourceFeatureId: 's1' }, list)!.id).toBe('a')
    expect(crossingForCulvert({ chainage: 100 }, list)!.id).toBe('b')
    expect(crossingForCulvert({ chainage: 300 }, list)).toBeNull()
  })
})
