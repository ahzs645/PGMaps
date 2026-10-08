import { describe, expect, it } from 'vitest'
import { getDonutRenderKey, pieMarkerDonutProperties, renderDonutSvg } from './donut.js'

describe('portable donut renderer', () => {
  const colors = ['#ff0000', '#0000ff']

  it('renders category wedges and preserves count-dependent marker sizing', () => {
    const donut = renderDonutSvg({ counts: [5, 10], colors })
    expect(donut.total).toBe(15)
    expect(donut.size).toBe(36)
    expect(donut.svg.match(/<path /g)).toHaveLength(2)
    expect(donut.svg).toContain('fill="#ff0000"')
    expect(donut.svg).toContain('fill="#0000ff"')
    expect(donut.svg).toContain('>15</text>')
    expect(renderDonutSvg({ counts: [4200], colors: [colors[0]] }).svg).toContain('>4k</text>')
  })

  it('honours known totals and transparent centres without requiring a document', () => {
    const donut = renderDonutSvg({ counts: [1, 2], colors, total: 50, centerStyle: 'transparent', showCount: false })
    expect(donut.size).toBe(48)
    expect(donut.svg).not.toContain('<circle')
    expect(donut.svg).not.toContain('<text')
    expect(donut.svg).not.toContain('NaN')
    expect(renderDonutSvg({ counts: [], colors }).svg).not.toContain('<path')
  })

  it('supports host themes without changing category colours or measurement totals', () => {
    const donut = renderDonutSvg({
      counts: [5, 10],
      colors,
      centerColor: '#111827',
      textColor: '#f9fafb',
      shadow: false,
    })
    expect(donut.total).toBe(15)
    expect(donut.svg).toContain('fill="#111827"')
    expect(donut.svg).toContain('fill="#f9fafb"')
    expect(donut.svg).toContain('fill="#ff0000"')
    expect(donut.svg).not.toContain('drop-shadow')
    const transparent = renderDonutSvg({
      counts: [5, 10],
      colors,
      centerStyle: 'transparent',
      textHaloColor: '#112233',
    })
    expect(transparent.svg).toContain('stroke="#112233"')
  })

  it('keeps caller colour strings within SVG attributes', () => {
    const svg = renderDonutSvg({ counts: [1], colors: ['red"/><script>alert(1)</script><path fill="red'] }).svg
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('&quot;')
  })

  it('normalizes array and JSON map properties identically, retaining zero bands', () => {
    const fromArray = pieMarkerDonutProperties({ count: 7, bandCounts: [0, 7] }, colors)
    const fromJson = pieMarkerDonutProperties({ count: 7, bandCounts: '[0,7]' }, colors)
    expect(fromJson).toEqual(fromArray)
    expect(fromArray).toEqual({ point_count: 7, band0: 0, band1: 7 })
    expect(pieMarkerDonutProperties({ count: 7, bandCounts: 'malformed' }, colors)).toEqual({
      point_count: 7,
      band0: 0,
      band1: 0,
    })
    expect(getDonutRenderKey(fromArray, colors)).not.toBe(getDonutRenderKey({ ...fromArray, band1: 6 }, colors))
  })
})
