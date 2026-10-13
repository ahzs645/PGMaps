import { expect, test } from '@playwright/test'
import { FEATURE_COMPARISON, FORMAT_COMPARISON } from '../../src/maps/nechako/comparison'

const origin = 'https://nechakowatershed-portal.ca'
const resource = `${origin}/cgi-bin/qgis_mapserv.fcgi/?map=/var/www/qgis_maps/example.qgs&REQUEST=GetCapabilities`
const capabilities = `<?xml version="1.0"?><WMS_Capabilities xmlns="http://www.opengis.net/wms" version="1.3.0"><Capability><Request><GetMap><Format>image/png</Format></GetMap><GetFeatureInfo><Format>application/json</Format></GetFeatureInfo></Request><Layer queryable="1"><CRS>EPSG:3857</CRS><EX_GeographicBoundingBox><westBoundLongitude>-126</westBoundLongitude><eastBoundLongitude>-122</eastBoundLongitude><southBoundLatitude>53</southBoundLatitude><northBoundLatitude>55</northBoundLatitude></EX_GeographicBoundingBox><Style><Name>native</Name><Title>Original colours</Title></Style><Layer><Name>native group</Name><Title>Watershed group</Title><Layer><Name>river</Name><Title>Rivers</Title></Layer></Layer></Layer></Capability></WMS_Capabilities>`
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

