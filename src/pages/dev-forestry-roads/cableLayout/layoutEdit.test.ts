// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { EXAMPLE_RIGGING } from '../cableMechanics'
import { runToCompletion } from '../cooperative'
import { offsetCoordinate } from '../engine'
import { parseProject } from '../project'
import { createDemoProject } from '../terrain'
import type { CableLine, Coordinate, TerrainSource } from '../types'
import {
  instantiateCableLayout,
  intermediateSupports,
  layoutSteps,
  type CableLayoutEngine,
  type CableLayoutResult,
} from './cableLayout'
import { cableLayoutCsv } from './exports'
import { compareLayouts, focusMarks } from './layoutCompare'
import {
  EDIT_PRE_TENSION_KN,
  MAX_EDITED_SUPPORTS,
  MAX_SUPPORT_NAME_LENGTH,
  addSupportAfter,
  addSupportAt,
  addSupportInLongestSpan,
  defaultPreTension,
  editCheckKey,
  editFromFound,
  editedLayoutErrors,
  editedLayoutToAnalyse,
  emptyEdit,
  groundAtStation,
  matchesFound,
  moveSupport,
  nameSupport,
  parseEditedLayout,
  placementIssues,
  removeSupport,
  sectorFromDrag,
  setEndHeight,
  stationBounds,
  stationFromChart,
  type EditedLayout,
} from './layoutEdit'
import { layoutOverlay } from './overlay'
import { DEFAULT_SUPPORT_LAYOUT, layoutRun, parseSupportLayout, type LayoutRun } from './settings'

const yarder: Coordinate = [-122.75, 53.9]
const far = offsetCoordinate(yarder, 90, 300)
/** 30 % downhill from the yarder with a 10 m knoll at 150 m; unknown past 310 m. */
const terrain: TerrainSource = {
  elevationAt(lng: number) {
    const x = ((lng - yarder[0]) / (far[0] - yarder[0])) * 300
    return x > 310 ? NaN : 1000 - 0.3 * x + 10 * Math.exp(-(((x - 150) / 45) ** 2))
  },
}
const line: CableLine = {
  id: 'd1',
  name: 'Knoll',
  start: yarder,
  end: far,
  startHeight: 12,
  endHeight: 10,
  deflectionPercent: 5,
  sagModel: 'mechanics',
  rigging: EXAMPLE_RIGGING,
  supportLayout: DEFAULT_SUPPORT_LAYOUT,
}
const settings = DEFAULT_SUPPORT_LAYOUT

const edit = (supports: [number, number][], patch: Partial<EditedLayout> = {}): EditedLayout => ({
  origin: 'hand',
  preTensionKN: 90,
  start: { heightM: 12 },
  end: { heightM: 10 },
  supports: supports.map(([stationM, heightM]) => ({ stationM, heightM })),
  ...patch,
})

function prepare(l: CableLine = line): LayoutRun {
  const prepared = layoutRun(l, terrain, l.supportLayout ?? settings)
  if (!prepared.ok) throw Error(prepared.error)
  return prepared.run
}

