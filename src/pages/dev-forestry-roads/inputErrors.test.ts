import { describe, expect, it } from 'vitest'
import { EngineeringInputError, freeStationRange, inputMessage } from './inputErrors'
import { createEngineeringDesign, type AlignmentEngineering } from './engineeringTypes'
import { ditchWidthRange, validateEngineering, validateTemplate } from './templates'
import type { RoadTemplate } from './types'

const template: RoadTemplate = {
  leftWidth: 3,
  rightWidth: 3,
  crossfallPercent: 3,
  cutSlope: 0.75,
  fillSlope: 1.5,
  ditchWidth: 1,
  ditchDepth: 0.5,
  surfaceDepth: 0.25,
}
function failure(change: (e: AlignmentEngineering) => void): EngineeringInputError {
  const e = createEngineeringDesign()
  e.materials = [
    { id: 'pan', name: 'Hard pan', color: '#777777', cutRate: 6, reusableFraction: 1, compactionFactor: 0.95 },
    {
      id: 'strip',
      name: 'Topsoil',
      color: '#553311',
      cutRate: 0,
      reusableFraction: 0,
      compactionFactor: 1,
      purpose: 'stripping',
    },
  ]
  change(e)
  try {
    validateEngineering(e)
  } catch (cause) {
    if (cause instanceof EngineeringInputError) return cause
    throw cause
  }
  throw Error('Expected the inputs to be rejected.')
}
const strip = {
  depthM: 0.2,
  leftInsideM: 0,
  rightInsideM: 0,
  leftOutsideM: 0.3,
  rightOutsideM: 0.3,
  materialId: 'strip',
}

describe('engineering input failures name their entry, field and range', () => {
  it('points a stripping range with its start past its end at that range', () => {
    const error = failure((e) => {
      e.sitePreparation = [{ id: 's1', start: 2000, end: 930.3, ...strip }]
    })
    expect(error.target).toEqual({ list: 'sitePreparation', id: 's1', field: 'end' })
    expect(error.message).toBe(
      'Stripping 1: the end station (930.3 m) must be greater than the start station (2,000 m).',
    )
  })
  it('says which stripping ranges overlap and where', () => {
    const error = failure((e) => {
      e.sitePreparation = [
        { id: 's1', start: 0, end: 500, ...strip },
        { id: 's2', start: 400, end: 930, ...strip },
      ]
    })
    expect(error.target).toEqual({ list: 'sitePreparation', id: 's2' })
    expect(error.message).toMatch(/Stripping 2 and stripping 1 overlap between 400 and 500 m/)
  })
  it('accepts overlapping ground horizons, which the later one resolves, but not reversed depths', () => {
    const horizon = { materialId: 'pan', start: 0, end: 930 }
    expect(() =>
      validateEngineering({
        ...createEngineeringDesign(),
        materials: failureMaterials(),
        strata: [
          { id: 'h1', ...horizon, topDepthM: 0, bottomDepthM: 3 },
          { id: 'h2', ...horizon, topDepthM: 3, bottomDepthM: null },
          { id: 'h3', ...horizon, topDepthM: 4, bottomDepthM: 5 },
        ],
      }),
    ).not.toThrow()
    const error = failure((e) => {
      e.strata = [{ id: 'h1', ...horizon, topDepthM: 3, bottomDepthM: 1 }]
    })
    expect(error.target).toEqual({ list: 'strata', id: 'h1', field: 'bottomDepthM' })
    expect(error.message).toBe('Horizon 1: the bottom depth (1 m) must be greater than the top depth (3 m).')
  })
  it('names the field and the allowed range of a value outside its limits', () => {
    const error = failure((e) => {
      e.materials[0].compactionFactor = 0
    })
    expect(error.target).toEqual({ list: 'materials', id: 'pan', field: 'compactionFactor' })
    expect(error.message).toBe('Hard pan: compacted / bank factor must be 0.1 to 2.')
    const haul = failure((e) => {
      e.haul.freeHaulDistanceM = 200
    })
    expect(haul.target).toEqual({ list: 'haul', field: 'overhaulDistanceM' })
    expect(haul.message).toMatch(/overhaul distance limit \(150 m\) must be at least the free-haul distance \(200 m\)/)
  })
  it('attributes a template failure to the base section or to the named template that holds it', () => {
    const bad = { ...template, leftDitchBottomWidth: 2 }
    expect(() => validateTemplate(bad)).toThrow(
      'Road section: the left ditch bottom width (2 m) must be 0 to the ditch top width (1 m).',
    )
    const error = failure((e) => {
      e.templates = [{ id: 't1', name: 'Landing', template: bad }]
    })
    expect(error.target).toEqual({ list: 'templates', id: 't1', field: 'leftDitchBottomWidth' })
    expect(error.message).toMatch(/^Landing: /)
  })
  it('matches a message to exactly one entry and field', () => {
    const problem = { message: 'm', target: { list: 'strata' as const, id: 'h1', field: 'end' } }
    expect(inputMessage(problem, 'strata', 'h1', 'end')).toBe('m')
    expect(inputMessage(problem, 'strata', 'h1', 'start')).toBeUndefined()
    expect(inputMessage(problem, 'strata', 'h2', 'end')).toBeUndefined()
    expect(inputMessage(problem, 'sitePreparation', 'h1', 'end')).toBeUndefined()
    expect(inputMessage(undefined, 'strata', 'h1', 'end')).toBeUndefined()
  })
})

