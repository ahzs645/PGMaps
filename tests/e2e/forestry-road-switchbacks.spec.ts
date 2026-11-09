import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { choose, optionLabels } from './road-select'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(180_000)

const EXAMPLE = new URL('../../docs/forestry-road-design/examples/switchback-review.json', import.meta.url)

const roads = (page: Page) => page.getByRole('combobox', { name: 'Active road', exact: true })
const countRoads = async (page: Page) => (await optionLabels(roads(page))).length
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
  await choose(page
    .getByTestId('road-workspace-header')
    .getByRole('combobox', { name: 'Road view layout', exact: true }), { label: name })
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
  await choose(tools.getByRole('combobox', { name: 'Switchback turn', exact: true }), direction.toLowerCase())
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
  const roadCount = await countRoads(page)
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
  await expect.poll(() => countRoads(page)).toBe(roadCount + 1)
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
  // The method opens from its info button rather than sitting open under the review.
  await review.getByRole('button', { name: 'How this is calculated', exact: true }).click()
  await expect(page.getByRole('tooltip')).toContainText('BC/EC bound the circular curve. No spirals are fitted.')
  await page.keyboard.press('Escape')
  await expect(review).toContainText('Inside formation radius')
  await expect(review).toContainText('Vehicle swept path not checked.')
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
  const toggle = page.getByRole('button', { name: 'Grade, curve, template & material bands', exact: true })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await expect(bands.locator('text', { hasText: 'H curve' })).toHaveCount(1)

  // Creation is one normal undoable edit.
  await page.getByRole('button', { name: 'Undo road edit', exact: true }).click()
  await expect.poll(() => countRoads(page)).toBe(roadCount)
  expect(await saveProject(page)).toEqual(initial)
  expect(errors).toEqual([])
})

async function openExample(page: Page) {
  await press(page.getByRole('button', { name: 'Open', exact: true }))
  await page.getByTestId('road-file-input').setInputFiles({
    name: 'switchback-review.json',
    mimeType: 'application/json',
    buffer: readFileSync(EXAMPLE),
  })
  await expect(page.locator('dl').filter({ hasText: 'Coverage' }).first()).toContainText('1,695 m')
}