describe('edited layout in a project file', () => {
  const valid = {
    origin: 'found',
    preTensionKN: 95,
    start: { heightM: 12, name: 'Tower' },
    end: { heightM: 8, category: 'tree' },
    supports: [
      { stationM: 120, heightM: 14, name: 'Fir 70 cm', category: 'tree' },
      { stationM: 250, heightM: 10, category: 'mast' },
    ],
  }

  it('round-trips through a project file, and files without one still load', () => {
    expect(parseEditedLayout(valid)).toEqual(valid)
    const project = createDemoProject()
    const cable = {
      ...project.cables[0],
      sagModel: 'mechanics' as const,
      rigging: EXAMPLE_RIGGING,
      supportLayout: parseSupportLayout({ edited: valid }),
    }
    const reloaded = parseProject(JSON.parse(JSON.stringify({ ...project, cables: [cable] })))
    expect(reloaded.cables[0].supportLayout?.edited).toEqual(valid)
    expect(parseSupportLayout({}).edited).toBeUndefined()
  })

  it('refuses values outside its limits', () => {
    const bad = (patch: Record<string, unknown>) => () => parseEditedLayout({ ...valid, ...patch })
    expect(bad({ origin: 'guess' })).toThrow(/began/)
    expect(bad({ preTensionKN: 0 })).toThrow(/pre-tension/)
    expect(bad({ preTensionKN: EDIT_PRE_TENSION_KN[1] + 1 })).toThrow(/pre-tension/)
    expect(bad({ start: { heightM: 51 } })).toThrow(/start support height/)
    expect(bad({ supports: [{ stationM: 100, heightM: 0.5 }] })).toThrow(/edited support height/)
    expect(bad({ supports: [{ stationM: 0, heightM: 10 }] })).toThrow(/station inside the line/)
    expect(
      bad({
        supports: [
          { stationM: 200, heightM: 10 },
          { stationM: 100, heightM: 10 },
        ],
      }),
    ).toThrow(/forwards/)
    expect(bad({ supports: [{ stationM: 100, heightM: 10, category: 'crane' }] })).toThrow(/category/)
    expect(bad({ supports: [{ stationM: 100, heightM: 10, name: 'x'.repeat(MAX_SUPPORT_NAME_LENGTH + 1) }] })).toThrow(
      /name/,
    )
    const many = Array.from({ length: MAX_EDITED_SUPPORTS + 1 }, (_, i) => ({ stationM: 10 + i * 2, heightM: 10 }))
    expect(bad({ supports: many })).toThrow(/at most 50/)
    expect(() => parseSupportLayout({ edited: { ...valid, preTensionKN: -1 } })).toThrow(/pre-tension/)
  })
})

