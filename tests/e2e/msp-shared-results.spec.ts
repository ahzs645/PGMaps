import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block', viewport: { width: 1280, height: 860 } })
test.setTimeout(90_000)

function facility(index: number): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-124.7 + (index % 11) * 0.01, 53.3 + Math.floor(index / 11) * 0.01] },
    properties: {
      id: `msp-${index}`,
      payeeName: `MSP Test Facility ${index}`,
      payeeType: 'hospital',
      fiscalYearCount: 2,
      firstFiscalYear: '2023/2024',
      latestFiscalYear: '2024/2025',
      firstFiscalStartYear: 2023,
      latestFiscalStartYear: 2024,
      totalAmount: 1500,
      maxAnnualAmount: 1000,
      averageAnnualAmount: 750,
      annualPayments: [
        { fiscalYear: '2023/2024', fiscalStartYear: 2023, amount: 500 },
        { fiscalYear: '2024/2025', fiscalStartYear: 2024, amount: 1000 },
      ],
      matchMethod: 'verified fixture',
      matchScore: 1,
      matchedName: `Matched MSP Facility ${index}`,
      matchedAddress: `${index} Test Street`,
      matchedLocality: 'Prince George',
      matchedPostalCode: 'V2L 1A1',
      matchedPhone: null,
      matchedWebsite: null,
      matchedHealthAuthority: 'Northern Health',
    },
  }
}

async function stubSources(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'offline-background', type: 'background', paint: { 'background-color': '#eef2f6' } }],
        glyphs: 'https://msp-map-test.invalid/{fontstack}/{range}.pbf',
      },
    }),
  )
  await page.route('https://msp-map-test.invalid/**', (route) => route.fulfill({ body: Buffer.alloc(0) }))
  const features = Array.from({ length: 115 }, (_, index) => facility(index))
  await page.route('**/data/health/msp-facilities.geojson', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features,
        metadata: {
          generatedAt: '2026-10-30T12:00:00Z',
          facilityPayees: features.length,
          matchedFacilities: features.length,
          unmatchedFacilities: 0,
          totalAmount: features.length * 1500,
          matchedAmount: features.length * 1500,
          matchedAmountShare: 1,
          fiscalStartYearRange: { min: 2023, max: 2024 },
        },
      },
    }),
  )
  return errors
}

test('MSP virtual results expose facilities beyond index 80 and retain selection, filtering and fiscal payments', async ({
  page,
}) => {
  const errors = await stubSources(page)
  await page.goto('/dev/health/msp')
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
  const scroll = page.locator('[data-map-sidebar-scroll="true"]:visible')
  const list = page.getByRole('list', { name: 'MSP facilities', exact: true })
  await expect(list).toBeVisible()
  await expect(list.getByRole('listitem').first()).toHaveAttribute('aria-setsize', '115')
  // Exercise the real virtualizer: the final row starts unmounted, then a
  // genuine sidebar scroll mounts it. Merely passing 115 items is insufficient.
  const last = list.getByRole('button', { name: /^MSP Test Facility 114 / })
  await expect(last).toHaveCount(0)
  expect(await list.getByRole('listitem').count()).toBeLessThan(115)
  await scroll.evaluate((element) => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }))
  await expect(last).toBeVisible()
  await expect(last).toContainText('Prince George · $2K')
  await last.click()
  await expect(last).toHaveAttribute('aria-pressed', 'true')
  const marker = page.getByRole('button', { name: 'MSP Test Facility 114', exact: true })
  await expect(marker).toHaveClass(/ring-sky-400/)
  const detail = page.getByRole('button', { name: 'Close details', exact: true }).locator('xpath=../../..')
  await expect(detail).toContainText('MSP Test Facility 114')
  await expect(detail).toContainText('Matched MSP Facility 114')
  await expect(detail).toContainText('114 Test Street')
  await expect(detail).toContainText('$2K')

  await page.getByRole('textbox', { name: 'Search MSP facilities', exact: true }).fill('MSP Test Facility 114')
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(list.getByRole('listitem')).toHaveAttribute('aria-setsize', '1')
  await expect(last).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Show timeline', exact: true }).click()
  await expect(last).toContainText('Prince George · $1K')
  await expect(detail).toContainText('Fiscal year 2024/2025')
  await scroll.getByRole('combobox').click()
  await page.getByRole('option', { name: '2023', exact: true }).click()
  await expect(last).toContainText('Prince George · $500')
  await expect(detail).toContainText('Fiscal year 2023/2024')
  await page.getByRole('button', { name: 'Hide timeline', exact: true }).click()
  await expect(last).toContainText('Prince George · $2K')
  expect(errors).toEqual([])
})

test.describe('MSP shared results on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('reaches the final virtual row, reopens its details, and changes fiscal payments in the sheet', async ({
    page,
  }) => {
    const errors = await stubSources(page)
    await page.goto('/dev/health/msp')
    const handle = page.locator('[data-map-mobile-sheet-handle]')
    await handle.press('End')
    await expect(handle).toHaveAttribute('aria-valuenow', '2')
    const scroll = page.locator('[data-map-sidebar-scroll="true"]:visible')
    const list = page.getByRole('list', { name: 'MSP facilities', exact: true })
    await expect(list.getByRole('listitem').first()).toHaveAttribute('aria-setsize', '115')
    const last = list.getByRole('button', { name: /^MSP Test Facility 114 / })
    await expect(last).toHaveCount(0)
    await scroll.evaluate((element) => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }))
    await expect(last).toBeVisible()
    await last.click()
    await expect(page.getByRole('button', { name: 'MSP Test Facility 114', exact: true })).toHaveClass(/ring-sky-400/)

    // Selection exposes the map; the shared sheet must still recover all details.
    await handle.press('End')
    await page.getByRole('textbox', { name: 'Search MSP facilities', exact: true }).fill('MSP Test Facility 114')
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect(last).toHaveAttribute('aria-pressed', 'true')
    const detail = page.getByRole('button', { name: 'Close details', exact: true }).locator('xpath=../../..')
    await expect(detail).toContainText('114 Test Street')
    await page.getByRole('button', { name: 'Show timeline', exact: true }).click()
    await expect(last).toContainText('Prince George · $1K')
    await scroll.getByRole('combobox').click()
    await page.getByRole('option', { name: '2023', exact: true }).click()
    await expect(last).toContainText('Prince George · $500')
    await expect(detail).toContainText('Fiscal year 2023/2024')
    await handle.press('Home')
    await expect(handle).toHaveAttribute('aria-valuenow', '0')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    expect(errors).toEqual([])
  })
})
