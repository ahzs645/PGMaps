import { expect, test, type Page } from '@playwright/test'
import { encode, decode } from 'fast-png'

test.use({ serviceWorkers: 'block' })
test.setTimeout(90000)

const pixels = new Uint8Array(256 * 256 * 3)
for (let i = 0; i < pixels.length; i += 3) {
  pixels[i] = 131
  pixels[i + 1] = 32
}
const IMAGERY_TILE = Buffer.from(
  encode({ width: 256, height: 256, data: new Uint8Array(256 * 256 * 3).fill(110), channels: 3 }),
)
const FLAT_TILE = Buffer.from(encode({ width: 256, height: 256, data: pixels, channels: 3 })) // 800 m.

async function stubMap(page: Page, failed = false) {
  const terrain = { failed }
  await page.route('**/World_Imagery/MapServer/tile/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: IMAGERY_TILE }),
  )
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('**/elevation-tiles-prod/terrarium/**', (route) =>
    terrain.failed ? route.fulfill({ status: 503 }) : route.fulfill({ contentType: 'image/png', body: FLAT_TILE }),
  )
  return terrain
}

/** Inspect the actual MapLibre state through the existing map component's ref. */
async function mapState(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('.maplibregl-map')
    const key = container && Object.keys(container).find((key) => key.startsWith('__reactFiber$'))
    if (!container || !key) return null
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    type Hook = {
      memoizedState?: {
        current?: {
          getTerrain?: () => { exaggeration?: number } | null
          getPitch?: () => number
          getCenter?: () => { lng: number; lat: number }
          getStyle?: () => { layers: { id: string; type: string; source?: string; paint?: Record<string, unknown> }[] }
          getSource?: (id: string) => { serialize: () => { data: GeoJSON.FeatureCollection } } | undefined
        }
      }
      next?: Hook
    }
    let node = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; node && depth < 200; depth++, node = node.return!) {
      let hook = node.memoizedState
      for (let i = 0; hook && i < 40; i++, hook = hook.next) {
        const map = hook.memoizedState?.current
        if (typeof map?.getTerrain !== 'function') continue
        const overlay = map
          .getStyle?.()
          .layers.find((layer) => layer.source === 'fill-shared-viewshed-overlay' && layer.type === 'fill')
        return {
          terrain: Boolean(map.getTerrain()),
          exaggeration: map.getTerrain()?.exaggeration,
          pitch: map.getPitch?.(),
          center: map.getCenter?.(),
          overlay: Boolean(overlay),
          outline: Boolean(map.getSource?.('line-shared-viewshed-outline')),
          opacity: overlay?.paint?.['fill-opacity'],
          areas: map.getSource?.('fill-shared-viewshed-overlay')?.serialize().data,
        }
      }
    }
    return null
  })
}

test('draws terrain-draped visibility polygons, changes comparison colours, and updates the sun without rerunning terrain', async ({
  page,
}) => {
  await stubMap(page)
  await page.goto('/dev/viewshed')
  await expect(page.locator('[data-viewshed-status]')).toContainText('Viewshed ready', { timeout: 45000 })
  await expect.poll(async () => (await mapState(page))?.overlay).toBe(true)
  expect((await mapState(page))?.terrain).toBe(true)
  // A layer/source can exist without shading the map. Inspect the rendered canvas too.
  await expect
    .poll(
      async () => {
        const screenshot = decode(await page.locator('.maplibregl-canvas').screenshot())
        let shaded = 0
        for (let i = 0; i < screenshot.data.length; i += screenshot.channels)
          if (screenshot.data[i] > screenshot.data[i + 1] + 25 && screenshot.data[i] > screenshot.data[i + 2] + 25)
            shaded++
        return shaded
      },
      { timeout: 20000 },
    )
    .toBeGreaterThan(5000)
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Compare', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(async () =>
      (await mapState(page))?.areas?.features.some((feature) => feature.properties?.color === '#059669'),
    )
    .toBe(true)
  await page.getByLabel('Sun time zone').selectOption('UTC')
  await page.getByLabel('Sun time', { exact: true }).focus()
  await page.getByLabel('Sun time', { exact: true }).press('Home')
  await expect(page.getByText('00:00', { exact: true })).toBeVisible()
  await expect(page.locator('[data-viewshed-status]')).toContainText('Viewshed ready', { timeout: 45000 })
  await page.getByRole('button', { name: '3D terrain', exact: true }).click()
  await expect.poll(async () => (await mapState(page))?.terrain).toBe(false)
  await expect.poll(async () => (await mapState(page))?.overlay).toBe(true)
})

test('red footprint stays visible and updates before a dragged observer is released', async ({ page }) => {
  await stubMap(page)
  await page.goto('/dev/viewshed')
  await page.getByLabel('Analysis radius', { exact: true }).focus()
  await page.getByLabel('Analysis radius', { exact: true }).press('Home')
  await expect(page.locator('[data-viewshed-status]')).toContainText('Viewshed ready', { timeout: 45000 })
  const before = await mapState(page)
  expect(before?.outline).toBe(true)
  expect(before?.areas?.features.some((feature) => feature.properties?.color === '#e11d48')).toBe(true)
  expect(before?.opacity).toBeCloseTo(0.33)
  const pin = await page.getByRole('img', { name: 'Observer location' }).boundingBox()
  expect(pin).toBeTruthy()
  const x = pin!.x + pin!.width / 2,
    y = pin!.y + pin!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 45, y, { steps: 2 })
  expect((await mapState(page))?.overlay).toBe(true)
  await expect.poll(async () => (await mapState(page))?.areas, { timeout: 20000 }).not.toEqual(before?.areas)
  const preview = await mapState(page)
  expect(preview?.areas?.features[0].properties?.size).toBe(64)
  await page.mouse.move(x + 90, y + 20, { steps: 2 })
  expect((await mapState(page))?.overlay).toBe(true)
  await expect
    .poll(async () => (await mapState(page))?.areas?.features[0].properties?.bounds, { timeout: 20000 })
    .not.toEqual(preview?.areas?.features[0].properties?.bounds)
  await page.mouse.up()
  await expect(page.locator('[data-viewshed-status]')).toContainText('Viewshed ready', { timeout: 45000 })
  const final = await mapState(page)
  expect(final?.areas?.features[0].properties?.size).toBe(192)
})

