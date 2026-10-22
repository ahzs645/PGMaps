import { test, expect, type Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'

async function prepare(page: Page) {
  const applicationWrites: string[] = []
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
      },
    }),
  )
  await page.route('https://nechakowatershed-portal.ca/rest/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (/set|add|save|submit|upload/i.test(path)) applicationWrites.push(path)
    return route.fulfill({ json: { success: true, status: 'success', attributes: [] } })
  })
  await page.route('**/api/nechako/**', (route) => {
    if (route.request().method() !== 'GET') applicationWrites.push(route.request().url())
    return route.fulfill({ status: 404, json: { error: 'No application backend in this browser fixture.' } })
  })
  await page.goto('/dev/nechako/portal?panel=files')
  await expect(page.getByRole('heading', { name: 'Files, GIS and bibliographic imports' })).toBeVisible()
  return applicationWrites
}

test('real browser GDAL writes and reads GIS files with no application backend', async ({ page }) => {
  test.setTimeout(180000)
  const writes = await prepare(page)
  const result = await page.evaluate(async () => {
    const { createGisExport, convertFiles } = await import('/src/maps/nechako/data/conversion.ts')
    const data = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 0,
          properties: { name: 'Zero station', count: 0 },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
        {
          type: 'Feature',
          id: 7,
          properties: { name: 'Nechako station', count: 2 },
          geometry: { type: 'Point', coordinates: [-124.5, 54] },
        },
      ],
    }
    const exports = []
    let gpkgBase64 = ''
    for (const format of ['gpkg', 'shapefile', 'kml', 'gpx', 'sqlite', 'spatialite', 'gml', 'kmz']) {
      const exported = await createGisExport(data, format, 'field-stations')
      const bytes = new Uint8Array(await exported.blob.arrayBuffer())
      if (format === 'gpkg') gpkgBase64 = btoa(String.fromCharCode(...bytes))
      const imported = await convertFiles([new File([exported.blob], exported.name)])
      exports.push({
        format,
        name: exported.name,
        bytes: bytes.length,
        layers: imported.layers.map((layer) => ({ name: layer.name, features: layer.data.features })),
        warnings: exported.warnings,
      })
    }
    return { exports, gpkgBase64 }
  })
  expect(result.exports.map((item) => item.format)).toEqual([
    'gpkg',
    'shapefile',
    'kml',
    'gpx',
    'sqlite',
    'spatialite',
    'gml',
    'kmz',
  ])
  for (const item of result.exports) {
    expect(item.bytes).toBeGreaterThan(100)
    expect(
      item.layers
        .flatMap((layer) => layer.features)
        .some((feature) => JSON.stringify(feature.geometry?.coordinates) === '[0,0]'),
    ).toBe(true)
  }
  expect(result.exports[0].layers[0].features[0]).toMatchObject({ id: 0, properties: { count: 0 } })
  expect(result.exports[1].warnings.join(' ')).toContain('original.geojson')
  await page.getByLabel('GIS files', { exact: true }).setInputFiles({
    name: 'field-stations.gpkg',
    mimeType: 'application/geopackage+sqlite3',
    buffer: Buffer.from(result.gpkgBase64, 'base64'),
  })
  await page.getByRole('button', { name: 'Review GIS import', exact: true }).click()
  await expect(page.getByText('1 converted layers', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cache GIS layers and originals', exact: true }).click()
  await expect(page.getByText('Saved 2 local layer/source-file items in this browser.', { exact: true })).toBeVisible()
  await page.reload()
  const cached = await page.evaluate(async () => {
    const { listLocalWorkbench } = await import('/src/maps/nechako/data/localWorkbench.ts')
    return (await listLocalWorkbench('layer')).map((record) => record.data)
  })
  expect(cached[0]).toMatchObject({
    schema: 'nechako-local-layer-v1',
    materialization: { status: 'complete', featureCount: 2 },
    data: { features: [{ id: 0, properties: { count: 0 } }, { id: 7 }] },
  })
  expect(writes).toEqual([])
})

