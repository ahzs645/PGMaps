/** Unit conversions and production calculations; no published price or material-property defaults. */
export const CUBIC_METRES_PER_CUBIC_YARD = 0.764554857984

export interface CostUnitRateResult {
  valid: boolean
  unitCostCad: number | null
  unit: 'CAD/compacted m³' | 'CAD/bank m³'
  errors: string[]
}

export interface MaterialUnitCostInput {
  quoteUnit: 'tonne' | 'loose-yd3' | null
  priceCad: number | null
  /** Mass required to obtain one compacted cubic metre, not loose bulk density. */
  tonnesPerCompactedM3: number | null
  /** Loose cubic metres required to obtain one compacted cubic metre. */
  looseM3PerCompactedM3: number | null
}

export interface TruckCycleUnitCostInput {
  allInRateCadPerHour: number | null
  /** Complete load + loaded travel + unloading + empty return + queue cycle. */
  cycleMinutes: number | null
  /** Delivered volume expressed on a compacted basis, not the loose box volume. */
  compactedPayloadM3: number | null
}

export interface EquipmentUnitCostInput {
  allInCrewCadPerHour: number | null
  /** Net output over the same charged hours as the crew rate, including productive losses. */
  netBankM3PerHour: number | null
}

function isRate(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPositive(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function rateResult(
  unitCostCad: number | null,
  unit: CostUnitRateResult['unit'],
  errors: string[],
): CostUnitRateResult {
  if (unitCostCad !== null && !Number.isFinite(unitCostCad))
    errors.push('The result exceeds the supported numeric range.')
  const valid = errors.length === 0 && unitCostCad !== null && Number.isFinite(unitCostCad)
  return { valid, unitCostCad: valid ? unitCostCad : null, unit, errors }
}

export function calculateMaterialUnitCost(input: MaterialUnitCostInput): CostUnitRateResult {
  const errors: string[] = []
  if (!isRate(input.priceCad)) errors.push('Enter a finite non-negative quoted price; an unknown price is not zero.')
  let unitCostCad: number | null = null
  if (input.quoteUnit === 'tonne') {
    if (!isPositive(input.tonnesPerCompactedM3)) errors.push('Enter positive tonnes required per compacted m³.')
    if (isRate(input.priceCad) && isPositive(input.tonnesPerCompactedM3)) {
      unitCostCad = input.priceCad * input.tonnesPerCompactedM3
    }
  } else if (input.quoteUnit === 'loose-yd3') {
    if (!isPositive(input.looseM3PerCompactedM3)) errors.push('Enter positive loose m³ required per compacted m³.')
    if (isRate(input.priceCad) && isPositive(input.looseM3PerCompactedM3)) {
      unitCostCad = (input.priceCad / CUBIC_METRES_PER_CUBIC_YARD) * input.looseM3PerCompactedM3
    }
  } else errors.push('Select the supplier quote unit.')
  return rateResult(unitCostCad, 'CAD/compacted m³', errors)
}

export function calculateTruckCycleUnitCost(input: TruckCycleUnitCostInput): CostUnitRateResult {
  const errors: string[] = []
  if (!isRate(input.allInRateCadPerHour)) errors.push('Enter a finite non-negative truck hourly rate.')
  if (!isPositive(input.cycleMinutes)) errors.push('Enter positive minutes for the complete truck cycle.')
  if (!isPositive(input.compactedPayloadM3)) errors.push('Enter a positive payload on a compacted m³ basis.')
  const unitCostCad =
    isRate(input.allInRateCadPerHour) && isPositive(input.cycleMinutes) && isPositive(input.compactedPayloadM3)
      ? (input.allInRateCadPerHour * (input.cycleMinutes / 60)) / input.compactedPayloadM3
      : null
  return rateResult(unitCostCad, 'CAD/compacted m³', errors)
}

export function calculateEquipmentUnitCost(input: EquipmentUnitCostInput): CostUnitRateResult {
  const errors: string[] = []
  if (!isRate(input.allInCrewCadPerHour)) errors.push('Enter a finite non-negative all-in crew hourly rate.')
  if (!isPositive(input.netBankM3PerHour)) errors.push('Enter positive net production in bank m³ per charged hour.')
  const unitCostCad =
    isRate(input.allInCrewCadPerHour) && isPositive(input.netBankM3PerHour)
      ? input.allInCrewCadPerHour / input.netBankM3PerHour
      : null
  return rateResult(unitCostCad, 'CAD/bank m³', errors)
}
