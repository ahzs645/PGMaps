import { describe, expect, it } from 'vitest'
import { normalizeBoundarySearchText, searchBoundaryCatalog, type BoundarySearchRecord } from './searchIndex'

const records: BoundarySearchRecord[] = [
  {
    id: 'watershed:watershedGroup:NECH',
    source: 'watershed',
    sourceLabel: 'Watershed boundaries',
    group: 'Natural / resource',
    level: 'watershedGroup',
    levelLabel: 'Watershed Group',
    code: 'NECH',
    name: 'Nechako River',
    bounds: [-125, 53, -122, 55],
    fields: [
      ['GNIS_NAME_1', 'Nechako River'],
      ['WATERSHED_GROUP_CODE', 'NECH'],
    ],
    searchText: normalizeBoundarySearchText(
      'Nechako River NECH Watershed boundaries Natural resource Watershed Group GNIS_NAME_1 WATERSHED_GROUP_CODE',
    ),
  },
  {
    id: 'bcHealth:lha:57',
    source: 'bcHealth',
    sourceLabel: 'Health boundaries',
    group: 'Administrative',
    level: 'lha',
    levelLabel: 'LHA',
    code: '57',
    name: 'Prince George',
    bounds: [-124, 53, -122, 55],
    fields: [['HLTH_AUTHORITY_NAME', 'Northern Health']],
    searchText: normalizeBoundarySearchText(
      'Prince George 57 Health boundaries Administrative LHA Northern Health HLTH_AUTHORITY_NAME',
    ),
  },
  {
    id: 'census:cd:5951',
    source: 'census',
    sourceLabel: 'Census boundaries',
    group: 'Administrative',
    level: 'cd',
    levelLabel: 'Census Division',
    code: '5951',
    name: 'Bulkley-Nechako',
    bounds: [-127, 53, -122, 56],
    fields: [['CDNAME', 'Bulkley-Nechako']],
    searchText: normalizeBoundarySearchText(
      'Bulkley-Nechako 5951 Census boundaries Administrative Census Division CDNAME',
    ),
  },
  {
    id: 'census:da:59510158',
    source: 'census',
    sourceLabel: 'Census boundaries',
    group: 'Administrative',
    level: 'da',
    levelLabel: 'Dissemination Area',
    code: '59510158',
    name: 'DA 59510158',
    bounds: [-127, 53, -122, 56],
    fields: [['parentCdName', 'Bulkley-Nechako']],
    searchText: normalizeBoundarySearchText('DA 59510158 Census boundaries Administrative Dissemination Area'),
  },
  {
    id: 'bcRfc:rfcSnowBasin:3',
    source: 'bcRfc',
    sourceLabel: 'BC RFC basins',
    group: 'Natural / resource',
    level: 'rfcSnowBasin',
    levelLabel: 'RFC Snow Basin',
    code: '3',
    name: 'Nechako',
    bounds: [-126, 53, -122, 56],
    fields: [['BASIN_NAME', 'Nechako']],
    searchText: normalizeBoundarySearchText('Nechako 3 BC RFC basins Natural resource RFC Snow Basin BASIN_NAME'),
  },
]

describe('boundary search index', () => {
  it('normalizes accents and punctuation', () => {
    expect(normalizeBoundarySearchText('Rivière–du-Loup')).toBe('riviere du loup')
  })

  it('searches property text and reports the matching field', () => {
    const matches = searchBoundaryCatalog(records, 'Northern Health')
    expect(matches).toHaveLength(1)
    expect(matches[0].record.id).toBe('bcHealth:lha:57')
    expect(matches[0].matchedField).toEqual(['HLTH_AUTHORITY_NAME', 'Northern Health'])
  })

  it('applies category, source, and level filters', () => {
    expect(searchBoundaryCatalog(records, 'river', { group: 'Administrative' })).toEqual([])
    expect(
      searchBoundaryCatalog(records, 'nechako', { source: 'watershed', level: 'watershedGroup' })[0].record.code,
    ).toBe('NECH')
  })

  it('does not match a descendant through inherited hierarchy metadata', () => {
    expect(searchBoundaryCatalog(records, 'Bulkley-Nechako').map(({ record }) => record.id)).toEqual([
      'census:cd:5951',
    ])
    expect(searchBoundaryCatalog(records, '59510158').map(({ record }) => record.id)).toEqual([
      'census:da:59510158',
    ])
  })

  it('ranks an exact code before a property-only match', () => {
    const duplicateCode = {
      ...records[1],
      id: 'bcHealth:lha:NECH',
      code: 'NECH',
      name: 'Example',
      searchText: normalizeBoundarySearchText('Example NECH'),
    }
    const matches = searchBoundaryCatalog([...records, duplicateCode], 'NECH')
    expect(matches[0].record.id).toBe('bcHealth:lha:NECH')
  })

  it('can require a value to start with the query', () => {
    const matches = searchBoundaryCatalog(records, 'Nechako', { match: 'startsWith' })
    expect(matches.map(({ record }) => record.name)).toEqual(['Nechako', 'Nechako River'])
  })

  it('can require an exact field value', () => {
    const matches = searchBoundaryCatalog(records, 'Nechako', { match: 'exact' })
    expect(matches.map(({ record }) => record.name)).toEqual(['Nechako'])
  })
})
