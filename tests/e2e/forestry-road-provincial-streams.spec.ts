import { openWorkbench } from './road-workbench'
import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { createDemoProject } from '../../src/pages/dev-forestry-roads/terrain'
import { chooseExport } from './road-files'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)
const streamGeometry = createDemoProject().context.find((f) => f.kind === 'stream')!.geometry
const fixtures = {
  '56': [
    {
      type: 'Feature',
      geometry: streamGeometry,
      properties: {
        OBJECTID: 42,
        GNIS_NAME: 'Fixture FWA reach',
        EDGE_TYPE: 1000,
        STREAM_ORDER: 2,
        BLUE_LINE_KEY: 100,
      },
    },
  ],
  '20': [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122.7117, 53.892] },
      properties: {
        OBJECTID: 7,
        FISH_OBSERVATION_POINT_ID: 17,
        SPECIES_NAME: 'Rainbow trout',
        OBSERVATION_DATE: 1304985600000,
      },
    },
  ],
  '35': [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.715, 53.89],
            [-122.706, 53.89],
            [-122.706, 53.896],
            [-122.715, 53.896],
            [-122.715, 53.89],
          ],
        ],
      },
      properties: {
        OBJECTID: 8,
        WLS_CW_SYSID: 18,
        CW_NAME: 'Fixture community watershed',
        CW_CODE: 'TEST',
        CW_LEGISLATION: 'FRPA',
      },
    },
  ],
}

async function open(page: Page, failFish = false) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://delivery.maps.gov.bc.ca/arcgis/rest/services/**', (route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.match(/MapServer\/(\d+)\/query$/)?.[1] as keyof typeof fixtures | undefined
    if (!id || !fixtures[id]) return route.continue()
    if (failFish && id === '20') return route.fulfill({ status: 503, body: 'source unavailable' })
    const records = fixtures[id]
    return route.fulfill({
      json: url.searchParams.has('returnIdsOnly')
        ? { objectIdFieldName: 'OBJECTID', objectIds: records.map((f) => f.properties.OBJECTID) }
        : { type: 'FeatureCollection', features: records },
    })
  })
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Show road controls', exact: true }).click()
  await page.getByRole('tab', { name: 'Terrain', exact: true }).click()
}

async function mapEvidenceCounts(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    const key = element && Object.keys(element).find((name) => name.startsWith('__reactFiber$'))
    if (!element || !key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (element as unknown as Record<string, Fiber>)[key]
    for (let n = 0; fiber && n < 200; n++, fiber = fiber.return!) {
      for (let hook = fiber.memoizedState, k = 0; hook && k < 40; hook = hook.next, k++) {
        const value = hook.memoizedState
        const map =
          value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getSource !== 'function') continue
        const count = (id: string) => {
          const source = map.getSource(id)
          return source?.type === 'geojson'
            ? (source.serialize().data as GeoJSON.FeatureCollection).features.length
            : null
        }
        return {
          fish: count('circle-shared-road-provincial-fish'),
          watersheds: count('fill-shared-road-provincial-watersheds'),
        }
      }
    }
    return null
  })
}

test('provincial sources render, retain separate assessment evidence, and travel in saved files and reports', async ({
  page,
}) => {
  await open(page)
  await page.getByRole('button', { name: 'Load BC streams & evidence', exact: true }).click()
  const row = page.locator('[data-stream-row="bc-fwa-42-0"]')
  await expect(row).toContainText('No class · unassessed')
  await expect.poll(() => mapEvidenceCounts(page)).toEqual({ fish: 1, watersheds: 1 })
  await row.click()
  await expect(page.getByTestId('stream-source-evidence')).toContainText('FWA source record 42')
  await expect(page.getByRole('combobox', { name: 'Fish stream', exact: true })).toHaveAttribute(
    'data-value',
    'unresolved',
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const file = await (await pending).path()
  const project = JSON.parse(fs.readFileSync(file!, 'utf8'))
  expect(project.provincialStreamData.sourceCounts).toEqual({ streams: 1, fish: 1, watersheds: 1 })
  expect(project.context.find((f: { id: string }) => f.id === 'bc-fwa-42-0').streamSource.sourceId).toBe('42')
  const reportDownload = page.waitForEvent('download')
  await (await chooseExport(page, 'Report HTML')).click()
  const report = fs.readFileSync((await (await reportDownload).path())!, 'utf8')
  expect(report).toContain('Fixture FWA reach')
  expect(report).toContain('Fixture community watershed')
  expect(report).toContain('does not support fish absence')
})

test('a failed companion source leaves the existing project untouched', async ({ page }) => {
  await open(page, true)
  await page.getByRole('button', { name: 'Load BC streams & evidence', exact: true }).click()
  await expect(page.getByTestId('provincial-stream-context')).toContainText('failed (503)')
  await expect(page.locator('[data-stream-row="bc-fwa-42-0"]')).toHaveCount(0)
  await expect(page.locator('[data-stream-row="demo-stream"]')).toBeVisible()
})

test('the provincial loading controls remain usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  await page.getByRole('button', { name: 'Load BC streams & evidence', exact: true }).click()
  await expect(page.locator('[data-stream-row="bc-fwa-42-0"]')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
