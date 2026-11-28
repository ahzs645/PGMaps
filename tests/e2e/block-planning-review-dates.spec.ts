import { test, expect, type Page, type Route } from '@playwright/test'

/** Made-up records over the sample's Block 1 (-122.7701 to -122.7611, 53.99 to 53.995). */
const AROUND_BLOCK = {
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
}
const AUTHORITY = {
  type: 'Feature',
  properties: {
    OBJECTID: 1,
    FOREST_FILE_ID: 'A99999',
    CUTTING_PERMIT_ID: '7',
    CATASTROPHIC_IND: 'Y',
    ISSUE_DATE: '2019-03-04Z',
    CLIENT_NAME: 'Never shown',
  },
  geometry: AROUND_BLOCK,
}

async function stubDataBc(page: Page) {
  await page.route('https://openmaps.gov.bc.ca/geo/pub/wfs*', async (route: Route) => {
    const body = new URLSearchParams(route.request().postData() ?? new URL(route.request().url()).search)
    const layer = body.get('typeNames') ?? ''
    const features =
      layer === 'pub:WHSE_FOREST_TENURE.FTEN_HARVEST_AUTH_POLY_SVW' && !Number(body.get('startIndex'))
        ? [AUTHORITY]
        : []
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ type: 'FeatureCollection', features }),
    })
  })
}

test('a review date a release does not cover is said plainly, and the tenure records are read only on a click', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await stubDataBc(page)
  await page.goto('/dev/forestry/block-planning?interface=guided')
  await page.getByTestId('block-planning-start').getByRole('button', { name: 'Open the sample' }).click()
  await page.getByRole('tab', { name: 'Review' }).click()

  const review = page.getByTestId('block-planning-block-review')
  await expect(review.getByRole('region', { name: 'BC land status of a block' })).toBeVisible()
  await expect(review.getByTestId('review-date-gaps')).toHaveCount(0)

  // A permit's issue date, years before any release: every rule is not assessed, never "does not apply".
  await review.getByLabel('Legal assessment date').fill('2016-06-01')
  await expect(review.getByTestId('review-date-gaps')).toContainText('cover the legal assessment date 2016-06-01')
  const land = review.getByRole('region', { name: 'BC land status of a block' })
  await expect(land.getByTestId('release-date-gap')).toContainText('covers 2026-11-17 to 2026-11-27')
  await expect(land.getByTestId('release-date-gap')).toContainText('law as it stood then')
  await expect(land).toContainText('0 do not apply · 12 not assessed on this date')

  // Back to a covered date, the notice goes.
  await review.getByLabel('Legal assessment date').fill('2026-11-27')
  await expect(review.getByTestId('review-date-gaps')).toHaveCount(0)

  // Tenure records: nothing is read until the click; the signal is counted, and no client field is shown.
  await page.getByRole('button', { name: /^Tenure records/ }).click()
  const tenure = page.getByTestId('block-planning-tenure-records')
  await tenure.getByRole('button', { name: 'Read the tenure records' }).click()
  await expect(tenure.getByTestId('tenure-records')).toContainText('A99999 · CP 7')
  await expect(tenure.getByTestId('tenure-signal-count')).toContainText('2 entries bear on an exception')
  await expect(tenure).not.toContainText('Never shown')
})