test('missing DEM tiles show unknown results and recover on retry', async ({ page }) => {
  const terrain = await stubMap(page, true)
  await page.goto('/dev/viewshed')
  await page.getByLabel('Analysis radius', { exact: true }).focus()
  await page.getByLabel('Analysis radius', { exact: true }).press('Home')
  await expect(page.locator('[data-viewshed-status]')).toContainText('Viewshed ready', { timeout: 45000 })
  await expect(page.getByText(/Unknown: 100.0%/)).toBeVisible()
  await expect(page.getByText('Ground: unknown', { exact: false })).toBeVisible()
  terrain.failed = false
  await page.getByRole('button', { name: 'Retry terrain' }).click()
  await expect(page.getByText(/Ground: 800 m above sea level/)).toBeVisible({ timeout: 45000 })
  await expect(page.locator('[data-viewshed-status]')).toContainText('Viewshed ready', { timeout: 45000 })
})

test('latest observer coordinates win and the map survives a basemap switch', async ({ page }) => {
  await stubMap(page)
  await page.goto('/dev/viewshed')
  await expect(page.locator('[data-viewshed-status]')).toContainText('Viewshed ready', { timeout: 45000 })
  await page.getByLabel('Longitude', { exact: true }).fill('-122.55')
  await page.getByRole('button', { name: 'Go to coordinates' }).click()
  await page.getByLabel('Longitude', { exact: true }).fill('-122.57')
  await page.getByRole('button', { name: 'Go to coordinates' }).click()
  await expect(page.locator('[data-viewshed-status]')).toContainText('Viewshed ready', { timeout: 45000 })
  await expect
    .poll(async () => {
      const bounds = (await mapState(page))?.areas?.features[0].properties?.bounds
      return bounds ? Math.round(((bounds[0] + bounds[2]) / 2) * 100) / 100 : null
    })
    .toBe(-122.57)
  await page.getByRole('button', { name: 'Satellite imagery' }).click()
  await expect.poll(async () => (await mapState(page))?.overlay).toBe(true)
  await expect.poll(async () => (await mapState(page))?.terrain).toBe(true)
  await expect(page.getByLabel('Longitude', { exact: true })).toHaveValue('-122.57000')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(async () => (await page.locator('[data-viewshed-legend]').boundingBox())?.y ?? 0)
    .toBeGreaterThanOrEqual(64)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('mountain example enables true-scale terrain and tilt changes only the camera', async ({ page }) => {
  await stubMap(page)
  await page.goto('/dev/viewshed')
  await page.getByRole('button', { name: 'Mountain example', exact: true }).click()
  await expect(page.getByLabel('Longitude', { exact: true })).toHaveValue('-119.17530')
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('53.07860')
  await expect.poll(async () => (await mapState(page))?.pitch).toBe(65)
  await expect(page.locator('[data-viewshed-status]')).toContainText('Viewshed ready', { timeout: 45000 })
  const before = await mapState(page)
  expect(before?.terrain).toBe(true)
  expect(before?.exaggeration).toBe(1)
  expect(before?.center?.lng).toBeCloseTo(-119.1753, 4)
  expect(before?.areas?.features[0].properties?.bounds[0]).toBeLessThan(-119.1753)
  await page.getByLabel('Map tilt', { exact: true }).focus()
  await page.getByLabel('Map tilt', { exact: true }).press('Home')
  await expect.poll(async () => (await mapState(page))?.pitch).toBe(0)
  expect((await mapState(page))?.areas).toEqual(before?.areas)
  await expect(page.locator('[data-viewshed-status]')).toContainText('Viewshed ready', { timeout: 45000 })
  await page.getByLabel('Map tilt', { exact: true }).press('End')
  await expect.poll(async () => (await mapState(page))?.pitch).toBe(75)
  expect((await mapState(page))?.terrain).toBe(true)
})

test.describe('viewshed controls on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('changes comparison and sun controls in the sheet while the coverage remains rendered', async ({ page }) => {
    await stubMap(page)
    await page.goto('/dev/viewshed')
    const handle = page.locator('[data-map-mobile-sheet-handle]')
    await handle.press('End')
    await page.getByLabel('Analysis radius', { exact: true }).press('Home')
    await expect(page.locator('[data-viewshed-status]')).toContainText('Viewshed ready', { timeout: 45000 })
    await page.getByRole('button', { name: 'Compare', exact: true }).click()
    await expect
      .poll(async () =>
        (await mapState(page))?.areas?.features.some((feature) => feature.properties?.color === '#059669'),
      )
      .toBe(true)
    await page.getByLabel('Sun time zone').selectOption('UTC')
    await page.getByLabel('Sun time', { exact: true }).press('Home')
    await expect(page.getByText('00:00', { exact: true })).toBeVisible()
    await handle.press('Home')
    await expect.poll(async () => (await mapState(page))?.overlay).toBe(true)
    await expect
      .poll(async () => (await page.locator('[data-viewshed-legend]').boundingBox())?.y ?? 0)
      .toBeGreaterThanOrEqual(64)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  })
})
