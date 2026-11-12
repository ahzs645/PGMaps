import { describe, expect, it } from 'vitest'
import type { TargetVisibility } from './types'
import { visibleNetBlocks } from './visibleNetBlocks'

const target = (id: string, role: TargetVisibility['role'], rows: number[][], areaMeters: number) =>
  ({
    targetId: id,
    role,
    sampleCount: rows[0].length,
    visibleByStation: Uint8Array.from(rows.flat()),
    areaMeters,
  }) as unknown as TargetVisibility

describe('visible net blocks', () => {
  it('reads each block’s seen share at the assessment station, not the union of stations', () => {
    const rows = visibleNetBlocks(
      {
        assessmentStationIndex: 1,
        targets: [
          target(
            'a',
            'block',
            [
              [1, 1, 1, 1],
              [1, 0, 0, 2],
            ],
            200_000,
          ),
          target('l', 'landscape', [[1], [1]], 1),
        ],
      },
      { a: 'Block A' },
    )
    expect(rows).toEqual([
      { targetId: 'a', name: 'Block A', visiblePercent: 25, unknownPercent: 25, grossHectares: 20, visibleHectares: 5 },
    ])
  })
})
