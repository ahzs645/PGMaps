import { describe, expect, it } from 'vitest'

import {
  BC_LAYER_SOURCES,
  bcLayerUrl,
  cutblockAge,
  describeBoatLaunch,
  describeCutblock,
  describeDepthChart,
  describeForestRoad,
  parseCoastalLaunches,
  parseCutblocks,
  parseDepthCharts,
  parseDepthContours,
  parseForestRoads,
  parseRecLaunches,
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

describe('bcLayerUrl', () => {
  it('puts the box in CQL_FILTER with the layer’s own geometry column, longitude first', () => {
    const roads = new URL(bcLayerUrl('forestRoads', TACHIE)).searchParams
    expect(roads.get('CQL_FILTER')).toBe("BBOX(GEOMETRY,-124.95000,54.60000,-124.55000,54.80000,'EPSG:4326')")
    expect(roads.has('bbox')).toBe(false)
    const blocks = new URL(bcLayerUrl('cutblocks', TACHIE)).searchParams
    expect(blocks.get('CQL_FILTER')).toMatch(/^BBOX\(SHAPE,/)
  })

  it('reads small layers whole and keeps their own filter', () => {
    const launches = new URL(bcLayerUrl('recLaunches')).searchParams
    expect(launches.get('CQL_FILTER')).toContain("STRUCTURE_DESC1 LIKE 'Boat Launch%'")
    expect(launches.get('CQL_FILTER')).toContain("STRUCTURE_DESC10 LIKE 'Boat Launch%'")
    expect(launches.get('CQL_FILTER')).not.toContain('BBOX')
    expect(new URL(bcLayerUrl('coastalLaunches')).searchParams.has('CQL_FILTER')).toBe(false)
  })

  it('refuses a view-bound layer without a box', () => {
    expect(() => bcLayerUrl('cutblocks')).toThrow(/bounding box/)
  })

  it('asks for the geometry column alongside the listed fields', () => {
    for (const [layer, source] of Object.entries(BC_LAYER_SOURCES)) {
      const columns = new URL(bcLayerUrl(layer as keyof typeof BC_LAYER_SOURCES, TACHIE)).searchParams
        .get('propertyName')
        ?.split(',')
      expect(columns).toContain(source.geometryColumn)
    }
  })
})

describe('forest roads', () => {
  const payload = {
    features: [
      feature(line, {
        OBJECTID: 1,
        FOREST_FILE_ID: '7470',
        ROAD_SECTION_NAME: 'PINCHI SOUTH EAST',
        FILE_TYPE_DESCRIPTION: 'Forest Service Road',
        LIFE_CYCLE_STATUS_CODE: 'RETIRED',
        CLIENT_NAME: 'BC TIMBER SALES',
      }),
      feature(line, {
        OBJECTID: 2,
        FOREST_FILE_ID: 'R19047',
        ROAD_SECTION_NAME: 'R19047',
        FILE_TYPE_DESCRIPTION: 'Road Permit',
        LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
      }),
      feature(point, { OBJECTID: 3 }),
    ],
  }

  it('tells Forest Service Roads from permit roads and keeps only real names', () => {
    const { collection } = parseForestRoads(payload)
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
    const [retired, active] = parseForestRoads(payload).collection.features.map((row) =>
      describeForestRoad(row.properties),
    )
    expect(retired.title).toBe('Pinchi South East (Forest Service Road)')
    expect(retired.caution).toMatch(/Retired tenure/)
    expect(active.title).toBe('Road Permit')
    expect(active.caution).toMatch(/not road condition/)
  })
})

describe('cutblocks', () => {
  it('classes a block by years since harvest started', () => {
    expect(cutblockAge(2024, 2026)).toBe('fresh')
    expect(cutblockAge(2021, 2026)).toBe('fresh')
    expect(cutblockAge(2020, 2026)).toBe('young')
    expect(cutblockAge(2011, 2026)).toBe('young')
    expect(cutblockAge(2010, 2026)).toBe('regrowing')
    expect(cutblockAge(1995, 2026)).toBe('old')
    expect(cutblockAge(null, 2026)).toBe('unknown')
  })

  it('reads year, area in hectares and source', () => {
    const { collection } = parseCutblocks(
      {
        features: [
          feature(square, {
            VCCB_SYSID: 46,
            HARVEST_START_YEAR_CALENDAR: 2000,
            PERCENT_CLEARCUT: 100,
            DATA_SOURCE: 'Satellite Imagery - Change Detection',
            FEATURE_AREA_SQM: 123456.7,
          }),
          feature(square, { VCCB_SYSID: 47 }),
        ],
      },
      2026,
    )
    expect(collection.features[0].properties).toEqual({
      id: '46',
      harvestYear: 2000,
      age: 'regrowing',
      areaHa: 12.3,
      clearcutPercent: 100,
      source: 'Satellite Imagery - Change Detection',
    })
    expect(collection.features[1].properties.age).toBe('unknown')
    const card = describeCutblock(collection.features[0].properties, 2026)
    expect(card.title).toBe('Cutblock, harvested 2000')
    expect(card.lines[0]).toBe('26 years since harvest started')
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
