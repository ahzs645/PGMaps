/**
 * The rate each cost item was priced at, in words, for printing beside the item (the report
 * package's cost breakdown). Read from the same inputs `engineering.ts` prices with, so a rate never
 * disagrees with its cost: material excavation rates, the fill, surfacing and clearing rates, the
 * surfacing source, culvert installed costs and the haul, borrow and waste rates. No DOM access.
 */
import type { EngineeringCosts } from './engineeringTypes'
import { deliveredSurfacingRate } from './gravel'
import type { Alignment, RoadAnalysis, RoadSettings } from './types'

export type CostRates = Partial<Record<keyof EngineeringCosts, string>>
type BaseRates = Pick<RoadSettings, 'cutRate' | 'fillRate' | 'surfacingRate' | 'clearingRate'>

/**
 * The base estimate of a road with no engineering inputs, as `engine.ts` adds it up: cut, fill,
 * surfacing and clearing at the project's rates, plus any crossing estimate. Haul, borrow, waste,
 * culverts, site preparation, mobilization and contingency are not priced, so they are zero here.
 */
export function baseCosts(
  analysis: Pick<
    RoadAnalysis,
    'cutVolumeM3' | 'fillVolumeM3' | 'surfaceVolumeM3' | 'clearingAreaM2' | 'estimatedCost' | 'crossingEstimate'
  >,
  settings: BaseRates,
): EngineeringCosts {
  return {
    cut: analysis.cutVolumeM3 * settings.cutRate,
    stripping: 0,
    fill: analysis.fillVolumeM3 * settings.fillRate,
    surfacing: analysis.surfaceVolumeM3 * settings.surfacingRate,
    clearing: analysis.clearingAreaM2 * settings.clearingRate,
    structures: analysis.crossingEstimate?.incrementalSubtotal ?? 0,
    haul: 0,
    borrow: 0,
    waste: 0,
    sitePreparation: 0,
    mobilization: 0,
    subtotal: analysis.estimatedCost,
    contingency: 0,
    total: analysis.estimatedCost,
  }
}

const money = (value: number) => {
  const cents = Math.abs(value - Math.round(value)) > 0.004
  return `$${value.toLocaleString('en-CA', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`
}
const range = (values: number[], unit: string) => {
  const distinct = [...new Set(values.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b)
  if (!distinct.length) return ''
  return distinct.length === 1
    ? `${money(distinct[0])}${unit}`
    : `${money(distinct[0])}–${money(distinct[distinct.length - 1])}${unit}`
}

/** The assumed rate of each item the road's costs hold; an item without a single entered rate says how it was priced. */
export function costRates(
  alignment: Pick<Alignment, 'engineering'>,
  settings: BaseRates,
  analysis: Pick<RoadAnalysis, 'engineering'>,
): CostRates {
  const e = alignment.engineering
  const quantities = analysis.engineering
  // Without engineering inputs the road is priced at the project's base rates only (`baseCosts`).
  if (!e || !quantities)
    return {
      cut: `${money(settings.cutRate)}/m³ (project rate)`,
      fill: `${money(settings.fillRate)}/m³`,
      surfacing: `${money(settings.surfacingRate)}/m³`,
      clearing: `${money(settings.clearingRate)}/m² (${money(settings.clearingRate * 10_000)}/ha)`,
      structures: 'crossing estimates',
    }
  const materialRates = (purpose: 'earthwork' | 'stripping') => {
    const used = quantities.materials.filter((m) => m.purpose === purpose && m.bankCutM3 > 0)
    const rated = used.flatMap((m) => {
      // Ground no material covers is priced as unclassified excavation at the project's cut rate.
      const material = e.materials.find((g) => g.id === m.materialId)
      return [
        material ? { name: material.name, rate: material.cutRate } : { name: 'Unclassified', rate: settings.cutRate },
      ]
    })
    if (!rated.length) return undefined
    const distinct = new Set(rated.map((r) => r.rate))
    return distinct.size === 1
      ? `${money(rated[0].rate)}/bank m³`
      : rated.map((r) => `${r.name} ${money(r.rate)}`).join(', ') + ' /bank m³'
  }
  const supply = e.surfacingSupply
  const haul = e.haul
  const culverts = e.culverts
  return {
    cut: materialRates('earthwork'),
    stripping: materialRates('stripping'),
    fill: `${money(settings.fillRate)}/m³ placed`,
    surfacing: supply?.enabled
      ? `${money(deliveredSurfacingRate(supply))}/m³ delivered from ${supply.name || 'the entered source'}${
          supply.capacityM3 === null ? '' : `; ${money(settings.surfacingRate)}/m³ beyond its capacity`
        }`
      : `${money(settings.surfacingRate)}/m³`,
    clearing: `${money(settings.clearingRate)}/m² (${money(settings.clearingRate * 10_000)}/ha)`,
    structures: culverts.length
      ? `${range(
          culverts.map((c) => c.unitCost),
          '/m installed',
        )}${
          culverts.some((c) => c.fixedCost)
            ? ` + ${range(
                culverts.filter((c) => c.fixedCost).map((c) => c.fixedCost),
                ' fixed',
              )}`
            : ''
        }`
      : undefined,
    haul: `free haul ${haul.freeHaulDistanceM.toLocaleString('en-CA')} m; overhaul ${money(haul.overhaulRate)}/m³/km; end haul ${money(
      haul.endHaulRate,
    )}/m³/km + ${money(haul.endHaulLoadingRate)}/m³ loading`,
    borrow: `${money(haul.borrowRate)}/compacted m³${e.sites.some((s) => s.kind === 'borrow' && s.unitRate) ? " or the site's rate" : ''}`,
    waste: `${money(haul.wasteRate)}/bank m³${e.sites.some((s) => s.kind === 'waste' && s.unitRate) ? " or the site's rate" : ''}`,
    sitePreparation: 'entered preparation ranges',
    mobilization: 'lump sum',
    contingency: `${haul.contingencyPercent.toLocaleString('en-CA')}% of the subtotal`,
  }
}
