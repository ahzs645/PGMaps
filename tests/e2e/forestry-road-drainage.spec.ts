import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import proj4 from 'proj4'
import { expect, test, type Page } from '@playwright/test'
import { initTools, runTool } from 'whitebox-wasm/tools'
import { lasFile } from './road-fixtures'
import { expandRoadSection } from './road-sidebar'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(180_000)

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByRole('heading', { name: 'Forest road design', exact: true })).toBeVisible()
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  return errors
}
/** Roles of the features in the plan's drainage source, read from the MapLibre map React holds. */
async function drainageRoles(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    const key = container && Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!container || !key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!)
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState
        const map =
          value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getTerrain !== 'function') continue
        const source = map.getSource('road-drainage')
        if (source?.type !== 'geojson') return null
        return [
          ...new Set((source.serialize().data as GeoJSON.FeatureCollection).features.map((f) => f.properties?.role)),
        ]
      }
    return null
  })
}
const status = (page: Page) => page.getByTestId('road-workspace-header').getByRole('status')

test('drainage compares flow on the existing and design surfaces and reaches the plan', async ({ page }) => {
  const errors = await prepare(page)
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: 'Drainage', exact: true }).click()
  const panel = page.getByTestId('road-drainage')
  await panel.getByLabel('Stream from (ha)', { exact: true }).fill('0.5')
  await panel.getByRole('button', { name: 'Run drainage check', exact: true }).click()
  await expect(status(page)).toContainText('Drainage:', { timeout: 60_000 })
  await expect(panel.getByRole('region', { name: 'Stream crossings', exact: true })).toBeVisible()
  await expect(panel).toContainText('Planning estimate, not a hydrotechnical design')
  // Both surfaces' streams reach the map.
  await expect.poll(() => drainageRoles(page)).toEqual(expect.arrayContaining(['stream-existing', 'stream-design']))
  // A changed input stales the run and takes it off the plan until it is re-run.
  await panel.getByLabel('Rainfall (mm/h)', { exact: true }).fill('60')
  await panel.getByLabel('Rainfall (mm/h)', { exact: true }).press('Tab')
  await expect(panel.getByText('changed since this run')).toBeVisible()
  await expect.poll(() => drainageRoles(page)).toEqual([])
  await panel.getByRole('button', { name: 'Re-run drainage', exact: true }).click()
  await expect(panel.getByText('changed since this run')).toHaveCount(0)
  await expect.poll(() => drainageRoles(page)).toEqual(expect.arrayContaining(['stream-design']))
  // A run belongs to its road: a new alternative starts without one, and the original keeps its own.
  await page.getByRole('button', { name: 'Duplicate active alignment', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Run drainage check', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Undo road edit', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Re-run drainage', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('LAZ import classifies ground in the browser and builds a TIN with breaklines', async ({ page }) => {
  const errors = await prepare(page)
  // An unclassified cloud, compressed by WhiteboxTools itself (lidar_shift with no shift, .laz out).
  const wasmDir = dirname(createRequire(import.meta.url).resolve('whitebox-wasm'))
  await initTools(readFileSync(join(wasmDir, 'whitebox-cli.wasm')))
  const converted = await runTool('lidar_shift', {
    args: ['--input=/work/in.las', '--output=/work/out.laz'],
    input: { 'in.las': new Uint8Array(lasFile(false)) },
  })
  expect(converted.exitCode).toBe(0)
  const laz = Buffer.from(converted.files['out.laz'])

  const workflow = page.getByRole('tablist', { name: 'Road workflow', exact: true })
  await workflow.getByRole('tab', { name: 'Terrain' }).click()
  await expandRoadSection(page, 'road-point-cloud-options')
  await page.getByRole('combobox', { name: 'Point-cloud surface', exact: true }).selectOption('tin')
  // A draped breakline across the cloud (WGS84, from its UTM 10N corners).
  const utm = proj4('+proj=utm +zone=10 +datum=NAD83 +units=m +no_defs', 'EPSG:4326')
  const line = [utm.forward([515005, 5970020]), utm.forward([515035, 5970020])]
  let chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add breaklines (GeoJSON)', exact: true }).click()
  await (
    await chooser
  ).setFiles({
    name: 'ditch.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } }],
      }),
    ),
  })
  await expect(status(page)).toContainText('1 breakline from ditch.geojson')

  await page.getByLabel('Imported DEM vertical datum (metres)', { exact: true }).fill('CGVD2013 / EPSG:6647')
  chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import GeoTIFF, LAS or LAZ', exact: true }).click()
  await (await chooser).setFiles({ name: 'hill.laz', mimeType: 'application/octet-stream', buffer: laz })
  await expect(status(page)).toContainText(/LAZ 1\.\d: /, { timeout: 120_000 })
  await expect(status(page)).toContainText('classified here')
  await expect(status(page)).toContainText('from a TIN with')
  // About half the points are the slope; the canopy 25 m up must not be taken as ground.
  const text = (await status(page).textContent())!
  const [ground, total] = text
    .match(/([\d,]+) of ([\d,]+) points are ground/)!
    .slice(1)
    .map((n) => Number(n.replace(/,/g, '')))
  expect(ground / total).toBeGreaterThan(0.4)
  expect(ground / total).toBeLessThan(0.6)
  await expect(page.getByTestId('road-planning-basis')).toContainText('TERRAIN')
  expect(errors).toEqual([])
})
