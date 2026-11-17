import { describe, expect, it } from 'vitest'
import { distance } from './engine'
import { culvertFlowArrow, FLOW_ARROW_MAX_M, FLOW_ARROW_MIN_M } from './culvertFlowArrow'
import type { Coordinate } from './types'

const inlet: Coordinate = [-122.8, 53.9]
// About 12 m due east of the inlet.
const outlet: Coordinate = [-122.8 + 12 / (111320 * Math.cos((53.9 * Math.PI) / 180)), 53.9]

describe('culvertFlowArrow', () => {
  it('leaves the outlet away from the inlet, a fifth of the span long', () => {
    const [shaft, head] = culvertFlowArrow(inlet, outlet, 12)
    expect(shaft[0]).toEqual(outlet)
    expect(distance(shaft[0], shaft[1])).toBeCloseTo(2.4, 1)
    expect(distance(inlet, shaft[1])).toBeGreaterThan(distance(inlet, outlet))
    // The head's middle point is the tip, its wings fall back toward the outlet.
    expect(head[1]).toEqual(shaft[1])
    expect(distance(head[0], outlet)).toBeLessThan(distance(shaft[1], outlet))
    expect(distance(head[2], outlet)).toBeLessThan(distance(shaft[1], outlet))
  })

  it('keeps the shaft between its bounds', () => {
    expect(distance(...(culvertFlowArrow(inlet, outlet, 3)[0] as [Coordinate, Coordinate]))).toBeCloseTo(
      FLOW_ARROW_MIN_M,
      1,
    )
    expect(distance(...(culvertFlowArrow(inlet, outlet, 60)[0] as [Coordinate, Coordinate]))).toBeCloseTo(
      FLOW_ARROW_MAX_M,
      1,
    )
  })

  it('draws nothing for a barrel of no length', () => {
    expect(culvertFlowArrow(inlet, inlet, 0)).toEqual([])
  })
})
