import type { LineString, Point } from 'geojson'
import { describe, expect, it } from 'vitest'
import { designerCrossingProperties, type DesignerCrossing } from '@/lib/forestry/designerCrossings'
import { parsePack, releaseKey, type Pack } from '../../../../packages/legal-rules/src/contract'
import { pscisIds } from '../acquire/requests'
import {
  addCrossing,
  addCrossingCandidate,
  addCrossingSighting,
  applyCrossingOffer,
  removeBlock,
  removeCrossingRead,
  removeSchedule,
  saveCrossingRead,
  setShapeGeometry,
} from '../edits'
import { crossingOverlay } from '../oldForest/oldForest'
import { parsePlan, samplePlan, type Plan } from '../plan'
import type { Fetch } from '../wfsReads'
import { candidateState, factOffers, unreviewedCandidates } from './candidates'
import { builtAfter1995, datingBracket, FPPR_56_2_CUTOFF } from './dating'
import { designerRead } from './designerImport'
import { matchCrossing } from './key'
import { crossingMapFeatures } from './mapFeatures'
import {
  fissWatershedCode,
  identifier,
  readMappedCrossings,
  roadRank,
  tenureNamesRoad,
  tenureTokens,
  type Corridor,
  type CrossingOverlay,
} from './mappedRead'
import { foldSites, pairVerdict, sameBarrel, structureChange, type SiteRecord } from './pscisSites'
import { crossingFootprint, crossingsOf } from './record'

const library: Pack[] = Object.values(
  import.meta.glob('../../../../packages/legal-rules/packs/*.json', { eager: true, import: 'default' }),
).map(parsePack)
const TODAY = '2026-11-27'
const at = (plan: Plan) => {
  const block = plan.blocks[0]
  const { shape, signature } = crossingFootprint(plan, block, 'proposed')
  return { block: block.id, schedule: 'proposed', shape: shape.id, footprint: signature, geometry: shape.geometry }
}

// ---------------------------------------------------------------------------------------------
// The PSCIS site rule, on made-up records

/** A point `east` and `north` metres from a fixed place near Prince George. */
const near = (east: number, north = 0): [number, number] => [
  -122.765 + east / (111_320 * Math.cos((53.99 * Math.PI) / 180)),
  53.99 + north / 111_320,
]
const site = (id: string, east: number, day?: string, extra: Partial<SiteRecord> = {}): SiteRecord => ({
  id,
  point: near(east),
  ...(day ? { day } : {}),
  ...extra,
})

