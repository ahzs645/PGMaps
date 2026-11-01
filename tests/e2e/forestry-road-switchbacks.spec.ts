import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(180_000)

const EXAMPLE = new URL('../../docs/forestry-road-design/examples/switchback-review.json', import.meta.url)

const roads = (page: Page) => page.getByRole('combobox', { name: 'Active road', exact: true }).locator('option')
const activeRoad = (page: Page) => page.getByRole('combobox', { name: 'Active road', exact: true })

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  return errors
}

/** Phone tests drive the controls with touch; desktop tests use the mouse. */
let touch = false
async function press(control: Locator) {
  if (touch) await control.tap()
  else await control.click()
}

async function saveProject(page: Page): Promise<RoadProject> {
  const pending = page.waitForEvent('download')
  await press(page.getByRole('button', { name: 'Save', exact: true }))
  await press(page.getByRole('button', { name: 'Save project JSON', exact: true }))
  const stream = await (await pending).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await press(
    page
      .getByRole('dialog', { name: 'Save & export', exact: true })
      .getByRole('button', { name: 'Close', exact: true }),
  )
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as RoadProject
}

async function chooseLayout(page: Page, name: string) {
  await page
    .getByTestId('road-workspace-header')
    .getByRole('combobox', { name: 'Road view layout', exact: true })
    .click()
  await page.getByRole('option', { name, exact: true }).click()
}

async function openSwitchbackTools(page: Page) {
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await press(show)
  await press(
    page.getByRole('tablist', { name: 'Road workflow', exact: true }).getByRole('tab', { name: 'Design', exact: true }),
  )
  const toggle = page.getByTestId('road-switchback-toggle')
  await toggle.scrollIntoViewIfNeeded()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await press(toggle)
  const tools = page.getByTestId('road-switchback-tools')
  await expect(tools).toBeVisible()
  return tools
}

async function setNumber(tools: Locator, label: string, value: number) {
  const field = tools.getByRole('spinbutton', { name: label, exact: true })
  await field.fill(String(value))
  await field.press('Tab')
}

/** The reference construction in docs/forestry-road-design/switchbacks.md. */
async function stageReference(tools: Locator, direction: 'Left' | 'Right' = 'Left') {
  await tools.getByRole('combobox', { name: 'Switchback turn', exact: true }).selectOption(direction.toLowerCase())
  await setNumber(tools, 'Switchback radius (m)', 40)
  await setNumber(tools, 'Entry straight (m)', 50)
  await setNumber(tools, 'Middle straight (m)', 10)
  await setNumber(tools, 'Exit straight (m)', 80)
  await setNumber(tools, 'Initial grade (%)', 3)
  const preview = tools.getByTestId('road-switchback-preview')
  // A = 50, πR = 125.66, M = 10, E = 80; D = 2R + M.
  await expect(preview).toContainText('Added length265.7 m')
  await expect(preview).toContainText('Opposing centreline spacing90 m')
  return preview
}

