import { describe, expect, it } from 'vitest'
import { terrainCellLabel, terrainDisplayName } from './terrainName'

describe('terrainDisplayName', () => {
  it('drops an appended bounding box and keeps the rest', () => {
    expect(
      terrainDisplayName(
        'Regional Terrarium DEM · coarse screening · -120.48800,50.82800,-120.45200,50.85200 · 2 missing tiles',
      ),
    ).toBe('Regional Terrarium DEM · coarse screening · 2 missing tiles')
  })
  it('leaves names without coordinates alone', () => {
    expect(terrainDisplayName('Synthetic training hillside near Prince George')).toBe(
      'Synthetic training hillside near Prince George',
    )
  })
})

describe('terrainCellLabel', () => {
  it('rounds a cell size to what a reader needs', () => {
    expect(terrainCellLabel(22.522023480917692)).toBe('23 m cells')
    expect(terrainCellLabel(1)).toBe('1 m cells')
    expect(terrainCellLabel(0.5)).toBe('0.5 m cells')
    expect(terrainCellLabel(2.4999)).toBe('2.5 m cells')
  })
})
