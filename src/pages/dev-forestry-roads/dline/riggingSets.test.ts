import { describe, expect, it } from 'vitest'
import { DEFAULT_CABLE_RULE } from '../cableCoverageRule'
import { EXAMPLE_RIGGING } from '../cableMechanics'
import { DEFAULT_SUPPORT_LAYOUT } from '../cableLayout/settings'
import { parseProject } from '../project'
import { createDemoProject } from '../terrain'
import type { CableLine } from '../types'
import {
  applyRiggingSetToLine,
  applyRiggingSetToRule,
  applyRiggingSetWithUndo,
  deleteRiggingSet,
  lineLimits,
  matchingRiggingSet,
  MAX_RIGGING_SETS,
  parseRiggingSets,
  renameRiggingSet,
  riggingSetNameError,
  saveRiggingSet,
  undoRiggingSet,
} from './riggingSets'

let next = 0
const id = () => `set-${++next}`
const heavy = { ...EXAMPLE_RIGGING, ropeDiameterMm: 25, ropeMassKgPerM: 2.9, payloadKg: 4000 }
const limits = { liftOffDeg: 2, holdDownDeg: 4, maxLoadedDeg: 25, maxLoadedEndDeg: 50 }

describe('named rigging sets', () => {
  it('saves a set, updates it when saved again under its name, renames and deletes it', () => {
    const one = saveRiggingSet([], '  Madill 071  ', EXAMPLE_RIGGING, undefined, id)
    expect(one).toEqual([{ id: expect.any(String), name: 'Madill 071', rigging: EXAMPLE_RIGGING }])
    const updated = saveRiggingSet(one, 'madill 071', heavy, limits, id)
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ id: one[0].id, name: 'madill 071', rigging: heavy, limits })
    const two = saveRiggingSet(updated, 'Thunderbird', EXAMPLE_RIGGING, undefined, id)
    expect(riggingSetNameError(two, 'THUNDERBIRD', two[0].id)).toBe('Another set has that name.')
    expect(riggingSetNameError(two, 'Thunderbird', two[1].id)).toBeNull()
    expect(() => renameRiggingSet(two, two[0].id, 'Thunderbird')).toThrow('Another set has that name.')
    expect(renameRiggingSet(two, two[0].id, 'Madill')[0].name).toBe('Madill')
    expect(deleteRiggingSet(two, two[0].id).map((s) => s.name)).toEqual(['Thunderbird'])
    expect(() => saveRiggingSet([], ' ', EXAMPLE_RIGGING, undefined, id)).toThrow('Name the set.')
    expect(() => saveRiggingSet([], 'Bad', { ...EXAMPLE_RIGGING, safetyFactor: 0 }, undefined, id)).toThrow()
  })

  it('applies a set to a D-line and to the yarder, which always tensions to the allowable', () => {
    const [set] = saveRiggingSet([], 'Heavy', { ...heavy, tensionMode: 'base' }, limits, id)
    const line: CableLine = {
      id: 'd',
      name: 'D',
      start: [-122, 54],
      end: [-121.99, 54],
      startHeight: 12,
      endHeight: 8,
      deflectionPercent: 5,
    }
    const applied = applyRiggingSetToLine(line, set)
    expect(applied.sagModel).toBe('mechanics')
    expect(applied.rigging).toEqual(set.rigging)
    expect(applied.supportLayout).toEqual({ ...DEFAULT_SUPPORT_LAYOUT, ...limits })
    expect(lineLimits(applied)).toEqual(limits)
    expect(matchingRiggingSet([set], applied.rigging)).toBe(set)
    expect(matchingRiggingSet([set], { ...applied.rigging!, payloadKg: 1 })).toBeNull()
    const rule = applyRiggingSetToRule(DEFAULT_CABLE_RULE, set)
    expect(rule.rigging.tensionMode).toBe('allowable')
    expect(rule.maxBreakDeg).toBe(25)
    expect(matchingRiggingSet([set], rule.rigging)).toBeNull()
    expect(matchingRiggingSet([set], rule.rigging, { ignoreTensionMode: true })).toBe(set)
    // A limit outside the coverage range leaves the rule's own.
    const wide = applyRiggingSetToRule(DEFAULT_CABLE_RULE, { ...set, limits: { ...limits, maxLoadedDeg: 80 } })
    expect(wide.maxBreakDeg).toBe(DEFAULT_CABLE_RULE.maxBreakDeg)
  })

  it('puts the yarder back as it was before a set was applied, until it is changed again', () => {
    const [set] = saveRiggingSet([], 'Heavy', heavy, limits, id)
    const before = { ...DEFAULT_CABLE_RULE, lateralM: 30 }
    const { rule, undo } = applyRiggingSetWithUndo(before, set)
    expect(rule).toEqual(applyRiggingSetToRule(before, set))
    expect(undo.setName).toBe('Heavy')
    expect(undoRiggingSet(rule, undo)).toEqual(before)
    // Another setting changed since stays as it is now.
    expect(undoRiggingSet({ ...rule, lateralM: 40 }, undo)).toEqual({ ...before, lateralM: 40 })
    // A rope or load changed since: restoring would undo that too, so it is no longer offered.
    expect(undoRiggingSet({ ...rule, rigging: { ...rule.rigging, payloadKg: 1 } }, undo)).toBeNull()
    expect(undoRiggingSet({ ...rule, maxBreakDeg: rule.maxBreakDeg + 1 }, undo)).toBeNull()
  })

  it('keeps sets in the project file, and old files without them still load', () => {
    const project = createDemoProject()
    expect(parseProject(JSON.parse(JSON.stringify(project)))).not.toHaveProperty('riggingSets')
    const sets = saveRiggingSet([], 'Heavy', heavy, limits, id)
    expect(parseProject(JSON.parse(JSON.stringify({ ...project, riggingSets: sets }))).riggingSets).toEqual(sets)
    expect(() => parseRiggingSets([...sets, { ...sets[0], id: 'other' }])).toThrow(/Another set has that name/)
    expect(() => parseRiggingSets([{ ...sets[0], limits: { ...limits, maxLoadedDeg: 95 } }])).toThrow(/maxLoadedDeg/)
    expect(() => parseRiggingSets(Array.from({ length: MAX_RIGGING_SETS + 1 }, () => sets[0]))).toThrow(/at most/)
  })
})