function failureMaterials() {
  return [{ id: 'pan', name: 'Hard pan', color: '#777777', cutRate: 6, reusableFraction: 1, compactionFactor: 0.95 }]
}

describe('the default range of an Add button', () => {
  it('takes the whole road when nothing is entered yet, from the preferred start', () => {
    expect(freeStationRange([], 930.3)).toEqual({ start: 0, end: 930.3 })
    expect(freeStationRange([], 930.3, 60)).toEqual({ start: 60, end: 930.3 })
    expect(freeStationRange([], 930.3, 60, 100)).toEqual({ start: 60, end: 160 })
  })
  it('never overlaps an existing range', () => {
    const taken = [
      { start: 0, end: 200 },
      { start: 500, end: 600 },
    ]
    expect(freeStationRange(taken, 930)).toEqual({ start: 200, end: 500 })
    expect(freeStationRange(taken, 930, 250)).toEqual({ start: 250, end: 500 })
    expect(freeStationRange(taken, 930, 550)).toEqual({ start: 600, end: 930 })
    // Nothing free after the preferred start: fall back to the first gap on the road.
    expect(freeStationRange([{ start: 300, end: 930 }], 930, 400)).toEqual({ start: 0, end: 300 })
  })
  it('reports a fully covered road rather than inventing a range', () => {
    expect(freeStationRange([{ start: 0, end: 930 }], 930)).toBeNull()
    expect(
      freeStationRange(
        [
          { start: 0, end: 400 },
          { start: 350, end: 2000 },
        ],
        930,
      ),
    ).toBeNull()
    expect(freeStationRange([], 0)).toBeNull()
  })
})

describe('ditch width fields', () => {
  it('limit each other so a bottom is never typed wider than its top', () => {
    // A 1 m ditch on both sides; the left has a 0.5 m flat bottom.
    const t: RoadTemplate = { ...template, leftDitchBottomWidth: 0.5 }
    expect(ditchWidthRange(t, 'leftDitchBottomWidth')).toEqual({ min: 0, max: 1 })
    expect(ditchWidthRange(t, 'leftDitchWidth')).toEqual({ min: 0.5, max: 10 })
    expect(ditchWidthRange(t, 'rightDitchWidth')).toEqual({ min: 0, max: 10 })
    // The base width is held by the side that inherits it and has the wider bottom.
    expect(ditchWidthRange(t, 'ditchWidth')).toEqual({ min: 0.5, max: 10 })
    // A side with its own top width no longer limits the base.
    expect(ditchWidthRange({ ...t, leftDitchWidth: 2 }, 'ditchWidth')).toEqual({ min: 0, max: 10 })
    expect(ditchWidthRange({ ...t, leftDitchWidth: 2 }, 'leftDitchBottomWidth')).toEqual({ min: 0, max: 2 })
    // The base bottom is held by the narrowest top among the sides that inherit it.
    expect(ditchWidthRange({ ...template, rightDitchWidth: 0.4 }, 'ditchBottomWidth')).toEqual({ min: 0, max: 0.4 })
    expect(ditchWidthRange(t, 'cutSlope')).toBeNull()
  })

  it('agree with the engine: a value at either limit validates and one past it does not', () => {
    const t: RoadTemplate = { ...template, leftDitchBottomWidth: 0.5 }
    const top = ditchWidthRange(t, 'ditchWidth')!
    expect(() => validateTemplate({ ...t, ditchWidth: top.min })).not.toThrow()
    expect(() => validateTemplate({ ...t, ditchWidth: top.min - 0.1 })).toThrow(/left ditch bottom width/)
    const bottom = ditchWidthRange(t, 'leftDitchBottomWidth')!
    expect(() => validateTemplate({ ...t, leftDitchBottomWidth: bottom.max })).not.toThrow()
    expect(() => validateTemplate({ ...t, leftDitchBottomWidth: bottom.max + 0.1 })).toThrow(/left ditch bottom width/)
  })
})
