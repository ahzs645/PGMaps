import { describe, expect, it } from 'vitest'
import { analyzeRoad, distance, offsetCoordinate } from './engine'
import { roadSummaryMetrics } from './roadSummaryMetrics'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, DEMO_ORIGIN } from './terrain'
import type { Alignment, RoadAnalysis } from './types'

const alignment: Alignment = {
  id: 'summary-road',
  name: 'Summary road',
  color: '#16817a',
  points: [
    { id: 'start', coordinate: DEMO_ORIGIN, radiusM: 0 },
    { id: 'end', coordinate: offsetCoordinate(DEMO_ORIGIN, 0, 100), radiusM: 0 },
  ],
  vertical: [
    { id: 'start', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'crest', chainage: 20, elevation: 900, curveLength: 0 },
    { id: 'end', chainage: 100, elevation: 810, curveLength: 0 },
  ],
  template: DEFAULT_TEMPLATE,
  overrides: [],
}

function analyze(road = alignment) {
  return analyzeRoad(
    road,
    { elevationAt: (lng, lat) => 1000 + 0.04 * distance(DEMO_ORIGIN, [lng, lat]) },
    DEFAULT_ROAD_SETTINGS,
  )
}

function overallGrade(analysis: RoadAnalysis, groundOnly = false) {
  return roadSummaryMetrics({
    analysis,
    alignment,
    settings: DEFAULT_ROAD_SETTINGS,
    groundOnly,
    preview: null,
    record: undefined,
    recordCurrent: false,
    unpriced: 0,
    incomplete: [],
    costOpen: false,
    onCost: () => {},
    onIncomplete: () => {},
  }).find((metric) => metric.key === 'overall-grade')!
}

describe('overall road grade', () => {
  it.each([
    [810, '10%'],
    [790, '-10%'],
    [800, '0%'],
  ])('uses net design elevation change, ending at %s m, despite an intervening crest', (elevation, value) => {
    const road = {
      ...alignment,
      vertical: alignment.vertical.map((pvi) => (pvi.id === 'end' ? { ...pvi, elevation } : pvi)),
    }
    const metric = overallGrade(analyze(road))
    expect(metric.value).toBe(value)
    expect(metric.note).toContain('Design elevation change')
    expect(metric.note).toContain('positive uphill, negative downhill')
  })

  it('uses ground elevations when showing a ground-only road', () => {
    const metric = overallGrade(analyze(), true)
    expect(metric.value).toBe('4%')
    expect(metric.note).toContain('Ground elevation change 4 m over 100 m')
  })

  it.each([0, -1])('requires the actual endpoint elevation at index %s', (index) => {
    const analysis = analyze()
    analysis.stations.at(index)!.designElevation = null
    expect(overallGrade(analysis).value).toBe('Missing')
    // Ground measurements remain available, but cannot substitute for a design endpoint.
    expect(overallGrade(analysis, true).value).toBe('4%')
    analysis.stations.at(index)!.groundElevation = null
    expect(overallGrade(analysis, true).value).toBe('Missing')
  })

  it('requires a non-zero length and at least two stations', () => {
    const analysis = analyze()
    expect(overallGrade({ ...analysis, length: 0 }).value).toBe('Missing')
    expect(overallGrade({ ...analysis, stations: analysis.stations.slice(0, 1) }).value).toBe('Missing')
    expect(overallGrade({ ...analysis, stations: [] }).value).toBe('Missing')
  })
})
