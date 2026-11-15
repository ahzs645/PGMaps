import { describe, expect, it } from 'vitest'
import { costRates } from './costRates'
import type { Alignment, RoadAnalysis } from './types'

const engineering = {
  materials: [
    { id: 'till', name: 'Till', cutRate: 6 },
    { id: 'rock', name: 'Rock', cutRate: 25 },
    { id: 'organic', name: 'Organic', cutRate: 4, purpose: 'stripping' },
  ],
  culverts: [
    { unitCost: 180, fixedCost: 0 },
    { unitCost: 320, fixedCost: 0 },
  ],
  sites: [],
  haul: {
    freeHaulDistanceM: 25,
    overhaulRate: 4,
    endHaulRate: 1.5,
    endHaulLoadingRate: 3,
    borrowRate: 8,
    wasteRate: 2,
    contingencyPercent: 15,
  },
} as unknown as Alignment['engineering']
const analysis = (materials: { materialId: string; purpose: string; bankCutM3: number }[]) =>
  ({ engineering: { materials } }) as unknown as RoadAnalysis
const settings = { cutRate: 12, fillRate: 4, surfacingRate: 30, clearingRate: 0.8 }

describe('cost rates', () => {
  it('prints each item at the rate its cost was priced with', () => {
    const rates = costRates(
      { engineering },
      settings,
      analysis([
        { materialId: 'till', purpose: 'earthwork', bankCutM3: 1000 },
        { materialId: 'organic', purpose: 'stripping', bankCutM3: 200 },
      ]),
    )
    expect(rates.cut).toBe('$6/bank m³')
    expect(rates.stripping).toBe('$4/bank m³')
    expect(rates.fill).toBe('$4/m³ placed')
    expect(rates.surfacing).toBe('$30/m³')
    expect(rates.clearing).toBe('$0.80/m² ($8,000/ha)')
    expect(rates.structures).toBe('$180–$320/m installed')
    expect(rates.haul).toBe('free haul 25 m; overhaul $4/m³/km; end haul $1.50/m³/km + $3/m³ loading')
    expect(rates.borrow).toBe('$8/compacted m³')
    expect(rates.contingency).toBe('15% of the subtotal')
  })

  it('names each material when the excavation used more than one rate', () => {
    const rates = costRates(
      { engineering },
      settings,
      analysis([
        { materialId: 'till', purpose: 'earthwork', bankCutM3: 1000 },
        { materialId: 'rock', purpose: 'earthwork', bankCutM3: 50 },
      ]),
    )
    expect(rates.cut).toBe('Till $6, Rock $25 /bank m³')
    expect(rates.stripping).toBeUndefined()
  })

  it('prices ground no material covers at the project cut rate, as the engineering cost does', () => {
    const rates = costRates(
      { engineering },
      settings,
      analysis([{ materialId: '__unclassified', purpose: 'earthwork', bankCutM3: 1000 }]),
    )
    expect(rates.cut).toBe('$12/bank m³')
  })
})

describe('a road priced without engineering inputs', () => {
  it('splits the base estimate by item at the project rates and names them', async () => {
    const { baseCosts, costRates } = await import('./costRates')
    const settings = { cutRate: 12, fillRate: 8, surfacingRate: 40, clearingRate: 1.5 }
    const analysis = {
      cutVolumeM3: 100,
      fillVolumeM3: 50,
      surfaceVolumeM3: 10,
      clearingAreaM2: 1000,
      estimatedCost: 100 * 12 + 50 * 8 + 10 * 40 + 1000 * 1.5 + 700,
      crossingEstimate: { incrementalSubtotal: 700 } as never,
    }
    const costs = baseCosts(analysis, settings)
    expect(costs).toMatchObject({ cut: 1200, fill: 400, surfacing: 400, clearing: 1500, structures: 700, haul: 0 })
    expect(costs.cut + costs.fill + costs.surfacing + costs.clearing + costs.structures).toBe(costs.total)
    expect(costs.contingency).toBe(0)
    expect(costRates({ engineering: undefined }, settings, { engineering: undefined })).toMatchObject({
      cut: '$12/m³ (project rate)',
      fill: '$8/m³',
      clearing: '$1.50/m² ($15,000/ha)',
    })
  })
})
