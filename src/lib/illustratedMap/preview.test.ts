import { describe, expect, it } from 'vitest'
import { buildPreviewSvg } from './preview'

describe('illustrated SVG preview', () => {
  it('batches matching hatch styles while preserving the exact independent subpaths', () => {
    const start = '<g data-generator="contour-hatch-v3" fill="none" stroke="currentColor" stroke-linecap="round">'
    const a = 'M1 2C3 4 5 6 7 8'
    const b = 'M9 10C11 12 13 14 15 16'
    const c = 'M20 21C22 23 24 25 26 27'
    const illustration = '<path id="bear" d="M0 0L1 1" stroke-width="1.5"/>'
    const svg = `<svg>${illustration}${start}<path d="${a}" stroke-width="1.5"/><path d="${b}" stroke-width="1.6"/><path d="${c}" stroke-width="1.5"/></g></svg>`
    const preview = buildPreviewSvg(svg)
    expect(preview).toContain(illustration)
    expect(preview).toContain(start)
    expect(preview).toContain(`<path d="${a} ${c}" stroke-width="1.5"/>`)
    expect(preview).toContain(`<path d="${b}" stroke-width="1.6"/>`)
    expect(buildPreviewSvg(preview)).toBe(preview)
    expect(svg.match(/<path /g)?.length).toBe(4)
  })

  it('leaves unknown per-stroke compositing and non-hatch geometry unchanged', () => {
    const svg = '<svg><g data-generator="contour-hatch-v3"><path d="M1 2L3 4" stroke-width="1" opacity=".5"/></g></svg>'
    expect(buildPreviewSvg(svg)).toBe(svg)
    expect(buildPreviewSvg('<svg><path d="M0 0L1 1"/></svg>')).toBe('<svg><path d="M0 0L1 1"/></svg>')
  })
})