describe('the PSCIS site rule', () => {
  it('joins twins of one survey day within 5 m only, and lists a same-day pair farther apart', () => {
    const fold = foldSites([site('a', 0, '2023-10-10'), site('b', 4, '2023-10-10'), site('c', 13, '2023-10-10')])
    expect(fold.sites.map((s) => s.map((r) => r.id))).toEqual([['a', 'b'], ['c']])
    expect(fold.apart[0]).toMatchObject({ reason: 'same-day' })
  })

  it('joins different days within 15 m, and within 30 m on one stream with measures within 10 m', () => {
    expect(pairVerdict(site('a', 0, '2013-08-01'), site('b', 12, '2023-08-01'))).toEqual({ join: true, reason: 'near' })
    const onStream = { blueLineKey: 7, measureM: 500 }
    expect(
      pairVerdict(site('a', 0, '2013-08-01', onStream), site('b', 25, '2023-08-01', { blueLineKey: 7, measureM: 508 })),
    ).toEqual({ join: true, reason: 'same-stream' })
    expect(
      pairVerdict(site('a', 0, '2013-08-01', onStream), site('b', 25, '2023-08-01', { blueLineKey: 7, measureM: 530 })),
    ).toEqual({ join: false, reason: 'far' })
  })

  it('never joins two mapped streams, however near', () => {
    const fold = foldSites([
      site('a', 0, '2013-08-01', { blueLineKey: 1 }),
      site('b', 6, '2023-08-01', { blueLineKey: 2 }),
    ])
    expect(fold.sites).toHaveLength(2)
    expect(fold.apart[0]).toMatchObject({ reason: 'two-streams' })
  })

  it('refuses a chain that would put two records of one day into one site', () => {
    // a (day 1) – b (day 2) 10 m – c (day 1) 10 m on: c joins b by the pair rule, but a and c are 20 m apart on one day.
    const fold = foldSites([site('a', 0, '2013-08-01'), site('b', 10, '2023-08-01'), site('c', 20, '2013-08-01')])
    expect(fold.sites.map((s) => s.map((r) => r.id).sort())).toEqual([['a', 'b'], ['c']])
    expect(fold.apart.some((p) => p.reason === 'day-guard')).toBe(true)
  })

  it('joins two surveys of one barrel from its two ends, and never two distinct structures', () => {
    // 2013 and 2023 surveys of a 1.2 m pipe 17.5–20 m long, 19.7 m apart, neither on a mapped stream.
    const pipe = (sizeM: number, lengthM?: number) => ({ structure: { type: 'CBS', sizeM, lengthM } })
    expect(
      pairVerdict(site('a', 0, '2013-08-01', pipe(1.2, 20)), site('b', 19.7, '2023-08-01', pipe(1.2, 17.5))),
    ).toEqual({ join: true, reason: 'same-structure' })
    // 0.9 m and 0.85 m are one size within 15% and 5 cm.
    expect(
      pairVerdict(site('a', 0, '2013-08-01', pipe(0.9, 16)), site('b', 19.4, '2023-08-01', pipe(0.85, 18.5))).join,
    ).toBe(true)
    // Farther apart than the longer barrel and 2 m, of another size or type, with no length, on one
    // day, or on two mapped streams: apart.
    expect(
      pairVerdict(site('a', 0, '2013-08-01', pipe(1.2, 12)), site('b', 19.7, '2023-08-01', pipe(1.2, 15))).join,
    ).toBe(false)
    expect(
      pairVerdict(site('a', 0, '2013-08-01', pipe(1.2, 20)), site('b', 19.7, '2023-08-01', pipe(1.6, 20))).join,
    ).toBe(false)
    expect(
      pairVerdict(
        site('a', 0, '2013-08-01', pipe(1.2, 20)),
        site('b', 19.7, '2023-08-01', { structure: { type: 'OBS', sizeM: 1.2, lengthM: 20 } }),
      ).join,
    ).toBe(false)
    expect(pairVerdict(site('a', 0, '2013-08-01', pipe(1.2)), site('b', 19.7, '2023-08-01', pipe(1.2))).join).toBe(
      false,
    )
    expect(
      pairVerdict(site('a', 0, '2023-08-01', pipe(1.2, 20)), site('b', 19.7, '2023-08-01', pipe(1.2, 20))).join,
    ).toBe(false)
    expect(
      pairVerdict(
        site('a', 0, '2013-08-01', { ...pipe(1.2, 20), blueLineKey: 1 }),
        site('b', 19.7, '2023-08-01', { ...pipe(1.2, 20), blueLineKey: 2 }),
      ).join,
    ).toBe(false)
    // Never past 30 m, however long the barrel.
    expect(sameBarrel({ type: 'CBS', sizeM: 1.2, lengthM: 40 }, { type: 'CBS', sizeM: 1.2, lengthM: 40 }, 31)).toBe(
      true,
    )
    expect(
      pairVerdict(site('a', 0, '2013-08-01', pipe(1.2, 40)), site('b', 31, '2023-08-01', pipe(1.2, 40))).join,
    ).toBe(false)
    // A later survey that saw two pipes on one day keeps the earlier record off the farther one.
    const fold = foldSites([
      site('old', 0, '2013-08-01', pipe(1.2, 20)),
      site('near', 3, '2023-08-01', pipe(1.2, 20)),
      site('next', 19, '2023-08-01', pipe(1.2, 20)),
    ])
    expect(fold.sites.map((x) => x.map((r) => r.id))).toEqual([['old', 'near'], ['next']])
  })

  it('takes records sharing a crossing id as one site before the rule runs', () => {
    const fold = foldSites([site('x#1', 0, '2023-10-10'), site('x#2', 40, '2023-10-10')], (r) => r.id.split('#')[0])
    expect(fold.sites).toHaveLength(1)
  })

  it('reads successive structures as the same, a likely replacement, or an unexplained difference', () => {
    expect(
      structureChange({ day: '2013-08-01', type: 'CBS', sizeM: 0.6 }, { day: '2023-08-01', type: 'CBS', sizeM: 0.64 }),
    ).toBe('same')
    expect(
      structureChange({ day: '2013-08-01', type: 'CBS', sizeM: 0.6 }, { day: '2023-08-01', type: 'CBS', sizeM: 1.2 }),
    ).toBe('replaced')
    expect(
      structureChange({ day: '2013-08-01', type: 'CBS', sizeM: 0.6 }, { day: '2023-08-01', type: 'OBS', sizeM: 3 }),
    ).toBe('replaced')
    expect(
      structureChange({ day: '2023-08-01', type: 'CBS', sizeM: 0.6 }, { day: '2023-08-03', type: 'CBS', sizeM: 1.2 }),
    ).toBe('differs')
  })
})

describe('dating a crossing', () => {
  it('brackets the first sighting and offers a candidate for §56(2) only where the bracket settles it', () => {
    const early = [
      { source: 'air-photo' as const, date: '1987-08-14', state: 'absent' as const },
      { source: 'air-photo' as const, date: '1990-07-25', state: 'present' as const },
    ]
    expect(datingBracket(early).text).toMatch(/^First seen between 1987-08-14 and 1990-07-25/)
    expect(builtAfter1995(early).value).toBe(false)
    const late = [
      { source: 'sentinel-2' as const, date: '2021-09-02', state: 'absent' as const },
      { source: 'pscis' as const, date: '2023-10-10', state: 'present' as const },
    ]
    expect(builtAfter1995(late).value).toBe(true)
    // Seen only after the cut-off with nothing earlier: it may have been there before.
    const unsure = [{ source: 'pscis' as const, date: '2014-08-06', state: 'present' as const }]
    expect(builtAfter1995(unsure).value).toBeNull()
    expect(builtAfter1995(unsure).replaced).toMatch(/replaced since/)
    expect(FPPR_56_2_CUTOFF).toBe('1995-06-15')
  })
})

