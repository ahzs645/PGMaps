import type { LineString, MultiPoint, Point, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import raw from '../../../../packages/legal-rules/packs/bc-crown-grazing.json'
import { parsePack } from '../../../../packages/legal-rules/src/contract'
import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'
import { saveRangeReview, setEntry } from '../edits'
import { assessmentRecord, buildExport } from '../exports'
import { nearFootprint, overlapsWith } from '../oldForest/oldForest'
import { parsePlan, samplePlan, type MappedEvidence, type Plan } from '../plan'
import { analyzePlan } from '../planAnalysis'
import type { Fetch } from '../wfsReads'
import { lngLatToAlbers } from '../../dev-avast/projection'
import {
  featureMeasure,
  layerSummary,
  readMappedEvidence,
  CROWN_TENURE_LAYER,
  NATURAL_BARRIER_LAYER,
  NEAR_FOOTPRINT_METRES,
  RANGE_IMPROVEMENT_LINE_LAYER,
  RANGE_IMPROVEMENT_POINT_LAYER,
  RANGE_PASTURE_LAYER,
  RANGE_TENURE_LAYER,
} from './grazingEvidence'
import { mappedReadCurrent, rangeReviewFor } from './rangeReview'

const pack = parsePack(raw)

const box = (west: number, south: number, east: number, north: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
})

// The sample's block: -122.7701 to -122.7611, 53.99 to 53.995.
const ADA_WEST = box(-122.775, 53.985, -122.7655, 54.0)
const RANGE_ALL = box(-122.8, 53.98, -122.7, 54.01)
const RANGE_OLD = box(-122.8, 53.98, -122.7, 53.9925)
const LEASE = box(-122.766, 53.992, -122.76, 54.0)
const FAR = box(-123.5, 54.5, -123.49, 54.51)

type Answer = Record<string, unknown>[] | number
const feature = (properties: Record<string, unknown>, geometry: Polygon | LineString | Point | MultiPoint) => ({
  type: 'Feature',
  properties,
  geometry,
})
const line = (...coordinates: [number, number][]): LineString => ({ type: 'LineString', coordinates })
const point = (lng: number, lat: number): Point => ({ type: 'Point', coordinates: [lng, lat] })
/** Metres between two points in BC Albers, as the overlay measures them. */
const albersMetres = (a: [number, number], b: [number, number]) => {
  const [x0, y0] = lngLatToAlbers(...a)
  const [x1, y1] = lngLatToAlbers(...b)
  return Math.hypot(x1 - x0, y1 - y0)
}
// About 30 m and 200 m in latitude.
const LAT_30_M = 30 / 111_200
const LAT_200_M = 200 / 111_200
const BLOCK_WIDTH_M = albersMetres([-122.7701, 53.9925], [-122.7611, 53.9925])

function stub(answers: Record<string, Answer>) {
  const asked: URLSearchParams[] = []
  const fetch: Fetch = async (_url, init) => {
    const body = new URLSearchParams(init?.body)
    asked.push(body)
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const answer = answers[body.get('typeNames') ?? '']
    if (typeof answer === 'number') return { ok: false, status: answer, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: answer ?? [] }) }
  }
  return { fetch, asked }
}

