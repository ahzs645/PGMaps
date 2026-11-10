import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { batterMisses, planSectionRange, rangeStillHolds, sectionSourceAt } from './sectionRangeApply'
import { templateAt } from './templates'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, TemplateAssignment, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const label = (chainage: number) => `${chainage} m`
let next = 0
const options = { id: () => `new-${++next}`, stationLabel: label }

function road(assignments: Omit<TemplateAssignment, 'templateId'>[] = [], templateId = 'wide'): Alignment {
  return {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 300), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'm', chainage: 150, elevation: 815, curveLength: 0 },
      { id: 'e', chainage: 300, elevation: 800, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
    engineering: {
      ...createEngineeringDesign(),
      templates: [
        { id: 'wide', name: 'Wide', template: { ...DEFAULT_TEMPLATE, leftWidth: 5, rightWidth: 5 } },
        { id: 'steep', name: 'Steep', template: { ...DEFAULT_TEMPLATE, cutSlope: 0.5 } },
      ],
      assignments: assignments.map((a) => ({ templateId, ...a })),
    },
  }
}

const planned = (result: ReturnType<typeof planSectionRange>) => {
  if ('error' in result) throw Error(result.error)
  return result.plan
}

describe('the section at a station', () => {
  it('is the base section where no range applies', () => {
    expect(sectionSourceAt(road(), 50, label)).toEqual({ kind: 'base', name: 'Base section' })
  })

  it('is the named template where one covers both sides at full strength', () => {
    const alignment = road([{ id: 'a1', start: 40, end: 120, side: 'both', transitionM: 10 }])
    expect(sectionSourceAt(alignment, 80, label)).toEqual({ kind: 'named', templateId: 'wide', name: 'Wide' })
  })

  it('is saved as a new template inside a transition, exactly as resolved there', () => {
    const alignment = road([{ id: 'a1', start: 40, end: 120, side: 'both', transitionM: 20 }])
    const source = sectionSourceAt(alignment, 45, label)
    expect(source.kind).toBe('snapshot')
    expect(source.name).toBe('Section at 45 m')
    if (source.kind === 'snapshot') expect(source.template).toEqual(templateAt(alignment, 45).template)
  })

  it('is saved as a new template when the sides differ, with a name not already taken', () => {
    const alignment = road([{ id: 'a1', start: 40, end: 120, side: 'left', transitionM: 0 }])
    alignment.engineering!.templates.push({ id: 'x', name: 'Section at 60 m', template: { ...DEFAULT_TEMPLATE } })
    expect(sectionSourceAt(alignment, 60, label)).toMatchObject({ kind: 'snapshot', name: 'Section at 60 m (2)' })
  })
})

describe('whether a range still has the section given to it', () => {
  it('holds while the range has it, and not once an undo gave the range back', () => {
    const given = road([{ id: 'a1', start: 40, end: 120, side: 'both', transitionM: 0 }])
    expect(rangeStillHolds(given, { from: 40, to: 120, name: 'Wide' }, label)).toBe(true)
    // Undone: the range is on the base section again, and the batter check was about Wide.
    expect(rangeStillHolds(road(), { from: 40, to: 120, name: 'Wide' }, label)).toBe(false)
    expect(rangeStillHolds(given, { from: 40, to: 120, name: 'Base section' }, label)).toBe(false)
    expect(rangeStillHolds(road(), { from: 40, to: 120, name: 'Base section' }, label)).toBe(true)
  })
})

