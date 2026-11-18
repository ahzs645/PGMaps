import { describe, expect, it } from 'vitest'
import {
  falseDiscoveryCutoff,
  getisOrdGiStar,
  globalMoran,
  localMoran,
  normalUpperTail,
  seededRandom,
  summariseSpatialPattern,
} from './spatialAutocorrelation'
import { buildQueenContiguity, weightsForValues, type ContiguityRegion } from './spatialWeights'

type Square = [number, number, number, number]

function polygon(...rings: number[][][]): GeoJSON.Polygon {
  return { type: 'Polygon', coordinates: rings }
}

function box([x0, y0, x1, y1]: Square): number[][] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ]
}

/** Neighbour ids per region id, for readable assertions. */
function neighbourIds(regions: ContiguityRegion[], toleranceMeters?: number): Record<string, string[]> {
  const graph = buildQueenContiguity(regions, { toleranceMeters })
  return Object.fromEntries(graph.ids.map((id, i) => [id, graph.neighbors[i].map((j) => graph.ids[j])]))
}

// About 1.1 m of longitude at 54° N is 1.7e-5 degrees; the tests sit near Prince George.
const LON = -122.75
const LAT = 53.9
const D = 0.01

describe('buildQueenContiguity', () => {
  it('links a shared edge and a shared corner, and nothing else', () => {
    const regions: ContiguityRegion[] = [
      { id: 'a', geometry: polygon(box([LON, LAT, LON + D, LAT + D])) },
      { id: 'edge', geometry: polygon(box([LON + D, LAT, LON + 2 * D, LAT + D])) },
      { id: 'corner', geometry: polygon(box([LON + D, LAT + D, LON + 2 * D, LAT + 2 * D])) },
      { id: 'apart', geometry: polygon(box([LON + 3 * D, LAT, LON + 4 * D, LAT + D])) },
    ]
    expect(neighbourIds(regions)).toEqual({
      a: ['edge', 'corner'],
      edge: ['a', 'corner'],
      corner: ['a', 'edge'],
      apart: [],
    })
    expect(buildQueenContiguity(regions).islands).toEqual(['apart'])
  })

  it('links a T-junction, where one side of the edge has a vertex the other lacks', () => {
    // The tall rectangle has no vertex where the two small squares meet beside it.
    const regions: ContiguityRegion[] = [
      { id: 'tall', geometry: polygon(box([LON, LAT, LON + D, LAT + 2 * D])) },
      { id: 'lower', geometry: polygon(box([LON + D, LAT, LON + 2 * D, LAT + D])) },
      { id: 'upper', geometry: polygon(box([LON + D, LAT + D, LON + 2 * D, LAT + 2 * D])) },
    ]
    expect(neighbourIds(regions, 0)).toEqual({
      tall: ['lower', 'upper'],
      lower: ['tall', 'upper'],
      upper: ['tall', 'lower'],
    })
  })

  it('links a partly overlapping edge with no shared vertex', () => {
    const regions: ContiguityRegion[] = [
      { id: 'left', geometry: polygon(box([LON, LAT, LON + D, LAT + D])) },
      { id: 'shifted', geometry: polygon(box([LON + D, LAT + D / 2, LON + 2 * D, LAT + 1.5 * D])) },
    ]
    expect(neighbourIds(regions, 0)).toEqual({ left: ['shifted'], shifted: ['left'] })
  })

  it('snaps a sliver gap within the tolerance and no wider', () => {
    // A gap of about 1.1 m between the two squares.
    const gap = 1.1 / (111_320 * Math.cos((LAT * Math.PI) / 180))
    const regions: ContiguityRegion[] = [
      { id: 'a', geometry: polygon(box([LON, LAT, LON + D, LAT + D])) },
      { id: 'b', geometry: polygon(box([LON + D + gap, LAT, LON + 2 * D, LAT + D])) },
    ]
    expect(neighbourIds(regions, 0.5)).toEqual({ a: [], b: [] })
    expect(neighbourIds(regions, 2)).toEqual({ a: ['b'], b: ['a'] })
  })

  it('reads every part of a MultiPolygon and the rings of a hole', () => {
    const regions: ContiguityRegion[] = [
      // Its second part, far from the first, touches 'east'.
      {
        id: 'multi',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[box([LON, LAT, LON + D, LAT + D])], [box([LON + 5 * D, LAT, LON + 6 * D, LAT + D])]],
        },
      },
      { id: 'east', geometry: polygon(box([LON + 6 * D, LAT, LON + 7 * D, LAT + D])) },
      // A ring with a hole, and the region that fills the hole.
      {
        id: 'donut',
        geometry: polygon(
          box([LON, LAT + 3 * D, LON + 3 * D, LAT + 6 * D]),
          box([LON + D, LAT + 4 * D, LON + 2 * D, LAT + 5 * D]),
        ),
      },
      { id: 'filling', geometry: polygon(box([LON + D, LAT + 4 * D, LON + 2 * D, LAT + 5 * D])) },
    ]
    expect(neighbourIds(regions)).toEqual({ multi: ['east'], east: ['multi'], donut: ['filling'], filling: ['donut'] })
  })

  it('reaches along a long edge whose neighbour has only short segments', () => {
    // One straight 40-cell edge against forty small squares: the long segment crosses
    // many grid cells, so it must be found from every one of them.
    const regions: ContiguityRegion[] = [
      {
        id: 'long',
        geometry: polygon([
          [LON, LAT],
          [LON + 40 * D, LAT + 40 * D],
          [LON + 40 * D, LAT + 41 * D],
          [LON, LAT],
        ]),
      },
    ]
    for (let k = 0; k < 40; k += 1) {
      // Each small triangle has a vertex on the long diagonal.
      regions.push({
        id: `t${k}`,
        geometry: polygon([
          [LON + (k + 0.5) * D, LAT + (k + 0.5) * D],
          [LON + (k + 0.6) * D, LAT + (k + 0.2) * D],
          [LON + (k + 0.7) * D, LAT + (k + 0.3) * D],
          [LON + (k + 0.5) * D, LAT + (k + 0.5) * D],
        ]),
      })
    }
    const graph = buildQueenContiguity(regions, { toleranceMeters: 0.01 })
    expect(graph.neighbors[0]).toHaveLength(40)
  })
})

