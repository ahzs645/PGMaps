import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { fetchJson } from '@/lib/fetchJson'
import { loadStudyAreaRegions } from './regions'
import { getDefaultLevelForSource, getLevelOptionsForSource, isValidLevelForSource } from './options'
import { parseBoundarySource, parseCensusBoundaryLevel } from '@/maps/scorebuilder/lib/urlState'

vi.mock('@/lib/fetchJson', () => ({ fetchJson: vi.fn() }))

describe('BC economic-region snapshot integration', () => {
  it('loads all eight regions with stable selection IDs and preserves the official CD memberships', async () => {
    const base = 'vendor/bcdatamapper/datascrapers/bc/boundaries/output/StatCan/bc_economic_regions_2021'
    const collection = JSON.parse(gunzipSync(readFileSync(`${base}.geojson.gz`)).toString())
    vi.mocked(fetchJson).mockResolvedValue(collection)
    const regions = await loadStudyAreaRegions('economicRegion', 'economicRegion')
    expect(fetchJson).toHaveBeenCalledWith('/data/boundaries/StatCan/bc_economic_regions_2021.geojson.gz', undefined)
    expect(regions.map(region => region.code).sort()).toEqual(['5910', '5920', '5930', '5940', '5950', '5960', '5970', '5980'])
    expect(regions.find(region => region.code === '5950')).toMatchObject({
      id: 'economicRegion:economicRegion:5950', name: 'Cariboo', source: 'economicRegion', level: 'economicRegion',
      feature: { properties: { censusDivisionCodes: ['5941', '5953'] } },
    })
    expect(regions.every(region => region.areaKm2 > 0 && region.bounds.every(Number.isFinite))).toBe(true)
    expect(isValidLevelForSource('economicRegion', 'economicRegion')).toBe(true)
    expect(isValidLevelForSource('census', 'economicRegion')).toBe(false)
    expect(getDefaultLevelForSource('census')).toBe('cd')
    expect(getLevelOptionsForSource('economicRegion').map(option => option.value)).toEqual(['economicRegion'])
    expect(parseBoundarySource('economicRegion')).toBe('economicRegion')
    expect(isValidLevelForSource('regionalDistrict', 'economicRegion')).toBe(false)
    expect(parseCensusBoundaryLevel('economicRegion')).toBe('ct')
    await expect(loadStudyAreaRegions('census', 'economicRegion')).rejects.toThrow('Invalid census boundary level')
  })
})
