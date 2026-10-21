import { expect, test, type Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import JSZip from 'jszip'
import initSqlJs from 'sql.js'

const fixtureName = 'Synthetic field project — browser regression fixture'
const workspace = {
  schema: 'nechako-workspace-v1',
  camera: { center: [-124.5, 54], zoom: 8, bearing: 0, pitch: 0 },
  layers: [],
  tiles: [
    {
      id: 'remote-reference',
      name: 'Synthetic remote tiles — reference only',
      urls: ['https://tiles.example.test/{z}/{x}/{y}.png'],
      attribution: 'Synthetic fixture',
      visible: false,
    },
  ],
  warnings: ['Synthetic regression data; not source portal observations.'],
  vectors: [
    {
      id: 'source-stations-0',
      name: 'Synthetic field stations',
      color: '#0f766e',
      visible: true,
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 0,
            properties: { name: 'Zero station', value: 0, enabled: false, observed_at: '2020-01-02' },
            geometry: { type: 'Point', coordinates: [-124.5, 54, 712.25] },
          },
          {
            type: 'Feature',
            id: 'station-original-2',
            properties: { name: 'Unknown elevation', value: 2 },
            geometry: { type: 'Point', coordinates: [-124.4, 54.05] },
          },
        ],
      },
    },
    {
      id: 'source-area-7',
      name: 'Synthetic survey area',
      color: '#bb4400',
      visible: true,
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'polygon-original',
            properties: { name: 'Original survey area' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-124.6, 53.9],
                  [-124.3, 53.9],
                  [-124.3, 54.1],
                  [-124.6, 53.9],
                ],
              ],
            },
          },
        ],
      },
    },
  ],
}
const originalGpap = readFileSync('tests/fixtures/nechako/local-field-project.gpap')