describe('weightsForValues', () => {
  it('drops missing values and reports regions they leave without a neighbour', () => {
    const regions: ContiguityRegion[] = [
      { id: 'a', geometry: polygon(box([LON, LAT, LON + D, LAT + D])) },
      { id: 'b', geometry: polygon(box([LON + D, LAT, LON + 2 * D, LAT + D])) },
      { id: 'c', geometry: polygon(box([LON + 2 * D, LAT, LON + 3 * D, LAT + D])) },
      { id: 'd', geometry: polygon(box([LON + 3 * D, LAT, LON + 4 * D, LAT + D])) },
      { id: 'e', geometry: polygon(box([LON + 4 * D, LAT, LON + 5 * D, LAT + D])) },
    ]
    const graph = buildQueenContiguity(regions)
    const weights = weightsForValues(graph, [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
      { id: 'c', value: Number.NaN },
      { id: 'd', value: 4 },
      { id: 'e', value: 5 },
      { id: 'unknown', value: 6 },
    ])
    expect(weights.ids).toEqual(['a', 'b', 'd', 'e'])
    expect(weights.neighbors).toEqual([[1], [0], [3], [2]])
    expect(weights.missing).toEqual(['c', 'unknown'])
    expect(weights.islands).toEqual([])

    const lonely = weightsForValues(graph, [
      { id: 'a', value: 1 },
      { id: 'c', value: 3 },
      { id: 'd', value: 4 },
    ])
    expect(lonely.islands).toEqual(['a'])
    expect(lonely.ids).toEqual(['c', 'd'])
  })
})

/** Four regions in a row with values 1–4: small enough to work by hand. */
function pathWeights() {
  return {
    ids: ['1', '2', '3', '4'],
    values: [1, 2, 3, 4],
    neighbors: [[1], [0, 2], [1, 3], [2]],
    islands: [],
    missing: [],
  }
}