const ANSWERS: Record<string, Answer> = {
  'pub:WHSE_LAND_USE_PLANNING.RMP_PLAN_LEGAL_POLY_SVW': [
    feature(
      {
        OBJECTID: 1,
        LEGAL_FEAT_PROVID: 'PRG_1_1',
        STRGC_LAND_RSRCE_PLAN_NAME:
          'Agricultural Development Areas and Settlement Reserve Areas within 4 Forest Districts - Extent',
        LEGAL_FEAT_OBJECTIVE: 'Agricultural Development Areas - Prince George W',
        LEGALIZATION_DATE: '2006-11-21Z',
        LEGAL_FEAT_ATRB_1_NAME: 'STATUS',
        LEGAL_FEAT_ATRB_1_VALUE: 'ADA',
      },
      ADA_WEST,
    ),
  ],
  [RANGE_TENURE_LAYER]: [
    feature(
      {
        OBJECTID: 10,
        FOREST_FILE_ID: 'RAN000001',
        MAP_BLOCK_ID: 'A',
        FILE_TYPE_CODE: 'E01',
        FILE_STATUS_CODE: 'A',
        LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
        AUTHORIZED_USE: 120,
        CLIENT_NAME: 'A private person',
      },
      RANGE_ALL,
    ),
    feature(
      {
        OBJECTID: 11,
        FOREST_FILE_ID: 'RAN000002',
        MAP_BLOCK_ID: 'A',
        FILE_TYPE_CODE: 'E02',
        FILE_STATUS_CODE: 'AR',
        LIFE_CYCLE_STATUS_CODE: 'RETIRED',
        RETIREMENT_DATE: '2012-04-01Z',
      },
      RANGE_OLD,
    ),
    feature({ OBJECTID: 12, FOREST_FILE_ID: 'RAN000003', LIFE_CYCLE_STATUS_CODE: 'ACTIVE' }, FAR),
  ],
  [RANGE_PASTURE_LAYER]: [
    feature(
      {
        OBJECTID: 30,
        RANGE_UNIT_ID: 6216,
        RANGE_PASTURE_ID: '02',
        PASTURE_NAME: 'Powerline',
        OWNERSHIP_CODE: 'provincial crown',
      },
      RANGE_OLD,
    ),
  ],
  [RANGE_IMPROVEMENT_LINE_LAYER]: [
    // Across the block, 0.0405 past each side: inside the width, and 50 m more each side within the margin.
    feature(
      {
        OBJECTID: 40,
        FEATURE_CODE: 'FI91600370',
        IMPROVEMENT_FEATURE_CODE: 'FENCE',
        IMPROVEMENT_TYPE_CODE: 'barb-wire',
      },
      line([-122.79, 53.9925], [-122.74, 53.9925]),
    ),
    // Along the north edge, 30 m outside it: nothing inside, all of it within the margin.
    feature(
      { OBJECTID: 41, FEATURE_CODE: 'FI91600370', IMPROVEMENT_FEATURE_CODE: 'FENCE', FIELD_CONDITION_CODE: 'good' },
      line([-122.7701, 53.995 + LAT_30_M], [-122.7611, 53.995 + LAT_30_M]),
    ),
    // 200 m south: read by the box of the stub, but past the margin.
    feature(
      { OBJECTID: 42, FEATURE_CODE: 'DC31700700', IMPROVEMENT_FEATURE_CODE: 'STOCK TRAIL' },
      line([-122.7701, 53.99 - LAT_200_M], [-122.7611, 53.99 - LAT_200_M]),
    ),
  ],
  [RANGE_IMPROVEMENT_POINT_LAYER]: [
    feature(
      { OBJECTID: 50, FEATURE_CODE: 'FI91600070', IMPROVEMENT_FEATURE_CODE: 'CATTLEGUARD' },
      point(-122.7656, 53.9925),
    ),
    // No improvement code: the kind is read from the feature code, and the record says so.
    feature(
      { OBJECTID: 51, FEATURE_CODE: 'FI91600070', IMPROVEMENT_FEATURE_CODE: null },
      point(-122.7656, 53.995 + LAT_30_M),
    ),
    feature(
      {
        OBJECTID: 52,
        FEATURE_CODE: 'FI19600010',
        IMPROVEMENT_FEATURE_CODE: 'WATER DEVELOPMENT',
        IMPROVEMENT_TYPE_CODE: 'dugout',
      },
      {
        type: 'MultiPoint',
        coordinates: [
          [-122.765, 53.991],
          [-122.765, 53.99 - LAT_30_M],
          [-122.765, 53.99 - LAT_200_M],
        ],
      },
    ),
    feature(
      { OBJECTID: 53, FEATURE_CODE: 'FI91600080', IMPROVEMENT_FEATURE_CODE: 'CORRAL' },
      point(-122.7656, 53.99 - LAT_200_M),
    ),
    feature({ OBJECTID: 54, FEATURE_CODE: 'FI91600240', IMPROVEMENT_FEATURE_CODE: 'SALT' }, point(-122.768, 53.993)),
  ],
  [CROWN_TENURE_LAYER]: [
    feature(
      {
        INTRID_SID: 7,
        CROWN_LANDS_FILE: '0000001',
        TENURE_STAGE: 'APPLICATION',
        TENURE_STATUS: 'ACCEPTED',
        TENURE_TYPE: 'LEASE',
        TENURE_SUBTYPE: 'STANDARD LEASE',
      },
      LEASE,
    ),
  ],
}

