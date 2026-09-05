import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

async function addBcer(page: Page) {
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: /^BCER admin zones/ }).click()
  await page.getByRole('button', { name: /Done/ }).click()
  await expect(page.getByText('BCER admin zones · Administrative Zone · 4')).toBeVisible()
}

for (const width of [320, 390, 1024, 1440]) {
  test(`comparison remains usable at ${width}px and only computes on request`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const workers: string[] = []
    page.on('worker', (worker) => {
      if (worker.url().includes('boundaryDifference')) workers.push(worker.url())
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/dev/boundaries')
    await addBcer(page)
    await page.getByRole('button', { name: 'Compare', exact: true }).first().click()
    await page.getByRole('button', { name: 'Compare', exact: true }).first().click()
    expect(workers).toHaveLength(0)
    const details = page.locator('[data-boundary-details]')
    await expect(details.getByRole('heading', { name: 'Compare selected boundaries' })).toBeVisible()
    const show = details.getByRole('button', { name: 'Show diff', exact: true })
    await show.click()
    await expect(details.getByText('Overlap', { exact: true })).toBeVisible()
    expect(workers).toHaveLength(1)
    await page.getByRole('slider', { name: 'BCER admin zones fill opacity' }).evaluate((element) => {
      const input = element as HTMLInputElement
      input.value = '0.4'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(details.getByText('Overlap', { exact: true })).toBeVisible()
    expect(workers).toHaveLength(1)
    await expect(details.getByText('Only A', { exact: true })).toBeVisible()
    const rect = await details.getByRole('button', { name: 'Hide diff' }).boundingBox()
    expect(rect!.x).toBeGreaterThanOrEqual(0)
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width)
    if (width < 768) expect(rect!.height).toBeGreaterThanOrEqual(44)
    await details.getByRole('button', { name: 'Clear comparison' }).click()
    await expect(details.getByRole('heading', { name: 'Compare selected boundaries' })).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('a failed boundary source waits for explicit retry', async ({ page }) => {
  let attempts = 0
  await page.route('**/data/boundaries/BCER/*.geojson', async (route) => {
    attempts++
    if (attempts === 1) await route.fulfill({ status: 503, body: 'Unavailable' })
    else await route.continue()
  })
  await page.goto('/dev/boundaries')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: /^BCER admin zones/ }).click()
  await page.getByRole('button', { name: /Done/ }).click()
  const retry = page.getByRole('button', { name: 'Retry BCER admin zones' })
  await expect(retry).toBeVisible()
  await page.waitForTimeout(500)
  expect(attempts).toBe(1)
  await retry.click()
  await expect(page.getByText('BCER admin zones · Administrative Zone · 4')).toBeVisible()
  expect(attempts).toBe(2)
})

test('boundary pages reach past the old cutoff and filters reset paging', async ({ page }) => {
  await page.goto('/dev/boundaries')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Choose a level for Census boundaries' }).click()
  await page.getByRole('button', { name: 'Census Subdivision', exact: true }).click()
  await page.getByRole('button', { name: /Done/ }).click()
  const paging = page.getByRole('navigation', { name: 'Census boundaries boundary pages' })
  await expect(paging).toBeVisible({ timeout: 45_000 })
  await expect(page.getByRole('button', { name: 'Compare', exact: true })).toHaveCount(20)
  for (let i = 0; i < 6; i++) await paging.getByRole('button', { name: 'Next' }).click()
  await expect(paging).toContainText('7 / 259')
  await page.getByPlaceholder('Filter selected layers').fill('Prince George')
  await expect(paging).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Prince George/ }).first()).toBeVisible()
})

test('census chunk loading has bounded concurrency and retries only failed chunks on request', async ({ page }) => {
  const attempts = new Map<string, number>()
  let inFlight = 0
  let peak = 0
  await page.route('**/data/census/bc-da-simplified/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('manifest.json')) {
      await route.fulfill({
        json: {
          features: 8,
          rawBytes: 8000,
          gzipBytes: 1000,
          chunks: Array.from({ length: 8 }, (_, i) => ({
            id: `${i}`,
            path: `chunks/test-${i}.geojson`,
            bbox: [-180, -85, 180, 85],
            featureCount: 1,
            rawBytes: 1000,
            gzipBytes: 125,
          })),
        },
      })
      return
    }
    attempts.set(path, (attempts.get(path) ?? 0) + 1)
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 100))
    inFlight--
    if (path.endsWith('test-0.geojson') && attempts.get(path) === 1) {
      await route.fulfill({ status: 503, body: 'Unavailable' })
    } else {
      await route.fulfill({
        json: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { boundaryCode: path, boundaryName: path },
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [-125, 54],
                    [-124, 54],
                    [-124, 55],
                    [-125, 55],
                    [-125, 54],
                  ],
                ],
              },
            },
          ],
        },
      })
    }
  })
  await page.goto('/dev/boundaries')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Choose a level for Census boundaries' }).click()
  await page.getByRole('button', { name: 'Dissemination Area', exact: true }).click()
  await page.getByRole('button', { name: /Done/ }).click()
  await expect.poll(() => attempts.size).toBe(8)
  await expect(page.getByRole('button', { name: 'Retry Census boundaries' })).toBeVisible()
  await page.waitForTimeout(500)
  expect([...attempts.values()]).toEqual(Array(8).fill(1))
  expect(peak).toBeLessThanOrEqual(4)
  await page.getByRole('button', { name: 'Retry Census boundaries' }).click()
  await expect(page.getByText('Census boundaries · Dissemination Area · 8')).toBeVisible()
  expect([...attempts.values()].reduce((sum, value) => sum + value, 0)).toBe(9)
})

