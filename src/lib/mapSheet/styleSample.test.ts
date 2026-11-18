import { describe, expect, it } from 'vitest'

import { STYLE_SAMPLE_ROLES, STYLE_SAMPLE_SIZE, styleSampleKey, styleSampleOps, styleSampleSvg } from './styleSample'
import type { AreaSymbol } from './symbols'

const block: AreaSymbol = {
  kind: 'area',
  label: 'Proposed block',
  fill: '#ffaa00',
  outline: [{ color: '#000000', width: 1.1, join: 'round' }],
}
const opening: AreaSymbol = {
  kind: 'area',
  label: 'Existing opening',
  outline: [{ color: '#7a0177', width: 0.8, dash: [3, 2] }],
}

describe('a map style sample', () => {
  it('draws the same context under every style, and one area per role the style has', () => {
    const none = styleSampleOps({})
    const both = styleSampleOps({ block, opening })
    // The contours and the road come first, whatever the style.
    expect(both.slice(0, none.length)).toEqual(none)
    expect(both.length).toBeGreaterThan(none.length)
    // A role the style does not draw adds nothing.
    expect(styleSampleOps({ block }).length).toBeLessThan(both.length)
  })

  it('draws a style with its own colours and dashes, so two styles differ where their symbols do', () => {
    const svg = styleSampleSvg({ block, opening })
    expect(svg).toContain('fill="#ffaa00"')
    expect(svg).toContain('stroke="#7a0177"')
    expect(svg).toContain('stroke-dasharray="3 2"')
    expect(styleSampleSvg({ block })).not.toContain('#7a0177')
    expect(styleSampleSvg({ block, opening })).toBe(svg)
  })

  it('is a small scalable drawing that stays inside its box', () => {
    const { width, height } = STYLE_SAMPLE_SIZE
    const svg = styleSampleSvg({ block, opening })
    expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`)
    expect(svg.length).toBeLessThan(4000)
    // A smaller box is a smaller map of the same shape, with the symbols at their printed weights.
    const small = styleSampleSvg({ block, opening }, width / 2)
    expect(small).toContain(`viewBox="0 0 ${width / 2} ${height / 2}"`)
    expect(small).toContain('stroke-width="1.1"')
    for (const op of styleSampleOps({ block, opening, landform: opening, privateLand: opening, rock: opening }))
      if (op.op === 'path')
        for (const [x, y] of op.parts.flat()) {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(width)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThanOrEqual(height)
        }
  })

  it('keys the roles it draws front to back', () => {
    expect(styleSampleKey({ opening, block }).map((entry) => entry.role)).toEqual(['block', 'opening'])
    expect(styleSampleKey({})).toEqual([])
    expect(STYLE_SAMPLE_ROLES.at(-1)).toBe('block')
  })
})
