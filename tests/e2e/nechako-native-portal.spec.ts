import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const sharedBoundary = JSON.parse(
  readFileSync('public/data/boundaries/BCFWA/echoscreen_fraser_nechako.geojson', 'utf8'),
)
const nechakoFeature = sharedBoundary.features.find(
  (feature: GeoJSON.Feature) => feature.properties?.namedWatershedId === 8886,
)

for (const width of [1440, 390]) {
  test(`native portal preserves its map through tools and windows at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    const errors: string[] = []
    const unexpectedReads: string[] = []
    const mapReads: string[] = []
    let searchArea: { geojson: string } | undefined
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.protocol !== 'https:') return route.continue()
      if (url.hostname === 'basemaps.cartocdn.com')
        return route.fulfill({
          json: {
            version: 8,
            sources: {},
            layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
          },
        })
      const operation = url.searchParams.get('REQUEST')
      if (operation === 'GetMap' || operation === 'GetLegendGraphic') {
        if (operation === 'GetMap') mapReads.push(url.searchParams.get('LAYERS') || '')
        return route.fulfill({ contentType: 'image/png', body: png })
      }
      if (operation === 'GetFeatureInfo')
        return route.fulfill({
          json: {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: null, properties: { station: 'Native test river' } }],
          },
        })
      if (url.pathname.endsWith('getSearchContext.php'))
        return route.fulfill({
          json: {
            success: true,
            attributes: [{ context: 'Submission Title' }],
          },
        })
      if (url.pathname.endsWith('getSearchResults.php')) {
        const body = new URLSearchParams(route.request().postData() || '')
        searchArea = JSON.parse(body.get('area') || 'null')
        return route.fulfill({
          json: {
            success: false,
            error: 'Website is not registered',
          },
        })
      }
      unexpectedReads.push(url.href)
      return route.abort('internetdisconnected')
    })
    await page.goto('/dev/nechako/portal')
    await expect(page.getByRole('heading', { name: 'Nechako Watershed Portal', exact: true })).toBeVisible()
    const mapCanvas = page.locator('[data-nechako-portal-map] canvas')
    await expect(mapCanvas).toBeVisible()
    expect(mapReads).toEqual([])
    const canvas = await mapCanvas.elementHandle()
    const nav = page.getByRole('navigation', { name: 'Watershed portal' })
    await expect(async () => {
      await mapCanvas.click()
      await expect(page.getByRole('region', { name: 'Map Tools', exact: true })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15000 })
    await expect(page.getByLabel('Primary vector')).toHaveValue('nechako-watershed-boundary')
    await expect(page.getByRole('row').filter({ hasText: '47257.951' })).toContainText('Nechako River')
    await page.getByRole('button', { name: 'Close Map Tools', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Expand Map Tools', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Expand Map', exact: true }).click()
    await expect(page.getByLabel('Show Nechako research locations')).toBeChecked()
    await expect(page.getByLabel('Show Nechako Watershed')).toBeChecked()
    await page.getByLabel('Show Nechako Watershed').uncheck()
    await page.getByLabel('Show Nechako Watershed').check()
    await page.getByLabel('Show Nechako research locations').uncheck()
    await page.getByRole('button', { name: 'Close Map', exact: true }).click()

    await page.getByRole('button', { name: 'Expand Map Tools', exact: true }).click()
    await expect(page.getByText('32 WMS services', { exact: false })).toBeVisible()
    await expect(page.getByLabel('Named layer or group')).not.toHaveValue('')
    await page.getByLabel('Named layer or group').selectOption('River')
    await page.getByLabel('Layer style', { exact: true }).selectOption('default')
    await page.getByRole('button', { name: 'Add layer to map', exact: true }).click()
    await page.getByLabel('Named layer or group').selectOption('Lake')
    await page.getByRole('button', { name: 'Add layer to map', exact: true }).click()
    await page.getByRole('button', { name: 'Close Map Tools', exact: true }).click()
    await page.getByRole('button', { name: 'Expand Map', exact: true }).click()
    await page.getByLabel('Raise River', { exact: true }).click()
    await expect(page.getByLabel('Raise River', { exact: true })).toBeDisabled()
    await page.getByLabel('Lower River', { exact: true }).click()
    await expect(page.getByLabel('Lower River', { exact: true })).toBeDisabled()
    await page.getByLabel('Remove Lake', { exact: true }).click()
    await page.getByLabel('Inspect on map click', { exact: true }).selectOption({ label: 'Watershed Context — River' })
    await page.getByLabel('Show River', { exact: true }).uncheck()
    await page.getByLabel('Show River', { exact: true }).check()
    await page.getByLabel('Opacity for River', { exact: true }).press('Home')
    for (let step = 0; step < 10; step++)
      await page.getByLabel('Opacity for River', { exact: true }).press('ArrowRight')
    await page.getByText('Layer legends (1)', { exact: true }).click()
    await expect(page.getByAltText('Legend for River', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close Map', exact: true }).click()
    await mapCanvas.click({ position: { x: 150, y: 180 } })
    await expect(page.getByRole('heading', { name: 'Identify: River' })).toBeVisible()
    await expect(page.getByText('Native test river', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Close Map', exact: true }).click()

    await nav.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByText('1,408 total records · 365 without location tags')).toBeVisible()
    await page.getByRole('button', { name: 'Unmapped records', exact: true }).click()
    await expect(page.getByText('365 matching records', { exact: true })).toBeVisible()
    await page.locator('[data-map-sidebar-scroll="true"]').getByRole('button').first().click()
    const recordDialog = page.getByRole('dialog').filter({ hasText: 'nwsviz record' })
    await expect(recordDialog).toContainText('Location IDs: No location tags')
    await expect(recordDialog.getByRole('link', { name: 'Source dataset', exact: true })).toHaveAttribute(
      'href',
      '/data/nechako-showcase/submissions.cleaned.json',
    )
    await recordDialog.getByRole('button', { name: 'Close', exact: true }).last().click()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.getByRole('tab', { name: 'Portal submissions', exact: true }).click()
    await page.getByLabel('Search geographic limit').selectOption('polygon')
    await page.getByLabel('Search area layer').selectOption('nechako-watershed-boundary')
    await page.getByRole('button', { name: 'Search portal', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Portal request failed' })).toContainText(
      'Website is not registered',
    )
    expect(JSON.parse(searchArea!.geojson).features).toEqual([nechakoFeature])
    await page.getByRole('button', { name: 'Close portal window', exact: true }).click()
    expect(await canvas!.isVisible()).toBe(true)

    await nav.getByRole('button', { name: 'Import', exact: true }).click()
    await page.getByLabel('GIS files').setInputFiles({
      name: 'native-site.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'Local site' },
              geometry: { type: 'Point', coordinates: [-124.5, 54] },
            },
          ],
        }),
      ),
    })
    await page.getByRole('button', { name: 'Review GIS import', exact: true }).click()
    await page.getByRole('button', { name: 'Add native-site.geojson to map', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand Map Tools', exact: true }).click()
    await page.getByLabel('Drawing mode').selectOption('Point')
    await page.getByRole('button', { name: 'Close Map Tools', exact: true }).click()
    await mapCanvas.click({ position: { x: 140, y: 200 } })
    await page.getByRole('button', { name: 'Expand Map Tools', exact: true }).click()
    await page.getByRole('button', { name: 'Finish drawing', exact: true }).click()
    await page.getByRole('button', { name: 'Close Map Tools', exact: true }).click()
    await nav.getByRole('button', { name: 'Projects', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export workspace JSON', exact: true }).click()
    const exported = JSON.parse(readFileSync((await (await downloadPromise).path())!, 'utf8'))
    expect(exported.layers.map((layer: { layer: { name: string } }) => layer.layer.name)).toEqual(['River'])
    expect(exported.layers[0].opacity).toBe(0.5)
    expect(exported.layers[0].style).toBe('default')
    expect(exported.vectors.map((vector: { data: { features: unknown[] } }) => vector.data.features.length)).toEqual([
      46, 1, 1, 1,
    ])
    expect(exported.vectors[1].data.features).toEqual([nechakoFeature])
    expect(exported.vectors[1]).toMatchObject({ color: '#0891b2', fillOpacity: 0.14, lineOpacity: 1, lineWidth: 2.2 })
    expect(exported.vectors[0].visible).toBe(false)
    await page.getByRole('button', { name: 'Save workspace in browser', exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await nav.getByRole('button', { name: 'Research map', exact: true }).click()
    const researchMap = page.locator('[data-nechako-research-map]')
    if (width === 390) await researchMap.locator('[data-map-mobile-sheet-handle]').press('End')
    await expect(researchMap.getByText('1,408', { exact: true })).toBeVisible()
    await expect(researchMap.locator('.maplibregl-canvas')).toBeVisible()
    await researchMap.getByRole('button', { name: 'Show Nechako River boundary', exact: true }).click()
    await expect(researchMap.getByLabel('Boundary shading')).toBeVisible()
    await expect(researchMap.locator('[data-regional-boundary-count]')).toContainText('Nechako River')
    await expect(researchMap.getByText('Boundary unavailable', { exact: true })).toHaveCount(0)
    const researchBounds = await researchMap.boundingBox()
    expect(researchBounds!.height).toBeGreaterThan(300)
    await researchMap.getByRole('button', { name: 'Timeline', exact: true }).click()
    await expect(researchMap.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await researchMap.getByRole('button', { name: 'Watershed map', exact: true }).click()
    expect(await canvas!.isVisible()).toBe(true)

    await nav.getByRole('button', { name: 'Reports', exact: true }).click()
    await expect(page.getByLabel('Monitoring CSV')).toBeVisible()
    await page.keyboard.press('Escape')
    await nav.getByRole('button', { name: 'Login / Sign-up', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Open portal login and sign-up' })).toHaveAttribute(
      'href',
      'https://nechakowatershed-portal.ca/',
    )
    await page.keyboard.press('Escape')

    await page.reload()
    await expect(mapCanvas).toBeVisible()
    await nav.getByRole('button', { name: 'Projects', exact: true }).click()
    await page.getByRole('button', { name: 'Restore browser workspace', exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Expand Map', exact: true }).click()
    await expect(page.getByLabel('Show Nechako research locations')).not.toBeChecked()
    await expect(page.getByLabel('Show native-site.geojson')).toBeChecked()
    await expect(page.getByLabel('Show Nechako Watershed')).toBeChecked()
    await expect(page.getByLabel('Show River')).toBeChecked()
    await page.getByRole('button', { name: 'Close Map', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const mapBounds = await mapCanvas.boundingBox()
    expect(mapBounds!.height).toBeGreaterThan(400)
    expect(unexpectedReads).toEqual([])
    expect(errors).toEqual([])
  })
}

test('native portal reports a missing shared boundary and retries without leaving the page', async ({ page }) => {
  let fail = true
  await page.route('**/data/boundaries/BCFWA/echoscreen_fraser_nechako.geojson', (route) =>
    fail ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue(),
  )
  await page.goto('/dev/nechako/portal')
  await expect(page.getByText('Map preview unavailable', { exact: true })).toBeVisible()
  fail = false
  await page.getByRole('button', { name: 'Retry preview', exact: true }).click()
  await expect(page.locator('[data-nechako-portal-map]')).toBeVisible()
})
