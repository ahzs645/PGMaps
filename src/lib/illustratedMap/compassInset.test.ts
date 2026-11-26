import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'
import bcInset from './bcInset.generated.json'
import { COMPASS_INSET_FROM_ALBERS, compassWithInsetAccent } from './symbols'

const toAlbers = proj4('EPSG:4326', bcInset.provenance.workingProj4)
const vertices = bcInset.parts[0].d
  .match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g)!
  .map((pair) => pair.split(',').map(Number))

describe('compass inset placement', () => {
  it('puts BC corners from BC Albers on the inset’s own corner vertices', () => {
    const { scale, x, y } = COMPASS_INSET_FROM_ALBERS
    expect(scale).toBe(bcInset.provenance.uniformScale)
    for (const corner of [
      [-114.0683, 49],
      [-120, 60],
    ]) {
      const [easting, northing] = toAlbers.forward(corner)
      const point = [scale * easting + x, -scale * northing + y]
      const nearest = Math.min(...vertices.map(([vx, vy]) => Math.hypot(vx - point[0], vy - point[1])))
      expect(nearest).toBeLessThan(0.05)
    }
  })

  it('colours a given accent inside the province outline', () => {
    const accent = 'M 60,60 L 120,60 L 120,120 Z'
    const markup = compassWithInsetAccent(accent)
    expect(markup).toContain(accent)
    expect(markup).toContain('clip-path=')
  })
})
