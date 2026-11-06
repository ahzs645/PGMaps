import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { fromArrayBuffer } from 'geotiff'
import { decode, encode } from 'fast-png'
import { restorationLas } from '../fixtures/restoration'

test.use({
  serviceWorkers: 'block',
  viewport: { width: 1440, height: 1000 },
  launchOptions: {
    ...(process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
  },
})
test.setTimeout(120_000)
const blankPng = Buffer.from(
  encode({ width: 256, height: 256, channels: 4, data: new Uint8Array(256 * 256 * 4).fill(255) }),
)
async function prepare(page: Page, path = '/dev/forestry/road-restoration') {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: blankPng }))
  await page.goto(path)
  await expect(page.getByRole('button', { name: 'Run restoration metrics' })).toBeVisible()
}
async function layerState(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('.maplibregl-map')
    if (!container) return null
    const key = Object.keys(container).find((k) => k.startsWith('__reactFiber$'))
    if (!key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let d = 0; fiber && d < 200; d++, fiber = fiber.return!)
      for (let hook = fiber.memoizedState, n = 0; hook && n < 40; hook = hook.next, n++) {
        const value = hook.memoizedState
        const map =
          value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getLayer !== 'function') continue
        const image = map.getSource('restoration-raster')?.serialize() as { coordinates?: number[][] } | undefined
        const corners = image?.coordinates
        const xy = corners
          ? map.project([corners[0][0] * 0.75 + corners[1][0] * 0.25, (corners[0][1] + corners[3][1]) * 0.5])
          : null
        const rect = map.getCanvas().getBoundingClientRect()
        return {
          layer: Boolean(map.getLayer('restoration-raster')),
          loaded: map.isSourceLoaded('restoration-raster'),
          pixel: xy ? { x: Math.floor(rect.x + xy.x), y: Math.floor(rect.y + xy.y) } : null,
        }
      }
    return null
  })
}

test('real LAZ worker, raster map, GIS export, result invalidation and both library links', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await prepare(page)
  await page.getByLabel('LAS / LAZ tiles', { exact: true }).setInputFiles('tests/fixtures/restoration-synthetic.laz')
  const wasm = page.waitForResponse((r) => /laz-perf[^/]*\.wasm/.test(r.url()) && r.status() === 200)
  await page.getByRole('button', { name: 'Run restoration metrics' }).click()
  await wasm
  await expect(page.getByTestId('returns-read')).toHaveText('80')
  await expect.poll(() => layerState(page)).toMatchObject({ layer: true, loaded: true })
  await page.getByLabel('Restoration layer').selectOption('understory')
  // A loaded source can still render black when its GPU texture lacks mipmaps.
  await expect
    .poll(async () => {
      const state = await layerState(page)
      if (!state?.pixel) return false
      const png = decode(await page.screenshot({ clip: { ...state.pixel, width: 1, height: 1 } }))
      return png.data[0] > 180 && png.data[1] > 200 && png.data[2] > 150
    })
    .toBe(true)
  const selected = await layerState(page)
  await page.mouse.click(selected!.pixel!.x, selected!.pixel!.y)
  await expect(page.getByText(/20\.000 % · cell/)).toBeVisible()
  await page.getByLabel('Restoration layer').selectOption('meanHeight')
  await expect(page.getByText(/20\.000 % · cell/)).toHaveCount(0)
  await page.getByLabel('Restoration layer').selectOption('understory')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Selected GeoTIFF' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('understory.tif')
  const bytes = await readFile((await download.path())!),
    image = await (
      await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    ).getImage()
  expect(image.getGeoKeys().ProjectedCSTypeGeoKey).toBe(3157)
  expect([...(await image.readRasters({ interleave: true }))]).toEqual([20, 20, 20, 20])
  await page.screenshot({ path: testInfo.outputPath('restoration-workspace.png'), fullPage: true })
  await page.getByLabel('Density / strata cell').fill('4')
  await page.getByLabel('Density / strata cell').press('Tab')
  await expect(page.getByTestId('returns-read')).toHaveCount(0)
  expect(errors).toEqual([])
  await page.goto('/dev/forestry')
  await expect(page.getByRole('link', { name: 'Open LiDAR road restoration' })).toBeVisible()
  await page.goto('/dev/lidar')
  await expect(page.getByRole('link', { name: 'Local LiDAR road restoration' })).toBeVisible()
})

test('rejects malformed files and can run again with LAS on the LiDAR route', async ({ page }) => {
  await prepare(page, '/dev/lidar/restoration')
  await page
    .getByLabel('LAS / LAZ tiles', { exact: true })
    .setInputFiles({ name: 'broken.las', mimeType: 'application/octet-stream', buffer: Buffer.from('broken') })
  await page.getByRole('button', { name: 'Run restoration metrics' }).click()
  await expect(page.getByText(/truncated LAS header/)).toBeVisible()
  await page
    .getByLabel('LAS / LAZ tiles', { exact: true })
    .setInputFiles({ name: 'flat.las', mimeType: 'application/octet-stream', buffer: Buffer.from(restorationLas()) })
  await page.getByRole('button', { name: 'Run restoration metrics' }).click()
  await expect(page.getByTestId('returns-read')).toHaveText('80')
})

test('mobile controls and results remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await prepare(page)
  await page.getByLabel('LAS / LAZ tiles', { exact: true }).setInputFiles('tests/fixtures/restoration-synthetic.laz')
  await page.getByRole('button', { name: 'Run restoration metrics' }).click()
  await expect(page.getByTestId('returns-read')).toHaveText('80')
  await page.getByRole('button', { name: 'Run manifest' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Run manifest' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('full supplied BC tile runs in Chromium and exports all GIS products', async ({ page }, testInfo) => {
  test.skip(!process.env.PGMAPS_RESTORATION_LAZ, 'Set PGMAPS_RESTORATION_LAZ to run the 550 MB real-data check.')
  test.setTimeout(900_000)
  // A long real-data run must survive source edits made in another review window.
  await page.routeWebSocket('**', (socket) => socket.close())
  await prepare(page)
  await page.getByLabel('LAS / LAZ tiles', { exact: true }).setInputFiles(process.env.PGMAPS_RESTORATION_LAZ!)
  const started = Date.now()
  await page.getByRole('button', { name: 'Run restoration metrics' }).click()
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  // This remains responsive while the worker reads the large cloud.
  await expect(page.getByRole('link', { name: 'Forestry tools', exact: true })).toBeEnabled()
  await expect(page.getByTestId('returns-read')).toHaveText('84,608,005', { timeout: 800_000 })
  await expect.poll(() => layerState(page), { timeout: 30_000 }).toMatchObject({ layer: true, loaded: true })
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: 'All rasters + methods ZIP' }).click()
  const download = await event
  await download.saveAs(testInfo.outputPath('restoration-products.zip'))
  await writeFile(
    testInfo.outputPath('restoration-timing.json'),
    JSON.stringify({ seconds: (Date.now() - started) / 1000 }),
  )
  await page.screenshot({ path: testInfo.outputPath('restoration-full-tile.png'), fullPage: true })
})
