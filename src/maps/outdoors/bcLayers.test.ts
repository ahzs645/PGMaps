import { describe, expect, it } from 'vitest'

import { BC_HARVEST_SERVICE } from '@/lib/forestry/bcHarvest'
import { BC_ROADS_SERVICE } from '@/lib/forestry/bcForestRoads'
import { MAX_VEGETATION_QUERY_DEGREES } from '@/lib/forestry/bcVegetationWfs'

import {
  ALL_ROADS_MIN_ZOOM,
  arcgisPageUrl,
  chartSheetsOf,
  clampBounds,
  CUTBLOCK_READ,
  describeBoatLaunch,
  describeCutblock,
  describeDepthChart,
  describeForestRoad,
  depthBandColor,
  describeStand,
  forestRoadReads,
  generalisationDegrees,
  layerQueryBounds,
  MAX_BC_QUERY_DEGREES,
  parseArcgisPage,
  readArcgis,
  WFS_SOURCES,
  wfsLayerUrl,
  huntZoneFilter,
  opennessOf,
  parseCoastalLaunches,
  CUTBLOCK_CLASSES,
  parseCutblocks,
  parseDepthCharts,
  parseDepthContours,
  parseForestRoads,
  parseHuntZones,
  parseRecLaunches,
  parseStands,
  secureUrl,
  titleCase,
  type Bounds,
} from './bcLayers'

// The Tachie River, between Trembleur and Stuart lakes: TROPIK's first test case.
const TACHIE: Bounds = [-124.95, 54.6, -124.55, 54.8]

const line = {
  type: 'LineString',
  coordinates: [
    [-124.7, 54.7],
    [-124.71, 54.71],
  ],
}
const square = {
  type: 'Polygon',
  coordinates: [
    [
      [-124.7, 54.7],
      [-124.69, 54.7],
      [-124.69, 54.71],
      [-124.7, 54.7],
    ],
  ],
}
const point = { type: 'Point', coordinates: [-124.7, 54.7] }
const feature = (geometry: unknown, properties: Record<string, unknown>) => ({ type: 'Feature', geometry, properties })

describe('wfsLayerUrl', () => {
  it('puts the box in CQL_FILTER with the layer’s own geometry column, longitude first', () => {
    const charts = new URL(wfsLayerUrl('depthCharts', TACHIE)).searchParams
    expect(charts.get('CQL_FILTER')).toBe("BBOX(GEOMETRY,-124.95000,54.60000,-124.55000,54.80000,'EPSG:4326')")
    expect(charts.has('bbox')).toBe(false)
  })

  it('reads small layers whole and keeps their own filter', () => {
    const launches = new URL(wfsLayerUrl('recLaunches')).searchParams
    expect(launches.get('CQL_FILTER')).toContain("STRUCTURE_DESC1 LIKE 'Boat Launch%'")
    expect(launches.get('CQL_FILTER')).toContain("STRUCTURE_DESC10 LIKE 'Boat Launch%'")
    expect(launches.get('CQL_FILTER')).not.toContain('BBOX')
    expect(new URL(wfsLayerUrl('coastalLaunches')).searchParams.has('CQL_FILTER')).toBe(false)
  })

  it('refuses a view-bound layer without a box', () => {
    expect(() => wfsLayerUrl('huntZones')).toThrow(/bounding box/)
  })

  it('asks for the geometry column alongside the listed fields', () => {
    for (const [layer, source] of Object.entries(WFS_SOURCES)) {
      const columns = new URL(wfsLayerUrl(layer as keyof typeof WFS_SOURCES, TACHIE)).searchParams
        .get('propertyName')
        ?.split(',')
      expect(columns).toContain(source.geometryColumn)
    }
  })

  it('reads stands from the shared VRI endpoint, inside the shared VRI box limit', () => {
    const wide: Bounds = [-125.5, 54.2, -124, 55.2]
    const url = new URL(wfsLayerUrl('stands', wide))
    expect(url.pathname).toContain('VEG_COMP_LYR_R1_POLY')
    const [west, south, east, north] = layerQueryBounds('stands', wide)
    expect(east - west).toBeCloseTo(MAX_VEGETATION_QUERY_DEGREES)
    expect(north - south).toBeCloseTo(MAX_VEGETATION_QUERY_DEGREES)
  })

  it('clamps a province-wide box about its centre and leaves a small one alone', () => {
    const [west, south, east, north] = clampBounds([-140, 40, -110, 62])
    expect(east - west).toBeCloseTo(MAX_BC_QUERY_DEGREES)
    expect(north - south).toBeCloseTo(MAX_BC_QUERY_DEGREES)
    expect((west + east) / 2).toBeCloseTo(-125)
    clampBounds(TACHIE).forEach((value, index) => expect(value).toBeCloseTo(TACHIE[index], 9))
  })
})