describe('hand-worked figures', () => {
  it("global Moran's I on a path of four", () => {
    // z = [−1.5, −0.5, 0.5, 1.5], Σz² = 5, lags = [−0.5, −0.5, 0.5, 0.5], Σ z·lag = 2.
    const result = globalMoran(pathWeights(), { permutations: 0 })!
    expect(result.I).toBeCloseTo(0.4, 12)
    expect(result.expected).toBeCloseTo(-1 / 3, 12)
    expect(result.pPermutation).toBeNaN()
  })

  it("local Moran's I on a path of four", () => {
    // I_i = n z_i lag_i / Σz² = 4 z_i lag_i / 5.
    const result = localMoran(pathWeights(), { permutations: 99 })!
    expect(result.I.map((value) => Number(value.toFixed(12)))).toEqual([0.6, 0.2, 0.2, 0.6])
    expect(result.quadrant).toEqual(['LL', 'LL', 'HH', 'HH'])
  })

  it('Gi* on a path of four', () => {
    // Region 1: its neighbourhood {1, 2} sums to 3 against 2 × 2.5; s = √1.25.
    const result = getisOrdGiStar(pathWeights())!
    const expected = (3 - 5) / (Math.sqrt(1.25) * Math.sqrt((4 * 2 - 4) / 3))
    expect(result.z[0]).toBeCloseTo(expected, 12)
    expect(result.z[3]).toBeCloseTo(-expected, 12)
  })

  it('normal tail matches scipy.stats.norm.sf', () => {
    expect(normalUpperTail(0)).toBe(0.5)
    expect(normalUpperTail(1.96)).toBeCloseTo(0.024997895148220435, 15)
    expect(normalUpperTail(2.9999) / 0.001350341282954925).toBeCloseTo(1, 12)
    expect(normalUpperTail(3.0001) / 0.001349454913260717).toBeCloseTo(1, 12)
    expect(normalUpperTail(5) / 2.8665157187919344e-7).toBeCloseTo(1, 12)
    expect(normalUpperTail(10) / 7.619853024160474e-24).toBeCloseTo(1, 12)
    expect(normalUpperTail(-1)).toBeCloseTo(0.8413447460685429, 15)
  })

  it('Benjamini–Hochberg cut-off', () => {
    // m = 4, alpha 0.05: thresholds 0.0125, 0.025, 0.0375, 0.05; the third p passes.
    expect(falseDiscoveryCutoff([0.2, 0.001, 0.03, 0.01])).toBe(0.03)
    expect(falseDiscoveryCutoff([0.01, 0.02, 0.03, 0.04, 0.05])).toBe(0.05)
    expect(falseDiscoveryCutoff([0.5, 0.9])).toBe(0)
  })
})

/**
 * A 15 × 15 grid of squares with a planted 5 × 5 hot corner (rows and columns 0–4): the
 * fixture of the Whitebox cross-check. Values 10 + jitter inside the corner, jitter outside.
 */
function plantedGrid() {
  const regions: ContiguityRegion[] = []
  const observations: Array<{ id: string; value: number }> = []
  for (let r = 0; r < 15; r += 1) {
    for (let c = 0; c < 15; c += 1) {
      const id = String(r * 15 + c)
      regions.push({ id, geometry: polygon(box([c, r, c + 1, r + 1])) })
      observations.push({ id, value: (r < 5 && c < 5 ? 10 : 0) + ((r * 7 + c * 13) % 5) / 10 })
    }
  }
  return weightsForValues(buildQueenContiguity(regions, { toleranceMeters: 1 }), observations)
}

const inCorner = (id: string) => Math.floor(Number(id) / 15) < 5 && Number(id) % 15 < 5

