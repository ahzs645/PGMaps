import { describe, expect, it } from 'vitest'

import { SVG_LOGO_RASTER_PX, svgIntrinsicSize, svgRasterSize } from './svgLogo'

describe('an SVG logo', () => {
  it('takes its shape from width and height, or from the viewBox', () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50">')).toEqual({
      width: 200,
      height: 50,
    })
    expect(svgIntrinsicSize('<?xml version="1.0"?><svg viewBox="0 0 400 100"><path/></svg>')).toEqual({
      width: 400,
      height: 100,
    })
    expect(svgIntrinsicSize("<svg width='30mm' height='10mm'>")).toEqual({
      width: (30 * 96) / 25.4,
      height: (10 * 96) / 25.4,
    })
  })

  it('reads one stated side with the viewBox, and ignores relative sizes', () => {
    expect(svgIntrinsicSize('<svg width="100" viewBox="0,0,400,100">')).toEqual({ width: 100, height: 25 })
    expect(svgIntrinsicSize('<svg width="100%" height="100%" viewBox="0 0 3 1">')).toEqual({ width: 3, height: 1 })
    expect(svgIntrinsicSize('<svg width="100%">')).toBeNull()
    expect(svgIntrinsicSize('<svg viewBox="0 0 0 10">')).toBeNull()
    expect(svgIntrinsicSize('not an svg')).toBeNull()
  })

  it('becomes a PNG with its longer side at the raster size, keeping its shape', () => {
    expect(svgRasterSize({ width: 400, height: 100 })).toEqual({ width: SVG_LOGO_RASTER_PX, height: 300 })
    expect(svgRasterSize({ width: 3, height: 1 })).toEqual({ width: 1200, height: 400 })
    expect(svgRasterSize({ width: 1, height: 5000 })).toEqual({ width: 1, height: 1200 })
  })
})
