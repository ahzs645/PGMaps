/**
 * The covered estimate's rows: every priced line as quantity × rate, in the order the cost dialog
 * (`CostBreakdown.tsx`) lists them, with the subtotal, contingency and total. The dialog and the
 * spatial attribution of the estimate (`costAttribution.ts`) read this one list, so a row's amount
 * on the road is always the amount the dialog shows.
 *
 * Each row also names its `driver`: the physical quantity its amount follows along the road, or
 * why it has no place on it. Rates carry an `edit` saying which input changes them; the dialog
 * turns that into an editable cell.
 *
 * Pure: no DOM or network access.
 */
import { haulCostLines, type HaulCostLineSource } from './engineering'
import { surfacingSupplyCost } from './gravel'
import { materialPlanMissing, type HaulSettings } from './engineeringTypes'
import type { Alignment, GroundMaterial, MaterialQuantity, RoadAnalysis, RoadSettings } from './types'

/** Compacted volume of a fill placement row's note. */
const COMPACTED_M3 = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1 })

/** The base unit rates a preset sets; engineering inputs (materials, haul, structures) stay per project. */
export const COST_SETTING_RATE_KEYS = ['cutRate', 'fillRate', 'surfacingRate', 'clearingRate'] as const
export type CostSettingRateKey = (typeof COST_SETTING_RATE_KEYS)[number]

/** Which input a rate cell edits. */
export type CostRateEdit =
  | { kind: 'setting'; key: CostSettingRateKey }
  | { kind: 'haul'; key: keyof HaulSettings }
  | { kind: 'material'; materialId: string }

export interface CostRowRate {
  value: number
  unit: string
  label: string
  min?: number
  max?: number
  /** The adoption target behind this cell (`adoptionTargets.ts`), so an adopted rate shows its reference on the row. */
  rateKey?: string
  /** Absent: the rate is shown, and edited where the row's note says. */
  edit?: CostRateEdit
}

/** A located cost: a culvert, a stream crossing, a site. */
export interface CostPoint {
  chainage: number
  amount: number
  label: string
}

/**
 * What a row's amount follows along the road (`costAttribution.ts` spreads the amount over station
 * intervals in proportion to it):
 * - `cut`: the interval's cut volume (`RoadStation.cutVolumeM3`), for the road without engineering.
 * - `materialCut`: one ground material's bank cut per interval; `excavation` is its cut less its
 *   shallow rock, `shallowRock` and `overbreak` a rock material's own rows.
 * - `fill`: the interval's fill volume (`RoadStation.fillVolumeM3`).
 * - `fillPlacement`: fill priced by the material it is made of (`fillPlacement.ts`); null is the
 *   line at the project's fill rate.
 * - `surfacing`: the interval's surfacing volume (`RoadStation.surfaceVolumeM3`).
 * - `clearing`: the cleared area, average clearing width × interval length.
 * - `haul`: one haul cost line (`haulCostLines`), traced through the movements it prices.
 * - `points`: located items, each placed whole; `remainderReason` names what the row's amount holds
 *   beyond them (shared costs with no place).
 * - `roadWide`: no place on the road (a lump sum, a percentage); `reason` says why.
 */
export type CostDriver =
  | { kind: 'cut' }
  | { kind: 'materialCut'; materialId: string; part: 'excavation' | 'shallowRock' | 'overbreak' }
  | { kind: 'fill' }
  | { kind: 'fillPlacement'; materialId: string | null }
  | { kind: 'surfacing' }
  | { kind: 'clearing' }
  | { kind: 'haul'; source: HaulCostLineSource }
  | { kind: 'points'; unit: string; items: CostPoint[]; remainderReason?: string }
  | { kind: 'roadWide'; reason: string }

export interface CostRow {
  /** Stable: the dialog's `data-cost-row`, and the key attribution and the plan read. */
  id: string
  item: string
  quantity: number | null
  unit: string
  rate?: CostRowRate
  amount: number
  /** Shown in place of the amount where a zero would read as a price: a cost that was not calculated. */
  amountText?: string
  note?: string
  driver: CostDriver
}

