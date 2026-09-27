import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { fetchJson } from '@/lib/fetchJson'
import { loadStudyAreaRegions } from './regions'
import { isValidLevelForSource } from './options'
import { parseCensusBoundaryLevel } from '@/maps/scorebuilder/lib/urlState'

vi.mock('@/lib/fetchJson', () => ({ fetchJson: vi.fn() }))

describe('BC economic-region snapshot integration', () => {
  it('loads all eight regions with stable selection IDs and preserves the official CD memberships', async () => {
    const base = 'vendor/bcdatamapper/datascrapers/bc/boundaries/output/StatCan/bc_economic_regions_2021'
    const collection = JSON.parse(gunzipSync(readFileSync(`${base}.geojson.gz`)).toString())
    vi.mocked(fetchJson).mockResolvedValue(collection)
    const regions = await loadStudyAreaRegions('census', 'economicRegion')
    expect(fetchJson).toHaveBeenCalledWith('/data/boundaries/StatCan/bc_economic_regions_2021.geojson.gz', undefined)
    expect(regions.map(region => region.code).sort()).toEqual(['5910', '5920', '5930', '5940', '5950', '5960', '5970', '5980'])
    expect(regions.find(region => region.code === '5950')).toMatchObject({
      id: 'census:economicRegion:5950', name: 'Cariboo', source: 'census', level: 'economicRegion',
      feature: { properties: { censusDivisionCodes: ['5941', '5953'] } },
    })
    expect(regions.every(region => region.areaKm2 > 0 && region.bounds.every(Number.isFinite))).toBe(true)
    expect(isValidLevelForSource('census', 'economicRegion')).toBe(true)
    expect(isValidLevelForSource('regionalDistrict', 'economicRegion')).toBe(false)
    expect(parseCensusBoundaryLevel('economicRegion')).toBe('economicRegion')
  })
})