// ---------------------------------------------------------------------------------------------
// The road designer's register

function designerFile(points: { id: string; point: [number, number]; patch?: Partial<DesignerCrossing> }[]) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'alignment', name: 'Spur 3' },
        geometry: { type: 'LineString', coordinates: [] },
      },
      ...points.map(({ id, point, patch }) => {
        const c: DesignerCrossing = {
          id,
          roadId: 'road-1',
          road: 'Spur 3',
          chainageM: 240,
          station: '0+240.0',
          point,
          source: 'both',
          stream: 'Tributary',
          structure: {
            kind: 'culvert',
            label: 'Culvert 1 · Ø 0.8 m × 12 m',
            diameterM: 0.8,
            lengthM: 12,
            capacity: 'adequate',
            outstanding: [],
          },
          riparianClass: 'S4',
          classStatus: 'reviewed',
          ...patch,
        }
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: point },
          properties: { kind: 'crossing-review', ...designerCrossingProperties(c) },
        }
      }),
    ],
  })
}

describe('crossings from the road designer', () => {
  it('offers each register row near the block, inside it on its own road, and leaves out the far ones', () => {
    const plan = samplePlan()
    const text = designerFile([
      { id: 'mapped:x1', point: [-122.765, 53.9925] },
      {
        id: 'mapped:x2',
        point: [-122.75, 53.9925],
        patch: {
          structure: { kind: 'none', label: 'None', capacity: 'not-applicable', outstanding: ['no structure'] },
        },
      },
      { id: 'mapped:far', point: [-121.5, 53.5] },
    ])
    const { read, beyond } = designerRead(text, 'spur3.geojson', at(plan), TODAY)
    expect(beyond).toBe(1)
    expect(read.candidates.map((c) => [c.id, c.role, c.distanceM === 0])).toEqual([
      ['designer:road-1:mapped:x1', 'own', true],
      ['designer:road-1:mapped:x2', 'unknown', false],
    ])
    expect(read.candidates[0].structure).toEqual({ kind: 'culvert', spanOrDiameterM: 0.8, lengthM: 12 })
    expect(read.candidates[0].evidence[0].summary).toContain('Riparian class S4 (reviewed)')
  })

  it('adds a row only on the click, once, as origin designer with the sizing as evidence and offers', () => {
    let plan = samplePlan()
    const { read } = designerRead(
      designerFile([{ id: 'mapped:x1', point: [-122.765, 53.9925] }]),
      'spur3.geojson',
      at(plan),
      TODAY,
    )
    plan = saveCrossingRead(plan, read)
    expect(crossingsOf(plan, 'block-1', 'proposed')).toHaveLength(0)
    expect(unreviewedCandidates(plan, 'block-1', 'proposed')).toHaveLength(1)
    const added = addCrossingCandidate(plan, 'block-1', 'proposed', 'designer', read.candidates[0].id)
    plan = added.plan
    const [record] = crossingsOf(plan, 'block-1', 'proposed')
    expect(record).toMatchObject({
      origin: 'designer',
      role: 'own',
      structure: { kind: 'culvert', spanOrDiameterM: 0.8 },
    })
    expect(unreviewedCandidates(plan, 'block-1', 'proposed')).toHaveLength(0)
    // Adding again puts nothing new on the plan: the record holds the row's alias.
    const again = addCrossingCandidate(plan, 'block-1', 'proposed', 'designer', read.candidates[0].id)
    expect(again.merged).toBe(true)
    expect(again.plan.crossings).toHaveLength(1)
    const offers = factOffers(record)
    expect(offers.map((o) => [o.fact, o.value])).toEqual([
      ['stream-changes', true],
      ['structure', 'Culvert'],
      ['culvert-diameter', 800],
    ])
    // Used, an offer is the crossing's answer with its basis as the evidence.
    const used = applyCrossingOffer(plan, library, record.key, offers[2])
    if ('error' in used) throw Error(used.error)
    const water = library.find((p) => releaseKey(p) === 'bc.water-crossings@2.0.0')!
    const fact = used.plan.crossings![0].review.sets[releaseKey(water)].facts.find((f) => f.id === 'culvert-diameter')
    expect(fact?.value).toBe(800)
    expect(fact?.evidence).toMatch(/^Offered by the crossing’s evidence and used by the reviewer/)
    expect(
      applyCrossingOffer(plan, library, record.key, { pack: 'bc.nothing', fact: 'x', value: true, basis: '' }),
    ).toHaveProperty('error')
  })

  it('refuses a read for an earlier shape, and keeps a read no longer current out of the count', () => {
    let plan = samplePlan()
    const { read } = designerRead(
      designerFile([{ id: 'mapped:x1', point: [-122.765, 53.9925] }]),
      'f.geojson',
      at(plan),
      TODAY,
    )
    plan = saveCrossingRead(plan, read)
    const block = plan.blocks[0]
    plan = setShapeGeometry(plan, block.id, block.shapes[0].id, {
      type: 'Polygon',
      coordinates: [
        [
          [-122.77, 53.99],
          [-122.76, 53.99],
          [-122.76, 53.996],
          [-122.77, 53.996],
          [-122.77, 53.99],
        ],
      ],
    })
    expect(unreviewedCandidates(plan, 'block-1', 'proposed')).toHaveLength(0)
    expect(saveCrossingRead(plan, read)).toBe(plan)
    expect(addCrossingCandidate(plan, 'block-1', 'proposed', 'designer', read.candidates[0].id).key).toBe('')
  })
})

