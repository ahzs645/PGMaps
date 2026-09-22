/** Integration acceptance checks. Supplied for execution in the real PGMaps checkout. */
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { demoInput } from '../../src/pages/dev-forestry/regression/scenario.mjs'
import { DEFAULT_VISUAL_QUALITY_THRESHOLDS } from '../../src/pages/dev-forestry/vqo'

test.use({ serviceWorkers: 'block' })
const routePath = '/dev/forestry/visual-quality'
async function openScenario(page: Page) {
  const tile = await readFile(new URL('../fixtures/forestry-flat-800.png', import.meta.url))
  await page.route('https://basemaps.cartocdn.com/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }))
  await page.route('**/elevation-tiles-prod/terrarium/**', route => route.fulfill({ contentType: 'image/png', body: tile }))
  await page.route('**/WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY/ows**', route => route.fulfill({ json: { type: 'FeatureCollection', features: [], numberMatched: 0 } }))
  await page.route('**/bcgw_pub_whse_forest_vegetation/MapServer/*/query**', route => route.fulfill({ json: { type: 'FeatureCollection', features: [] } }))
  const input = demoInput()
  const scene = { ...input, version: 1, viewpoint: { ...input.viewpoint, id: 'test-road', name: 'Integration test road' }, thresholds: DEFAULT_VISUAL_QUALITY_THRESHOLDS }
  await page.addInitScript(scene => localStorage.setItem('pgmaps.forestry-visual-quality.v1', JSON.stringify(scene)), scene)
  await page.goto(routePath)
  await page.getByText('Advanced assessment & settings', { exact: true }).click()
  await page.getByRole('button', { name: 'Run visibility', exact: true }).click()
  await expect(page.getByText('Scenario numerical fields available', { exact: true })).toBeVisible({ timeout: 120_000 })
}

// Mirrors the existing suite's read-only React-ref discovery. It asserts real
// MapLibre state, not merely the words in the new camera panel.
async function cameraState(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('.maplibregl-map')
    if (!container) return null
    const fiberKey = Object.keys(container).find(key => key.startsWith('__reactFiber$'))
    if (!fiberKey) return null
    let node = (container as any)[fiberKey]
    for (let depth = 0; node && depth < 200; depth++, node = node.return) {
      let hook = node.memoizedState
      for (let count = 0; hook && count < 40; count++, hook = hook.next) {
        const map = hook.memoizedState?.current
        if (typeof map?.queryTerrainElevation === 'function') return { terrain: !!map.getTerrain(), pitch: map.getPitch(), zoom: map.getZoom(), bearing: map.getBearing(), maxPitch: map.getMaxPitch(), clamped: map.getCenterClampedToGround() }
      }
    }
    return null
  })
}

test('road preview has finite real camera state and restores map controls', async ({ page }) => {
  test.setTimeout(180_000)
  await openScenario(page)
  const before = await cameraState(page)
  expect(before).not.toBeNull()
  await page.getByRole('button', { name: 'Look from the road', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Road view controls' })).toBeVisible()
  await expect.poll(async () => (await cameraState(page))?.terrain).toBe(true)
  const during = await cameraState(page)
  expect([during?.pitch, during?.zoom, during?.bearing].every(Number.isFinite)).toBe(true)
  expect(during?.clamped).toBe(false)
  await page.getByRole('button', { name: 'Return to map', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Road view controls' })).toHaveCount(0)
  await expect.poll(async () => (await cameraState(page))?.maxPitch).toBe(before?.maxPitch)
  await expect.poll(async () => (await cameraState(page))?.clamped).toBe(before?.clamped)
})

test('a scenario edit withholds stale PDF export until a new run', async ({ page }) => {
  test.setTimeout(180_000)
  await openScenario(page)
  await page.locator('label', { hasText: 'Assessment year' }).locator('input').fill('2027')
  await expect(page.getByText(/Scene changed — rerun the analysis/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export filled FS1252 PDF', exact: true })).toHaveCount(0)
})

test('PDF button downloads the historical template with embedded scenario record', async ({ page }) => {
  test.setTimeout(180_000)
  await openScenario(page)
  await page.getByText('Advanced assessment & settings', { exact: true }).click()
  await page.getByRole('button', { name: 'Fill / export FS1252 PDF', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Assessment integrity and PDF export' })).toBeVisible()
  await page.getByText('FS1252 office information', { exact: true }).click()
  await page.getByLabel('Forest district', { exact: true }).fill('Interface PDF test district')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export filled FS1252 PDF', exact: true }).click()
  const downloaded = await pending
  const location = await downloaded.path()
  expect(location).not.toBeNull()
  const bytes = await readFile(location!)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(bytes.toString('latin1')).toContain('pgmaps-scenario.json')
  expect(bytes.toString('latin1')).toContain('SIMULATION DRAFT')
  expect(bytes.toString('latin1')).toContain('Interface PDF test district')
})
