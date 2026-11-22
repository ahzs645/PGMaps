import { expect, test, type Page, type Route } from '@playwright/test'
import { encode } from 'fast-png'
import { choose } from './styled-select'

/**
 * The outdoors planner's map layers (`docs/outdoors-planner-layers.md`) against stubbed services:
 * DataBC's WFS and ArcGIS layers, the BC catalogue, NASA GIBS and Esri Wayback. Only the
 * management units are live (PMTiles on R2), as the lake-click check needs a unit under the lake.
 */

// Inside management unit 7-25, west of Fort St. James.
const CENTRE: [number, number] = [-124.9, 54.7]
const square = (lon: number, lat: number, half: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [lon - half, lat - half],
      [lon + half, lat - half],
      [lon + half, lat + half],
      [lon - half, lat + half],
      [lon - half, lat - half],
    ],
  ],
})
const LAKE: [number, number] = [CENTRE[0] + 0.03, CENTRE[1]]
const headers = { 'Access-Control-Allow-Origin': '*' }
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features, numberMatched: features.length })
const feature = (geometry: unknown, properties: Record<string, unknown>) => ({ type: 'Feature', geometry, properties })
const PNG = Buffer.from(encode({ width: 256, height: 256, channels: 3, data: new Uint8Array(256 * 256 * 3).fill(90) }))

// As `leh.ts` and `wayback.ts` name them; importing those would load the map toolkit into the runner.
const LEH_DRAW_PACKAGE_URL =
  'https://catalogue.data.gov.bc.ca/api/3/action/package_show?id=50555048-1ab7-4f50-bb4a-8b8142f0cba5'
const WAYBACK_CATALOG = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json'
const WAYBACK_TILEMAP = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap'

const CSV_URL = 'https://catalogue.data.gov.bc.ca/dataset/test/resource/test/download/leh-test.csv'
const LEH_CSV = [
  'Draw Year,Species,Hunt Code,Area,LEH Hunt Area,Season One Open,Season One Close,Licence Description,Available Authorizations,First Choice Odds,First Choice Applicants,Youth Hunt,Shared Hunt',
  '2025,MOOSE,4377,Prince George,725A,09/10/2025,10/05/2025,Bull Only,13,6.7,87,,',
].join('\n')