for (const width of [1440, 390])
  test(`GPAP, attachment, monitoring and mapped drafts persist locally at ${width}px`, async ({ page }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width, height: 900 })
    const writes = await prepare(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const fixture = readFileSync('tests/fixtures/nechako/local-field-project.gpap')
    await page
      .getByLabel('GPAP project file', { exact: true })
      .setInputFiles({ name: 'local-field-project.gpap', mimeType: 'application/vnd.geopaparazzi', buffer: fixture })
    await expect(page.getByText(/2 notes · 2 images · 2 GPS logs/)).toBeVisible()
    await page.getByText('Note 0 · Zero note', { exact: false }).click()
    await expect(
      page.getByText('Repeated form key Repeat at /forms/0; scoped paths keep both values.', { exact: true }),
    ).toBeVisible()
    const originalDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download original GPAP', exact: true }).click()
    const original = await originalDownload
    expect(readFileSync((await original.path())!)).toEqual(fixture)
    await page.getByRole('button', { name: 'Review GPAP local save', exact: true }).click()
    await page.getByLabel('Acknowledge GPAP import issues', { exact: true }).check()
    await page.getByRole('button', { name: 'Save GPAP to browser cache', exact: true }).click()
    await expect(page.getByText('Saved 8 local items', { exact: false })).toBeVisible()
    await page
      .getByLabel('Attachment preview file', { exact: true })
      .setInputFiles({ name: 'field-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Original zero: 0\n') })
    await page.getByLabel('Attachment description', { exact: true }).fill('Field attachment with zero')
    await page.getByLabel('Attachment tags', { exact: true }).fill('field, original')
    const firstDraft = await page
      .getByLabel('Attachment local draft', { exact: true })
      .locator('option')
      .nth(1)
      .getAttribute('value')
    await page.getByLabel('Attachment local draft', { exact: true }).selectOption(firstDraft!)
    await page.getByRole('button', { name: 'Stage attachment locally', exact: true }).click()
    await expect(page.getByText('Attachment staged in this browser', { exact: false })).toBeVisible()
    await page.getByLabel('Monitoring ingestion CSV', { exact: true }).setInputFiles({
      name: 'observations.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'time,station,value,keep\n2026-01-01T00:00:00Z,0,0,false\n2026-01-01T00:00:00Z,0,2,second\nbad,0,3,original\n',
      ),
    })
    await page.getByLabel('Ingestion Primary measurement column', { exact: true }).selectOption('value')
    await expect(
      page.getByText(
        '3 original rows · 2 valid observations · 1 rows with issues · 1 repeated station/timestamp pairs.',
        { exact: false },
      ),
    ).toBeVisible()
    await page.getByLabel('Keep monitoring rows with issues', { exact: true }).check()
    await page.getByRole('button', { name: 'Cache monitoring CSV', exact: true }).click()
    await expect(page.getByText('Saved 3 original CSV rows', { exact: false })).toBeVisible()
    await page
      .getByLabel('Draft review CSV', { exact: true })
      .setInputFiles({ name: 'drafts.csv', mimeType: 'text/csv', buffer: Buffer.from('count,original\n0,false\n') })
    await page.getByRole('button', { name: 'Use source columns as a local review form', exact: true }).click()
    await page.getByRole('button', { name: 'Select rows without issues', exact: true }).click()
    await page.getByRole('button', { name: 'Save selected drafts to browser cache', exact: true }).click()
    await expect(
      page.getByText('Saved 1 mapped local drafts with their original values.', { exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(page.getByText('Cached attachments (3)', { exact: true })).toBeVisible()
    const persisted = await page.evaluate(async () => {
      const { listLocalWorkbench } = await import('/src/maps/nechako/data/localWorkbench.ts')
      return (await listLocalWorkbench()).map(({ kind, data, filename, blob }) => ({
        kind,
        data,
        filename,
        bytes: blob?.size,
      }))
    })
    expect(persisted.filter((item) => item.kind === 'submission')).toHaveLength(3)
    expect(persisted.find((item) => item.kind === 'monitoring')?.data).toMatchObject({
      records: [{ value: '0', keep: 'false' }, { value: '2' }, { time: 'bad' }],
      observations: [{ primary: 0 }, { primary: 2 }],
      validation: { duplicates: 1, errors: [{ row: 4 }] },
    })
    expect(persisted.find((item) => item.filename === 'local-field-project.gpap')?.bytes).toBe(fixture.length)
    expect(persisted.find((item) => item.filename === 'field-note.txt')?.data).toMatchObject({
      description: 'Field attachment with zero',
      tags: ['field', 'original'],
      relationships: [{ kind: 'submission', id: firstDraft }],
    })
    await page.getByRole('button', { name: 'Edit drafts.csv — row 1', exact: true }).click()
    await page.getByLabel('Local draft title', { exact: true }).fill('Reviewed zero draft')
    await page.getByLabel('Local draft review status', { exact: true }).selectOption('reviewed')
    await page.getByLabel('Local draft type local:count', { exact: true }).selectOption('number')
    await page.getByLabel('Local draft type local:original', { exact: true }).selectOption('boolean')
    await page.getByText('Edit WGS84 geometry', { exact: true }).click()
    await page.getByLabel('Local draft geometry', { exact: true }).fill('{"type":"Point","coordinates":[0,0,0]}')
    await page.getByRole('button', { name: 'Save local draft edits', exact: true }).click()
    await expect(page.getByText('Saved local draft edits.', { exact: false })).toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: 'Edit Reviewed zero draft', exact: true }).click()
    await expect(page.getByLabel('Local draft review status', { exact: true })).toHaveValue('reviewed')
    await expect(page.getByLabel('Local draft value local:count', { exact: true })).toHaveValue('0')
    await expect(page.getByLabel('Local draft value local:original', { exact: true })).toHaveValue('false')
    const edited = await page.evaluate(async () => {
      const { listLocalWorkbench } = await import('/src/maps/nechako/data/localWorkbench.ts')
      return (await listLocalWorkbench('submission')).find((record) => record.name === 'Reviewed zero draft')?.data
    })
    expect(edited).toMatchObject({
      status: 'reviewed',
      values: { 'local:count': 0, 'local:original': false },
      original: { count: '0', original: 'false' },
      geometry: { type: 'Point', coordinates: [0, 0, 0] },
      history: [{ name: 'drafts.csv — row 1' }],
    })
    await page.evaluate(async () => {
      const { saveLocalWorkbench } = await import('/src/maps/nechako/data/localWorkbench.ts')
      await saveLocalWorkbench({
        id: 'schema:blank',
        kind: 'schema',
        name: 'Blank field schema',
        data: { id: 0, fields: [{ id: 'count', label: 'Count', type: 'integer', required: true, default: 5 }] },
      })
    })
    await expect(
      page.getByLabel('New local draft schema', { exact: true }).locator('option[value="schema:blank"]'),
    ).toHaveCount(1)
    await page.getByLabel('New local draft schema', { exact: true }).selectOption('schema:blank')
    await page.getByRole('button', { name: 'Create local draft', exact: true }).click()
    await expect(
      page.getByText('Created a blank draft in this browser from the cached schema.', { exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel('Local draft type count', { exact: true })).toHaveValue('null')
    await page.reload()
    await page.getByRole('button', { name: 'Edit New Blank field schema', exact: true }).click()
    await expect(page.getByLabel('Local draft type count', { exact: true })).toHaveValue('null')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(writes).toEqual([])
    expect(errors).toEqual([])
  })
