/**
 * The fill-placement (embankment) cost of a road, priced by the material each fill is made of.
 *
 * RoadEng prices embankment by ground type ("Excavation and embankment costs, material specific",
 * Softree Optimal manual, chapter 3), per volume of that material as excavated: Softree balances
 * material in cut volumes. Checked against the eleven designs that store a solved costing
 * (`docs/forestry-road-design/material-allocation.md`): Hart Rd's types cost 2, 2, 1.8 and 2 per m³ to
 * place and its stored fill is 56,386, which is its gravel subgrade fill of about 30,700 compacted m³
 * at 2 per bank m³ (÷ 1.11 compacted per bank) rather than the 61,000 a compacted-volume rate gives;
 * the cul-de-sac's overburden (0.8 compacted per bank) reads 174,000 against its stored 184,000 on
 * that rule and 139,000 on the other.
 *
 * A material with its own embankment rate (`GroundMaterial.fillRate`, per bank m³) prices the fill
 * it makes: a cut-to-fill movement by the bank volume moved, a borrow by its compacted volume ÷ the
 * material's compaction factor. Fill no movement accounts for (no plan, or a plan not adopted) is
 * priced by its interval's required subgrade material when that has a rate, and everything else at
 * the project's fill rate per compacted m³, as before. Layer and course demands are not fill here:
 * they are placed at the project's fill rate as material layers (`engineering.ts`).
 *
 * Pure: no DOM or network access.
 */
import type { FillRequirement, GroundMaterial, HaulMovement, HaulSite } from './engineeringTypes'

const EPS = 1e-9

export interface FillPlacementLine {
  /** Material id, or null for fill priced at the project's fill rate. */
  materialId: string | null
  compactedM3: number
  /** Bank m³ of the material placed; null at the project's rate. */
  bankM3: number | null
  /** Per bank m³ for a material, per compacted m³ at the project's rate. */
  rate: number
  amount: number
}

export interface FillPlacement {
  cost: number
  lines: FillPlacementLine[]
}

type Interval = { id: string; chainage: number; fill: number }

/** A movement that places subgrade fill (not a surface layer or course). */
export const placesSubgradeFill = (m: Pick<HaulMovement, 'kind' | 'demandKey' | 'externalUnresolved'>) =>
  (m.kind === 'cut-to-fill' || m.kind === 'borrow') &&
  !m.externalUnresolved &&
  (m.demandKey === undefined || m.demandKey === 'subgrade' || m.demandKey.startsWith('["component"'))

export function fillPlacementCost(input: {
  intervals: readonly Interval[]
  /** The road's total fill, compacted m³ (`RoadAnalysis.fillVolumeM3`). */
  fillVolumeM3: number
  /** The adopted plan's movements; empty when no plan was adopted. */
  movements: readonly HaulMovement[]
  materials: readonly GroundMaterial[]
  sites: readonly HaulSite[]
  fillRequirements?: readonly FillRequirement[]
  /** The project's fill rate, per compacted m³. */
  fillRate: number
}): FillPlacement {
  const { materials, fillRate } = input
  // Without a material that has its own rate, nothing changes: all fill at the project's rate.
  if (!materials.some((m) => m.fillRate !== undefined)) {
    const amount = input.fillVolumeM3 * fillRate
    return {
      cost: amount,
      lines:
        input.fillVolumeM3 > EPS
          ? [{ materialId: null, compactedM3: input.fillVolumeM3, bankM3: null, rate: fillRate, amount }]
          : [],
    }
  }
  const byMaterial = new Map<string, GroundMaterial>(materials.map((m) => [m.id, m]))
  const lines = new Map<string | null, FillPlacementLine>()
  const add = (material: GroundMaterial | undefined, compacted: number, bank: number | null) => {
    if (!(compacted > EPS)) return
    const priced = material?.fillRate !== undefined && material.compactionFactor > 0
    const key = priced ? material!.id : null
    const line = lines.get(key) ?? {
      materialId: key,
      compactedM3: 0,
      bankM3: priced ? 0 : null,
      rate: priced ? material!.fillRate! : fillRate,
      amount: 0,
    }
    line.compactedM3 += compacted
    if (priced) {
      const b = bank ?? compacted / material!.compactionFactor
      line.bankM3! += b
      line.amount += b * line.rate
    } else line.amount += compacted * fillRate
    lines.set(key, line)
  }
  const received = new Map<string, number>()
  for (const m of input.movements) {
    if (!placesSubgradeFill(m)) continue
    const compacted = m.compactedVolumeM3 ?? m.transportedVolumeM3
    received.set(m.targetId, (received.get(m.targetId) ?? 0) + compacted)
    const materialId = m.materialId ?? input.sites.find((s) => s.id === m.sourceId)?.materialId ?? null
    add(
      materialId === null ? undefined : byMaterial.get(materialId),
      compacted,
      m.kind === 'cut-to-fill' ? m.bankVolumeM3 : null,
    )
  }
  // Fill the plan does not account for, interval by interval, then any rounding remainder.
  let accounted = 0
  for (const p of input.intervals) {
    const left = p.fill - (received.get(p.id) ?? 0)
    accounted += Math.min(p.fill, received.get(p.id) ?? 0)
    if (left <= EPS) continue
    const required = input.fillRequirements?.find(
      (r) => r.layer === 'subgrade' && r.materialId !== undefined && p.chainage >= r.start && p.chainage < r.end,
    )
    add(required ? byMaterial.get(required.materialId!) : undefined, left, null)
    accounted += left
  }
  const remainder = input.fillVolumeM3 - accounted
  if (remainder > 1e-6) add(undefined, remainder, null)
  // Materials in the order first placed, the project rate last.
  const out = [...lines.values()].sort((a, b) => Number(a.materialId === null) - Number(b.materialId === null))
  return { cost: out.reduce((sum, l) => sum + l.amount, 0), lines: out }
}
