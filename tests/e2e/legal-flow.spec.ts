import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { choose } from './styled-select'
import example from '../../packages/legal-rules/examples/water-monitoring.json' with { type: 'json' }
import facts from '../../packages/legal-rules/examples/water-facts.json' with { type: 'json' }

test('a JSON pack drives the shared findings graph and its Mermaid evidence export', async ({ page }) => {
  await page.goto('/dev/legal-rules')
  const upload = (name: string, value: unknown) => ({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  })
  await page.getByLabel('Install JSON packs').setInputFiles(upload('water.json', example))
  await page.getByLabel('Open facts or assessment').setInputFiles(upload('facts.json', facts))
  const finding = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: 'Follow-up sample · Review required' }) })
    .last()
  await finding.locator('summary').first().click()
  await finding.getByRole('button', { name: 'Show rule flowchart' }).click()
  await finding.locator('[data-node=when]').click()
  await expect(finding.getByText(/measured minus threshold \+3/)).toBeVisible()
  const next = page.waitForEvent('download')
  await finding.getByRole('button', { name: 'Export Mermaid flowchart' }).click()
  const text = await readFile((await (await next).path())!, 'utf8')
  expect(text).toContain('flowchart TD')
  expect(text).toContain('review -.-> actions')
})

test('the block planner asks only what a block needs and shows the same graph', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dev/forestry/block-planning?interface=guided')
  await page.getByTestId('block-planning-start').getByRole('button', { name: 'Open the sample' }).click()
  await page.getByRole('tab', { name: 'Review' }).click()
  const review = page.getByTestId('block-planning-block-review')
  const answer = (name: RegExp) => review.getByRole('combobox', { name })
  // Only the questions a rule waits on: the net area is asked once a 60 ha rule is known to apply.
  await expect(review.getByLabel(/Verified net area to be reforested/)).toHaveCount(0)
  await choose(answer(/FPPR regime applies/), 'Yes')
  await choose(answer(/^Agreement holder harvesting timber$/), 'Yes')
  await choose(answer(/^Minor tenure$/), 'No')
  await choose(answer(/^Administrative forest region$/), 'Omineca')
  await choose(answer(/^§64\(1\) \/ §65\(2\) default applies here/), 'Yes')
  const nar = review.getByLabel(/Verified net area to be reforested/)
  await nar.fill('63')
  await nar.press('Enter')
  const row = review.getByRole('button', { name: /Cutblock size · 60 ha regions/ }).first()
  await expect(row).toContainText('Needs review')
  await row.click()
  const finding = row.locator('xpath=ancestor::*[.//button[normalize-space()="Show rule flowchart"]][1]')
  await expect(finding).toContainText('more than 60 ha')
  await finding.getByRole('button', { name: 'Show rule flowchart' }).click()
  await expect(finding.locator('[data-node=review]')).toHaveAttribute('aria-label', /active/)
})
