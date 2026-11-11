import { expect, test, type Locator } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { ComparisonSnapshot } from '../../src/pages/cciss/comparison'
import { choose } from './styled-select'

test.setTimeout(90_000)
test.beforeEach(async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://tileserver.thebeczone.ca/**', (route) => route.fulfill({ status: 404, body: '' }))
})

function snapshot(id: string, high: number, rating: number): ComparisonSnapshot {
  return {
    schema: 'cciss-comparison-snapshot-v1',
    id,
    label: `Synthetic ${id}`,
    family: 'synthetic-comparison',
    provenance: { source: 'Hand-constructed browser verification', method: 'same-synthetic-method', synthetic: true },
    context: { site: id, model: id },
    periods: { '2021': { label: '2021–2040', startYear: 2021, endYear: 2040, kind: 'projection' } },
    metrics: [
      {
        measure: 'species.vote',
        label: 'High suitability probability',
        entity: 'TESTa',
        dimensions: { class: '1' },
        period: '2021',
        value: high,
        unit: 'probability',
      },
      {
        measure: 'species.establishment',
        label: 'Establishment category',
        entity: 'TESTa',
        dimensions: {},
        period: null,
        periodCoverage: ['2021'],
        value: rating,
        unit: 'class',
        scale: 'cciss-suitability-1-4',
        direction: 'lower-better',
      },
      {
        measure: 'species.vote',
        label: 'Stable probability',
        entity: 'TESTb',
        dimensions: { class: '2' },
        period: '2021',
        value: 0.5,
        unit: 'probability',
      },
    ],
  }
}

/** The synthetic references assume no novelty filtering; Shiny's default (and the browser's) applies cutoff 5. */
async function withoutNovelty(dialog: Locator) {
  const options = dialog.getByText('Model weights and calculation options', { exact: true })
  await options.click()
  const novelty = dialog.getByLabel('Apply novelty cutoff', { exact: true })
  await expect(novelty).toBeChecked() // Shiny's default, applied because the fixture's novelty data are complete.
  await novelty.uncheck()
  await options.click()
}