/** Every service the layers read, stubbed; `asked` collects what each was asked. */
async function stubServices(page: Page) {
  const asked = { wfs: [] as string[], arcgis: [] as URL[], gibs: [] as string[] }
  await page.route('https://openmaps.gov.bc.ca/geo/pub/**', (route: Route) => {
    const url = new URL(route.request().url())
    const type = url.searchParams.get('typeNames') ?? ''
    asked.wfs.push(type)
    const features = type.includes('BATH_SURVEY_MAP_SHEETS')
      ? [1, 2].map((sheet) =>
          feature(square(LAKE[0] + (sheet - 1.5) * 0.01, LAKE[1], 0.005), {
            OBJECTID: sheet,
            GAZETTED_NAME: 'TEST LAKE',
            DRAFT_DATE: '1961-07-01Z',
            SHEET_NO: sheet,
            NUMBER_OF_MAP_SHEETS: 2,
            PDF_FILE_URL: `http://a100.gov.bc.ca/pub/fidq/downloadBathymetricMap.do?filename=test${sheet}.pdf`,
          }),
        )
      : type.includes('WAA_LTD_HNT_ZONE')
        ? [
            feature(square(CENTRE[0], CENTRE[1], 0.5), {
              LEHZ_SYSID: 7,
              LTD_ENTRY_HUNTING_ZONE_TYPE: 'MOOSE',
              LTD_ENTRY_HUNTING_ZONE_LABEL: 'Zone A of 7-25',
              MANAGEMENT_UNITS: '7-25',
              LEH_HUNT_AREA_ID: '725A',
            }),
          ]
        : []
    return route.fulfill({ headers, json: collection(features) })
  })
  await page.route('https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/**', (route) => {
    const url = new URL(route.request().url())
    asked.arcgis.push(url)
    const layer = url.pathname.split('/').at(-2)
    const features =
      layer === '543'
        ? [
            feature(square(CENTRE[0] - 0.01, CENTRE[1] + 0.01, 0.004), {
              VCCB_SYSID: 1,
              OBJECTID: 1,
              DATA_SOURCE: 'RESULTS',
              AREA_HA: 24.5,
              HARVEST_START_DATE: Date.parse('2019-01-10'),
              HARVEST_END_DATE: Date.parse('2019-03-01'),
              HARVEST_START_YEAR_CALENDAR: 2019,
              HARVEST_MID_YEAR_CALENDAR: 2019,
            }),
          ]
        : []
    return route.fulfill({ headers, json: collection(features) })
  })
  await page.route(LEH_DRAW_PACKAGE_URL, (route) =>
    route.fulfill({
      headers,
      json: { result: { resources: [{ format: 'csv', name: 'LEH Draw Hunt Code Report', url: CSV_URL }] } },
    }),
  )
  await page.route(CSV_URL, (route) => route.fulfill({ headers, contentType: 'text/csv', body: LEH_CSV }))
  await page.route('https://gibs.earthdata.nasa.gov/**', (route) => {
    asked.gibs.push(route.request().url())
    return route.fulfill({ headers, contentType: 'image/png', body: PNG })
  })
  const waybackTiles =
    'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile'
  await page.route(WAYBACK_CATALOG, (route) =>
    route.fulfill({
      headers,
      json: {
        10: {
          itemTitle: 'World Imagery (Wayback 2016-04-01)',
          itemURL: `${waybackTiles}/10/{level}/{row}/{col}`,
          metadataLayerUrl:
            'https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_10/MapServer',
        },
        20: { itemTitle: 'World Imagery (Wayback 2024-03-21)', itemURL: `${waybackTiles}/20/{level}/{row}/{col}` },
      },
    }),
  )
  // Release 20 reuses release 10's tile here: one release changes the picture.
  await page.route(`${WAYBACK_TILEMAP}/**`, (route) =>
    route.fulfill({
      headers,
      json: route.request().url().startsWith(`${WAYBACK_TILEMAP}/20/`) ? { data: [1], select: [10] } : { data: [1] },
    }),
  )
  await page.route('https://metadata.maptiles.arcgis.com/**', (route) =>
    route.fulfill({ headers, json: { features: [{ attributes: { SRC_DATE: 20150801, SRC_RES: 0.3 } }] } }),
  )
  await page.route(`${waybackTiles}/**`, (route) => route.fulfill({ headers, contentType: 'image/png', body: PNG }))
  return asked
}

/** Runs `fn` on the planner's MapLibre map, found through React's fiber like the other map specs. */
async function onMap<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ({ fn, arg }) => {
      const element = document.querySelector('.maplibregl-map')
      const key = element && Object.keys(element).find((name) => name.startsWith('__reactFiber$'))
      type Fiber = { memoizedProps?: { value?: { map?: unknown } }; return?: Fiber }
      let fiber = key ? (element as unknown as Record<string, Fiber>)[key] : undefined
      let map: unknown = null
      for (let depth = 0; fiber && depth < 200 && !map; depth++, fiber = fiber.return)
        map = fiber.memoizedProps?.value?.map ?? null
      if (!map) throw new Error('No map found')
      return new Function('map', 'arg', `return (${fn})(map, arg)`)(map, arg) as T
    },
    { fn, arg },
  )
}

async function openPlanner(page: Page, zoom: number) {
  await page.goto('/dev/outdoors')
  await expect(page.locator('.maplibregl-map')).toBeVisible()
  await expect.poll(() => onMap<boolean>(page, '(map) => map.isStyleLoaded()'), { timeout: 60_000 }).toBe(true)
  await onMap(page, '(map, view) => map.jumpTo(view)', { center: CENTRE, zoom })
}

const layerSwitch = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) })

async function mapPoint(page: Page, lonLat: [number, number]) {
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!
  const point = await onMap<{ x: number; y: number }>(page, '(map, p) => map.project(p)', lonLat)
  return { x: box.x + point.x, y: box.y + point.y }
}

test('reads cutblocks from the road designer’s source, newest first, and waits below their least zoom', async ({
  page,
}) => {
  const asked = await stubServices(page)
  await openPlanner(page, 10.5)
  await layerSwitch(page, 'Cutblocks').click()
  await expect(layerSwitch(page, 'Cutblocks')).toContainText('Zoom in to load (from zoom 12)')
  expect(asked.arcgis).toHaveLength(0)
  await onMap(page, '(map) => map.jumpTo({ zoom: 13 })')
  await expect(layerSwitch(page, 'Cutblocks')).toContainText('1 cutblock around this view')
  const read = asked.arcgis.find((url) => url.pathname.endsWith('/543/query'))!
  expect(read.searchParams.get('orderByFields')).toMatch(/^HARVEST_START_YEAR_CALENDAR DESC/)
  expect(Number(read.searchParams.get('maxAllowableOffset'))).toBeGreaterThan(0)
  // The designer's age classes: the legend under the switch is theirs.
  await expect(page.getByText('0–10 years since harvest')).toBeVisible()
})

