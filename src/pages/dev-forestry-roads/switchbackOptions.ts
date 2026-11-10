/**
 * The saved settings of the switchback route search (`switchbackSearch.ts`), their limits and the
 * fixed figures its hairpin rules use.
 *
 * Implements the option set of SylvaRoaD 2.2 (S. Dupire, SylvaLab / ONF, 2021) as stated in a
 * functional specification of its options, behaviour and defects, mapped onto PGMaps' route search.
 * The hairpin rules (platform share, spacing, sharpest stackable turn) are SylvaRoaD's own empirical
 * figures; no SylvaRoaD publication was found. Written from a functional specification; no code from
 * SylvaRoaD or its QGIS port (GPL-3.0) was used.
 *
 * Pure: no DOM or network access.
 */

/** Saved under `routeSearch.switchbacks`. Absent in older projects, which then load with these off. */
export interface SwitchbackRouteOptions {
  /** Let the search turn back on itself through switchbacks. Off: a turn sharper than `hairpinAngleDeg` is refused. */
  allow: boolean
  /** Centreline radius of each switchback; null takes the road's minimum radius, and at least 12 m. */
  radiusM: number | null
  /** Straight between the two main curves of a redrawn switchback. */
  middleStraightM: number
  /** Least distance between two switchbacks' turning points, as a multiple of the radius. */
  spacingFactor: number
  /** Ground steeper than this counts as steep for the switchback platform test. */
  platformSlopePercent: number
  /** Largest share (0–1) of the platform circle, 1.25 R about the turning point, that may be steep. */
  platformSteepShare: number
  /** Largest centreline cut or fill on a redrawn switchback's own turn; null does not limit it. */
  turnCutFillM: number | null
  /** Metres of road one switchback is worth to the search, on top of its turn and platform costs. */
  penaltyM: number
  /** A change of heading above this makes a vertex a switchback. */
  hairpinAngleDeg: number
  /** Least grade of every straight piece, for drainage. 0 sets none. */
  minGradePercent: number
  /** True refuses a piece under the minimum grade; false only charges for it. */
  minGradeHard: boolean
  /** Largest departure of the ground from a straight grade over a 42 m piece; scaled with piece length. */
  chordCutFillM: number
  /**
   * Metres of road the search may run on ground steeper than `routeSearch.maxTerrainSlopePercent`.
   * 0 makes that limit a hard screen, as the terrain-cost search applies it.
   */
  sideHillBudgetM: number
  /** Metres of road a full grade reversal (+max to −max) is worth; null takes the goal's own figure. */
  gradeChangePenaltyM: number | null
  /** Pass within this distance of each of the road's interior points; null treats them as a guide only. */
  passPointsWithinM: number | null
}

export const DEFAULT_SWITCHBACK_ROUTE_OPTIONS: SwitchbackRouteOptions = {
  allow: false,
  radiusM: null,
  middleStraightM: 2,
  spacingFactor: 3,
  platformSlopePercent: 55,
  platformSteepShare: 0.25,
  turnCutFillM: null,
  penaltyM: 100,
  hairpinAngleDeg: 110,
  minGradePercent: 0,
  minGradeHard: false,
  chordCutFillM: 3,
  sideHillBudgetM: 0,
  gradeChangePenaltyM: null,
  passPointsWithinM: null,
}

/** Bounds the parser and the fields enforce. */
export const SWITCHBACK_ROUTE_LIMITS = {
  radiusM: [5, 200],
  middleStraightM: [1, 200],
  spacingFactor: [1, 10],
  platformSlopePercent: [5, 300],
  platformSteepShare: [0, 1],
  turnCutFillM: [0.5, 30],
  penaltyM: [0, 5000],
  hairpinAngleDeg: [60, 170],
  minGradePercent: [0, 20],
  chordCutFillM: [0.1, 50],
  sideHillBudgetM: [0, 10_000],
  gradeChangePenaltyM: [0, 5000],
  passPointsWithinM: [1, 500],
} as const

