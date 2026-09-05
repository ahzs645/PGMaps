import { expect, test } from '@playwright/test'

for (const route of ['/foodmap', '/airquality', '/census', '/explorer']) {
  test(`mobile search reveals and collapses its panel without moving the map: ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    const handle = page.locator('[data-map-mobile-sheet-handle]')
    await expect(handle).toBeVisible()
    await page.getByRole('button', { name: 'Open search', exact: true }).click()
    await expect(handle).toHaveAttribute('aria-valuenow', '2')
    const input = page.locator('[data-map-search-input]').first()
    await expect(input).toBeFocused()
    await expect(input).toBeInViewport()
    const root = page.locator('[data-map-layout-root]').first()
    expect(await root.evaluate((el) => el.scrollTop)).toBe(0)
    await handle.press('Home')
    await expect(handle).toHaveAttribute('aria-valuenow', '0')
    await expect.poll(async () => (await handle.boundingBox())!.y).toBeGreaterThan(700)
    expect(await root.evaluate((el) => el.scrollTop)).toBe(0)
  })
}

test('desktop search reopens a hidden sidebar, including the keyboard shortcut', async ({ page }) => {
  await page.goto('/foodmap')
  for (const shortcut of [false, true]) {
    await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
    if (shortcut) await page.keyboard.press('Control+k')
    else await page.getByRole('button', { name: 'Open search', exact: true }).click()
    await expect(page.getByPlaceholder('Search restaurants...')).toBeVisible()
    await expect(page.getByPlaceholder('Search restaurants...')).toBeFocused()
  }
})

test('Index Lab has a results drawer at intermediate widths and bounded phone actions', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto('/score-builder')
  await page.getByRole('button', { name: 'Show right sidebar', exact: true }).click()
  const right = page.locator('[data-map-right-sidebar]')
  await expect(right.getByRole('tab', { name: 'Regions', exact: true })).toBeVisible()
  await right.getByRole('tab', { name: 'Regions', exact: true }).click()
  await expect(right.getByRole('button', { name: 'Pin baseline', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Hide right sidebar', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 800 })
  const settings = page.getByRole('button', { name: 'Open index settings', exact: true })
  await expect(settings).toBeInViewport()
  const actions = page.locator('[data-score-builder-mobile-actions]')
  expect(await actions.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await settings.click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('global shortcuts and partial results work while a source is unavailable', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/data/ui/search/restaurants.json.gz', async (route) => {
    await pending
    await route.fulfill({ status: 503, body: 'unavailable' })
  })
  await page.route('**/canue-bc-grid-v2-app-catalog.json', (route) => route.fulfill({ json: { families: [] } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Open search', exact: true }).click()
  await expect(page.getByRole('option', { name: /Food Safety Map/ })).toBeVisible()
  await page.getByRole('combobox', { name: 'Search PGMaps' }).fill('Carrie Jane Gray')
  await expect(page.getByRole('option', { name: /Carrie Jane Gray/ }).first()).toBeVisible()
  release()
  await expect(page.getByText('Some search sources are unavailable.')).toBeVisible()
  expect(requests.some((url) => /parcels\.geojson|data\/restaurants\.json|PGCrime/.test(url))).toBe(false)
  await page.unroute('**/data/ui/search/restaurants.json.gz')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('Some search sources are unavailable.')).toBeHidden()
  await page.getByRole('combobox', { name: 'Search PGMaps' }).fill('Air Quality Map')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/airquality/)
})

test('homepage defers the map engine and permits page zoom', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Prince George Data Platform' })).toBeVisible()
  expect(requests.filter((url) => /maplibre|persistent-map/.test(url))).toEqual([])
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
  expect(viewport).not.toMatch(/maximum-scale|user-scalable=no/)
})

test('empty Explorer layers and geometry survive reload', async ({ page }) => {
  await page.goto('/explorer')
  await page.getByRole('button', { name: 'None', exact: true }).click()
  for (const name of ['Point', 'Line', 'Polygon']) await page.getByRole('button', { name, exact: true }).click()
  await expect(page).toHaveURL(/datasets=none/)
  await expect(page).toHaveURL(/geom=none/)
  await page.reload()
  await expect(page.getByText('0 items visible', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/datasets=none/)
  await expect(page).toHaveURL(/geom=none/)
})

test('restaurant results are bounded, keyboard selectable, and reach the end', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/foodmap')
  const list = page.getByRole('list', { name: 'Restaurants', exact: true })
  const rows = list.getByRole('listitem')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeLessThan(40)
  await list.getByRole('button').first().focus()
  await page.keyboard.press('End')
  await expect.poll(() => list.locator('button:focus').count()).toBe(1)
  const last = list.locator('button:focus')
  const row = last.locator('..')
  expect(await row.getAttribute('aria-posinset')).toBe(await row.getAttribute('aria-setsize'))
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/restaurant=/)
  expect(requests.some((url) => url.includes('/geocoding/geocoded_locations.json'))).toBe(false)
  expect(await rows.count()).toBeLessThan(40)
})

test('Explorer virtual results include features beyond the old 250-row limit', async ({ page }) => {
  await page.goto('/explorer')
  const list = page.getByRole('list', { name: 'Explorer results', exact: true })
  await expect(list.getByRole('button').first()).toBeVisible()
  expect(await list.getByRole('listitem').count()).toBeLessThan(40)
  await list.getByRole('button').first().focus()
  await page.keyboard.press('End')
  const last = list.locator('button:focus').locator('..')
  await expect.poll(() => last.getAttribute('aria-posinset')).toBe(await last.getAttribute('aria-setsize'))
  expect(Number(await last.getAttribute('aria-posinset'))).toBeGreaterThan(250)
})
