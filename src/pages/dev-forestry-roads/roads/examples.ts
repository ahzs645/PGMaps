/** Browser-native examples. CLUS numbers are adapted from LandSciTech/roads; see NOTICE.md. */
import type { RoadsGrid, RoadsInput, RoadsLanding } from './types'

export const ROADS_EXAMPLES = [
  {
    id: 'clus-reference',
    name: 'CLUS reference · four landings',
    description: 'The upstream 5 × 5 synthetic cost raster, four landings and an existing road along its north edge.',
    focus: 'Compare all four algorithms against the published R test fixture.',
  },
  {
    id: 'shared-spurs',
    name: 'Shared spurs · several harvest blocks',
    description:
      'Six synthetic landings share access to one existing road. A lower-cost central corridor encourages branching.',
    focus: 'Compare independent routes, sequential reuse and minimum spanning trees.',
  },
  {
    id: 'wetland-detour',
    name: 'Wetland · crossing or detour',
    description: 'A synthetic no-build area has one expensive crossing corridor and passable ground around its ends.',
    focus: 'Inspect a blocked mask, crossing penalties and straight-line baseline failures.',
  },
  {
    id: 'hillside-grade',
    name: 'Hillside · grade-sensitive access',
    description:
      'A synthetic hillside and ridge use separate terrain elevations, an existing road and a 12% ground-grade screen.',
    focus: 'Compare terrain-sensitive networks before detailed curves and vertical design.',
  },
  {
    id: 'staged-harvest',
    name: 'Staged harvest · three periods',
    description: 'Three synthetic harvest periods add landings while retaining previously constructed graph edges.',
    focus: 'Compare developing the network over time with planning all landings together.',
  },
  {
    id: 'isolated-target',
    name: 'Disconnected ground · report unreachable landings',
    description: 'A continuous synthetic no-build barrier divides two targets from the existing road.',
    focus: 'Check explicit unreachable results rather than inventing a connection.',
  },
] as const

export type RoadsExampleId = (typeof ROADS_EXAMPLES)[number]['id']
export interface RoadsExample {
  id: RoadsExampleId
  name: string
  description: string
  focus: string
  input: RoadsInput
  stages?: { name: string; landings: RoadsLanding[] }[]
}

/** Expected cells in upstream tests/testthat/test-projectRoads_CLUSexample.R, converted to zero-based. */
export const CLUS_EXPECTED_ROAD_CELLS = {
  snap: [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 16, 19, 21, 24],
  lcp: [0, 1, 2, 3, 4, 7, 9, 10, 11, 12, 13, 15, 18, 21, 24],
  mst: [0, 1, 2, 3, 4, 9, 10, 11, 12, 13, 15, 18, 21, 24],
}

/** Exact upstream CLUS values, not regenerated with a different language's random-number generator. */
export function getCLUSExample(): RoadsInput {
  return {
    grid: {
      origin: [0.5, 4.5],
      cellM: 1,
      width: 5,
      height: 5,
      values: new Float64Array([
        0, 0, 0, 0, 0, 18.0694040143862367, 18.9488301035016775, 13.5551580572500825, 12.9531668340787292,
        2.1739391388837248, 4.9135169230867177, 4.3545782980509102, 14.0534340864978731, 8.2979706460610032,
        15.6269869799725711, 10.4562855996191502, 14.6347516570240259, 19.8462158017791808, 8.2206684092525393,
        15.7714592050760984, 18.7593993910122663, 5.0307079043705016, 13.3818015556316823, 3.385546823265031,
        6.0771927058231086,
      ]),
    },
    roadCells: [0, 1, 2, 3, 4],
    landings: [10, 12, 21, 24].map((cell, index) => ({ id: `clus-${index + 1}`, name: `Landing ${index + 1}`, cell })),
    options: {
      method: 'ilcp',
      neighbourhood: 'queen',
      weightFunction: 'simple',
      roadsInWeight: true,
      roadsConnected: false,
      ordering: 'closest',
      preventCornerCutting: false,
    },
  }
}