const read = (fetch: Fetch, plan = samplePlan(), signal?: AbortSignal) => {
  const block = plan.blocks[0]
  const { record } = rangeReviewFor(plan, block)
  const shape = block.shapes[0]
  return readMappedEvidence({
    footprint: shape.geometry,
    shape: record.shape,
    signature: record.footprint,
    fetch,
    signal,
    measure: overlapsWith,
    near: nearFootprint,
    readOn: '2026-11-24',
  })
}

describe('Mapped grazing evidence', () => {
  it('reads each layer by the footprint’s own polygon and measures what overlaps', async () => {
    const { fetch, asked } = stub(ANSWERS)
    const evidence = await read(fetch)
    expect(asked).toHaveLength(7)
    for (const body of asked.slice(0, 4)) {
      expect(body.get('CQL_FILTER')).toMatch(
        /^INTERSECTS\((GEOMETRY|SHAPE),SRID=4326;POLYGON\(\(-122\.77010 53\.99000,/,
      )
      expect(body.get('propertyName')).not.toMatch(/CLIENT/)
    }
    expect(asked[0].get('CQL_FILTER')).toContain("STRGC_LAND_RSRCE_PLAN_NAME IN ('Agricultural Development Areas and")
    expect(asked[2].get('CQL_FILTER')).toContain(
      "AND (TENURE_SUBPURPOSE = 'GRAZING' OR TENURE_SUBTYPE IN ('SEC 15 OIC RESERVE', 'SEC 16 MAP RESERVE', 'SEC 17 DESIGNATED USE AREA'))",
    )
    expect(asked[2].get('propertyName')).toMatch(/,SHAPE$/)

    const blockHa = blockAreaHa(samplePlan().blocks[0].shapes[0].geometry)
    expect(evidence.footprintHa).toBeCloseTo(blockHa, 1)
    const [ada, range, lease] = evidence.layers
    expect(ada).toMatchObject({ layer: 'ada-sra', status: 'read' })
    expect(ada.features).toHaveLength(1)
    const westHa = blockAreaHa(box(-122.7701, 53.99, -122.7655, 53.995))
    expect(ada.features[0]).toMatchObject({ id: 'PRG_1_1', group: 'omineca-order' })
    expect(ada.features[0].overlapHa).toBeCloseTo(westHa, 1)
    expect(ada.features[0].sharePercent).toBeCloseTo((westHa / blockHa) * 100, 0)
    expect(ada.features[0].details).toContain('Legalised: 2006-11-21')

    // The far tenure touches nothing; the retired one is listed apart, under the active one.
    expect(range.features.map((f) => [f.id, f.group])).toEqual([
      ['RAN000001 A', 'active'],
      ['RAN000002 A', 'retired'],
    ])
    expect(range.features[0].name).toBe('Grazing licence (E01)')
    expect(range.features[0].sharePercent).toBeCloseTo(100, 3)
    expect(range.features[1].sharePercent).toBeCloseTo(50, 0)
    expect(JSON.stringify(range)).not.toContain('private person')
    expect(range.covered).toEqual([
      { group: 'active', ha: range.features[0].overlapHa },
      { group: 'retired', ha: range.features[1].overlapHa },
    ])
    expect(lease.features[0]).toMatchObject({ id: 'File 0000001', group: 'application' })
    expect(layerSummary(lease)).toMatch(/^Application: 1 \(/)
  })

  it('dissolves overlapping features of a group so shared ground counts once', async () => {
    const twice = {
      ...ANSWERS,
      [RANGE_TENURE_LAYER]: [
        feature({ OBJECTID: 1, FOREST_FILE_ID: 'RAN1', LIFE_CYCLE_STATUS_CODE: 'ACTIVE' }, RANGE_ALL),
        feature({ OBJECTID: 2, FOREST_FILE_ID: 'RAN2', LIFE_CYCLE_STATUS_CODE: 'ACTIVE' }, RANGE_ALL),
      ],
    }
    const evidence = await read(stub(twice).fetch)
    const range = evidence.layers[1]
    expect(range.features).toHaveLength(2)
    // The union is taken on a 10 cm grid, so it is within a few square metres of the footprint.
    expect(range.covered[0].ha).toBeCloseTo(evidence.footprintHa, 2)
  })

  it('says a layer it could not read was not read, never that it holds nothing', async () => {
    const evidence = await read(stub({ ...ANSWERS, [RANGE_TENURE_LAYER]: 503 }).fetch)
    const range = evidence.layers[1]
    expect(range).toMatchObject({ status: 'failed', features: [], covered: [] })
    expect(layerSummary(range)).toBe(`Not read: DataBC answered 503 for ${RANGE_TENURE_LAYER.replace('pub:', '')}.`)
    expect(evidence.layers[0].status).toBe('read')
    const empty = await read(stub({}).fetch)
    expect(layerSummary(empty.layers[1])).toBe('Nothing mapped overlaps the footprint')
  })

  it('marks a layer with more records than it keeps as incomplete', async () => {
    const many = Array.from({ length: 501 }, (_, i) => feature({ OBJECTID: i, FOREST_FILE_ID: `RAN${i}` }, FAR))
    const evidence = await read(stub({ ...ANSWERS, [RANGE_TENURE_LAYER]: many }).fetch)
    expect(evidence.layers[1].status).toBe('truncated')
    expect(layerSummary(evidence.layers[1])).toMatch(/Incomplete: DataBC holds more than 500 records/)
  })

  it('stops on cancel rather than recording a failed layer', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(read(stub(ANSWERS).fetch, samplePlan(), controller.signal)).rejects.toThrow()
  })
})

describe('Mapped range plan: pastures, developments and barriers', () => {
  it('reads lines and points against the footprint grown by the margin, by its own polygon', async () => {
    const { fetch, asked } = stub(ANSWERS)
    await read(fetch)
    const ring = (body: URLSearchParams) =>
      /POLYGON\(\(([^)]*)\)\)/
        .exec(body.get('CQL_FILTER') ?? '')![1]
        .split(',')
        .map((p) => p.split(' ').map(Number) as [number, number])
    for (const body of asked.slice(4)) {
      expect(body.get('CQL_FILTER')).toMatch(/^INTERSECTS\(GEOMETRY,SRID=4326;POLYGON\(\(/)
      expect(body.get('propertyName')).not.toMatch(/CLIENT/)
      const lats = ring(body).map(([, y]) => y)
      // The margin and its slack, past the block's south and north edges.
      const north = albersMetres([-122.766, 53.995], [-122.766, Math.max(...lats)])
      const south = albersMetres([-122.766, 53.99], [-122.766, Math.min(...lats)])
      for (const past of [north, south]) {
        expect(past).toBeGreaterThan(NEAR_FOOTPRINT_METRES)
        expect(past).toBeLessThan(NEAR_FOOTPRINT_METRES + 3)
      }
      // Rounded: more than a box's five corners.
      expect(ring(body).length).toBeGreaterThan(5)
    }
    expect(asked.slice(3).map((b) => b.get('typeNames'))).toEqual([
      RANGE_PASTURE_LAYER,
      RANGE_IMPROVEMENT_LINE_LAYER,
      RANGE_IMPROVEMENT_POINT_LAYER,
      NATURAL_BARRIER_LAYER,
    ])
  })

  it('measures each line inside the footprint and within the margin, and leaves out lines past it', async () => {
    const evidence = await read(stub(ANSWERS).fetch)
    const lines = evidence.layers.find((l) => l.layer === 'range-improvement-lines')!
    expect(lines).toMatchObject({ status: 'read', marginM: NEAR_FOOTPRINT_METRES, covered: [] })
    expect(lines.features.map((f) => [f.id, f.group])).toEqual([
      ['OBJECTID 40', 'fence'],
      ['OBJECTID 41', 'fence'],
    ])
    const [across, along] = lines.features
    expect(across.name).toBe('FENCE · barb-wire')
    expect(across.insideLengthM!).toBeCloseTo(BLOCK_WIDTH_M, 0)
    expect(Math.abs(across.lengthM! - (BLOCK_WIDTH_M + 2 * NEAR_FOOTPRINT_METRES))).toBeLessThan(1)
    expect(along.insideLengthM).toBe(0)
    expect(along.lengthM!).toBeCloseTo(BLOCK_WIDTH_M, 0)
    expect(along.details).toContain('Condition: good')
    expect(lines.lengths).toEqual([{ group: 'fence', lengthM: expect.any(Number), insideLengthM: expect.any(Number) }])
    expect(lines.lengths![0].lengthM).toBeCloseTo(across.lengthM! + along.lengthM!, 3)
    expect(lines.lengths![0].insideLengthM).toBeCloseTo(across.insideLengthM!, 3)
    expect(featureMeasure(along, lines.marginM)).toBe(`0 m inside · ${Math.round(along.lengthM!)} m within 50 m`)
    expect(layerSummary(lines)).toBe(
      `Fence: ${Math.round(across.insideLengthM!)} m inside, ${Math.round(lines.lengths![0].lengthM).toLocaleString('en-CA')} m within 50 m (2 records)`,
    )
  })

  it('counts a stretch two records share once in the group’s total', async () => {
    const fence = (id: number) =>
      feature({ OBJECTID: id, IMPROVEMENT_FEATURE_CODE: 'FENCE' }, line([-122.79, 53.9925], [-122.74, 53.9925]))
    const evidence = await read(stub({ ...ANSWERS, [RANGE_IMPROVEMENT_LINE_LAYER]: [fence(1), fence(2)] }).fetch)
    const lines = evidence.layers.find((l) => l.layer === 'range-improvement-lines')!
    expect(lines.features).toHaveLength(2)
    expect(lines.lengths![0].lengthM).toBeCloseTo(lines.features[0].lengthM!, 1)
    expect(lines.lengths![0].insideLengthM).toBeCloseTo(BLOCK_WIDTH_M, 0)
  })

  it('counts points inside the footprint and within the margin, by kind', async () => {
    const evidence = await read(stub(ANSWERS).fetch)
    const points = evidence.layers.find((l) => l.layer === 'range-improvement-points')!
    expect(points.features.map((f) => [f.id, f.group, f.insideCount, f.count])).toEqual([
      ['OBJECTID 50', 'cattleguard', 1, 1],
      ['OBJECTID 51', 'cattleguard', 0, 1],
      ['OBJECTID 52', 'water-development', 1, 2],
      ['OBJECTID 54', 'other', 1, 1],
    ])
    expect(points.features[1].name).toBe('CATTLEGUARD')
    expect(points.features[1].details).toContain(
      'Feature code: FI91600070 (no improvement code; kind read from the feature code)',
    )
    expect(points.features[3].name).toBe('SALT')
    expect(points.counts).toEqual([
      { group: 'cattleguard', count: 2, insideCount: 1 },
      { group: 'water-development', count: 2, insideCount: 1 },
      { group: 'other', count: 1, insideCount: 1 },
    ])
    expect(layerSummary(points)).toBe(
      'Cattleguard: 1 inside, 2 within 50 m · Water development: 1 inside, 2 within 50 m · Other: 1 inside, 1 within 50 m',
    )
    expect(featureMeasure(points.features[2], 50)).toBe('1 inside · 2 within 50 m')
  })

  it('lists pastures as areas, and says no barrier is mapped rather than that none exists', async () => {
    const evidence = await read(stub(ANSWERS).fetch)
    const pasture = evidence.layers.find((l) => l.layer === 'range-pasture')!
    expect(pasture.marginM).toBeUndefined()
    expect(pasture.features).toEqual([
      expect.objectContaining({
        id: 'Range unit 6216, pasture 02',
        name: 'Powerline',
        group: 'pasture',
        details: ['Ownership: provincial crown'],
      }),
    ])
    expect(pasture.features[0].sharePercent).toBeCloseTo(50, 0)
    const barriers = evidence.layers.find((l) => l.layer === 'natural-barriers')!
    expect(barriers).toMatchObject({ status: 'read', features: [], marginM: 50 })
    expect(layerSummary(barriers)).toBe('Nothing mapped inside the footprint or within 50 m of it')
  })

  it('says a line or point layer it could not read was not read', async () => {
    const evidence = await read(
      stub({ ...ANSWERS, [NATURAL_BARRIER_LAYER]: 500, [RANGE_IMPROVEMENT_POINT_LAYER]: 503 }).fetch,
    )
    const barriers = evidence.layers.find((l) => l.layer === 'natural-barriers')!
    expect(barriers).toMatchObject({ status: 'failed', features: [], marginM: 50 })
    expect(layerSummary(barriers)).toBe(
      `Not read: DataBC answered 500 for ${NATURAL_BARRIER_LAYER.replace('pub:', '')}.`,
    )
    const points = evidence.layers.find((l) => l.layer === 'range-improvement-points')!
    expect(layerSummary(points)).toMatch(/^Not read: DataBC answered 503/)
    expect(evidence.layers.find((l) => l.layer === 'range-improvement-lines')!.status).toBe('read')
  })

  it('reads barriers by their feature group', async () => {
    const barrier = feature(
      {
        OBJECTID: 60,
        BARRIER_FEATURE_GROUP_CODE: 'TOPOLOGICAL',
        BARRIER_FEATURE_CODE: 'steep slope',
        BARRIER_DEPTH: 15,
      },
      line([-122.768, 53.989], [-122.768, 53.996]),
    )
    const evidence = await read(stub({ ...ANSWERS, [NATURAL_BARRIER_LAYER]: [barrier] }).fetch)
    const barriers = evidence.layers.find((l) => l.layer === 'natural-barriers')!
    expect(barriers.features[0]).toMatchObject({
      id: 'OBJECTID 60',
      name: 'TOPOLOGICAL · steep slope',
      group: 'barrier-topological',
      details: ['Depth: 15 m'],
    })
    expect(barriers.features[0].insideLengthM!).toBeCloseTo(albersMetres([-122.768, 53.99], [-122.768, 53.995]), 0)
  })
})

describe('Mapped evidence on the grazing review', () => {
  async function withEvidence(): Promise<{ plan: Plan; evidence: MappedEvidence }> {
    const initial = samplePlan()
    const evidence = await read(stub(ANSWERS).fetch, initial)
    const { record } = rangeReviewFor(initial, initial.blocks[0])
    return { plan: saveRangeReview(initial, { ...record, mapped: evidence }), evidence }
  }

  it('round-trips through the plan file, and older files without it still open', async () => {
    const { plan, evidence } = await withEvidence()
    const reopened = parsePlan(JSON.parse(JSON.stringify(plan)))
    expect(rangeReviewFor(reopened, reopened.blocks[0]).record.mapped).toEqual(evidence)
    const older = JSON.parse(JSON.stringify(plan))
    delete older.rangeReviews[0].mapped
    expect(parsePlan(older).rangeReviews?.[0].mapped).toBeUndefined()
    const bad = JSON.parse(JSON.stringify(plan))
    bad.rangeReviews[0].mapped.layers[0].features[0].group = 'complies'
    expect(() => parsePlan(bad)).toThrow(/Range review 1 mapped evidence layer 1 feature 1 group/)
  })

  it('keeps lengths and counts through the plan file, opens a read made before them, and refuses two measures', async () => {
    const { plan, evidence } = await withEvidence()
    const reopened = parsePlan(JSON.parse(JSON.stringify(plan))).rangeReviews![0].mapped!
    const lines = reopened.layers.find((l) => l.layer === 'range-improvement-lines')!
    expect(lines.marginM).toBe(50)
    expect(lines.features[0].lengthM).toBe(
      evidence.layers.find((l) => l.layer === 'range-improvement-lines')!.features[0].lengthM,
    )
    expect(reopened.layers.find((l) => l.layer === 'range-improvement-points')!.counts).toHaveLength(3)

    // A read written before the range plan layers: three area layers, no margin, no lengths or counts.
    const older = JSON.parse(JSON.stringify(plan))
    older.rangeReviews[0].mapped.layers = older.rangeReviews[0].mapped.layers.slice(0, 3)
    const opened = parsePlan(older).rangeReviews![0].mapped!
    expect(opened.layers.map((l) => l.layer)).toEqual(['ada-sra', 'range-tenure', 'crown-grazing'])
    expect(opened.layers[0]).toEqual(evidence.layers[0])
    expect(opened.layers[0]).not.toHaveProperty('marginM', expect.anything())

    const both = JSON.parse(JSON.stringify(plan))
    const lineLayer = both.rangeReviews[0].mapped.layers.findIndex(
      (l: { layer: string }) => l.layer === 'range-improvement-lines',
    )
    both.rangeReviews[0].mapped.layers[lineLayer].features[0].overlapHa = 1
    expect(() => parsePlan(both)).toThrow(/needs one measure/)
    const longer = JSON.parse(JSON.stringify(plan))
    longer.rangeReviews[0].mapped.layers[lineLayer].features[0].insideLengthM = 1e6
    expect(() => parsePlan(longer)).toThrow(/insideLengthM cannot exceed lengthM/)
  })

  it('is out of date when the footprint changes, and kept when only the harvest year does', async () => {
    const { plan, evidence } = await withEvidence()
    const block = plan.blocks[0]
    const { record } = rangeReviewFor(plan, block)
    expect(mappedReadCurrent(plan, plan.rangeReviews![0])).toBe(true)

    const later = setEntry(plan, record.schedule, block.id, { year: (record.harvestYear ?? 2026) + 5 })
    expect(rangeReviewFor(later, block)).toMatchObject({ stale: true, record: { mapped: evidence } })

    const moved = {
      ...plan,
      blocks: [{ ...block, shapes: [{ ...block.shapes[0], geometry: box(-122.77, 53.99, -122.765, 53.995) }] }],
    }
    expect(rangeReviewFor(moved, moved.blocks[0]).record.mapped).toBeUndefined()
    expect(mappedReadCurrent(moved, moved.rangeReviews![0])).toBe(false)
  })

  it('prints the read as dated mapped candidates, never as an answer', async () => {
    const { plan } = await withEvidence()
    const failed = {
      ...plan,
      rangeReviews: plan.rangeReviews!.map((r) => ({
        ...r,
        mapped: {
          ...r.mapped!,
          layers: r.mapped!.layers.map((l) =>
            l.layer === 'crown-grazing'
              ? { ...l, status: 'failed' as const, message: 'DataBC answered 503.', features: [], covered: [] }
              : l,
          ),
        },
      })),
    }
    const result = analyzePlan(failed, { schedule: failed.reviewSchedule, year: failed.area.startYear })
    const record = assessmentRecord(failed, result, [pack], '2026-11-24')
    expect(record.rangeReviews[0]).toMatchObject({ mappedCurrent: true, mapped: { readOn: '2026-11-24' } })
    const summary = buildExport('summary', failed, result, [pack], '2026-11-24')
    expect(summary).toContain('Mapped candidates · read 2026-11-24')
    expect(summary).toContain('PRG_1_1 · Agricultural Development Areas - Prince George W')
    expect(summary).toContain('Not read: DataBC answered 503.')
    expect(summary).toContain('range developments and natural barriers inside it and within 50 m of its edge')
    expect(summary).toMatch(/OBJECTID 40 · FENCE · barb-wire \(Fence\)<\/td><td>\d+ m inside · [\d,]+ m within 50 m/)
    expect(summary).toContain('In all: Cattleguard: 1 inside, 2 within 50 m')
    expect(summary).toContain('<td colspan="3">Nothing mapped inside the footprint or within 50 m of it</td>')
  })
})