test('a switchback alternative is staged, created, reviewed in linked views, saved and undone', async ({ page }) => {
  const errors = await prepare(page)
  await chooseLayout(page, 'Plan · profile · section · data')
  await expect(page.getByTestId('road-connected-layout')).toHaveAttribute('data-layout', 'engineering')
  const initial = await saveProject(page)
  const original = initial.alignments.find((a) => a.id === initial.activeAlignmentId)!
  const tools = await openSwitchbackTools(page)
  // Active road lives in the Design tab, so count the roads once it is showing.
  const roadCount = await roads(page).count()
  expect(roadCount).toBe(initial.alignments.length)
  const preview = await stageReference(tools)
  const endElevation = Number(
    (await preview.locator('dt:has-text("New end formation") + dd').innerText()).replace(/[^0-9.-]/g, ''),
  )
  // Out-of-range input is clamped on commit, and the staged sketch follows it.
  await setNumber(tools, 'Switchback radius (m)', 2)
  await expect(tools.getByRole('spinbutton', { name: 'Switchback radius (m)', exact: true })).toHaveValue('5')
  await expect(preview).toContainText('Opposing centreline spacing20 m')
  await expect(tools).toContainText('Radius is below your')
  await setNumber(tools, 'Switchback radius (m)', 40)
  await expect(preview).toContainText('Added length265.7 m')

  await tools.getByRole('button', { name: 'Create switchback alternative', exact: true }).click()
  await expect(roads(page)).toHaveCount(roadCount + 1)
  await expect(activeRoad(page)).toContainText('left switchback R40')
  await expect(page.getByTestId('road-workspace-header').getByRole('status')).toContainText(
    'Created a left switchback alternative',
  )

  // The saved alternative keeps the original road and only extends a copy.
  const saved = await saveProject(page)
  expect(saved.alignments).toHaveLength(initial.alignments.length + 1)
  expect(saved.alignments.find((a) => a.id === original.id)).toEqual(original)
  const created = saved.alignments.find((a) => a.id === saved.activeAlignmentId)!
  expect(created.id).not.toBe(original.id)
  expect(created.points).toHaveLength(original.points.length + 3)
  expect(created.points.slice(0, original.points.length - 1)).toEqual(original.points.slice(0, -1))
  expect(created.points.slice(-3).map((p) => p.radiusM)).toEqual([40, 40, 0])
  expect(created.fsrConnection).toBeUndefined()
  expect(created.fullCostRecord).toBeUndefined()
  expect(created.vertical.at(-1)!.elevation).toBeCloseTo(endElevation, 1)

  // The data pane's curve review links each event station to plan, profile and section.
  const data = page.getByRole('region', { name: 'Station data · connected selection', exact: true })
  await data
    .getByRole('tablist', { name: 'Road data schedule', exact: true })
    .getByRole('tab', { name: 'Horizontal curves', exact: true })
    .click()
  const table = data.getByTestId('road-horizontal-curve-table')
  const curveRows = table.locator('tbody tr')
  const curveCount = await curveRows.count()
  expect(curveCount).toBeGreaterThanOrEqual(2)
  const lastId = `H${curveCount}`
  // The two added curves turn left through 90° each at the requested radius.
  for (const row of [curveRows.nth(curveCount - 2), curveRows.nth(curveCount - 1)]) {
    await expect(row.locator('td').nth(1)).toHaveText('L · 90°')
    await expect(row.locator('td').nth(2)).toHaveText('40')
  }
  await expect(
    curveRows
      .nth(curveCount - 1)
      .locator('td')
      .nth(5),
  ).toHaveText(/^(1 review flag|\d+ review flags)$/)
  await data.getByRole('button', { name: `Review curve ${lastId}`, exact: true }).click()
  const review = data.getByTestId('road-selected-curve-review')
  await expect(review).toBeVisible()
  await expect(review).toContainText('BC/EC bound the circular curve. No spirals are fitted.')
  await expect(review).toContainText('Inside formation radius')
  await expect(review).toContainText('Vehicle swept path and the complete switchback maneuver remain unchecked.')
  const ec = review.getByRole('button', { name: `${lastId} EC station`, exact: true })
  await ec.click()
  const profile = page.getByTestId('road-profile-chart')
  const station = await profile.getAttribute('data-station')
  expect(Number(station)).toBeGreaterThan(0)
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', station!)
  await expect(page.getByTestId('road-active-map-station')).toHaveAttribute('data-chainage', station!)

  // The CSV carries the calculation basis with the per-curve values.
  const pending = page.waitForEvent('download')
  await data.getByRole('button', { name: 'Curve CSV', exact: true }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('road-curve-review.csv')
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  const csv = Buffer.concat(chunks).toString('utf8').split('\r\n')
  expect(csv[0]).toContain('inner_edge_grade_basis')
  expect(csv).toHaveLength(curveCount + 1)
  expect(csv.at(-1)).toContain(`"${lastId}","left",40,`)

  // The horizontal-curve band lies under the profile with the other engineering bands.
  const bands = page.getByTestId('road-engineering-bands')
  const toggle = bands.getByRole('button', { name: /Grade, curve, template & material bands/ })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(bands.locator('text', { hasText: 'H curve' })).toHaveCount(1)

  // Creation is one normal undoable edit.
  await page.getByRole('button', { name: 'Undo road edit', exact: true }).click()
  await expect(roads(page)).toHaveCount(roadCount)
  expect(await saveProject(page)).toEqual(initial)
  expect(errors).toEqual([])
})

test('the documented switchback example opens with three complete alternatives', async ({ page }) => {
  const errors = await prepare(page)
  const example = readFileSync(EXAMPLE, 'utf8')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByTestId('road-file-input').setInputFiles({
    name: 'switchback-review.json',
    mimeType: 'application/json',
    buffer: Buffer.from(example),
  })
  await expect(roads(page)).toHaveCount(3)
  await expect(activeRoad(page)).toContainText('Left return')
  const summary = page.locator('dl').filter({ hasText: 'Coverage' }).first()
  await expect(summary).toContainText('1,695 m')
  await expect(summary).toContainText('100%')
  await activeRoad(page).selectOption({ label: 'Baseline hillside road · synthetic training' })
  await expect(summary).toContainText('1,429 m')
  await expect(summary).toContainText('100%')
  await activeRoad(page).selectOption({ label: 'Right return · R40 m / +3% assumptions · synthetic' })
  await expect(summary).toContainText('1,695 m')
  await expect(summary).toContainText('100%')
  expect(errors).toEqual([])
})

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test.describe(`touch at ${viewport.width}x${viewport.height}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport })
    test.beforeEach(() => {
      touch = true
    })
    test.afterEach(() => {
      touch = false
    })

    test('switchback tools fit the phone sidebar and create an alternative', async ({ page }, info) => {
      const errors = await prepare(page)
      const tools = await openSwitchbackTools(page)
      const roadCount = await roads(page).count()
      expect(roadCount).toBeGreaterThan(0)
      await stageReference(tools, 'Right')
      const overflow = await tools.evaluate((element) => {
        const host = element.getBoundingClientRect()
        const issues: string[] = []
        if (host.left < -1 || host.right > window.innerWidth + 1) issues.push('tools outside viewport')
        for (const child of element.querySelectorAll('input, select, button, svg, dl')) {
          const r = child.getBoundingClientRect()
          if (r.width && r.height && (r.left < host.left - 1 || r.right > host.right + 1))
            issues.push(`${child.tagName} outside tools`)
        }
        if (document.documentElement.scrollWidth > window.innerWidth + 1) issues.push('document horizontal overflow')
        return issues
      })
      expect(overflow).toEqual([])
      await tools.screenshot({ path: info.outputPath('switchback-tools.png') })
      const create = tools.getByRole('button', { name: 'Create switchback alternative', exact: true })
      await create.scrollIntoViewIfNeeded()
      await press(create)
      // Phones close the controls after creation so the new road is visible on the map.
      await expect(page.getByRole('button', { name: 'Show road controls', exact: true })).toBeVisible()
      await expect(page.locator('dl').filter({ hasText: 'Coverage' }).first()).toContainText('1,695 m')
      await press(page.getByRole('button', { name: 'Show road controls', exact: true }))
      await expect(roads(page)).toHaveCount(roadCount + 1)
      await expect(activeRoad(page)).toContainText('right switchback R40')
      expect(errors).toEqual([])
    })
  })
}
