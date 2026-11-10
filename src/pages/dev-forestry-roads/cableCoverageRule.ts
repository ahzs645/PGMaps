/**
 * The cable yarder's settings for block coverage (Design → Extraction reach → Cable yarder): the
 * rigging as PGMaps' `CableRigging`, the machine's heights and line rules, and where lines start.
 * Machine presets are Sylvaccess 3.6's four "types of material" with its classical carriage,
 * converted to PGMaps' units (kgF × 9.80665 ÷ 1000 → kN).
 *
 * Sources: Dupire S., Bourrier F., Monnet J.-M., Berger F. (2015), Sylvaccess : un modèle pour
 * cartographier automatiquement l'accessibilité des forêts, Revue forestière française 67(2):
 * 111–126 (Table II); the Sylvaccess 3.6 detailed user notice (INRAE UR LESSEM, September 2024).
 * Written from a functional specification; no code from Sylvaccess (GPL-3.0-or-later) was used.
 *
 * Pure: no DOM or network access.
 */
import { EXAMPLE_RIGGING, riggingErrors, STANDARD_GRAVITY, type CableRigging } from './cableMechanics'

/** Where the yarder may stand relative to the line: above it (logs come up), below it, or either. */
export type CablePosition = 'either' | 'above' | 'below'
/** Multi-cable: a haulback pulls the carriage out. Two-cable: it runs out by gravity, downhill only. */
export type CableCarriageSystem = 'multi-cable' | 'two-cable'

export interface CableCoverageRule {
  rigging: CableRigging
  /** Skyline height at the yarder (tower top), m. */
  towerHeightM: number
  /** Skyline height at an intermediate support, m. */
  supportHeightM: number
  /** Skyline height at the tail support, m. */
  tailHeightM: number
  /** Most intermediate supports per line. */
  maxSupports: number
  /** Longest skyline, m; the anchor allowance behind the tail comes off it. */
  maxSkylineM: number
  /** Shortest line kept, m (along the skyline). */
  minLineM: number
  /** Half-width of the band a line yards, m. */
  lateralM: number
  /** Highest the loaded line may run above the ground, m (longer hook times beyond it). */
  maxHeightAboveGroundM: number
  /** Least horizontal distance between two intermediate supports, m. */
  minSupportSpacingM: number
  /** Largest loaded break angle at an intermediate support, degrees. */
  maxBreakDeg: number
  position: CablePosition
  system: CableCarriageSystem
  /** Bearings tried from each landing, degrees apart. */
  bearingStepDeg: number
  /** Distance between landings along a road, m. */
  landingSpacingM: number
  /** Longest stretch a line may run outside the block before it must end, m. */
  maxOutsideBlockM: number
}

/** Sylvaccess's side-slope rule (fixed in its interface): ground steeper than this… */
export const SIDE_SLOPE_PERCENT = 30
/** …crossed more than this far off the fall line… */
export const SIDE_SLOPE_OFF_FALL_LINE_DEG = 30
/** …may add up to this much along a line, m… */
export const SIDE_SLOPE_MAX_M = 75
/** …and to no more than this share of the line at its end. */
export const SIDE_SLOPE_MAX_SHARE = 0.15
/** Anchor allowance behind the tail: a 45° guyline from the tail top plus this, m (Sylvaccess). */
export const ANCHOR_EXTRA_M = 5
/** Load positions within this distance of a support are not held to the clearance, m (Sylvaccess). */
export const SUPPORT_CLEARANCE_ZONE_M = 10
/** Lowest pre-tension tried, as a share of the allowable tension. */
export const COVER_LOWEST_TENSION_SHARE = 1 / 32
/** Pre-tensions tried, evenly from the lowest to the allowable (the crate's mask holds ≤ 64). */
export const COVER_TENSION_LEVELS = 32
/** Most candidate lines (landings × bearings) a run screens. */
export const MAX_COVER_LINES = 12_000
/** Most spans the screen evaluates for one line before reporting it at its budget. */
export const MAX_COVER_SPANS_PER_LINE = 3_000
/** Lines sent to the module per call (one progress step). */
export const COVER_BATCH_LINES = 24
/** Longest skyline, m; the crate checks spans to `MAX_MECHANICS_SPAN_M`. */
export const MAX_COVER_SKYLINE_M = 2_000
/** Most intermediate supports (the crate's `MAX_COVER_SUPPORTS`). */
export const MAX_COVER_SUPPORTS = 10

type NumericKey = Exclude<keyof CableCoverageRule, 'rigging' | 'position' | 'system'>

/** [low, high] for every number. */
export const CABLE_RULE_LIMITS: Record<NumericKey, readonly [number, number]> = {
  towerHeightM: [0, 40],
  supportHeightM: [1, 40],
  tailHeightM: [1, 40],
  maxSupports: [0, MAX_COVER_SUPPORTS],
  maxSkylineM: [100, MAX_COVER_SKYLINE_M],
  minLineM: [20, 1_000],
  lateralM: [5, 200],
  maxHeightAboveGroundM: [10, 200],
  minSupportSpacingM: [10, 500],
  maxBreakDeg: [5, 60],
  bearingStepDeg: [1, 15],
  landingSpacingM: [5, 500],
  maxOutsideBlockM: [0, 500],
}

export const CABLE_RULE_LABELS: Record<NumericKey, string> = {
  towerHeightM: 'Tower height (m)',
  supportHeightM: 'Support height (m)',
  tailHeightM: 'Tail height (m)',
  maxSupports: 'Most supports',
  maxSkylineM: 'Longest skyline (m)',
  minLineM: 'Shortest line (m)',
  lateralM: 'Lateral yarding (m)',
  maxHeightAboveGroundM: 'Highest above ground (m)',
  minSupportSpacingM: 'Support spacing (m)',
  maxBreakDeg: 'Max loaded break (°)',
  bearingStepDeg: 'Bearing step (°)',
  landingSpacingM: 'Landing spacing (m)',
  maxOutsideBlockM: 'Outside block (m)',
}