test('a lake opens its chart sheets and leaves the unit beneath alone; the unit itself still answers', async ({
  page,
}) => {
  await stubServices(page)
  await openPlanner(page, 12)
  const units = page.getByTitle('Remove from plan')
  await expect(units).toHaveCount(0)
  await layerSwitch(page, 'Lake depth charts').click()
  await expect(layerSwitch(page, 'Lake depth charts')).toContainText('2 depth charts around this view')
  // Wait for the unit layer, which the lake must outrank.
  await expect
    .poll(() => onMap<boolean>(page, '(map) => map.getLayersOrder().some((id) => id.startsWith("pmtiles-fill"))'), {
      timeout: 60_000,
    })
    .toBe(true)
  await onMap(page, '(map) => new Promise((done) => map.once("idle", done))')
  const lake = await mapPoint(page, [LAKE[0] - 0.005, LAKE[1]])
  await page.mouse.click(lake.x, lake.y)
  const card = page.locator('.maplibregl-popup')
  await expect(card).toContainText('Test Lake depth chart')
  const links = card.getByRole('link')
  await expect(links).toHaveCount(2)
  await expect(links.first()).toHaveAttribute('href', /^https:\/\/a100\.gov\.bc\.ca\/.*test1\.pdf$/)
  await expect(links.first()).toHaveAttribute('target', '_blank')
  await expect(units).toHaveCount(0)
  // Off the lake, the same click adds the unit: the lake took the click, not a blocked map. The card
  // is closed first, as a click on the map while it is open only dismisses it.
  await card.getByRole('button', { name: 'Close popup' }).click()
  await expect(card).toHaveCount(0)
  const land = await mapPoint(page, [CENTRE[0] - 0.02, CENTRE[1] - 0.01])
  await page.mouse.click(land.x, land.y)
  await expect(units).toHaveCount(1)
})

test('a hunt zone card lists the last draw’s hunts for its hunt area', async ({ page }) => {
  await stubServices(page)
  await openPlanner(page, 9.5)
  await layerSwitch(page, 'Limited entry zones').click()
  await expect(layerSwitch(page, 'Limited entry zones')).toContainText('1 zone around this view')
  const inside = await mapPoint(page, [CENTRE[0] - 0.05, CENTRE[1] + 0.03])
  await expect(async () => {
    await page.mouse.move(inside.x, inside.y)
    await page.mouse.move(inside.x + 2, inside.y + 2)
    await expect(page.locator('.mapcn-tooltip')).toContainText('Bull Only · Sep 10 – Oct 5 · 13 tags · 6.7 to 1', {
      timeout: 2_000,
    })
  }).toPass({ timeout: 30_000 })
  await expect(page.locator('.mapcn-tooltip')).toContainText('2025 draw results, not the coming season.')
})

test('dated imagery steps NASA’s days on the shared timeline and switches to Wayback with its local changes', async ({
  page,
}) => {
  const asked = await stubServices(page)
  await openPlanner(page, 10)
  await layerSwitch(page, 'Dated imagery').click()
  const strip = page.getByRole('region', { name: 'Historical imagery timeline' })
  await expect(strip.getByRole('slider')).toBeVisible()
  await expect.poll(() => asked.gibs.length).toBeGreaterThan(0)
  const day = (url: string) => /\/default\/(\d{4}-\d{2}-\d{2})\//.exec(url)?.[1]
  const newest = day(asked.gibs[0])
  await strip.getByRole('slider').focus()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => asked.gibs.some((url) => day(url) && day(url)! < newest!)).toBe(true)

  await choose(page.getByRole('combobox', { name: 'Dated imagery source' }), { value: 'esri-wayback' })
  await expect(strip.getByTestId('outdoors-dated-count')).toHaveText('1 of 2')
  await expect(strip.getByTestId('outdoors-dated-captured')).toHaveText('Captured 2015-08-01 · 30 cm')
  await expect
    .poll(() => onMap<string[]>(page, '(map) => map.getLayersOrder().filter((id) => id.startsWith("outdoors-dated"))'))
    .not.toHaveLength(0)
})
