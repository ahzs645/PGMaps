import { describe, expect, it } from 'vitest'

import { visibleFaceLandform } from './ridgeLayers'
import { createEmptyScene, type ForestryScene } from './scene'
import type { TargetPolygon } from './types'
import {
  adoptViewLandform,
  clearViewLandform,
  followSiteLandform,
  followsSite,
  landformAssignments,
  landformTargetFromCandidate,
  siteLandformOf,
  viewLandformCandidate,
  viewLandformName,
  viewLandformTileRange,
  viewLandformVerdict,
} from './viewLandform'
import { metersPerDegree, pointInPolygon } from './visibility'
import type { ViewOfInterest } from './viewsOfInterest'

/** A generated grid (no reference image): a lake, a face rising north to a crest at 3 km, a ridge behind. */
const STATION = { lng: -124.5, lat: 50.2 }
const m = metersPerDegree(STATION.lat)
const at = (x: number, y: number): [number, number] => [STATION.lng + x / m.lng, STATION.lat + y / m.lat]
const ground = {
  elevationAt(_lng: number, lat: number) {
    const y = (lat - STATION.lat) * m.lat
    if (y < 800) return 500
    if (y < 3000) return 500 + ((y - 800) / 2200) * 400
    if (y < 4000) return 900 - ((y - 3000) / 1000) * 300
    if (y < 7000) return 600 + ((y - 4000) / 3000) * 700
    return 1300
  },
}
const box = (x0: number, y0: number, x1: number, y1: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]],
})
const LAKE = box(-8000, -200, 8000, 800)
const BLOCK: TargetPolygon = {
  id: 'b1',
  name: 'CHU_26_1',
  role: 'block',
  objectiveId: 'partial-retention',
  vac: null,
  harvestYear: null,
  clearcutPercent: null,
  geometry: box(-300, 1500, 300, 2000),
  source: 'test',
}

function view(id: string, patch: Partial<ViewOfInterest> = {}): ViewOfInterest {
  return {
    id,
    name: `Lakeshore ${id}`,
    source: { kind: 'map' },
    lng: STATION.lng,
    lat: STATION.lat,
    blockId: 'b1',
    facing: { kind: 'block' },
    focalMm: 50,
    framing: 'landform',
    ...patch,
  }
}

const sceneWith = (patch: Partial<ForestryScene>): ForestryScene => ({ ...createEmptyScene(), ...patch })

describe('the landform seen from a planned view', () => {
  it("is the finder's visible face read from the view's place, with the same options", () => {
    const candidate = viewLandformCandidate(ground, view('a'), BLOCK, { water: [LAKE], eyeHeightMeters: 1.6 })!
    const direct = visibleFaceLandform(ground, BLOCK.geometry, STATION, { water: [LAKE], eyeHeightMeters: 1.6 })!
    expect(candidate.method).toBe('visible-face')
    expect(candidate.geometry).toEqual(direct.geometry)
    expect(candidate.areaHectares).toBe(direct.areaHectares)
    expect(candidate).toMatchObject({ blockId: 'b1', blockName: 'CHU_26_1', vantageName: 'Lakeshore a' })
    expect(candidate.blockGeometry).toBe(BLOCK.geometry)
    expect(pointInPolygon(candidate.geometry, ...at(0, 2500))).toBe(true)
    expect(pointInPolygon(candidate.geometry, ...at(0, 400))).toBe(false)
  })

  it("is none when the view's place has no terrain", () => {
    const nowhere = { elevationAt: () => Number.NaN }
    expect(viewLandformCandidate(nowhere, view('a'), BLOCK, { eyeHeightMeters: 1.6 })).toBeNull()
  })

  it('loads terrain round the block and out to the view', () => {
    const [lng, lat] = at(0, -9000)
    const range = viewLandformTileRange({ lng, lat }, BLOCK.geometry)
    const near = viewLandformTileRange(STATION, BLOCK.geometry)
    expect(range.zoom).toBe(12)
    expect(range.maxY).toBeGreaterThan(near.maxY)
  })
})

