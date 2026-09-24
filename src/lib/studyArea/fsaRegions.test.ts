import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { getDefaultLevelForSource, getLevelOptionsForSource, isValidLevelForSource } from './options'
import { loadStudyAreaRegions } from './regions'
import { fetchJson } from '@/lib/fetchJson'

vi.mock('@/lib/fetchJson', () => ({ fetchJson: vi.fn() }))

describe('shared 2021 BC FSA boundary layer', () => {
  it('loads the real compressed snapshot through the shared postal loader with stable codes', async () => {
    const collection = JSON.parse(gunzipSync(readFileSync(
      'vendor/bcdatamapper/datascrapers/bc/boundaries/output/StatCan/bc_fsa_2021.geojson.gz',
    )).toString())
    vi.mocked(fetchJson).mockResolvedValue(collection)
    const regions = await loadStudyAreaRegions('postal', 'fsa')
    expect(fetchJson).toHaveBeenCalledWith('/data/boundaries/StatCan/bc_fsa_2021.geojson.gz', undefined)
    expect(regions).toHaveLength(191)
    expect(new Set(regions.map(region => region.code)).size).toBe(191)
    expect(regions.find(region => region.code === 'V2L')).toMatchObject({
      id: 'postal:fsa:V2L', name: 'FSA V2L', source: 'postal', level: 'fsa',
    })
    expect(regions.every(region => region.areaKm2 > 0)).toBe(true)
    expect(regions.some(region => region.code === 'V7X' || region.code === 'V7Y')).toBe(false)
    expect(getLevelOptionsForSource('postal').some(option => option.value === 'fsa')).toBe(true)
    expect(isValidLevelForSource('postal', 'fsa')).toBe(true)
    expect(isValidLevelForSource('bcHealth', 'fsa')).toBe(false)
    expect(isValidLevelForSource('census', 'fsa')).toBe(false)
    expect(getDefaultLevelForSource('postal')).toBe('postalRegion')
  })
  it('loads the postal parent separately from the same boundary version', async () => {
    const collection = JSON.parse(gunzipSync(readFileSync(
      'vendor/bcdatamapper/datascrapers/bc/boundaries/output/StatCan/bc_postal_region_2021.geojson.gz',
    )).toString())
    vi.mocked(fetchJson).mockResolvedValue(collection)
    const regions = await loadStudyAreaRegions('postal', 'postalRegion')
    expect(regions).toHaveLength(1)
    expect(regions[0]).toMatchObject({ id: 'postal:postalRegion:V', code: 'V', source: 'postal' })
    expect(regions[0].feature.properties?.childCount).toBe(191)
    expect(getLevelOptionsForSource('postal').map(option => option.value)).toEqual(['postalRegion', 'postalPrefix2', 'fsa'])
  })
  it('loads two-character groups as a distinct level with every FSA counted once', async () => {
    const collection = JSON.parse(gunzipSync(readFileSync(
      'vendor/bcdatamapper/datascrapers/bc/boundaries/output/StatCan/bc_postal_prefix2_2021.geojson.gz',
    )).toString())
    vi.mocked(fetchJson).mockResolvedValue(collection)
    const regions = await loadStudyAreaRegions('postal', 'postalPrefix2')
    expect(fetchJson).toHaveBeenCalledWith('/data/boundaries/StatCan/bc_postal_prefix2_2021.geojson.gz', undefined)
    expect(regions.map(region => region.code).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `V${i}`))
    expect(regions.find(region => region.code === 'V2')).toMatchObject({ id: 'postal:postalPrefix2:V2', name: 'Postal prefix V2' })
    expect(regions.reduce((sum, region) => sum + Number(region.feature.properties?.childCount), 0)).toBe(191)
    expect(regions.every(region => region.feature.properties?.parentCode === 'V')).toBe(true)
  })
})