test('saved-result imports compare probabilities, categories and missing fields with reusable filters and exports', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/dev/forestry/cciss-suitability?analysis=compare', { waitUntil: 'domcontentloaded' })
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'CCISS comparison', exact: true })).toBeVisible()
  const left = snapshot('A', 0.2, 1)
  left.metrics.push({
    measure: 'species.vote',
    label: 'Absent in B',
    entity: 'TESTc',
    dimensions: { class: 'X' },
    period: '2021',
    value: null,
    unit: 'probability',
  })
  const right = snapshot('B', 0.35, 3)
  for (const candidate of [left, right]) {
    await dialog.getByLabel('Import comparison or analysis JSON').setInputFiles({
      name: `${candidate.id}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(candidate)),
    })
    await dialog.getByRole('button', { name: 'Add imported result', exact: true }).click()
  }
  const table = dialog.getByRole('table', { name: 'CCISS aligned comparison' })
  const probability = table.getByRole('row').filter({ hasText: 'High suitability probability' })
  await expect(probability).toContainText('20%')
  await expect(probability).toContainText('35%')
  await expect(probability).toContainText('+15 pp')
  await expect(table.getByRole('row').filter({ hasText: 'Establishment category' })).toContainText('High → Low')
  await expect(table.getByRole('row').filter({ hasText: 'Absent in B' })).toContainText('Missing')
  await expect(
    dialog.getByRole('img', { name: 'Probability comparison bars from zero to one hundred percent' }),
  ).toBeVisible()

  await dialog.getByLabel('Changed or unmatched only').check()
  await expect(table.getByRole('row').filter({ hasText: 'Stable probability' })).toHaveCount(0)
  await choose(dialog.getByLabel('Comparison measure'), 'species.vote')
  await expect(table.getByRole('row').filter({ hasText: 'Establishment category' })).toHaveCount(0)
  await dialog.getByLabel('Search comparison').fill('TESTa')
  await expect(table.getByRole('row')).toHaveCount(2)

  const jsonEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download comparison JSON', exact: true }).click()
  const exported = JSON.parse(await readFile((await (await jsonEvent).path())!, 'utf8'))
  expect(exported.left.context.site).toBe('A')
  expect(exported.right.context.site).toBe('B')
  expect(exported.comparison.rows).toHaveLength(4)
  expect(exported.left.provenance.synthetic).toBe(true)
  const csvEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download comparison CSV', exact: true }).click()
  expect(await readFile((await (await csvEvent).path())!, 'utf8')).toContain('A unit,B unit')
  const htmlEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download printable comparison', exact: true }).click()
  expect(await readFile((await (await htmlEvent).path())!, 'utf8')).toContain(
    'No global agreement with Shiny is asserted',
  )

  await dialog
    .getByLabel('Import comparison or analysis JSON')
    .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"wrong"}') })
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(probability).toContainText('+15 pp')
  expect(errors).toEqual([])
})

test('captures freeze model settings and preserve results after another live analysis change', async ({ page }) => {
  await page.goto('/dev/forestry/cciss-suitability?lng=0.5&lat=0.5&analysis=current', { waitUntil: 'domcontentloaded' })
  let dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Import current CCISS JSON')
    .setInputFiles('vendor/bcdatamapper/datascrapers/bc/cciss/fixtures/synthetic-current-analysis.json')
  await withoutNovelty(dialog)
  await choose(dialog.getByLabel('Climate models'), 'TESTmodel1')
  await dialog.getByLabel('Comparison name').fill('Model one capture')
  await dialog.getByRole('button', { name: 'Save for comparison', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Model one capture')
  await choose(dialog.getByLabel('Climate models'), 'TESTmodel2')
  await dialog.getByLabel('Comparison name').fill('Model two capture')
  await dialog.getByRole('button', { name: 'Save for comparison', exact: true }).click()
  await choose(dialog.getByLabel('Climate models'), '__all__')
  await dialog.getByRole('button', { name: 'View comparisons (2)', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('combobox', { name: 'Comparison A', exact: true })).toContainText('Model one capture')
  await expect(dialog.getByRole('combobox', { name: 'Comparison B', exact: true })).toContainText('Model two capture')
  const downloadEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download comparison JSON', exact: true }).click()
  const exported = JSON.parse(await readFile((await (await downloadEvent).path())!, 'utf8'))
  expect(JSON.stringify(exported.left.context)).toContain('TESTmodel1')
  expect(
    exported.left.metrics.find(
      (metric: { measure: string; entity: string; period: string }) =>
        metric.measure === 'bgc.probability' && metric.entity === 'TESTbeta' && metric.period === '2041',
    ).value,
  ).toBe(1)
  expect(
    exported.right.metrics.find(
      (metric: { measure: string; entity: string; period: string }) =>
        metric.measure === 'bgc.probability' && metric.entity === 'TESTgamma' && metric.period === '2041',
    ).value,
  ).toBe(1)
})

test('incompatible workflow or unit comparisons retain source values without arithmetic', async ({ page }) => {
  await page.goto('/dev/forestry/cciss-suitability?analysis=compare', { waitUntil: 'domcontentloaded' })
  const dialog = page.getByRole('dialog')
  const left = snapshot('probability', 0.5, 1)
  const right = snapshot('class', 0.5, 1)
  right.family = 'different-synthetic-workflow'
  right.metrics[0] = {
    ...right.metrics[0],
    value: 2,
    unit: 'class',
    scale: 'cciss-suitability-1-4',
    direction: 'lower-better',
  }
  for (const candidate of [left, right]) {
    await dialog.getByLabel('Import comparison or analysis JSON').setInputFiles({
      name: `${candidate.id}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(candidate)),
    })
    await dialog.getByRole('button', { name: 'Add imported result', exact: true }).click()
  }
  const row = dialog
    .getByRole('table', { name: 'CCISS aligned comparison' })
    .getByRole('row')
    .filter({ hasText: 'High suitability probability' })
  await expect(row.getByRole('cell').nth(1)).toContainText('50%')
  await expect(row.getByRole('cell').nth(2)).toContainText('Moderate')
  await expect(row.getByRole('cell').nth(3)).toHaveText('Not calculated')
  await expect(
    dialog.getByRole('img', { name: 'Probability comparison bars from zero to one hundred percent' }),
  ).toHaveCount(0)
})