// ---------------------------------------------------------------------------------------------
// The mapped read, against a stand-in for DataBC

const line = (coordinates: number[][]): LineString => ({ type: 'LineString', coordinates })
const pt = (c: [number, number]): Point => ({ type: 'Point', coordinates: c })
const feat = (properties: Record<string, unknown>, geometry: LineString | Point) => ({
  type: 'Feature',
  properties,
  geometry,
})
const CODE = '180008567' + '0'.repeat(36)

/** One road through the block east-west, two streams across it, PSCIS on one and a same-day pair beside the road. */
const ANSWERS: Record<string, unknown[]> = {
  'pub:WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW': [
    feat(
      {
        OBJECTID: 1,
        FOREST_FILE_ID: 'R12345',
        ROAD_SECTION_ID: '01',
        AWARD_DATE: '1995-03-01Z',
        CLIENT_NAME: 'A Company Ltd',
        ROAD_SECTION_NAME: 'A Company Main',
      },
      line([
        [-122.775, 53.9925],
        [-122.756, 53.9925],
      ]),
    ),
  ],
  'pub:WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP': [
    feat(
      {
        OBJECTID: 1,
        BLUE_LINE_KEY: 356000001,
        DOWNSTREAM_ROUTE_MEASURE: 1000,
        WATERSHED_CODE_50K: CODE,
        STREAM_ORDER: 1,
        GNIS_NAME: null,
      },
      line([
        [-122.765, 53.988, 700],
        [-122.765, 53.997, 720],
      ]),
    ),
    feat(
      {
        OBJECTID: 2,
        BLUE_LINE_KEY: 356000002,
        DOWNSTREAM_ROUTE_MEASURE: 0,
        WATERSHED_CODE_50K: null,
        STREAM_ORDER: 1,
        GNIS_NAME: 'Test Creek',
      },
      line([
        [-122.7585, 53.988, 700],
        [-122.7585, 53.997, 700],
      ]),
    ),
  ],
  'pub:WHSE_FISH.PSCIS_ASSESSMENT_SVW': [
    feat(
      {
        OBJECTID: 1,
        STREAM_CROSSING_ID: 111,
        ASSESSMENT_DATE: '2014-08-06Z',
        CROSSING_TYPE_CODE: 'CBS',
        CROSSING_SUBTYPE_CODE: 'ROUND',
        DIAMETER_OR_SPAN: 0.6,
        BARRIER_RESULT_CODE: 'BARRIER',
        FINAL_SCORE: 21,
        RESPONSIBLE_PARTY_NAME: 'A Person',
        CONSULTANT_NAME: 'A Consultancy',
        ROAD_TENURE: 'A Company Ltd R12345',
        ROAD_NAME: 'A Company Main',
      },
      pt([-122.76505, 53.99252]),
    ),
    feat(
      {
        OBJECTID: 2,
        STREAM_CROSSING_ID: 222,
        ASSESSMENT_DATE: '2023-10-10Z',
        CROSSING_TYPE_CODE: 'CBS',
        DIAMETER_OR_SPAN: 0.5,
      },
      pt([-122.77, 53.99252]),
    ),
    feat(
      {
        OBJECTID: 3,
        STREAM_CROSSING_ID: 333,
        ASSESSMENT_DATE: '2023-10-10Z',
        CROSSING_TYPE_CODE: 'CBS',
        DIAMETER_OR_SPAN: 0.6,
      },
      pt([-122.76988, 53.99252]),
    ),
  ],
  'pub:WHSE_WATER_MANAGEMENT.WLS_WATER_APPROVALS_SVW': [
    feat(
      {
        OBJECTID: 1,
        APPROVAL_TYPE: 'N-CIAS',
        APPROVAL_FILE_NUMBER: '9000001',
        APPROVAL_ISSUANCE_DATE: '2019-06-01Z',
        WORKS_DESCRIPTION: 'Works by A Company',
      },
      pt([-122.7642, 53.9925]),
    ),
  ],
  'pub:WHSE_BASEMAPPING.TRIM_TRANSPORTATION_LINES': [
    feat(
      {
        OBJECTID: 9,
        FCODE: 'DA25050180',
        ASRC_YEAR: 1990,
        ASRC_MNTH: 7,
        ASRC_DAY: 25,
        ADMIT_YEAR: 1996,
        ADMIT_MNTH: 8,
        ADMIT_DAY: 25,
      },
      line([
        [-122.7655, 53.9925],
        [-122.7645, 53.9925],
      ]),
    ),
  ],
  'pub:WHSE_FISH.FISS_FISH_OBSRVTN_PNT_SP': [
    feat(
      {
        OBJECTID: 1,
        SPECIES_CODE: 'RB',
        SPECIES_NAME: 'Rainbow Trout',
        OBSERVATION_DATE: '2009-07-01Z',
        NEW_WATERSHED_CODE: '180-008567-00000-00000-0000-0000-000-000-000-000-000-000',
        AGENCY_NAME: 'An Agency',
      },
      pt([-122.765, 53.99]),
    ),
  ],
}

