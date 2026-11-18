import { describe, expect, it } from 'vitest'
import { analyzeRoad, distance, offsetCoordinate } from './engine'
import { groundAlong, roadSummaryMetrics } from './roadSummaryMetrics'
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

describe('design-file ground', () => {
  it('reads straight between recorded points and nothing outside them', () => {
    const pairs: [number, number][] = [
      [0, 100],
      [50, 105],
      [150, 100],
    ]
    expect(groundAlong(pairs, 25)).toBeCloseTo(102.5, 9)
    expect(groundAlong(pairs, 100)).toBeCloseTo(102.5, 9)
    expect(groundAlong(pairs, 151)).toBeNull()
    expect(groundAlong([], 10)).toBeNull()
  })
})

describe('haul volumes by class', () => {
  const metrics = (analysis: RoadAnalysis) =>
    roadSummaryMetrics({
      analysis,
      alignment,
      settings: DEFAULT_ROAD_SETTINGS,
      groundOnly: false,
      preview: null,
      record: undefined,
      recordCurrent: false,
      unpriced: 0,
      incomplete: [],
      costOpen: false,
      onCost: () => {},
      onIncomplete: () => {},
    })
  const withHaul = (haul: Record<string, unknown>) => {
    const analysis = analyze()
    return {
      ...analysis,
      engineering: { movements: [], ...analysis.engineering, haul: { ...analysis.engineering?.haul, ...haul } },
    } as RoadAnalysis
  }
  const solved = {
    enabled: true,
    optimizationStatus: 'optimal',
    complete: true,
    freeHaulM3: 1200,
    overhaulM3: 340,
    endHaulM3: 0,
    haulM3Km: 410.4,
    borrowCompactedM3: 75,
    wasteBankM3: 0,
    wasteFreeHaulBankM3: 0,
    wasteOverhaulBankM3: 0,
    wasteEndHaulBankM3: 0,
  }

  it('lists free, over and end haul once the plan is solved, hidden until chosen', () => {
    const haul = metrics(withHaul(solved)).find((m) => m.key === 'haul')
    expect(haul?.value).toBe('1,200 / 340 / 0 m³')
    expect(haul?.note).toContain('borrow 75 m³')
    expect(haul?.defaultLevel).toBe('hidden')
  })

  it('never reads haul off or an unsolved plan as zero haul or nothing unplaced', () => {
    const off = metrics(withHaul({ ...solved, enabled: false }))
    expect(off.find((m) => m.key === 'haul')?.value).toBe('Haul off')
    expect(off.find((m) => m.key === 'unplaced')?.value).toBe('Haul off')
    const unsolved = metrics(withHaul({ ...solved, optimizationStatus: 'infeasible' }))
    expect(unsolved.find((m) => m.key === 'haul')?.value).toBe('Plan not solved')
  })

  it('names what no site had room for, as a warning', () => {
    const row = metrics(withHaul({ ...solved, unallocatedWasteM3: 5567.2, unallocatedBorrowM3: 0 })).find(
      (m) => m.key === 'unplaced',
    )
    expect(row?.value).toBe('5,567 bank m³ cut')
    expect(row?.tone).toBe('warning')
    expect(
      metrics(withHaul({ ...solved, unallocatedWasteM3: 0, unallocatedBorrowM3: 0 })).find((m) => m.key === 'unplaced')
        ?.value,
    ).toBe('None')
  })

  it('offers the end balance as a hidden row', () => {
    const end = metrics(analyze()).find((m) => m.key === 'mass-end')
    expect(end?.defaultLevel).toBe('hidden')
    expect(end?.value).toMatch(/m³$/)
  })
})
