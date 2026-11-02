import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type Response as PlaywrightResponse } from '@playwright/test'
import {
  PUBLISHED_PERIODS,
  PUBLISHED_SOURCE,
  exportPublishedCsv,
  parsePublishedCsv,
  publishedSeries,
} from '../../src/features/forest-drought/published'

test.use({ serviceWorkers: 'block', screenshot: 'only-on-failure' })

async function publishedFixture(page: Page) {
  const bytes = await readFile('public/data/forest-drought/fordrat.csv')
  const dataset = parsePublishedCsv(bytes.toString('utf8'))
  await page.route(
    (url) => url.pathname === PUBLISHED_SOURCE.csvPath,
    (route) => route.fulfill({ body: bytes, contentType: 'text/csv' }),
  )
  return dataset
}

async function openDrought(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/dev/forestry/drought-risk')
  await expect(page.getByRole('heading', { name: 'Forest drought risk', exact: true })).toBeVisible()
  return errors
}

test('requires explicit soil selection, preserves published results, and downloads every period', async ({
  page,
}, testInfo) => {
  const dataset = await publishedFixture(page)
  const errors = await openDrought(page)
  const bgc = dataset.bgcUnits.find((unit) => unit.startsWith('SBS'))!
  const series = publishedSeries(dataset, bgc, 4)

  await expect(page.getByRole('button', { name: 'Download selected site CSV' })).toBeDisabled()
  await page.getByRole('combobox', { name: 'BGC unit (BEC v11)', exact: true }).selectOption(bgc)
  await expect(page.getByRole('heading', { name: 'Choose a BGC unit and soil regime' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Soil moisture regime', exact: true })).toHaveValue('')
  await page.getByRole('combobox', { name: 'Soil moisture regime', exact: true }).selectOption('4')

  const table = page.getByRole('table', { name: `Published forDRAT drought risks for ${bgc}, soil regime 4` })
  await expect(table).toBeVisible()
  const ratios = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'AET / PET', exact: true }) })
  for (const [index, row] of series.entries()) {
    await expect(ratios.getByRole('cell').nth(index)).toHaveText(String(row.aetPet))
  }
  await page.getByRole('combobox', { name: 'Species comparison' }).selectOption('Pl')
  await expect(table.getByRole('row')).toHaveCount(3)
  await page.getByRole('combobox', { name: 'Focus period' }).selectOption('2080')
  await expect(page.getByRole('heading', { name: `${bgc} · Mesic`, exact: true })).toBeVisible()
  await expect(
    page.getByText(PUBLISHED_PERIODS[5].label, { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download selected site CSV' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`fordrat-${bgc}-smr-4-all-periods.csv`)
  const downloaded = await readFile((await download.path())!, 'utf8')
  expect(downloaded).toBe(exportPublishedCsv(series))
  expect(downloaded.trim().split(/\r?\n/)).toHaveLength(7)
  const nextBgc = dataset.bgcUnits.find((unit) => unit.startsWith('SBS') && unit !== bgc)!
  // Simulate same-document history navigation: the router and page stay mounted.
  await page.evaluate(
    (path) => {
      window.history.pushState({}, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    },
    `/dev/forestry/drought-risk?bgc=${encodeURIComponent(nextBgc)}&smr=2&period=2020`,
  )
  await expect(page.getByRole('combobox', { name: 'BGC unit (BEC v11)', exact: true })).toHaveValue(nextBgc)
  await expect(page.getByRole('combobox', { name: 'Soil moisture regime', exact: true })).toHaveValue('2')
  await expect(page.getByRole('combobox', { name: 'Focus period', exact: true })).toHaveValue('2020')
  await expect(page.getByRole('heading', { name: `${nextBgc} · Subxeric`, exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('published-desktop.png'), fullPage: true })
  await page.evaluate(
    (path) => {
      window.history.pushState({}, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    },
    `/dev/forestry/drought-risk?bgc=${encodeURIComponent(bgc)}&smr=99&period=2070`,
  )
  await expect(page.getByRole('combobox', { name: 'Soil moisture regime', exact: true })).toHaveValue('')
  await expect(page.getByRole('combobox', { name: 'Focus period', exact: true })).toHaveValue('')
  await expect(
    page.getByText('The linked climate period is not one of the six published periods. Choose a period.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download selected site CSV' })).toBeDisabled()
  expect(errors).toEqual([])
})

test('withholds a changed source table and recovers on retry', async ({ page }) => {
  const source = await readFile('public/data/forest-drought/fordrat.csv')
  // StrictMode starts and cancels an initial effect fetch in development.
  // Keep the source invalid until the user retries, independent of fetch count.
  let serveCorruptSource = true
  await page.route(
    (url) => url.pathname === PUBLISHED_SOURCE.csvPath,
    (route) => {
      return route.fulfill({
        body: serveCorruptSource ? Buffer.concat([source, Buffer.from('\n')]) : source,
        contentType: 'text/csv',
      })
    },
  )
  await openDrought(page)
  await expect(page.getByRole('alert')).toContainText('does not match its pinned source checksum')
  await expect(page.getByRole('combobox', { name: 'BGC unit (BEC v11)', exact: true })).toHaveCount(0)
  serveCorruptSource = false
  await page.getByRole('button', { name: 'Retry data load' }).click()
  await expect(page.getByRole('combobox', { name: 'BGC unit (BEC v11)', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('runs the real browser worker, invalidates edited inputs, and recovers from invalid climate', async ({ page }) => {
  await publishedFixture(page)
  const uploads: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.method() !== 'HEAD') uploads.push(request.url())
  })
  const errors = await openDrought(page)
  await page.getByRole('tab', { name: 'Custom calculation' }).click()
  await expect(page.getByRole('button', { name: 'Run calculation' })).toBeDisabled()
  await page.getByRole('button', { name: 'Load synthetic example' }).click()
  await page.getByRole('button', { name: 'Run calculation' }).click()
  await expect(page.getByRole('heading', { name: 'Calculation complete', exact: true })).toBeVisible()

  await page.getByRole('checkbox', { name: 'Compare a climate adjustment' }).check()
  await expect(page.getByRole('heading', { name: 'Calculation complete', exact: true })).toHaveCount(0)
  await expect(page.getByText('Inputs changed. Run the calculation again to refresh the results.')).toBeVisible()
  await page.getByRole('spinbutton', { name: /^Temperature change/ }).fill('3')
  await page.getByRole('button', { name: 'Run calculation' }).click()
  await expect(page.getByRole('heading', { name: 'Calculation complete', exact: true })).toBeVisible()
  const resultTable = page.getByRole('region', { name: 'Custom soil water results table' }).getByRole('table')
  await expect(resultTable.getByRole('row')).toHaveCount(11)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Run record JSON' }).click()
  const download = await downloadPromise
  const record = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(record.schema).toBe('pgmaps-forest-drought-run-v1')
  expect(record.adjustment.temperatureDeltaC).toBe(3)
  expect(record.summaries).toHaveLength(2)
  expect(record.model.sourceCommit).toBe('e02ddcbf8203e65bada1a36655887e1d0c8fe2f5')
  expect(record.inputClimateCsv).toContain('date,tmn,tmx,ppt')

  await page.getByLabel('Climate CSV', { exact: true }).setInputFiles({
    name: 'incomplete.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('date,tmn,tmx,ppt\n2001-01-01,-2,1,4\n'),
  })
  await page.getByRole('button', { name: 'Run calculation' }).click()
  await expect(page.getByRole('alert')).toContainText('Calculation needs attention')
  await expect(page.getByRole('heading', { name: 'Calculation complete', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Load synthetic example' }).click()
  await page.getByRole('button', { name: 'Run calculation' }).click()
  await expect(page.getByRole('heading', { name: 'Calculation complete', exact: true })).toBeVisible()
  expect(uploads).toEqual([])
  expect(errors).toEqual([])
})

test('keeps the phone page within the viewport and tables locally scrollable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const dataset = await publishedFixture(page)
  await openDrought(page)
  await page.getByRole('combobox', { name: 'BGC unit (BEC v11)', exact: true }).selectOption(dataset.bgcUnits[0])
  await page.getByRole('combobox', { name: 'Soil moisture regime', exact: true }).selectOption('1')
  await expect(page.getByRole('heading', { name: 'Species risk across all periods' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const region = page.getByRole('region', {
    name: 'Species and period comparison table; scroll horizontally for all periods',
  })
  expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('published-mobile.png'), fullPage: true })
  await page.getByRole('tab', { name: 'Custom calculation' }).click()
  await page.getByRole('button', { name: 'Load synthetic example' }).click()
  await page.getByRole('button', { name: 'Run calculation' }).click()
  await expect(page.getByRole('heading', { name: 'Calculation complete', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('custom-mobile.png'), fullPage: true })
})

test.describe('production delivery', () => {
  test.use({ serviceWorkers: 'allow' })
  test.skip(
    process.env.PGMAPS_E2E_PRODUCTION !== '1',
    'Requires built dist served by vite preview and PGMAPS_E2E_PRODUCTION=1; development disables the service worker.',
  )
  test.setTimeout(60_000)

  test('serves the real CSV through the service worker and completes the compiled calculation worker', async ({
    page,
  }, testInfo) => {
    // No route interception or local data fixture: these are the app's own
    // requests against the production artifact served by the workflow.
    async function delivery(response: PlaywrightResponse) {
      const bytes = await response.body()
      return {
        url: response.url(),
        status: response.status(),
        contentType: response.headers()['content-type'],
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        fromServiceWorker: response.fromServiceWorker(),
      }
    }

    const firstCsvPromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === PUBLISHED_SOURCE.csvPath,
    )
    const errors = await openDrought(page)
    const origin = new URL(page.url()).origin
    const canonicalCsvUrl = new URL(PUBLISHED_SOURCE.csvPath, origin).href
    const versionedCsvUrl = new URL(canonicalCsvUrl)
    versionedCsvUrl.searchParams.set('v', PUBLISHED_SOURCE.sha256)
    const csvUrl = versionedCsvUrl.href
    const expectedDelivery = {
      url: csvUrl,
      status: 200,
      sha256: PUBLISHED_SOURCE.sha256,
      bytes: PUBLISHED_SOURCE.bytes,
    }
    const firstResponse = await firstCsvPromise
    const firstDelivery = await delivery(firstResponse)
    expect(firstDelivery).toMatchObject(expectedDelivery)
    expect(firstDelivery.contentType).toMatch(/^text\/csv(?:;|$)/i)
    expect(new URL(firstDelivery.url).searchParams.get('v')).toBe(PUBLISHED_SOURCE.sha256)

    const dataset = parsePublishedCsv((await firstResponse.body()).toString('utf8'))
    const bgc = dataset.bgcUnits.find((unit) => unit.startsWith('SBS'))!
    const bgcSelect = page.getByRole('combobox', { name: 'BGC unit (BEC v11)', exact: true })
    await expect(bgcSelect.locator('option')).toHaveCount(PUBLISHED_SOURCE.bgcUnits + 1)
    await bgcSelect.selectOption(bgc)
    await page.getByRole('combobox', { name: 'Soil moisture regime', exact: true }).selectOption('4')
    await expect(page.getByRole('heading', { name: `${bgc} · Mesic`, exact: true })).toBeVisible()

    await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated')
    const serviceWorkerUrl = await page.evaluate(() => navigator.serviceWorker.controller!.scriptURL)
    expect(serviceWorkerUrl).toBe(`${origin}/sw.js`)
    // An older, unversioned cache entry must not shadow this source revision.
    const staleCsv = 'stale unversioned drought CSV acceptance fixture\n'
    await page.evaluate(
      async ({ url, body }) => {
        const cache = await caches.open('pgmaps-data-v1')
        await cache.put(url, new Response(body, { headers: { 'content-type': 'text/csv' } }))
      },
      { url: canonicalCsvUrl, body: staleCsv },
    )
    const reloadedCsvPromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === PUBLISHED_SOURCE.csvPath && response.fromServiceWorker(),
    )
    await page.reload()
    const reloadedDelivery = await delivery(await reloadedCsvPromise)
    expect(reloadedDelivery).toMatchObject({ ...expectedDelivery, fromServiceWorker: true })
    expect(reloadedDelivery.contentType).toMatch(/^text\/csv(?:;|$)/i)
    expect(new URL(reloadedDelivery.url).searchParams.get('v')).toBe(PUBLISHED_SOURCE.sha256)
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(serviceWorkerUrl)
    expect(await page.evaluate(async (url) => Boolean(await caches.match(url)), csvUrl)).toBe(true)
    expect(await page.evaluate(async (url) => (await caches.match(url))?.text(), canonicalCsvUrl)).toBe(staleCsv)
    await expect(bgcSelect.locator('option')).toHaveCount(PUBLISHED_SOURCE.bgcUnits + 1)
    await bgcSelect.selectOption(bgc)
    await page.getByRole('combobox', { name: 'Soil moisture regime', exact: true }).selectOption('4')
    await expect(page.getByRole('heading', { name: `${bgc} · Mesic`, exact: true })).toBeVisible()

    await page.getByRole('tab', { name: 'Custom calculation' }).click()
    await page.getByRole('button', { name: 'Load synthetic example' }).click()
    const workerPromise = page.waitForEvent('worker')
    await page.getByRole('button', { name: 'Run calculation' }).click()
    const workerUrl = new URL((await workerPromise).url())
    expect(workerUrl.origin).toBe(origin)
    expect(workerUrl.pathname).toMatch(/^\/assets\/drought\.worker-[\w-]+\.js$/)
    await expect(page.getByRole('heading', { name: 'Calculation complete', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Custom soil water results table' }).getByRole('row')).toHaveCount(6)
    expect(errors).toEqual([])
    await testInfo.attach('production-delivery.json', {
      body: JSON.stringify(
        {
          firstDelivery,
          reloadedDelivery,
          staleCacheUrl: canonicalCsvUrl,
          serviceWorkerUrl,
          workerUrl: workerUrl.href,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    })
  })
})