function grid(width: number, height: number, cellM: number, value: (column: number, row: number) => number): RoadsGrid {
  return {
    origin: [0, (height - 1) * cellM],
    cellM,
    width,
    height,
    values: Float64Array.from({ length: width * height }, (_, i) => value(i % width, Math.floor(i / width))),
  }
}

function landings(width: number, points: [number, number][]): RoadsLanding[] {
  return points.map(([column, row], index) => ({
    id: `landing-${index + 1}`,
    name: `Landing ${index + 1}`,
    cell: row * width + column,
  }))
}

function sharedInput(): RoadsInput {
  const size = 25
  return {
    grid: grid(size, size, 20, (column, row) => (row === 0 ? 0 : 1 + Math.abs(column - 12) * 0.05)),
    roadCells: Array.from({ length: size }, (_, i) => i),
    landings: landings(size, [
      [8, 10],
      [16, 11],
      [7, 17],
      [17, 18],
      [10, 23],
      [15, 23],
    ]),
    options: { method: 'ilcp', neighbourhood: 'octagon', weightFunction: 'simple', roadsInWeight: true },
  }
}

/** Equivalent role to R's prepExData: ready-to-run browser data, without loading packed R objects. */
export function prepExData(id: RoadsExampleId | string = 'clus-reference'): RoadsExample {
  const metadata = ROADS_EXAMPLES.find((example) => example.id === id)
  if (!metadata) throw Error(`Unknown roads example: ${id}`)
  let input: RoadsInput
  let stages: RoadsExample['stages']
  if (id === 'clus-reference') input = getCLUSExample()
  else if (id === 'shared-spurs' || id === 'staged-harvest') {
    input = sharedInput()
    if (id === 'staged-harvest')
      stages = [
        { name: 'Period 1 · nearby blocks', landings: input.landings.slice(0, 2) },
        { name: 'Period 2 · middle blocks', landings: input.landings.slice(2, 4) },
        { name: 'Period 3 · distant blocks', landings: input.landings.slice(4) },
      ]
  } else if (id === 'wetland-detour') {
    input = {
      grid: grid(25, 25, 20, (column, row) => {
        if (row === 0) return 0
        if (row >= 9 && row <= 15 && column >= 5 && column <= 19) return column === 12 ? 12 : NaN
        return 1
      }),
      roadCells: Array.from({ length: 25 }, (_, i) => i),
      landings: landings(25, [
        [6, 21],
        [12, 22],
        [18, 21],
      ]),
      options: { method: 'ilcp', weightFunction: 'simple', preventCornerCutting: true, roadsInWeight: true },
    }
  } else if (id === 'hillside-grade') {
    const terrain = grid(
      41,
      31,
      20,
      (column, row) => 500 + row * 1.4 + 55 * Math.exp(-(((column - 20) / 5) ** 2)) * Math.sin((row / 30) * Math.PI),
    )
    input = {
      grid: { ...terrain, values: new Float64Array(terrain.values.length).fill(1) },
      elevations: terrain.values.slice(),
      roadCells: Array.from({ length: 41 }, (_, i) => i),
      landings: landings(41, [
        [7, 24],
        [20, 25],
        [33, 24],
      ]),
      options: {
        method: 'ilcp',
        weightFunction: 'grade',
        gradeMode: 'terrain',
        roadsInWeight: false,
        grade: { baseCost: 16178, penalty: 504, limit: 12 },
        preventCornerCutting: true,
      },
    }
  } else {
    input = {
      grid: grid(25, 25, 20, (column) => (column === 12 ? NaN : column === 0 ? 0 : 1)),
      roadCells: Array.from({ length: 25 }, (_, row) => row * 25),
      landings: landings(25, [
        [8, 12],
        [20, 6],
        [20, 20],
      ]),
      options: { method: 'ilcp', weightFunction: 'simple', preventCornerCutting: true, roadsInWeight: true },
    }
  }
  return { ...metadata, input, ...(stages ? { stages } : {}) }
}
