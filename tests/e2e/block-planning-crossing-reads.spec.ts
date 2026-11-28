import { test, expect, type Page, type Route } from '@playwright/test'
import { choose } from './styled-select'

/**
 * The sample's Block 1 lies at -122.7701 to -122.7611, 53.99 to 53.995. A road runs east-west
 * through it at 53.9925 and a stream crosses it at -122.765, with a PSCIS culvert there.
 */
const line = (coordinates: number[][]) => ({ type: 'LineString', coordinates })
const point = (coordinates: number[]) => ({ type: 'Point', coordinates })
const feature = (properties: Record<string, unknown>, geometry: unknown) => ({ type: 'Feature', properties, geometry })

const LAYERS: Record<string, unknown[]> = {
  'pub:WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW': [
    // A required field DataBC sends whatever is asked: the reader must drop it.
    feature(
      { OBJECTID: 1, FOREST_FILE_ID: 'R12345', ROAD_SECTION_ID: '01', CLIENT_NAME: 'Not to be kept' },
      line([
        [-122.775, 53.9925],
        [-122.756, 53.9925],
      ]),
    ),
  ],
  'pub:WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP': [
    feature(
      { OBJECTID: 1, BLUE_LINE_KEY: 356000001, DOWNSTREAM_ROUTE_MEASURE: 1000, STREAM_ORDER: 1 },
      line([
        [-122.765, 53.988, 700],
        [-122.765, 53.997, 720],
      ]),
    ),
  ],
  'pub:WHSE_FISH.PSCIS_ASSESSMENT_SVW': [
    feature(
      {
        OBJECTID: 1,
        STREAM_CROSSING_ID: 111,
        ASSESSMENT_DATE: '2014-08-06Z',
        CROSSING_TYPE_CODE: 'CBS',
        DIAMETER_OR_SPAN: 0.6,
        BARRIER_RESULT_CODE: 'BARRIER',
        CONSULTANT_NAME: 'Not to be kept',
      },
      point([-122.76505, 53.99252]),
    ),
  ],
  'pub:WHSE_BASEMAPPING.TRIM_TRANSPORTATION_LINES': [
    feature(
      { OBJECTID: 9, ASRC_YEAR: 1990, ASRC_MNTH: 7, ASRC_DAY: 25 },
      line([
        [-122.7655, 53.9925],
        [-122.7645, 53.9925],
      ]),
    ),
  ],
}

async function stubDataBc(page: Page) {
  await page.route('https://openmaps.gov.bc.ca/geo/pub/wfs*', async (route: Route) => {
    const body = new URLSearchParams(route.request().postData() ?? '')
    const features = LAYERS[body.get('typeNames') ?? ''] ?? []
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ type: 'FeatureCollection', features: Number(body.get('startIndex')) ? [] : features }),
    })
  })
}

/** The road designer's GeoJSON export with one register point inside the block, at the same place. */
const designerExport = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    feature(
      {
        kind: 'crossing-review',
        register_format: 'pgmaps-designer-crossing/v1',
        register_id: 'mapped:c1',
        alignment_id: 'road-1',
        road: 'Spur 3',
        chainage_m: 240,
        station: '0+240.0',
        register_source: 'both',
        stream: 'Tributary',
        structure_kind: 'culvert',
        structure: 'Culvert 1 · Ø 0.8 m × 12 m',
        structure_capacity: 'adequate',
        structure_outstanding: '',
        culvert_diameter_m: 0.8,
        culvert_length_m: 12,
        riparian_class: 'S4',
        class_status: 'reviewed',
      },
      point([-122.76502, 53.99251]),
    ),
  ],
})

test('crossings read from the road designer and the map are added on a click, with their evidence and offers', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await stubDataBc(page)
  await page.goto('/dev/forestry/block-planning?interface=guided')
  await page.getByTestId('block-planning-start').getByRole('button', { name: 'Open the sample' }).click()
  await page.getByRole('tab', { name: 'Review' }).click()
  const crossings = page.getByTestId('block-planning-crossings')

  // The designer's register: read, counted, and nothing added until the click.
  await crossings.getByLabel('Read the road designer’s GeoJSON export').setInputFiles({
    name: 'spur3.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(designerExport),
  })
  const designer = crossings.getByTestId('crossing-read-designer')
  await expect(designer).toContainText('Road designer: 1 found, 1 not added')
  await expect(crossings.getByTestId('crossings-unreviewed')).toContainText('1 crossing read under Find crossings')
  await expect(crossings.getByTestId('crossings-table')).toHaveCount(0)
  await designer.getByRole('button', { name: 'Add', exact: true }).click()
  const record = page.getByTestId('crossing-crossing-1')
  await expect(record).toContainText('Road designer')
  await expect(designer).toContainText('Added as Spur 3 0+240.0 · Tributary')

  // What the designer's sizing offers, used on a click.
  const offers = record.getByTestId('crossing-offers')
  const diameter = offers.locator('li[data-offer="culvert-diameter"]')
  await expect(diameter).toContainText('800')
  await diameter.getByRole('button', { name: 'Use' }).click()
  await expect(diameter).toContainText('Answered')

  // The mapped read: the same place, so it goes onto the designer's crossing with PSCIS's id.
  await crossings.getByRole('button', { name: 'From the map' }).click()
  const mapped = crossings.getByTestId('crossing-read-mapped')
  await expect(mapped).toContainText('Mapped layers: 1 found')
  await mapped.getByRole('button', { name: /^Add to Spur 3/ }).click()
  await expect(mapped).toContainText('Added as Spur 3 0+240.0 · Tributary')
  await expect(record.getByTestId('crossing-aliases')).toContainText('PSCIS crossing 111')
  await expect(record.getByTestId('crossing-evidence-list')).toContainText('not a finding under FPPR §56')
  await expect(page.getByTestId('block-planning-crossings')).not.toContainText('Not to be kept')

  // Dating: TRIM puts the road there by 1990; an air photo without it brackets the first sighting.
  const dating = record.getByTestId('crossing-dating')
  await expect(dating.getByTestId('crossing-bracket')).toContainText('Present by 1990-07-25')
  await choose(dating.getByRole('combobox', { name: 'Sighting state' }), 'Not there')
  await dating.getByLabel('Sighting date').fill('1987-08-14')
  await dating.getByLabel('Sighting reference').fill('Roll 1 frame 12')
  await dating.getByRole('button', { name: 'Add sighting' }).click()
  await expect(dating.getByTestId('crossing-bracket')).toContainText('First seen between 1987-08-14 and 1990-07-25')
  await expect(offers.locator('li[data-offer="built-after-1995"]')).toContainText('No')

  // The plan map draws the crossing by its standing.
  await expect(page.getByTestId('block-planning-map')).toContainText('Crossing: needs an answer')
})
