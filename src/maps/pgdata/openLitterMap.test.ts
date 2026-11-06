import { describe, expect, it } from 'vitest'
import { buildLitterBands, buildLitterClusterData } from './openLitterMap'

type LitterFeatures = Parameters<typeof buildLitterBands>[0]

function record(id: number, categoryNames: string[], litterCount = 1): LitterFeatures[number] {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-122.75, 53.92] },
    properties: { id, sourceId: id, categoryNames, litterCount, datetime: '2024-05-02T12:00:00.000Z' },
  } as LitterFeatures[number]
}

const FEATURES = [
  record(1, ['food']),
  record(2, ['food']),
  record(3, ['alcohol', 'smoking'], 3),
  record(4, ['smoking']),
  record(5, []),
]

function clusterProperties(selectedCategory: string) {
  const { categories } = buildLitterBands(FEATURES)
  const collection = buildLitterClusterData(FEATURES, categories, selectedCategory)
  return collection.features.map((feature) => feature.properties as Record<string, unknown>)
}

describe('buildLitterBands', () => {
  it('orders categories most common first and keeps untagged records', () => {
    expect(buildLitterBands(FEATURES).categories).toEqual(['food', 'smoking', 'alcohol', 'Unknown'])
  })

  it('keeps a record on its band when the records around it are filtered out', () => {
    const { categories } = buildLitterBands(FEATURES)
    const filtered = buildLitterClusterData(FEATURES.slice(0, 2), categories, 'all')
    expect(filtered.features.map((feature) => feature.properties?.bandIndex)).toEqual([0, 0])
  })

  it('gives every category in the extract its own wedge colour', () => {
    const extract = [
      'food',
      'smoking',
      'softdrinks',
      'coffee',
      'other',
      'alcohol',
      'sanitary',
      'marine',
      'industrial',
      'Unknown',
    ]
    const { colors } = buildLitterBands(extract.map((category, index) => record(index, [category])))
    expect(new Set(colors).size).toBe(extract.length)
  })
})

describe('buildLitterClusterData', () => {
  it('bands an unfiltered record by its leading category', () => {
    expect(clusterProperties('all').map((properties) => properties.bandIndex)).toEqual([0, 0, 2, 1, 3])
  })

  it('draws a record as the filtered category even when another tag leads', () => {
    const [mixedRecord] = clusterProperties('smoking').slice(2)
    expect(mixedRecord.bandIndex).toBe(1)
    expect(mixedRecord.color).toBe(buildLitterBands(FEATURES).colors[1])
  })

  it('labels records for the overlapping-record spider and list', () => {
    const properties = clusterProperties('all')
    expect(properties[2].featureKey).toBe('olm:3')
    expect(properties[2].spiderTitle).toBe('Alcohol, Smoking · 3 items')
    expect(properties[0].spiderTitle).toBe('Food · 1 item')
    expect(properties[4].spiderTitle).toBe('Unknown · 1 item')
    expect(properties[0].spiderSubtitle).toBeTruthy()
  })
})
