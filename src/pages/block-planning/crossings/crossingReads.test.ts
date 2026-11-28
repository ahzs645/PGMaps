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
import { fissWatershedCode, readMappedCrossings, tenureTokens, type CrossingOverlay } from './mappedRead'
import { foldSites, pairVerdict, structureChange, type SiteRecord } from './pscisSites'
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

function fakeDataBc(fail: string[] = []) {
  const asked: URLSearchParams[] = []
  const fetch: Fetch = async (_url, init) => {
    const body = new URLSearchParams(init?.body ?? '')
    asked.push(body)
    const layer = body.get('typeNames') ?? ''
    if (fail.includes(layer)) return { ok: false, status: 500, json: async () => ({}) }
    const all = ANSWERS[layer] ?? []
    const start = Number(body.get('startIndex') ?? 0)
    return {
      ok: true,
      status: 200,
      json: async () => ({ type: 'FeatureCollection', features: all.slice(start, start + 1000) }),
    }
  }
  return { fetch, asked }
}

async function mappedRead(plan: Plan, fail: string[] = []) {
  const { fetch, asked } = fakeDataBc(fail)
  const where = at(plan)
  const read = await readMappedCrossings({
    footprint: where.geometry,
    block: where.block,
    schedule: where.schedule,
    shape: where.shape,
    signature: where.footprint,
    corridor: { by: 'distance', metres: 500 },
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
