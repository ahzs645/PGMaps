import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const features = {
  type: 'FeatureCollection',
  features: [0, 4, '4'].map((value, id) => ({
    type: 'Feature',
    id,
    properties: { value, flag: false },
    geometry: { type: 'Point', coordinates: [-124 + id / 10, 54] },
  })),
}
const file = (name: string, value: unknown) => ({
  name,
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(value)),
})
async function fixtures(page: Page) {
  const errors: string[] = []
  const monitorPages: number[] = []
  const wfsOffsets: number[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'basemaps.cartocdn.com')
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
        },
      })
    if (url.pathname.endsWith('/getSchemas_TBD.php'))
      return route.fulfill({
        json: {
          success: true,
          attributes: [{ id: 15, schema: 'Test stations', geometryType: 'Point', has_style: false }],
        },
      })
    if (url.pathname.endsWith('/getSubmissionLayersAddLayer.php'))
      return route.fulfill({
        json: { success: true, status: 'failure', error: 'Not allowed access to any submissions.' },
      })
    if (url.pathname.endsWith('/getLinkedLayers.php'))
      return route.fulfill({ json: { success: true, attributes: [{ layer_id: 9, layer_name: 'Shared watershed' }] } })
    if (url.pathname.endsWith('/downloadFile.php'))
      return route.fulfill({
        contentType: 'text/html',
        body: '<b>Cannot write file to server: source temporary directory unavailable</b>',
      })
    if (url.pathname.endsWith('/getMonitorData.php')) {
      const params = new URLSearchParams(route.request().postData() ?? '')
      const page = Number(params.get('pageNumber'))
      monitorPages.push(page)
      expect(params.get('layerId')).toBe('386')
      expect(params.get('recId')).toBe('1')
      expect(params.get('pageSize')).toBe('500')
      const data = Array.from({ length: Math.min(500, Math.max(0, 1001 - page * 500)) }, (_, i) => ({
        id: page * 500 + i,
        date: `2025-01-01T${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
        value: i === 1 ? null : i,
        station: 'Station A',
      }))
      return route.fulfill({
        json: {
          success: true,
          attributes: { fields: ['id', 'date', 'value', 'station'], data, recordCount: 1001, noData: !data.length },
        },
      })
    }
    if (url.hostname === 'wfs.example.test') {
      const offset = Number(url.searchParams.get('startIndex'))
      wfsOffsets.push(offset)
      const data = Array.from({ length: Math.min(500, Math.max(0, 501 - offset)) }, (_, i) => ({
        ...features.features[0],
        id: offset + i,
      }))
      return route.fulfill({
        json: { type: 'FeatureCollection', features: data, numberMatched: 501, numberReturned: data.length },
      })
    }
    return route.abort('internetdisconnected')
  })
  await page.route('**/api/nechako-portal/status', (route) =>
    route.fulfill({ json: { available: false, loggedIn: false, isAdmin: false, canWrite: false, readOnly: true } }),
  )
  return { errors, monitorPages, wfsOffsets }
}

for (const width of [1440, 390]) {
  test(`source picker, file materialization, typed queries and cache survive reload at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150000)
    const { errors } = await fixtures(page)
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/dev/nechako/portal?panel=source-layers')
    const dialog = page.getByRole('dialog', { name: 'Source layers and local queries', exact: true })
    await page.getByRole('button', { name: 'Load public catalogue', exact: true }).click()
    await page.getByRole('button', { name: /^Test stations/ }).click()
    await expect(page.getByRole('button', { name: 'Add cached features to map', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Try public source export', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('did not return GeoJSON')
    await page
      .getByLabel('Materialize selected source layer', { exact: true })
      .setInputFiles(file('stations.geojson', features))
    await expect(dialog).toContainText('3 features stored.')
    await expect(dialog).toContainText('separately verified dataset total')
    await page.getByRole('button', { name: 'Cache catalogue references', exact: true }).click()
    await expect(dialog).toContainText('0 new catalogue references saved. Existing cached features were retained.')
    await page.getByRole('button', { name: 'Add cached features to map', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await page
      .getByRole('navigation', { name: 'Watershed portal' })
      .getByRole('button', { name: 'Source layers', exact: true })
      .click()
    await page.getByLabel('Map layer to query', { exact: true }).selectOption({ label: 'Test stations' })
    await page.getByLabel('Query field', { exact: true }).selectOption('value')
    await page.getByLabel('Query value type', { exact: true }).selectOption('number')
    await page.getByLabel('Query value', { exact: true }).fill('4')
    await expect(dialog).toContainText('1 of 3 cached features match.')
    await page.getByRole('button', { name: 'Save query result locally', exact: true }).click()
    await expect(dialog).toContainText('Query result saved on this browser.')
    await page.getByRole('tab', { name: 'Cached layers', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Test stations · query/ })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`sources-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    await page.reload()
    await page.getByRole('tab', { name: 'Cached layers', exact: true }).click()
    await page.getByRole('button', { name: /^Test stations schema/ }).click()
    await expect(page.getByLabel('Selected source layer', { exact: true })).toContainText('3 features')
    await page.getByRole('tab', { name: 'Submission layers', exact: true }).click()
    await page.getByRole('button', { name: 'Load public catalogue', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Not allowed access to any submissions.')
    await page.getByRole('tab', { name: 'Shared layers', exact: true }).click()
    await page.getByRole('button', { name: 'Load public catalogue', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Shared watershed/ })).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('WFS materialization verifies all pages and reopens cached features without a server', async ({ page }) => {
  test.setTimeout(120000)
  const { errors, wfsOffsets } = await fixtures(page)
  await page.goto('/dev/nechako?view=source-layers')
  await page.getByText('Download a complete WFS feature layer', { exact: true }).click()
  await page.getByLabel('WFS service URL', { exact: true }).fill('https://wfs.example.test/geoserver/wfs')
  await page.getByLabel('WFS feature type', { exact: true }).fill('source:counted')
  await page.getByRole('button', { name: 'Download WFS features', exact: true }).click()
  await expect(page.getByLabel('Selected source layer', { exact: true })).toContainText(
    '501 / 501 features · source count verified',
  )
  expect(wfsOffsets).toEqual([0, 500, 0, 500, 501])
  await page.getByRole('button', { name: 'Save selected layer locally', exact: true }).click()
  await expect(
    page.getByText('Saved source:counted on this browser. 501 features stored.', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await page.getByRole('tab', { name: 'Cached layers', exact: true }).click()
  await page.getByRole('button', { name: /^source:counted local/ }).click()
  await expect(page.getByLabel('Selected source layer', { exact: true })).toContainText('source count verified')
  expect(wfsOffsets).toHaveLength(5)
  expect(errors).toEqual([])
})

test('complete monitoring downloads every page, verifies totals and reopens its saved original values', async ({
  page,
}, testInfo) => {
  test.setTimeout(150000)
  const { errors, monitorPages } = await fixtures(page)
  await page.goto('/dev/nechako/portal?panel=monitoring')
  await page.getByRole('button', { name: 'Use verified Upper_Nechako example', exact: true }).click()
  await page.getByRole('button', { name: 'Load observations', exact: true }).click()
  await page.getByLabel('Monitoring unique row ID', { exact: true }).selectOption('id')
  await page.getByRole('button', { name: 'Fetch all observation pages', exact: true }).click()
  await expect(page.getByLabel('Complete monitoring extraction')).toContainText(
    'Count-verified complete extract: 1,001 / 1,001 rows.',
  )
  expect(monitorPages).toEqual([0, 0, 1, 2, 0, 2, 3])
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download extract and verification JSON', exact: true }).click()
  const result = JSON.parse(readFileSync((await (await downloaded).path())!, 'utf8'))
  expect(result.rows).toHaveLength(1001)
  expect(result.rows[0].value).toBe(0)
  expect(result.rows[1].value).toBeNull()
  expect(result.verification).toMatchObject({
    countMatches: true,
    boundaryPagesRechecked: true,
    terminalPageEmpty: true,
    uniqueIdsChecked: true,
    atomicSnapshot: false,
  })
  await page.getByRole('button', { name: 'Save complete extract locally', exact: true }).click()
  await expect(page.getByLabel('Complete monitoring extraction')).toContainText(
    'Observations and verification saved on this browser.',
  )
  await page.reload()
  await page.getByRole('button', { name: 'Open cached observations', exact: true }).click()
  await expect(page.getByLabel('Cached monitoring')).toContainText('Complete extract: 1,001 / 1,001 source rows.')
  await page.screenshot({ path: testInfo.outputPath('complete-monitoring.png') })
  expect(monitorPages).toHaveLength(7)
  expect(errors).toEqual([])
})
