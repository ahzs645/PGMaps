import type { Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import { GROUND_CATALOGUE } from '@/lib/legal/groundInstruments'
import { setShapeGeometry, removeBlock } from '../edits'
import { assessmentRecord, buildExport } from '../exports'
import { groundOverlay } from '../oldForest/oldForest'
import { parsePlan, samplePlan, type Plan } from '../plan'
import { analyzePlan } from '../planAnalysis'
import type { Fetch } from '../wfsReads'
import { readGroundInstruments } from './groundRead'
import { ACTIVITY_LAYER, OPENING_LAYER, PLANTING_LAYER, precedentSummary, STANDARDS_UNIT_LAYER } from './precedent'
import { groundFootprint, groundReadCurrent, groundReadOf, saveGroundRead, type GroundRead } from './record'
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
const feature = (properties: Record<string, unknown>, geometry: Polygon | null) => ({
  type: 'Feature',
  properties,
  geometry,
})

// The sample's block: -122.7701 to -122.7611, 53.99 to 53.995. Its west half is in the §17 area.
const S17 = box(-122.78, 53.98, -122.7656, 54.0)
const LEASE = box(-122.7656, 53.992, -122.75, 54.0)
const WIDE = box(-122.8, 53.98, -122.7, 54.01)
const PARCEL = box(-122.7625, 53.99, -122.76, 53.9925)
const FAR = box(-123.5, 54.5, -123.49, 54.51)
const OPENING_IN_S17 = box(-122.778, 53.982, -122.776, 53.984)
const OPENING_IN_S17_OLD = box(-122.775, 53.982, -122.773, 53.984)
const OPENING_EAST = box(-122.72, 53.985, -122.718, 53.987)

type Answer = Record<string, unknown>[] | number

const TANTALIS = 'pub:WHSE_TANTALIS.TA_CROWN_TENURES_SVW'
const ANSWERS: Record<string, Answer> = {
  [TANTALIS]: [
    feature(
      {
        INTRID_SID: 1,
        CROWN_LANDS_FILE: '7400001',
        TENURE_STAGE: 'TENURE',
        TENURE_TYPE: 'RESERVE/NOTATION',
        TENURE_SUBTYPE: 'SEC 17 DESIGNATED USE AREA',
        TENURE_PURPOSE: 'AGRICULTURE',
        TENURE_SUBPURPOSE: 'GRAZING',
        TENURE_DOCUMENT: 'R100',
        TENURE_EXPIRY: '9999-05-12Z',
        INTEREST_HOLDER: 'A private person',
      },
      S17,
    ),
    feature(
      {
        INTRID_SID: 2,
        CROWN_LANDS_FILE: '7400002',
        TENURE_STAGE: 'TENURE',
        TENURE_TYPE: 'LEASE',
        TENURE_SUBTYPE: 'LEASE',
        TENURE_PURPOSE: 'AGRICULTURE',
        TENURE_SUBPURPOSE: 'GRAZING',
        TENURE_DOCUMENT: 'L200',
      },
      LEASE,
    ),
    // An application is not an issued licence: the application row takes it, not the licence row.
    feature({ INTRID_SID: 3, CROWN_LANDS_FILE: '7400003', TENURE_STAGE: 'APPLICATION', TENURE_TYPE: 'LICENCE' }, WIDE),
  ],
  'pub:WHSE_LEGAL_ADMIN_BOUNDARIES.OATS_ALR_POLYS': [feature({ ALR_POLY_ID: 9, STATUS: 'ALR' }, FAR)],
  'pub:WHSE_LAND_USE_PLANNING.RMP_OGMA_NON_LEGAL_CURRENT_SVW': [
    feature(
      {
        NON_LEGAL_OGMA_INTERNAL_ID: 30,
        NON_LEGAL_OGMA_PROVID: 'PRG_COFA_5',
        OGMA_PRIMARY_REASON: 'A25 vri mat',
        ORIGINAL_DECISION_DATE: '2022-12-22Z',
        INITIATOR_OF_CHANGE: 'IDIR',
      },
      LEASE,
    ),
    // A04's 2009 non-legal OGMAs are excepted by Appendix 5: no instrument takes one.
    feature({ NON_LEGAL_OGMA_INTERNAL_ID: 31, NON_LEGAL_OGMA_PROVID: 'PRG_DPG_9', OGMA_PRIMARY_REASON: 'A04 x' }, WIDE),
  ],
  // The pine layer is read only inside a listed TSA or TFL: the gate answers first.
  'pub:WHSE_ADMIN_BOUNDARIES.FADM_TSA_SV': [feature({ TSA_NUMBER_DESCRIPTION: 'Prince George TSA' }, WIDE)],
  'pub:WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY': [
    feature({ FEATURE_ID: 40, MAP_ID: '093G086', POLYGON_ID: 1, SPECIES_CD_1: 'PLI', POLYGON_AREA: 24.5 }, S17),
    feature({ FEATURE_ID: 41, MAP_ID: '093G086', POLYGON_ID: 2, SPECIES_CD_1: 'SX', POLYGON_AREA: 30 }, LEASE),
  ],
  // Forest development units: one approved plan past its term, one in it, an amendment submitted and
  // an earlier amendment's unit; every record sent with the names and clients a reader must cut.
  'pub:WHSE_FOREST_TENURE.FSP_FDU_POLY_SPG': [
    ...(
      [
        [1, 479, 15228, 0, 'APPROVED', '2014-12-31Z'],
        [2, 10, 21664, 29, 'APPROVED', '2027-07-25Z'],
        [3, 1067, 25566, 2, 'SUBMITTED', '2031-03-12Z'],
        [4, 11, 19362, 57, 'PREVIOUS', '2020-01-01Z'],
      ] as const
    ).map(([OBJECTID, FSP_ID, FDU_ID, FSP_AMENDMENT_NUMBER, LIFE_CYCLE_STATUS_CODE, PLAN_END_DATE]) =>
      feature(
        {
          OBJECTID,
          FSP_ID,
          FDU_ID,
          FSP_AMENDMENT_NUMBER,
          LIFE_CYCLE_STATUS_CODE,
          PLAN_END_DATE,
          LICENCE1: 'A00001',
          PLAN_NAME: 'A plan named for SOMEONE',
          FDU_NAME: 'A unit name',
          MAP_LABEL: `${FSP_ID} (${FSP_AMENDMENT_NUMBER}) -A unit name`,
          CLIENT_NUMBER1: '00000001',
          CLIENT_NAME1: 'A private person',
        },
        WIDE,
      ),
    ),
  ],
  'pub:WHSE_FOREST_TENURE.FSP_IDENTIFIED_AREA_POLY_SPG': [
    feature(
      {
        OBJECTID: 9,
        FSP_ID: 999,
        IDENTIFIED_AREA_ID: 7569,
        FSP_AMENDMENT_NUMBER: 0,
        LIFE_CYCLE_STATUS_CODE: 'APPROVED',
        FSP_LEGISLATION_TYPE_CODE: 'FPPR14(4)',
        IDENTIFIED_AREA_NAME: 'Typed by SOMEONE',
        PLAN_NAME: 'A plan named for SOMEONE',
      },
      S17,
    ),
  ],
  'pub:WHSE_LAND_USE_PLANNING.RMP_PLAN_LEGAL_POLY_SVW': [
    feature(
      {
        LEGAL_FEAT_ID: 20,
        LEGAL_FEAT_PROVID: 'PRG_1_1',
        STRGC_LAND_RSRCE_PLAN_NAME:
          'Agricultural Development Areas and Settlement Reserve Areas within 4 Forest Districts - Extent',
        LEGAL_FEAT_OBJECTIVE: 'Agricultural Development Areas - Prince George W',
        LEGALIZATION_DATE: '2006-11-21Z',
        GIS_CHANGE_PERSON: 'SOMEONE',
      },
      WIDE,
    ),
    feature(
      {
        LEGAL_FEAT_ID: 21,
        LEGAL_FEAT_PROVID: 'PRG_79_822',
        STRGC_LAND_RSRCE_PLAN_NAME:
          'Prince George Timber Supply Area (TSA) Legal Order - Landscape Biodiversity Objective Order - Extent',
        LEGAL_FEAT_OBJECTIVE: 'Units for all Biodiversity Objectives',
        LEGALIZATION_DATE: '2004-10-20Z',
      },
      WIDE,
    ),
  ],
  'pub:WHSE_WILDLIFE_MANAGEMENT.WCP_UNGULATE_WINTER_RANGE_SP': 500,
  'pub:WHSE_FOREST_TENURE.FTEN_RANGE_POLY_SVW': [
    feature(
      {
        OBJECTID: 10,
        FOREST_FILE_ID: 'RAN000001',
        MAP_BLOCK_ID: '1',
        FILE_TYPE_CODE: 'E01',
        LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
        CLIENT_NAME: 'A private person',
        CLIENT_NUMBER: '00001',
      },
      WIDE,
    ),
    feature({ OBJECTID: 11, FOREST_FILE_ID: 'RAN000002', LIFE_CYCLE_STATUS_CODE: 'RETIRED' }, WIDE),
  ],
  'pub:WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW': [
    feature({ PARCEL_FABRIC_POLY_ID: 30, PID_FORMATTED: '000-000-001', OWNER_TYPE: 'Private' }, PARCEL),
    feature({ PARCEL_FABRIC_POLY_ID: 31, PID_FORMATTED: '000-000-002', OWNER_TYPE: 'Crown Provincial' }, WIDE),
  ],
  [OPENING_LAYER]: [
    feature(
      {
        OPENING_ID: 1001,
        MAP_LABEL: ' 93J028   17',
        FOREST_FILE_ID: 'A95070',
        FILE_TYPE_CODE: 'B20',
        OPENING_CATEGORY_CODE: 'FTSBF',
        DISTURBANCE_START_DATE: '2017-10-27Z',
        DENUDATION_1_DISTURBANCE_CODE: 'L',
        DENUDATION_1_SILV_SYSTEM_CODE: 'CLEAR',
        DENUDATION_1_COMPLETION_DATE: '2017-11-10Z',
        CLIENT_NAME: 'A private person',
        OPENING_WHO_CREATED: 'IDIR\\SOMEONE',
      },
      OPENING_IN_S17,
    ),
    feature({ OPENING_ID: 1002, FOREST_FILE_ID: 'A81036', DISTURBANCE_START_DATE: '2005-02-02Z' }, OPENING_IN_S17_OLD),
    feature({ OPENING_ID: 1003, FOREST_FILE_ID: 'A99999', DISTURBANCE_START_DATE: '2019-01-15Z' }, OPENING_EAST),
    feature({ OPENING_ID: 1004, DISTURBANCE_START_DATE: '2020-01-01Z' }, FAR),
  ],
  [STANDARDS_UNIT_LAYER]: [
    feature(
      {
        STOCKING_STANDARD_UNIT_ID: 1,
        OPENING_ID: 1001,
        STANDARDS_UNIT_ID: '1',
        NET_AREA: 2.8,
        REGEN_DECLARED_IND: 'Y',
        REGEN_DECLARED_DATE: '2019-06-15Z',
        FREE_GROW_DUE_LATE_DATE: '2037-10-27Z',
        FREE_GROW_DECLARED_IND: 'N',
        I_MIN_STOCKING_STANDARD: 700,
        I_MIN_PREF_STOCKING_STANDARD: 600,
        I_TARGET_STOCKING: 1200,
        I_PREFERRED_SPECIES1: 'PLI',
        SSU_WHO_CREATED: 'IDIR\\SOMEONE',
        FREE_GROW_DECLARED_USER: 'IDIR\\SOMEONE',
      },
      null,
    ),
    feature(
      { STOCKING_STANDARD_UNIT_ID: 2, OPENING_ID: 1002, STANDARDS_UNIT_ID: '1', FREE_GROW_DECLARED_IND: 'Y' },
      null,
    ),
  ],
  [PLANTING_LAYER]: [
    feature(
      {
        OPENING_ID: 1001,
        ACTIVITY_TREATMENT_UNIT_ID: 50,
        ATU_COMPLETION_DATE: '2019-06-08Z',
        SILV_TREE_SPECIES_CODE: 'PLI',
        NUMBER_PLANTED: 8520,
      },
      null,
    ),
    feature(
      {
        OPENING_ID: 1001,
        ACTIVITY_TREATMENT_UNIT_ID: 50,
        ATU_COMPLETION_DATE: '2019-06-08Z',
        SILV_TREE_SPECIES_CODE: 'SX',
        NUMBER_PLANTED: 2372,
      },
      null,
    ),
  ],
  [ACTIVITY_LAYER]: [
    feature(
      {
        OPENING_ID: 1001,
        ACTIVITY_TREATMENT_UNIT_ID: 49,
        SILV_BASE_CODE: 'SP',
        SILV_TECHNIQUE_CODE: 'ME',
        SILV_METHOD_CODE: 'MOUND',
        ATU_COMPLETION_DATE: '2018-11-07Z',
        ACTUAL_TREATMENT_AREA: 7.2,
      },
      null,
    ),
    feature(
      {
        OPENING_ID: 1001,
        ACTIVITY_TREATMENT_UNIT_ID: 50,
        SILV_BASE_CODE: 'PL',
        SILV_TECHNIQUE_CODE: 'PL',
        SILV_METHOD_CODE: 'CTAIN',
        ATU_COMPLETION_DATE: '2019-06-08Z',
        ACTUAL_TREATMENT_AREA: 7.1,
        ACTUAL_PLANTED_NUMBER: 10892,
      },
      null,
    ),
    feature(
      {
        OPENING_ID: 1002,
        ACTIVITY_TREATMENT_UNIT_ID: 60,
        SILV_BASE_CODE: 'PL',
        SILV_TECHNIQUE_CODE: 'PL',
        ATU_COMPLETION_DATE: '2006-05-11Z',
      },
      null,
    ),
  ],
}

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

async function readSample(answers = ANSWERS, plan: Plan = samplePlan(), signal?: AbortSignal) {
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
    signal,
    overlay: groundOverlay,
    readOn: '2026-11-24',
  })
  return { read, asked, plan }
}

