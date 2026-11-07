import { describe, expect, it } from 'vitest'
import { terrainDisplayName } from './terrainName'

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
