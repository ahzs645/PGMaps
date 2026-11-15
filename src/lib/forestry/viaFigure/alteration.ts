/**
 * Percent alteration as each VIA format states it, written down as a rule rather than read out of the wording of a
 * calculation box. A rule names what is added (proposed blocks, existing openings not yet greened up, other planned
 * blocks), what leaves the landform (private land, rock), the unit the areas were measured in, and how the result is
 * printed (decimals, rounding, a total built from rounded parts). See docs/forestry-visual-quality.md, "VIA documents".
 *
 * The rules were read from the reference documents' own arithmetic (November 2026 survey, cited by number), and
 * `checkPrintedAlteration` reproduces their printed figures: where a document's number does not follow from its own
 * areas, it says which arithmetic does (truncation, a different denominator, a sum of rounded parts), or that none
 * does. No DOM or network access.
 */

/** What a figure adds up: proposed blocks, existing openings still counting, and other planned blocks. */
export type AlterationPart = 'proposed' | 'nonVeg' | 'otherPlanned'
/** What leaves the landform before dividing. */
export type AlterationDeduction = 'privateLand' | 'rock'
/** What the areas were measured in. Pixels on a render, cm² on a print, hectares in plan. */
export type AlterationUnit = 'px' | 'cm2' | 'ha'

export interface AlterationRule {
  id: string
  /** Short name for menus and notes. */
  name: string
  numerator: readonly AlterationPart[]
  deduct: readonly AlterationDeduction[]
  unit: AlterationUnit
  decimals: number
  /** `round-twice`: rounded to one more decimal first, then to `decimals` (07 VP1: 1.845 -> 1.85 -> 1.9). */
  rounding: 'round' | 'truncate' | 'round-twice'
  /** `sum-of-rounded-parts`: the total printed is the sum of the parts' printed percents (23). */
  total: 'exact' | 'sum-of-rounded-parts'
  /** The parts' own percents divide by the gross landform (22's boxes) or by the rule's denominator. */
  partsOver: 'gross' | 'denominator'
  /** The formula in words, as a sheet prints it. */
  formula: string
  /** Which denominator, in plain words ("net of private land"). */
  basis: string
  /** Where the rule was read. */
  spec: string
}

const PARTS: AlterationPart[] = ['nonVeg', 'proposed', 'otherPlanned']