describe('editing operations', () => {
  it('starts from the found layout, keeping a line that stopped short and adding the end', () => {
    const complete = editFromFound(
      {
        preTensionKN: 90,
        complete: true,
        supports: [
          { stationM: 0, heightM: 12 },
          { stationM: 170, heightM: 14 },
          { stationM: 400, heightM: 0 },
        ],
      },
      settings,
      400,
    )
    expect(complete).toEqual({
      origin: 'found',
      preTensionKN: 90,
      start: { heightM: 12 },
      end: { heightM: 0 },
      supports: [{ stationM: 170, heightM: 14 }],
    })
    const short = editFromFound(
      {
        preTensionKN: 100,
        complete: false,
        supports: [
          { stationM: 0, heightM: 12 },
          { stationM: 40, heightM: 10 },
        ],
      },
      settings,
      400,
    )
    expect(short.supports).toEqual([{ stationM: 40, heightM: 10 }])
    expect(short.end.heightM).toBe(settings.minSupportHeightM)
    expect(emptyEdit(settings, 80.4)).toMatchObject({ origin: 'hand', preTensionKN: 80, supports: [] })
  })

  it('keeps a moved support between its neighbours and its height in range', () => {
    const e = edit([
      [100, 10],
      [200, 12],
    ])
    expect(stationBounds(e, 0, 400)).toEqual([1, 199])
    expect(moveSupport(e, 0, { stationM: 350 }, 400).supports[0].stationM).toBe(199)
    expect(moveSupport(e, 1, { stationM: -5 }, 400).supports[1].stationM).toBe(101)
    expect(moveSupport(e, 1, { stationM: 500 }, 400).supports[1].stationM).toBe(399)
    expect(moveSupport(e, 0, { stationM: 123.456 }, 400).supports[0].stationM).toBe(123.5)
    expect(moveSupport(e, 0, { heightM: 80 }, 400).supports[0].heightM).toBe(50)
    expect(moveSupport(e, 0, { heightM: 0 }, 400).supports[0].heightM).toBe(1)
    // Nothing moves for an unknown index or an unchanged value.
    expect(moveSupport(e, 5, { stationM: 10 }, 400)).toBe(e)
    expect(moveSupport(e, 0, { stationM: 100 }, 400)).toBe(e)
    expect(setEndHeight(e, 'end', -3).end.heightM).toBe(0)
  })

  it('adds supports between the neighbours and never on top of one', () => {
    const e = edit([
      [100, 10],
      [300, 14],
    ])
    const added = addSupportAt(e, 200, settings, 400)!
    expect(added.index).toBe(1)
    expect(added.edited.supports.map((s) => s.stationM)).toEqual([100, 200, 300])
    expect(added.edited.supports[1].heightM).toBe(12)
    expect(addSupportAt(e, 100.5, settings, 400)).toBeNull()
    expect(addSupportAt(e, 0.5, settings, 400)).toBeNull()
    expect(addSupportAt(e, 399.5, settings, 400)).toBeNull()
    expect(addSupportAfter(e, -1, settings, 400)!.edited.supports[0].stationM).toBe(50)
    expect(addSupportAfter(e, 1, settings, 400)!.edited.supports[2].stationM).toBe(350)
    expect(addSupportInLongestSpan(e, settings, 400)!.edited.supports[1].stationM).toBe(200)
    expect(addSupportInLongestSpan(edit([]), settings, 400)!.edited.supports).toEqual([
      { stationM: 200, heightM: settings.minSupportHeightM },
    ])
    expect(removeSupport(e, 0).supports).toEqual([{ stationM: 300, heightM: 14 }])
  })

  it('names supports without changing what is checked', () => {
    const e = edit([[100, 10]])
    const named = nameSupport(nameSupport(e, 0, { name: 'Spar 3', category: 'tree' }), 'end', { category: 'mast' })
    expect(named.supports[0]).toEqual({ stationM: 100, heightM: 10, name: 'Spar 3', category: 'tree' })
    expect(named.end).toEqual({ heightM: 10, category: 'mast' })
    expect(editCheckKey(named)).toBe(editCheckKey(e))
    expect(nameSupport(named, 0, { name: '  ', category: undefined }).supports[0]).toEqual({
      stationM: 100,
      heightM: 10,
    })
    expect(editCheckKey(moveSupport(e, 0, { heightM: 11 }, 400))).not.toBe(editCheckKey(e))
  })

  it('turns a drag into a sector and flags placements the search would not make', () => {
    expect(sectorFromDrag(230.4, 169.6, 400)).toEqual({ fromM: 170, toM: 230 })
    expect(sectorFromDrag(-20, 1, 400)).toBeNull()
    expect(stationFromChart({ lengthM: 400, yarderAtEnd: true }, 100)).toBe(300)
    const issues = placementIssues(
      edit([
        [100, 10],
        [105, 10],
        [200, 10],
      ]),
      { ...settings, noSupportSectors: [{ fromM: 180, toM: 220 }] },
    )
    expect(issues.map((i) => i.stationM)).toEqual([105, 200])
    expect(issues[0].text).toMatch(/5 m apart, under the 10 m/)
    expect(issues[1].text).toMatch(/no-support sector 180–220 m/)
  })

  it('refuses an edit that does not fit the line, and reads ground where it is known', () => {
    expect(editedLayoutErrors(edit([[450, 10]]), 400)[0]).toMatch(/outside the line/)
    expect(editedLayoutErrors(edit([[100, 10]], { preTensionKN: 0 }), 400)[0]).toMatch(/pre-tension/)
    const run = prepare()
    expect(groundAtStation(run.input.profile, 0)).toBeCloseTo(1000, 3)
    expect(groundAtStation(run.input.profile, 100.5)).toBeCloseTo(
      terrain.elevationAt(...offsetCoordinate(yarder, 90, 100.5)),
      1,
    )
    expect(groundAtStation(run.input.profile, 900)).toBeNaN()
    const layout = editedLayoutToAnalyse(run, edit([[200, 14]], { start: { heightM: 3 }, end: { heightM: 9 } }))
    if (!layout.ok) throw Error(layout.error)
    // A yarder start takes the D-line's yarder height, a support end the edited height.
    expect(layout.layout.supports).toEqual([
      { stationM: 0, heightM: 12 },
      { stationM: 200, heightM: 14 },
      { stationM: run.lengthM, heightM: 9 },
    ])
    const anchorEnd = editedLayoutToAnalyse({ ...run, input: { ...run.input, endKind: 'anchor' } }, edit([]))
    expect(anchorEnd.ok && anchorEnd.layout.supports.at(-1)!.heightM).toBe(0)
    expect(defaultPreTension(run)).toBe(Math.round((run.input.tensionLowKN + run.input.tensionHighKN) / 2))
  })
})

