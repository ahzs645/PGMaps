import { describe, expect, it } from 'vitest'
import { crossDrainSiteGroups, CROSS_DRAIN_SITE_M } from './hydrology'
import type { DitchLowPoint } from './hydrology'

type Outlet = Omit<DitchLowPoint, 'id' | 'sides' | 'fromChainage' | 'toChainage' | 'outlets'>
const outlet = (chainage: number, patch: Partial<Outlet> = {}): Outlet => ({
  kind: 'outlet',
  side: 'left',
  chainage,
  coordinate: [-121.5, 54],
  areaHa: 0.1,
  depthM: 0,
  culvertId: null,
  throughCulvert: false,
  ...patch,
})

describe('crossDrainSiteGroups', () => {
  it('joins outlets along the road into one site at its largest, across both sides', () => {
    const sites = crossDrainSiteGroups([
      outlet(130, { side: 'right', areaHa: 0.4 }),
      outlet(100),
      outlet(150, { kind: 'pond', depthM: 0.3 }),
      outlet(400),
    ])
    expect(sites).toHaveLength(2)
    expect(sites[0]).toMatchObject({
      chainage: 130,
      side: 'right',
      sides: ['left', 'right'],
      fromChainage: 100,
      toChainage: 150,
      outlets: 3,
      areaHa: 0.4,
      depthM: 0.3,
    })
    expect(sites[1]).toMatchObject({ chainage: 400, fromChainage: 400, toChainage: 400, outlets: 1 })
  })

  it('chains outlets each within the site distance of the last', () => {
    // An outlet on every 22 m cell along a stretch is one stretch, not one site per cell.
    const cells = Array.from({ length: 20 }, (_, i) => outlet(i * 22.4))
    const [site, ...rest] = crossDrainSiteGroups(cells)
    expect(rest).toHaveLength(0)
    expect(site.toChainage - site.fromChainage).toBeCloseTo(19 * 22.4, 6)
    expect(crossDrainSiteGroups([outlet(0), outlet(CROSS_DRAIN_SITE_M + 0.1)])).toHaveLength(2)
  })

  it('never lets flow a culvert carries hide flow it does not', () => {
    const sites = crossDrainSiteGroups([outlet(100, { throughCulvert: true, culvertId: 'c1', areaHa: 3 }), outlet(110)])
    expect(sites.map((s) => s.throughCulvert)).toEqual([true, false])
    expect(sites.find((s) => !s.throughCulvert)?.areaHa).toBe(0.1)
  })
})
