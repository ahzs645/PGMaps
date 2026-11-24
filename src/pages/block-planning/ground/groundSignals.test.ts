/**
 * The second batch of "On this ground": the line and point layers, the area-based tenures, the
 * notations, applications, recreation features, visual objectives, critical habitat and the Robson
 * Valley order, and the precedent's public signals of an exception (SPEX openings, standards units
 * with no regeneration obligation or under a variation, exempt cut blocks, ALR applications).
 * Synthetic geometry and a stubbed DataBC.
 */
import type { Geometry, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import { GROUND_CATALOGUE, groundLayer } from '@/lib/legal/groundInstruments'
import { assessmentRecord, buildExport } from '../exports'
import { groundOverlay } from '../oldForest/oldForest'
import { parsePlan, samplePlan } from '../plan'
import { analyzePlan } from '../planAnalysis'
import type { Fetch } from '../wfsReads'
import { readGroundInstruments } from './groundRead'
import {
  ALR_APPLICATION_LAYER,
  ALR_NOTICE_LAYER,
  CUT_BLOCK_LAYER,
  OPENING_LAYER,
  precedentSummary,
  STANDARDS_UNIT_LAYER,
} from './precedent'
import { groundFootprint, nearText, parseGroundRead, saveGroundRead, type GroundRead } from './record'
import { documentRequests } from './requests'

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
const feature = (properties: Record<string, unknown>, geometry: Geometry | null) => ({
  type: 'Feature',
  properties,
  geometry,
})

// The sample's block: -122.7701 to -122.7611, 53.99 to 53.995.
const WIDE = box(-122.8, 53.98, -122.7, 54.01)
const WEST = box(-122.78, 53.98, -122.7656, 54.0)
const FAR = box(-123.5, 54.5, -123.49, 54.51)
const IN_WEST = box(-122.778, 53.982, -122.776, 53.984)
// About 65.4 km a degree of longitude at 53.99°: 50 m is 0.000764°.
const M_PER_DEG_LON = 111_320 * Math.cos((53.9925 * Math.PI) / 180)

type Answer = Record<string, unknown>[] | number

const LAYERS = Object.fromEntries(GROUND_CATALOGUE.layers.map((l) => [l.id, l.typeName]))

const ANSWERS: Record<string, Answer> = {
  [LAYERS.tantalis]: [
    feature(
      {
        INTRID_SID: 40,
        CROWN_LANDS_FILE: '7410144',
        TENURE_STAGE: 'TENURE',
        TENURE_TYPE: 'RESERVE/NOTATION',
        TENURE_SUBTYPE: 'NOTATION OF INTEREST',
        TENURE_PURPOSE: 'FIRST NATIONS',
        INTEREST_HOLDER: 'A private person',
      },
      WIDE,
    ),
    feature({ INTRID_SID: 41, CROWN_LANDS_FILE: '7400041', TENURE_STAGE: 'APPLICATION', TENURE_TYPE: 'LICENCE' }, WEST),
  ],
  [LAYERS.alr]: [feature({ ALR_POLY_ID: 9, STATUS: 'ALR' }, WIDE)],
  [LAYERS['legal-objectives']]: [
    feature(
      {
        LEGAL_FEAT_ID: 30,
        LEGAL_FEAT_PROVID: 'HW_ADA_1',
        STRGC_LAND_RSRCE_PLAN_NAME: 'Agricultural Development Areas within 1 Forest District - Extent',
        LEGAL_FEAT_OBJECTIVE: 'Agricultural Development Areas - Headwaters FD',
        LEGALIZATION_DATE: '2006-11-21Z',
      },
      WEST,
    ),
  ],
  [LAYERS['mineral-tenure']]: [
    feature(
      {
        TENURE_NUMBER_ID: 1100001,
        TENURE_TYPE_DESCRIPTION: 'Mineral',
        TENURE_SUB_TYPE_DESCRIPTION: 'CLAIM',
        TITLE_TYPE_DESCRIPTION: 'Mineral Cell Title Submission',
        ISSUE_DATE: '2021-04-01Z',
        GOOD_TO_DATE: '2027-04-01Z',
        OWNER_NAME: 'A private person',
        CLAIM_NAME: 'SMITH GOLD',
        CLIENT_NUMBER_ID: 12345,
      },
      WIDE,
    ),
    // Coal is under the Coal Act: not read.
    feature({ TENURE_NUMBER_ID: 1100002, TENURE_TYPE_DESCRIPTION: 'Coal' }, WIDE),
  ],
  [LAYERS['water-licences']]: [
    // Inside the block.
    feature(
      {
        WLS_WRL_SYSID: 1,
        POD_NUMBER: 'PD100',
        LICENCE_NUMBER: 'C100',
        LICENCE_STATUS: 'Current',
        PURPOSE_USE: 'Stockwatering',
        PRIMARY_LICENSEE_NAME: 'A private person',
        ADDRESS_LINE_1: '1 Some Road',
      },
      { type: 'Point', coordinates: [-122.765, 53.992] },
    ),
    // About 30 m east of the block: near, not inside.
    feature(
      { WLS_WRL_SYSID: 2, POD_NUMBER: 'PD101', LICENCE_NUMBER: 'C101', LICENCE_STATUS: 'Current' },
      { type: 'Point', coordinates: [-122.7611 + 30 / M_PER_DEG_LON, 53.992] },
    ),
    // About 300 m east: outside the margin.
    feature(
      { WLS_WRL_SYSID: 3, POD_NUMBER: 'PD102', LICENCE_NUMBER: 'C102', LICENCE_STATUS: 'Current' },
      { type: 'Point', coordinates: [-122.7611 + 300 / M_PER_DEG_LON, 53.992] },
    ),
    // Inside, but cancelled.
    feature(
      { WLS_WRL_SYSID: 4, POD_NUMBER: 'PD103', LICENCE_NUMBER: 'C103', LICENCE_STATUS: 'Cancelled' },
      { type: 'Point', coordinates: [-122.766, 53.993] },
    ),
  ],
  [LAYERS['managed-licences']]: [
    feature(
      {
        OBJECTID: 1,
        FOREST_FILE_ID: 'W0001',
        MAP_BLOCK_ID: '1',
        ML_TYPE_CODE: 'SCHEDULE_B',
        LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
        CLIENT_NAME: 'A private person',
      },
      WEST,
    ),
    feature({ OBJECTID: 2, FOREST_FILE_ID: 'W0002', LIFE_CYCLE_STATUS_CODE: 'RETIRED' }, WIDE),
    feature({ OBJECTID: 3, FOREST_FILE_ID: 'K1A', LIFE_CYCLE_STATUS_CODE: 'ACTIVE' }, FAR),
  ],
  [LAYERS.tfl]: [feature({ TFL_ALL_SYSID: 30, FOREST_FILE_ID: 'TFL30', LICENCEE: 'A company' }, WIDE)],
  [LAYERS.recreation]: [
    feature(
      {
        RMF_SKEY: 5,
        FOREST_FILE_ID: 'REC1014',
        PROJECT_NAME: 'A lake',
        PROJECT_TYPE: 'Recreation Site',
        PROJECT_ESTABLISHED_DATE: '1997-05-01Z',
        LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
      },
      box(-122.769, 53.991, -122.768, 53.992),
    ),
    // A reserve is not established under FRPA s. 56.
    feature({ RMF_SKEY: 6, PROJECT_TYPE: 'Recreation Reserve', LIFE_CYCLE_STATUS_CODE: 'ACTIVE' }, WIDE),
  ],
  [LAYERS['recreation-trails']]: [
    // Runs east to west across the west part of the block and on past its west edge.
    feature(
      {
        OBJECTID: 7,
        FOREST_FILE_ID: 'REC2001',
        PROJECT_NAME: 'A trail',
        PROJECT_TYPE: 'Recreation Trail Established',
        LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
        OPERATOR_CLIENT_NAME: 'A private person',
      },
      {
        type: 'LineString',
        coordinates: [
          [-122.775, 53.9925],
          [-122.765, 53.9925],
        ],
      },
    ),
  ],
  [LAYERS['visual-quality']]: [
    feature({ OBJECTID: 8, VLI_POLYGON_NO: 801, REC_EVQO_CODE: 'PR', REC_MADE_KNOWN_CODE: 'Y' }, WEST),
    feature({ OBJECTID: 9, VLI_POLYGON_NO: 802, REC_MADE_KNOWN_CODE: 'Y', REC_VSC_FINAL_VALUE_CODE: '2' }, WIDE),
    // An inventory polygon that is neither a scenic area nor an objective.
    feature({ OBJECTID: 10, VLI_POLYGON_NO: 803, REC_MADE_KNOWN_CODE: 'N' }, WIDE),
  ],
  [LAYERS['critical-habitat']]: [
    feature(
      {
        CRITICAL_HABITAT_ID: 121597,
        COMMON_NAME_ENGLISH: 'Woodland Caribou (Southern Mountain population)',
        CRITICAL_HABITAT_STATUS: 'Final',
        CRITICAL_HABITAT_SITE_NAME: 'Hart Ranges',
        CRITICAL_HABITAT_VARIANT: 'Unmapped Range',
      },
      WIDE,
    ),
  ],
  [OPENING_LAYER]: [
    feature(
      {
        OPENING_ID: 2001,
        OPENING_CATEGORY_CODE: 'SPEX',
        FOREST_FILE_ID: 'A75990',
        DISTURBANCE_START_DATE: '2004-11-25Z',
        CLIENT_NAME: 'A private person',
      },
      IN_WEST,
    ),
    feature(
      { OPENING_ID: 2002, OPENING_CATEGORY_CODE: 'FTML', DISTURBANCE_START_DATE: '2010-01-01Z' },
      box(-122.775, 53.982, -122.773, 53.984),
    ),
  ],
  [STANDARDS_UNIT_LAYER]: [
    feature(
      {
        STOCKING_STANDARD_UNIT_ID: 1,
        OPENING_ID: 2002,
        STANDARDS_UNIT_ID: '1',
        REGEN_OBLIGATION_IND: 'N',
        NO_REGEN_DUE_LATE_DATE: '2011-01-01Z',
        VARIANCE_IND: 'Y',
        NO_REGEN_DECLARED_USER: 'IDIR\\SOMEONE',
      },
      null,
    ),
  ],
  [CUT_BLOCK_LAYER]: [
    feature(
      {
        CUT_BLOCK_SKEY: 212696,
        CUT_BLOCK_FOREST_FILE_ID: 'TFL30',
        HARVEST_AUTH_CUTTING_PERMIT_ID: '23',
        CUT_BLOCK_ID: 'BNY050003',
        TIMBER_MARK: '30/23',
        BLOCK_STATUS_CODE: 'S',
        OPENING_ID: 1048669,
        DISTURBANCE_START_DATE: '2005-03-01Z',
        SP_EXEMPT_IND: 'Y',
        CLIENT_NAME: 'A company',
      },
      box(-122.777, 53.985, -122.776, 53.986),
    ),
  ],
  [ALR_APPLICATION_LAYER]: [
    feature(
      {
        ALR_APPLICATION_ID: 20533,
        RECEIVED_DATE: '2002-09-25Z',
        APPLICATION_CLASS_CODE: 'Application',
        PROPOSAL_COMPONENT_TYPE: 'Non-Farm Use',
        LOCAL_GOVERNMENT: 'Regional District of Fraser-Fort George',
        APPLICANT_NAME: 'A private person',
      },
      box(-122.79, 53.985, -122.785, 53.987),
    ),
    // Beyond 5 km: not counted.
    feature({ ALR_APPLICATION_ID: 18739, RECEIVED_DATE: '1982-01-01Z' }, FAR),
  ],
  [ALR_NOTICE_LAYER]: [
    feature(
      {
        ALR_APPLICATION_ID: 100298,
        RECEIVED_DATE: '2024-03-26Z',
        APPLICATION_CLASS_CODE: 'Notice of Intent',
        PROPOSAL_COMPONENT_TYPE: 'Placement of Fill/Removal of Soil',
      },
      box(-122.75, 53.99, -122.749, 53.991),
    ),
  ],
}

function stub(answers: Record<string, Answer>) {
  const asked: URLSearchParams[] = []
  const fetch: Fetch = async (_url, init) => {
    const body = new URLSearchParams(init?.body)
    asked.push(body)
    const answer = answers[body.get('typeNames') ?? '']
    if (typeof answer === 'number') return { ok: false, status: answer, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: answer ?? [] }) }
  }
  return { fetch, asked }
}