test('failed census parent outlines do not enter a retry loop', async ({ page }) => {
  let attempts = 0
  await page.route('**/data/census/bc-da-simplified/manifest.json', (route) =>
    route.fulfill({
      json: {
        features: 0,
        chunks: [],
        parentBoundaries: [{ level: 'cd', label: 'Census Division', path: 'parents/test-cd.geojson', features: 0 }],
      },
    }),
  )
  await page.route('**/data/census/bc-da-simplified/parents/test-cd.geojson', (route) => {
    attempts++
    return attempts === 1
      ? route.fulfill({ status: 503, body: 'Unavailable' })
      : route.fulfill({ json: { type: 'FeatureCollection', features: [] } })
  })
  // Shared state: census DA source with the CD parent outline enabled.
  await page.goto(
    '/dev/boundaries?s=1.lz.N4IgbgpgTgzglgewHYgFwEYA0ICGBjAFzkgGUEBXKPCGNAbRGqRnNoF1sYKqIAZCSABtaqUExYiQAExwgAvtghIcAI0EQpAYSUSACjihKC-ISIZ4pINnKA',
  )
  const retry = page.getByRole('button', { name: 'Retry Census Division outline' })
  await expect(retry).toBeVisible()
  await page.waitForTimeout(500)
  expect(attempts).toBe(1)
  await retry.click()
  await expect(retry).toHaveCount(0)
  expect(attempts).toBe(2)
})

test('hiding a pending comparison terminates its worker and discards late results', async ({ page }) => {
  await page.route('**/boundaryDifference.worker-*.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'self.onmessage = () => { /* Deliberately wait for cancellation. */ }',
    }),
  )
  await page.goto('/dev/boundaries')
  await addBcer(page)
  await page.getByRole('button', { name: 'Compare', exact: true }).first().click()
  await page.getByRole('button', { name: 'Compare', exact: true }).first().click()
  const spawned = page.waitForEvent('worker', (worker) => worker.url().includes('boundaryDifference'))
  await page.getByRole('button', { name: 'Show diff', exact: true }).click()
  const worker = await spawned
  await expect(page.getByRole('status').filter({ hasText: 'Calculating comparison' })).toBeVisible()
  const closed = worker.waitForEvent('close')
  await page.getByRole('button', { name: 'Hide diff', exact: true }).click()
  await closed
  await expect(page.getByText('Overlap', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show diff', exact: true })).toBeVisible()
})

test('global boundary search exposes later pages and resets for a new query', async ({ page }) => {
  await page.goto('/dev/boundaries')
  const search = page.getByPlaceholder('Search all names, codes, and properties')
  await search.fill('Prince')
  const pagination = page.getByRole('navigation', { name: 'Boundary search pages' })
  await expect(pagination).toBeVisible()
  const results = page.locator('[data-boundary-search-results]')
  await expect(results.getByRole('button')).toHaveCount(20)
  for (let i = 0; i < 3; i++) await pagination.getByRole('button', { name: 'Next' }).click()
  await expect(pagination).toContainText('4 /')
  await expect(results.getByRole('button')).toHaveCount(20)
  await search.fill('Nechako')
  await expect(pagination).toContainText('1 /')
})

test('two active layers wait for an explicit whole-layer comparison', async ({ page }) => {
  const workers: string[] = []
  page.on('worker', (worker) => {
    if (worker.url().includes('boundaryDifference')) workers.push(worker.url())
  })
  await page.route('**/data/boundaries/BC/regional_districts.geojson', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { ADMIN_AREA_ABBREVIATION: 'TEST', ADMIN_AREA_NAME: 'Test region' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-126, 53],
                  [-120, 53],
                  [-120, 58],
                  [-126, 58],
                  [-126, 53],
                ],
              ],
            },
          },
        ],
      },
    }),
  )
  await page.goto('/dev/boundaries')
  await addBcer(page)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: /^Regional district / }).click()
  await page.getByRole('button', { name: /Done/ }).click()
  const compare = page.getByRole('button', { name: 'Diff top layers', exact: true })
  await expect(compare).toBeEnabled()
  expect(workers).toHaveLength(0)
  await compare.click()
  await expect(page.getByText('Overlap', { exact: true })).toBeVisible()
  expect(workers).toHaveLength(1)
  await expect(page.getByRole('heading', { name: 'Diff active layers', exact: true })).toBeVisible()
})