async function start(page: Page) {
  const writes: string[] = []
  const unexpected: string[] = []
  const errors: string[] = []
  const startupDiagnostics: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') startupDiagnostics.push(message.text())
  })
  await page.route('https://**/*', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.hostname === 'basemaps.cartocdn.com')
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
        },
      })
    if (url.hostname === 'nechakowatershed-portal.ca' && url.pathname.startsWith('/rest/')) {
      if (/set|add|save|submit|upload/i.test(url.pathname)) writes.push(request.url())
      return route.fulfill({ json: { success: true, status: 'success', attributes: [] } })
    }
    unexpected.push(request.url())
    return route.abort('internetdisconnected')
  })
  await page.route('**/api/nechako*/**', (route) => {
    if (route.request().method() !== 'GET') writes.push(route.request().url())
    return route.fulfill({ status: 404, json: { error: 'No application backend in this synthetic browser fixture.' } })
  })
  await page.route('**/data/nechako-showcase/research-workspace.json', (route) => route.fulfill({ json: workspace }))
  await page.route('**/data/boundaries/BCFWA/echoscreen_fraser_nechako.geojson', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            ...workspace.vectors[1].data.features[0],
            properties: { namedWatershedId: 8886, name: 'Synthetic test boundary' },
          },
        ],
      },
    }),
  )
  await page.goto('/dev/nechako/portal')
  await expect(page.locator('[data-nechako-portal-map] canvas'))
    .toBeVisible()
    .catch((reason: unknown) => {
      throw new Error(
        `${String(reason)}\nCaptured page errors: ${errors.join('\n')}\nConsole: ${startupDiagnostics.join('\n')}`,
      )
    })
  await page.evaluate(
    async ({ fixture, name, gpap }) => {
      const { saveLocalWorkbench } = await import('/src/maps/nechako/data/localWorkbench.ts')
      const { createLocalWorkbenchProject } = await import('/src/maps/nechako/data/localWorkbenchProjects.ts')
      await saveLocalWorkbench({
        id: 'fixture-project',
        kind: 'project',
        name,
        data: createLocalWorkbenchProject(fixture),
        source: {
          access: 'private',
          recordId: 'original-project-0',
          notes: 'Synthetic fixture; no real account data.',
        },
      })
      await saveLocalWorkbench({
        id: 'fixture-draft',
        kind: 'submission',
        name: 'Synthetic draft',
        data: {
          schema: 'nechako-local-submission-v1',
          status: 'draft',
          sourceNoteId: 0,
          values: { count: 0, present: false },
          attachmentIds: ['fixture-attachment'],
        },
        source: { access: 'private', recordId: '0' },
      })
      await saveLocalWorkbench({
        id: 'fixture-attachment',
        kind: 'attachment',
        name: 'Synthetic field attachment',
        data: {
          schema: 'nechako-local-attachment-v1',
          relationships: [{ kind: 'submission', id: 'fixture-draft', role: 'evidence' }],
        },
        blob: new Blob(['Original attachment: 0, false\n'], { type: 'text/plain' }),
        filename: 'field-note.txt',
        mime: 'text/plain',
        source: { access: 'private' },
      })
      await saveLocalWorkbench({
        id: 'fixture-monitoring',
        kind: 'monitoring',
        name: 'Synthetic monitoring rows',
        data: {
          schema: 'nechako-local-monitoring-v1',
          records: [{ station: '0', value: '0', enabled: 'false' }],
          validation: { duplicates: 0, errors: [] },
        },
      })
      await saveLocalWorkbench({
        id: 'fixture-style',
        kind: 'style',
        name: 'Synthetic preserved SLD',
        data: {
          schema: 'nechako-local-style-v1',
          originalSld: '<StyledLayerDescriptor version="1.0.0"/>',
          diagnostics: [{ severity: 'warning', message: 'Synthetic original preserved for review.' }],
        },
      })
      await saveLocalWorkbench({
        id: 'nechako-style-defaults-v1',
        kind: 'style-defaults',
        name: 'Synthetic style defaults',
        data: { schema: 'nechako-style-defaults-v1', assignments: { point: 'fixture-style' } },
      })
      await saveLocalWorkbench({
        id: 'fixture-query',
        kind: 'query',
        name: 'Synthetic saved query',
        data: {
          schema: 'nechako-synthetic-query-fixture',
          sourceId: '0',
          filters: [{ field: 'value', operator: '=', value: 0 }],
        },
      })
      const bytes = Uint8Array.from(atob(gpap), (character) => character.charCodeAt(0))
      await saveLocalWorkbench({
        id: 'fixture-gpap-original',
        kind: 'geopaparazzi',
        name: 'Synthetic original GPAP',
        data: { schema: 'nechako-local-gpap-v1', sourceNoteIds: [0, 7] },
        blob: new Blob([bytes]),
        filename: 'local-field-project.gpap',
        mime: 'application/x-sqlite3',
      })
    },
    { fixture: workspace, name: fixtureName, gpap: originalGpap.toString('base64') },
  )
  const panel = await openWorkbench(page)
  await panel.getByLabel('Local project', { exact: true }).selectOption('fixture-project')
  await panel.getByRole('button', { name: 'Open local project', exact: true }).click()
  await expect(panel).not.toBeVisible()
  return { writes, errors, unexpected }
}

async function openWorkbench(page: Page) {
  await page.getByRole('button', { name: 'Local workbench', exact: true }).click()
  const panel = page.locator('[data-nechako-local-workbench]')
  await expect(panel.getByRole('heading', { name: 'Named projects on this device', exact: true })).toBeVisible()
  return panel
}

async function records(page: Page) {
  return page.evaluate(async () => {
    const { listLocalWorkbench } = await import('/src/maps/nechako/data/localWorkbench.ts')
    return Promise.all(
      (await listLocalWorkbench()).map(async ({ blob, ...record }) => ({
        ...record,
        original: blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : undefined,
      })),
    )
  })
}