describe('ArcGIS reads', () => {
  it('reads forest roads from the road designer’s source, Forest Service Roads first', () => {
    const wide = forestRoadReads(9)
    expect(wide).toHaveLength(1)
    expect(wide[0].service).toBe(BC_ROADS_SERVICE)
    expect(wide[0].where).toBe("FILE_TYPE_CODE='B40'")
    const close = forestRoadReads(ALL_ROADS_MIN_ZOOM)
    expect(close.map((read) => read.where)).toEqual(["FILE_TYPE_CODE='B40'", "FILE_TYPE_CODE<>'B40'"])
  })

  it('reads cutblocks from the designer’s harvest source, newest first', () => {
    expect(CUTBLOCK_READ.service).toBe(BC_HARVEST_SERVICE)
    expect(CUTBLOCK_READ.orderBy).toMatch(/^HARVEST_START_YEAR_CALENDAR DESC/)
  })

  it('asks for one page at a time, generalised to the zoom', () => {
    const url = new URL(arcgisPageUrl(CUTBLOCK_READ, TACHIE, 12, 2))
    expect(url.origin + url.pathname).toBe(`${BC_HARVEST_SERVICE}/query`)
    expect(url.searchParams.get('geometry')).toBe('-124.95,54.6,-124.55,54.8')
    expect(url.searchParams.get('resultOffset')).toBe('2000')
    expect(url.searchParams.get('resultRecordCount')).toBe('1000')
    expect(Number(url.searchParams.get('maxAllowableOffset'))).toBeCloseTo(generalisationDegrees(12), 6)
    expect(generalisationDegrees(20)).toBe(generalisationDegrees(14))
  })

  it('refuses an error answer and reads whether the service holds more', () => {
    expect(() => parseArcgisPage({ error: { message: 'Invalid query' } })).toThrow(/Invalid query/)
    expect(() => parseArcgisPage({})).toThrow(/no feature collection/)
    expect(parseArcgisPage({ features: [], properties: { exceededTransferLimit: true } }).more).toBe(true)
    expect(parseArcgisPage({ features: [], exceededTransferLimit: true }).more).toBe(true)
    expect(parseArcgisPage({ features: [] }).more).toBe(false)
  })

  it('follows pages to the read’s limit and calls a cut-short answer truncated', async () => {
    const asked: string[] = []
    const fetcher = (async (input: RequestInfo | URL) => {
      asked.push(new URL(String(input)).searchParams.get('resultOffset') ?? '')
      return new Response(
        JSON.stringify({ features: [feature(line, {})], properties: { exceededTransferLimit: true } }),
      )
    }) as typeof fetch
    const answer = await readArcgis([CUTBLOCK_READ], TACHIE, 12, new AbortController().signal, fetcher)
    expect(asked).toEqual(['0', '1000', '2000'])
    expect(answer.features).toHaveLength(3)
    expect(answer.truncated).toBe(true)
  })

  it('stops at the page that holds the rest', async () => {
    let calls = 0
    const fetcher = (async () => {
      calls += 1
      return new Response(JSON.stringify({ features: [], properties: { exceededTransferLimit: calls < 2 } }))
    }) as typeof fetch
    const answer = await readArcgis([CUTBLOCK_READ], TACHIE, 12, new AbortController().signal, fetcher)
    expect(calls).toBe(2)
    expect(answer.truncated).toBe(false)
  })
})

