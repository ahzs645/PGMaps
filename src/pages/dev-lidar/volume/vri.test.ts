import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'
import { VRI_BASELINE_RULES } from '@/lib/forestry/vriVolume'
import { checkVriVolumeData, vriRows, vriTotals, vriVolumeQueryUrl, type VriVolumeData } from './vri'
const data: VriVolumeData = JSON.parse(readFileSync(new URL('./vri.generated.json', import.meta.url), 'utf8'))
const rawBytes = readFileSync(new URL('../../../../scripts/lidar/sources/volume-vri.geojson', import.meta.url))
const raw = JSON.parse(rawBytes.toString())
describe('VRI volume snapshot and area accounting', () => {
  it('reuses the forestry WFS, bounds convention and narrowed fields', () => {
    const url = new URL(vriVolumeQueryUrl([-122.825079, 53.887458, -122.799934, 53.900052]))
    expect(url.searchParams.has('bbox')).toBe(false)
    expect(url.searchParams.get('CQL_FILTER')).toContain(
      "BBOX(GEOMETRY,-122.825079,53.887458,-122.799934,53.900052,'EPSG:4326')",
    )
    expect(url.searchParams.get('typeName')).toContain('VEG_COMP_LYR_R1_POLY')
    expect(url.searchParams.get('propertyName')).toContain('LIVE_STAND_VOLUME_175')
    expect(url.searchParams.get('propertyName')!.split(',').length).toBeLessThan(25)
  })
  it('matches the pinned full response, preserves attributes and refuses another LiDAR source', () => {
    expect(checkVriVolumeData(data, data.source_sha256)).toBe(data)
    expect(() => checkVriVolumeData(data, 'another source')).toThrow('source mismatch')
    expect(createHash('sha256').update(rawBytes).digest('hex')).toBe(data.source.inventory_sha256)
    const detail = JSON.parse(readFileSync(new URL('../height-detail.generated.json', import.meta.url), 'utf8'))
    expect(data.height_sha256).toBe(detail.input_sha256['height-1m.tif'])
    expect(raw.numberMatched).toBe(raw.features.length)
    expect(raw.features.length).toBe(40)
    expect(data.stands.features).toHaveLength(30)
    for (const f of data.stands.features)
      expect(f.properties.inventory).toEqual(
        raw.features.find(
          (r: { properties: { FEATURE_ID: number } }) =>
            String(r.properties.FEATURE_ID) === String(f.properties.inventory.FEATURE_ID),
        ).properties,
      )
  })
  it('independently reprojects piece rings to BC Albers and reconciles holes, coverage and net volume', () => {
    const albers =
      '+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs'
    const ringArea = (ring: number[][]) => {
      const ps = ring.map((p) => proj4('EPSG:4326', albers, p)),
        origin = ps[0]
      return (
        Math.abs(
          ps.slice(1).reduce((sum, b, i) => {
            const a = ps[i]
            return sum + (a[0] - origin[0]) * (b[1] - origin[1]) - (b[0] - origin[0]) * (a[1] - origin[1])
          }, 0),
        ) / 2
      )
    }
    for (const f of data.stands.features) {
      const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      const area =
        polygons.reduce(
          (sum, rings) => sum + ringArea(rings[0]) - rings.slice(1).reduce((s, r) => s + ringArea(r), 0),
          0,
        ) / 10000
      expect(area).toBeCloseTo(f.properties.area_ha, 5)
    }
    const total = vriTotals(vriRows(data, VRI_BASELINE_RULES))
    expect(total.known_net_m3).toBeCloseTo(36795.93292, 4)
    expect(total.area_ha).toBeCloseTo(169.3886322, 6)
    expect(total.mean_m3_ha).toBeCloseTo(total.known_net_m3! / total.area_ha, 8)
    expect(data.coverage.treed_ha + data.coverage.non_treed_ha + data.coverage.unmapped_ha).toBeCloseTo(
      data.coverage.supported_ha,
      7,
    )
  })
  it('withholds absent utilization, preserves partial dead coverage and never applies a second defect deduction', () => {
    const unavailable = vriTotals(vriRows(data, { ...VRI_BASELINE_RULES, utilization: 225 }))
    expect(unavailable.known_net_m3).toBeNull()
    expect(unavailable.mean_m3_ha).toBeNull()
    const baseline = vriTotals(vriRows(data, VRI_BASELINE_RULES)),
      dead = vriTotals(vriRows(data, { ...VRI_BASELINE_RULES, dead: 'full' }))
    expect(dead.partial_dead_ha).toBeGreaterThan(0)
    expect(dead.known_net_m3!).toBeGreaterThan(baseline.known_net_m3!)
    const scenario = vriTotals(vriRows(data, VRI_BASELINE_RULES), 20, 90)
    expect(scenario.scenario_recovered_m3).toBeCloseTo(baseline.known_net_m3! * 0.72, 7)
    expect(vriTotals([]).known_net_m3).toBeNull()
  })
})