function fakeDataBc(fail: string[] = [], answers: Record<string, unknown[]> = ANSWERS) {
  const asked: URLSearchParams[] = []
  const fetch: Fetch = async (_url, init) => {
    const body = new URLSearchParams(init?.body ?? '')
    asked.push(body)
    const layer = body.get('typeNames') ?? ''
    if (fail.includes(layer)) return { ok: false, status: 500, json: async () => ({}) }
    const all = answers[layer] ?? []
    const start = Number(body.get('startIndex') ?? 0)
    return {
      ok: true,
      status: 200,
      json: async () => ({ type: 'FeatureCollection', features: all.slice(start, start + 1000) }),
    }
  }
  return { fetch, asked }
}

async function mappedRead(
  plan: Plan,
  fail: string[] = [],
  answers: Record<string, unknown[]> = ANSWERS,
  corridor: Corridor = { by: 'distance', metres: 500 },
) {
  const { fetch, asked } = fakeDataBc(fail, answers)
  const where = at(plan)
  const read = await readMappedCrossings({
    footprint: where.geometry,
    block: where.block,
    schedule: where.schedule,
    shape: where.shape,
    signature: where.footprint,
    corridor,
    fetch,
    overlay: crossingOverlay as CrossingOverlay,
    readOn: TODAY,
  })
  return { read, asked }
}

describe('mapped crossings', () => {
  it('finds each road × stream crossing with its route measure, gradient, PSCIS site and evidence', async () => {
    const { read } = await mappedRead(samplePlan())
    const mapped = read.candidates.filter((c) => c.origin === 'mapped')
    expect(mapped.map((c) => c.stream?.blueLineKey)).toEqual([356000001, 356000002])
    const [first, second] = mapped
    expect(first.distanceM).toBe(0)
    expect(first.role).toBe('own')
    expect(second.distanceM).toBeGreaterThan(100)
    expect(first.road).toMatchObject({ file: 'R12345', section: '01' })
    // About 500 m up a line that starts at measure 1000, rising 20 m over 1 km.
    expect(first.stream!.measureM!).toBeGreaterThan(1490)
    expect(first.stream!.measureM!).toBeLessThan(1510)
    const stream = first.evidence.find((e) => e.kind === 'stream')!
    expect(stream.values?.gradientPercent).toBeCloseTo(2, 0)
    // The PSCIS site within 50 m on the same stream joins it, with its structure and survey day.
    expect(first.aliases.map((a) => `${a.source}:${a.id}`)).toEqual([
      expect.stringMatching(/^mapped:R12345\/01×356000001@/),
      'pscis:111',
    ])
    expect(first.structure).toMatchObject({ kind: 'culvert', spanOrDiameterM: 0.6 })
    const pscis = first.evidence.find((e) => e.kind === 'pscis-assessment')!
    expect(pscis.summary).toContain('not a finding under FPPR §56')
    expect(pscis.values?.road_tenure_ids).toBe('R12345')
    expect(first.sightings.map((s) => [s.source, s.date])).toEqual([
      ['trim', '1990-07-25'],
      ['pscis', '2014-08-06'],
    ])
    expect(first.evidence.find((e) => e.kind === 'water-approval')?.summary).toMatch(/does not say whose works/)
    expect(first.evidence.find((e) => e.kind === 'fish-observation')?.values?.listed).toBe('RB')
    // Fish observations are asked for by the stream's 50k code in FISS's dashed form.
    expect(fissWatershedCode(CODE)).toBe('180-008567-00000-00000-0000-0000-000-000-000-000-000-000')
  })

  it('offers PSCIS sites with no mapped crossing as one candidate the reviewer can split', async () => {
    let plan = samplePlan()
    const { read } = await mappedRead(plan)
    const loose = read.candidates.find((c) => c.origin === 'pscis')!
    expect(loose.sites?.map((s) => s.label)).toEqual(['PSCIS 222', 'PSCIS 333'])
    expect(loose.note).toMatch(/kept apart/)
    plan = saveCrossingRead(plan, read)
    plan = addCrossingCandidate(plan, 'block-1', 'proposed', 'mapped', loose.id, { site: 0, apart: true }).plan
    plan = addCrossingCandidate(plan, 'block-1', 'proposed', 'mapped', loose.id, { site: 1, apart: true }).plan
    const records = crossingsOf(plan, 'block-1', 'proposed')
    expect(records.map((r) => r.aliases?.map((a) => a.id))).toEqual([['222'], ['333']])
    // Each letter quotes its own site's id and nothing else.
    expect(records.map(pscisIds)).toEqual([['222'], ['333']])
  })

  it('cuts every record to its fields and never asks for a name', async () => {
    const { read, asked } = await mappedRead(samplePlan())
    const forbidden =
      /CLIENT|RESPONSIBLE_PARTY|CONSULTANT|CREW|AGENCY|ROAD_NAME|ROAD_SECTION_NAME|ROAD_SECT_NAME|CROSSING_NAME|WORKS_DESCRIPTION|MAP_LABEL|COMMENT|SOURCE_REF/
    for (const body of asked) expect(body.get('propertyName') ?? '').not.toMatch(forbidden)
    const text = JSON.stringify(read)
    for (const name of ['A Company', 'A Person', 'A Consultancy', 'An Agency']) expect(text).not.toContain(name)
    expect(tenureTokens('A Company Ltd / FSR 9311, R08765 CP 2')).toEqual(['9311', 'R08765'])
  })

  it('records a layer it could not read as not read, never as none', async () => {
    const { read } = await mappedRead(samplePlan(), ['pub:WHSE_WATER_MANAGEMENT.WLS_WATER_APPROVALS_SVW'])
    expect(read.layers.find((l) => l.id === 'approvals')).toMatchObject({ status: 'failed', count: 0 })
    expect(read.candidates.length).toBeGreaterThan(0)
  })

  it('places a PSCIS read on the crossing it belongs to: by alias, else by place, never across two streams', async () => {
    let plan = samplePlan()
    const { read } = await mappedRead(plan)
    plan = saveCrossingRead(plan, read)
    const first = read.candidates.find((c) => c.origin === 'mapped')!
    plan = addCrossingCandidate(plan, 'block-1', 'proposed', 'mapped', first.id).plan
    const [record] = crossingsOf(plan, 'block-1', 'proposed')
    expect(candidateState([record], first).state).toBe('added')
    // A later read of the same site by its PSCIS id alone lands on the record.
    expect(matchCrossing([record], { aliases: [{ source: 'pscis', id: '111', seenOn: '2024-01-01' }] })?.by).toBe(
      'alias',
    )
    // A read 10 m off on another mapped stream does not.
    const off: [number, number] = [record.at!.point![0] + 0.00014, record.at!.point![1]]
    expect(matchCrossing([record], { point: off, blueLineKey: 999, aliases: [] })).toBeNull()
    expect(matchCrossing([record], { point: off, aliases: [] })?.by).toBe('place')
    const offers = factOffers(record).map((o) => [o.fact, o.value])
    expect(offers).toEqual(
      expect.arrayContaining([
        ['stream-changes', true],
        ['structure', 'Culvert'],
        ['culvert-diameter', 600],
        ['listed-species', true],
        ['built-after-1995', false],
      ]),
    )
    expect(offers.find(([f]) => f === 'stream-gradient')?.[1]).toBeCloseTo(2, 0)
  })
})