describe('forest roads', () => {
  const features = [
    feature(line, {
      OBJECTID: 1,
      FOREST_FILE_ID: '7470',
      ROAD_SECTION_NAME: 'PINCHI SOUTH EAST',
      FILE_TYPE_CODE: 'B40',
      FILE_TYPE_DESCRIPTION: 'Forest Service Road',
      LIFE_CYCLE_STATUS_CODE: 'RETIRED',
      CLIENT_NAME: 'BC TIMBER SALES',
    }),
    feature(line, {
      OBJECTID: 2,
      FOREST_FILE_ID: 'R19047',
      ROAD_SECTION_NAME: 'R19047',
      FILE_TYPE_CODE: 'B01',
      FILE_TYPE_DESCRIPTION: 'Road Permit',
      LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
    }),
    feature(point, { OBJECTID: 3 }),
  ]

  it('tells Forest Service Roads from permit roads by file type and keeps only real names', () => {
    const collection = parseForestRoads(features)
    expect(collection.features).toHaveLength(2)
    expect(collection.features[0].properties).toMatchObject({
      name: 'Pinchi South East',
      fsr: true,
      retired: true,
      holder: 'BC TIMBER SALES',
    })
    // A section named after its own file number has no name worth showing.
    expect(collection.features[1].properties).toMatchObject({ name: null, fsr: false, retired: false })
  })

  it('never reads tenure status as road condition', () => {
    const [retired, active] = parseForestRoads(features).features.map((row) => describeForestRoad(row.properties))
    expect(retired.title).toBe('Pinchi South East (Forest Service Road)')
    expect(retired.caution).toMatch(/Retired tenure/)
    expect(active.title).toBe('Road Permit')
    expect(active.caution).toMatch(/not road condition/)
  })
})

describe('cutblocks', () => {
  it('ages a block by the road designer’s rule, with its colours', () => {
    const block = (properties: Record<string, unknown>) => feature(square, { OBJECTID: 1, ...properties })
    const collection = parseCutblocks(
      [
        block({ VCCB_SYSID: 46, HARVEST_START_YEAR_CALENDAR: 2020, AREA_HA: 12.34, DATA_SOURCE: 'RESULTS' }),
        block({ VCCB_SYSID: 47, HARVEST_START_YEAR_CALENDAR: 2000, HARVEST_MID_YEAR_CALENDAR: 2000 }),
        block({ VCCB_SYSID: 48 }),
      ],
      2026,
    )
    const [started, older, unknown] = collection.features.map((row) => row.properties)
    // A start year alone gives no completion, so the designer will not class it.
    expect(started).toMatchObject({ id: '46', age: 'unknown', areaHa: 12.3, source: 'RESULTS' })
    expect(started.summary).toBe('Harvest started 2020 · completion unknown')
    expect(older).toMatchObject({ age: 'medium', color: CUTBLOCK_CLASSES[1].color })
    expect(unknown.age).toBe('unknown')
    expect(describeCutblock(older).lines[0]).toMatch(/26 calendar years since estimated harvest/)
  })

  it('draws a record the rule cannot read as unknown rather than dropping it', () => {
    const collection = parseCutblocks(
      [feature(square, { VCCB_SYSID: 9, HARVEST_START_YEAR_CALENDAR: 2030, HARVEST_MID_YEAR_CALENDAR: 1990 })],
      2026,
    )
    expect(collection.features[0].properties.age).toBe('unknown')
  })
})

describe('boat launches', () => {
  it('keeps recreation sites that list a launch, with its surface', () => {
    const { collection } = parseRecLaunches({
      features: [
        feature(point, {
          FOREST_FILE_ID: 'REC2484',
          PROJECT_NAME: 'Mitten Lake',
          SITE_LOCATION: 'PARSON',
          MAINTAIN_STD_DESC: 'Maintained to Standard',
          STRUCTURE_DESC1: 'Toilet - Wood',
          STRUCTURE_DESC4: 'Boat Launch - Gravel',
        }),
        feature(point, { FOREST_FILE_ID: 'REC1', PROJECT_NAME: 'No Launch Here', STRUCTURE_DESC1: 'Table - Log' }),
      ],
    })
    expect(collection.features).toHaveLength(1)
    expect(collection.features[0].properties).toEqual({
      id: 'rec-REC2484',
      name: 'Mitten Lake recreation site',
      source: 'Recreation site',
      surface: 'Gravel',
      detail: 'Near Parson · Maintained to Standard',
    })
    expect(describeBoatLaunch(collection.features[0].properties).lines[0]).toBe('Boat launch, gravel')
  })

  it('flags coastal launches as coming from an old atlas', () => {
    const { collection } = parseCoastalLaunches({
      features: [feature(point, { BOAT_LAUNCH_ID: 161, LOCATION: 'Becher Bay', COMMENTS: ' ' })],
    })
    expect(collection.features[0].properties).toMatchObject({ id: 'coast-161', name: 'Becher Bay', detail: null })
    expect(describeBoatLaunch(collection.features[0].properties).caution).toMatch(/1990s coastal atlas/)
  })
})