export interface CostBreakdownRows {
  /** The priced lines, contingency excluded. */
  rows: CostRow[]
  /** With engineering inputs: the rows' sum before contingency. */
  subtotal?: number
  /** With engineering inputs: the contingency line, a percentage of the subtotal. */
  contingency?: CostRow
  /** The estimate's total (`RoadAnalysis.estimatedCost`): the rows plus contingency. */
  total: number
  /** Why no haul, borrow or waste is in the total: the material plan was not solved or is infeasible. */
  noPlan: 'was not solved' | 'is infeasible' | null
}

export const ROAD_WIDE_LUMP_SUM = 'Road-wide lump sum'
export const PERCENTAGE_OF_SUBTOTAL = 'Percentage of the subtotal'
export const SHARED_CROSSING_COSTS = 'Shared stream crossing costs, priced once per road'

/**
 * A rock material's shallow cut and overbreak as rows of their own, at their own rates (or the
 * excavation rate where none is entered). Their amounts and the material's main row add up to its
 * excavation cost. Rates are edited with the material, in Engineering → Ground.
 */
function rockRows(m: MaterialQuantity, entered: GroundMaterial | undefined, roadId: string): CostRow[] {
  const rock = m.rock!
  const rate = (value: number | undefined) => value ?? entered?.cutRate ?? 0
  return [
    ...(rock.shallowBankM3 > 0
      ? [
          {
            id: `material-${m.materialId}-shallow`,
            item: `Shallow rock · ${m.name}`,
            quantity: rock.shallowBankM3,
            unit: 'bank m³',
            rate: {
              value: rate(entered?.shallowCutRate),
              unit: '$/m³',
              label: `${m.name} shallow rock rate`,
              rateKey: `${roadId}/material:${m.materialId}.shallowCutRate`,
            },
            amount: rock.shallowCost,
            note: 'Rock cut no thicker than the template’s shallow depth; its rate is set with the material in Engineering → Ground.',
            driver: { kind: 'materialCut', materialId: m.materialId, part: 'shallowRock' } as const,
          },
        ]
      : []),
    ...(rock.overbreakBankM3 > 0
      ? [
          {
            id: `material-${m.materialId}-overbreak`,
            item: `Overbreak · ${m.name}`,
            quantity: rock.overbreakBankM3,
            unit: 'bank m³',
            rate: {
              value: rate(entered?.overbreakRate),
              unit: '$/m³',
              label: `${m.name} overbreak rate`,
              rateKey: `${roadId}/material:${m.materialId}.overbreakRate`,
            },
            amount: rock.overbreakCost,
            note: 'Rock blasted below the subgrade to the blasting level and refilled in place; its rate is set with the material in Engineering → Ground.',
            driver: { kind: 'materialCut', materialId: m.materialId, part: 'overbreak' } as const,
          },
        ]
      : []),
  ]
}

/**
 * The culverts and stream crossings the structures amount holds, each where it is: culverts at
 * their installed cost unless a crossing record replaced them, current crossing records counted in
 * the crossing subtotal at theirs. Shared crossing costs have no place.
 */
function structurePoints(analysis: RoadAnalysis): CostDriver {
  const estimate = analysis.crossingEstimate
  const replaced = new Set(estimate?.replacedLegacyIds ?? [])
  const items: CostPoint[] = [
    ...(analysis.engineering?.culverts ?? [])
      .filter((c) => !replaced.has(c.id))
      .map((c) => ({ chainage: c.chainage, amount: c.installedCost, label: c.name })),
    ...(estimate?.rows ?? [])
      .filter((row) => row.inSubtotal)
      .map((row) => ({ chainage: row.chainage, amount: row.knownSubtotal, label: row.name })),
  ]
  return {
    kind: 'points',
    unit: 'structures',
    items,
    ...(estimate && estimate.sharedSubtotal !== 0 ? { remainderReason: SHARED_CROSSING_COSTS } : {}),
  }
}

/** A haul line's located form: supply, disposal and preparation at a site are a point there. */
function haulDriver(
  source: HaulCostLineSource,
  amount: number,
  item: string,
  siteChainage: (id: string) => number | undefined,
): CostDriver {
  if (source.kind === 'site' || source.kind === 'sitePreparation') {
    const chainage = siteChainage(source.siteId)
    return chainage === undefined
      ? { kind: 'roadWide', reason: 'The site is not on this road' }
      : { kind: 'points', unit: 'sites', items: [{ chainage, amount, label: item }] }
  }
  return { kind: 'haul', source }
}