// ---------------------------------------------------------------------------------------------
// What the back-test of 27 November 2026 found, on made-up roads and records

const SECTIONS = 'pub:WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW'
const SEGMENTS = 'pub:WHSE_FOREST_TENURE.FTEN_ROAD_SEGMENT_LINES_SVW'
const PSCIS = 'pub:WHSE_FISH.PSCIS_ASSESSMENT_SVW'
const STRUCTURES = 'pub:WHSE_FOREST_TENURE.RRI_BRIDGES_MAJOR_CULVERTS_SP'
/** `[lon, lat]` moved `east` and `north` metres. */
const moved = ([lon, lat]: [number, number], east: number, north = 0): [number, number] => [
  lon + east / (111_320 * Math.cos((lat * Math.PI) / 180)),
  lat + north / 111_320,
]
/** Where the test road crosses the first stream. */
const CROSSING: [number, number] = [-122.765, 53.9925]
const ROAD = line([
  [-122.775, 53.9925],
  [-122.756, 53.9925],
])
const section = (
  OBJECTID: number,
  FOREST_FILE_ID: string,
  ROAD_SECTION_ID: string,
  extra: Record<string, unknown> = {},
) => feat({ OBJECTID, FOREST_FILE_ID, ROAD_SECTION_ID, ...extra }, ROAD)
const assessment = (OBJECTID: number, id: number, day: string, at: [number, number], extra: Record<string, unknown>) =>
  feat({ OBJECTID, STREAM_CROSSING_ID: id, ASSESSMENT_DATE: `${day}Z`, CROSSING_TYPE_CODE: 'CBS', ...extra }, pt(at))

