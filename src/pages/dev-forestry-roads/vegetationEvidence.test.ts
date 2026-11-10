import { describe, expect, it } from 'vitest'
import {
  MAX_VEGETATION_CELLS,
  evidenceOnFrame,
  normaliseIntensity,
  vegetationAccumulator,
  vegetationEvidence,
  type FullPointCloud,
  type VegetationEvidence,
} from './vegetationEvidence'

/**
 * A 20 m square at 4 ground returns per m² on a 10 % slope, with shrubs (1 m and 4 m returns) and a
 * 15 m crown over the west half, and a bare east half.
 */
function cloud({ classes = true, z0 = 100 }: { classes?: boolean; z0?: number } = {}): FullPointCloud {
  const x: number[] = [],
    y: number[] = [],
    z: number[] = [],
    cls: number[] = [],
    intensity: number[] = []
  const ground = (px: number) => z0 + 0.1 * px
  for (let i = 0; i < 40; i++)
    for (let j = 0; j < 40; j++) {
      const px = 0.25 + i * 0.5,
        py = 0.25 + j * 0.5
      x.push(px)
      y.push(py)
      z.push(ground(px))
      cls.push(classes ? 2 : 1)
      intensity.push(px < 10 ? 50 + ((i * 7 + j * 3) % 40) : 100 + ((i + j) % 4))
    }
  for (let c = 0; c < 10; c++)
    for (let r = 0; r < 20; r++)
      for (const h of [1, 1, 4, 15]) {
        x.push(c + 0.5)
        y.push(r + 0.5)
        z.push(ground(c + 0.5) + h)
        cls.push(1)
        intensity.push(20 + h * 5)
      }
  return {
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    z: Float64Array.from(z),
    classification: Uint8Array.from(cls),
    intensity: Uint16Array.from(intensity),
    pointSource: null,
  }
}

const cell = (e: VegetationEvidence, x: number, y: number) =>
  Math.round((e.origin[1] - y) / e.cellM) * e.width + Math.round((x - e.origin[0]) / e.cellM)

describe('vegetation evidence from an unthinned cloud', () => {
  const outcome = vegetationEvidence(cloud())
  if (!('evidence' in outcome)) throw Error(outcome.refused)
  const e = outcome.evidence

  it('grids whole metres and counts returns by band above the ground', () => {
    expect(e.cellM).toBe(1)
    expect(e.origin).toEqual([0.5, 19.5])
    expect([e.width, e.height]).toEqual([20, 20])
    const west = cell(e, 4.5, 10.5),
      east = cell(e, 15.5, 10.5)
    expect(e.ground[west]).toBe(4)
    expect(e.low[west]).toBe(2) // two 1 m returns
    expect(e.brush[west]).toBe(3) // and the 4 m one
    expect(e.under5[west]).toBe(7) // with the four ground returns
    expect(e.canopyM[west]).toBeCloseTo(15, 1)
    expect(e.low[east]).toBe(0)
    expect(e.brush[east]).toBe(0)
    expect(e.under5[east]).toBe(4)
    expect(Math.abs(e.canopyM[east])).toBeLessThan(0.05)
  })

  it('keeps the spread of the ground returns and the intensity range per cell', () => {
    const east = cell(e, 15.5, 10.5)
    // Four returns 0.5 m apart on a 10 % slope: ±0.025 m about their mean.
    expect(e.groundSdM[east]).toBeCloseTo(0.025, 3)
    expect(e.intensityRange).not.toBeNull()
    expect(e.intensityRange![east]).toBeLessThanOrEqual(3)
    expect(e.intensityRange![cell(e, 4.5, 10.5)]).toBeGreaterThan(30)
  })

  it('reports density and what it has', () => {
    expect(e.info.coveredCells).toBe(400)
    expect(e.info.groundPerM2).toBeCloseTo(4, 6)
    expect(e.info.pointsPerM2).toBeCloseTo(6, 6)
    expect(e.info.intensity).toBe('raw')
    expect(e.info.lowDensity).toBe(false)
  })

  it('refuses a cloud without ground classes, a height-normalised one and one thinned to the ground', () => {
    const none = vegetationEvidence(cloud({ classes: false }))
    expect('refused' in none && none.refused).toMatch(/no ground-classified returns/)
    const normalised = vegetationEvidence(cloud({ z0: -1 }))
    expect('refused' in normalised && normalised.refused).toMatch(/height-normalised/)
    const c = cloud()
    const n = 1600
    const groundOnly: FullPointCloud = {
      x: c.x.slice(0, n),
      y: c.y.slice(0, n),
      z: c.z.slice(0, n),
      classification: c.classification.slice(0, n),
    }
    const thinned = vegetationEvidence(groundOnly)
    expect('refused' in thinned && thinned.refused).toMatch(/thinned to its ground points/)
  })

  it('refuses an extent beyond the cell budget, naming the area', () => {
    const side = Math.ceil(Math.sqrt(MAX_VEGETATION_CELLS)) + 10
    const acc = vegetationAccumulator([0, 0, side, side])
    expect('refused' in acc && acc.refused).toMatch(/Crop the cloud/)
  })

  it('fills a dropout cell from its neighbours rather than reading it as open', () => {
    const holed = { ...e, returns: e.returns.slice(), canopyM: e.canopyM.slice() }
    const k = cell(e, 4.5, 10.5)
    holed.returns[k] = 0
    const frame = { origin: e.origin, cellM: 1, width: e.width, height: e.height }
    const layers = evidenceOnFrame(holed, frame)
    expect(layers.known[k]).toBe(0)
    expect(layers.canopyM[k]).toBeCloseTo(15, 1)
  })
})

describe('intensity normalisation between flight lines', () => {
  it('scales each line by its median over that of the line with the most points', () => {
    // Line A: 1,000 points at median 200; line B: 400 at median 100 → B's factor 0.5, doubled.
    const intensity = Uint16Array.from([...Array(1000).fill(200), ...Array(400).fill(100)])
    const source = Uint16Array.from([...Array(1000).fill(1), ...Array(400).fill(2)])
    const { values, flightLines, normalised } = normaliseIntensity(intensity, source)
    expect(flightLines).toBe(2)
    expect(normalised).toBe(true)
    expect(values[0]).toBe(200)
    expect(values[1200]).toBe(200)
  })

  it('clips everything above twice the 98th percentile', () => {
    const intensity = Uint16Array.from([...Array(999).fill(100), 60_000])
    const { values, normalised } = normaliseIntensity(intensity, null)
    expect(normalised).toBe(false)
    expect(values[999]).toBe(200)
  })
})