export type CablePresetId = 'tractor' | 'trailer' | 'truck' | 'long'

const kgfToKN = (kgf: number) => (kgf * STANDARD_GRAVITY) / 1000

/** Sylvaccess's rope: E = 100 kN/mm² on the full circle, 0.5 kg/m mainline and haulback. */
function sylvaccessRigging(diameterMm: number, massKgPerM: number, breakingKgf: number): CableRigging {
  return {
    ...EXAMPLE_RIGGING,
    tensionMode: 'allowable',
    ropeMassKgPerM: massKgPerM,
    ropeDiameterMm: diameterMm,
    metallicFillFactor: 1,
    elasticModulusKNPerMm2: 100,
    breakingForceKN: Math.round(kgfToKN(breakingKgf) * 10) / 10,
    safetyFactor: 2.5,
    payloadKg: 2_500,
    carriageKg: 400,
    runningLinesKgPerM: 1,
    minClearanceM: 3.5,
  }
}

const SHARED = {
  supportHeightM: 12,
  tailHeightM: 12,
  maxHeightAboveGroundM: 50,
  minSupportSpacingM: 50,
  maxBreakDeg: 30,
  position: 'either' as CablePosition,
  bearingStepDeg: 2,
  landingSpacingM: 25,
}

/**
 * Sylvaccess 3.6's machine types with its classical carriage (400 kg empty in its parameter
 * dictionary, 2,500 kg payload). Examples, not recommendations: enter your machine's ratings.
 */
export const CABLE_PRESETS: Record<CablePresetId, { label: string; rule: CableCoverageRule }> = {
  tractor: {
    label: 'Tower on farm tractor',
    rule: {
      ...SHARED,
      rigging: sylvaccessRigging(16, 1.35, 25_000),
      towerHeightM: 8.5,
      maxSupports: 2,
      maxSkylineM: 500,
      minLineM: 125,
      lateralM: 35,
      system: 'multi-cable',
      maxOutsideBlockM: 50,
    },
  },
  trailer: {
    label: 'Tower on trailer',
    rule: {
      ...SHARED,
      rigging: sylvaccessRigging(18, 1.85, 35_000),
      towerHeightM: 10.5,
      maxSupports: 3,
      maxSkylineM: 750,
      minLineM: 150,
      lateralM: 40,
      system: 'multi-cable',
      maxOutsideBlockM: 75,
    },
  },
  truck: {
    label: 'Tower on truck',
    rule: {
      ...SHARED,
      rigging: sylvaccessRigging(22, 2.6, 48_000),
      towerHeightM: 14,
      maxSupports: 3,
      maxSkylineM: 1_200,
      minLineM: 200,
      lateralM: 40,
      system: 'multi-cable',
      maxOutsideBlockM: 120,
    },
  },
  long: {
    label: 'Long skyline, gravity carriage',
    rule: {
      ...SHARED,
      rigging: sylvaccessRigging(22, 2.6, 48_000),
      towerHeightM: 8,
      maxSupports: 3,
      maxSkylineM: 1_500,
      minLineM: 300,
      lateralM: 40,
      system: 'two-cable',
      position: 'above',
      maxOutsideBlockM: 150,
    },
  },
}

export const DEFAULT_CABLE_RULE: CableCoverageRule = CABLE_PRESETS.trailer.rule

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Every reason the rule cannot run, in the form's words. Empty when it can. */
export function cableRuleErrors(rule: CableCoverageRule): string[] {
  const errors: string[] = []
  for (const key of Object.keys(CABLE_RULE_LIMITS) as NumericKey[]) {
    const [low, high] = CABLE_RULE_LIMITS[key]
    const v = rule[key]
    if (!finite(v) || v < low || v > high) errors.push(`${CABLE_RULE_LABELS[key]} must be between ${low} and ${high}.`)
  }
  if (!['either', 'above', 'below'].includes(rule.position)) errors.push('Choose where the yarder stands.')
  if (!['multi-cable', 'two-cable'].includes(rule.system)) errors.push('Choose a multi-cable or gravity carriage.')
  if (rule.system === 'two-cable' && rule.position === 'below')
    errors.push('A gravity carriage runs out downhill: the yarder must stand above the line.')
  if (!Number.isInteger(rule.maxSupports)) errors.push('Most supports must be a whole number.')
  errors.push(...riggingErrors(rule.rigging))
  if (errors.length) return errors
  if (rule.rigging.tensionMode !== 'allowable')
    errors.push('Cable coverage tensions each line to its allowable working tension; choose that tension mode.')
  if (rule.minLineM >= usableSkylineM(rule))
    errors.push('The shortest line must be shorter than the skyline less its anchor allowance.')
  if (rule.rigging.minClearanceM > rule.supportHeightM)
    errors.push('The load clearance must not be above the support height.')
  return errors
}

/** Throws the first reason the rule cannot run. */
export function validateCableRule(rule: CableCoverageRule): CableCoverageRule {
  const errors = cableRuleErrors(rule)
  if (errors.length) throw Error(errors[0])
  return rule
}

/** Horizontal distance from the tail to its anchor: a 45° guyline from the tail top, plus a margin. */
export const anchorDistanceM = (rule: CableCoverageRule) => rule.tailHeightM + ANCHOR_EXTRA_M

/** Skyline left for the line once the guyline to the anchor is paid out, m (Sylvaccess: L − √2·(h + 5)). */
export const usableSkylineM = (rule: CableCoverageRule) => rule.maxSkylineM - Math.SQRT2 * anchorDistanceM(rule)
