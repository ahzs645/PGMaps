import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name, exact: typeof name === 'string' }).first()

async function openSample(page: Page) {
  await page.goto('/dev/forestry/block-planning?interface=guided')
  await page.getByTestId('block-planning-start').getByRole('button', { name: 'Open the sample' }).click()
  await expect(page.getByTestId('block-planning-trend')).toBeVisible({ timeout: 30_000 })
}

test('the sample compares every schedule over time, in every interface', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  // Three schedules, one line each, in the chart's legend and the comparison table.
  const legend = page.getByTestId('block-planning-trend').getByRole('list', { name: 'Schedules' })
  for (const name of ['No further harvest', 'Proposed', 'Deferred 10 years']) await expect(legend).toContainText(name)
  await page.getByRole('tab', { name: 'Compare' }).click()
  const compare = page.getByTestId('block-planning-compare')
  await expect(compare).toContainText('Deferred 10 years')
  await expect(compare).toContainText('33.3%')

  for (const id of ['ribbon', 'guided-map', 'dashboard']) {
    await page.goto(`/dev/forestry/block-planning?interface=${id}`)
    // The plan is kept in this browser and opens in each interface.
    await expect(page.getByTestId('block-planning-trend')).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(new RegExp(`interface=${id}`))
  }
  await expect(page.getByTestId('block-planning-table')).toContainText('Deferred 10 years · 2036')
})

test('a drawn block is timed per schedule and saved with the plan', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await page.getByRole('tab', { name: 'Blocks' }).click()
  await page.getByTestId('block-planning-steps').getByRole('button', { name: 'Draw', exact: true }).click()
  const canvas = page.getByTestId('block-planning-map').locator('.maplibregl-canvas')
  const box = (await canvas.boundingBox())!
  const corners = [
    [0.15, 0.15],
    [0.3, 0.15],
    [0.3, 0.3],
    [0.15, 0.3],
  ]
  for (const [x, y] of corners) await canvas.click({ position: { x: box.width * x, y: box.height * y } })
  await canvas.click({ position: { x: box.width * corners[0][0], y: box.height * corners[0][1] } })
  await expect(page.getByRole('list', { name: 'Blocks' })).toContainText('Block 2')

  // New blocks start in the schedule under review; the deferred schedule reads them ten years later.
  await page.getByRole('tab', { name: 'Schedules' }).click()
  const timing = page.getByTestId('block-planning-timing')
  await expect(timing.getByLabel('Year Proposed cuts Block 2')).toHaveValue('2026')
  await expect(timing.getByLabel('Year Deferred 10 years cuts Block 2')).toHaveAttribute('placeholder', '2036')
  await timing.getByLabel('Year Proposed cuts Block 2').fill('2031')
  await timing.getByLabel('Year Proposed cuts Block 2').press('Enter')
  await expect(timing.getByLabel('Year Deferred 10 years cuts Block 2')).toHaveAttribute('placeholder', '2041')

  const download = page.waitForEvent('download')
  await button(page, 'Save & export').click()
  const plan = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(plan.format).toBe('pgmaps-block-plan/v2')
  const block = plan.blocks.find((b: { name: string }) => b.name === 'Block 2')
  expect(plan.schedules.find((s: { id: string }) => s.id === 'proposed').entries[block.id]).toEqual({ year: 2031 })
})
