import { hasCompleteCoverage } from './analysisResult'
import { haulCostLines } from './engineering'
import { surfacingSupplyCost } from './gravel'
import { DEFAULT_ROAD_SETTINGS } from './terrain'
import type { Alignment, RoadAnalysis, RoadSettings } from './types'
import { LEGACY_CULVERT_ASSOCIATION_M } from './crossingPlan'

type BaseRateKey = 'cutRate' | 'fillRate' | 'surfacingRate' | 'clearingRate'

export interface CostReviewFlag {
  id: string
  label: string
  detail: string
}

/** A quantity of work in the estimate that has no price, so it adds nothing to the total. */
export interface UnpricedQuantity {
  /** The cost breakdown row the quantity sits on (`data-cost-row`). */
  rowId: string
  /** What the work is, such as "stripping (Stripped overburden)". */
  item: string
  quantity: number
  unit: string
  /** The whole statement: "1,795 bank m³ of stripping (Stripped overburden) has no rate". */
  text: string
}

export interface CostReadinessAssessment {
  quantityCoverageComplete: boolean
  placeholderRates: BaseRateKey[]
  /**
   * Every quantity above zero whose rate is zero. Adding such work lowers nothing and prices
   * nothing, so an estimate that falls after it is added is missing a price, not cheaper.
   */
  unpriced: UnpricedQuantity[]
  /** Aggregate lower bound on covered fill demand, subject to the entered material assumptions. */
  minimumBorrowCompactedM3: number
  flags: CostReviewFlag[]
}

const EPS = 1e-6
const quantity = (value: number) => value.toLocaleString('en-CA', { maximumFractionDigits: 1 })

/**
 * Review prompts, not an estimate certification or a percentage of budget completeness.
 * Zero may mean unpriced, included elsewhere or deliberately excluded; the model cannot
 * distinguish those cases. This assessment never adds a cost or extrapolates missing sections.
 */
/** Stream crossings with no culvert recorded at that station. */
export function crossingsWithoutStructure(analysis: RoadAnalysis, engineering: Alignment['engineering']) {
  return analysis.crossings.filter(
    (crossing) =>
      crossing.kind === 'stream' &&
      !analysis.crossingEstimate?.rows.some(
        (row) =>
          row.status === 'current' &&
          row.record.structure !== 'undecided' &&
          row.record.featureId === crossing.featureId &&
          Math.abs(row.chainage - crossing.chainage) <= 0.01,
      ) &&
      !engineering?.culverts.some(
        (culvert) =>
          culvert.sourceFeatureId === crossing.featureId &&
          Math.abs(culvert.chainage - crossing.chainage) <= LEGACY_CULVERT_ASSOCIATION_M,
      ),
  )
}

/**
 * The quantities with no rate, in cost breakdown order. A zero rate is never replaced by an
 * assumed one: the amount stays zero and the quantity is named. Free haul inside the free-haul
 * distance, loading, sidecast and site fixed costs are entered scenarios and are not listed.
 */
