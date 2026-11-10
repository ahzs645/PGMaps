import { describe, expect, it } from 'vitest'
import {
  applySearchPreset,
  matchingSearchPreset,
  SEARCH_PRESET_CONFIRM,
  SEARCH_PRESET_SOURCE,
  SEARCH_PRESETS,
  searchPreset,
  searchPresetSummary,
} from './searchPresets'
import { DEFAULT_ROAD_SETTINGS } from './terrain'

describe('search presets', () => {
  it('reads each preset from one row of Engineering Manual Table 3-5', () => {
    // Table 3-5 (25 May 2026, p. 126): speed → minimum radius, favourable / adverse sustained, switchbacks.
    expect(
      SEARCH_PRESETS.map((p) => [
        p.id,
        p.designSpeedKmh,
        p.minRadiusM,
        p.favourableGradePercent,
        p.adverseGradePercent,
        p.switchbackGradePercent,
      ]),
    ).toEqual([
      ['spur', 20, 15, 16, 9, 8],
      ['block', 30, 35, 12, 8, 8],
      ['mainline', 50, 100, 10, 7, 7],
    ])
    expect(SEARCH_PRESET_SOURCE).toMatch(/Engineering Manual \(25 May 2026\), §3\.5\.2, Table 3-5.*p\. 126/)
    // The manual lists speeds, not road classes: the class-to-speed choice is ours to confirm.
    expect(SEARCH_PRESET_CONFIRM).toMatch(/^Confirm the design speed/)
    expect(searchPresetSummary(searchPreset('spur')!).speed).toBe('Read at 20 km/h (confirm).')
  })

  it('fills only the grade limit and the tightest curve, and is recognised until either changes', () => {
    const settings = { ...DEFAULT_ROAD_SETTINGS }
    const block = applySearchPreset(settings, searchPreset('block')!)
    expect(block).toEqual({ ...settings, maxGradePercent: 12, minRadius: 35 })
    expect(matchingSearchPreset(block)?.id).toBe('block')
    expect(matchingSearchPreset({ ...block, minRadius: 30 })).toBeUndefined()
    expect(searchPreset('nope')).toBeUndefined()
  })

  it('shows the adverse grade without setting a loaded direction', () => {
    const summary = searchPresetSummary(searchPreset('mainline')!)
    expect(summary.sets).toBe('Grade limit 10% (sustained favourable) and tightest curve 100 m.')
    expect(summary.shows).toMatch(/^Same row: adverse sustained 7%, switchbacks 7%, road width/)
    expect(summary.shows).toMatch(/Grades by haul direction/)
  })
})
