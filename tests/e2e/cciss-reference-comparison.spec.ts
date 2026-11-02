import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { csvFormat, csvParse } from 'd3'

const fixtures = 'vendor/bcdatamapper/datascrapers/bc/cciss/fixtures/'
test.setTimeout(90_000)
test.beforeEach(async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://tileserver.thebeczone.ca/**', (route) => route.fulfill({ status: 404, body: '' }))
})
/** The synthetic references assume no novelty filtering; Shiny's default (and the browser's) applies cutoff 5. */
async function withoutNovelty(dialog: Locator) {
  const options = dialog.getByText('Model weights and calculation options', { exact: true })
  await options.click()
  const novelty = dialog.getByLabel('Apply novelty cutoff', { exact: true })
  await expect(novelty).toBeChecked() // Shiny's default, applied because the fixture's novelty data are complete.
  await novelty.uncheck()
  await options.click()
}

async function openReference(page: Page) {
  await page.goto('/dev/forestry/cciss-suitability?lng=0.5&lat=0.5&analysis=current', { waitUntil: 'domcontentloaded' })
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Import current CCISS JSON').setInputFiles(fixtures + 'synthetic-current-analysis.json')
  await withoutNovelty(dialog)
  await dialog.getByRole('tab', { name: 'Compare with Shiny', exact: true }).click()
  return dialog
}
const count = (dialog: Locator, label: string) =>
  dialog
    .locator('dt')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('..')
    .locator('dd')
async function chooseReference(dialog: Locator, site = '990000001') {
  await dialog.getByRole('combobox', { name: 'Shiny reference site', exact: true }).selectOption(site)
  await dialog.getByRole('combobox', { name: 'Shiny reference site series', exact: true }).selectOption('TESTalpha/01')
}

test('independent synthetic reference fields agree, keep provenance unverified, and export exact scoped results', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const dialog = await openReference(page)
  await dialog
    .getByLabel('Import Shiny reference CSV or ZIP')
    .setInputFiles(fixtures + 'synthetic-current-reference.csv')
  await chooseReference(dialog)
  await expect(count(dialog, 'Fields with both values')).toHaveText('70')
  await expect(count(dialog, 'Within tolerance')).toHaveText('70')
  await expect(count(dialog, 'Different')).toHaveText('0')
  await expect(dialog.getByText('Scientific parity verified:', { exact: false })).toContainText('false')
  await expect(
    dialog.getByText('Reference dataset versions and calculation parameters are unverified.', { exact: false }),
  ).toBeVisible()
  const jsonEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download reference comparison JSON', exact: true }).click()
  const result = JSON.parse(await readFile((await (await jsonEvent).path())!, 'utf8'))
  expect(result.comparison.scientificParityVerified).toBe(false)
  expect(result.referenceMetadata.parametersVerified).toBe(false)
  expect(result.comparison.alignment.aliasApplied).toBe(false)
  expect(result.comparison.rows).toHaveLength(70)
  expect(result.comparison.rows.every((row: { difference: number | null }) => row.difference === 0)).toBe(true)
  const csvEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download reference comparison CSV', exact: true }).click()
  expect(await readFile((await (await csvEvent).path())!, 'utf8')).toContain('Original reference SiteRef')
  const htmlEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download printable reference comparison', exact: true }).click()
  expect(await readFile((await (await htmlEvent).path())!, 'utf8')).toContain('Scientific parity verified: false')

  await dialog
    .getByLabel('Import Shiny reference CSV or ZIP')
    .setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2') })
  await expect(dialog.getByRole('alert')).toContainText('previous valid reference remains loaded')
  await expect(count(dialog, 'Within tolerance')).toHaveText('70')
  expect(errors).toEqual([])
})

test('probability tolerance is explicit while category comparisons stay exact', async ({ page }) => {
  const csv = csvParse(await readFile(fixtures + 'synthetic-current-reference.csv', 'utf8'))
  const species = csv.find((row) => row.Spp === 'TESTa')!
  species['1_2041'] = '0.0005'
  species['2_2041'] = '0.4995'
  species.EstabFeas = '2'
  const dialog = await openReference(page)
  await dialog.getByLabel('Import Shiny reference CSV or ZIP').setInputFiles({
    name: 'synthetic-perturbed.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csvFormat(csv, csv.columns)),
  })
  await chooseReference(dialog)
  await expect(count(dialog, 'Different')).toHaveText('3')
  await dialog.getByLabel('Reference row status').selectOption('different')
  const table = dialog.getByRole('table', { name: 'Shiny reference field differences' })
  await expect(table.getByRole('row')).toHaveCount(4)
  await expect(table).toContainText('-0.05 pp')
  await expect(table).toContainText('Moderate → High')
  await dialog.getByLabel('Probability tolerance (percentage points)', { exact: true }).fill('0.1')
  await expect(count(dialog, 'Different')).toHaveText('1')
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table).toContainText('establishment')
})

test('ZIP reference aliases require explicit site confirmation and reset when the browser site changes', async ({
  page,
}) => {
  const csv = csvParse(await readFile(fixtures + 'synthetic-current-reference.csv', 'utf8'))
  csv.forEach((row) => {
    row.SiteRef = 'client-site-label'
  })
  const archive = new JSZip()
  archive.file('exports/cciss_export.csv', csvFormat(csv, csv.columns))
  const dialog = await openReference(page)
  await dialog.getByLabel('Import Shiny reference CSV or ZIP').setInputFiles({
    name: 'synthetic-reference.zip',
    mimeType: 'application/zip',
    buffer: await archive.generateAsync({ type: 'nodebuffer' }),
  })
  await chooseReference(dialog, 'client-site-label')
  await expect(count(dialog, 'Fields with both values')).toHaveText('0')
  const alias = dialog.getByLabel('I confirm that this imported SiteRef represents this browser assessment site', {
    exact: true,
  })
  await alias.check()
  await expect(count(dialog, 'Within tolerance')).toHaveText('70')
  await expect(dialog.getByText('User-asserted site mapping:', { exact: false })).toBeVisible()
  const jsonEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download reference comparison JSON', exact: true }).click()
  const result = JSON.parse(await readFile((await (await jsonEvent).path())!, 'utf8'))
  expect(result.comparison.alignment.aliasApplied).toBe(true)
  expect(
    result.comparison.rows.every((row: { referenceSite: string }) => row.referenceSite === 'client-site-label'),
  ).toBe(true)
  expect(result.comparison.scientificParityVerified).toBe(false)
  await dialog.getByRole('combobox', { name: 'Assessment site', exact: true }).selectOption('990000002')
  await expect(alias).not.toBeChecked()
  await expect(count(dialog, 'Fields with both values')).toHaveText('0')
})