describe('lake depth', () => {
  it('upgrades the chart link to https and refuses any other host', () => {
    expect(secureUrl('http://a100.gov.bc.ca/pub/fidq/downloadBathymetricMap.do?filename=00334101.pdf')).toBe(
      'https://a100.gov.bc.ca/pub/fidq/downloadBathymetricMap.do?filename=00334101.pdf',
    )
    expect(secureUrl('http://example.com/chart.pdf')).toBeNull()
    expect(secureUrl('javascript:alert(1)')).toBeNull()
    expect(secureUrl(null)).toBeNull()
  })

  it('reads a chart sheet', () => {
    const { collection } = parseDepthCharts({
      features: [
        feature(square, {
          OBJECTID: 9,
          GAZETTED_NAME: 'STUART LAKE',
          DRAFT_DATE: '1953-07-01Z',
          MAP_SCALE: 48000,
          SHEET_NO: 2,
          NUMBER_OF_MAP_SHEETS: 3,
          PDF_FILE_URL: 'http://a100.gov.bc.ca/pub/fidq/downloadBathymetricMap.do?filename=00334102.pdf',
        }),
      ],
    })
    const chart = collection.features[0].properties
    expect(chart).toMatchObject({ lake: 'Stuart Lake', surveyYear: 1953, scale: 48000, sheet: 2, sheets: 3 })
    const card = describeDepthChart(chart)
    expect(card.title).toBe('Stuart Lake depth chart')
    expect(card.lines[0]).toBe('Charted 1953 · 1:48,000 · sheet 2 of 3')
    expect(card.caution).toMatch(/Not for navigation/)
  })

  it('orders contours shallow to deep so deeper water draws on top', () => {
    const contour = (depth: unknown) =>
      feature(square, { LAKE_GAZETTED_NAME: 'Cunningham Lake', CONTOUR_DEPTH_M: depth, LAKE_MAX_DEPTH_M: 64.92 })
    const { collection } = parseDepthContours({ features: [contour(30), contour(10), contour('20'), contour(null)] })
    expect(collection.features.map((row) => row.properties.depthM)).toEqual([10, 20, 30])
  })
})

describe('titleCase', () => {
  it('quiets the inventories’ capitals', () => {
    expect(titleCase('PINCHI SOUTH EAST')).toBe('Pinchi South East')
    expect(titleCase('FORT ST. JAMES')).toBe('Fort St. James')
    expect(titleCase("O'CONNOR-BLACK LAKE")).toBe("O'connor-Black Lake")
  })
})

describe('depth bands and chart sheets', () => {
  it('colours a contour by the band its depth starts', () => {
    expect(depthBandColor(0)).toBe('#bae6fd')
    expect(depthBandColor(3)).toBe('#7dd3fc')
    expect(depthBandColor(10)).toBe('#38bdf8')
    expect(depthBandColor(30)).toBe('#0284c7')
    expect(depthBandColor(90)).toBe('#1e1b4b')
  })

  it('drops the inventory’s 99999 island marker', () => {
    const contour = (depth: number) => feature(square, { LAKE_GAZETTED_NAME: 'Pinchi Lake', CONTOUR_DEPTH_M: depth })
    const { collection } = parseDepthContours({ features: [contour(99999), contour(0), contour(60)] })
    expect(collection.features.map((row) => row.properties.depthM)).toEqual([0, 60])
  })

  it('gives every sheet the whole chart it belongs to, in order', () => {
    const sheet = (id: number, lake: string, sheetNo: number, file: string) =>
      feature(square, {
        OBJECTID: id,
        GAZETTED_NAME: lake,
        DRAFT_DATE: '1953-07-01Z',
        SHEET_NO: sheetNo,
        NUMBER_OF_MAP_SHEETS: 3,
        PDF_FILE_URL: `http://a100.gov.bc.ca/pub/fidq/downloadBathymetricMap.do?filename=${file}`,
      })
    const charts = parseDepthCharts({
      features: [
        sheet(1, 'STUART LAKE', 3, 'c.pdf'),
        sheet(2, 'STUART LAKE', 1, 'a.pdf'),
        sheet(3, 'KAZCHEK LAKE', 1, 'k.pdf'),
        sheet(4, 'STUART LAKE', 2, 'b.pdf'),
      ],
    }).collection.features.map((row) => row.properties as unknown as Record<string, unknown>)
    const stuart = chartSheetsOf(charts[3])
    expect(stuart.map((entry) => entry.sheet)).toEqual([1, 2, 3])
    expect(stuart[0].url).toBe('https://a100.gov.bc.ca/pub/fidq/downloadBathymetricMap.do?filename=a.pdf')
    expect(chartSheetsOf(charts[2])).toHaveLength(1)
    expect(chartSheetsOf({ chartSheets: '[{"sheet":1,"url":"https://example.com/x.pdf"}]' })).toEqual([])
    expect(chartSheetsOf({})).toEqual([])
  })
})

