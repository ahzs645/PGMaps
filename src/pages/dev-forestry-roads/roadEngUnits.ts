/**
 * RoadEng's project units, `[design] units` in a design's `.dsn` and `units=` in a terrain's `.tlt`:
 * metres per project unit × 10,000. Softree's samples hold `10000` (metres), `3048` (international
 * feet) and `3048.00609601` (US survey feet, 1200/3937 m: the knowledge base's driveway example,
 * `RuralWithDriveways.dsnx` and `driveways1.terx`, on a US-foot state plane). Every code is written
 * back as it was read. Pure: no DOM or network access.
 */

/** The US survey foot, m. */
export const ROADENG_US_SURVEY_FOOT_M = 1200 / 3937
/** RoadEng's code for a design or terrain in US survey feet. */
export const ROADENG_US_SURVEY_FOOT_CODE = '3048.00609601'

/** Metres per project unit for each units code. */
export const ROADENG_UNITS: Readonly<Record<string, number>> = {
  '10000': 1,
  '3048': 0.3048,
  [ROADENG_US_SURVEY_FOOT_CODE]: ROADENG_US_SURVEY_FOOT_M,
}

/** Metres per project unit for a units code as written (surrounding blanks aside); null for one not known. */
export function roadEngUnitM(code: string | undefined): number | null {
  return code === undefined ? null : (ROADENG_UNITS[code.trim()] ?? null)
}

/** A project in feet of either kind (international or US survey). */
export const roadEngInFeet = (unitM: number) =>
  Math.abs(unitM - 0.3048) < 1e-9 || Math.abs(unitM - ROADENG_US_SURVEY_FOOT_M) < 1e-12

/** The unit's name in a sentence. */
export const roadEngUnitName = (unitM: number) =>
  Math.abs(unitM - ROADENG_US_SURVEY_FOOT_M) < 1e-12 ? 'US survey feet' : roadEngInFeet(unitM) ? 'feet' : 'metres'

/** The units the import reads, for a refusal. */
export const ROADENG_UNITS_READ = `10000 metres, 3048 feet, ${ROADENG_US_SURVEY_FOOT_CODE} US survey feet`