/**
 * The estimate's rows for one road, in the dialog's order. `editable` says which inputs the dialog
 * can edit: without a haul editor the haul rates are shown read-only, and without a material editor
 * a named material's excavation rate is not shown at all, as before.
 */
export function costBreakdownRows({
  analysis,
  alignment,
  settings,
  editable = { haul: true, materialRate: true },
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  settings: RoadSettings
  editable?: { haul: boolean; materialRate: boolean }
}): CostBreakdownRows {
  const result = analysis.engineering
  const haul = alignment.engineering?.haul
  const roadKey = (key: string) => `${alignment.id}/${key}`
  const setting = (key: CostSettingRateKey, label: string, unit: string, max = 10000): CostRowRate => ({
    value: settings[key],
    unit,
    label,
    max,
    rateKey: key,
    edit: { kind: 'setting', key },
  })
  const haulRate = (key: keyof HaulSettings, label: string, unit: string, max = 1e9): CostRowRate | undefined =>
    haul && editable.haul
      ? {
          value: haul[key] as number,
          unit,
          label,
          max,
          rateKey: roadKey(`haul.${key}`),
          edit: { kind: 'haul', key },
        }
      : undefined
  const costs = result?.costs
  const supply = alignment.engineering?.surfacingSupply
  const materialLayerVolumeM3 = result?.materialLayerVolumeM3 ?? 0
  const genericSurfaceVolumeM3 = Math.max(0, analysis.surfaceVolumeM3 - materialLayerVolumeM3)
  const surfacing = surfacingSupplyCost(genericSurfaceVolumeM3, settings.surfacingRate, supply)
  const surfacingRows: CostRow[] = supply?.enabled
    ? [
        {
          id: 'surfacing-source',
          item: `Surfacing · ${supply.name}`,
          quantity: surfacing.suppliedM3,
          unit: 'compacted m³',
          rate: { value: surfacing.rate, unit: '$/m³', label: 'Delivered aggregate rate' },
          amount: surfacing.suppliedM3 * surfacing.rate,
          note: 'Acquisition + processing + loading + entered one-way haul + placement. Edit in Engineering → Haul & cost settings.',
          driver: { kind: 'surfacing' },
        },
        {
          id: 'surfacing',
          item: 'Surfacing · remaining supply',
          quantity: surfacing.fallbackM3,
          unit: 'compacted m³',
          rate: setting('surfacingRate', 'Surfacing rate', '$/m³'),
          amount: surfacing.fallbackM3 * settings.surfacingRate,
          note: 'Volume beyond the entered source capacity uses this base rate.',
          driver: { kind: 'surfacing' },
        },
      ]
    : [
        {
          id: 'surfacing',
          item: 'Surfacing',
          quantity: genericSurfaceVolumeM3,
          unit: 'm³',
          rate: setting('surfacingRate', 'Surfacing rate', '$/m³'),
          amount: genericSurfaceVolumeM3 * settings.surfacingRate,
          driver: { kind: 'surfacing' },
        },
      ]
  if (materialLayerVolumeM3 > 0)
    surfacingRows.push({
      id: 'material-course-placement',
      item: 'Material courses · placement',
      quantity: materialLayerVolumeM3,
      unit: 'compacted m³',
      rate: setting('fillRate', 'Material course placement rate', '$/m³'),
      amount: materialLayerVolumeM3 * settings.fillRate,
      note: 'The entered fill-placement rate places these courses; source material and haul are separate allocation lines. No delivered surfacing rate is charged on this volume.',
      driver: { kind: 'surfacing' },
    })
  const haulLines = result && alignment.engineering ? haulCostLines(alignment.engineering, result) : []
  const noPlan =
    result && materialPlanMissing(result.haul)
      ? result.haul.optimizationStatus === 'unsolved'
        ? ('was not solved' as const)
        : ('is infeasible' as const)
      : null
  // Sites on the road are in the plan; one past the road end has no road to it and no movement.
  const roadEnd = analysis.stations.at(-1)?.chainage ?? 0
  const siteChainage = (id: string) => {
    const site = alignment.engineering?.sites.find((s) => s.id === id)
    // Pits of last resort (`lastResortPits.ts`) stand at chainage 0.
    if (!site) return id.startsWith('last-resort-') ? 0 : undefined
    return Math.min(site.chainage, roadEnd)
  }
  const haulRows: CostRow[] = haulLines.length
    ? haulLines.map((line) => ({
        id: line.id,
        item: line.item,
        quantity: line.quantity,
        unit: line.unit,
        // Only the default borrow and waste rates are edited here; the others have one place each.
        rate: (line.rateKey === 'borrowRate' || line.rateKey === 'wasteRate'
          ? haulRate(line.rateKey, line.rateKey === 'borrowRate' ? 'Borrow rate' : 'Waste rate', line.rateUnit, 100000)
          : undefined) ?? { value: line.rate, unit: line.rateUnit, label: `${line.item} rate` },
        amount: line.amount,
        note:
          line.rateKey === 'borrowRate' || line.rateKey === 'wasteRate'
            ? 'No site in reach with capacity left; the default rate applies. Its haul is not priced.'
            : line.rateKey
              ? 'Haul class rates are edited below.'
              : 'The site’s own rate or fixed cost; edit it in Engineering → Haul.',
        driver: haulDriver(line.source, line.amount, line.item, siteChainage),
      }))
    : [
        {
          id: 'haul',
          item: 'Haul, borrow and waste',
          quantity: null,
          unit: '',
          amount: costs ? costs.haul + costs.borrow + costs.waste + costs.sitePreparation : 0,
          // A plan that was not adopted leaves these costs out of the total; that is not $0 of work.
          ...(noPlan ? { amountText: 'Not calculated' } : {}),
          note: noPlan
            ? `The material plan ${noPlan}, so no haul, borrow or waste cost is in the total. Open Engineering → Haul.`
            : result?.haul.enabled
              ? 'No material is moved, supplied or wasted.'
              : 'Haul allocation is off; turn it on in Engineering → Haul.',
          driver: {
            kind: 'roadWide',
            reason: noPlan ? `The material plan ${noPlan}` : 'No haul, borrow or waste line to trace',
          },
        },
      ]
  if (!costs) {
    const crossings = analysis.crossingEstimate
    return {
      rows: [
        {
          id: 'cut',
          item: 'Excavation',
          quantity: analysis.cutVolumeM3,
          unit: analysis.curvatureCorrection?.applied ? 'bank m³ (curve-corrected)' : 'bank m³',
          rate: setting('cutRate', 'Cut rate', '$/m³'),
          amount: analysis.cutVolumeM3 * settings.cutRate,
          driver: { kind: 'cut' },
        },
        {
          id: 'fill',
          item: 'Fill placement',
          quantity: analysis.fillVolumeM3,
          unit: analysis.curvatureCorrection?.applied ? 'm³ (curve-corrected)' : 'm³',
          rate: setting('fillRate', 'Fill rate', '$/m³'),
          amount: analysis.fillVolumeM3 * settings.fillRate,
          driver: { kind: 'fill' },
        },
        {
          id: 'surfacing',
          item: 'Surfacing',
          quantity: analysis.surfaceVolumeM3,
          unit: 'm³',
          rate: setting('surfacingRate', 'Surfacing rate', '$/m³'),
          amount: analysis.surfaceVolumeM3 * settings.surfacingRate,
          driver: { kind: 'surfacing' },
        },
        {
          id: 'clearing',
          item: 'Clearing',
          quantity: analysis.clearingAreaM2,
          unit: 'm²',
          rate: setting('clearingRate', 'Clearing rate', '$/m²'),
          amount: analysis.clearingAreaM2 * settings.clearingRate,
          driver: { kind: 'clearing' },
        },
        // Priced stream crossings are in the total without engineering inputs too (`engine.ts`).
        ...(crossings && crossings.incrementalSubtotal !== 0
          ? [
              {
                id: 'structures',
                item: 'Stream crossings',
                quantity: crossings.rows.filter((row) => row.inSubtotal).length,
                unit: 'crossings',
                amount: crossings.incrementalSubtotal,
                note: 'Priced stream crossing records and shared crossing costs; edit them with the road’s stream crossings.',
                driver: structurePoints(analysis),
              },
            ]
          : []),
      ],
      total: analysis.estimatedCost,
      noPlan,
    }
  }
  const rows: CostRow[] = [
    ...result!.materials.flatMap((m): CostRow[] => [
      {
        id: `material-${m.materialId}`,
        item: m.purpose === 'stripping' ? `Stripping · ${m.name}` : `Excavation · ${m.name}`,
        // A rock material's shallow cut and overbreak are rows of their own, below.
        quantity: m.bankCutM3 - (m.rock?.shallowBankM3 ?? 0),
        unit: analysis.curvatureCorrection?.applied ? 'bank m³ (curve-corrected)' : 'bank m³',
        rate:
          m.materialId === '__unclassified'
            ? setting('cutRate', 'Unclassified excavation rate', '$/m³')
            : editable.materialRate
              ? {
                  value: alignment.engineering?.materials.find((x) => x.id === m.materialId)?.cutRate ?? 0,
                  unit: '$/m³',
                  label: `${m.name} excavation rate`,
                  max: 10000,
                  rateKey: roadKey(`material:${m.materialId}.cutRate`),
                  edit: { kind: 'material', materialId: m.materialId },
                }
              : undefined,
        amount: m.excavationCost - (m.rock ? m.rock.shallowCost + m.rock.overbreakCost : 0),
        driver: { kind: 'materialCut', materialId: m.materialId, part: 'excavation' },
      },
      ...(m.rock
        ? rockRows(
            m,
            alignment.engineering?.materials.find((x) => x.id === m.materialId),
            alignment.id,
          )
        : []),
    ]),
    // Fill priced by the material it is made of (`fillPlacement.ts`): one row per material with
    // its own embankment rate, per bank m³ placed, and the rest at the project's fill rate.
    ...(result!.fillPlacement?.length
      ? result!.fillPlacement.map((line): CostRow => {
          const material = alignment.engineering?.materials.find((x) => x.id === line.materialId)
          return line.materialId === null
            ? {
                id: 'fill',
                item: 'Fill placement',
                quantity: line.compactedM3,
                unit: 'm³',
                rate: setting('fillRate', 'Fill rate', '$/m³'),
                amount: line.amount,
                driver: { kind: 'fillPlacement', materialId: null },
              }
            : {
                id: `fill-${line.materialId}`,
                item: `Fill placement · ${material?.name ?? line.materialId}`,
                quantity: line.bankM3,
                unit: 'bank m³ placed',
                rate: {
                  value: line.rate,
                  unit: '$/bank m³',
                  label: `${material?.name ?? line.materialId} fill placement rate`,
                },
                amount: line.amount,
                note: `${COMPACTED_M3.format(line.compactedM3)} compacted m³. The material's own fill placement rate; edit it in Engineering → Ground.`,
                driver: { kind: 'fillPlacement', materialId: line.materialId },
              }
        })
      : [
          {
            id: 'fill',
            item: 'Fill placement',
            quantity: analysis.fillVolumeM3,
            unit: analysis.curvatureCorrection?.applied ? 'm³ (curve-corrected)' : 'm³',
            rate: setting('fillRate', 'Fill rate', '$/m³'),
            amount: costs.fill,
            driver: { kind: 'fill' } as const,
          },
        ]),
    ...surfacingRows,
    {
      id: 'clearing',
      item: 'Clearing',
      quantity: analysis.clearingAreaM2,
      unit: 'm²',
      rate: setting('clearingRate', 'Clearing rate', '$/m²'),
      amount: costs.clearing,
      driver: { kind: 'clearing' },
    },
    {
      id: 'structures',
      item: 'Structures',
      quantity: result!.culverts.length,
      unit: 'culverts',
      amount: costs.structures,
      note: 'Installed cost per culvert; edit in Engineering → Drainage.',
      driver: structurePoints(analysis),
    },
    ...haulRows,
    {
      id: 'mobilization',
      item: 'Mobilization',
      quantity: 1,
      unit: 'lump sum',
      rate: haulRate('mobilizationCost', 'Mobilization', '$'),
      amount: costs.mobilization,
      driver: { kind: 'roadWide', reason: ROAD_WIDE_LUMP_SUM },
    },
  ]
  return {
    rows,
    subtotal: costs.subtotal,
    contingency: {
      id: 'contingency',
      item: 'Contingency',
      quantity: costs.subtotal,
      unit: '$ subtotal',
      rate: haulRate('contingencyPercent', 'Contingency', '%', 100),
      amount: costs.contingency,
      driver: { kind: 'roadWide', reason: PERCENTAGE_OF_SUBTOTAL },
    },
    total: analysis.estimatedCost,
    noPlan,
  }
}
