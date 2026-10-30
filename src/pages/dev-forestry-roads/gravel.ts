import type { SurfacingSupply } from './engineeringTypes'

export const GRAVEL_DATA_GUIDE =
  'https://www2.gov.bc.ca/gov/content/industry/mineral-exploration-mining/mineral-titles/data-gis/dataset-descriptions-download'
export const GRAVEL_PERMIT_GUIDE =
  'https://www2.gov.bc.ca/gov/content/industry/mineral-exploration-mining/permitting/mine-exploration/sand-gravel-permits'

/** Placeholder scenario only: none of these zero rates are a supplier quote. */
export function createSurfacingSupply(): SurfacingSupply {
  return {
    enabled: false,
    name: 'Nearby aggregate scenario',
    acquisitionRate: 0,
    processingRate: 0,
    loadingRate: 0,
    haulDistanceKm: 1,
    haulRate: 0,
    placementRate: 0,
    capacityM3: 1000,
    sourceNotes: '',
  }
}

/** A zero acquisition price leaves processing, loading, haul and placement intact. */
export function deliveredSurfacingRate(source: SurfacingSupply): number {
  return (
    source.acquisitionRate +
    source.processingRate +
    source.loadingRate +
    source.haulDistanceKm * source.haulRate +
    source.placementRate
  )
}

export function surfacingSupplyCost(volumeM3: number, baseRate: number, source?: SurfacingSupply) {
  const suppliedM3 = source?.enabled ? Math.min(volumeM3, source.capacityM3 ?? Infinity) : 0
  const fallbackM3 = Math.max(0, volumeM3 - suppliedM3)
  const rate = source ? deliveredSurfacingRate(source) : baseRate
  return { suppliedM3, fallbackM3, rate, cost: suppliedM3 * rate + fallbackM3 * baseRate }
}
