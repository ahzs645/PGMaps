import { describe, expect, it } from 'vitest'
import { analyzeRoad } from './engine'
import {
  calendarDay,
  foundRoadSearchRows,
  foundRoadSearchSettings,
  foundRoadSearchSummary,
  parseFoundRoadSearchSettings,
} from './foundRoadSearch'
import { parseProject, projectReportHtml, serializeProject } from './project'
import { DEFAULT_SWITCHBACK_ROUTE_OPTIONS } from './switchbackOptions'
import { createDemoProject, demoTerrain } from './terrain'
import type { Alignment } from './types'

const record = (
  alignment: Pick<Alignment, 'points'>,
  patch: Partial<Parameters<typeof foundRoadSearchSettings>[0]> = {},
) =>
  foundRoadSearchSettings({
    alignment,
    goals: ['cost', 'shortest'],
    label: 'Lowest cost · Shortest',
    settings: { maxGradePercent: 12, minRadius: 35 },
    corridorHalfWidthM: 180,
    groundWindowM: 12,
    crossingCost: 8000,
    crossDrainCost: 1500,
    maxTerrainSlopePercent: null,
    switchbacks: DEFAULT_SWITCHBACK_ROUTE_OPTIONS,
    note: 'Corridor widened to ±360 m.',
    date: new Date(2026, 10, 10, 23, 30),
    ...patch,
  })

describe('found-road search settings', () => {
  it('keeps the goal, limits, corridor, ground window, switchbacks, prices and day', () => {
    const project = createDemoProject()
    const road = project.alignments[0]
    const kept = record(road)
    expect(kept).toMatchObject({
      goals: ['cost', 'shortest'],
      foundOn: '2026-11-10',
      maxGradePercent: 12,
      minRadiusM: 35,
      corridorHalfWidthM: 180,
      groundWindowM: 12,
      crossingCost: 8000,
      crossDrainCost: 1500,
      maxTerrainSlopePercent: null,
      // 12 % and 35 m are the block-road row of Table 3-5.
      preset: 'block',
      how: 'Corridor widened to ±360 m.',
    })
    expect(kept.switchbacks).toEqual(DEFAULT_SWITCHBACK_ROUTE_OPTIONS)
    expect(calendarDay(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(foundRoadSearchSummary(kept)).toBe('Found 2026-11-10 · Lowest cost · Shortest · 12% · ±180 m')
    expect(record(road, { settings: { maxGradePercent: 11, minRadius: 35 }, note: undefined })).not.toHaveProperty(
      'preset',
    )
  })

  it('saves with the project, older projects load without it, and bad records are refused', () => {
    const project = createDemoProject()
    const road = project.alignments[0]
    road.searchSettings = record(road)
    const restored = parseProject(serializeProject(project))
    expect(restored.alignments[0].searchSettings).toEqual(road.searchSettings)
    delete road.searchSettings
    expect(parseProject(serializeProject(project)).alignments[0]).not.toHaveProperty('searchSettings')
    const saved = JSON.parse(JSON.stringify(record(road)))
    expect(parseFoundRoadSearchSettings(saved)).toEqual(saved)
    for (const [patch, message] of [
      [{ goals: ['fastest'] }, /Unknown found-road search goal/],
      [{ goals: [] }, /goals must be a list/],
      [{ foundOn: '2026-02-31' }, /real date/],
      [{ maxGradePercent: 35 }, /grade limit must be 1–30/],
      [{ corridorHalfWidthM: 5 }, /corridor must be 25–1,000/],
      [{ preset: 'highway' }, /Unknown found-road search preset/],
      [{ switchbacks: { allow: 'yes' } }, /true or false/],
      [{ how: 'x'.repeat(700) }, /note must be text/],
    ] as const)
      expect(() => parseFoundRoadSearchSettings({ ...saved, ...patch })).toThrow(message)
  })

  it('shows in the road info and the report, and says when the line has been edited since', () => {
    const project = createDemoProject()
    const road = project.alignments.find((a) => a.id === project.activeAlignmentId)!
    road.searchSettings = record(road, {
      switchbacks: { ...DEFAULT_SWITCHBACK_ROUTE_OPTIONS, allow: true, radiusM: 20 },
      maxTerrainSlopePercent: 60,
    })
    const rows = foundRoadSearchRows(road)
    expect(rows.map((row) => row.label)).toEqual([
      'Found by',
      'Search limits',
      'Search area',
      'Switchbacks',
      'Search prices',
      'How it was found',
    ])
    expect(rows[0].value).toBe('Find the best route, 2026-11-10: led Lowest cost · Shortest')
    expect(rows[1].value).toMatch(
      /^Grade 12%; tightest curve 35 m; Block road preset \(Engineering Manual Table 3-5 at 30 km\/h, speed to confirm\)$/,
    )
    expect(rows[2].value).toBe('Corridor ±180 m; ground trend 12 m; side-hill limit 60%')
    expect(rows[3].value).toMatch(/^Allowed: radius 20 m/)
    expect(rows[4].value).toBe('Stream crossing $8,000; cross-drain $1,500 (placeholder allowances)')
    const report = projectReportHtml(project, analyzeRoad(road, demoTerrain, project.settings))
    expect(report).toContain('<dt>Found by</dt><dd>Find the best route, 2026-11-10: led Lowest cost · Shortest</dd>')
    expect(report).toContain('<dt>Search area</dt><dd>Corridor ±180 m; ground trend 12 m; side-hill limit 60%</dd>')
    // Edited since: the settings describe where the road started.
    road.points = road.points.map((point, i) =>
      i === 0 ? { ...point, coordinate: [point.coordinate[0] + 1e-4, point.coordinate[1]] } : point,
    )
    expect(foundRoadSearchRows(road)[0].value).toMatch(/The line has been edited since$/)
    // A road the search did not make prints nothing.
    expect(foundRoadSearchRows({ points: road.points })).toEqual([])
  })
})
