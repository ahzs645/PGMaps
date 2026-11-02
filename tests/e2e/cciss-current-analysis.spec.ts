import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// Hand-constructed sites/model votes only; this verifies browser behavior, not
// ecological validity or equivalence to the deployed Shiny calculator.
const fixtureRoot = 'vendor/bcdatamapper/datascrapers/bc/cciss/fixtures/'
const wrapperPath = fixtureRoot + 'synthetic-current-analysis.json'
const pilotPath = fixtureRoot + 'synthetic-current-pilot.json'
test.setTimeout(90_000)

test.beforeEach(async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://tileserver.thebeczone.ca/**', (route) => route.fulfill({ status: 404, body: '' }))
})

async function openCurrent(page: Page) {
  await page.goto('/dev/forestry/cciss-suitability?lng=0.5&lat=0.5&z=5&analysis=current')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'CCISS current-data analysis' })).toBeVisible()
  return dialog
}

test('synthetic member import derives options, weights predictions and species, and exports explicit provenance', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const dialog = await openCurrent(page)
  await expect(dialog.getByRole('heading', { name: 'Data needed for a current assessment' })).toBeVisible()
  await dialog.getByLabel('Import current CCISS JSON').setInputFiles(wrapperPath)
  await expect(
    dialog.getByText('Synthetic verification data. These results have no geographic or planning meaning.'),
  ).toBeVisible()
  await expect(dialog.getByLabel('Assessment site')).toHaveValue('990000001')
  await expect(dialog.getByLabel('Current site series')).toHaveValue('TESTalpha/01')
  await expect(dialog.getByLabel('Climate models').getByRole('option')).toHaveText([
    'All available · equal weights',
    'Custom weights',
    'TESTmodel1',
    'TESTmodel2',
  ])
  await expect(dialog.getByLabel('Emissions scenarios').getByRole('option')).toHaveText([
    'All available · equal weights',
    'Custom weights',
    'TESTscenario1',
    'TESTscenario2',
  ])
  const bgc = dialog.getByRole('table', { name: 'Current BGC probabilities' })
  const future = bgc.getByRole('row').filter({ hasText: '2041' })
  await expect(future).toHaveCount(2)
  await expect(future.filter({ hasText: 'TESTbeta' })).toContainText('50.0%')
  await expect(future.filter({ hasText: 'TESTgamma' })).toContainText('50.0%')

  await dialog.getByLabel('Climate models').selectOption('TESTmodel1')
  await expect(future).toHaveCount(1)
  await expect(future).toContainText('TESTbeta')
  await expect(future).toContainText('100.0%')
  await dialog.getByRole('tab', { name: 'Species', exact: true }).click()
  const summary = dialog.getByRole('table', { name: 'Current species suitability summary' })
  const speciesA = summary.getByRole('row').filter({ hasText: 'TESTa' })
  await expect(speciesA.getByRole('cell').nth(2)).toHaveText('High')
  await expect(speciesA.getByRole('cell').nth(3)).toHaveText('Moderate')
  await dialog.getByRole('tab', { name: 'Site-series overlap', exact: true }).click()
  await expect(dialog.getByRole('table', { name: 'Current site-series overlap' })).toContainText('TESTbeta/01')

  await dialog.getByLabel('Climate models').selectOption('__all__')
  await dialog.getByText('Model weights and calculation options', { exact: true }).click()
  const modelWeights = dialog.getByRole('group', { name: 'Model weights', exact: true })
  await modelWeights.getByLabel('TESTmodel1', { exact: true }).fill('3')
  await dialog.getByRole('tab', { name: 'BGC futures', exact: true }).click()
  await expect(future.filter({ hasText: 'TESTbeta' })).toContainText('75.0%')
  await expect(dialog.getByLabel('Climate models')).toHaveValue('__custom__')
  await modelWeights.getByLabel('TESTmodel1', { exact: true }).fill('0')
  await modelWeights.getByLabel('TESTmodel2', { exact: true }).fill('0')
  await expect(dialog.getByRole('alert')).toContainText('positive weight')
  await expect(bgc).toHaveCount(0)
  await dialog.getByLabel('Climate models').selectOption('__all__')
  await dialog.getByLabel('Apply novelty cutoff', { exact: true }).check()
  await dialog.getByRole('tab', { name: 'BGC futures', exact: true }).click()
  await expect(future.filter({ hasText: 'novel' })).toContainText('50.0%')
  await dialog.getByRole('tab', { name: 'Species', exact: true }).click()
  await dialog.getByLabel('Assessment species detail').selectOption('TESTa')
  const votes = dialog.getByRole('table', { name: 'Current species vote proportions' })
  const votes2041 = votes.getByRole('row').filter({ hasText: '2041' })
  await expect(votes2041.getByRole('cell').nth(2)).toHaveText('50.0%')
  await expect(votes2041.getByRole('cell').nth(5)).toHaveText('50.0%')
  await expect(speciesA.getByRole('cell').nth(3)).toHaveText('Moderate')

  await dialog.getByRole('tab', { name: 'Inputs and export', exact: true }).click()
  await expect(dialog.getByText('Version match asserted by supplier', { exact: true })).toBeVisible()
  const jsonDownload = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download assessment JSON', exact: true }).click()
  const result = JSON.parse(await readFile((await (await jsonDownload).path())!, 'utf8'))
  expect(result.provenance.synthetic).toBe(true)
  expect(result.provenance.independentShinyParityVerified).toBe(false)
  expect(result.selection.siteId).toBe(990000001)
  expect(result.selection.noveltyCutoff).toBe(5)
  expect(
    result.calculation.bgcProbabilities.find(
      (row: { period: string; bgc: string }) => row.period === '2041' && row.bgc === 'novel',
    ).probability,
  ).toBe(0.5)
  expect(
    result.calculation.summaries.find((row: { species: string }) => row.species === 'TESTa').summary.maturation,
  ).toBe(2)

  const htmlDownload = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download printable assessment', exact: true }).click()
  const html = await readFile((await (await htmlDownload).path())!, 'utf8')
  expect(html).toContain('Synthetic')
  expect(html).toContain('does not establish agreement with the deployed Shiny application')
  expect(html).toContain('TESTbeta/01')

  await dialog
    .getByLabel('Import current CCISS JSON')
    .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"unsupported"}') })
  await expect(dialog.getByRole('alert')).toContainText('previous dataset remains loaded')
  await expect(dialog.getByLabel('Assessment site')).toHaveValue('990000001')
  await expect(dialog.getByRole('button', { name: 'Download assessment JSON', exact: true })).toBeEnabled()
  expect(errors).toEqual([])
})