const instrument = (read: GroundRead, id: string) => read.instruments.find((r) => r.instrument === id)!

describe('reading the instruments on a block', () => {
  it('reads each layer once by the footprint, shares it out by instrument and measures each on the block', async () => {
    const { read, asked } = await readSample()
    const layerReads = asked.filter((b) => GROUND_CATALOGUE.layers.some((l) => l.typeName === b.get('typeNames')))
    // Every layer that holds an instrument, once; a context layer (treaty land, reserves) is the land checks' only.
    const instrumentLayers = GROUND_CATALOGUE.layers.filter((l) => !l.context)
    expect(instrumentLayers.length).toBe(GROUND_CATALOGUE.layers.length - 2)
    expect(layerReads.map((b) => b.get('typeNames'))).toEqual(instrumentLayers.map((l) => l.typeName))
    for (const b of layerReads) {
      expect(b.get('CQL_FILTER')).toMatch(/^INTERSECTS\((SHAPE|GEOMETRY),SRID=4326;POLYGON\(\(/)
      expect(b.get('propertyName')).not.toMatch(/CLIENT|HOLDER|_WHO_|USER/)
    }
    expect(layerReads.find((b) => b.get('typeNames') === TANTALIS)!.get('CQL_FILTER')).toContain(
      "TENURE_SUBTYPE IN ('SEC 17 DESIGNATED USE AREA')",
    )
    const s17 = instrument(read, 'land-act-s17')
    expect(s17.status).toBe('read')
    expect(s17.features).toHaveLength(1)
    expect(s17.features[0].id).toBe('Crown lands file 7400001')
    expect(s17.features[0].sharePercent).toBeGreaterThan(45)
    expect(s17.features[0].sharePercent).toBeLessThan(55)
    expect(s17.features[0].identifiers).toContainEqual({ label: 'Document', value: 'R100' })
    expect(s17.features[0].effective).toBeUndefined()
    expect(instrument(read, 'land-act-lease').features[0].sharePercent).toBeGreaterThan(20)
    // The application went to its own row; the licence row is read and empty.
    expect(instrument(read, 'land-act-licence')).toMatchObject({ status: 'read', features: [] })
    expect(instrument(read, 'alr')).toMatchObject({ status: 'read', features: [] })
    expect(instrument(read, 'omineca-ada-sra').features[0]).toMatchObject({ effective: '2006-11-21' })
    expect(instrument(read, 'pg-biodiversity').features[0].sharePercent).toBeCloseTo(100, 5)
    expect(instrument(read, 'legal-objective').features).toEqual([])
    expect(instrument(read, 'range-tenure').features.map((f) => f.id)).toEqual(['RAN file RAN000001 1'])
    expect(instrument(read, 'private-land').features.map((f) => f.id)).toEqual(['PID 000-000-001'])
    // The screens behind the reviewer's answers: candidates, each in its own row.
    expect(instrument(read, 'pg-cofa').features.map((f) => [f.id, f.effective])).toEqual([
      ['Non-legal OGMA PRG_COFA_5', '2022-12-22'],
    ])
    expect(instrument(read, 'pg-non-legal-ogma-2009')).toMatchObject({ status: 'read', features: [] })
    expect(instrument(read, 'targeted-pine-candidate').features.map((f) => f.id)).toEqual(['VRI polygon 093G086 1'])
    expect(instrument(read, 'special-purpose-area')).toMatchObject({ status: 'read', features: [] })
    // A plan's units by its status, with whether its term had ended on the day read, and no name.
    expect(
      instrument(read, 'fsp-forest-development-unit').features.map((f) => [
        f.id,
        f.details.find((d) => d.startsWith('Term ends')),
      ]),
    ).toEqual([
      ['FSP and FDU 10 21664', 'Term ends: 2027-07-25, still running on 2026-11-24'],
      ['FSP and FDU 479 15228', 'Term ends: 2014-12-31, ended before the read of 2026-11-24'],
    ])
    expect(instrument(read, 'fsp-forest-development-unit').features[0].name).toMatch(/^Not read \(/)
    expect(instrument(read, 'fsp-forest-development-unit-submitted').features.map((f) => f.id)).toEqual([
      'FSP and FDU 1067 25566',
    ])
    expect(instrument(read, 'fsp-declared-area').features.map((f) => f.id)).toEqual([
      'FSP and identified area 999 7569',
    ])
    expect(instrument(read, 'fsp-section-196-area')).toMatchObject({ status: 'read', features: [] })
    const gate = asked.find((b) => b.get('typeNames') === 'pub:WHSE_ADMIN_BOUNDARIES.FADM_TSA_SV')!
    expect(gate.get('propertyName')).toBe('TSA_NUMBER_DESCRIPTION,GEOMETRY')
  })

  it('says Not read for a layer DataBC did not answer, for every instrument it holds', async () => {
    const { read } = await readSample()
    for (const id of ['uwr-no-harvest', 'uwr-conditional']) {
      expect(instrument(read, id).status).toBe('failed')
      expect(instrument(read, id).message).toMatch(/500/)
    }
    // The rest read as before.
    expect(instrument(read, 'wha-no-harvest')).toMatchObject({ status: 'read', features: [] })
  })

  it('never keeps a holder, client or user field DataBC sent anyway', async () => {
    const { read } = await readSample()
    const text = JSON.stringify(read)
    for (const word of [
      'A private person',
      'CLIENT',
      'IDIR',
      'SOMEONE',
      'INTEREST_HOLDER',
      'GIS_CHANGE_PERSON',
      'A unit name',
      '00000001',
    ])
      expect(text).not.toContain(word)
  })

  it('marks a layer holding more than it keeps as incomplete', async () => {
    const many = Array.from({ length: 501 }, (_, i) =>
      feature(
        { INTRID_SID: i + 100, CROWN_LANDS_FILE: String(i), TENURE_SUBTYPE: 'SEC 16 MAP RESERVE' },
        box(-122.77 + i * 1e-6, 53.991, -122.769 + i * 1e-6, 53.992),
      ),
    )
    const { read } = await readSample({ [TANTALIS]: many })
    expect(instrument(read, 'land-act-s16').status).toBe('truncated')
    expect(instrument(read, 'land-act-s16').message).toMatch(/more than 500/)
    expect(instrument(read, 'land-act-s16').features.length).toBeLessThanOrEqual(500)
  })

  it('stops at once when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(readSample(ANSWERS, samplePlan(), controller.signal)).rejects.toThrow(/Abort/)
  })
})

describe('precedent inside each instrument', () => {
  it('keeps the openings inside an instrument near the block, from its date where the layer gives one', async () => {
    const { read } = await readSample()
    const p = read.precedent!
    expect(p.status).toBe('read')
    expect(p.radiusM).toBe(5000)
    expect(p.joins).toEqual({ standards: 'read', planting: 'read', activities: 'read', exemptBlocks: 'read' })
    const row = (id: string) => p.rows.find((r) => r.instrument === id)!
    // Tantalis has no date: every opening inside counts, and the row says the layer has none.
    expect(row('land-act-s17')).toMatchObject({ dated: false, openings: [1001, 1002], earlier: 0 })
    expect(row('land-act-s17').since).toBeUndefined()
    // The 2006 order counts from its legalisation: the 2005 harvest is left out.
    expect(row('omineca-ada-sra')).toMatchObject({
      dated: true,
      since: '2006-11-21',
      openings: [1001, 1003],
      earlier: 1,
    })
    expect(row('pg-biodiversity')).toMatchObject({ since: '2004-10-20', openings: [1001, 1002, 1003], earlier: 0 })
    expect(row('land-act-lease').openings).toEqual([])
    // The far opening is outside the 5 km and in nothing.
    expect(p.openings.map((o) => o.openingId).sort()).toEqual([1001, 1002, 1003])
  })

  it('joins standards, planting and site preparation by opening', async () => {
    const { read } = await readSample()
    const o = read.precedent!.openings.find((x) => x.openingId === 1001)!
    expect(o).toMatchObject({ forestFileId: 'A95070', fileType: 'B20', harvested: '2017-10-27', planted: true })
    expect(o.mapLabel).toBe('93J028   17')
    expect(o.denudation).toEqual(['L · CLEAR · completed 2017-11-10'])
    expect(o.sitePrep).toEqual(['ME MOUND · 2018-11-07 · 7.2 ha'])
    expect(o.planting).toEqual(['PL CTAIN · 2019-06-08 · 7.1 ha · PLI 8,520, SX 2,372'])
    expect(o.freeGrowing).toBe(false)
    expect(o.standards[0]).toContain('regeneration declared 2019-06-15')
    expect(o.standards[0]).toContain('free growing not declared (due 2037-10-27)')
    expect(o.standards[0]).toContain('stocking minimum 700 (600 preferred), target 1200 stems/ha')
    const east = read.precedent!.openings.find((x) => x.openingId === 1003)!
    expect(east).toMatchObject({ planted: false, freeGrowing: false, planting: [], standards: [] })
    expect(precedentSummary(read.precedent!, 'land-act-s17')).toBe(
      '2 openings within 5 km harvested at any date (the layer records none); 2 planted; 1 declared free growing; 0 with no planting recorded',
    )
    expect(precedentSummary(read.precedent!, 'omineca-ada-sra')).toBe(
      '2 openings within 5 km harvested since 2006-11-21; 1 planted; 0 declared free growing; 1 with no planting recorded; 1 harvested before its date left out',
    )
  })

  it('says Not read for a join that failed, never none', async () => {
    const { read } = await readSample({ ...ANSWERS, [PLANTING_LAYER]: 503, [ACTIVITY_LAYER]: 503 })
    const p = read.precedent!
    expect(p.joins).toEqual({ standards: 'read', planting: 'failed', activities: 'failed', exemptBlocks: 'read' })
    expect(p.openings.every((o) => o.planted === null)).toBe(true)
    expect(precedentSummary(p, 'land-act-s17')).toContain('planting not read')
    expect(precedentSummary(p, 'land-act-s17')).not.toContain('no planting recorded')
  })

  it('says Not read when the openings could not be read', async () => {
    const { read } = await readSample({ ...ANSWERS, [OPENING_LAYER]: 500 })
    expect(read.precedent!.status).toBe('failed')
    expect(precedentSummary(read.precedent!, 'land-act-s17')).toMatch(/^Not read: DataBC answered 500/)
  })
})

describe('documents to request', () => {
  it('drafts one for each instrument found whose terms are not public, quoting what was read', async () => {
    const { read } = await readSample()
    const requests = documentRequests(read, 'Block 1')
    expect(requests.map((r) => r.instrument)).toEqual([
      'land-act-s17',
      'land-act-lease',
      'range-tenure',
      'private-land',
    ])
    const s17 = requests[0]
    expect(s17.identifiers).toEqual(['Crown lands file 7400001, Document R100, Interest 1'])
    expect(s17.channel).toBe('FrontCounter BC, quoting the Crown lands file number')
    expect(s17.text).toContain('notice of establishment')
    expect(s17.text).toContain('Block 1')
    expect(s17.text).not.toMatch(/private person/)
  })
})

describe('the read kept with the plan', () => {
  it('round-trips, stays current while the footprint does, and goes out of date when it changes', async () => {
    const { read, plan } = await readSample()
    const saved = saveGroundRead(plan, read)
    expect(groundReadOf(saved, 'block-1', 'proposed')).toBe(read)
    const reopened = parsePlan(JSON.parse(JSON.stringify(saved)))
    expect(reopened.groundReads).toEqual([read])
    expect(groundReadCurrent(reopened, reopened.groundReads![0])).toBe(true)
    const moved = setShapeGeometry(reopened, 'block-1', 'shape-1', box(-122.771, 53.99, -122.762, 53.995))
    expect(groundReadCurrent(moved, moved.groundReads![0])).toBe(false)
    // A read for other ground is refused.
    expect(saveGroundRead(moved, read)).toBe(moved)
    expect(removeBlock(saved, 'block-1').groundReads).toEqual([])
  })

  it('opens a plan without reads as before, and leaves out a read that does not parse', () => {
    const plan = samplePlan()
    expect(parsePlan(JSON.parse(JSON.stringify(plan))).groundReads).toBeUndefined()
    const broken = {
      ...JSON.parse(JSON.stringify(plan)),
      groundReads: [{ block: 'block-1' }, { block: 'nowhere', schedule: 'proposed' }],
    }
    expect(parsePlan(broken).groundReads).toEqual([])
  })

  it('is printed in the record and the summary, beside the run it never feeds', async () => {
    const { read, plan } = await readSample()
    const saved = saveGroundRead(plan, read)
    const shown = { schedule: plan.reviewSchedule, year: plan.area.startYear }
    const result = analyzePlan(saved, shown)
    const baseline = analyzePlan(plan, shown)
    expect(result.runs).toEqual(baseline.runs)
    const record = assessmentRecord(saved, result, [], '2026-11-24')
    expect(record.groundReads).toHaveLength(1)
    expect(record.groundReads[0]).toMatchObject({ current: true, screenOnly: true })
    expect(record.groundReads[0].reach.map((r) => r.instrument)).toContain('land-act-s17')
    expect(record.groundReads[0].requests).toHaveLength(4)
    const html = buildExport('summary', saved, result, [], '2026-11-24')
    expect(html).toContain('<h2>On this ground</h2>')
    expect(html).toContain('Not read: Ungulate winter range, no harvest zone')
    expect(html).toContain('never a legal determination')
    expect(html).toContain('Land Act s. 17(1.1), (2)')
  })
})