export const ALTERATION_RULES = {
  /** 03 (form and sheets), 10: (existing + proposed) / landform, pixels, two decimals. */
  grossPixels: {
    id: 'gross-px',
    name: 'Gross landform, pixels',
    numerator: ['nonVeg', 'proposed', 'otherPlanned'],
    deduct: [],
    unit: 'px',
    decimals: 2,
    rounding: 'round',
    total: 'exact',
    partsOver: 'denominator',
    formula: '(NonVEG + Proposed Blocks) / Landform',
    basis: 'gross landform',
    spec: '03 p1-p5 calculation boxes: 18,740 / 371,073 = 5.05%; 45,920 / 590,161 = 7.78%; 203,195 / 1,642,069 = 12.37%',
  },
  /** 23: as gross pixels, but the total printed is the sum of the two rounded parts. */
  grossPixelsSumOfParts: {
    id: 'gross-px-sum-of-parts',
    name: 'Gross landform, pixels, total from rounded parts',
    numerator: ['nonVeg', 'proposed', 'otherPlanned'],
    deduct: [],
    unit: 'px',
    decimals: 2,
    rounding: 'round',
    total: 'sum-of-rounded-parts',
    partsOver: 'denominator',
    formula: '(NonVEG + Proposed Blocks) / Landform',
    basis: 'gross landform',
    spec: '23 A2: NonVEG 471 / 28,054 = 1.68%, Proposed 254 / 28,054 = 0.91%, total printed 2.59% (exact 2.58%)',
  },
  /** 22: net of private land ("trees down" private land), parts over the gross landform. */
  netOfPrivatePixels: {
    id: 'net-private-px',
    name: 'Landform net of private land, pixels',
    numerator: ['nonVeg', 'proposed', 'otherPlanned'],
    deduct: ['privateLand'],
    unit: 'px',
    decimals: 2,
    rounding: 'round',
    total: 'exact',
    partsOver: 'gross',
    formula: '(NonVEG + Prop. Blk) / (LF - PL)',
    basis: 'landform net of private land',
    spec: '22 A3-A48: 29 of 31 boxes round; Captain Island 255 / (120,991 - 42,763) = 0.326% printed 0.32 (truncated)',
  },
  /** 05, 06: net of rock and private land, cm² on the print, one decimal. */
  netOfRockAndPrivateCm2: {
    id: 'net-rock-private-cm2',
    name: 'Landform net of rock and private land, cm²',
    numerator: ['nonVeg', 'proposed', 'otherPlanned'],
    deduct: ['privateLand', 'rock'],
    unit: 'cm2',
    decimals: 1,
    rounding: 'round',
    total: 'exact',
    partsOver: 'denominator',
    formula: '(Proposed + Existing Non-Veg) / (VLU - Rock and Private Land)',
    basis: 'landform net of rock and private land',
    spec: '05 VP1-VP4: 1.9 / 144 = 1.3%, 10.7 / 276 = 3.9%, 4.4 / 128 = 3.4%, 0.5 / 68.3 = 0.7%; 06 VP2: 10.0 / 128 = 7.8%',
  },
  /** 07: net of rock only, cm², one decimal. */
  netOfRockCm2: {
    id: 'net-rock-cm2',
    name: 'Landform net of rock, cm²',
    numerator: ['nonVeg', 'proposed', 'otherPlanned'],
    deduct: ['rock'],
    unit: 'cm2',
    decimals: 1,
    rounding: 'round',
    total: 'exact',
    partsOver: 'denominator',
    formula: '(Proposed + Existing Non-Veg) / Net VLU',
    basis: 'landform net of rock',
    spec: '07 VP1-VP5: 5 / 271 = 1.9%, 10 / 359 = 2.8%, 2.3 / 83.6 = 2.8%, 22 / 245 = 9.0%, 10 / 531 = 1.9%',
  },
  /** 09: gross VLU though a net VLU is printed beside it, cm², one decimal. */
  grossCm2: {
    id: 'gross-cm2',
    name: 'Gross landform, cm²',
    numerator: ['nonVeg', 'proposed', 'otherPlanned'],
    deduct: [],
    unit: 'cm2',
    decimals: 1,
    rounding: 'round',
    total: 'exact',
    partsOver: 'denominator',
    formula: '(Proposed Alteration + Non Veg State) / VLU',
    basis: 'gross landform',
    spec: '09 VP1-VP3: 30.3 / 241.32 = 12.5%, 317.8 / 875.32 = 36.3%, 76.8 / 707.54 = 10.9% (Net VLU printed, not used)',
  },
} as const satisfies Record<string, AlterationRule>

export type AlterationRuleKey = keyof typeof ALTERATION_RULES

export const findAlterationRule = (id: string | null | undefined): AlterationRule | null =>
  Object.values(ALTERATION_RULES).find((rule) => rule.id === id) ?? null

/** Measured areas, all in one unit. `landform` is the whole visible landform, private land and rock included. */
export interface AlterationAreas {
  landform: number
  proposed: number
  nonVeg: number
  otherPlanned?: number
  privateLand?: number
  rock?: number
}

export interface AlterationPartResult {
  part: AlterationPart
  area: number
  percent: number
  printed: string
}

export interface Alteration {
  rule: AlterationRule
  numerator: number
  denominator: number
  /** Unrounded. */
  percent: number
  /** The total as the rule prints it, without the % sign. */
  printed: string
  /** The printed total read back as a number: what a class is read from on the sheet. */
  printedValue: number
  parts: AlterationPartResult[]
}

/** `value` to `decimals`, rounded or truncated, as text. Tiny float error never tips a truncation. */
export function formatAlteration(value: number, rule: Pick<AlterationRule, 'decimals' | 'rounding'>): string {
  if (!Number.isFinite(value)) return 'n/a'
  const scale = 10 ** rule.decimals
  const scaled = value * scale
  const cut =
    rule.rounding === 'truncate'
      ? Math.trunc(scaled + 1e-9 * Math.sign(scaled))
      : rule.rounding === 'round-twice'
        ? Math.round(Math.round(scaled * 10) / 10)
        : Math.round(scaled)
  return (cut / scale).toFixed(rule.decimals)
}

const area = (areas: AlterationAreas, part: AlterationPart) =>
  part === 'proposed' ? areas.proposed : part === 'nonVeg' ? areas.nonVeg : (areas.otherPlanned ?? 0)

