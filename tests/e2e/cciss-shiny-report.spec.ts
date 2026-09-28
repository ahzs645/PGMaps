import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('real published report, silvics, safe export, and browser summary recalculation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://tileserver.thebeczone.ca/**', (route) => route.fulfill({ status: 404, body: '' }))
  await page.goto('/dev/forestry/cciss-suitability?z=5&render=tiles&analysis=report')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Load published example' }).click()
  await expect(dialog.getByText('Published Williams Lake example · historical periods', { exact: true })).toBeVisible()
  await dialog.getByLabel('Site and site series').selectOption(JSON.stringify(['4812311', 'IDFxm/01']))
  await dialog.getByLabel('Species detail').selectOption('Ac')
  await expect(dialog.getByRole('img', { name: 'Period 2055 vote proportions' })).toBeVisible()
  await expect(dialog.getByText('Low 3.0%', { exact: false }).first()).toBeVisible()
  await dialog.getByLabel('Species detail').selectOption('Pl')
  await page.screenshot({ path: 'tmp/cciss-species-report.png' })
  await dialog.getByRole('tab', { name: 'Silvics', exact: true }).click()
  await expect(dialog.getByText('Tolerance', { exact: true })).toBeVisible()
  await expect(dialog.getByText('No exact reference entry for Pl.')).toHaveCount(0)
  await expect(dialog.getByText('Tree Code', { exact: true })).toHaveCount(4)
  await dialog.getByRole('tab', { name: 'Suitability report', exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download printable HTML report' }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('cciss-species-report.html')
  expect(await readFile((await download.path())!, 'utf8')).toContain('Published Williams Lake example')

  // Synthetic test-only current-export fixture; never presented as a real model run.
  const periods = ['1961', '1991', '2021', '2041', '2061', '2081']
  const header = [
    'SiteRef',
    'SS_NoSpace',
    'Spp',
    'Curr',
    ...periods.flatMap((p) => ['1', '2', '3', 'X'].map((c) => `${c}_${p}`)),
  ]
  const votes = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
    [0.5, 0.5, 0, 0],
    [0, 1, 0, 0],
  ]
  header.push('EstabFeas', 'ccissFeas', 'Improve', 'Decline')
  const csv = header.join(',') + '\n' + ['test', 'TEST/01', 'Pl', 2, ...votes.flat(), 2, 3, 50, 50].join(',')
  await dialog
    .getByLabel('Import Shiny CSV')
    .setInputFiles({ name: 'synthetic-test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const result = dialog.getByRole('table', { name: 'Species summary' }).getByRole('row').nth(1)
  await expect(result.getByRole('cell').nth(2)).toHaveText('Moderate')
  await expect(result.getByRole('cell').nth(3)).toHaveText('Low')
  await expect(result.getByRole('cell').nth(4)).toHaveText('50%')
  await dialog.getByText('Recalculate with period weights', { exact: true }).click()
  await dialog.getByLabel('Establishment 1961').fill('10')
  await dialog.getByLabel('Establishment 1991').fill('0')
  await dialog.getByLabel('Establishment 2021').fill('0')
  await expect(result.getByRole('cell').nth(2)).toHaveText('High')
  await expect(dialog.getByText('Establishment: 2; maturation: 3;', { exact: false })).toBeVisible()
  const reweightedDownload = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download printable HTML report' }).click()
  const html = await readFile((await (await reweightedDownload).path())!, 'utf8')
  expect(html).toContain('Original Shiny establishment')
  expect(html).toContain('<td>High</td>')
  await dialog.getByLabel('Establishment 1961').fill('0')
  await expect(dialog.getByRole('alert')).toContainText('positive total')
  await expect(dialog.getByRole('button', { name: 'Download printable HTML report' })).toBeDisabled()
  await dialog.getByLabel('Establishment 1961').fill('1')
  await dialog
    .getByLabel('Import Shiny CSV')
    .setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2') })
  await expect(dialog.getByRole('alert')).toContainText('Expected a Shiny suitability CSV')
  await expect(result.getByRole('cell').nth(2)).toHaveText('High')
  expect(errors).toEqual([])
})
