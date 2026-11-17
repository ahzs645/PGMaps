import { describe, expect, it } from 'vitest'
import { analyzeRoad, engineeringGeometry, offsetCoordinate } from './engine'
import { calculateCulverts } from './engineering'
import { createEngineeringDesign, type Culvert } from './engineeringTypes'
import type { DitchLowPoint } from './hydrology'
import type { Alignment, Coordinate, RoadSettings, TerrainSource } from './types'
import {
  acceptedCulverts,
  batchBasis,
  confirmSides,
  DEFAULT_BATCH_PIPE,
  draftsFromCandidates,
  draftsFromSpacing,
  editDraft,
  MAX_ROAD_CULVERTS,
  previewBatch,
  trialSpacingProblem,
  trialSpacingStations,
  type BatchContext,
  type CrossDrainDraft,
} from './crossDrainBatch'

const origin: Coordinate = [-122.8, 53.9]
const north = (m: number) => offsetCoordinate(origin, 0, m)
// Ground falls 10 % to the east (the road's right), so a left inlet is the uphill end.
const sloped: TerrainSource = {
  elevationAt: (lon) =>
    800 - (((lon - origin[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180) * 0.1,
}
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 0.8,
}
function road(): Alignment {
  return {
    id: 'road',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: north(300), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'e', chainage: 300, elevation: 800, curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1.5,
      ditchWidth: 1,
      ditchDepth: 0.5,
      surfaceDepth: 0,
    },
    overrides: [],
    engineering: createEngineeringDesign(),
  }
}
function site(id: string, chainage: number, side: 'left' | 'right', extra: Partial<DitchLowPoint> = {}): DitchLowPoint {
  return {
    id,
    kind: 'outlet',
    side,
    sides: [side],
    chainage,
    fromChainage: chainage - 10,
    toChainage: chainage + 10,
    outlets: 2,
    coordinate: north(chainage),
    areaHa: 0.4,
    depthM: 0,
    culvertId: null,
    throughCulvert: false,
    ...extra,
  }
}
function contextFor(a: Alignment, extra: Partial<BatchContext> = {}): BatchContext {
  const analysis = analyzeRoad(a, sloped, settings)
  const geometry = engineeringGeometry(a, sloped)
  return {
    analysis,
    existing: a.engineering!.culverts,
    existingResults: analysis.engineering?.culverts ?? [],
    streamStations: [],
    pipe: DEFAULT_BATCH_PIPE,
    calculate: (culverts) => calculateCulverts(culverts, a, analysis, sloped, geometry),
    ...extra,
  }
}
let next = 0
const newId = () => `d${++next}`

describe('cross-drain batch drafts', () => {
  it('proposes one pipe per selected site, inlet on its recorded side, none for a site through a culvert', () => {
    const sites = [
      site('low-1', 60, 'left'),
      site('low-2', 150, 'right'),
      site('low-3', 220, 'left', { throughCulvert: true }),
    ]
    const drafts = draftsFromCandidates(sites, new Set(['low-1', 'low-2', 'low-3']), { screening: false, newId })
    expect(drafts.map((d) => [d.siteId, d.chainage, d.inletSide, d.proposedSide, d.sideConfirmed])).toEqual([
      ['low-1', 60, 'left', 'left', false],
      ['low-2', 150, 'right', 'right', false],
    ])
    expect(drafts[0]).toMatchObject({ fromChainage: 50, toChainage: 70, outlets: 2 })
  })

  it('checks a trial spacing and lays stations from start to end', () => {
    expect(trialSpacingProblem({ startM: 0, endM: 300, spacingM: 5 }, 300)).toMatch(/between 10/)
    expect(trialSpacingProblem({ startM: 50, endM: 40, spacingM: 20 }, 300)).toMatch(/past the start/)
    expect(trialSpacingProblem({ startM: 0, endM: 400, spacingM: 20 }, 300)).toMatch(/on the road/)
    expect(trialSpacingProblem({ startM: 20, endM: 280, spacingM: 100 }, 300)).toBeNull()
    expect(trialSpacingStations({ startM: 20, endM: 280, spacingM: 100 })).toEqual([20, 120, 220])
  })

  it('proposes a spacing draft inlet at the uphill end of its barrel', () => {
    const a = road(),
      context = contextFor(a)
    const drafts = draftsFromSpacing(
      { startM: 50, endM: 150, spacingM: 50 },
      {
        newId,
        groundAtEnds: (d) => {
          const r = previewBatch([d], context)[0].result!
          return [r.profile[0].groundElevation, r.profile.at(-1)!.groundElevation]
        },
      },
    )
    expect(drafts.map((d) => [d.chainage, d.proposedSide, d.inletSide])).toEqual([
      [50, 'left', 'left'],
      [100, 'left', 'left'],
      [150, 'left', 'left'],
    ])
  })
})

describe('cross-drain batch preview', () => {
  it('builds each pipe through the engine with cover met and its inlet where the draft says', () => {
    const a = road(),
      context = contextFor(a)
    const drafts = confirmSides(
      draftsFromCandidates([site('low-1', 60, 'left'), site('low-2', 150, 'right')], new Set(['low-1', 'low-2']), {
        screening: false,
        newId,
      }),
    )
    const rows = previewBatch(drafts, context)
    for (const row of rows) {
      expect(row.result!.coverM).toBeGreaterThanOrEqual(row.culvert.minCoverM - 1e-6)
      expect(row.result!.requiredLengthM).toBeLessThanOrEqual(row.culvert.lengthM + 1e-9)
      expect(row.culvert.inletInvertM! - row.culvert.outletInvertM!).toBeCloseTo((2 * row.culvert.lengthM) / 100, 2)
    }
    // A right inlet starts on the east (right) end; a left one on the west.
    expect(rows[0].result!.start[0]).toBeLessThan(rows[0].result!.coordinate[0])
    expect(rows[1].result!.start[0]).toBeGreaterThan(rows[1].result!.coordinate[0])
    expect(rows[1].culvert.inletSide).toBe('right')
    expect('inletSide' in rows[0].culvert).toBe(false)
    // The right inlet is the downhill end on this slope: flagged, not refused.
    expect(rows[1].issues.map((x) => x.code)).toContain('outlet-uphill')
    expect(rows.every((r) => r.ready)).toBe(true)
    // The engine calculates the added culverts exactly as previewed.
    const added = { ...a, engineering: { ...a.engineering!, culverts: acceptedCulverts(rows) } }
    const calculated = analyzeRoad(added, sloped, settings).engineering!.culverts
    expect(calculated).toEqual(rows.map((r) => r.result))
  })

  it('refuses an unconfirmed side, a natural stream, crossing barrels and the culvert limit', () => {
    const a = road()
    const base = draftsFromCandidates(
      [site('low-1', 60, 'left'), site('low-2', 150, 'left')],
      new Set(['low-1', 'low-2']),
      {
        screening: true,
        newId,
      },
    )
    const unconfirmed = previewBatch(base, contextFor(a))
    expect(unconfirmed.map((r) => r.ready)).toEqual([false, false])
    expect(unconfirmed[0].issues.find((x) => x.code === 'side-unconfirmed')?.message).toMatch(/proposed left/)
    expect(unconfirmed[0].issues.find((x) => x.code === 'screening')?.blocks).toBe(false)

    const stream = previewBatch(confirmSides(base), contextFor(a, { streamStations: [155] }))
    expect(stream[1].issues.find((x) => x.code === 'natural-stream')?.blocks).toBe(true)
    expect(stream[0].ready).toBe(true)

    // Two skewed pipes 4 m apart cross each other.
    const crossing = confirmSides([
      editDraft(base[0], { skewDegrees: 40 }),
      editDraft({ ...base[1], id: 'x' }, { chainage: 64, skewDegrees: -40 }),
    ])
    const crossed = previewBatch(crossing, contextFor(a))
    expect(crossed.map((r) => r.issues.some((x) => x.code === 'intersects'))).toEqual([true, true])
    expect(crossed.map((r) => r.issues.some((x) => x.code === 'duplicate'))).toEqual([true, true])
    // Excluding one clears the other.
    const one = previewBatch([crossing[0], { ...crossing[1], included: false }], contextFor(a))
    expect(one[0].ready).toBe(true)
    expect(one[1].ready).toBe(false)

    const full = road()
    full.engineering!.culverts = Array.from(
      { length: MAX_ROAD_CULVERTS - 1 },
      (_, i): Culvert => ({
        id: `c${i}`,
        name: `C${i}`,
        chainage: 280,
        skewDegrees: 0,
        lengthM: 12,
        diameterM: 0.6,
        inletInvertM: null,
        outletInvertM: null,
        minCoverM: 0.6,
        unitCost: 0,
        fixedCost: 0,
      }),
    )
    const limited = previewBatch(confirmSides(base), contextFor(full, { existingResults: [] }))
    expect(limited.map((r) => r.ready)).toEqual([true, false])
    expect(limited[1].issues.find((x) => x.code === 'over-limit')).toBeTruthy()
  })

  it('flags unknown cover where the terrain is missing and a draft moved off its site', () => {
    const a = road()
    const holes: TerrainSource = {
      elevationAt: (lon, lat) => (lat > north(120)[1] ? NaN : sloped.elevationAt(lon, lat)),
    }
    const analysis = analyzeRoad(a, holes, settings)
    const geometry = engineeringGeometry(a, holes)
    const drafts = confirmSides(
      draftsFromCandidates([site('low-1', 60, 'left')], new Set(['low-1']), { screening: false, newId }),
    ).map((d) => editDraft(d, { chainage: 200 }))
    const [row] = previewBatch(drafts, {
      ...contextFor(a),
      analysis,
      calculate: (culverts) => calculateCulverts(culverts, a, analysis, holes, geometry),
    })
    expect(row.issues.map((x) => x.code)).toEqual(expect.arrayContaining(['unknown-cover', 'off-site']))
    expect(row.ready).toBe(true)
  })

  it('names a preview basis that ignores culverts but follows the road and the drainage run', () => {
    const a = road()
    const c: Culvert = {
      id: 'c',
      name: 'C',
      chainage: 10,
      skewDegrees: 0,
      lengthM: 12,
      diameterM: 0.6,
      inletInvertM: null,
      outletInvertM: null,
      minCoverM: 0.6,
      unitCost: 0,
      fixedCost: 0,
    }
    const withCulvert = { ...a, engineering: { ...a.engineering!, culverts: [c] } }
    expect(batchBasis(withCulvert, settings, 'run')).toBe(batchBasis(a, settings, 'run'))
    expect(batchBasis(a, settings, 'other')).not.toBe(batchBasis(a, settings, 'run'))
    const moved = { ...a, vertical: [a.vertical[0], { ...a.vertical[1], elevation: 801 }] }
    expect(batchBasis(moved, settings, 'run')).not.toBe(batchBasis(a, settings, 'run'))
  })
})

describe('cross-drain draft edits', () => {
  it('confirms the side when the designer picks it and keeps skew within the limits', () => {
    const d: CrossDrainDraft = draftsFromCandidates([site('low-1', 60, 'left')], new Set(['low-1']), {
      screening: false,
      newId,
    })[0]
    expect(editDraft(d, { inletSide: 'right' })).toMatchObject({ inletSide: 'right', sideConfirmed: true })
    expect(editDraft(d, { skewDegrees: 95 }).skewDegrees).toBe(80)
    expect(editDraft(d, { chainage: 70 }).sideConfirmed).toBe(false)
  })
})