/** The rule's denominator for `areas`: the landform less what the rule deducts. */
export function alterationDenominator(rule: AlterationRule, areas: AlterationAreas): number {
  let denominator = areas.landform
  if (rule.deduct.includes('privateLand')) denominator -= areas.privateLand ?? 0
  if (rule.deduct.includes('rock')) denominator -= areas.rock ?? 0
  return denominator
}

/** The figure `rule` gives for `areas`, or null when the denominator is empty. */
export function alteration(rule: AlterationRule, areas: AlterationAreas): Alteration | null {
  const denominator = alterationDenominator(rule, areas)
  if (!(denominator > 0) || !(areas.landform > 0)) return null
  const counted = PARTS.filter((part) => rule.numerator.includes(part))
  const numerator = counted.reduce((sum, part) => sum + area(areas, part), 0)
  const percent = (100 * numerator) / denominator
  const partsOver = rule.partsOver === 'gross' ? areas.landform : denominator
  const parts = counted.map((part) => {
    const partPercent = (100 * area(areas, part)) / partsOver
    return { part, area: area(areas, part), percent: partPercent, printed: formatAlteration(partPercent, rule) }
  })
  const printed =
    rule.total === 'sum-of-rounded-parts'
      ? formatAlteration(
          parts.reduce((sum, part) => sum + Number(part.printed), 0),
          { decimals: rule.decimals, rounding: 'round' },
        )
      : formatAlteration(percent, rule)
  return { rule, numerator, denominator, percent, printed, printedValue: Number(printed), parts }
}

/** One arithmetic tried by the checker, and what it gives. */
export interface AlterationReading {
  how: string
  printed: string
}

export interface AlterationCheck {
  /** The rule reproduces the printed figure exactly. */
  matches: boolean
  /** What the rule prints for the document's own areas. */
  reproduced: string | null
  exact: number | null
  /** When it does not match: the arithmetic that does give the printed figure, if any. */
  explainedBy: AlterationReading | null
  note: string
}

const READINGS: Array<{ how: string; rule: (base: AlterationRule) => AlterationRule }> = [
  { how: 'truncated rather than rounded', rule: (base) => ({ ...base, rounding: 'truncate' }) },
  { how: 'rounded twice', rule: (base) => ({ ...base, rounding: 'round-twice' }) },
  { how: 'sum of the rounded parts', rule: (base) => ({ ...base, total: 'sum-of-rounded-parts' }) },
  { how: 'divided by the gross landform', rule: (base) => ({ ...base, deduct: [] }) },
  { how: 'net of private land', rule: (base) => ({ ...base, deduct: ['privateLand'] }) },
  { how: 'net of rock', rule: (base) => ({ ...base, deduct: ['rock'] }) },
  { how: 'net of rock and private land', rule: (base) => ({ ...base, deduct: ['privateLand', 'rock'] }) },
  { how: 'proposed blocks only', rule: (base) => ({ ...base, numerator: ['proposed'] }) },
  { how: 'existing openings left out', rule: (base) => ({ ...base, numerator: ['proposed', 'otherPlanned'] }) },
]

/**
 * Checks a printed figure against the document's own areas under `rule`. A match is the printed text equal to what
 * the rule prints. A mismatch tries the other readings one at a time and names the first that reproduces it.
 */
export function checkPrintedAlteration(rule: AlterationRule, areas: AlterationAreas, printed: number): AlterationCheck {
  const result = alteration(rule, areas)
  if (!result) return { matches: false, reproduced: null, exact: null, explainedBy: null, note: 'No landform area.' }
  const target = printed.toFixed(rule.decimals)
  if (result.printed === target)
    return { matches: true, reproduced: result.printed, exact: result.percent, explainedBy: null, note: 'Reproduced.' }
  for (const reading of READINGS) {
    const other = alteration(reading.rule(rule), areas)
    if (other && other.printed === target) {
      return {
        matches: false,
        reproduced: result.printed,
        exact: result.percent,
        explainedBy: { how: reading.how, printed: other.printed },
        note: `Printed ${target}%; the rule gives ${result.printed}%. The printed figure is the ${reading.how}.`,
      }
    }
  }
  return {
    matches: false,
    reproduced: result.printed,
    exact: result.percent,
    explainedBy: null,
    note: `Printed ${target}%; the rule gives ${result.printed}% and no single change of rule reproduces it.`,
  }
}
