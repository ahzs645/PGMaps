import { describe, expect, it } from 'vitest'
import * as ExcelJS from 'exceljs'

import type { Fetch } from '@/lib/forestry/wfsReads'
import { GROUND_CATALOGUE } from '@/lib/legal/groundInstruments'
import { layerInstruments } from '@/lib/legal/groundLayerRead'
import { blockNoteWorkbook, LAND_STATUS_TITLE } from './blockNote'
import {
  findLandCheck,
  LAND_CHECK_CAVEAT,
  LAND_CHECKS,
  landCheckFootprint,
  landCheckLayer,
  landCheckMetrics,
  landCheckReportRows,
  landChecksPending,
  landCheckSummary,
  landCheckTypeNames,
  measureLandCheck,
  readLandCheck,
  runLandCheck,
  type LandCheckState,
} from './landStatusChecks'
import type { PolygonGeometry } from './visibility'

/** A square of `size` degrees at (lng, lat), south-west corner. */
const square = (lng: number, lat: number, size: number): PolygonGeometry => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, lat],
      [lng + size, lat],
      [lng + size, lat + size],
      [lng, lat + size],
      [lng, lat],
    ],
  ],
})

// About 650 m × 1100 m at 54° N.
const block = { name: 'PL-1', geometry: square(-122.5, 54, 0.01) }
const landform = square(-122.52, 53.98, 0.05)