test('coordinate coverage uses containment and requires a choice at shared boundaries', async ({ page }) => {
  const fixture = JSON.parse(await readFile(wrapperPath, 'utf8'))
  fixture.pilot.siteGeometry[1].geometry.coordinates = [
    [
      [1, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 0],
    ],
  ]
  const dialog = await openCurrent(page)
  await dialog.getByLabel('Import current CCISS JSON').setInputFiles({
    name: 'synthetic-boundary.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  })
  await expect(dialog.getByLabel('Assessment site')).toHaveValue('990000001')
  await dialog.getByLabel('Pilot longitude').fill('1')
  await dialog.getByLabel('Pilot latitude').fill('0.5')
  await dialog.getByRole('button', { name: 'Find imported site', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('matches sites 990000001, 990000002')
  await expect(dialog.getByLabel('Assessment site')).toHaveValue('')
  await expect(dialog.getByRole('table', { name: 'Current BGC probabilities' })).toHaveCount(0)
  await dialog.getByLabel('Assessment site').selectOption('990000002')
  await expect(dialog.getByRole('table', { name: 'Current BGC probabilities' })).toBeVisible()
  await dialog.getByLabel('Pilot longitude').fill('90')
  await dialog.getByLabel('Pilot latitude').fill('90')
  await dialog.getByRole('button', { name: 'Find imported site', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('No imported site covers this location')
  await expect(dialog.getByLabel('Assessment site')).toHaveValue('')
  await expect(dialog.getByRole('table', { name: 'Current BGC probabilities' })).toHaveCount(0)
})

test('raw synthetic pilots retain explicit missing-data limits and recover from novelty errors', async ({ page }) => {
  const fixture = JSON.parse(await readFile(pilotPath, 'utf8'))
  fixture.dimensions.forEach((dimension: { futureperiod: string }, index: number) => {
    if (dimension.futureperiod === '2021') fixture.future[0].bgc_id[index] = null
  })
  fixture.novelty[0].novelty[2] = null
  const dialog = await openCurrent(page)
  await dialog.getByLabel('Import current CCISS JSON').setInputFiles({
    name: 'synthetic-partial-pilot.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  })
  await expect(
    dialog.getByText('Synthetic verification data. These results have no geographic or planning meaning.'),
  ).toBeVisible()
  await expect(dialog.getByText('No valid selected predictions for period 2021.', { exact: true })).toBeVisible()
  const bgc = dialog.getByRole('table', { name: 'Current BGC probabilities' })
  await expect(bgc.getByRole('row').filter({ hasText: '2021' })).toHaveCount(0)
  await expect(dialog.getByLabel('Current site series')).toBeDisabled()
  await dialog.getByRole('tab', { name: 'Species', exact: true }).click()
  await expect(
    dialog.getByText('Species calculations require compatible, version-matched ecological tables.', { exact: false }),
  ).toBeVisible()
  await dialog.getByText('Model weights and calculation options', { exact: true }).click()
  await dialog.getByLabel('Apply novelty cutoff', { exact: true }).check()
  await expect(dialog.getByRole('alert')).toContainText('missing novelty values')
  await expect(dialog.getByRole('table', { name: 'Current BGC probabilities' })).toHaveCount(0)
  await dialog.getByLabel('Apply novelty cutoff', { exact: true }).uncheck()
  await dialog.getByRole('tab', { name: 'BGC futures', exact: true }).click()
  await expect(dialog.getByRole('table', { name: 'Current BGC probabilities' })).toBeVisible()
})
