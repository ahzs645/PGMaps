import { describe, expect, it } from 'vitest'

import {
  cellSiteTooltipRows,
  countSitesByGroup,
  filterCellSites,
  operatorGroupId,
  visibleGroupsAtSite,
  type CellSiteCollection,
  type CellSiteProperties,
} from './cellSites'

function site(operators: string[], extra: Partial<CellSiteProperties> = {}): CellSiteProperties {
  return {
    province: 'BC',
    location: null,
    siteTypes: ['O'],
    structureTypes: ['T'],
    heightM: null,
    lastChanged: null,
    operators,
    technologies: ['LTE'],
    bands: ['PCS'],
    records: operators.length,
    byOperator: Object.fromEntries(operators.map(operator => [operator, { technologies: ['LTE'], bands: ['PCS'] }])),
    ...extra,
  }
}

const collection: CellSiteCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.7, 53.9] }, properties: site(['TELUS', 'Bell']) },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.8, 53.9] }, properties: site(['Railway Association of Canada']) },
  ],
}

describe('ISED cell sites', () => {
  it('folds licensees outside the named brands into Other', () => {
    expect(operatorGroupId('Rogers')).toBe('Rogers')
    expect(operatorGroupId('SSI Micro Ltd.')).toBe('other')
  })

  it('colours a shared mast by draw priority, not by the order operators are listed', () => {
    const groups = visibleGroupsAtSite(collection.features[0].properties, new Set(['TELUS', 'Bell']))
    expect(groups.map(group => group.id)).toEqual(['Bell', 'TELUS'])
  })

  it('keeps a site while any of its operators is visible', () => {
    expect(filterCellSites(collection, new Set(['TELUS']))).toHaveLength(1)
    expect(filterCellSites(collection, new Set(['other']))).toHaveLength(1)
    expect(filterCellSites(collection, new Set(['Rogers']))).toHaveLength(0)
    expect(filterCellSites(null, new Set(['Bell']))).toEqual([])
  })

  it('sums manifest site counts into groups', () => {
    const counts = countSitesByGroup({ operators: { Bell: 10, 'SSI Micro Ltd.': 2, 'Railway Association of Canada': 3 } })
    expect(counts.get('Bell')).toBe(10)
    expect(counts.get('other')).toBe(5)
  })

  it('describes structure and site type in words where the code is known', () => {
    const rows = Object.fromEntries(cellSiteTooltipRows(site(['Bell'], { structureTypes: ['R', 'S'], heightM: 12, siteTypes: ['I'] })))
    expect(rows.Structure).toBe('Rooftop / S · 12 m')
    expect(rows.Site).toBe('Indoor')
    expect(rows.Bell).toBe('LTE · PCS')
  })
})