describe('planted hot corner, against PySAL esda 2.10 / libpysal 4.15 (queen, row-standardised)', () => {
  const weights = plantedGrid()

  it("global Moran's I and both variances", () => {
    const result = globalMoran(weights, { permutations: 99 })!
    expect(result.n).toBe(225)
    expect(result.I).toBeCloseTo(0.8323589813960066, 12)
    expect(result.varianceNormality).toBeCloseTo(0.0012352044474377754, 15)
    expect(result.varianceRandomisation).toBeCloseTo(0.0012120027631111257, 15)
    expect(result.zNormality).toBeCloseTo(23.810270182338574, 9)
    expect(result.zRandomisation).toBeCloseTo(24.037092896238835, 9)
    expect(result.pPermutation).toBeCloseTo(0.01, 12)
  })

  it('finds the 25 HH cells and the cold cells around them as LH', () => {
    const result = localMoran(weights, { permutations: 999 })!
    const counts = { cornerHH: 0, cornerOther: 0, outsideLH: 0, outsideOther: 0 }
    result.cluster.forEach((cluster, i) => {
      if (inCorner(result.ids[i])) counts[cluster === 'HH' ? 'cornerHH' : 'cornerOther'] += 1
      else if (cluster === 'LH') counts.outsideLH += 1
      else if (cluster !== 'ns') counts.outsideOther += 1
    })
    // esda at 9,999 permutations also gives 25 HH and 7 LH. One of the LH cells (id 5, beside
    // the corner on the bottom row) sits at p ≈ 0.04–0.05, so it moves with the seed.
    expect(counts).toEqual({ cornerHH: 25, cornerOther: 0, outsideLH: 7, outsideOther: 0 })
    expect(result.pPermutation[5]).toBeGreaterThan(0.03)
    expect(result.pPermutation[5]).toBeLessThan(0.06)
    // Anselin's I_i; esda's Moran_Local scales the same figure by (n − 1) / n.
    expect(result.I[0]).toBeCloseTo(7.774930765200471, 10)
    expect(result.I[64]).toBeCloseTo(2.3058961852249205, 10)
  })

  it('Gi* flags all 25 corner cells, and spills over onto six cold cells beside them', () => {
    const result = getisOrdGiStar(weights)!
    expect(result.z[0]).toBeCloseTo(5.641358205736644, 10)
    // The corner's inner corner cell, only four of whose nine neighbourhood cells are hot.
    expect(result.z[64]).toBeCloseTo(3.204723504173977, 10)
    expect(result.z[5]).toBeCloseTo(1.7368160187973285, 10)
    expect(result.z[224]).toBeCloseTo(-0.7591742684681835, 10)
    const hotInCorner = result.ids.filter((id, i) => result.hot[i] && inCorner(id)).length
    const hotOutside = result.ids.filter((id, i) => result.hot[i] && !inCorner(id)).length
    expect([hotInCorner, hotOutside]).toEqual([25, 6])
  })
})

/**
 * A jittered 8 × 8 grid whose cells share their vertices, one cell carrying a detached
 * second part, and a far island: continuous values, so permutation p-values have no ties.
 */
function jitteredGrid() {
  const random = seededRandom(7)
  const n = 8
  const step = 0.01
  const jitter: number[][][] = []
  for (let i = 0; i <= n; i += 1) {
    jitter.push([])
    for (let j = 0; j <= n; j += 1) {
      const edge = i === 0 || j === 0 || i === n || j === n
      jitter[i].push(edge ? [0, 0] : [(random() - 0.5) * step * 0.4, (random() - 0.5) * step * 0.4])
    }
  }
  const at = (i: number, j: number) => [
    Number((-122.8 + j * step + jitter[i][j][0]).toFixed(7)),
    Number((53.9 + i * step + jitter[i][j][1]).toFixed(7)),
  ]
  const regions: ContiguityRegion[] = []
  const observations: Array<{ id: string; value: number }> = []
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const id = String(i * n + j)
      const ring = [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j), at(i, j)]
      const value = Number((j * 0.6 + i * 0.3 + (random() - 0.5) * 3).toFixed(4))
      const east = -122.8 + (n + 3) * step
      const north = 53.9 + 2 * step
      regions.push({
        id,
        geometry:
          id === '63'
            ? { type: 'MultiPolygon', coordinates: [[ring], [box([east, north, east + step, north + step])]] }
            : polygon(ring),
      })
      observations.push({ id, value })
    }
  }
  const east = -122.8 + (n + 6) * step
  const north = 53.9 + 6 * step
  regions.push({ id: '64', geometry: polygon(box([east, north, east + step, north + step])) })
  observations.push({ id: '64', value: 9.5 })
  return weightsForValues(buildQueenContiguity(regions), observations)
}

