import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

const payload = JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', id: 42, geometry: { type: 'Point', coordinates: [-122.75, 53.915] }, properties: { siteId: 42, name: 'Example PG depot', address: 'Main Street, Prince George', description: 'Location supplied by consultant', victoriaFile: '26250-20/42', regionalFile: null } },
  { type: 'Feature', id: 84, geometry: { type: 'Point', coordinates: [-123.12, 49.28] }, properties: { siteId: 84, name: 'Example Vancouver site', address: null, description: null, victoriaFile: null, regionalFile: null } },
] })
const sha256 = createHash('sha256').update(payload).digest('hex')
const manifest = { schemaVersion: 1, featureCount: 2, downloadedAt: '2026-09-22T00:00:00Z', license: 'Access Only', resource: `sites-${sha256}.geojson.gz`, sha256 }

async function setup(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', route => route.fulfill({ json: { version: 8, glyphs: 'https://remediation-test.invalid/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [] } }))
  await page.route('https://remediation-test.invalid/**', route => route.fulfill({ body: Buffer.alloc(0) }))
  await page.route('**/__dev_remediation/map-manifest.json', route => route.fulfill({ json: manifest }))
  // Browser fetch sees decoded JSON because the real server supplies Content-Encoding.
  await page.route('**/__dev_remediation/sites-*.geojson.gz', route => route.fulfill({ contentType: 'application/json', body: payload }))
}

async function pointLayerCount(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('.maplibregl-map')
    if (!container) return 0
    const key = Object.keys(container).find(key => key.startsWith('__reactFiber$'))
    // Follow the same map-ref inspection used by the forestry integration suite.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node = key ? (container as any)[key] : null
    for (let depth = 0; node && depth < 100; depth++, node = node.return) {
      let hook = node.memoizedState
      for (let i = 0; hook && i < 50; i++, hook = hook.next) {
        const map = hook.memoizedState?.current ?? hook.memoizedState
        if (typeof map?.getStyle === 'function') {
          return map.getStyle()?.layers?.filter((layer: { id: string }) => layer.id.startsWith('unclustered-point-')).length ?? 0
        }
      }
    }
    return 0
  })
}

test('loads site geometry, searches, selects and clears a site', async ({ page }) => {
  await setup(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/misc?tab=remediation')
  await expect(page.getByRole('heading', { name: 'Environmental Remediation Sites' })).toBeVisible()
  await expect(page.getByLabel('Find a site')).toBeEnabled()
  await expect.poll(() => pointLayerCount(page)).toBe(1)
  await page.getByLabel('Find a site').fill('DEPOT george')
  const results = page.getByRole('region', { name: 'Search results' })
  await expect(results.getByRole('button')).toHaveCount(1)
  await results.getByRole('button').click()
  await expect(page.getByRole('region', { name: 'Selected site' })).toContainText('26250-20/42')
  await expect(page.locator('.maplibregl-popup')).toContainText('Example PG depot')
  await page.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Selected site' })).toHaveCount(0)
  await page.getByLabel('Find a site').fill('nothing matches')
  await expect(results).toContainText('No sites match')
  expect(errors).toEqual([])
})

test('missing snapshot can be retried, corrupt snapshot is rejected', async ({ page }) => {
  await setup(page)
  let missing = true
  await page.route('**/__dev_remediation/map-manifest.json', route => missing ? route.fulfill({ status: 404 }) : route.fulfill({ json: manifest }))
  await page.goto('/misc?tab=remediation')
  await expect(page.getByRole('alert')).toContainText('npm run remediation:sync')
  missing = false
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByLabel('Find a site')).toBeEnabled()
  await page.route('**/__dev_remediation/sites-*.geojson.gz', route => route.fulfill({ body: '{}' }))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('integrity check failed')
})

test('mobile sidebar remains scrollable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await page.goto('/misc?tab=remediation')
  await expect(page.getByText('BC sites', { exact: true })).toBeAttached()
  await expect.poll(() => pointLayerCount(page)).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.locator('[data-map-sidebar-scroll]').first()).toHaveCSS('overflow-y', 'auto')
})