describe('mapped crossings, as the back-test found them', () => {
  it('asks for a tree farm licence mark with its slash, and makes no read of a mark it cannot ask for', async () => {
    expect(identifier(' 53/353 ')).toBe('53/353')
    expect(identifier('53/0r1')).toBe('53/0R1')
    expect(identifier('R09333')).toBe('R09333')
    for (const bad of ['53//1', '/53', 'A B', "X' OR 1=1", '']) expect(identifier(bad)).toBeNull()
    const { read, asked } = await mappedRead(samplePlan(), [], ANSWERS, {
      by: 'timber-mark',
      mark: '53/353',
      metres: 2000,
    })
    expect(asked.find((b) => b.get('typeNames') === SEGMENTS)?.get('CQL_FILTER')).toContain("TIMBER_MARK = '53/353'")
    expect(read.layers.find((l) => l.id === 'segments')?.status).toBe('read')
    // A mark no read can ask for is Not read, with nothing else asked: never a thrown read, never none.
    const bad = await mappedRead(samplePlan(), [], ANSWERS, { by: 'timber-mark', mark: '53 353', metres: 2000 })
    expect(bad.asked).toHaveLength(0)
    expect(bad.read.layers.find((l) => l.id === 'segments')).toMatchObject({ status: 'failed' })
    expect(bad.read.notes?.[0]).toMatch(/^Not read: no road was asked for/)
    expect(bad.read.candidates).toEqual([])
  })

  it('says so when a corridor by mark holds no road, and lists only the PSCIS sites on its roads', async () => {
    const answers = { ...ANSWERS, [SEGMENTS]: [] }
    const { read } = await mappedRead(samplePlan(), [], answers, { by: 'timber-mark', mark: 'EJ30C6', metres: 2000 })
    expect(read.layers.find((l) => l.id === 'segments')).toMatchObject({ status: 'read', count: 0 })
    expect(read.notes?.[0]).toMatch(/No road segment within 2,000 m of the block carries timber mark EJ30C6/)
    // The three PSCIS sites lie on a road this corridor does not hold: counted, not listed.
    expect(read.candidates).toEqual([])
    expect(read.notes?.[1]).toMatch(
      /^3 PSCIS sites within 2,000 m of the block lie more than 50 m from the corridor's roads/,
    )
    // By road file, the sites on the file's road, or naming it, are listed with that road.
    const byFile = await mappedRead(samplePlan(), [], ANSWERS, { by: 'file', file: 'R12345', metres: 2000 })
    expect(byFile.read.notes).toBeUndefined()
    expect(byFile.read.candidates.find((c) => c.origin === 'pscis')?.road).toEqual({ file: 'R12345', section: '01' })
    expect(tenureNamesRoad('550601', '5506', '01')).toBe(true)
    expect(tenureNamesRoad('5506-01', '5506', '01')).toBe(true)
    expect(tenureNamesRoad('5506', '5506', '24')).toBe(true)
    expect(tenureNamesRoad('550624', '5506', '01')).toBe(false)
  })

  it('labels a crossing by the active road on it, never a pending or retired permit found first', async () => {
    const answers = {
      ...ANSWERS,
      [SECTIONS]: [
        section(1, 'R23886', '99', { LIFE_CYCLE_STATUS_CODE: 'PENDING' }),
        section(2, 'R23280', '99', { LIFE_CYCLE_STATUS_CODE: 'RETIRED', RETIREMENT_DATE: '2019-01-01Z' }),
        section(3, '5506', '24', { LIFE_CYCLE_STATUS_CODE: 'ACTIVE' }),
      ],
    }
    const { read } = await mappedRead(samplePlan(), [], answers)
    const first = read.candidates.find((c) => c.origin === 'mapped')!
    expect(first.label).toMatch(/× road 5506\/24$/)
    expect(first.road).toMatchObject({ file: '5506', section: '24' })
    expect(first.aliases[0].id).toMatch(/^5506\/24×356000001@/)
    const road = first.evidence.find((e) => e.kind === 'road')!
    expect(road.summary).toMatch(/^Road 5506\/24 \(active\)/)
    expect(road.summary).toContain('Also mapped on this crossing: R23886/99 (pending), R23280/99 (retired)')
    expect(road.summary).not.toContain('retired in the record')
    expect(roadRank({ LIFE_CYCLE_STATUS_CODE: 'ACTIVE' })).toBeLessThan(roadRank({}))
    expect(roadRank({})).toBeLessThan(roadRank({ LIFE_CYCLE_STATUS_CODE: 'PENDING' }))
    expect(roadRank({ LIFE_CYCLE_STATUS_CODE: 'ACTIVE', RETIREMENT_DATE: '2020-01-01Z' })).toBe(3)
    // With only a retired road there, it says so.
    const retired = await mappedRead(samplePlan(), [], {
      ...ANSWERS,
      [SECTIONS]: [section(1, 'R23280', '99', { LIFE_CYCLE_STATUS_CODE: 'RETIRED' })],
    })
    const onRetired = retired.read.candidates.find((c) => c.origin === 'mapped')!
    expect(onRetired.evidence.find((e) => e.kind === 'road')!.summary).toContain('retired in the record')
  })

  it('takes two surveys of one barrel as one site, and keeps two distinct pipes apart', async () => {
    // A 2013 survey 3 m off the crossing and a 2023 survey of the same 18 m pipe 19 m north of it.
    const pipe = (id: number, day: string, at: [number, number], size: number, length: number) =>
      assessment(id, id, day, at, { DIAMETER_OR_SPAN: size, LENGTH_OR_WIDTH: length, ROAD_TENURE: 'R12345' })
    const ends = (length: number) => ({
      ...ANSWERS,
      [PSCIS]: [
        pipe(1, '2013-08-06', moved(CROSSING, -3), 0.9, 16),
        pipe(2, '2023-08-06', moved(CROSSING, -3, 19), 0.85, length),
      ],
    })
    const one = (await mappedRead(samplePlan(), [], ends(18.5))).read
    const crossing = one.candidates.find((c) => c.origin === 'mapped' && c.stream?.blueLineKey === 356000001)!
    expect(crossing.aliases.filter((a) => a.source === 'pscis').map((a) => a.id)).toEqual(['1', '2'])
    expect(one.candidates.filter((c) => c.origin === 'pscis')).toEqual([])
    // A pipe too short to reach between them is another structure: listed apart.
    const two = (await mappedRead(samplePlan(), [], ends(8))).read
    expect(two.candidates.filter((c) => c.origin === 'pscis').map((c) => c.id)).toEqual(['pscis:2'])
  })

  it('joins a ministry structure by the road file and section it names, out to 150 m, and only to one crossing', async () => {
    const structure = (at: [number, number], file: string) =>
      feat({ OBJECTID: 1, CROSSING_SITE_ID: 'G5-209', FOREST_FILE_ID: file, ROAD_SECTION_ID: '01' }, pt(at))
    const at119 = moved(CROSSING, 0, 119)
    const named = (await mappedRead(samplePlan(), [], { ...ANSWERS, [STRUCTURES]: [structure(at119, 'R12345')] })).read
    const crossing = named.candidates.find((c) => c.stream?.blueLineKey === 356000001)!
    expect(crossing.aliases.some((a) => a.source === 'mof-structure' && a.id === 'G5-209')).toBe(true)
    expect(crossing.evidence.find((e) => e.kind === 'mof-structure')).toMatchObject({ distanceM: 119 })
    expect(crossing.evidence.find((e) => e.kind === 'mof-structure')!.summary).toMatch(
      /joined because its record names/,
    )
    // Another road's structure that far off is not this crossing's.
    const other = (await mappedRead(samplePlan(), [], { ...ANSWERS, [STRUCTURES]: [structure(at119, 'R99999')] })).read
    expect(other.candidates.some((c) => c.aliases.some((a) => a.source === 'mof-structure'))).toBe(false)
    // Halfway between two crossings on its road, it is joined to neither and the read says so.
    const twoStreams = {
      ...ANSWERS,
      'pub:WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP': [
        ...ANSWERS['pub:WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP'],
        feat(
          { OBJECTID: 3, BLUE_LINE_KEY: 356000003, STREAM_ORDER: 1 },
          line([moved(CROSSING, 200, -300), moved(CROSSING, 200, 300)]),
        ),
      ],
      [STRUCTURES]: [structure(moved(CROSSING, 100, 60), 'R12345')],
    }
    const between = (await mappedRead(samplePlan(), [], twoStreams)).read
    expect(between.candidates.some((c) => c.aliases.some((a) => a.source === 'mof-structure'))).toBe(false)
    expect(between.notes?.join(' ')).toMatch(/Ministry structure G5-209 names road R12345\/01 .* joined to none/)
  })
})

