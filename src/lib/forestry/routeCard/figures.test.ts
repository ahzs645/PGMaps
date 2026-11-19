import { describe, expect, it } from 'vitest'

import { considerationMaps } from './figures'
import type { Planar } from './geometry'
import type { RouteCardRowState } from './results'

const square = (x: number, y: number, size: number): Planar => ({
  kind: 'polygon',
  polygons: [
    [
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
        [x, y],
      ],
    ],
  ],
})
const block = square(1_200_000, 900_000, 400)
const read = (props: Record<string, unknown>, shape: Planar): RouteCardRowState => ({
  status: 'read',
  finding: {
    answer: 'yes',
    names: ['x'],
    nearNames: [],
    matches: [{ name: 'x', props, shape, distanceMeters: 0 }],
    alongAccess: [],
    nearestMeters: 0,
    truncated: false,
  },
})

describe('consideration maps', () => {
  it('draws TAP and winter range maps only for the considerations printed and with something to show', () => {
    const maps = considerationMaps({
      blockName: 'Made-up 1',
      block,
      access: {
        kind: 'line',
        lines: [
          [
            [1_199_000, 900_200],
            [1_200_000, 900_200],
          ],
        ],
      },
      states: {
        'tap-remnant': read({ REMNANT_OLD_ECOSYS_ID: 1 }, square(1_199_500, 900_000, 500)),
        'ungulate-winter-range': read(
          { UWR_UNIT_NUMBER: 'X-1', TIMBER_HARVEST_CODE: 'NO HARVEST ZONE' },
          square(1_200_400, 900_000, 300),
        ),
      },
      considerations: ['tap-ogma', 'caribou-uwr', 'watershed'],
    })
    expect(maps.map((map) => map.consideration)).toEqual(['tap-ogma', 'caribou-uwr'])
    expect(maps[0].svg).toContain('TAP remnant old ecosystem')
    expect(maps[0].svg).toContain('Access road')
    expect(maps[1].svg).toContain('X-1 · NO HARVEST ZONE')
    expect(
      considerationMaps({ blockName: 'B', block, access: null, states: {}, considerations: ['tap-ogma'] }),
    ).toEqual([])
  })
})