test('a design vehicle swept path checks the switchback as one turn, frames it, and saves', async ({ page }) => {
  const errors = await prepare(page)
  await openExample(page)
  await chooseLayout(page, 'Plan · profile · section · data')
  const data = page.getByRole('region', { name: 'Station data · connected selection', exact: true })
  await data.getByRole('tab', { name: 'Swept path', exact: true }).click()
  await data.getByRole('button', { name: 'Check a design vehicle', exact: true }).click()
  // Example loaded log truck + pole trailer, both directions, 0.3 m wheel clearance.
  const summary = data.getByTestId('road-swept-summary')
  await expect(summary).toContainText('1 of 6 turns need wider formation')
  await expect(data.getByRole('tab', { name: 'Swept path, 1 turn needs widening', exact: true })).toBeVisible()
  const turn = data.getByTestId('road-swept-turn').first()
  await expect(turn).toHaveAttribute('data-fits', 'false')
  await expect(turn).toContainText('H6+H7 · L 180° · switchback')
  await expect(turn).toContainText('Widen 0.22 m')
  await expect(turn).toContainText('1.62 m')
  await turn.getByRole('button', { name: 'Show H6+H7 worst station', exact: true }).click()
  await expect(page.getByTestId('road-feature-selection')).toContainText('H6+H7 swept path')
  await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', /^1[56]\d\d/)
  // The plan legend lists the swept-path layers that are drawn.
  await page.getByRole('button', { name: 'Legend', exact: true }).click()
  await expect(page.getByText('Outer wheel paths', { exact: true })).toBeVisible()
  await expect(page.getByText('Wheels outside formation less clearance', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Legend', exact: true }).click()

  // The curve review reports the turn a curve belongs to.
  await data.getByRole('tab', { name: 'Horizontal curves', exact: true }).click()
  await data.getByRole('button', { name: 'Review curve H7', exact: true }).click()
  await expect(data.getByTestId('road-curve-swept-status')).toContainText('H6+H7')
  await expect(data.getByTestId('road-curve-swept-status')).toContainText('wheels need 0.22 m more formation')
  await data.getByRole('button', { name: 'Swept path', exact: true }).click()

  // Without the clearance margin the wheels stay on the 3 m formation.
  await data.getByText('Vehicle, direction & clearance', { exact: true }).click()
  const clearance = data.getByRole('spinbutton', { name: 'Wheel clearance (m)', exact: true })
  await clearance.fill('0')
  await clearance.press('Tab')
  await expect(summary).toContainText('Wheels stay on the formation in all 6 turns')
  const truck = data.getByRole('spinbutton', { name: 'Truck wheelbase (m)', exact: true })
  await truck.fill('7')
  await truck.press('Tab')
  await expect(data.getByRole('combobox', { name: 'Design vehicle preset', exact: true })).toHaveAttribute('data-value', 'custom')
  // A longer truck tracks further inside: the switchback needs widening again at zero clearance.
  await expect(summary).toContainText('1 of 6 turns need wider formation')
  await expect(summary).toContainText('Loaded log truck + pole trailer (edited)')
  const beforeSave = (await summary.textContent())!

  const saved = await saveProject(page)
  const road = saved.alignments.find((a) => a.id === saved.activeAlignmentId)!
  expect(road.vehicleCheck).toMatchObject({ direction: 'both', clearanceM: 0 })
  expect(road.vehicleCheck!.vehicle.units[0].wheelbaseM).toBe(7)
  // Reopening the saved file restores the check and its result.
  await press(page.getByRole('button', { name: 'Open', exact: true }))
  await page.getByTestId('road-file-input').setInputFiles({
    name: 'saved.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  })
  await data.getByRole('tab', { name: /^Swept path/ }).click()
  await expect(summary).toHaveText(beforeSave)
  const remove = data.getByRole('button', { name: 'Remove vehicle check', exact: true })
  if (!(await remove.isVisible())) await data.getByText('Vehicle, direction & clearance', { exact: true }).click()
  await remove.click()
  await expect(data.getByRole('button', { name: 'Check a design vehicle', exact: true })).toBeVisible()
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
  await expect.poll(() => countRoads(page)).toBe(3)
  await expect(activeRoad(page)).toContainText('Left return')
  const summary = page.locator('dl').filter({ hasText: 'Coverage' }).first()
  await expect(summary).toContainText('1,695 m')
  await expect(summary).toContainText('100%')
  await choose(activeRoad(page), { label: 'Baseline hillside road · synthetic training' })
  await expect(summary).toContainText('1,429 m')
  await expect(summary).toContainText('100%')
  await choose(activeRoad(page), { label: 'Right return · R40 m / +3% assumptions · synthetic' })
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
      const roadCount = await countRoads(page)
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
      await expect.poll(() => countRoads(page)).toBe(roadCount + 1)
      await expect(activeRoad(page)).toContainText('right switchback R40')
      expect(errors).toEqual([])
    })

    test('the switchback tool sizes the radius for a vehicle, and the swept path view frames it', async ({
      page,
    }, info) => {
      const errors = await prepare(page)
      const tools = await openSwitchbackTools(page)
      await setNumber(tools, 'Switchback radius (m)', 20)
      const swept = tools.getByTestId('road-switchback-swept')
      await swept.scrollIntoViewIfNeeded()
      await expect(swept.getByRole('status')).toContainText('Wheels need 1.87 m more formation')
      await expect(swept).toContainText('Example vehicle')
      await press(swept.getByRole('button', { name: 'Find smallest radius that fits', exact: true }))
      await expect(swept.getByTestId('road-switchback-fit')).toContainText('Smallest fitting radius: 46.5 m', {
        timeout: 60_000,
      })
      await press(swept.getByRole('button', { name: 'Use R46.5', exact: true }))
      await expect(tools.getByRole('spinbutton', { name: 'Switchback radius (m)', exact: true })).toHaveValue('46.5')
      await expect(swept.getByRole('status')).toContainText('Wheels stay on the formation')
      await swept.screenshot({ path: info.outputPath('switchback-swept.png') })
      const create = tools.getByRole('button', { name: 'Create switchback alternative', exact: true })
      await create.scrollIntoViewIfNeeded()
      await press(create)
      await expect(page.getByRole('button', { name: 'Show road controls', exact: true })).toBeVisible()

      // Phones reach the check directly from the detail view picker.
      await press(
        page.getByRole('tablist', { name: 'Visible road pane', exact: true }).getByRole('tab', { name: 'Detail' }),
      )
      await choose(page.getByRole('combobox', { name: 'Road detail view', exact: true }), { label: 'Swept path' })
      const panel = page.getByTestId('road-swept-path')
      await press(panel.getByRole('button', { name: 'Check a design vehicle', exact: true }))
      const turn = panel.getByTestId('road-swept-turn').filter({ hasText: 'switchback' })
      await expect(turn).toHaveAttribute('data-fits', 'true')
      await expect(turn).toContainText('L 180° · switchback')
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
      await page.screenshot({ path: info.outputPath('swept-path-view.png') })
      await press(turn.getByRole('button', { name: /^Show H\d+\+H\d+ tightest station$/ }))
      await expect(page.getByTestId('road-feature-selection')).toContainText('swept path')
      expect(errors).toEqual([])
    })
  })
}
