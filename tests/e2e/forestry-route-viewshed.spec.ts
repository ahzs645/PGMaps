import { expect, test, type Page } from '@playwright/test'
import { encode } from 'fast-png'

test.use({ serviceWorkers: 'block', actionTimeout: 15000 })
test.setTimeout(150000)
const data = new Uint8Array(256 * 256 * 3)
for (let i = 0; i < data.length; i += 3) {
  data[i] = 131
  data[i + 1] = 32
}
const tile = Buffer.from(encode({ width: 256, height: 256, data, channels: 3 }))

async function setup(page: Page, fail = false) {
  const host = { fail, requests: 0 }
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('**/elevation-tiles-prod/terrarium/**', (route) => {
    host.requests++
    return host.fail ? route.fulfill({ status: 503 }) : route.fulfill({ contentType: 'image/png', body: tile })
  })
  await page.route('**/maps.gov.bc.ca/**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features: [] } }),
  )
  await page.goto('/dev/forestry/visual-quality')
  await expect(page.getByRole('heading', { name: 'Visual quality', exact: true })).toBeVisible()
  await page.locator('[data-via-step="identify"]').click()
  const identify = page.locator('[data-via-panel="identify"]')
  const folded = identify.locator('[data-forestry-disclosure][aria-expanded="false"]')
  while (await folded.count()) await folded.first().click()
  await page.getByRole('button', { name: 'New site', exact: true }).click()
  await page.getByRole('button', { name: 'Draw the road', exact: true }).click()
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.55)
  await expect(identify.getByText(/1 points added/)).toBeVisible()
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55)
  await expect(page.getByRole('button', { name: 'Finish drawing', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Finish drawing', exact: true }).click()
  await page.locator('[data-via-step="visit"]').click()
  await page.getByRole('button', { name: 'Road viewshed', exact: true }).click()
  return host
}

async function state(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('.maplibregl-map')!
    const key = Object.keys(element).find((key) => key.startsWith('__reactFiber$'))!
    type Hook = {
      memoizedState?: {
        current?: {
          getTerrain?: () => unknown
          getSource?: (key: string) => { serialize: () => { data: GeoJSON.FeatureCollection } } | undefined
          getCenter?: () => { lng: number; lat: number }
        }
      }
      next?: Hook
    }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let node = (element as unknown as Record<string, Fiber>)[key]
    for (let d = 0; node && d < 200; d++, node = node.return!) {
      let hook = node.memoizedState
      for (let i = 0; hook && i < 40; i++, hook = hook.next!) {
        const map = hook.memoizedState?.current
        if (typeof map?.getTerrain !== 'function') continue
        return {
          terrain: Boolean(map.getTerrain()),
          areas: map.getSource?.('fill-shared-forestry-route-viewshed')?.serialize().data,
          center: map.getCenter?.(),
        }
      }
    }
    return null
  })
}

test('a road-only scene previews, caches scrubbing and plays the existing road camera without assessment', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 900, height: 650 })
  const host = await setup(page)
  const status = page.locator('[data-route-viewshed-status]')
  await expect(status).toContainText('Viewshed ready', { timeout: 45000 })
  const initial = (await state(page))!.areas!
  expect(initial.features[0].properties?.color).toBe('#e11d48')
  expect(initial.features[0].properties?.size).toBe(128)
  expect(
    JSON.parse((await page.evaluate(() => localStorage.getItem('pgmaps.forestry-visual-quality.v1')))!).targets,
  ).toHaveLength(0)
  const requests = host.requests
  await page.getByLabel('Road viewshed position', { exact: true }).focus()
  await page.getByLabel('Road viewshed position', { exact: true }).press('ArrowRight')
  await expect
    .poll(async () => (await state(page))?.areas?.features[0].properties?.bounds)
    .not.toEqual(initial.features[0].properties?.bounds)
  await expect(status).toContainText('Viewshed ready')
  await page.getByLabel('Road viewshed position', { exact: true }).press('Home')
  await expect(status).toContainText('cached view')
  expect(host.requests).toBe(requests)
  await page.getByRole('button', { name: 'Open route overview', exact: true }).click()
  const controls = page.getByRole('region', { name: 'Road view controls' })
  await expect(controls.getByText('Preliminary route overview · 1× terrain', { exact: true })).toBeVisible()
  await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60000 })
  expect((await state(page))?.terrain).toBe(true)
  await controls.getByRole('button', { name: 'Play', exact: true }).click({ timeout: 60000 })
  await expect
    .poll(async () => Number(await controls.getByLabel('Route position', { exact: true }).inputValue()), {
      timeout: 45000,
    })
    .toBeGreaterThan(0)
  await controls.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(async () => (await state(page))?.areas?.features[0].properties?.size).toBe(128)
  await controls.getByRole('button', { name: 'Return to map', exact: true }).click()
  await expect(controls).toHaveCount(0)
  expect((await state(page))?.terrain).toBe(false)
  expect(errors).toEqual([])
})

test('missing road terrain stays unknown and retry does not reuse failed tiles', async ({ page }) => {
  const host = await setup(page, true)
  await expect(page.getByText(/100.0% unknown/)).toBeVisible({ timeout: 45000 })
  expect((await state(page))?.areas?.features[0].properties?.color).toBe('#a855f7')
  host.fail = false
  await page.getByRole('button', { name: 'Retry road terrain', exact: true }).click()
  await expect(page.getByText(/ · 0\.0% unknown/)).toBeVisible({ timeout: 45000 })
  expect((await state(page))?.areas?.features[0].properties?.color).toBe('#e11d48')
})
