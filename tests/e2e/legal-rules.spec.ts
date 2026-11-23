import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import example from '../../packages/legal-rules/examples/water-monitoring.json' with { type: 'json' }
import inputs from '../../packages/legal-rules/examples/water-facts.json' with { type: 'json' }

const file = (name: string, value: unknown) => ({
  name,
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(value)),
})
async function exportCase(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export reproducible assessment' }).click()
  return JSON.parse(await fs.readFile((await (await pending).path())!, 'utf8'))
}
test('install an unrelated pack, preserve its version and replay the exact case', async ({ page }) => {
  await page.goto('/dev/legal-rules')
  await page.getByLabel('Install JSON packs').setInputFiles(file('water.json', example))
  await expect(page.getByText('Installed example.water@1.0.0', { exact: true })).toBeVisible()
  await page.getByLabel('Open facts or assessment').setInputFiles(file('sample.json', inputs))
  await expect(page.getByText('Follow-up sample · Review required', { exact: true })).toBeVisible()
  const record = await exportCase(page)
  expect(record.releases).toHaveLength(3)
  const water = record.releases.find((r: { pack: { id: string } }) => r.pack.id === 'example.water')
  expect(water.findings[0].condition.trace[0][0]).toMatchObject({ actual: 15, expected: 12, result: true })
  await page.reload()
  await expect(page.getByRole('checkbox', { name: /Water monitoring/ })).toBeVisible()
  await page
    .getByLabel('Install JSON packs')
    .setInputFiles(file('changed.json', { ...example, title: 'Conflicting pack' }))
  await expect(page.getByRole('status').filter({ hasText: 'already exists with different contents' })).toBeVisible()
  water.findings[0].status = 'tampered'
  await page.getByLabel('Open facts or assessment').setInputFiles(file('restore.json', record))
  await expect(page.getByText('Follow-up sample · Review required', { exact: true })).toBeVisible()
  const restored = await exportCase(page)
  expect(
    restored.releases.find((r: { pack: { id: string } }) => r.pack.id === 'example.water').findings[0].status,
  ).toBe('review_required')
})
test('a missing measurement clears an earlier result without creating a D.5 determination', async ({ page }) => {
  await page.goto('/dev/legal-rules')
  const facts = {
    format: 'pgmaps-legal-facts/v1',
    pack: 'bc.pgtsa.biodiversity',
    version: '1.1.0',
    source: 'Case review',
    facts: [
      { id: 'applicable', value: true },
      { id: 'patch-class-away', value: true },
    ],
  }
  await page.getByLabel('Open facts or assessment').setInputFiles(file('facts.json', facts))
  await expect(page.getByText('Young-forest distribution · Review required', { exact: true })).toBeVisible()
  await page.getByLabel('Open facts or assessment').setInputFiles(
    file('patch.json', {
      legalFacts: { ...facts, source: 'First period', facts: [{ id: 'patch-class-away', value: null }] },
    }),
  )
  await expect(page.getByText('Young-forest distribution · Missing evidence', { exact: true })).toBeVisible()
  await expect(page.getByText('Young-forest patch rationale · Missing evidence', { exact: true })).toBeVisible()
})

test('a conflicting release rolls back the entire installation batch', async ({ page }) => {
  await page.goto('/dev/legal-rules')
  const upload = page.getByLabel('Install JSON packs')
  await upload.setInputFiles(file('water.json', example))
  await expect(page.getByText('Installed example.water@1.0.0', { exact: true })).toBeVisible()
  await upload.setInputFiles([
    file('new.json', { ...example, id: 'example.new', title: 'Other instrument' }),
    file('changed.json', { ...example, title: 'Conflicting release' }),
  ])
  await expect(page.getByRole('status').filter({ hasText: 'different contents' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: /Water monitoring/ })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Other instrument/ })).toHaveCount(0)
})
