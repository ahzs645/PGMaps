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
