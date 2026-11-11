import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { choose } from './styled-select'

test.beforeEach(async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://tileserver.thebeczone.ca/**', (route) => route.fulfill({ status: 404, body: '' }))
})

test('checks authentic published classes, excludes incomplete rows, and saves source results for comparison', async ({
  page,
}) => {
  await page.goto('/dev/forestry/cciss-suitability?analysis=report&render=tiles')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Load published example' }).click()
  await expect(dialog.getByLabel('Site and site series')).toBeVisible()
  await dialog.getByRole('tab', { name: 'Reference checks', exact: true }).click()
  const counts = dialog.getByLabel('Published comparison counts')
  await expect(counts).toContainText('Compared1580')
  await expect(counts).toContainText('Matching classes1580')
  await expect(counts).toContainText('Different classes0')
  await expect(counts).toContainText('Excluded rows299')
  await choose(dialog.getByLabel('Published check rows'), 'difference')
  await expect(dialog.getByText('No rows match this filter.')).toBeVisible()
  await choose(dialog.getByLabel('Published check rows'), 'skipped')
  const table = dialog.getByRole('table', { name: 'Published period-class comparisons' })
  await expect(table).toContainText('rounded or incomplete')
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download published check JSON' }).click()
  const result = JSON.parse(await readFile((await (await downloaded).path())!, 'utf8'))
  expect(result.counts).toEqual({ total: 1879, compared: 1580, matched: 1580, different: 0, skipped: 299 })
  expect(result.scientificParityVerified).toBe(false)
  expect([...new Set(result.rows.map((row: { period: string }) => row.period))].sort()).toEqual([
    '1975',
    '2000',
    '2025',
    '2055',
    '2085',
  ])
  await dialog.getByRole('tab', { name: 'Suitability report', exact: true }).click()
  await dialog.getByLabel('Comparison name').fill('Published Williams Lake source')
  await dialog.getByRole('button', { name: 'Save original Shiny for comparison' }).click()
  await expect(dialog.getByRole('status')).toContainText('Saved for comparison')
  await expect(dialog.getByRole('button', { name: 'Save browser summary for comparison' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'View comparisons (1)' }).click()
  await expect(page).toHaveURL(/analysis=compare/)
  await expect(page.getByRole('dialog', { name: 'CCISS comparison' })).toContainText('Published Williams Lake source')
})
