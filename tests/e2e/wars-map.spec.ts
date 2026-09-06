import { expect, test } from '@playwright/test'

test('WARS keeps coincident records accessible above the clustering threshold', async ({ page }) => {
  test.setTimeout(120_000)
  // Model the downtown stack at the initial camera centre so zoom controls
  // reproduce the bug without depending on basemap labels or live records.
  await page.route('**/data/wars/manifest.json', (route) => route.fulfill({ json: {
    geojson: '/data/wars/overlap-fixture.json', rows: 74, totalQuantity: 74,
    yearStart: 1980, yearEnd: 1980, species: [{ name: 'Moose', count: 74 }], years: [],
  } }))
  await page.route('**/data/wars/overlap-fixture.json', (route) => route.fulfill({ json: {
    type: 'FeatureCollection',
    features: Array.from({ length: 74 }, (_, index) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [-122.764593, 53.909784] },
      properties: {
        id: String(index), accidentDate: '1980-02-01', year: 1980,
        species: 'Moose', quantity: 1, nearestTown: 'Prince George',
        serviceArea: 19, sourceFile: 'overlap-fixture',
      },
    })),
  } }))
  await page.goto('/misc?tab=wars', {
    waitUntil: 'domcontentloaded',
  })
  const stack = page.locator('.maplibregl-marker').filter({
    has: page.locator('svg text', { hasText: /^74$/ }),
  })
  await expect(stack).toBeVisible({ timeout: 30_000 })
  for (let step = 0; step < 12; step += 1) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    // Let each camera transition complete before requesting the next zoom.
    await page.waitForTimeout(350)
  }
  await expect(stack).toBeVisible()
  await stack.click()
  await expect(page.getByText('74 overlapping records', { exact: true })).toBeVisible()
  const more = page.getByRole('button', { name: 'Show more (24 remaining)', exact: true })
  await expect(more).toBeVisible()
  await more.click()
  await expect(more).toHaveCount(0)
  const rows = page.locator('.maplibregl-popup button').filter({ hasText: /animal/ })
  await expect(rows).toHaveCount(74)
  await rows.last().click()
  await expect(page.getByText('Selected Record', { exact: true })).toBeVisible()
  await expect(page.getByText('74 overlapping records', { exact: true })).toHaveCount(0)
})
