import { describe, expect, it } from 'vitest'
import { analyzeRoad } from './engine'
import { horizonReplacements, MAX_HORIZON_DEPTH_M, nextHorizon, resolveHorizons } from './groundHorizons'
import { createEngineeringDesign, type StratumAssignment } from './engineeringTypes'
import { parseProject, serializeProject } from './project'
import { createDemoProject, demoTerrain } from './terrain'

const horizon = (
  id: string,
  topDepthM: number,
  bottomDepthM: number | null,
  start = 0,
  end = 100,
): StratumAssignment => ({
  id,
  materialId: id,
  start,
  end,
  topDepthM,
  bottomDepthM,
})
const column = (strata: StratumAssignment[]) =>
  resolveHorizons(strata).map((p) => [p.stratumId, p.topDepthM, p.bottomDepthM])

describe('ground horizons resolved to one column', () => {
  it('keeps horizons that only touch as entered, sorted top down', () => {
    expect(column([horizon('rock', 3, null), horizon('pan', 0, 3)])).toEqual([
      ['pan', 0, 3],
      ['rock', 3, null],
    ])
  })
  it('gives the later horizon the overlap and keeps the rest of the earlier one', () => {
    // Later covers the top of the earlier one, then the bottom, then its whole depth.
    expect(column([horizon('pan', 0, 3), horizon('gravel', 0, 1)])).toEqual([
      ['gravel', 0, 1],
      ['pan', 1, 3],
    ])
    expect(column([horizon('pan', 0, 3), horizon('gravel', 2, 5)])).toEqual([
      ['pan', 0, 2],
      ['gravel', 2, 5],
    ])
    expect(column([horizon('pan', 1, 2), horizon('gravel', 0, 3)])).toEqual([['gravel', 0, 3]])
  })
  it('splits an earlier horizon around a later lens and gives the two parts distinct ids', () => {
    const pieces = resolveHorizons([horizon('rock', 3, null), horizon('gravel', 4, 5)])
    expect(pieces.map((p) => [p.stratumId, p.topDepthM, p.bottomDepthM])).toEqual([
      ['rock', 3, 4],
      ['gravel', 4, 5],
      ['rock', 5, null],
    ])
    expect(pieces.map((p) => p.id)).toEqual(['rock', 'gravel', 'rock~2'])
  })
  it('lets an open-ended later horizon take everything below its top', () => {
    expect(column([horizon('pan', 0, 3), horizon('rock', 5, 8), horizon('deep', 2, null)])).toEqual([
      ['pan', 0, 2],
      ['deep', 2, null],
    ])
  })
  it('never returns overlapping depth intervals, whatever the order', () => {
    const strata = [horizon('a', 0, 4), horizon('b', 1, 2), horizon('c', 1.5, 6), horizon('d', 0.5, 1.75)]
    const pieces = resolveHorizons(strata)
    for (let i = 1; i < pieces.length; i++)
      expect(pieces[i].topDepthM).toBeGreaterThanOrEqual(pieces[i - 1].bottomDepthM ?? Infinity)
    expect(pieces[0].topDepthM).toBe(0)
    expect(pieces.at(-1)!.bottomDepthM).toBe(6)
  })
  it('names the earlier horizons a later one replaces, by station and depth', () => {
    const replaced = horizonReplacements([
      horizon('pan', 0, 3, 0, 930),
      horizon('rock', 3, null, 0, 930),
      horizon('gravel', 0, 3, 0, 215),
      horizon('elsewhere', 0, 3, 930, 1000),
    ])
    expect(replaced.get('gravel')).toEqual(['pan'])
    expect(replaced.has('rock')).toBe(false)
    expect(replaced.has('elsewhere')).toBe(false)
  })
})

describe('the horizon Add material horizon makes', () => {
  const added = (strata: StratumAssignment[]) => {
    const next = nextHorizon(strata, 930.3, 'till', 'new')
    return [next.topDepthM, next.bottomDepthM, next.start, next.end]
  }
  it('is the next metre down, over the whole road', () => {
    expect(added([])).toEqual([0, 1, 0, 930.3])
    expect(added([horizon('a', 0, 1), horizon('b', 1, 2.5)])).toEqual([2.5, 3.5, 0, 930.3])
  })
  it('goes a metre into an open-ended horizon, and stays inside the depth limit', () => {
    expect(added([horizon('a', 0, 1), horizon('b', 1, 2), horizon('rock', 2, null)])).toEqual([3, 4, 0, 930.3])
    expect(added([horizon('deep', 0, MAX_HORIZON_DEPTH_M)])).toEqual([
      MAX_HORIZON_DEPTH_M - 1,
      MAX_HORIZON_DEPTH_M,
      0,
      930.3,
    ])
    expect(nextHorizon([], 0, 'till', 'new').end).toBe(1)
  })

  it('calculates and saves in every case, and the note names what it replaces', () => {
    const project = createDemoProject()
    const road = project.alignments[0]
    const length = analyzeRoad(road, demoTerrain, project.settings).length
    road.engineering = createEngineeringDesign()
    road.engineering.materials = [
      { id: 'till', name: 'Till', color: '#9a663e', cutRate: 4, reusableFraction: 1, compactionFactor: 0.9 },
    ]
    const add = () => {
      const next = nextHorizon(road.engineering!.strata, length, 'till', `h${road.engineering!.strata.length + 1}`)
      road.engineering!.strata = [...road.engineering!.strata, next]
      return next
    }
    add()
    add()
    add()
    // The third horizon runs down without limit, as "Extends below all finite horizons" makes it.
    road.engineering.strata[2] = { ...road.engineering.strata[2], bottomDepthM: null }
    const fourth = add()
    expect(horizonReplacements(road.engineering.strata).get(fourth.id)).toEqual(['h3'])
    // The project file, and so the autosave, takes it; it used to refuse any overlap.
    const saved = parseProject(serializeProject(project))
    expect(saved.alignments[0].engineering!.strata).toHaveLength(4)
    const analysis = analyzeRoad(saved.alignments[0], demoTerrain, saved.settings)
    expect(analysis.invalidInput).toBeUndefined()
    expect(analysis.stations.length).toBeGreaterThan(0)
    // The documented case: a whole-road layer, then a local one over part of it.
    road.engineering.strata = [horizon('h1', 0, 3, 0, length), horizon('h2', 0, 1, 0, 215)].map((h) => ({
      ...h,
      materialId: 'till',
    }))
    expect(() => parseProject(serializeProject(project))).not.toThrow()
  })
})