describe('limited entry zones', () => {
  it('filters by one species from the fixed list and ANDs it with the box', () => {
    expect(huntZoneFilter('MOOSE')).toBe("LTD_ENTRY_HUNTING_ZONE_TYPE='MOOSE'")
    const filter = new URL(wfsLayerUrl('huntZones', TACHIE, huntZoneFilter('MULE DEER'))).searchParams.get('CQL_FILTER')
    expect(filter).toMatch(/^BBOX\(GEOMETRY,.*\) AND \(LTD_ENTRY_HUNTING_ZONE_TYPE='MULE DEER'\)$/)
  })

  it('reads a zone with the id that joins it to the draw report', () => {
    const { collection } = parseHuntZones({
      features: [
        feature(square, {
          LEHZ_SYSID: 77,
          LIMITED_ENTRY_HUNTING_ZONE: 'M_7-25A',
          MANAGEMENT_UNITS: '7-25',
          LTD_ENTRY_HUNTING_ZONE_TYPE: 'MOOSE',
          LTD_ENTRY_HUNTING_ZONE_LABEL: 'Zone A of 7-25',
          LEH_HUNT_AREA_ID: '725A',
        }),
        feature(square, { LEHZ_SYSID: 78 }),
      ],
    })
    expect(collection.features).toHaveLength(1)
    expect(collection.features[0].properties).toEqual({
      id: '77',
      species: 'Moose',
      label: 'Zone A of 7-25',
      units: '7-25',
      huntAreaId: '725A',
    })
  })
})

describe('forest openness', () => {
  it('reads sightlines from tree cover, height and crown closure', () => {
    expect(opennessOf({ treed: false, heightM: null, crownClosure: null })).toBe('open')
    expect(opennessOf({ treed: true, heightM: 1.2, crownClosure: 60 })).toBe('open')
    expect(opennessOf({ treed: true, heightM: 18, crownClosure: 5 })).toBe('open')
    expect(opennessOf({ treed: true, heightM: 18, crownClosure: 20 })).toBe('sparse')
    expect(opennessOf({ treed: true, heightM: 4, crownClosure: 60 })).toBe('brush')
    expect(opennessOf({ treed: true, heightM: 6, crownClosure: 30 })).toBe('brush')
    expect(opennessOf({ treed: true, heightM: 22, crownClosure: 40 })).toBe('timber')
    expect(opennessOf({ treed: true, heightM: 22, crownClosure: 70 })).toBe('dense')
  })

  it('reads treed ground with no figures as timber, the cautious call', () => {
    expect(opennessOf({ treed: true, heightM: null, crownClosure: null })).toBe('timber')
  })

  it('leaves out water and undescribed polygons', () => {
    const stand = (properties: Record<string, unknown>) => feature(square, properties)
    const { collection } = parseStands({
      features: [
        stand({
          FEATURE_ID: 1,
          BCLCS_LEVEL_1: 'V',
          BCLCS_LEVEL_2: 'T',
          PROJ_HEIGHT_1: 4.5,
          CROWN_CLOSURE: 65,
          PROJ_AGE_1: 14,
          SPECIES_CD_1: 'PLI',
        }),
        stand({ FEATURE_ID: 2, BCLCS_LEVEL_1: 'N', BCLCS_LEVEL_2: 'W' }),
        stand({ FEATURE_ID: 3, BCLCS_LEVEL_1: 'V', BCLCS_LEVEL_2: 'N' }),
        stand({ FEATURE_ID: 4 }),
      ],
    })
    expect(collection.features.map((row) => [row.properties.id, row.properties.openness])).toEqual([
      ['1', 'brush'],
      ['3', 'open'],
    ])
    const card = describeStand(collection.features[0].properties)
    expect(card.title).toBe('Eye-height regrowth')
    expect(card.lines).toEqual([
      'Sight blocked at eye height',
      'Crown closure 65%, trees about 5 m, 14 years old, leading species PLI',
    ])
    expect(card.caution).toMatch(/estimate from the forest inventory/)
  })
})