describe('adopting a landform for a view', () => {
  const candidate = viewLandformCandidate(ground, view('a'), BLOCK, { water: [LAKE], eyeHeightMeters: 1.6 })!
  const target = (id: string) =>
    landformTargetFromCandidate(candidate, { id, name: viewLandformName(candidate, view('a')) })

  it("is named and sourced as the finder's, with the view it was read from", () => {
    const adopted = target('lf-1')
    expect(adopted).toMatchObject({
      role: 'landscape',
      name: 'Visible face round CHU_26_1 from Lakeshore a',
      objectiveId: 'partial-retention',
    })
    expect(adopted.source).toBe(
      'Visible face from Lakeshore a (one station, water and frame break it); review against the view',
    )
    expect(landformTargetFromCandidate(candidate, { id: 'x' }).name).toBe('Visible face round CHU_26_1')
  })

  it("adds the landform, records it on that view only, and leaves the run's landform as it was", () => {
    const runLandform = { ...BLOCK, id: 'lf-run', name: 'Davie ridge', role: 'landscape' as const }
    const scene = sceneWith({ targets: [BLOCK, runLandform], viewsOfInterest: [view('a'), view('b')] })
    const next = adoptViewLandform(scene, 'a', target('lf-1'))
    expect(next.targets.map((entry) => entry.id)).toEqual(['b1', 'lf-run', 'lf-1'])
    // Two landforms now: the one the run assessed is named active so the scene stays valid.
    expect(next.activeLandformId).toBe('lf-run')
    expect(next.viewsOfInterest?.map((entry) => entry.landformId ?? null)).toEqual(['lf-1', null])
  })

  it('reuses a landform with the same outline rather than adding it twice', () => {
    const scene = sceneWith({ targets: [BLOCK], viewsOfInterest: [view('a'), view('b')] })
    const once = adoptViewLandform(scene, 'a', target('lf-1'))
    const twice = adoptViewLandform(once, 'b', target('lf-2'))
    expect(twice.targets.filter((entry) => entry.role === 'landscape').map((entry) => entry.id)).toEqual(['lf-1'])
    expect(twice.viewsOfInterest?.map((entry) => entry.landformId)).toEqual(['lf-1', 'lf-1'])
    // The first landform in a scene becomes its landform, as any first landform does.
    expect(once.activeLandformId).toBe('lf-1')
  })

  it('changes nothing for a view that is not in the scene', () => {
    const scene = sceneWith({ targets: [BLOCK], viewsOfInterest: [view('a')] })
    expect(adoptViewLandform(scene, 'gone', target('lf-1'))).toBe(scene)
  })

  it("clears only the view's landform, never the landform target", () => {
    const views = [view('a', { landformId: 'lf-1' }), view('b', { landformId: 'lf-1' })]
    const cleared = clearViewLandform(views, 'a')
    expect('landformId' in cleared[0]).toBe(false)
    expect(cleared[1].landformId).toBe('lf-1')
    expect(cleared[1]).toBe(views[1])
  })
})

describe('what the control says about a reading', () => {
  const reading = { blockName: 'Test Block C', areaHectares: 44, blockOnly: true }
  it('never calls the land in front of a hidden block a face round it', () => {
    const hidden = viewLandformVerdict({ ...reading, seededBy: 'in-front' }, 29)
    expect(hidden.adoptable).toBe(false)
    expect(hidden.title).toBe('The land in front of Test Block C, 44 ha')
    expect(hidden.note).toMatch(/^Test Block C is hidden from here/)
    expect(hidden.note).not.toMatch(/beyond the block/)
    // A wide face in front of a hidden block is adoptable, said for what it is.
    const wide = viewLandformVerdict({ ...reading, areaHectares: 598, blockOnly: false, seededBy: 'in-front' }, 131)
    expect(wide).toMatchObject({ adoptable: true, title: 'Face in front of Test Block C, 598 ha', tone: 'info' })
  })
  it('says why a block seen with little hillside round it gives nothing to adopt', () => {
    const seen = viewLandformVerdict({ ...reading, areaHectares: 77, seededBy: 'block' }, 59)
    expect(seen.adoptable).toBe(false)
    expect(seen.note).toMatch(/little hillside round Test Block C beyond the block itself \(77 ha against its 59 ha\)/)
    expect(viewLandformVerdict({ ...reading, areaHectares: 460, blockOnly: false, seededBy: 'block' }, 59)).toEqual({
      title: 'Visible face round Test Block C, 460 ha',
      adoptable: true,
      tone: null,
      note: null,
    })
  })
  it('names an adopted face in front of a hidden block as that', () => {
    const candidate = { blockName: 'Block A' } as Parameters<typeof viewLandformName>[0]
    expect(viewLandformName({ ...candidate, seededBy: 'in-front' }, { name: 'VLI 145' })).toBe(
      'Face in front of Block A from VLI 145',
    )
    expect(viewLandformName({ ...candidate, seededBy: 'block' }, { name: 'VLI 145' })).toBe(
      'Visible face round Block A from VLI 145',
    )
  })
})