describe('land status checks', () => {
  it('reads every check from a ground catalogue layer, of area, and names features only from fields it keeps', () => {
    for (const check of LAND_CHECKS) {
      const layer = landCheckLayer(check)
      expect(layer.geometry, check.id).toBe('area')
      // A context layer (treaty land, reserves) holds no instrument; every other check counts the layer's instruments.
      if (layer.context) expect(layerInstruments(layer), check.id).toEqual([])
      else expect(layerInstruments(layer).length, check.id).toBeGreaterThan(0)
      const asked = new Set<string>()
      check.name(new Proxy({}, { get: (_, field) => void asked.add(String(field)) }))
      for (const field of asked) expect(layer.fields, `${check.id} names by ${field}`).toContain(field)
    }
    expect(LAND_CHECKS.filter((check) => landCheckLayer(check).context).map((check) => check.id)).toEqual([
      'treaty',
      'reserve',
    ])
    expect(new Set(landCheckTypeNames()).size).toBe(LAND_CHECKS.length)
  })

  it("asks DataBC by the shapes' own parts, by POST, with the catalogue's filter and the geometry field named", async () => {
    const asked: URLSearchParams[] = []
    const fetcher: Fetch = async (_url, init) => {
      asked.push(new URLSearchParams(init?.body))
      return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: [] }) }
    }
    const read = landCheckFootprint([block.geometry], landform)!
    await readLandCheck(findLandCheck('private'), read.footprint, fetcher)
    // One read for the block, one for the landform; never a box.
    expect(asked).toHaveLength(2)
    expect(asked[0].get('typeNames')).toBe('pub:WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW')
    expect(asked[0].get('CQL_FILTER')).toMatch(
      /^INTERSECTS\(SHAPE,SRID=4326;POLYGON\(\(-122\.50000 54\.00000,.*\)\)\) AND OWNER_TYPE IN \('Private', 'Crown Agency'\)$/,
    )
    expect(asked[0].get('propertyName')?.split(',')).toContain('SHAPE')
    expect(asked[0].has('bbox')).toBe(false)
    asked.length = 0
    await readLandCheck(findLandCheck('treaty'), read.footprint, fetcher)
    // A context layer is read whole.
    expect(asked[0].get('CQL_FILTER')).toMatch(/^INTERSECTS\(GEOMETRY,[^)]*\)\)\)$/)
  })

  it('names every layer once', () => {
    const ids = LAND_CHECKS.map((check) => check.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reads polygons and their names, and says when the read was cut short', async () => {
    const reserve = (id: number) => ({
      geometry: square(-122.5, 54, 0.01),
      properties: { CLAB_ID: String(id), ENGLISH_NAME: 'FORT GEORGE 1', FRENCH_NAME: 'FORT GEORGE NO 1' },
    })
    const fetcher: Fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        features: [
          reserve(1),
          { geometry: { type: 'Point', coordinates: [-122.5, 54] }, properties: { CLAB_ID: '2' } },
        ],
      }),
    })
    const { features, truncated } = await readLandCheck(findLandCheck('reserve'), block.geometry, fetcher)
    expect(features.map((feature) => feature.name)).toEqual(['Fort George 1'])
    expect(truncated).toBe(false)
    const many: Fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ features: [reserve(1), reserve(2), reserve(3)] }),
    })
    expect((await readLandCheck(findLandCheck('reserve'), block.geometry, many, undefined, 2)).truncated).toBe(true)
  })

  it("counts only the records of the catalogue's instruments", async () => {
    const fetcher: Fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        features: [
          {
            geometry: block.geometry,
            properties: { PARCEL_FABRIC_POLY_ID: 1, PID_FORMATTED: '1', OWNER_TYPE: 'Private' },
          },
          {
            geometry: block.geometry,
            properties: { PARCEL_FABRIC_POLY_ID: 2, PID_FORMATTED: '2', OWNER_TYPE: 'Crown Provincial' },
          },
        ],
      }),
    })
    const { features } = await readLandCheck(findLandCheck('private'), block.geometry, fetcher)
    expect(features.map((feature) => feature.name)).toEqual(['PID 1'])
  })

  it('measures the hectares of each block over a layer, and the landform beside it', () => {
    // Half the block, west side.
    const feature = { name: 'Fort George 1', geometry: square(-122.505, 54, 0.01) }
    const result = measureLandCheck('reserve', [feature], [block], landform)
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0].features).toEqual(['Fort George 1'])
    const blockHa = result.blocks[0].areaHa
    expect(blockHa).toBeGreaterThan(20)
    expect(blockHa).toBeLessThan(45)
    expect(result.landformHa).toBeGreaterThan(blockHa)
  })

  it('counts a layer in the landform but clear of the blocks as the landform only', () => {
    const feature = { name: 'Private parcel', geometry: square(-122.515, 53.985, 0.005) }
    const result = measureLandCheck('private', [feature], [block], landform)
    expect(result.blocks).toEqual([])
    expect(result.landformFeatures).toEqual(['Private parcel'])
    expect(landCheckSummary(findLandCheck('private'), { status: 'ready', result }).value).toMatch(/^In the landform/)
  })

  it('ignores slivers where boundaries drawn at different scales touch', () => {
    // A strip about 0.5 m wide along the block's east edge.
    const sliver = { name: 'Park', geometry: square(-122.49 - 0.000005, 54, 0.000005) }
    expect(measureLandCheck('park', [sliver], [block], null).blocks).toEqual([])
  })

  it('words an overlap as hectares in the block, with why it matters', () => {
    const feature = { name: 'Fort George 1', geometry: square(-122.505, 54, 0.01) }
    const state: LandCheckState = {
      status: 'ready',
      result: measureLandCheck('reserve', [feature], [block], null),
    }
    const summary = landCheckSummary(findLandCheck('reserve'), state)
    expect(summary.value).toMatch(/^\d+ ha in PL-1$/)
    expect(summary.tone).toBe('warning')
    expect(summary.note).toContain('outside provincial forest tenure')
  })

  it('sums the checks in one card and keeps each check as its own', () => {
    const clear: LandCheckState = { status: 'ready', result: measureLandCheck('treaty', [], [block], landform) }
    const states = Object.fromEntries(LAND_CHECKS.map((check) => [check.id, clear]))
    const all = landCheckMetrics(states, { unchecked: null })
    expect(all[0]).toMatchObject({ key: 'checks', value: 'Clear', tone: 'success' })
    expect(all.slice(1).map((row) => row.key)).toEqual(LAND_CHECKS.map((check) => `check-${check.id}`))

    const overlap = measureLandCheck('reserve', [{ name: 'R', geometry: block.geometry }], [block], null)
    const flagged = landCheckMetrics(
      { ...states, reserve: { status: 'ready', result: overlap }, park: { status: 'error', error: 'timed out' } },
      { unchecked: null },
    )
    expect(flagged[0]).toMatchObject({ value: '1 to review', tone: 'warning' })
    expect(flagged.find((row) => row.key === 'check-park')?.value).toBe('Not read')

    const loading = landCheckMetrics({}, { unchecked: null })
    expect(loading[0].value).toBe('Checking…')
  })

  it('says why nothing was checked', () => {
    const rows = landCheckMetrics({}, { unchecked: 'Add a cutblock to check the land under it.' })
    expect(rows).toEqual([expect.objectContaining({ key: 'checks', value: 'Not checked' })])
  })

  it('reads the blocks alone when the landform is too wide for one read, and gives no landform figure then', () => {
    const wide = square(-123, 53.5, 1)
    expect(landCheckFootprint([block.geometry], wide)).toEqual({
      footprint: { type: 'MultiPolygon', coordinates: [block.geometry.coordinates] },
      landform: null,
    })
    expect(landCheckFootprint([block.geometry], landform)).toEqual({
      footprint: { type: 'MultiPolygon', coordinates: [block.geometry.coordinates, landform.coordinates] },
      landform,
    })
    expect(landCheckFootprint([square(-124, 53, 0.3), square(-123.5, 53.5, 0.3)], null)).toBeNull()
    expect(landCheckFootprint([], landform)).toBeNull()
  })

  it('runs one check through the fetch it is given', async () => {
    const fetcher: Fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        features: [
          {
            geometry: block.geometry,
            properties: {
              ADMIN_AREA_SID: 1,
              PROTECTED_LANDS_NAME: 'TABOR MOUNTAIN PARK',
              PROTECTED_LANDS_DESIGNATION: 'PROVINCIAL PARK',
            },
          },
        ],
      }),
    })
    const result = await runLandCheck(findLandCheck('park'), block.geometry, [block], null, fetcher)
    expect(result.blocks[0].features).toEqual(['Tabor Mountain Park'])
  })

  it('reads a layer DataBC does not answer as Not read, naming the layer', async () => {
    const fetcher: Fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
    const error = await runLandCheck(findLandCheck('wha'), block.geometry, [block], null, fetcher).catch(
      (e: unknown) => e as Error,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(
      'DataBC answered 503 for WHSE_WILDLIFE_MANAGEMENT.WCP_WILDLIFE_HABITAT_AREA_POLY.',
    )
    const summary = landCheckSummary(findLandCheck('wha'), { status: 'error', error: (error as Error).message })
    expect(summary).toMatchObject({ value: 'Not read', tone: 'warning' })
  })

  it('prints every layer for a file, a reading or failed layer as Not read and never None', () => {
    const clear: LandCheckState = { status: 'ready', result: measureLandCheck('treaty', [], [block], landform) }
    const overlap = measureLandCheck('reserve', [{ name: 'R', geometry: block.geometry }], [block], null)
    const states = {
      ...Object.fromEntries(LAND_CHECKS.map((check) => [check.id, clear])),
      reserve: { status: 'ready', result: overlap } as LandCheckState,
      park: { status: 'error', error: 'timed out' } as LandCheckState,
      ogma: { status: 'loading' } as LandCheckState,
    }
    const rows = landCheckReportRows(states, { unchecked: null })
    expect(rows.map((row) => row.label)).toEqual(LAND_CHECKS.map((check) => check.label))
    const by = (id: string) => rows[LAND_CHECKS.findIndex((check) => check.id === id)]
    expect(by('treaty')).toMatchObject({ value: 'None', review: false, reading: false })
    expect(by('reserve').review).toBe(true)
    expect(by('park')).toMatchObject({ value: 'Not read', review: true, reading: false })
    expect(by('ogma')).toMatchObject({ value: 'Not read', review: true, reading: true })
    expect(landChecksPending(states)).toBe(1)
    expect(landChecksPending({})).toBe(LAND_CHECKS.length)
    expect(landCheckReportRows({}, { unchecked: 'Add a cutblock.' })).toEqual([
      { label: 'Land checks', value: 'Not checked', note: 'Add a cutblock.', review: true, reading: false },
    ])
  })
  it('prints the same rows, cards and block note sheet as before the shared reader, for the same layers', async () => {
    const block2 = { name: 'PL-2', geometry: square(-122.48, 54.01, 0.005) }
    const f = (properties: Record<string, unknown>, geometry: PolygonGeometry) => ({ properties, geometry })
    // One answer per layer, as DataBC would give it inside the catalogue's filter.
    const ANSWERS: Record<string, unknown[]> = {
      'WHSE_LEGAL_ADMIN_BOUNDARIES.FNT_TREATY_LAND_SP': [
        f(
          { TREATY_LAND_ID: 1, FIRST_NATION_NAME: 'A Nation', TREATY: 'A', LAND_TYPE: 'Treaty Settlement Land' },
          square(-122.505, 54, 0.01),
        ),
      ],
      'WHSE_ADMIN_BOUNDARIES.CLAB_INDIAN_RESERVES': [
        f({ CLAB_ID: '01', ENGLISH_NAME: 'FORT GEORGE 1' }, square(-122.515, 53.985, 0.005)),
      ],
      'WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW': [
        f(
          { PARCEL_FABRIC_POLY_ID: 30, PID_FORMATTED: '000-000-001', OWNER_TYPE: 'Private' },
          square(-122.5, 54, 0.004),
        ),
        f({ PARCEL_FABRIC_POLY_ID: 31, PLAN_NUMBER: 'PGP123', OWNER_TYPE: 'Private' }, square(-122.495, 54.005, 0.004)),
        f({ PARCEL_FABRIC_POLY_ID: 32, OWNER_TYPE: 'Private' }, square(-122.479, 54.011, 0.002)),
      ],
      'WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW': [],
      'WHSE_WATER_MANAGEMENT.WLS_COMMUNITY_WS_PUB_SVW': [
        f({ WLS_CW_SYSID: 3, CW_CODE: '123.456' }, square(-122.51, 53.99, 0.03)),
      ],
      'WHSE_LAND_USE_PLANNING.RMP_OGMA_LEGAL_CURRENT_SVW': [
        f(
          { LEGAL_OGMA_INTERNAL_ID: 4, LEGAL_OGMA_PROVID: 'PRG_OGMA_1', OGMA_TYPE: 'LEGAL' },
          square(-122.5, 54.008, 0.002),
        ),
      ],
      'WHSE_WILDLIFE_MANAGEMENT.WCP_UNGULATE_WINTER_RANGE_SP': [
        f(
          {
            UNGULATE_WINTER_RANGE_ID: 5,
            UWR_NUMBER: 'u-7-022',
            UWR_UNIT_NUMBER: 'PG 1',
            SPECIES_1: 'M-ORAM',
            TIMBER_HARVEST_CODE: 'CONDITIONAL HARVEST ZONE',
          },
          square(-122.52, 53.98, 0.05),
        ),
      ],
      'WHSE_WILDLIFE_MANAGEMENT.WCP_WILDLIFE_HABITAT_AREA_POLY': [
        f({ HABITAT_AREA_ID: 6, TAG: '7-001', COMMON_SPECIES_NAME: 'Caribou' }, square(-122.519, 53.981, 0.003)),
      ],
      'WHSE_FOREST_TENURE.FTEN_RECREATION_POLY_SVW': [
        f(
          {
            RMF_SKEY: 7,
            FOREST_FILE_ID: 'REC160984',
            PROJECT_NAME: 'TABOR MTN. STAGING AREA 8',
            PROJECT_TYPE: 'Recreation Site',
            LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
          },
          square(-122.485, 54.0, 0.003),
        ),
      ],
    }
    const fetcher: Fetch = async (_url, init) => {
      const layer = (new URLSearchParams(init?.body).get('typeNames') ?? '').replace(/^pub:/, '')
      return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: ANSWERS[layer] }) }
    }
    const read = landCheckFootprint([block.geometry, block2.geometry], landform)!
    const states: Record<string, LandCheckState> = {}
    for (const check of LAND_CHECKS)
      states[check.id] = {
        status: 'ready',
        result: await runLandCheck(check, read.footprint, [block, block2], read.landform, fetcher),
      }
    const rows = landCheckReportRows(states, { unchecked: null })
    // Written before the checks read through the ground catalogue, from the same features.
    const before: Array<[string, string, string, boolean]> = [
      [
        'Treaty land',
        '36 ha in PL-1',
        'PL-1: 36 ha over A Nation · Treaty Settlement Land. Modern treaty settlement land: the First Nation owns it, and provincial forest tenure does not apply.',
        true,
      ],
      [
        'Indian reserve',
        'In the landform · 18 ha',
        'No block overlaps it; the landform holds Fort George 1. Federal reserve land (Canada Lands Survey): outside provincial forest tenure.',
        false,
      ],
      [
        'Private land',
        '26 ha in 2 blocks',
        'PL-1: 23 ha over PID 000-000-001, Plan PGP123; PL-2: 2.9 ha over Private parcel. ParcelMap BC private parcels: not Crown land; in a landform it can leave the denominator (step 3, Private land).',
        true,
      ],
      [
        'Park or protected area',
        'None',
        'No block or landform overlaps it. Provincial parks, ecological reserves and protected areas: no timber harvesting.',
        false,
      ],
      [
        'Community watershed',
        '73 ha in PL-1',
        'PL-1: 73 ha over 123.456. A designated community watershed: FRPA water-quality objectives apply.',
        true,
      ],
      [
        'Old growth management area',
        '2.9 ha in PL-1',
        'PL-1: 2.9 ha over OGMA PRG_OGMA_1. Legal old growth management area: harvest is restricted.',
        true,
      ],
      [
        'Ungulate winter range',
        '91 ha in 2 blocks',
        'PL-1: 73 ha over u-7-022 · PG 1 · M-ORAM · CONDITIONAL HARVEST ZONE; PL-2: 18 ha over u-7-022 · PG 1 · M-ORAM · CONDITIONAL HARVEST ZONE. Approved ungulate winter range: its general wildlife measures limit harvest (timber harvest code).',
        true,
      ],
      [
        'Wildlife habitat area',
        'In the landform · 6.5 ha',
        'No block overlaps it; the landform holds 7-001 · Caribou. Approved wildlife habitat area: its general wildlife measures limit harvest (timber harvest code).',
        false,
      ],
      [
        'Recreation site or trail',
        'In the landform · 6.5 ha',
        'No block overlaps it; the landform holds Tabor Mtn. Staging Area 8. An established recreation site or trail (FTEN): a sensitive viewpoint and a FRPA s. 56 objective.',
        false,
      ],
    ]
    expect(rows.map((row) => [row.label, row.value, row.note, row.review])).toEqual(before)
    const cards = landCheckMetrics(states, { unchecked: null })
    expect(cards[0]).toEqual({
      key: 'checks',
      label: 'Land checks',
      qualifier: 'blocks and landform',
      value: '5 to review',
      note: 'Treaty land: 36 ha in PL-1 · Indian reserve: In the landform · 18 ha · Private land: 26 ha in 2 blocks · Park or protected area: None · Community watershed: 73 ha in PL-1 · Old growth management area: 2.9 ha in PL-1 · Ungulate winter range: 91 ha in 2 blocks · Wildlife habitat area: In the landform · 6.5 ha · Recreation site or trail: In the landform · 6.5 ha. A screen from DataBC, not a legal determination.',
      tone: 'warning',
    })
    expect(cards.slice(1).map((card) => [card.label, card.value, card.note])).toEqual(
      before.map(([label, value, note]) => [label, value, note]),
    )

    // The block note prints the rows as they stand (`useVisualsExport` hands them over unchanged).
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      await blockNoteWorkbook(
        {
          blockName: 'PL-1',
          header: [],
          visuals: { text: '', drafted: false },
          sentences: [],
          landform: [],
          views: [],
          planMap: null,
          notes: [],
          generatedAt: new Date('2026-11-24T12:00:00Z'),
          landStatus: {
            rows: rows.map(({ label, value, note }) => ({ label, value, note })),
            caveat: LAND_CHECK_CAVEAT,
          },
        },
        ExcelJS,
      ),
    )
    const sheet = workbook.getWorksheet(LAND_STATUS_TITLE)!
    expect(before.map((_, i) => (sheet.getRow(5 + i).values as unknown[]).slice(1))).toEqual(
      before.map(([label, value, note]) => [label, value, note]),
    )
  })

  it('lists treaty land and reserves in the catalogue as context layers, with no instrument', () => {
    for (const id of ['treaty-lands', 'indian-reserves']) {
      const layer = GROUND_CATALOGUE.layers.find((l) => l.id === id)!
      expect(layer.context, id).toMatch(/no instrument here has reach cells/i)
      expect(
        GROUND_CATALOGUE.instruments.some((x) => x.layer === id),
        id,
      ).toBe(false)
    }
  })
})