/** A switchback radius is at least this when none is entered, whatever the road's minimum radius. */
export const DEFAULT_SWITCHBACK_RADIUS_M = 12
/** The batter between stacked legs, horizontal per vertical, in the sharpest-turn rule. */
export const STACKED_LEG_BATTER = 1.5
/** The turning platform's width in the sharpest-turn rule. */
export const PLATFORM_WIDTH_M = 4
/** The platform circle's radius, as a multiple of the switchback radius. */
export const PLATFORM_RADIUS_FACTOR = 1.25
/** Metres of road a switchback costs when its platform is steep to exactly the allowed share. */
export const PLATFORM_COST_M = 100
/** The piece length the straight-grade cut/fill limit is stated for; a piece gets it in proportion. */
export const CHORD_REFERENCE_M = 42

/** The radius a search uses: the entered one, else the road's minimum radius but no less than 12 m. */
export const switchbackRadius = (options: Pick<SwitchbackRouteOptions, 'radiusM'>, roadMinRadiusM: number) =>
  options.radiusM ?? Math.max(roadMinRadiusM, DEFAULT_SWITCHBACK_RADIUS_M)

/**
 * The sharpest switchback the legs can be stacked through, degrees. The turn is held at half the
 * grade limit plus 2 %; the first term reserves the spread the stacked legs need at the 1.5:1 batter,
 * the second the 4 m platform on a turn of diameter 2R. 12 % and R 8 m give 154.55°.
 */
export function sharpestSwitchbackDegrees(maxGradePercent: number, radiusM: number) {
  const turnGrade = (0.5 * maxGradePercent + 2) / 100
  return (
    180 -
    (turnGrade / STACKED_LEG_BATTER) * 180 * (1 + 1 / (2 * Math.PI)) -
    (PLATFORM_WIDTH_M * 360) / (2 * Math.PI * 2 * radiusM)
  )
}

/** The cut or fill a straight piece of `lengthM` may need to hold a constant grade. */
export const chordTolerance = (chordCutFillM: number, lengthM: number) => (chordCutFillM * lengthM) / CHORD_REFERENCE_M

/** Validates saved switchback settings; absent fields keep their defaults. */
export function parseSwitchbackRouteOptions(input: unknown): SwitchbackRouteOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Switchback search settings must be an object.')
  const values = input as Record<string, unknown>
  const options = Object.fromEntries(
    Object.entries(DEFAULT_SWITCHBACK_ROUTE_OPTIONS).map(([key, fallback]) => [
      key,
      values[key] === undefined ? fallback : values[key],
    ]),
  ) as unknown as SwitchbackRouteOptions
  if (typeof options.allow !== 'boolean' || typeof options.minGradeHard !== 'boolean')
    throw Error('Switchback search switches must be true or false.')
  const names: Record<keyof typeof SWITCHBACK_ROUTE_LIMITS, string> = {
    radiusM: 'switchback radius (m)',
    middleStraightM: 'switchback middle straight (m)',
    spacingFactor: 'switchback spacing (× radius)',
    platformSlopePercent: 'platform slope limit (%)',
    platformSteepShare: 'steep share of a platform (0–1)',
    turnCutFillM: 'cut or fill on a switchback turn (m)',
    penaltyM: 'cost per switchback (m)',
    hairpinAngleDeg: 'switchback angle (°)',
    minGradePercent: 'minimum grade (%)',
    chordCutFillM: 'straight-grade cut or fill (m)',
    sideHillBudgetM: 'side-hill length (m)',
    gradeChangePenaltyM: 'grade-change penalty (m)',
    passPointsWithinM: 'distance to pass the road points (m)',
  }
  const nullable = new Set(['radiusM', 'turnCutFillM', 'gradeChangePenaltyM', 'passPointsWithinM'])
  for (const [key, [min, max]] of Object.entries(SWITCHBACK_ROUTE_LIMITS)) {
    const value = options[key as keyof SwitchbackRouteOptions]
    if (value === null && nullable.has(key)) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw Error(
        `Use a ${names[key as keyof typeof SWITCHBACK_ROUTE_LIMITS]} from ${min} to ${max.toLocaleString('en-CA')}${nullable.has(key) ? ', or leave it empty' : ''}.`,
      )
  }
  return options
}
