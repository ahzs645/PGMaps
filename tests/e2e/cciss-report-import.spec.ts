import { expect, test, type Locator, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { csvParse } from 'd3'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

test.beforeEach(async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://tileserver.thebeczone.ca/**', (route) => route.fulfill({ status: 404, body: '' }))
})

async function archive(files: Record<string, string>) {
  const zip = new JSZip()
  for (const [name, csv] of Object.entries(files)) zip.file(name, csv)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

async function downloadText(page: Page, dialog: Locator, button: string) {
  const promise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: button, exact: true }).click()
  return readFile((await (await promise).path())!, 'utf8')
}

// Independent test vectors, never exposed in the app as authentic model data.
function syntheticCurrentReport() {
  const periods = ['1961', '1991', '2021', '2041', '2061', '2081']
  const header = [
    'SiteRef',
    'SS_NoSpace',
    'Spp',
    'Curr',
    ...periods.flatMap((period) => ['1', '2', '3', 'X'].map((c) => `${c}_${period}`)),
    'EstabFeas',
    'ccissFeas',
    'Improve',
    'Decline',
  ]
  const votes = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
    [0.5, 0.5, 0, 0],
    [0, 1, 0, 0],
  ]
  return [
    header.join(','),
    ['first', 'TEST/01', 'Pl', 2, ...votes.flat(), 2, 3, 50, 50].join(','),
    ['second', 'TEST/02', 'Fd', 2, ...votes.flat(), 2, 3, 50, 50].join(','),
  ].join('\n')
}

test('imports the authentic published CSV inside a Shiny ZIP and exports unmodified historical periods', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const real = gunzipSync(
    await readFile('vendor/bcdatamapper/datascrapers/bc/cciss/output/report-examples/williams-lake-raw.csv.gz'),
  ).toString()
  await page.goto('/dev/forestry/cciss-suitability?render=tiles&analysis=report')
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Import Shiny CSV').setInputFiles({
    name: 'published-results.zip',
    mimeType: 'application/zip',
    buffer: await archive({
      'report/cciss_export.csv': real,
      'report/parameters.csv': 'parameter,value\nsource,published',
    }),
  })
  await expect(dialog.getByLabel('Archived result CSV')).toHaveValue('report/cciss_export.csv')
  await dialog.getByLabel('Site and site series').selectOption(JSON.stringify(['4812311', 'IDFxm/01']))
  await dialog.getByLabel('Species detail').selectOption('Ac')
  await expect(dialog.getByRole('img', { name: 'Period 2055 vote proportions' })).toBeVisible()
  await expect(dialog.getByText('No source-backed summary policy matches', { exact: false })).toBeVisible()
  await expect(dialog.getByText('Recalculate with period weights', { exact: true })).toHaveCount(0)
  const json = JSON.parse(await downloadText(page, dialog, 'Download analysis JSON'))
  expect(json.source).toBe('published-results.zip / report/cciss_export.csv')
  expect(json.report.periods).toEqual(['1975', '2000', '2025', '2055', '2085'])
  expect(json.policy).toBeNull()
  expect(json.results.every((result: { summary: unknown }) => result.summary === null)).toBe(true)
  expect(json.report.input.rows.length).toBeGreaterThan(json.report.rows.length)
  const csv = csvParse(await downloadText(page, dialog, 'Download analysis CSV'))
  expect(csv.columns).toContain('1_2055')
  expect(csv.columns).not.toContain('1_2061')
  expect(csv.length).toBe(json.report.rows.length)
  expect(csv.find((r) => r.SiteRef === '4812311' && r.Spp === 'Ac' && r.SS_NoSpace === 'IDFxm/01')?.['3_2055']).toBe(
    '0.03',
  )
  expect(errors).toEqual([])
})

test('chooses ambiguous ZIP results explicitly, retains the last valid report, and exports all sites with originals', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/dev/forestry/cciss-suitability?render=tiles&analysis=report')
  const dialog = page.getByRole('dialog')
  const csv = syntheticCurrentReport()
  const upload = dialog.getByLabel('Import Shiny CSV')
  await upload.setInputFiles({ name: 'original.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(dialog.getByText('original.csv', { exact: true })).toBeVisible()
  await upload.setInputFiles({
    name: 'multiple-results.zip',
    mimeType: 'application/zip',
    buffer: await archive({
      'one/cciss_export.csv': csv,
      'two/cciss_export.csv': csv.replace('first,', 'third,'),
      'parameters.csv': 'parameter,value\nssp,ssp245',
    }),
  })
  const entry = dialog.getByLabel('Archived result CSV')
  await expect(entry).toHaveValue('')
  await expect(dialog.getByText('original.csv', { exact: true })).toBeVisible()
  await entry.selectOption('one/cciss_export.csv')
  await expect(dialog.getByText('multiple-results.zip / one/cciss_export.csv', { exact: true })).toBeVisible()
  const result = dialog.getByRole('table', { name: 'Species summary' }).getByRole('row').nth(1)
  await expect(result.getByRole('cell').nth(2)).toHaveText('Moderate')
  await dialog.getByText('Recalculate with period weights', { exact: true }).click()
  await dialog.getByLabel('Establishment 1961').fill('10')
  await dialog.getByLabel('Establishment 1991').fill('0')
  await dialog.getByLabel('Establishment 2021').fill('0')
  await expect(result.getByRole('cell').nth(2)).toHaveText('High')
  const json = JSON.parse(await downloadText(page, dialog, 'Download analysis JSON'))
  expect(json.results.map((r: { site: string }) => r.site)).toEqual(['first', 'second'])
  expect(json.results[0].summary.establishment).toBe(1)
  expect(json.report.rows[0].original.EstabFeas).toBe('2')
  expect(json.normalizedWeights.establishment).toEqual([1, 0, 0])
  expect(json.policy.establishmentWeights).toEqual([10, 0, 0])
  const exported = csvParse(await downloadText(page, dialog, 'Download analysis CSV'))
  expect(exported.map((r) => r.SiteRef)).toEqual(['first', 'second'])
  expect(exported[0]).toMatchObject({
    Browser_EstabFeas: '1',
    Original_EstabFeas: '2',
    Source: 'multiple-results.zip / one/cciss_export.csv',
  })
  await entry.selectOption('parameters.csv')
  await expect(dialog.getByRole('alert')).toContainText('Expected a Shiny suitability CSV')
  await expect(result.getByRole('cell').nth(2)).toHaveText('High')
  await expect(dialog.getByText('multiple-results.zip / one/cciss_export.csv', { exact: true })).toBeVisible()
  await upload.setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('broken zip') })
  await expect(dialog.getByRole('alert')).toContainText('corrupt')
  await expect(result.getByRole('cell').nth(2)).toHaveText('High')
  await dialog.getByLabel('Site and site series').selectOption(JSON.stringify(['second', 'TEST/02']))
  await expect(dialog.getByRole('table', { name: 'Species summary' })).toContainText('Fd')
  expect(errors).toEqual([])
})