describe('giving a section to a range', () => {
  it('assigns the named template over the range', () => {
    const alignment = road([{ id: 'a1', start: 0, end: 50, side: 'both', transitionM: 0 }])
    const plan = planned(planSectionRange(alignment, 20, [200, 260], 300, options))
    expect(plan.affected).toEqual([])
    expect(plan.changed).toBe(true)
    expect(plan.engineering.assignments.map((a) => [a.start, a.end, a.templateId])).toEqual([
      [0, 50, 'wide'],
      [200, 260, 'wide'],
    ])
  })

  it('trims, splits and replaces the ranges in the way, and says so', () => {
    const alignment = road([
      { id: 'a1', start: 0, end: 80, side: 'both', transitionM: 0 },
      { id: 'a2', start: 100, end: 140, side: 'right', transitionM: 0 },
      { id: 'a3', start: 160, end: 280, side: 'left', transitionM: 10 },
    ])
    alignment.engineering!.assignments[2].templateId = 'steep'
    // The station at 150 is the base section: the range goes back to the base.
    const plan = planned(planSectionRange(alignment, 150, [60, 200], 300, options))
    expect(plan.source.kind).toBe('base')
    expect(plan.affected.map((a) => [a.number, a.outcome, a.templateName])).toEqual([
      [1, 'trimmed', 'Wide'],
      [2, 'replaced', 'Wide'],
      [3, 'trimmed', 'Steep'],
    ])
    expect(plan.affected[2].transitionNote).toMatch(/10 m transition now blends back/)
    expect(plan.engineering.assignments.map((a) => [a.id, a.start, a.end])).toEqual([
      ['a1', 0, 60],
      ['a3', 200, 280],
    ])
  })

  it('splits a range that spans the new one, keeping both ends', () => {
    const alignment = road([{ id: 'a1', start: 0, end: 300, side: 'both', transitionM: 0 }], 'steep')
    alignment.engineering!.assignments.push({
      id: 'a2',
      start: 0,
      end: 1,
      templateId: 'wide',
      side: 'both',
      transitionM: 0,
    })
    alignment.engineering!.assignments[0].start = 1
    const plan = planned(planSectionRange(alignment, 0.5, [100, 150], 300, options))
    expect(plan.source).toMatchObject({ kind: 'named', templateId: 'wide' })
    expect(plan.affected.map((a) => a.outcome)).toEqual(['split'])
    expect(plan.engineering.assignments.map((a) => [a.start, a.end, a.templateId])).toEqual([
      [0, 1, 'wide'],
      [1, 100, 'steep'],
      [100, 150, 'wide'],
      [150, 300, 'steep'],
    ])
  })

  it('joins a touching plain range of the same template instead of adding a second', () => {
    const alignment = road([{ id: 'a1', start: 0, end: 100, side: 'both', transitionM: 0 }])
    const plan = planned(planSectionRange(alignment, 50, [100, 180], 300, options))
    expect(plan.engineering.assignments).toEqual([
      { id: 'a1', start: 0, end: 180, templateId: 'wide', side: 'both', transitionM: 0 },
    ])
  })

  it('reports no change when the range already holds the section', () => {
    const alignment = road([{ id: 'a1', start: 0, end: 200, side: 'both', transitionM: 0 }])
    const plan = planned(planSectionRange(alignment, 50, [20, 120], 300, options))
    expect(plan.changed).toBe(false)
  })

  it('adds the saved section to the library when it mixes templates', () => {
    const alignment = road([{ id: 'a1', start: 0, end: 100, side: 'left', transitionM: 0 }])
    const plan = planned(planSectionRange(alignment, 50, [150, 250], 300, options))
    const saved = plan.engineering.templates.find((t) => t.name === 'Section at 50 m')!
    expect(saved.template).toEqual(templateAt(alignment, 50).template)
    expect(plan.engineering.assignments.at(-1)).toMatchObject({ start: 150, end: 250, templateId: saved.id })
  })

  it('refuses a range off the road, too short, or past the library limits', () => {
    const alignment = road()
    expect(planSectionRange(alignment, 50, [250, 320], 300, options)).toEqual({
      error: 'Choose a range on the road, between 0 m and 300 m.',
    })
    expect(planSectionRange(alignment, 50, [100, 100.5], 300, options)).toEqual({
      error: 'Choose a range at least 1 m long.',
    })
    expect(planSectionRange(alignment, 50, [Number.NaN, 100], 300, options)).toEqual({
      error: 'Enter a from and a to station.',
    })
    const full = road([{ id: 'a1', start: 0, end: 10, side: 'left', transitionM: 0 }])
    for (let i = 0; i < 48; i++)
      full.engineering!.templates.push({ id: `t${i}`, name: `T${i}`, template: { ...DEFAULT_TEMPLATE } })
    expect(planSectionRange(full, 5, [100, 200], 300, options)).toMatchObject({
      error: expect.stringMatching(/already holds 50/),
    })
  })

  it('takes the range either way round', () => {
    const plan = planned(planSectionRange(road(), 50, [180, 120], 300, options))
    expect([plan.from, plan.to]).toEqual([120, 180])
  })
})

describe('stations where the batter never met the ground', () => {
  // Flat ground under a formation that climbs 15 m above it: a high fill whose batter runs past a
  // 10 m section reach in the middle of the road.
  const flat: TerrainSource = { elevationAt: () => 800 }
  const settings = { ...DEFAULT_ROAD_SETTINGS, crossSectionHalfWidth: 10 }

  it('lists each side of each station in the range, as fill past the reach', () => {
    const analysis = analyzeRoad(road(), flat, settings)
    const misses = batterMisses(analysis.stations, 100, 200)
    expect(misses.length).toBeGreaterThan(0)
    expect(misses.every((m) => m.chainage >= 100 && m.chainage <= 200)).toBe(true)
    expect(new Set(misses.map((m) => m.batter))).toEqual(new Set(['fill']))
    expect(new Set(misses.map((m) => m.cause))).toEqual(new Set(['reach']))
    expect(misses.filter((m) => m.chainage === 150).map((m) => m.side)).toEqual(['left', 'right'])
    // Near the ends the fill is low and the batter closes.
    expect(batterMisses(analysis.stations, 0, 10)).toEqual([])
  })

  it('calls a batter cut where the ground stands above its last point, unknown with no ground', () => {
    const stations = [
      {
        chainage: 5,
        flags: ['Right daylight unresolved: extend section or check terrain'],
        section: [
          { offset: 0, ground: 10, design: 5 },
          { offset: 6, ground: 12, design: 7 },
          { offset: 9, ground: null, design: null },
        ],
      },
      {
        chainage: 6,
        flags: ['Left daylight unresolved: extend section or check terrain'],
        section: [
          { offset: -6, ground: null, design: 7 },
          { offset: 0, ground: 10, design: 5 },
        ],
      },
    ]
    expect(batterMisses(stations, 0, 10)).toEqual([
      { chainage: 5, side: 'right', batter: 'cut', cause: 'terrain' },
      { chainage: 6, side: 'left', batter: 'unknown', cause: 'terrain' },
    ])
  })
})
