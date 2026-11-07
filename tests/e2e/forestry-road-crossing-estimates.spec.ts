import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { choose } from './road-select'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

test('entered crossing items and a shared item persist with source evidence and appear once in the subtotal', async ({
  page,
}) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('tab', { name: 'Engineering', exact: true }).click()
  const panel = page.getByTestId('stream-crossings-panel')
  // The folded section states its total; it shows it only while folded.
  await expect(panel).toContainText('Incomplete / unpriced')
  await panel.getByRole('button', { name: /^Stream crossing estimates/ }).click()
  await panel.getByRole('button', { name: 'Record detected crossings', exact: true }).click()
  await choose(panel.getByRole('combobox', { name: 'Planning structure option', exact: true }), 'bridge')
  await panel
    .getByRole('textbox', { name: 'Crossing evidence / review notes', exact: true })
    .fill('Synthetic planning fixture; no engineering approval.')
  const item = panel.getByRole('group', { name: 'Estimate item 1', exact: true })
  await item.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('2')
  await item.getByRole('spinbutton', { name: 'Quantity', exact: true }).press('Tab')
  await item.getByRole('spinbutton', { name: 'Unit rate ($)', exact: true }).fill('21250')
  await item.getByRole('spinbutton', { name: 'Unit rate ($)', exact: true }).press('Tab')
  await item.getByRole('textbox', { name: 'Item 1 price source', exact: true }).fill('Synthetic quote fixture')
  await item.getByLabel('Item 1 price date', { exact: true }).fill('2026-11-07')
  await panel.getByRole('button', { name: /^Shared crossing costs/ }).click()
  await panel.getByRole('button', { name: 'Add shared estimate item', exact: true }).click()
  const shared = panel.getByRole('group', { name: 'Shared item 1', exact: true })
  await shared.getByRole('spinbutton', { name: 'Unit rate ($)', exact: true }).fill('1000')
  await shared.getByRole('spinbutton', { name: 'Unit rate ($)', exact: true }).press('Tab')
  await shared.getByRole('textbox', { name: 'Item 1 price source', exact: true }).fill('Synthetic shared survey quote')
  await shared.getByLabel('Item 1 price date', { exact: true }).fill('2026-11-07')
  await expect(panel).toContainText('Known subtotal $43,500 before contingency')

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const saved = JSON.parse(fs.readFileSync((await (await download).path())!, 'utf8')) as RoadProject
  const road = saved.alignments.find((a) => a.id === saved.activeAlignmentId)!
  expect(road.crossingRecords).toHaveLength(1)
  expect(road.crossingRecords![0]).toMatchObject({
    structure: 'bridge',
    items: [{ quantity: 2, unitRate: 21250, source: 'Synthetic quote fixture', priceDate: '2026-11-07' }],
  })
  expect(saved.sharedCrossingCosts).toHaveLength(1)
  expect(saved.sharedCrossingCosts![0].unitRate).toBe(1000)
  const reportDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Report HTML', exact: true }).click()
  const report = fs.readFileSync((await (await reportDownload).path())!, 'utf8')
  expect(report).toContain('Stream crossing estimates')
  expect(report).toContain('known subtotal $43,500')
  expect(report).toContain('Synthetic shared survey quote')
})
