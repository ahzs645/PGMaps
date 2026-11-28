import { test, expect, type Locator, type Page, type Route } from '@playwright/test'
import { choose } from './styled-select'

/**
 * The sample's Block 1 lies at -122.7701 to -122.7611, 53.99 to 53.995. ParcelMap BC is stubbed with
 * one private parcel round the whole of it; every other layer holds nothing there.
 */
const PARCEL = {
  type: 'Feature',
  properties: {
    PARCEL_FABRIC_POLY_ID: 1,
    PID_FORMATTED: '000-000-001',
    PLAN_NUMBER: 'EPP1',
    PARCEL_CLASS: 'Subdivision',
    PARCEL_STATUS: 'Active',
    OWNER_TYPE: 'Private',
  },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.78, 53.985],
        [-122.75, 53.985],
        [-122.75, 54.0],
        [-122.78, 54.0],
        [-122.78, 53.985],
      ],
    ],
  },
}

async function stubDataBc(page: Page) {
  const asked: string[] = []
  await page.route('https://openmaps.gov.bc.ca/geo/pub/wfs*', async (route: Route) => {
    const body = new URLSearchParams(route.request().postData() ?? new URL(route.request().url()).search)
    const layer = body.get('typeNames') ?? ''
    asked.push(layer)
    const features =
      layer === 'pub:WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW' && !Number(body.get('startIndex')) ? [PARCEL] : []
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ type: 'FeatureCollection', features }),
    })
  })
  return asked
}

const question = (review: Locator, start: RegExp) => review.getByRole('combobox', { name: start })

test('land status offers what the ground read maps, answers only on Use, and takes FRPA off private land', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const asked = await stubDataBc(page)
  await page.goto('/dev/forestry/block-planning?interface=guided')
  await page.getByTestId('block-planning-start').getByRole('button', { name: 'Open the sample' }).click()
  await page.getByRole('tab', { name: 'Review' }).click()

  const review = page.getByTestId('block-planning-block-review')
  const land = review.getByRole('region', { name: 'BC land status of a block' })
  await expect(land).toBeVisible()
  // Before the ground is read, the question says where its candidates come from.
  await expect(land).toContainText('Read On this ground')

  // Read the ground: the parcel, and the reserves and treaty land, which hold nothing here.
  await page.getByRole('button', { name: /^On this ground/ }).click()
  const ground = page.getByTestId('block-planning-ground')
  await ground.getByRole('button', { name: 'Read the instruments on this ground' }).click()
  const context = ground.getByTestId('block-planning-ground-context')
  await expect(context).toContainText('Indian reserves (Canada Lands Survey): none mapped on the footprint')
  await expect(context).toContainText('First Nations treaty lands: none mapped on the footprint')
  expect(asked).toContain('pub:WHSE_ADMIN_BOUNDARIES.CLAB_INDIAN_RESERVES')

  // The offer is a candidate: nothing is answered until Use.
  const landOffer = land.getByTestId('land-offer-land')
  await expect(landOffer).toContainText('Private land')
  await expect(landOffer).toContainText('PID 000-000-001')
  await expect(question(land, /^What land is the block on\?/)).toHaveText(/Not answered/)
  await landOffer.getByRole('button', { name: 'Use' }).click()
  // Answered, it moves to the answered list, its evidence the read it rests on. The licence area,
  // read by the reach rules and by the area-based licences' exclusive rights, is asked beside it.
  await expect(question(land, /^Is the block in the area of an area-based licence/)).toHaveText(/Not answered/)
  await expect(question(land, /^What land is the block on\?/)).toHaveText(/Private land/)

  const licenceOffer = land.getByTestId('land-offer-licence-area')
  await expect(licenceOffer).toContainText('None of these')
  await licenceOffer.getByRole('button', { name: 'Use' }).click()
  // With both answered, the shared questions fold into the answered list.
  await expect(land.getByRole('button', { name: /^Whole block 2 answered/ })).toBeVisible()
  await expect(question(land, /^Is the block in the area of an area-based licence/)).toHaveCount(0)

  await choose(question(land, /^Is the block’s private land private managed forest land/), 'No')
  await choose(question(land, /^Is any timber on the block’s private land reserved/), 'No')
  await choose(question(land, /^Is the block’s private land adjacent to Crown land/), 'Yes')

  await expect(land).toContainText('FRPA’s forest practices do not reach this private land')
  await expect(land).toContainText('Private land beside Crown land: ascertain the boundaries')
  await expect(land).toContainText('Timber from private land carries that land’s timber mark')
  // FRPA's reach is settled as not triggered; four findings, and nothing left to answer. Outside an
  // area-based licence its holder's exclusive right does not apply.
  await expect(land).toContainText('4 need review · 0 need an answer · 3 not triggered · 5 do not apply')
})
