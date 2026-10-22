import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const portal = 'https://nechakowatershed-portal.ca'
const points = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 1,
      properties: { name: 'Station A', reading: 7.25 },
      geometry: { type: 'Point', coordinates: [-124, 54] },
    },
    {
      type: 'Feature',
      id: 2,
      properties: { name: 'Station B', reading: null },
      geometry: { type: 'Point', coordinates: [-124.1, 54.1] },
    },
  ],
}
const upload = (name: string, value: unknown, mimeType = 'application/json') => ({
  name,
  mimeType,
  buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
})

for (const width of [1440, 390]) {
  test(`local imports, monitoring, workspaces and submission resources at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    const errors: string[] = []
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
    const requests: { path: string; body: string | null }[] = []
    await page.route(`${portal}/**`, (route) => {
      const path = new URL(route.request().url()).pathname
      requests.push({ path, body: route.request().postData() })
      const attributes = path.endsWith('getBaseLayers.php')
        ? []
        : path.endsWith('getSearchContext.php')
          ? [{ context: 'Submission Title' }]
          : path.endsWith('getSearchResults.php')
            ? {
                results: [
                  {
                    submission_id: 73,
                    submission_title: 'Synthetic portal record',
                    submission_name: 'Test',
                    submission_date: '2025-01-01',
                    submitted_by: 'Test author',
                  },
                ],
              }
            : path.endsWith('getSubmissionMetadata.php')
              ? { submission_title: '<script>do not execute</script>', submission_name: 'Synthetic metadata' }
              : []
      return route.fulfill({ json: { success: true, status: 'success', attributes } })
    })
    await page.goto('/dev/nechako?view=files')
    await page.getByLabel('GIS files', { exact: true }).setInputFiles(upload('stations.geojson', points))
    await page.getByRole('button', { name: 'Review GIS import', exact: true }).click()
    await expect(page.getByText('stations.geojson · 2 features · Point')).toBeVisible()
    await page.getByRole('button', { name: 'Add stations.geojson to map', exact: true }).click()
    await expect(page).toHaveURL(/view=layers/)
    await expect(page.getByText('Station A', { exact: true })).toBeVisible()
    await page.getByLabel('Color for stations.geojson').fill('#2563eb')
    await page.getByRole('button', { name: 'Run geometry operation' }).click()
    await expect(page.getByText('buffer: stations.geojson (1)', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Undo vector edit', exact: true }).click()
    await expect(page.getByText('buffer: stations.geojson (1)', { exact: false })).toHaveCount(0)
    await page.getByLabel('Drawing mode').selectOption('Point')
    await page.locator('.maplibregl-canvas').click({ position: { x: 150, y: 180 } })
    await expect(page.getByText('1 vertices; click the map to place them.')).toBeVisible()
    await page.getByRole('button', { name: 'Finish drawing', exact: true }).click()
    await expect(page.getByText('Drawn point (1)', { exact: false })).toBeVisible()
    await page.getByText('Save, load and import workspaces', { exact: true }).click()
    await page.getByRole('button', { name: 'Save workspace in browser', exact: true }).click()
    await expect(page.getByText('Workspace saved in this browser.', { exact: true })).toBeVisible()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export workspace JSON', exact: true }).click()
    const exported = await download
    const path = await exported.path()
    const saved = JSON.parse(readFileSync(path!, 'utf8'))
    expect(saved.schema).toBe('nechako-workspace-v1')
    expect(saved.vectors).toHaveLength(2)
    const native = {
      coordinates: [-124.5, 54],
      scale: 100000,
      layers: [
        {
          sourceType: 'Vector',
          checked: true,
          legendName: 'Native stations',
          layerData: JSON.stringify(points),
          schemaId: 4,
          submissionId: 73,
        },
        { sourceType: 'BingMaps', legendName: 'Unsupported saved provider' },
      ],
    }
    await page
      .getByLabel('Import portal project or workspace JSON')
      .setInputFiles(upload('native-project.json', native))
    await expect(page.getByText('Native stations (2)', { exact: false })).toBeVisible()
    await expect(
      page.getByText('Unsupported saved provider: Unsupported source BingMaps; original retained.'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Restore browser workspace', exact: true }).click()
    await expect(page.getByText('Drawn point (1)', { exact: false })).toBeVisible()
    await page.getByRole('tab', { name: 'Files & imports', exact: true }).click()
    await page
      .getByLabel('Bibliographic CSV')
      .setInputFiles(
        upload(
          'zotero.csv',
          'Title,DOI,Author\n"River, report",10.1000/test,One\nAnother,https://doi.org/10.1000/test,Two\n,10.1000/other,Three',
          'text/csv',
        ),
      )
    await expect(
      page.getByText('3 records · 1 repeated DOI identifiers · 1 records without a mapped title'),
    ).toBeVisible()
    const draftDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export draft review', exact: true }).click()
    expect((await draftDownload).suggestedFilename()).toBe('bibliography-review.json')
    await page.getByRole('tab', { name: 'Monitoring', exact: true }).click()
    const csv =
      'timestamp,station,temp,level\n' +
      Array.from(
        { length: 54 },
        (_, i) =>
          `2025-01-${String(1 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z,A,${i === 2 ? '' : i},${i + 1}`,
      ).join('\n') +
      '\ninvalid,A,1,2'
    await page.getByLabel('Monitoring CSV', { exact: true }).setInputFiles(upload('monitoring.csv', csv, 'text/csv'))
    await page.getByLabel('Primary measurement', { exact: true }).selectOption('temp')
    await page.getByLabel('Secondary measurement', { exact: true }).selectOption('level')
    await page.getByLabel('Primary unit', { exact: true }).fill('°C')
    await page.getByLabel('Secondary unit', { exact: true }).fill('m')
    await expect(
      page.getByText('54 valid observations · 1 rejected rows · 0 duplicate station/timestamps'),
    ).toBeVisible()
    await expect(page.getByLabel('line monitoring chart')).toBeVisible()
    await page.getByLabel('Monitoring chart type').selectOption('bar')
    await expect(page.getByLabel('bar monitoring chart')).toBeVisible()
    await page.getByRole('button', { name: 'Next observations', exact: true }).click()
    await expect(page.getByText('54 filtered observations · Page 2 of 2')).toBeVisible()
    const csvDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export filtered observations', exact: true }).click()
    const csvPath = await (await csvDownload).path()
    expect(readFileSync(csvPath!, 'utf8').split('\r\n')).toHaveLength(55)
    await page.getByRole('tab', { name: 'Search', exact: true }).click()
    // Search opens on the unified public-content search; the portal's own
    // expression and geographic search is the "Live portal submissions" type.
    await page.getByRole('tab', { name: 'Live portal submissions', exact: true }).click()
    await page.getByLabel('Search geographic limit').selectOption('extent')
    await page.getByRole('button', { name: 'Search portal', exact: true }).click()
    await expect(page.getByRole('button', { name: '73', exact: true })).toBeVisible()
    const sent = requests.find((item) => item.path.endsWith('getSearchResults.php'))!
    const area = JSON.parse(new URLSearchParams(sent.body!).get('area')!)
    expect(JSON.parse(area.geojson).features[0].geometry.type).toBe('Polygon')
    await page.getByRole('button', { name: '73', exact: true }).click()
    await page.getByText('Metadata', { exact: true }).click()
    await page.getByRole('button', { name: 'Load metadata', exact: true }).click()
    // Metadata renders as a term/value list, with values as text rather than markup.
    const submission = page.getByRole('dialog', { name: 'Portal submission 73' })
    await expect(submission.getByRole('definition').filter({ hasText: 'Synthetic metadata' })).toBeVisible()
    await expect(
      submission.getByRole('definition').filter({ hasText: '<script>do not execute</script>' }),
    ).toBeVisible()
    expect(
      new URLSearchParams(requests.find((item) => item.path.endsWith('getSubmissionMetadata.php'))!.body!).get(
        'submissionId',
      ),
    ).toBe('73')
    expect(await page.locator('script').filter({ hasText: 'do not execute' }).count()).toBe(0)
    // Submission resources open in a modal; close it before returning to the tabs.
    await submission.getByRole('contentinfo').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(submission).toBeHidden()
    await page.getByRole('tab', { name: 'Monitoring', exact: true }).click()
    await expect(
      page.getByText('54 valid observations · 1 rejected rows · 0 duplicate station/timestamps'),
    ).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}

test('browser GDAL imports a GeoPackage and exports it without an application backend', async ({ page }) => {
  test.setTimeout(180000)
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
      },
    }),
  )
  await page.route(`${portal}/**`, (route) =>
    route.fulfill({ json: { success: true, status: 'success', attributes: [] } }),
  )
  const applicationWrites: string[] = []
  await page.route('**/api/nechako/**', (route) => {
    if (route.request().method() !== 'GET') applicationWrites.push(route.request().url())
    return route.fulfill({ status: 404, json: { error: 'No application backend in this fixture.' } })
  })
  await page.goto('/dev/nechako?view=files')
  const gpkgBase64 = await page.evaluate(async (data) => {
    const { withBrowserGdal } = await import('/src/pages/dev-avast/gdal.ts')
    return withBrowserGdal(async (gdal) => {
      const opened = await gdal.open(new File([JSON.stringify(data)], 'source.geojson'))
      try {
        const output = await gdal.ogr2ogr(
          opened.datasets[0],
          ['-f', 'GPKG', '-nln', 'source', '-t_srs', 'EPSG:3005'],
          'projected-source',
        )
        return btoa(String.fromCharCode(...(await gdal.getFileBytes(output))))
      } finally {
        for (const dataset of opened.datasets) await gdal.close(dataset)
      }
    })
  }, points)
  await page.getByLabel('GIS files', { exact: true }).setInputFiles({
    name: 'source.gpkg',
    mimeType: 'application/geopackage+sqlite3',
    buffer: Buffer.from(gpkgBase64, 'base64'),
  })
  await page.getByRole('button', { name: 'Review GIS import', exact: true }).click()
  await expect(page.getByText('source · 2 features · Point')).toBeVisible()
  await page.getByRole('button', { name: 'Add source to map', exact: true }).click()
  await expect(page.getByText('Station A', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Convert GIS export', exact: true }).click()
  const exported = await download
  expect(exported.suggestedFilename()).toBe('nechako-layer.gpkg')
  const features = await page.evaluate(
    async (base64) => {
      const { convertFiles } = await import('/src/maps/nechako/data/conversion.ts')
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
      return (await convertFiles([new File([bytes], 'export.gpkg')])).layers[0].data.features
    },
    readFileSync((await exported.path())!).toString('base64'),
  )
  expect(features).toHaveLength(2)
  expect(features[0].geometry.coordinates[0]).toBeCloseTo(-124, 7)
  expect(features[0].geometry.coordinates[1]).toBeCloseTo(54, 7)
  expect(features[0].properties.reading).toBe(7.25)
  expect(features[1].properties.reading).toBeNull()
  expect(applicationWrites).toEqual([])
})