describe('jittered grid with a MultiPolygon and an island, against esda', () => {
  const weights = jitteredGrid()

  it('leaves the island out and analyses the other 64', () => {
    expect(weights.islands).toEqual(['64'])
    expect(weights.ids).toHaveLength(64)
  })

  it("global Moran's I", () => {
    const result = globalMoran(weights, { permutations: 0 })!
    expect(result.I).toBeCloseTo(0.6599823069835095, 12)
    expect(result.varianceNormality).toBeCloseTo(0.004518556371978993, 15)
    expect(result.varianceRandomisation).toBeCloseTo(0.004573974515486705, 15)
    expect(result.pNormality / 8.790190891476272e-24).toBeCloseTo(1, 9)
    expect(result.pRandomisation / 1.6313889897636092e-23).toBeCloseTo(1, 9)
  })

  it('local Moran, Gi* and the classes esda gives at 9,999 permutations', () => {
    const local = localMoran(weights, { permutations: 9999 })!
    const gi = getisOrdGiStar(weights)!
    const at = (id: string) => weights.ids.indexOf(id)
    expect(local.I[at('0')]).toBeCloseTo(2.3170329875084743, 10)
    expect(local.I[at('63')]).toBeCloseTo(2.1049293974320435, 10)
    expect(gi.z[at('9')]).toBeCloseTo(-4.0548370143039305, 10)
    expect(gi.z[at('36')]).toBeCloseTo(1.2567264788248664, 10)
    const counts: Record<string, number> = {}
    for (const cluster of local.cluster) counts[cluster] = (counts[cluster] ?? 0) + 1
    expect(counts).toEqual({ LL: 18, HL: 1, ns: 28, LH: 2, HH: 15 })
    // A conditional-permutation p-value is a Monte Carlo estimate: esda gave 0.0089.
    expect(local.pPermutation[at('0')]).toBeGreaterThan(0.004)
    expect(local.pPermutation[at('0')]).toBeLessThan(0.016)
  })
})

describe('determinism and options', () => {
  const weights = jitteredGrid()

  it('repeats exactly for a seed, and moves with another seed', () => {
    const first = localMoran(weights, { permutations: 199 })!
    const again = localMoran(weights, { permutations: 199 })!
    const other = localMoran(weights, { permutations: 199, seed: 1 })!
    expect(again.pPermutation).toEqual(first.pPermutation)
    expect(other.pPermutation).not.toEqual(first.pPermutation)
    expect(globalMoran(weights, { permutations: 99 })!.pPermutation).toBe(
      globalMoran(weights, { permutations: 99 })!.pPermutation,
    )
  })

  it('FDR keeps a subset of the uncorrected clusters', () => {
    const plain = localMoran(weights, { permutations: 999 })!
    const corrected = localMoran(weights, { permutations: 999, fdr: true })!
    expect(corrected.cutoff).toBeLessThanOrEqual(plain.cutoff)
    corrected.cluster.forEach((cluster, i) => {
      if (cluster !== 'ns') expect(plain.cluster[i]).toBe(cluster)
    })
    expect(corrected.cluster.filter((cluster) => cluster !== 'ns').length).toBeLessThan(
      plain.cluster.filter((cluster) => cluster !== 'ns').length,
    )
  })

  it('the Moran scatter slope is global I', () => {
    const local = localMoran(weights, { permutations: 9 })!
    let zz = 0
    let zl = 0
    local.standardised.forEach((z, i) => {
      zz += z * z
      zl += z * local.lag[i]
    })
    expect(zl / zz).toBeCloseTo(globalMoran(weights, { permutations: 0 })!.I, 12)
  })

  it('refuses a constant variable and too few regions', () => {
    const flat = { ...pathWeights(), values: [3, 3, 3, 3] }
    expect(globalMoran(flat)).toBeNull()
    expect(localMoran(flat)).toBeNull()
    expect(getisOrdGiStar(flat)).toBeNull()
    const three = { ids: ['1', '2', '3'], values: [1, 2, 3], neighbors: [[1], [0, 2], [1]], islands: [], missing: [] }
    expect(globalMoran(three)).toBeNull()
    const summary = summariseSpatialPattern(three, { permutations: 9 })
    expect(summary.global).toBeNull()
    expect(summary.analysedCount).toBe(3)
  })
})
