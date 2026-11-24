import type { Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import raw from '../../../../packages/legal-rules/packs/bc-crown-grazing.json'
import { parsePack } from '../../../../packages/legal-rules/src/contract'
import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'
import { saveRangeReview, setEntry } from '../edits'
import { assessmentRecord, buildExport } from '../exports'
import { overlapsWith } from '../oldForest/oldForest'
import { parsePlan, samplePlan, type MappedEvidence, type Plan } from '../plan'
import { analyzePlan } from '../planAnalysis'
import type { Fetch } from '../wfsReads'
import { layerSummary, readMappedEvidence, CROWN_TENURE_LAYER, RANGE_TENURE_LAYER } from './grazingEvidence'
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
const feature = (properties: Record<string, unknown>, geometry: Polygon) => ({ type: 'Feature', properties, geometry })

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
    readOn: '2026-11-24',
  })
}

describe('Mapped grazing evidence', () => {
  it('reads each layer by the footprint’s own polygon and measures what overlaps', async () => {
    const { fetch, asked } = stub(ANSWERS)
    const evidence = await read(fetch)
    expect(asked).toHaveLength(3)
    for (const body of asked) {
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
  })
})