export function unpricedQuantities(
  analysis: RoadAnalysis,
  alignment: Alignment,
  settings: RoadSettings,
): UnpricedQuantity[] {
  const result = analysis.engineering
  const engineering = alignment.engineering
  const list: UnpricedQuantity[] = []
  const add = (rowId: string, item: string, amount: number, unit: string, noun = 'rate') => {
    if (amount > EPS)
      list.push({ rowId, item, quantity: amount, unit, text: `${quantity(amount)} ${unit} of ${item} has no ${noun}` })
  }
  if (result)
    for (const material of result.materials) {
      const rate =
        material.materialId === '__unclassified'
          ? settings.cutRate
          : (engineering?.materials.find((m) => m.id === material.materialId)?.cutRate ?? 0)
      if (rate === 0)
        add(
          `material-${material.materialId}`,
          material.materialId === '__unclassified'
            ? 'unclassified excavation'
            : `${material.purpose === 'stripping' ? 'stripping' : 'excavation'} (${material.name})`,
          material.bankCutM3,
          'bank m³',
        )
    }
  else if (settings.cutRate === 0) add('cut', 'excavation', analysis.cutVolumeM3, 'bank m³')
  if (settings.fillRate === 0) add('fill', 'fill placement', analysis.fillVolumeM3, 'm³')
  const courses = result?.materialLayerVolumeM3 ?? 0
  const surfacing = surfacingSupplyCost(
    Math.max(0, analysis.surfaceVolumeM3 - courses),
    settings.surfacingRate,
    engineering?.surfacingSupply,
  )
  if (surfacing.rate === 0) add('surfacing-source', 'delivered surfacing aggregate', surfacing.suppliedM3, 'm³')
  if (settings.surfacingRate === 0) add('surfacing', 'surfacing', surfacing.fallbackM3, 'm³')
  if (settings.fillRate === 0) add('material-course-placement', 'material course placement', courses, 'm³')
  if (settings.clearingRate === 0) add('clearing', 'clearing', analysis.clearingAreaM2, 'm²')
  for (const culvert of result?.culverts ?? [])
    if (culvert.installedCost === 0 && !analysis.crossingEstimate?.replacedLegacyIds.includes(culvert.id))
      add('structures', `culvert (${culvert.name})`, culvert.barrelLengthM ?? 0, 'm', 'installed cost')
  if (result?.haul.enabled && engineering)
    for (const line of haulCostLines(engineering, result)) {
      if (line.rate !== 0) continue
      const supply = (line.group === 'borrow' || line.group === 'waste') && !line.id.startsWith('sidecast-')
      const distance = line.group === 'haul' && /^haul-(overhaul|endhaul)-/.test(line.id)
      if (supply || distance) add(line.id, line.item.toLowerCase(), line.quantity, line.unit)
    }
  return list
}