async function readSample(answers = ANSWERS) {
  const plan = samplePlan()
  const block = plan.blocks[0]
  const { shape, signature } = groundFootprint(plan, block, plan.reviewSchedule)
  const { fetch, asked } = stub(answers)
  const read = await readGroundInstruments({
    footprint: shape.geometry,
    block: block.id,
    schedule: plan.reviewSchedule,
    shape: shape.id,
    signature,
    fetch,
    overlay: groundOverlay,
    readOn: '2026-11-24',
  })
  return { read, asked, plan }
}

const instrument = (read: GroundRead, id: string) => read.instruments.find((r) => r.instrument === id)!
const ringSize = (b: URLSearchParams) =>
  (/POLYGON\(\((.*)\)\)\)/.exec(b.get('CQL_FILTER') ?? '')?.[1] ?? '').split(',').length

describe('the instruments added in the second batch', () => {
  it('lists a notation of interest and an application apart from issued tenures, and asks only for the notation', async () => {
    const { read } = await readSample()
    expect(instrument(read, 'land-act-notation').features.map((f) => f.id)).toEqual(['Crown lands file 7410144'])
    expect(instrument(read, 'land-act-application').features.map((f) => f.id)).toEqual(['Crown lands file 7400041'])
    expect(instrument(read, 'land-act-licence').features).toEqual([])
    const asked = documentRequests(read, 'Block 1').map((r) => r.instrument)
    expect(asked).toContain('land-act-notation')
    // An application is published once accepted: no request is drafted.
    expect(asked).not.toContain('land-act-application')
  })

  it('gives the Robson Valley order its own row, read as the Omineca order is', async () => {
    const { read } = await readSample()
    expect(instrument(read, 'robson-valley-ada').features[0]).toMatchObject({
      id: 'Legal feature HW_ADA_1',
      effective: '2006-11-21',
    })
    expect(instrument(read, 'legal-objective').features).toEqual([])
    const reach = (id: string) => GROUND_CATALOGUE.instruments.find((x) => x.id === id)!.reach
    const states = (id: string) => Object.values(reach(id)).map((c) => c.state)
    expect(states('robson-valley-ada')).toEqual(states('omineca-ada-sra'))
    expect(reach('robson-valley-ada').harvest.note).toMatch(/McBride Community Forest/)
  })

  it('reads mineral and placer tenures, not coal, and never the owner or claim name', async () => {
    const { read, asked } = await readSample()
    const minerals = instrument(read, 'mineral-placer-tenure')
    expect(minerals.features.map((f) => f.id)).toEqual(['Tenure 1100001'])
    expect(minerals.features[0].details).toContain('Issued: 2021-04-01')
    const ask = asked.find((b) => b.get('typeNames') === LAYERS['mineral-tenure'])!
    expect(ask.get('propertyName')).not.toMatch(/OWNER|CLAIM_NAME|CLIENT/)
  })

  it('counts water licence points inside the block and within 100 m of it, current licences only', async () => {
    const { read, asked } = await readSample()
    const water = instrument(read, 'water-licence')
    expect(water.features.map((f) => f.id)).toEqual(['Point of diversion PD100', 'Point of diversion PD101'])
    expect(water.near).toEqual({ metres: 100, insideCount: 1, nearCount: 2 })
    expect(water.coveredHa).toBe(0)
    expect(nearText(water.near!)).toBe('2 points within 100 m (1 inside)')
    // The read asks for the footprint grown by the margin, not the footprint itself.
    const ask = asked.find((b) => b.get('typeNames') === LAYERS['water-licences'])!
    expect(ringSize(ask)).toBeGreaterThan(5)
    expect(ask.get('CQL_FILTER')).toContain("LICENCE_STATUS IN ('Current')")
  })

  it('measures a recreation trail by its length inside the block and within 50 m', async () => {
    const { read } = await readSample()
    const trail = instrument(read, 'recreation-trail')
    expect(trail.features).toHaveLength(1)
    const { insideM, nearM } = trail.near!
    // From the block's west edge (-122.7701) to -122.765: about 334 m inside; 50 m more west of the edge.
    expect(insideM).toBeGreaterThan(325)
    expect(insideM).toBeLessThan(345)
    expect(nearM! - insideM!).toBeGreaterThan(45)
    expect(nearM! - insideM!).toBeLessThan(55)
    expect(instrument(read, 'recreation-site').features.map((f) => f.id)).toEqual(['Recreation file REC1014'])
  })

  it('reads woodlots and community forests by their file letter and TFLs by hull, active only', async () => {
    const { read, asked } = await readSample()
    expect(instrument(read, 'woodlot-licence').features.map((f) => f.id)).toEqual(['Forest file W0001 1'])
    expect(instrument(read, 'community-forest').features).toEqual([])
    expect(instrument(read, 'tree-farm-licence').features.map((f) => f.id)).toEqual(['TFL TFL30'])
    const managed = asked.find((b) => b.get('typeNames') === LAYERS['managed-licences'])!
    expect(managed.get('CQL_FILTER')).toContain("(FOREST_FILE_ID LIKE 'W%')")
    expect(managed.get('CQL_FILTER')).toContain("(FOREST_FILE_ID LIKE 'K%')")
    const tfl = asked.find((b) => b.get('typeNames') === LAYERS.tfl)!
    expect(tfl.get('CQL_FILTER')).toContain("FOREST_FILE_ID LIKE 'TFL%'")
    expect(tfl.get('propertyName')).not.toMatch(/LICENCEE/)
  })

  it('tells an established VQO from a scenic area without one, and reads critical habitat', async () => {
    const { read } = await readSample()
    expect(instrument(read, 'visual-quality-objective').features.map((f) => f.id)).toEqual(['VLI polygon 801'])
    expect(instrument(read, 'scenic-area').features.map((f) => f.id)).toEqual(['VLI polygon 802'])
    const habitat = instrument(read, 'federal-critical-habitat')
    expect(habitat.features[0].name).toBe(
      'Woodland Caribou (Southern Mountain population) · Hart Ranges · Unmapped Range',
    )
    expect(habitat.features[0].sharePercent).toBeCloseTo(100, 5)
  })

  it('never keeps a holder, owner, applicant or user field DataBC sent anyway', async () => {
    const { read } = await readSample()
    const text = JSON.stringify(read)
    for (const word of ['A private person', 'A company', 'SMITH GOLD', 'IDIR', 'Some Road', 'CLIENT', 'APPLICANT'])
      expect(text).not.toContain(word)
  })

  it('keeps only area instruments as precedent regions', async () => {
    const { read } = await readSample()
    const rows = read.precedent!.rows.map((r) => r.instrument)
    expect(rows).not.toContain('water-licence')
    expect(rows).not.toContain('recreation-trail')
    for (const id of rows)
      expect(groundLayer(GROUND_CATALOGUE.instruments.find((x) => x.id === id)!.layer)!.geometry).toBe('area')
  })
})

