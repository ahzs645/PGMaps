import { describe, expect, it } from 'vitest'
import { analyze } from '../forest-patches/analysis'
import { exampleProject } from '../forest-patches/project'
import { addBlock, addSchedule, followWouldLoop, removeBlock, removeSchedule, setEntry } from './edits'
import { openPlanFile } from './migrate'
import { entryOf, footprintName, parsePlan, samplePlan, scheduleHarvests, type Plan } from './plan'
import { analyzePlan, landscapeReady } from './planAnalysis'

const square: Plan['blocks'][number]['shapes'][number]['geometry'] = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.7, 53.9],
      [-122.69, 53.9],
      [-122.69, 53.905],
      [-122.7, 53.905],
      [-122.7, 53.9],
    ],
  ],
}

describe('plan v2', () => {
  it('reads its own sample and resolves a followed schedule by its offset', () => {
    const plan = parsePlan(JSON.parse(JSON.stringify(samplePlan())))
    expect(entryOf(plan, 'proposed', 'block-1')).toEqual({ year: 2026 })
    expect(entryOf(plan, 'deferred', 'block-1')).toEqual({ year: 2036 })
    expect(entryOf(plan, 'none', 'block-1')).toEqual({ year: null })
    expect(scheduleHarvests(plan, 'none')).toEqual([])
  })

  it('refuses a schedule that follows itself, and names a missing block', () => {
    const plan = samplePlan()
    const loop = {
      ...plan,
      schedules: [
        { id: 'a', name: 'A', follows: { schedule: 'b', years: 1 }, entries: {} },
        { id: 'b', name: 'B', follows: { schedule: 'a', years: 1 }, entries: {} },
      ],
      reviewSchedule: 'a',
    }
    expect(() => parsePlan(loop)).toThrow(/follows itself/)
    const stray = {
      ...plan,
      schedules: [{ id: 'p', name: 'P', entries: { nowhere: { year: 2030 } } }],
      reviewSchedule: 'p',
    }
    expect(() => parsePlan(stray)).toThrow(/nowhere/)
  })

  it('keeps an entry of its own over the followed schedule, and reads through again when cleared', () => {
    let plan = setEntry(samplePlan(), 'deferred', 'block-1', { year: null })
    expect(entryOf(plan, 'deferred', 'block-1').year).toBeNull()
    plan = setEntry(plan, 'deferred', 'block-1', undefined)
    expect(entryOf(plan, 'deferred', 'block-1').year).toBe(2036)
  })

  it('adds a new block to the schedule under review at the first year only', () => {
    const { plan, id } = addBlock(samplePlan(), 'North', square)
    expect(entryOf(plan, 'proposed', id).year).toBe(2026)
    expect(entryOf(plan, 'deferred', id).year).toBe(2036)
    expect(entryOf(plan, 'none', id).year).toBeNull()
    const gone = removeBlock({ ...plan, reviews: { [id]: { selected: [], date: '2026-11-17', sets: {} } } }, id)
    expect(gone.reviews[id]).toBeUndefined()
    expect(gone.schedules.find((s) => s.id === 'proposed')!.entries[id]).toBeUndefined()
  })

  it('keeps a follower’s figures when the schedule it follows is removed', () => {
    const plan = removeSchedule(samplePlan(), 'proposed')
    const deferred = plan.schedules.find((s) => s.id === 'deferred')!
    expect(deferred.follows).toBeUndefined()
    expect(entryOf(plan, 'deferred', 'block-1').year).toBe(2036)
    expect(plan.reviewSchedule).toBe('none')
  })

  it('copies a schedule as entries of its own, and spots a following loop', () => {
    const { plan, id } = addSchedule(samplePlan(), { kind: 'copy', name: 'Copy', from: 'deferred' })
    expect(plan.schedules.find((s) => s.id === id)!.entries).toEqual({ 'block-1': { year: 2036 } })
    expect(followWouldLoop(plan, 'proposed', 'deferred')).toBe(true)
    expect(followWouldLoop(plan, 'deferred', 'none')).toBe(false)
  })
})

describe('opening earlier files', () => {
  it('turns the PR sample into a baseline, one block and two schedules', () => {
    const { plan, notes } = openPlanFile(JSON.parse(JSON.stringify(exampleProject())))
    expect(plan.baseline.map((d) => [d.name, d.year, d.kind])).toEqual([
      ['Opening A', 2011, 'unspecified'],
      ['Opening B', 2021, 'unspecified'],
    ])
    expect(plan.blocks.map((b) => b.name)).toEqual(['Harvest now'])
    expect(entryOf(plan, 'proposed', plan.blocks[0].id).year).toBe(2026)
    expect(entryOf(plan, 'alternative', plan.blocks[0].id).year).toBe(2036)
    expect(notes.join(' ')).toMatch(/same outline/)
  })

  it('keeps the proposed schedule’s review of a block and drops one of a baseline polygon', () => {
    const project = exampleProject()
    const review = (date: string) => ({ selected: [], date, sets: {} })
    const v1 = {
      format: 'pgmaps-block-plan/v1',
      project,
      reviews: {
        [JSON.stringify(['Harvest now', 'proposed', 2026, 'Prince George', project.ndu])]: review('2026-11-17'),
        [JSON.stringify(['Harvest later', 'alternative', 2036, 'Prince George', project.ndu])]: review('2030-01-01'),
        [JSON.stringify(['Opening A', 'reference', 2026, 'Prince George', project.ndu])]: review('2026-01-01'),
      },
      packs: [],
    }
    const { plan, notes } = openPlanFile(JSON.parse(JSON.stringify(v1)))
    expect(Object.values(plan.reviews).map((r) => r.date)).toEqual(['2026-11-17'])
    expect(notes.join(' ')).toMatch(/1 review\(s\) of a baseline polygon/)
  })

  it('gives the same figures as the engine run on the old file', () => {
    const project = exampleProject()
    const { plan } = openPlanFile(JSON.parse(JSON.stringify(project)))
    const old = analyze(project, 2031, 'proposed')
    const now = analyzePlan(plan, { schedule: 'proposed', year: 2031 })
    for (const scenario of ['proposed', 'alternative'] as const) {
      const before = old.timeline.filter((p) => p.scenario === scenario)
      const after = now.runs.find((r) => r.schedule === scenario)!.periods
      expect(after.map((p) => [p.year, p.totalHa, p.patches, p.classes.map((c) => c.percent)])).toEqual(
        before.map((p) => [p.year, p.totalHa, p.patches, p.classes.map((c) => c.percent)]),
      )
    }
    expect(now.shown.patches.length).toBe(old.patchMap.features.length)
    const contributors = now.shown.patches.flatMap((f) => f.properties!.footprintIds as string[])
    expect(contributors.map((id) => footprintName(plan, id)).sort()).toEqual(['Harvest now', 'Opening A', 'Opening B'])
  })

  it('says what is missing before the landscape can run', () => {
    expect(landscapeReady(samplePlan())).toBeNull()
    expect(landscapeReady({ ...samplePlan(), area: { ...samplePlan().area, ndu: '' } })).toMatch(/sub-unit/)
  })
})
