import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { encode } from 'fast-png'
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
async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: blankPng }))
  await page.goto('/dev/lidar/data/')
  await expect(page.getByLabel('Import LiDAR or processed layers')).toBeAttached({ timeout: 60_000 })
  await expect(page.locator('.lidar-control-panel')).toBeAttached({ timeout: 60_000 })
  return errors
}
const imports = (page: Page) => page.getByLabel('Import LiDAR or processed layers')
const status = (page: Page) => page.locator('p[role="status"]').first()

test('GeoLibre panel exposes no unguarded file or URL loader', async ({ page }) => {
  const errors = await open(page)
  // Expand through the DOM: the toggle sits in the map's control corner.
  await page
    .locator('button.lidar-control-toggle')
    .first()
    .evaluate((b) => (b as HTMLButtonElement).click())
  const panel = page.locator('.lidar-control-panel').first()
  await expect(panel).toHaveClass(/expanded/)
  await expect(panel.locator('.lidar-control-section').nth(1)).toBeVisible()
  await expect(panel.locator('input[type="file"]')).toHaveCount(1)
  await expect(panel.locator('input[type="file"]')).toBeHidden()
  await expect(panel.locator('.lidar-file-input-wrapper')).toBeHidden()
  await expect(panel.getByText('Load COPC or EPT from URL')).toBeHidden()
  for (const input of await panel.locator('input:visible').all())
    expect(await input.getAttribute('type')).not.toMatch(/^(file|url|text)$/)
  expect(errors).toEqual([])
})

test('imports a restoration GeoTIFF in a non-default CRS and restores the saved project', async ({ page }) => {
  const errors = await open(page)
  const tif = await page.evaluate(async () => {
    const { rasterGeoTiff } = await import('/src/features/lidar-restoration/outputs.ts')
    const raster = {
      west: 500000,
      north: 5985000,
      cellM: 1,
      width: 2,
      height: 2,
      values: Float32Array.from([1, 2, 3, NaN]),
    }
    const result = { epsg: 2955, verticalEpsg: null, rasters: new Proxy({}, { get: () => raster }) }
    return Array.from(new Uint8Array(rasterGeoTiff(result as never, 'slope' as never)))
  })
  await imports(page).setInputFiles({ name: 'slope-2955.tif', mimeType: 'image/tiff', buffer: Buffer.from(tif) })
  await expect(status(page)).toHaveText('slope-2955.tif: imported.')
  await expect(page.getByText('EPSG:2955', { exact: true })).toBeVisible()
  await imports(page).setInputFiles({
    name: 'flat.las',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(restorationLas()),
  })
  await expect(status(page)).toHaveText('flat.las: 80 points, bounded full-file load.')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project' }).click()
  const project = await readFile((await (await download).path())!, 'utf8')
  expect(JSON.parse(project).layers.map((l: { crs: string }) => l.crs)).toEqual(['EPSG:2955'])
  await page.getByRole('button', { name: 'Clear session' }).click()
  await page
    .getByLabel('Restore LiDAR project')
    .setInputFiles({ name: 'p.pgmaps.json', mimeType: 'application/json', buffer: Buffer.from(project) })
  await expect(status(page)).toHaveText('Restored 1 processed layers; point sources require reattachment.')
  await expect(page.getByText('Reattach point sources: flat.las')).toBeVisible()
  expect(errors).toEqual([])
})