export function assessCostReadiness(
  analysis: RoadAnalysis,
  alignment: Alignment,
  settings: RoadSettings,
): CostReadinessAssessment {
  const result = analysis.engineering
  const engineering = alignment.engineering
  const flags: CostReviewFlag[] = []
  const unpriced = unpricedQuantities(analysis, alignment, settings)
  const quantityCoverageComplete = hasCompleteCoverage(analysis)
  const unclassified = result
    ? (result.materials.find((material) => material.materialId === '__unclassified')?.bankCutM3 ?? 0)
    : analysis.cutVolumeM3
  const supply = engineering?.surfacingSupply
  const surfacing = surfacingSupplyCost(
    Math.max(0, analysis.surfaceVolumeM3 - (result?.materialLayerVolumeM3 ?? 0)),
    settings.surfacingRate,
    supply,
  )
  const baseItems: { key: BaseRateKey; label: string; quantity: number }[] = [
    { key: 'cutRate', label: 'unclassified excavation', quantity: unclassified },
    { key: 'fillRate', label: 'fill placement', quantity: analysis.fillVolumeM3 },
    { key: 'surfacingRate', label: 'surfacing', quantity: surfacing.fallbackM3 },
    { key: 'clearingRate', label: 'clearing', quantity: analysis.clearingAreaM2 },
  ]
  const placeholderItems = baseItems.filter(
    (item) => item.quantity > EPS && settings[item.key] === DEFAULT_ROAD_SETTINGS[item.key],
  )
  if (!quantityCoverageComplete)
    flags.push({
      id: 'partial-sections',
      label: 'Unsupported intervals remain outside the estimate',
      detail: `${quantity(analysis.coveragePercent)}% of the road has complete sampled sections. Missing intervals have no quantity or cost allowance; this is not a confidence percentage.`,
    })
  if (result?.haul.optimizationStatus === 'infeasible')
    flags.push({
      id: 'infeasible-material-plan',
      label: 'Material supply and construction rules are infeasible',
      detail:
        'The entered material quality, capacities, movement directions or sidecast limits cannot meet all demands. The displayed work subtotal omits an unresolved material prescription and cannot establish a complete estimate. Review the allocation warnings and sources.',
    })
  if (result?.haul.optimizationStatus === 'unsolved')
    flags.push({
      id: 'unsolved-material-plan',
      label: 'The material plan could not be calculated',
      detail:
        'The material allocation did not finish, so the estimate has no material movement, borrow, waste or haul cost. See the allocation warning for the limit that was reached; increase station spacing, reduce materials or sites, or split the road.',
    })
  if (placeholderItems.length)
    flags.push({
      id: 'placeholder-rates',
      label: 'Some rates still match the placeholders',
      detail: `${placeholderItems.map((item) => item.label).join(', ')}. Check each against a dated, applicable quote or source; changing another rate does not validate these values.`,
    })
  if (supply?.enabled && surfacing.suppliedM3 > EPS && !supply.sourceNotes.trim())
    flags.push({
      id: 'aggregate-source-evidence',
      label: 'Aggregate source assumptions need evidence',
      detail:
        'Record supply access, material suitability, compacted quantity and a dated quote or explicit zero-acquisition agreement in Engineering → Haul & cost settings. Mapped tenure is not a supply agreement.',
    })
  // Earthwork, surfacing and clearing; supply, haul and culverts have their own flags below.
  const unpricedWork = unpriced.filter((item) => /^(material-|cut$|fill$|surfacing|clearing$)/.test(item.rowId))
  if (unpricedWork.length)
    flags.push({
      id: 'zero-work-rates',
      label: 'Positive work quantities have zero amounts',
      detail: `${unpricedWork.map((item) => item.text).join('; ')}. Enter prices or record why the work is included elsewhere or excluded; zero is not evidence that the work is free.`,
    })
  if (unclassified > EPS)
    flags.push({
      id: 'unclassified-ground',
      label: 'Ground material and reuse remain assumptions',
      detail: `${quantity(unclassified)} bank m³ is unclassified. Its reuse is assumed at ${settings.shrinkFactor.toLocaleString('en-CA', { maximumFractionDigits: 4 })} compacted m³ per bank m³, with no unsuitable fraction. Enter material horizons and suitability assumptions; terrain does not identify rock or organics.`,
    })

  const usableCut = result?.usableCutM3 ?? analysis.cutVolumeM3 * settings.shrinkFactor
  const minimumBorrowCompactedM3 = Math.max(0, analysis.fillVolumeM3 - usableCut)
  const hasEarthwork = analysis.cutVolumeM3 > EPS || analysis.fillVolumeM3 > EPS
  if (hasEarthwork && !engineering?.haul.enabled)
    flags.push({
      id: 'haul-disabled',
      label: 'Haul, borrow and waste are not allocated',
      detail:
        'Enable Engineering → Haul and enter sites, capacities, access distances and rates. Fill placement prices placing fill; it does not supply missing material.',
    })
  if (minimumBorrowCompactedM3 > EPS && !engineering?.haul.enabled)
    flags.push({
      id: 'borrow-screening',
      label: 'Aggregate minimum borrow demand',
      detail: `${quantity(minimumBorrowCompactedM3)} compacted m³ = covered fill minus assumed usable compacted cut, floored at zero. This screening lower bound assumes all usable cut can reach fill; gaps, unsuitable material or site constraints can increase demand. No supply or haul price is added by this check.`,
    })
  if (result?.haul.enabled && engineering) {
    if (result.haul.unallocatedBorrowM3 > EPS || result.haul.unallocatedWasteM3 > EPS)
      flags.push({
        id: 'unallocated-haul',
        label: 'Some material has no reachable site capacity',
        detail: `${quantity(result.haul.unallocatedBorrowM3)} compacted m³ borrow and ${quantity(result.haul.unallocatedWasteM3)} bank m³ waste remain unallocated. Default supply/disposal rates may be included, but unknown haul is excluded.`,
      })
    const unpricedSupply = unpriced.filter((item) => /^(borrow|waste)-/.test(item.rowId))
    if (unpricedSupply.length)
      flags.push({
        id: 'zero-supply-rates',
        label: 'Borrow or waste quantities have zero prices',
        detail: `${unpricedSupply.map((item) => item.text).join('; ')}. Confirm a supply/disposal price or an explicit included-cost assumption.`,
      })
    // A deliberately free-haul class is valid; do not label it an incomplete budget merely
    // because its distance and loading rates are zero.
    if (
      result.movements.some(
        (movement) =>
          movement.category !== 'freehaul' &&
          movement.transportedVolumeM3 > EPS &&
          movement.distanceM > EPS &&
          movement.haulCost === 0,
      )
    )
      flags.push({
        id: 'zero-haul-rates',
        label: 'Overhaul or endhaul has no price',
        detail:
          'Material moves beyond the free-haul limit with zero haul cost. Price the applicable class or record where its cost is included.',
      })
  }

  const culverts = result?.culverts ?? []
  const missingCrossings = crossingsWithoutStructure(analysis, engineering)
  if (missingCrossings.length)
    flags.push({
      id: 'unassigned-crossings',
      label: 'Stream crossings need a structure decision',
      detail: `${missingCrossings.length} supplied stream crossing(s) have no current structure choice or associated culvert at that station. Review culvert, bridge or other treatment and its cost; the terrain intersection does not design the crossing.`,
    })
  else if (
    !engineering?.culverts.length &&
    !analysis.crossingEstimate?.rows.some((row) => row.status === 'current' && row.record.structure !== 'undecided')
  )
    flags.push({
      id: 'drainage-inventory',
      label: 'Drainage inventory is not supplied',
      detail:
        'Review cross-drains and stream crossings before accepting zero structure cost. No mapped crossings does not establish that drainage is unnecessary.',
    })
  if (analysis.crossingEstimate?.complete === false)
    flags.push({
      id: 'incomplete-crossing-estimate',
      label: 'Stream crossing estimate needs review or prices',
      detail: analysis.crossingEstimate.warnings.join(' '),
    })
  const unpricedCulverts = culverts.filter(
    (culvert) => culvert.installedCost === 0 && !analysis.crossingEstimate?.replacedLegacyIds.includes(culvert.id),
  )
  if (unpricedCulverts.length)
    flags.push({
      id: 'zero-culvert-rates',
      label: 'Entered culverts have zero installed cost',
      detail: `${unpricedCulverts.map((culvert) => culvert.name).join(', ')}. Confirm supply, installation, headwalls, bedding and protection are priced or included elsewhere.`,
    })
  if (culverts.some((culvert) => !culvert.complete))
    flags.push({
      id: 'incomplete-culverts',
      label: 'Some structure quantities remain provisional',
      detail:
        'Review Engineering → Drainage. Missing inverts, unresolved cover or unmatched crossing associations prevent complete structure geometry.',
    })
  if (engineering?.culverts.some((culvert) => culvert.chainage > analysis.length + 1e-6))
    flags.push({
      id: 'excluded-culverts',
      label: 'Culverts beyond the road end are excluded',
      detail:
        'Move or remove these inventory entries after reviewing the alignment; their quantities and costs are not in the estimate.',
    })
  flags.push({
    id: 'project-scope',
    label: 'Confirm the remaining project scope',
    detail:
      'Review mobilization, grubbing/undercut, bridges, erosion control, survey/engineering, overhead/profit, escalation, taxes, maintenance and deactivation. Record what is priced, included in another rate or deliberately excluded.',
  })

  return {
    quantityCoverageComplete,
    placeholderRates: placeholderItems.map((item) => item.key),
    unpriced,
    minimumBorrowCompactedM3,
    flags,
  }
}
