/**
 * Search presets for Find the best route: a spur, a block road and a mainline. Each fills the grade
 * limit and the tightest curve from one row of the BC Engineering Manual's Table 3-5. The manual
 * gives those rows by design speed, not by road class: which speed suits a spur, a block road or a
 * mainline is this tool's starting choice, marked "confirm", as is everything the table does not give.
 *
 * Free of DOM and network access.
 */
import type { RoadSettings } from './types'

export type SearchPresetId = 'spur' | 'block' | 'mainline'

export interface SearchPreset {
  id: SearchPresetId
  label: string
  /** The Table 3-5 row the values are read from. Choosing this row for the class is ours: confirm it. */
  designSpeedKmh: number
  /** Table 3-5 "Minimum Radius of Curve (m)" for that speed. Fills the tightest curve. */
  minRadiusM: number
  /** Table 3-5 suggested maximum gradient, favourable, sustained. Fills the grade limit. */
  favourableGradePercent: number
  /** Table 3-5 adverse, sustained. Shown only: it depends on the loaded direction, which is the user's to set. */
  adverseGradePercent: number
  /** Table 3-5 switchbacks column. Shown only. */
  switchbackGradePercent: number
  /** Table 3-5 suggested road width, m, as printed. Shown only. */
  roadWidth: string
}

/** Where the numbers come from. */
export const SEARCH_PRESET_SOURCE =
  'BC Ministry of Forests, Engineering Manual (25 May 2026), §3.5.2, Table 3-5 "Geometric Road Design Parameters", p. 126: suggested values for average conditions on forest roads; the notes require site-specific maximum grades.'
/** What a person must confirm before relying on a preset. */
export const SEARCH_PRESET_CONFIRM =
  'Confirm the design speed for this road: Table 3-5 lists speeds, not road classes. The class-to-speed choice is a starting value.'

export const SEARCH_PRESETS: readonly SearchPreset[] = [
  {
    id: 'spur',
    label: 'Spur',
    designSpeedKmh: 20,
    minRadiusM: 15,
    favourableGradePercent: 16,
    adverseGradePercent: 9,
    switchbackGradePercent: 8,
    roadWidth: '4–4.5 m',
  },
  {
    id: 'block',
    label: 'Block road',
    designSpeedKmh: 30,
    minRadiusM: 35,
    favourableGradePercent: 12,
    adverseGradePercent: 8,
    switchbackGradePercent: 8,
    roadWidth: '5–6 m',
  },
  {
    id: 'mainline',
    label: 'Mainline',
    designSpeedKmh: 50,
    minRadiusM: 100,
    favourableGradePercent: 10,
    adverseGradePercent: 7,
    switchbackGradePercent: 7,
    roadWidth: '6 m, or 8 m and over for two lanes',
  },
]

export const searchPreset = (id: string) => SEARCH_PRESETS.find((preset) => preset.id === id)

/** The settings a preset fills: only the grade limit and the tightest curve. */
export function applySearchPreset(settings: RoadSettings, preset: SearchPreset): RoadSettings {
  return { ...settings, maxGradePercent: preset.favourableGradePercent, minRadius: preset.minRadiusM }
}

/** The preset the settings match as they stand, or undefined once either value is changed. */
export function matchingSearchPreset(settings: Pick<RoadSettings, 'maxGradePercent' | 'minRadius'>) {
  return SEARCH_PRESETS.find(
    (preset) =>
      Math.abs(settings.maxGradePercent - preset.favourableGradePercent) < 1e-9 &&
      Math.abs(settings.minRadius - preset.minRadiusM) < 1e-9,
  )
}

/** "What this sets" for the preset's InfoTip: the values it fills, then the ones it only shows. */
export function searchPresetSummary(preset: SearchPreset) {
  return {
    sets: `Grade limit ${preset.favourableGradePercent}% (sustained favourable) and tightest curve ${preset.minRadiusM} m.`,
    shows: `Same row: adverse sustained ${preset.adverseGradePercent}%, switchbacks ${preset.switchbackGradePercent}%, road width ${preset.roadWidth}. The adverse grade belongs under Grades by haul direction, once you choose which way loaded trucks travel.`,
    speed: `Read at ${preset.designSpeedKmh} km/h (confirm).`,
  }
}