for (const width of [1440, 390])
  test(`local workbench saves, reloads, checksums and restores every kind at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width, height: 920 })
    const observed = await start(page)
    let panel = await openWorkbench(page)
    await panel.getByLabel('Local project', { exact: true }).selectOption('fixture-project')
    await panel.getByRole('button', { name: 'Save current map locally', exact: true }).click()
    await expect(panel.getByText(`Saved “${fixtureName}” on this device.`, { exact: false })).toBeVisible()
    await expect(panel.getByText('1 previous local saves', { exact: true })).toBeVisible()
    await panel.getByRole('tab', { name: 'Schemas', exact: true }).click()
    await panel.getByLabel('Local schema name', { exact: true }).fill('Synthetic local observation schema')
    await panel.getByRole('button', { name: 'Save local schema', exact: true }).click()
    await expect(
      panel.getByText('Saved local schema “Synthetic local observation schema”.', { exact: false }),
    ).toBeVisible()
    const before = await records(page)
    expect(before).toHaveLength(9)
    expect(before.find((item) => item.id === 'fixture-project')?.data).toMatchObject({
      workspace: { sessionBound: false, vectors: [{ id: 'source-stations-0' }, { id: 'source-area-7' }] },
      history: [{ workspace: { vectors: [{ id: 'source-stations-0' }, { id: 'source-area-7' }] } }],
    })
    await page.reload()
    panel = page.locator('[data-nechako-local-workbench]')
    await expect(panel.getByRole('heading', { name: 'Named projects on this device', exact: true })).toBeVisible()
    expect(await records(page)).toEqual(before)
    await panel.getByRole('tab', { name: 'Backups', exact: true }).click()
    // Preserve only the named saved project, so restore does not add an extra current-map project.
    await panel.getByLabel('Include the current map workspace and loaded vector features', { exact: true }).uncheck()
    const downloadEvent = page.waitForEvent('download')
    await panel.getByRole('button', { name: 'Download workbench ZIP', exact: true }).click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toBe('nechako-workbench.zip')
    const bytes = readFileSync((await download.path())!)
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true })
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(manifest.completeness).toMatchObject({ recordCount: 9, originalFileCount: 2, privateRecordCount: 3 })
    expect(manifest.records.map((item: { kind: string }) => item.kind)).toEqual(
      expect.arrayContaining([
        'style-defaults',
        'query',
        'monitoring',
        'submission',
        'attachment',
        'geopaparazzi',
        'schema',
        'project',
      ]),
    )
    expect(manifest.remoteResources).toEqual([
      expect.objectContaining({
        pixelsCached: false,
        type: 'tiles',
        url: 'https://tiles.example.test/{z}/{x}/{y}.png',
      }),
    ])
    expect(manifest.relationships).toContainEqual({
      fromId: 'fixture-attachment',
      toId: 'fixture-draft',
      kind: 'submission',
      role: 'evidence',
      included: true,
    })
    for (const file of manifest.files) {
      const actual = await zip.file(file.path)!.async('nodebuffer')
      expect(actual.length).toBe(file.bytes)
      expect(createHash('sha256').update(actual).digest('hex')).toBe(file.sha256)
    }
    const original = manifest.records.find((item: { id: string }) => item.id === 'fixture-gpap-original')
    expect(await zip.file(original.blobPath)!.async('nodebuffer')).toEqual(originalGpap)
    await panel
      .getByLabel('Local workbench backup ZIP', { exact: true })
      .setInputFiles({ name: 'synthetic-backup.zip', mimeType: 'application/zip', buffer: bytes })
    await expect(panel.getByLabel('Backup restore review')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Restore reviewed backup', exact: true })).toBeDisabled()
    await panel.getByText('Review matching items', { exact: true }).click()
    await expect(panel.getByText(`${fixtureName} · project · fixture-project`, { exact: true })).toBeVisible()
    await panel.getByLabel('Replace matching IDs with the backup versions', { exact: true }).check()
    await expect(panel.getByRole('button', { name: 'Restore reviewed backup', exact: true })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath(`local-workbench-backup-${width}.png`), fullPage: true })
    await panel.getByRole('tab', { name: 'Storage', exact: true }).click()
    await panel.getByLabel('Confirm clear local workbench', { exact: true }).fill('CLEAR')
    await panel.getByRole('button', { name: 'Clear saved workbench items', exact: true }).click()
    await expect(panel.getByText('Cleared the local workbench on this device.', { exact: false })).toBeVisible()
    expect(await records(page)).toEqual([])
    await panel.getByRole('tab', { name: 'Backups', exact: true }).click()
    await panel
      .getByLabel('Local workbench backup ZIP', { exact: true })
      .setInputFiles({ name: 'synthetic-backup.zip', mimeType: 'application/zip', buffer: bytes })
    await expect(panel.getByLabel('Backup restore review')).toBeVisible()
    await expect(panel.getByText(/This backup contains private source copies/)).toBeVisible()
    await panel.getByRole('button', { name: 'Restore reviewed backup', exact: true }).click()
    await expect(
      panel.getByText(
        'Restored 9 local items after verifying every file. Source IDs and original files were retained.',
        { exact: false },
      ),
    ).toBeVisible()
    await page.reload()
    expect(await records(page)).toEqual(before)
    panel = page.locator('[data-nechako-local-workbench]')
    await panel.getByRole('tab', { name: 'Backups', exact: true }).click()
    const firstPath = manifest.records[0].path
    const tampered = JSON.parse(await zip.file(firstPath)!.async('string'))
    zip.file(firstPath, JSON.stringify({ ...tampered, name: 'Tampered synthetic item' }))
    await panel.getByLabel('Local workbench backup ZIP', { exact: true }).setInputFiles({
      name: 'tampered.zip',
      mimeType: 'application/zip',
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
    })
    await expect(panel.getByText(/Checksum verification failed/)).toBeVisible()
    await expect(panel.getByLabel('Backup restore review')).not.toBeVisible()
    expect(await records(page)).toEqual(before)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(observed.writes).toEqual([])
    expect(observed.errors).toEqual([])
    expect(observed.unexpected).toEqual([])
  })

test('GIS and SMASH project ZIPs contain real GeoPackages and a native SQLite GPAP without a backend', async ({
  page,
}, testInfo) => {
  test.setTimeout(180000)
  const observed = await start(page)
  const panel = await openWorkbench(page)
  await panel.getByRole('tab', { name: 'Backups', exact: true }).click()
  await panel.getByLabel('Workbench GIS output format', { exact: true }).selectOption('gpkg')
  const gisEvent = page.waitForEvent('download', { timeout: 120000 })
  await panel.getByRole('button', { name: 'Download GIS project ZIP', exact: true }).click()
  const gisDownload = await gisEvent
  expect(gisDownload.suggestedFilename()).toBe('nechako-gis-project.zip')
  const gisZip = await JSZip.loadAsync(readFileSync((await gisDownload.path())!), { checkCRC32: true })
  const gisManifest = JSON.parse(await gisZip.file('manifest.json')!.async('string'))
  expect(gisManifest.gisExports).toHaveLength(2)
  expect(gisManifest.smash).toBeUndefined()
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({
    wasmBinary: Uint8Array.from(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer,
  })
  const featureCounts: number[] = []
  for (const file of gisManifest.gisExports) {
    expect(file.format).toBe('gpkg')
    const bytes = await gisZip.file(file.path)!.async('uint8array')
    expect(Buffer.from(bytes.subarray(0, 16)).toString()).toBe('SQLite format 3\0')
    const db = new SQL.Database(bytes)
    try {
      expect(db.exec('PRAGMA integrity_check')[0].values).toEqual([['ok']])
      const table = String(db.exec("SELECT table_name FROM gpkg_contents WHERE data_type='features'")[0].values[0][0])
      featureCounts.push(Number(db.exec(`SELECT count(*) FROM "${table.replaceAll('"', '""')}"`)[0].values[0][0]))
    } finally {
      db.close()
    }
    expect(gisZip.file(file.path.replace(/\.gpkg$/, '.sld'))).not.toBeNull()
  }
  expect(featureCounts.sort()).toEqual([1, 2])
  const smashEvent = page.waitForEvent('download', { timeout: 120000 })
  await panel.getByRole('button', { name: 'Download SMASH project ZIP', exact: true }).click()
  const smashDownload = await smashEvent
  expect(smashDownload.suggestedFilename()).toBe('nechako-smash-project.zip')
  const smashBytes = readFileSync((await smashDownload.path())!)
  const smashZip = await JSZip.loadAsync(smashBytes, { checkCRC32: true })
  const manifest = JSON.parse(await smashZip.file('manifest.json')!.async('string'))
  expect(manifest.smash).toMatchObject({
    noteCount: 2,
    featureCount: 3,
    missingElevationCount: 1,
    mapOnlyFeatureCount: 1,
  })
  expect(manifest.smash.idMap[0]).toMatchObject({ featureId: 0, layerId: 'source-stations-0' })
  expect(manifest.gisExports.every((file: { path: string }) => file.path.startsWith('smash/maps/'))).toBe(true)
  const db = new SQL.Database(await smashZip.file(manifest.smash.path)!.async('uint8array'))
  try {
    expect(db.exec('PRAGMA integrity_check')[0].values).toEqual([['ok']])
    expect(db.exec('PRAGMA foreign_key_check')).toEqual([])
    expect(db.exec('SELECT count(*) FROM notes')[0].values).toEqual([[2]])
    expect(db.exec('SELECT count(*) FROM notesext')[0].values).toEqual([[2]])
    expect(db.exec('SELECT count(*) FROM gpslogs')[0].values).toEqual([[0]])
    expect(db.exec('SELECT count(*) FROM images')[0].values).toEqual([[0]])
    const first = db.exec('SELECT lon,lat,altim,form FROM notes ORDER BY _id')[0].values[0]
    expect(first.slice(0, 3)).toEqual([-124.5, 54, 712.25])
    const form = JSON.parse(String(first[3]))
    const properties = form.forms[0].formitems.find(
      (item: { key: string }) => item.key === 'source_properties_json',
    ).value
    expect(JSON.parse(properties)).toMatchObject({ value: 0, enabled: false, observed_at: '2020-01-02' })
  } finally {
    db.close()
  }
  expect(smashZip.file('smash/forms/pgmaps-point-notes.json')).not.toBeNull()
  expect(await smashZip.file('smash/OPEN-IN-SMASH.txt')!.async('string')).toContain('No imagery was downloaded')
  const original = manifest.records.find((item: { id: string }) => item.id === 'fixture-gpap-original')
  expect(await smashZip.file(original.blobPath)!.async('nodebuffer')).toEqual(originalGpap)
  expect(manifest.records.some((item: { kind: string }) => item.kind === 'style-defaults')).toBe(true)
  expect(manifest.records.some((item: { kind: string }) => item.kind === 'query')).toBe(true)
  await expect(panel.getByText(/Downloaded a native .gpap project with 2 point notes and 2 GIS layers/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('local-workbench-native-gis-smash.png'), fullPage: true })
  await panel
    .getByLabel('Local workbench backup ZIP', { exact: true })
    .setInputFiles({ name: 'synthetic-smash-project.zip', mimeType: 'application/zip', buffer: smashBytes })
  await expect(panel.getByLabel('Backup restore review')).toBeVisible()
  expect(observed.writes).toEqual([])
  expect(observed.errors).toEqual([])
  expect(observed.unexpected).toEqual([])
})