describe('who is assessed against what', () => {
  const landform = (id: string, patch: Partial<TargetPolygon> = {}): TargetPolygon => ({
    ...BLOCK,
    id,
    name: `Landform ${id}`,
    role: 'landscape',
    geometry: box(-2000, 800, 2000, 3000),
    ...patch,
  })
  const sceneWith = (patch: Partial<ForestryScene>): ForestryScene => ({ ...createEmptyScene(), ...patch })

  it('takes the reviewer’s landform as the site’s, also while standing at a view on its own', () => {
    const targets = [BLOCK, landform('site'), landform('face')]
    const onTheRoad = sceneWith({ targets, activeLandformId: 'site' })
    expect(siteLandformOf(onTheRoad)?.id).toBe('site')
    // The stand made the view's landform the run's, and kept the reviewer's for the way back.
    const atTheView = sceneWith({ targets, activeLandformId: 'face' })
    expect(siteLandformOf(atTheView, { reviewer: 'site', set: 'face' })?.id).toBe('site')
    // The reviewer chose another landform since: the stand's record no longer says which is the site's.
    expect(
      siteLandformOf(sceneWith({ targets, activeLandformId: 'site' }), { reviewer: 'face', set: 'face' })?.id,
    ).toBe('site')
    // One landform is the site's without being named; several with none named is none.
    expect(siteLandformOf(sceneWith({ targets: [BLOCK, landform('only')] }))?.id).toBe('only')
    expect(siteLandformOf(sceneWith({ targets }))).toBeNull()
    expect(siteLandformOf(sceneWith({ targets, activeLandformId: 'gone' }))).toBeNull()
  })

  it('sorts the landforms into the site’s, each view’s own and the ones nothing uses', () => {
    const site = landform('site')
    const scene = sceneWith({
      targets: [BLOCK, site, landform('face'), landform('spare')],
      activeLandformId: 'site',
      viewsOfInterest: [
        view('a', { landformId: 'face' }),
        view('b'),
        view('c', { landformId: 'site' }),
        view('d', { landformId: 'gone' }),
        view('e', { blockId: 'gone' }),
      ],
    })
    const use = landformAssignments(scene, site)
    expect(use.views.map((entry) => entry.own?.id ?? null)).toEqual(['face', null, null, null, null])
    // A view that names the site's landform is on the site's; one that names a missing landform says so.
    expect(use.views.map((entry) => entry.missing)).toEqual([false, false, false, true, false])
    expect(use.views.map((entry) => entry.block?.id ?? null)).toEqual(['b1', 'b1', 'b1', 'b1', null])
    expect(use.unused.map((target) => target.id)).toEqual(['spare'])
    // With no site landform chosen, the landform view c names is that view's own, and only the spare is unused.
    const unchosen = landformAssignments(scene, null)
    expect(unchosen.views[2].own?.id).toBe('site')
    expect(unchosen.unused.map((target) => target.id)).toEqual(['spare'])
  })

  it('carries the site landform’s objective and VAC to the views’ landforms that still held them', () => {
    const site = landform('site', { objectiveId: 'partial-retention', vac: 'medium' })
    const targets = [
      BLOCK,
      site,
      landform('following', { objectiveId: 'partial-retention', vac: 'medium' }),
      landform('own-objective', { objectiveId: 'retention', vac: 'medium' }),
      landform('spare', { objectiveId: 'partial-retention', vac: 'medium' }),
    ]
    const views = [view('a', { landformId: 'following' }), view('b', { landformId: 'own-objective' })]
    const next = followSiteLandform(targets, views, site, { objectiveId: 'modification' })
    const objective = (id: string) => next.find((target) => target.id === id)?.objectiveId
    expect(objective('following')).toBe('modification')
    // A face given its own objective keeps it; a landform no view uses, the block and the site itself are untouched.
    expect(objective('own-objective')).toBe('retention')
    expect(objective('spare')).toBe('partial-retention')
    expect(objective('site')).toBe('partial-retention')
    expect(next.find((target) => target.id === 'b1')).toBe(BLOCK)

    // VAC follows on its own, cleared included; the face with its own objective still follows the VAC it shared.
    const cleared = followSiteLandform(targets, views, site, { vac: null })
    expect(cleared.find((target) => target.id === 'following')?.vac).toBeNull()
    expect(cleared.find((target) => target.id === 'own-objective')?.vac).toBeNull()
    expect(cleared.find((target) => target.id === 'own-objective')?.objectiveId).toBe('retention')

    // Nothing to carry returns the same list, so an edit that changes nothing else stays one change.
    expect(followSiteLandform(targets, [], site, { objectiveId: 'modification' })).toBe(targets)
    expect(followSiteLandform(targets, views, site, { name: 'Renamed' } as never)).toBe(targets)

    expect(followsSite({ objectiveId: 'partial-retention', vac: 'medium' }, site)).toBe(true)
    expect(followsSite({ objectiveId: 'retention', vac: 'medium' }, site)).toBe(false)
    expect(followsSite({ objectiveId: 'partial-retention', vac: null }, site)).toBe(false)
    expect(followsSite({ objectiveId: 'partial-retention', vac: 'medium' }, null)).toBe(false)
  })
})
