import { expect, test } from '@playwright/test'

test('trace is the default; numeric vector and original tiles are explicit choices', async ({ page }) => {
  test.setTimeout(60_000)
  const remote: string[] = []
  const errors: string[] = []
  const local: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('tileserver.thebeczone.ca')) remote.push(request.url())
    if (request.url().includes('/data/cciss/')) local.push(request.url())
  })
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://tileserver.thebeczone.ca/**', (route) => route.fulfill({ status: 404, body: '' }))
  await page.goto('/dev/forestry/cciss-suitability?lng=-122.377338&lat=51.725061&z=5.48')
  await expect(page.getByRole('button', { name: 'Tile trace', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Original CCISS tiles', exact: true })).toBeHidden()
  await expect(page.getByText(/visible blocks? ready\./)).toBeVisible()
  expect(local.some((url) => url.includes('/province-grid-trace/'))).toBe(true)
  expect(remote).toEqual([])
  await page.screenshot({ path: 'tmp/cciss-trace-default.png' })

  await page.getByRole('button', { name: 'Numeric vector', exact: true }).click()
  await expect(page).toHaveURL(/render=vector/)
  await expect.poll(() => local.some((url) => /historical-Pl-C4-polygons\/tiles\/.*\.gz/.test(url))).toBe(true)
  await expect(page.getByText(/visible blocks? ready\./)).toBeVisible({ timeout: 30_000 })
  expect(remote).toEqual([])
  const url = new URL(page.url())
  expect(url.searchParams.get('lng')).toBe('-122.377338')
  expect(url.searchParams.get('z')).toBe('5.48')

  // An unprepared selection must not silently bring the public raster back.
  await page.getByRole('combobox', { name: 'Species', exact: true }).selectOption('Fd')
  await expect(page.getByText('No prepared overlay for this selection')).toBeVisible()
  expect(remote).toEqual([])
  await page.getByRole('button', { name: 'Comparison options', exact: true }).click()
  await page.getByRole('button', { name: 'Original CCISS tiles', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('This tile set is unavailable')
  expect(remote.some((url) => url.includes('NewFeas_1961_1990_ref_C4_Fd.json'))).toBe(true)
  await page.getByRole('combobox', { name: 'Species', exact: true }).selectOption('Pl')
  await page.getByRole('button', { name: 'Tile trace', exact: true }).click()
  await expect(page).toHaveURL(/render=trace/)
  await expect(page.getByText(/visible blocks? ready\./)).toBeVisible()
  expect(errors).toEqual([])
})