describe('adjusting a found layout through the committed WebAssembly', () => {
  let engine: CableLayoutEngine
  beforeAll(async () => {
    engine = await instantiateCableLayout(readFileSync(new URL('./cable_layout.wasm', import.meta.url)))
  })

  it('re-checks the found layout unchanged, then shows what a moved support changes', () => {
    const run = prepare()
    const found: CableLayoutResult = runToCompletion(layoutSteps(engine, run.input, 500))
    expect(found.status).toBe('complete')
    const saved = {
      preTensionKN: found.preTensionKN!,
      complete: true,
      supports: found.supports
        .filter((s) => s.kind !== 'anchor')
        .map((s) => ({ stationM: s.stationM, heightM: s.heightM })),
    }
    const edited = editFromFound(saved, settings, run.lengthM)
    expect(edited.supports.length).toBe(intermediateSupports(found).length)
    expect(edited.supports.every((s) => matchesFound(saved, s))).toBe(true)
    const same = editedLayoutToAnalyse(run, edited)
    if (!same.ok) throw Error(same.error)
    const current = engine.analyze(run.input, same.layout)
    // The found layout analysed as an edit gives the found layout's numbers.
    expect(current.minClearanceM).toBeCloseTo(found.minClearanceM!, 6)
    expect(current.maxTensionKN).toBeCloseTo(found.maxTensionKN!, 6)
    expect(compareLayouts(found, current, settings, EXAMPLE_RIGGING.minClearanceM, []).some((r) => r.changed)).toBe(
      false,
    )

    // Drop every intermediate support: the long span sags onto the knoll.
    const bare = { ...edited, supports: [] }
    const layout = editedLayoutToAnalyse(run, bare)
    if (!layout.ok) throw Error(layout.error)
    const without = engine.analyze(run.input, layout.layout)
    const rows = compareLayouts(
      found,
      without,
      settings,
      EXAMPLE_RIGGING.minClearanceM,
      placementIssues(bare, settings),
    )
    const clearance = rows.find((r) => r.id === 'clearance')!
    expect(clearance.foundState).toBe('met')
    expect(clearance.currentState).toBe('not-met')
    expect(clearance.changed).toBe(true)
    expect(rows.find((r) => r.id === 'supports')).toMatchObject({ current: '0', changed: true })
    expect(rows.find((r) => r.id === 'placement')).toMatchObject({ currentState: 'met' })
    // The clearance row is located where the loaded carriage comes closest to the knoll.
    const marks = focusMarks('clearance', without, settings)
    expect(marks.points.length).toBeGreaterThan(0)
    expect(marks.points[0].stationM).toBeGreaterThan(20)
    expect(marks.points[0].stationM).toBeLessThan(280)
    expect(marks.points[0].label).toMatch(/^short \d/)
    expect(focusMarks('span:0', without, settings).range).toEqual([0, run.lengthM])

    // The chart draws the edit's supports on the ground under them, and the CSV carries the names.
    const overlay = layoutOverlay(run, settings, current, {
      edited: {
        layout: nameSupport(edited, 0, { name: 'Spar', category: 'tree' }),
        profile: run.input.profile,
        towerHeightM: 12,
        pending: false,
      },
      focus: marks,
    })
    expect(overlay.supports[1]).toMatchObject({ handle: 0, name: 'Spar', category: 'tree', label: '1' })
    expect(overlay.supports[1].ground).toBeCloseTo(groundAtStation(run.input.profile, edited.supports[0].stationM), 6)
    expect(overlay.editing?.pending).toBe(false)
    expect(overlay.summary).toMatch(/^Edited layout · \d+ supports? · pre-tension/)
    expect(overlay.focus?.points[0].x).toBeCloseTo(marks.points[0].stationM, 6)
    const csv = cableLayoutCsv('Knoll', current, [edited.start, { name: 'Spar', category: 'tree' }, edited.end])
      .trim()
      .split('\n')
    expect(csv[0].endsWith(',support_name,support_category')).toBe(true)
    expect(csv[2].endsWith(',Spar,tree')).toBe(true)
    const columns = csv[0].split(',').length
    expect(csv.every((row) => row.split(',').length === columns)).toBe(true)
  }, 30_000)
})