// ---------------------------------------------------------------------------------------------
// Keeping reads with the plan

describe('crossing reads in the plan file', () => {
  it('keep reads, aliases, sightings and evidence values through a save, and drop them with their block or schedule', async () => {
    let plan = samplePlan()
    const { read } = await mappedRead(plan)
    plan = saveCrossingRead(plan, read)
    plan = addCrossingCandidate(
      plan,
      'block-1',
      'proposed',
      'mapped',
      read.candidates.find((c) => c.origin === 'mapped')!.id,
    ).plan
    const key = plan.crossings![0].key
    plan = addCrossingSighting(plan, key, {
      source: 'air-photo',
      date: '1987-08-14',
      state: 'absent',
      reference: '15BCB87001 No. 12',
    })
    const reopened = parsePlan(JSON.parse(JSON.stringify(plan)))
    expect(reopened.crossingReads).toEqual(plan.crossingReads)
    expect(reopened.crossings).toEqual(plan.crossings)
    expect(datingBracket(reopened.crossings![0].sightings!).text).toMatch(
      /^First seen between 1987-08-14 and 1990-07-25/,
    )
    // A read that does not parse is left out; the rest of the plan opens.
    const broken = parsePlan({
      ...JSON.parse(JSON.stringify(plan)),
      crossingReads: [{ source: 'mapped' }, ...plan.crossingReads!],
    })
    expect(broken.crossingReads).toHaveLength(1)
    expect(removeBlock(plan, 'block-1').crossingReads).toEqual([])
    expect(removeSchedule(plan, 'proposed').crossingReads ?? []).toEqual([])
    expect(removeCrossingRead(plan, 'block-1', 'proposed', 'mapped').crossingReads).toEqual([])
    // A plan without reads stays without the key.
    expect('crossingReads' in parsePlan(JSON.parse(JSON.stringify(samplePlan())))).toBe(false)
  })

  it('draws crossings by standing and reads not added as candidates on the plan map', async () => {
    let plan = samplePlan()
    const { read } = await mappedRead(plan)
    plan = saveCrossingRead(plan, read)
    plan = addCrossingCandidate(
      plan,
      'block-1',
      'proposed',
      'mapped',
      read.candidates.find((c) => c.origin === 'mapped')!.id,
    ).plan
    plan = addCrossing(plan, 'block-1', 'proposed', 'No place').plan
    const map = crossingMapFeatures(plan, 'proposed', library)
    const states = map.features.map((f) => f.properties.state)
    expect(states[0]).toBe('open')
    expect(states.filter((s) => s === 'candidate')).toHaveLength(read.candidates.length - 1)
    // A crossing with no place is not drawn.
    expect(map.features.some((f) => f.properties.label === 'No place')).toBe(false)
  })
})