describe('public signals of an exception in the precedent', () => {
  it('counts SPEX openings, intermediate cuts, variations and exempt cut blocks inside each instrument', async () => {
    const { read } = await readSample()
    const p = read.precedent!
    expect(p.joins).toMatchObject({
      standards: 'read',
      exemptBlocks: 'read',
      alrApplications: 'read',
      alrNotices: 'read',
    })
    const spex = p.openings.find((o) => o.openingId === 2001)!
    expect(spex).toMatchObject({ category: 'SPEX', noRegenObligation: false, variance: false })
    const thinned = p.openings.find((o) => o.openingId === 2002)!
    expect(thinned).toMatchObject({ noRegenObligation: true, variance: true })
    expect(thinned.standards[0]).toContain(
      'no regeneration obligation (intermediate cut or selection system, FPPR s. 44(4))',
    )
    expect(thinned.standards[0]).toContain('no-regeneration milestone due 2011-01-01')
    expect(thinned.standards[0]).toContain('under an approved variation')
    const summary = precedentSummary(p, 'robson-valley-ada')
    // The order counts from 2006-11-21: the 2004 SPEX opening and the 2005 exempt block are earlier.
    expect(summary).toContain('1 opening was an intermediate cut or selection harvest with no regeneration obligation')
    expect(summary).toContain(
      '1 opening has a stocking standard under an approved variation (the approval is not public)',
    )
    expect(summary).not.toContain('SPEX')
    const undated = precedentSummary(p, 'woodlot-licence')
    expect(undated).toContain('1 opening here carried no obligation to reforest (SPEX)')
    expect(undated).toContain(
      '1 cut block marked exempt from a silviculture prescription (Forest Practices Code s. 30)',
    )
    expect(p.rows.find((r) => r.instrument === 'robson-valley-ada')).toMatchObject({
      exemptBlocks: [],
      exemptEarlier: 1,
    })
    expect(p.exemptBlocks).toEqual([
      {
        key: 212696,
        forestFileId: 'TFL30',
        timberMark: '30/23',
        cuttingPermit: '23',
        cutBlock: 'BNY050003',
        status: 'S',
        openingId: 1048669,
        harvested: '2005-03-01',
      },
    ])
  })

  it('reads the Commission’s applications and notices of intent as the ALR row’s precedent, never the applicant', async () => {
    const { read, asked } = await readSample()
    const p = read.precedent!
    expect(p.alrApplications).toEqual([
      {
        id: 100298,
        kind: 'notice of intent',
        received: '2024-03-26',
        applicationClass: 'Notice of Intent',
        components: 'Placement of Fill/Removal of Soil',
      },
      {
        id: 20533,
        kind: 'application',
        received: '2002-09-25',
        applicationClass: 'Application',
        components: 'Non-Farm Use',
        localGovernment: 'Regional District of Fraser-Fort George',
      },
    ])
    expect(precedentSummary(p, 'alr')).toContain(
      '1 ALR application and 1 notice of intent mapped within 5 km (the Commission’s decisions are not in the layer)'.replace(
        '’',
        "'",
      ),
    )
    expect(precedentSummary(p, 'land-act-notation')).not.toContain('ALR application')
    for (const layer of [ALR_APPLICATION_LAYER, ALR_NOTICE_LAYER])
      expect(asked.find((b) => b.get('typeNames') === layer)!.get('propertyName')).not.toMatch(/APPLICANT/)
  })

  it('says Not read for a signal whose read failed, never none', async () => {
    const { read } = await readSample({ ...ANSWERS, [CUT_BLOCK_LAYER]: 500, [ALR_NOTICE_LAYER]: 503 })
    const p = read.precedent!
    expect(p.joins).toMatchObject({ exemptBlocks: 'failed', alrApplications: 'read', alrNotices: 'failed' })
    expect(p.exemptBlocks).toBeUndefined()
    expect(precedentSummary(p, 'woodlot-licence')).toContain(
      'cut blocks exempt from a silviculture prescription not read',
    )
    expect(precedentSummary(p, 'alr')).toContain('ALR applications and notices of intent not read')
    expect(precedentSummary(p, 'alr')).not.toMatch(/0 ALR/)
  })

  it('opens a read made before the signals were kept, and round-trips one made with them', async () => {
    const { read, plan } = await readSample()
    const saved = saveGroundRead(plan, read)
    const reopened = parsePlan(JSON.parse(JSON.stringify(saved)))
    expect(reopened.groundReads).toEqual([read])
    // An older read: no signals, no near measures, the three original joins.
    const older = JSON.parse(JSON.stringify(read))
    delete older.precedent.exemptBlocks
    delete older.precedent.alrApplications
    for (const k of ['exemptBlocks', 'alrApplications', 'alrNotices']) delete older.precedent.joins[k]
    for (const r of older.precedent.rows) {
      delete r.exemptBlocks
      delete r.exemptEarlier
      delete r.alrApplications
    }
    for (const o of older.precedent.openings) {
      delete o.noRegenObligation
      delete o.variance
    }
    for (const i of older.instruments) {
      delete i.near
      for (const f of i.features) delete f.near
    }
    const parsed = parseGroundRead(older)
    expect(parsed.precedent!.joins).toEqual({ standards: 'read', planting: 'read', activities: 'read' })
    expect(precedentSummary(parsed.precedent!, 'woodlot-licence')).not.toMatch(/not read|exempt/)
  })

  it('prints the signals and the line and point measures in the record and the summary', async () => {
    const { read, plan } = await readSample()
    const saved = saveGroundRead(plan, read)
    const shown = { schedule: plan.reviewSchedule, year: plan.area.startYear }
    const result = analyzePlan(saved, shown)
    const record = assessmentRecord(saved, result, [], '2026-11-24')
    const water = record.groundReads[0].reach.find((r) => r.instrument === 'water-licence')!
    expect(water).toMatchObject({ precedent: 'Not read for a line or point layer' })
    const html = buildExport('summary', saved, result, [], '2026-11-24')
    expect(html).toContain('2 points within 100 m (1 inside)')
    expect(html).toContain('carried no obligation to reforest (SPEX)')
    expect(html).toContain('Cut blocks marked exempt from a silviculture prescription')
    expect(html).toContain('notice of intent 100298')
    expect(html).not.toContain('A private person')
  })
})
