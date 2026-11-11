import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { choose } from './styled-select'
import JSZip from 'jszip'
import { fromArrayBuffer } from 'geotiff'
import { runCastor } from '../../src/features/forestry-castor/engine'
import { castorReportBundle } from '../../src/features/forestry-castor/outputs'

test.use({ serviceWorkers: 'allow', screenshot: 'only-on-failure' })
const standalone = process.env.PGMAPS_CASTOR_STANDALONE === '1'
const assetPrefix = standalone ? '/forestryCastor/assets/' : '/assets/'

function watchRuntimeRequests(page: Page) {
  const requests: string[] = []
  page.context().on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url())
  })
  return requests
}

async function openCastor(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  if (standalone) {
    // A policy refusal can leave a partly working application without throwing
    // a page error. Record it outside the document so reloads cannot erase it.
    await page.exposeFunction('__recordCastorPolicyViolation', (message: string) => {
      errors.push(`Content Security Policy: ${message}`)
    })
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        const record = (window as unknown as { __recordCastorPolicyViolation: (message: string) => Promise<void> })
          .__recordCastorPolicyViolation
        void record(`${event.effectiveDirective}: ${event.blockedURI} (${event.disposition})`)
      })
    })
    page.on('console', (message) => {
      if (message.type() === 'error' && /content.security.policy|violates.*directive/i.test(message.text())) {
        errors.push(message.text())
      }
    })
  }
  await page.goto(standalone ? '/forestryCastor/' : '/dev/forestry/castor')
  await expect(page.getByRole('heading', { name: 'Castor forest scenarios', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load synthetic demonstration', exact: true })).toBeEnabled()
  return errors
}

async function runSynthetic(page: Page) {
  await page.getByRole('button', { name: 'Load synthetic demonstration', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Illustrative forest planning landscape', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Run forest scenario', exact: true }).click()
  await expect(page.getByTestId('castor-run-status')).toContainText('Scenario complete', { timeout: 60_000 })
}

async function download(page: Page, button: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  const file = await pending
  return { name: file.suggestedFilename(), bytes: await readFile((await file.path())!) }
}

/** The session file holds inputs and settings only; the run's result is exported as result.json in the bundle. */
async function bundledResult(page: Page) {
  const archive = await download(page, 'Download complete report')
  const zip = await JSZip.loadAsync(archive.bytes)
  return { archive, zip, result: JSON.parse(await zip.file('result.json')!.async('string')) }
}

test('runs the compiled forest worker and exports every report and reproducible input', async ({ page }, info) => {
  const requests = watchRuntimeRequests(page)
  const errors = await openCastor(page)
  const workers: string[] = []
  page.on('worker', (worker) => workers.push(worker.url()))
  await runSynthetic(page)
  const saved = await download(page, 'Save session JSON')
  expect(saved.name).toBe('castor-session.json')
  const session = JSON.parse(saved.bytes.toString())
  expect(session.schema).toBe('pgmaps-castor-session-v1')
  expect(session.project.pixels).toHaveLength(96)
  expect(session.project.provenance.synthetic).toBe(true)
  expect(session.config.periods).toBe(4)
  expect(session).not.toHaveProperty('result')
  expect(workers.some((url) => url.includes('castor.worker'))).toBe(true)
  const calculationWorker = new URL(workers.find((url) => url.includes('castor.worker'))!)
  expect(calculationWorker.origin).toBe(new URL(page.url()).origin)
  if (process.env.PGMAPS_E2E_PRODUCTION === '1') expect(calculationWorker.pathname.startsWith(assetPrefix)).toBe(true)
  if (process.env.PGMAPS_E2E_PRODUCTION === '1')
    expect(workers.some((url) => /\/assets\/castor\.worker-[\w-]+\.js/.test(url))).toBe(true)

  const { archive, zip, result } = await bundledResult(page)
  expect(archive.name).toBe('castor-report-bundle.zip')
  // The archive is built off the main thread, and matches the in-process builder for the same inputs.
  expect(workers.some((url) => url.includes('castorReport.worker'))).toBe(true)
  const direct = await JSZip.loadAsync(
    await (await castorReportBundle(session.project, runCastor(session.project, session.config))).arrayBuffer(),
  )
  const names = (archive: JSZip) => Object.keys(archive.files).filter((name) => !archive.files[name].dir)
  expect(names(zip).sort()).toEqual(names(direct).sort())
  expect(await zip.file('result.json')!.async('string')).toBe(await direct.file('result.json')!.async('string'))
  expect(result.summary.harvestedM3).toBeGreaterThan(0)
  expect(result.summary.harvestedM3).toBeLessThanOrEqual(result.summary.targetM3)
  const pixelTotal = result.harvestPixelList.reduce((sum: number, row: { volumeM3: number }) => sum + row.volumeM3, 0)
  expect(pixelTotal).toBeCloseTo(result.summary.harvestedM3, 7)
  expect(result.snapshots).toHaveLength(5)
  for (const name of ['harvest', 'stock', 'constraints', 'pixels', 'blocks', 'landings', 'salvage', 'uncertainty']) {
    expect(zip.file(`reports/${name}.csv`)).not.toBeNull()
    expect((await zip.file(`reports/${name}.csv`)!.async('string')).trim().length).toBeGreaterThan(0)
  }
  expect(zip.file('report.html')).not.toBeNull()
  expect(zip.file('session.json')).not.toBeNull()
  expect(zip.file('rasters/final-harvestYear.tif')).not.toBeNull()
  expect(zip.file('rasters/final-constrainedYears.tif')).not.toBeNull()
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
  expect(manifest.source.synthetic).toBe(true)
  expect(manifest.snapshotPeriods).toEqual([0, 1, 2, 3, 4])
  await choose(page.getByRole('combobox', { name: 'Report', exact: true }), 'constraints')
  await expect(page.getByRole('table', { name: 'Management constraints', exact: true })).toBeVisible()
  const constraints = await download(page, 'Download table CSV')
  expect(constraints.bytes.toString()).toContain('before-harvest')
  expect(constraints.bytes.toString()).toContain('after-harvest')
  await info.attach('castor-session.json', { body: saved.bytes, contentType: 'application/json' })
  await page.screenshot({ path: info.outputPath('castor-reports-desktop.png'), fullPage: true })
  expect(requests.filter((url) => new URL(url).origin !== new URL(page.url()).origin)).toEqual([])
  expect(errors).toEqual([])
})

test('renders actual spatial features and downloads georeferenced GeoTIFF and GeoJSON', async ({ page }, info) => {
  const errors = await openCastor(page)
  await runSynthetic(page)
  await page.getByRole('tab', { name: 'Maps', exact: true }).click()
  await expect(page.getByTestId('castor-map-rendered')).toContainText('96 pixels drawn in view', { timeout: 30_000 })
  await choose(page.getByRole('combobox', { name: 'Map output', exact: true }), 'constrainedYears')
  const geo = await download(page, 'Download map GeoJSON')
  const collection = JSON.parse(geo.bytes.toString())
  expect(collection.type).toBe('FeatureCollection')
  expect(collection.features).toHaveLength(96)
  expect(collection.features[0].geometry.type).toBe('Polygon')
  expect(
    collection.features.every(
      (feature: { properties: { metric: string } }) => feature.properties.metric === 'constrainedYears',
    ),
  ).toBe(true)
  const raster = await download(page, 'Download GeoTIFF')
  expect(raster.name).toBe('castor-constrainedYears-period-4.tif')
  const arrayBuffer = raster.bytes.buffer.slice(
    raster.bytes.byteOffset,
    raster.bytes.byteOffset + raster.bytes.byteLength,
  )
  const image = await (await fromArrayBuffer(arrayBuffer)).getImage()
  expect(image.getWidth()).toBe(12)
  expect(image.getHeight()).toBe(8)
  expect(image.getGeoKeys().ProjectedCSTypeGeoKey).toBe(3005)
  expect(image.getResolution()).toEqual([100, -100, 0])
  const bands = await image.readRasters()
  expect(bands[0]).toHaveLength(96)
  expect(Array.from(bands[0] as Float64Array).every((value) => value >= 0 && value <= 20)).toBe(true)
  await choose(page.getByRole('combobox', { name: 'Map period', exact: true }), '0')
  const initial = JSON.parse((await download(page, 'Download map GeoJSON')).bytes.toString())
  expect(initial.features.every((feature: { properties: { value: number } }) => feature.properties.value === 0)).toBe(
    true,
  )
  await page.screenshot({ path: info.outputPath('castor-map-desktop.png'), fullPage: true })
  await page.getByText('Overlay a local GeoTIFF', { exact: true }).click()
  await choose(page.getByRole('combobox', { name: 'Raster meaning', exact: true }), 'zone')
  await page.getByRole('textbox', { name: 'Imported zone name', exact: true }).fill('constraint-history')
  await page
    .getByLabel('Import Castor raster overlay', { exact: true })
    .setInputFiles({ name: 'constraint-history.tif', mimeType: 'image/tiff', buffer: raster.bytes })
  await expect(page.getByRole('tab', { name: 'Scenario', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Download complete report', exact: true })).toBeDisabled()
  const restored = JSON.parse((await download(page, 'Save session JSON')).bytes.toString())
  expect(restored).not.toHaveProperty('result')
  for (const pixel of restored.project.pixels)
    expect(pixel.zones['constraint-history']).toBe(String((bands[0] as Float64Array)[pixel.gridIndex]))
  expect(errors).toEqual([])
})

test('invalidates edited results, compares scenarios and recovers local input settings', async ({ page }) => {
  const errors = await openCastor(page)
  await runSynthetic(page)
  await page.getByRole('button', { name: 'Keep this run for comparison', exact: true }).click()
  await page.getByRole('tab', { name: 'Scenario', exact: true }).click()
  await page.getByRole('textbox', { name: 'Scenario name', exact: true }).fill('Reduced harvest target')
  await page.getByRole('spinbutton', { name: 'Target multiplier', exact: true }).fill('0.5')
  await page.getByRole('spinbutton', { name: 'Target multiplier', exact: true }).blur()
  await expect(page.getByRole('button', { name: 'Download complete report', exact: true })).toBeDisabled()
  await expect(page.getByRole('tab', { name: 'Reports', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Run forest scenario', exact: true }).click()
  await expect(page.getByTestId('castor-run-status')).toContainText('Scenario complete')
  const comparison = page.getByRole('table', { name: 'Scenario comparison', exact: true })
  await expect(comparison.getByRole('row')).toHaveCount(3)
  await expect(comparison).toContainText('Illustrative management')
  await expect(comparison).toContainText('Reduced harvest target')
  const saved = await download(page, 'Save session JSON')
  const session = JSON.parse(saved.bytes.toString())
  expect(session.config.targetMultiplier).toBe(0.5)
  await expect(page.getByText('Scenario inputs saved in this browser.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Scenario name', exact: true })).toHaveValue('Reduced harvest target')
  await expect(page.getByRole('spinbutton', { name: 'Target multiplier', exact: true })).toHaveValue('0.5')
  await expect(page.getByRole('button', { name: 'Download complete report', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Load synthetic demonstration', exact: true }).click()
  await page
    .getByLabel('Import Castor scenario files', { exact: true })
    .setInputFiles({ name: 'saved-session.json', mimeType: 'application/json', buffer: saved.bytes })
  await expect(page.getByRole('textbox', { name: 'Scenario name', exact: true })).toHaveValue('Reduced harvest target')
  await expect(page.getByRole('button', { name: 'Download complete report', exact: true })).toBeDisabled()
  expect(errors).toEqual([])
})

test('loads the real same-origin SQLite example and runs it without mocked data or computation', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  const requests = watchRuntimeRequests(page)
  const errors = await openCastor(page)
  const pending = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/data/forestry-castor/simple_castordb.sqlite'),
  )
  await page.getByRole('button', { name: 'Load upstream SQLite example', exact: true }).click()
  const response = await pending
  expect(response.status()).toBe(200)
  expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin)
  const bytes = await response.body()
  const expectedHash = '8d19a48acba51de568d6994b8b41c0d9b6d3533aa6ea8c7a0e3cd95afe23535d'
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedHash)
  expect(new URL(response.url()).searchParams.get('v')).toBe(expectedHash)
  expect(bytes.byteLength).toBe(696320)
  await expect(page.getByRole('button', { name: 'Run forest scenario', exact: true })).toBeEnabled({ timeout: 60_000 })
  await expect(page.getByText('No active harvest-flow targets', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Run forest scenario', exact: true }).click()
  await expect(page.getByTestId('castor-run-status')).toContainText('Scenario complete', { timeout: 60_000 })
  const session = JSON.parse((await download(page, 'Save session JSON')).bytes.toString())
  expect(session.project.pixels).toHaveLength(10000)
  expect(session.project.yieldCurves.length).toBeGreaterThan(0)
  expect(session.project.harvestFlows).toEqual([])
  const { result: firstRun } = await bundledResult(page)
  expect(firstRun.summary.initialStockM3).toBeGreaterThan(0)
  expect(firstRun.harvestReport).toEqual([])
  expect(firstRun.summary.harvestedM3).toBe(0)
  expect(firstRun.growingStockReport.length).toBeGreaterThan(0)
  // The original database contains no demand table. Supply an explicit scenario
  // through the real editor instead of silently assigning a source default.
  await page.getByRole('tab', { name: 'Scenario', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Target per compartment per period m³', exact: true }).fill('220000')
  await page.getByRole('button', { name: /^Apply targets to all \d+ periods$/ }).click()
  await expect(page.getByText('No active harvest-flow targets', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Run forest scenario', exact: true }).click()
  await expect(page.getByTestId('castor-run-status')).toContainText('Scenario complete', { timeout: 60_000 })
  const harvestSession = JSON.parse((await download(page, 'Save session JSON')).bytes.toString())
  expect(harvestSession.project.harvestFlows.length).toBeGreaterThan(0)
  expect(harvestSession.project.harvestFlows.every((flow: { targetM3: number }) => flow.targetM3 === 220000)).toBe(true)
  const { result: harvestRun } = await bundledResult(page)
  expect(harvestRun.harvestReport.length).toBeGreaterThan(0)
  expect(harvestRun.summary.harvestedM3).toBeGreaterThan(0)
  expect(requests.filter((url) => new URL(url).origin !== new URL(page.url()).origin)).toEqual([])
  await info.attach('upstream-production-loading.json', {
    body: JSON.stringify(
      {
        url: response.url(),
        bytes: bytes.byteLength,
        sha256: expectedHash,
        fromServiceWorker: response.fromServiceWorker(),
        pixelCount: session.project.pixels.length,
        growthOnlySummary: firstRun.summary,
        explicitTargetM3PerPeriod: 220000,
        harvestSummary: harvestRun.summary,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  })
  expect(errors).toEqual([])
})

test('supports phone controls and rejects malformed imports without losing the current scenario', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await openCastor(page)
  await runSynthetic(page)
  await page.getByLabel('Import Castor scenario files', { exact: true }).setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schema":"pgmaps-castor-project-v1","pixels":[null]}'),
  })
  await expect(page.getByText('Inputs could not be loaded', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Illustrative forest planning landscape', exact: true })).toBeVisible()
  await expect(page.getByTestId('castor-run-status')).toContainText('Scenario complete')
  await page.getByRole('tab', { name: 'Scenario', exact: true }).click()
  await page.getByRole('button', { name: 'Run yield sensitivity replicates', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Replicates', exact: true }).fill('20')
  await page.getByRole('spinbutton', { name: 'Replicates', exact: true }).blur()
  await page.getByRole('button', { name: 'Run forest scenario', exact: true }).click()
  await expect(page.getByTestId('castor-run-status')).toContainText('Scenario complete')
  await choose(page.getByRole('combobox', { name: 'Report', exact: true }), 'uncertainty')
  await expect(page.getByRole('table', { name: 'Yield sensitivity', exact: true }).getByRole('row')).toHaveCount(9)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  expect(overflow).toBe(false)
  await page.screenshot({ path: info.outputPath('castor-phone.png'), fullPage: true })
  expect(errors).toEqual([])
})
