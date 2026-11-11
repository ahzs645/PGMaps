import { openWorkbench } from './road-workbench'
import { expect, test, type Page } from '@playwright/test'
import { createFullCostTrainingProject } from '../../src/pages/dev-forestry-roads/trainingFullCostScenario'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { expandRoadSection, openRoadPanel } from './road-sidebar'
import { choose, optionLabels } from './styled-select'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(240_000)

async function openProject(page: Page, project: RoadProject) {
  const pending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (
    await pending
  ).setFiles({
    name: 'block-access.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect(page.getByLabel('Active road', { exact: true })).toHaveAttribute(
    'data-value',
    project.activeAlignmentId,
    {
      timeout: 60_000,
    },
  )
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled({ timeout: 60_000 })
}

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await openProject(page, createFullCostTrainingProject())
  await page.getByRole('tab', { name: 'Design', exact: true }).click()
  await expandRoadSection(page, 'road-route-tools')
  return errors
}

test('grades by haul direction are set in the search tools and saved with the project', async ({ page }) => {
  const errors = await prepare(page)
  const haul = page.getByTestId('road-haul-grades')
  const direction = haul.getByRole('combobox', { name: 'Loaded haul direction', exact: true })
  await expect(haul.getByLabel('Empty uphill %', { exact: true })).toHaveCount(0)
  await choose(direction, 'end-to-start')
  await haul.getByLabel('Loaded uphill %', { exact: true }).fill('8')
  await haul.getByLabel('Loaded uphill %', { exact: true }).press('Tab')
  await haul.getByLabel('Empty uphill %', { exact: true }).fill('16')
  await haul.getByLabel('Empty uphill %', { exact: true }).press('Tab')

  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const saved = JSON.parse(await (await pending).createReadStream().then((stream) => readAll(stream!))) as RoadProject
  expect(saved.routeSearch?.haulGrades).toEqual({
    loadedDirection: 'end-to-start',
    maxLoadedUphillPercent: 8,
    maxLoadedDownhillPercent: null,
    maxEmptyUphillPercent: 16,
  })
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await choose(direction, 'off')
  await expect(haul.getByLabel('Empty uphill %', { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

async function openAccess(page: Page) {
  await openRoadPanel(page, 'Access from FSR')
  return page.getByTestId('road-access-review')
}

test('a planned block is compared from its nearest FSRs by goal, and the chosen variant becomes a road', async ({
  page,
}, info) => {
  const errors = await prepare(page)
  const panel = await openAccess(page)
  await expect(panel.getByRole('combobox', { name: 'Harvest block', exact: true })).toBeVisible()
  // Two FSRs and two goals keep the run short; every variant is still listed by its start.
  await choose(panel.getByRole('combobox', { name: 'FSRs to try', exact: true }), '2')
  const goals = panel.getByRole('group', { name: 'Access goals', exact: true })
  for (const goal of ['Gentlest', 'Fewest drainage issues'])
    await goals.getByRole('button', { name: goal, exact: true }).click()
  // The snapped junctions show before anything runs.
  await expect(panel).toContainText(/Joins .+ \(\d/)
  await panel.getByRole('button', { name: 'Compare access routes', exact: true }).click()

  const routes = page.getByRole('radiogroup', { name: 'Access routes', exact: true })
  const options = routes.getByRole('radio')
  await expect(options.first()).toBeVisible({ timeout: 180_000 })
  await expect(routes.getByRole('radio', { checked: true })).toHaveCount(1)
  await expect(options.first()).toContainText(/loaded ↑ [\d.—%]+ · empty ↑ [\d.—%]+/)
  // The overall leader of each goal is starred across every start.
  await expect(routes).toContainText('★ Lowest cost')
  await expect(page.getByTestId('workspace-toast-error')).toHaveCount(0)
  // Arrow keys move through the variants.
  const checked = routes.getByRole('radio', { checked: true })
  const first = await checked.getAttribute('data-access-row')
  await checked.focus()
  await page.keyboard.press('ArrowDown')
  if ((await options.count()) > 1) await expect(checked).not.toHaveAttribute('data-access-row', first!)
  await page.screenshot({ path: info.outputPath('access-review.png') })

  const start =
    (await routes
      .getByRole('radio', { checked: true })
      .locator('xpath=..')
      .locator('[title]')
      .first()
      .getAttribute('title')) ?? ''
  const roads = page.getByLabel('Active road', { exact: true })
  const before = (await optionLabels(roads)).length
  await panel.getByRole('button', { name: 'Add as road', exact: true }).click()
  await expect.poll(async () => (await optionLabels(roads)).length).toBe(before + 1)
  await expect(roads).toContainText(start)
  await expect(roads).toContainText('→')
  expect(errors).toEqual([])
})

test('an end picked on the plan shows the junctions it would start from', async ({ page }) => {
  const errors = await prepare(page)
  const panel = await openAccess(page)
  await panel
    .getByRole('group', { name: 'Access end', exact: true })
    .getByRole('button', { name: 'Point on plan' })
    .click()
  await panel.getByRole('button', { name: 'Pick end on plan', exact: true }).click()
  const box = (await page.getByTestId('road-plan-view').locator('canvas').first().boundingBox())!
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6)
  await expect(panel.getByRole('button', { name: 'Move end', exact: true })).toBeVisible()
  await expect(panel).toContainText(/Joins .+ \(\d/)
  // The end and each junction are labelled on the plan.
  await expect(page.getByTestId('road-plan-view').getByText('End', { exact: true })).toBeVisible()
  await expect(page.getByTestId('road-plan-view').getByText(/^Start 1 · /)).toBeVisible()
  expect(errors).toEqual([])
})

test('Draw block adds a harvest block rather than an avoidance area', async ({ page }) => {
  const errors = await prepare(page)
  const panel = await openAccess(page)
  const blocks = panel.getByRole('combobox', { name: 'Harvest block', exact: true })
  const before = (await optionLabels(blocks)).length
  await panel.getByRole('button', { name: 'Draw block', exact: true }).click()
  await expect(page.getByTestId('pegging-feedback')).toContainText('Draw harvest block')
  const box = (await page.getByTestId('road-plan-view').locator('canvas').first().boundingBox())!
  for (const [x, y] of [
    [0.4, 0.4],
    [0.55, 0.4],
    [0.55, 0.55],
  ])
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y)
  await page.getByRole('button', { name: 'Finish block', exact: true }).click()
  await expect.poll(async () => (await optionLabels(blocks)).length).toBe(before + 1)
  // Planned blocks are listed first, so the drawn one sits among them.
  expect((await optionLabels(blocks)).some((label) => /^Harvest block \d+$/.test(label))).toBe(true)
  expect(errors).toEqual([])
})

async function readAll(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}
