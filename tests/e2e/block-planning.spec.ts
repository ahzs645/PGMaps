import pack from '../../packages/legal-rules/examples/mapped-zone-review.json' with { type: 'json' }
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { choose } from './styled-select'

test('a planned block, its evidence and the map survive changing workspace interfaces', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1500, height: 950 })
  await page.goto('/dev/forestry/block-planning?interface=guided')
  const button = (name: string) => page.getByRole('button', { name, exact: true }).first()
  await expect(page.getByRole('heading', { name: 'Plan blocks' })).toBeVisible()
  await expect(page.getByText(/Patch distribution ·/)).toHaveCount(0)
  await button('Landscape').click()
  await button('Load Prince George sample').click()
  await button('Blocks').click()
  await page.getByLabel('New block name').fill('Test cutblock')
  await button('Draw block').click()
  const canvas = page.locator('.maplibregl-canvas').first()
  for (const [x, y] of [
    [110, 110],
    [210, 110],
    [210, 200],
    [110, 200],
  ])
    await canvas.click({ position: { x, y } })
  await button('Finish block').click()
  const selected = page.getByRole('combobox', { name: 'Selected block' })
  await expect(selected).toHaveAttribute('data-value', 'Test cutblock')
  await button('Legal review').click()
  const nar = page.getByLabel('Verified net area to be reforested (ha)', { exact: true })
  await nar.fill('61')
  await choose(selected, 'Opening A')
  await expect(nar).toHaveValue('')
  await choose(selected, 'Test cutblock')
  await expect(nar).toHaveValue('61')
  await button('Switch interface').click()
  await button('Open Ribbon').click()
  await expect(page).toHaveURL(/interface=ribbon/)
  await expect(selected).toHaveAttribute('data-value', 'Test cutblock')
  const pending = page.waitForEvent('download')
  await button('Quick access: Save plan').click()
  const file = (await (await pending).path())!
  const plan = JSON.parse(await readFile(file, 'utf8'))
  expect(plan.project.features.some((f: { properties: { id: string } }) => f.properties.id === 'Test cutblock')).toBe(
    true,
  )
  await page.reload()
  await choose(selected, 'Test cutblock')
  await button('Quick access: Switch interface').click()
  await button('Open Guided mode').click()
  await button('Legal review').click()
  await expect(nar).toHaveValue('61')
  await page.getByLabel('Open planning project').setInputFiles(file)
  await choose(selected, 'Test cutblock')
  await expect(nar).toHaveValue('61')
})

test('an imported policy consumes overlap measurements on a plan outside the regional model', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1450, height: 950 })
  const features = [
    {
      type: 'Feature',
      properties: { id: 'Survey A' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-123.0, 53.9],
            [-122.99, 53.9],
            [-122.99, 53.91],
            [-123.0, 53.91],
            [-123.0, 53.9],
          ],
        ],
      },
    },
  ]
  const file = (name: string, value: unknown) => ({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  })
  await page.goto('/dev/forestry/block-planning')
  await page
    .getByLabel('Add disturbance GeoJSON')
    .setInputFiles(file('cutblocks.geojson', { type: 'FeatureCollection', features }))
  await expect(page.getByRole('combobox', { name: 'Selected block' })).toHaveAttribute('data-value', 'Survey A')
  const review = page.getByRole('button', { name: 'Legal review', exact: true }).first()
  await review.click()
  await page.getByLabel('Install JSON packs').setInputFiles(file('zone-pack.json', pack))
  await expect(page.getByText('Mapped zone intersection · Missing evidence', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Blocks', exact: true }).first().click()
  await page
    .getByLabel('Import mapped riparian zones')
    .setInputFiles(file('survey.geojson', { type: 'FeatureCollection', features }))
  await review.click()
  await expect(page.getByText('Mapped zone intersection · Review required', { exact: true })).toBeVisible()
  await expect(page.getByText(/Patch distribution ·/)).toHaveCount(0)
})

test('a field date sensitivity run exports the calculation alongside independent D.5 findings', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1500, height: 950 })
  await page.goto('/dev/forestry/block-planning?interface=guided')
  const button = (name: string) => page.getByRole('button', { name, exact: true }).first()
  await button('Landscape').click()
  await button('Load Prince George sample').click()
  await expect(page.getByRole('combobox', { name: 'Historic forest district' })).toHaveAttribute(
    'data-value',
    'Prince George',
  )
  await choose(page.getByRole('combobox', { name: 'Map year' }), '2031')
  await expect(page.getByTitle('Copy equation to clipboard')).toBeVisible()
  await expect(page.locator('code').filter({ hasText: '× 100' })).toBeVisible()
  await choose(page.getByRole('combobox', { name: 'Footprint to check' }), 'Opening A')
  await page.getByLabel('Earliest disturbance year').fill('2010')
  await page.getByLabel('Latest disturbance year').fill('2011')
  await page.getByLabel('Measurement source or assumption').fill('Training crew observation')
  await button('Compare disturbance years').click()
  await expect(page.getByText('Tested disturbance years and their effect', { exact: false })).toBeVisible()
  await page
    .getByRole('button', { name: /Prioritize field measurements/ })
    .first()
    .click()
  await page.getByLabel('Test disturbance dates within ± years').fill('1')
  await button('Compare footprint dates').click()
  await expect(page.getByRole('columnheader', { name: 'Largest change in movement (points)' })).toBeVisible()
  await button('Legal review').click()
  await page.getByLabel('Rationale draft').fill('District evidence under review.')
  await choose(page.getByRole('combobox', { name: /^Reviewer verified the order applies/ }), 'Yes')
  await expect(page.getByText('Young-forest patch rationale · Missing evidence', { exact: true })).toBeVisible()
  await choose(page.getByRole('combobox', { name: /^Reviewer determined the young-forest patch/ }), 'Yes')
  await expect(page.getByText('Young-forest patch rationale · Review required', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await button('Export reproducible assessment').click()
  const report = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  const evidence = report.planEvidence.calculationEvidence
  expect(evidence.testedDisturbanceDates).toMatchObject({
    id: 'Opening A',
    earliest: 2010,
    latest: 2011,
    source: 'Training crew observation',
  })
  expect(
    evidence.fieldPriorities.rows.map((r: { id: string; minFlipYears: number | null }) => [r.id, r.minFlipYears]),
  ).toEqual([
    ['Opening A', 1],
    ['Harvest now', 1],
    ['Opening B', null],
  ])
  expect(evidence.patchContributions.classes).toHaveLength(4)
  const regional = report.releases.find((r: { pack: { id: string } }) => r.pack.id === 'bc.pgtsa.biodiversity')
  expect(regional.findings.find((f: { rule: string }) => f.rule === 'recruitment').status).toBe('missing_evidence')
  expect(
    regional.findings
      .find((f: { rule: string }) => f.rule === 'rationale')
      .actions.map((a: { kind: string }) => a.kind),
  ).toEqual(['submit'])
})