// Stubbed interaction tests are separate from the un-intercepted live CORS checks.
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`portal workbench handles public layers, failures and retries at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const errors: string[] = []
    const requests: { path: string; body: string | null; headers: Record<string, string> }[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
        },
      }),
    )
    let searchFails = true
    await page.route('https://projects.ahmadjalil.com/nwsviz/data/**', (route) => {
      const name = new URL(route.request().url()).pathname.split('/').pop()
      if (name === 'overview.json')
        return route.fulfill({ json: { submissionsTotal: 3, submissionsWithoutLocations: 1 } })
      if (name === 'submissions.cleaned.json')
        return route.fulfill({
          json: [
            {
              id: 1,
              title: 'Unmapped salmon note',
              author: 'River author',
              publicationYear: 2020,
              decade: 2020,
              resourceTypeMain: 'report',
              resourceType: 'Report',
              tags: ['salmon'],
              locationIds: [],
            },
            {
              id: 2,
              title: 'Regional fish study',
              author: null,
              publicationYear: 2019,
              decade: 2010,
              resourceTypeMain: 'report',
              resourceType: 'Report',
              tags: [],
              locationIds: ['nechako_watershed'],
            },
            {
              id: 3,
              title: 'Lake observations',
              author: null,
              publicationYear: null,
              decade: null,
              resourceTypeMain: 'report',
              resourceType: 'Report',
              tags: [],
              locationIds: ['lake'],
            },
          ],
        })
      return route.fulfill({ json: [] })
    })
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      requests.push({ path: url.pathname, body: request.postData(), headers: await request.allHeaders() })
      const success = (attributes: unknown) => route.fulfill({ json: { success: true, status: 'success', attributes } })
      if (url.pathname.includes('qgis_mapserv')) {
        const operation = url.searchParams.get('REQUEST')
        expect(url.searchParams.get('map')).toBe('/var/www/qgis_maps/example.qgs')
        if (operation === 'GetCapabilities')
          return route.fulfill({ contentType: 'application/xml', body: capabilities })
        if (operation === 'GetFeatureInfo')
          return route.fulfill({
            json: {
              type: 'FeatureCollection',
              features: [
                { type: 'Feature', geometry: null, properties: { name: '<script>untrusted</script>', station: 7 } },
              ],
            },
          })
        return route.fulfill({ contentType: 'image/png', body: png })
      }
      if (url.pathname.endsWith('getBaseLayers.php'))
        return success([{ name: 'Watershed Context', type: 'wms', resource }])
      if (url.pathname.endsWith('getSearchContext.php'))
        return success([{ context: 'Submission Title' }, { context: 'Submission ID' }])
      if (url.pathname.endsWith('getSearchResults.php') && !searchFails)
        return success({
          results: Array.from({ length: 26 }, (_, i) => ({
            submission_id: i + 1,
            submission_title: `Record ${i + 1}`,
            submission_name: `Source record ${i + 1}`,
            submission_date: '2026-01-01',
            submitted_by: 'Fixture author',
          })),
        })
      if (url.pathname.endsWith('getSpatialFormats.php'))
        return success([{ name: 'GeoJSON', format_extension: '.geojson', enabled: true }])
      if (url.pathname.endsWith('getForms.php')) return success([])
      return route.fulfill({
        json: { success: true, status: 'failure', error: 'Website is not registered', loggedIn: false },
      })
    })
    await page.goto('/dev/nechako?view=layers&source=live')
    const workbenchTabs = page.getByRole('tablist', { name: 'Nechako portal views', exact: true })
    await expect(page.getByText('1 WMS services', { exact: false })).toBeVisible()
    await expect(page.getByLabel('Named layer or group')).toHaveValue('native group')
    await page.getByLabel('Layer style', { exact: true }).selectOption('native')
    const tile = page.waitForRequest((request) => new URL(request.url()).searchParams.get('REQUEST') === 'GetMap')
    await page.getByRole('button', { name: 'Add layer to map', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Map layers (1)' })).toBeVisible()
    await page.locator('.maplibregl-canvas').scrollIntoViewIfNeeded()
    await tile
    await page.locator('.maplibregl-canvas').click({ position: { x: 150, y: 180 } })
    await expect(page.getByRole('heading', { name: 'Identify: Watershed group' })).toBeVisible()
    await expect(page.getByText('"station": 7', { exact: false })).toBeVisible()
    expect(await page.locator('script').filter({ hasText: 'untrusted' }).count()).toBe(0)
    await page.getByLabel('Opacity for Watershed group').focus()
    await page.getByLabel('Opacity for Watershed group').press('Home')
    for (let i = 0; i < 10; i++) await page.getByLabel('Opacity for Watershed group').press('ArrowRight')
    await expect(page.getByText('Opacity 50%')).toBeVisible()
    await page.getByRole('button', { name: 'Zoom to layer' }).click()
    await page.getByText('Layer legends (1)', { exact: true }).click()
    await expect(page.getByAltText('Legend for Watershed group')).toBeVisible()
    await workbenchTabs.getByRole('tab', { name: 'Search', exact: true }).click()
    await page.getByRole('tab', { name: 'Live portal submissions', exact: true }).click()
    await page.getByLabel('Search expression').fill('(salmon OR trout) AND {Submission ID} >= 100')
    await page.getByRole('button', { name: 'Search portal', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Website is not registered')
    const searchRequest = requests.find((request) => request.path.endsWith('getSearchResults.php'))!
    const form = new URLSearchParams(searchRequest.body!)
    expect(JSON.parse(form.get('keys')!).token).toBe('AND')
    expect(JSON.parse(form.get('fields')!)).toEqual(['Submission Title', 'Submission ID'])
    expect(form.get('area')).toBe('null')
    expect(searchRequest.headers['x-requested-with']).toBeUndefined()
    expect(searchRequest.headers['content-type']).toContain('application/x-www-form-urlencoded')
    searchFails = false
    await page.getByRole('button', { name: 'Search portal', exact: true }).click()
    await expect(page.getByText('Submission table: 26 object records · Page 1 of 2')).toBeVisible()
    await page.getByRole('button', { name: 'Next submissions', exact: true }).click()
    await expect(page.getByRole('cell', { name: 'Record 26', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Previous submissions', exact: true }).click()
    await page.getByLabel('Search expression').fill('salmon AND')
    await page.getByRole('button', { name: 'Search portal', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('incomplete')
    await expect(page.getByText('Submission table: 26 object records · Page 1 of 2')).toHaveCount(0)
    await workbenchTabs.getByRole('tab', { name: 'Projects', exact: true }).click()
    await page.getByRole('button', { name: 'Refresh portal projects', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Website is not registered')
    await expect(page.getByRole('button', { name: 'Load portal project', exact: true })).toBeDisabled()
    await workbenchTabs.getByRole('tab', { name: 'Form reports', exact: true }).click()
    await page.getByRole('button', { name: 'Read available report forms', exact: true }).click()
    await expect(page.getByLabel('Source report form', { exact: true }).getByRole('option')).toHaveCount(1)
    await workbenchTabs.getByRole('tab', { name: 'Formats', exact: true }).click()
    await expect(page.getByText('"format_extension": ".geojson"', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Refresh formats' }).click()
    await expect(page.getByText('"format_extension": ".geojson"', { exact: false })).toBeVisible()
    await workbenchTabs.getByRole('tab', { name: 'Research', exact: true }).click()
    await page.getByLabel('Research data source').selectOption('live')
    await expect(page.getByText('3 total records · 1 without location tags')).toBeVisible()
    await expect(page.getByText('3 matching records')).toBeVisible()
    await page.getByRole('button', { name: 'Unmapped records', exact: true }).click()
    await expect(page.getByText('1 matching records')).toBeVisible()
    await page.getByRole('button', { name: /Unmapped salmon note/ }).click()
    await expect(page.getByRole('dialog')).toContainText('No location tags')
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click()
    await page.getByLabel('Search research records').fill('no matching research')
    await expect(page.getByText('0 matching records')).toBeVisible()
    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    await expect(page.getByText('1 matching records')).toBeVisible()
    await page.getByRole('button', { name: 'All records', exact: true }).click()
    await expect(page.getByText('3 matching records')).toBeVisible()
    await workbenchTabs.getByRole('tab', { name: 'Comparison', exact: true }).click()
    await expect(page).toHaveURL(/view=compare/)
    await expect(page.getByRole('table')).toHaveCount(2)
    expect(await page.getByRole('table').first().getByRole('row').count()).toBe(FEATURE_COMPARISON.length + 1)
    expect(await page.getByRole('table').last().getByRole('row').count()).toBe(FORMAT_COMPARISON.length + 1)
    await workbenchTabs.getByRole('tab', { name: 'Layers', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Map layers (1)' })).toBeVisible()
    await page.getByRole('button', { name: 'Refresh catalogue' }).click()
    await expect(page.getByLabel('Named layer or group')).toHaveValue('native group')
    await page.getByRole('button', { name: 'Remove Watershed group' }).click()
    await expect(page.getByRole('heading', { name: 'Map layers (0)' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Identify: Watershed group' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}

test('capabilities parser retains inherited metadata and rejects exception responses', async ({ page }) => {
  await page.goto('/dev')
  const result = await page.evaluate(async (xml) => {
    // Vite serves this module on the canonical local test route.
    // @ts-expect-error browser-side Vite module URL
    const { parseWmsCapabilities } = await import('/src/lib/nechakoPortal.ts')
    const parsed = parseWmsCapabilities(xml)
    let error = ''
    try {
      parseWmsCapabilities(
        '<ServiceExceptionReport><ServiceException>Unavailable</ServiceException></ServiceExceptionReport>',
      )
    } catch (failure) {
      error = String(failure)
    }
    return { parsed, error }
  }, capabilities)
  expect(result.parsed.layers).toHaveLength(2)
  expect(result.parsed.layers[1]).toMatchObject({
    name: 'river',
    queryable: true,
    crs: ['EPSG:3857'],
    bounds: [-126, 53, -122, 55],
    styles: [{ name: 'native', title: 'Original colours' }],
  })
  expect(result.error).toContain('Unavailable')
})
