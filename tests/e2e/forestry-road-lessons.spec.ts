import { expect, test, type Page } from '@playwright/test'
import { openWorkbench } from './road-workbench'
import { choose } from './styled-select'

// The live lesson over the road designer (`docs/forestry-road-design/live-lessons.md`).
test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1440, height: 900 } })
test.setTimeout(180_000)

const lesson = (mode: 'practice' | 'watch') =>
  `/dev/forestry/road-design?example=training&tour=station-200&tourMode=${mode}`
const card = (page: Page) => page.locator('[data-tutorial-surface][data-tutorial-step]')
const heading = (page: Page) => page.getByTestId('tutorial-card-heading')
const station = (page: Page) => page.getByRole('spinbutton', { name: 'Selected station metres' })
const detailView = (page: Page) => page.getByRole('combobox', { name: 'Road detail view' })

test('a learner practises station 0+200 with the real controls', async ({ page }) => {
  await openWorkbench(page, lesson('practice'))
  await expect(heading(page)).toHaveText('Practice · 1 of 5', { timeout: 30_000 })
  await expect(card(page)).toHaveAttribute('data-tutorial-step', 'plan')
  await page.getByRole('button', { name: 'Next tutorial step' }).click()

  // A graded step: no Next until the station is 0+200, however it gets there.
  await expect(heading(page)).toHaveText('Practice · 2 of 5')
  await expect(page.getByRole('button', { name: 'Next tutorial step' })).toHaveCount(0)
  await station(page).fill('200')
  await station(page).press('Enter')
  await expect(card(page)).toHaveAttribute('data-tutorial-step', 'profile')
  await page.getByRole('button', { name: 'Next tutorial step' }).click()

  await expect(card(page)).toHaveAttribute('data-tutorial-step', 'section')
  await expect(page.getByTestId('road-section-readout')).toContainText('2.03 m')
  await page.getByRole('button', { name: 'Next tutorial step' }).click()

  // The view list opens in a popover; the lesson must not read it as a blocking dialog.
  await expect(card(page)).toHaveAttribute('data-tutorial-step', 'grade')
  await choose(detailView(page), 'grade')
  await expect(page.getByText('Tutorial paused while this dialog is open')).toHaveCount(0)
  await page.getByRole('button', { name: /Finish/ }).click()

  await expect(page.getByText('Nice work — you did it!')).toBeVisible()
  await page.getByRole('button', { name: 'Keep working here' }).click()
  await expect(page.locator('[data-tutorial-surface]')).toHaveCount(0)
  await expect(page).not.toHaveURL(/tour=/)
  const completions = await page.evaluate(() => localStorage.getItem('pgmaps-road-design:tutorial:completions'))
  expect(JSON.parse(completions ?? '{}')).toHaveProperty('station-200.mode', 'practice')
})

test('Watch runs the lesson through the designer’s own operations', async ({ page }) => {
  await openWorkbench(page, lesson('watch'))
  await expect(heading(page)).toHaveText('Watch · 1 of 5', { timeout: 30_000 })
  await expect(station(page)).toHaveValue('200', { timeout: 60_000 })
  await expect(detailView(page)).toHaveAttribute('data-value', 'grade', { timeout: 90_000 })
  await expect(page.getByText('Nice work — you did it!')).toBeVisible({ timeout: 30_000 })
})

test('the lesson starts from its fixture’s screen in any interface', async ({ page }) => {
  // The Ribbon's default layout hides the detail pane; the fixture's setup shows the cross-section.
  await page.goto(`${lesson('practice')}&interface=ribbon`)
  await expect(heading(page)).toHaveText('Practice · 1 of 5', { timeout: 30_000 })
  await expect(page.getByTestId('road-section-readout')).toBeVisible()
  await expect(detailView(page)).toHaveAttribute('data-value', 'section')
  await expect(station(page)).toHaveValue('0')
})

test('a step whose pane is closed offers to bring it back', async ({ page }) => {
  await openWorkbench(page, lesson('practice'))
  await expect(heading(page)).toHaveText('Practice · 1 of 5', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Next tutorial step' }).click()
  await station(page).fill('200')
  await station(page).press('Enter')
  await expect(card(page)).toHaveAttribute('data-tutorial-step', 'profile')

  // Close the detail pane before the section step opens: the step names the view it needs.
  await page.getByRole('button', { name: 'Close detail view panel' }).click()
  await expect(page.getByTestId('road-section-readout')).toBeHidden()
  await page.getByRole('button', { name: 'Next tutorial step' }).click()
  await page.getByRole('button', { name: 'Return to this step’s view' }).click()
  await expect(page.getByTestId('road-section-readout')).toBeVisible()
  await expect(card(page)).toHaveAttribute('data-tutorial-step', 'section')

  await page.keyboard.press('Escape')
  await expect(page.locator('[data-tutorial-surface]')).toHaveCount(0)
  await expect(page).not.toHaveURL(/tour=/)
})

const practise = (id: string, extra = '') =>
  `/dev/forestry/road-design?example=training&interface=workbench${extra}&tour=${id}&tourMode=practice`
const at = (page: Page, step: string) => expect(card(page)).toHaveAttribute('data-tutorial-step', step)
const next = (page: Page) => page.getByRole('button', { name: 'Next tutorial step' }).click()

test('the help lists every lesson, opens a guide and sends old addresses to it', async ({ page }) => {
  await page.goto('/help?interface=ribbon')
  await expect(page.getByRole('heading', { name: 'Road design workflows' })).toBeVisible()
  await expect(page.locator('[data-lesson]')).toHaveCount(13)
  const practice = page.getByRole('link', { name: /^Practise: Change the road cross-section/ })
  await expect(practice).toHaveAttribute('href', /interface=ribbon&tour=road-section&tourMode=practice$/)
  await page.getByRole('link', { name: 'Change the road cross-section', exact: true }).click()
  await expect(page).toHaveURL(/\/help\/road-section\?interface=ribbon$/)
  await expect(page.locator('[data-step="width"]')).toContainText('Left half-width (m) from 3 to 4')
  await page.goto('/help/station-200/tour.html?interface=workbench')
  await expect(page).toHaveURL(/\/help\/station-200\?interface=workbench$/)
  await page.goto('/help/index.html?layout=ribbon&interface=ribbon')
  await expect(page).toHaveURL(/\/help\?interface=ribbon$/)
})

test('road-section: the learner types the new half-width in the real field', async ({ page }) => {
  await openWorkbench(page, practise('road-section'))
  await expect(heading(page)).toHaveText('Practice · 1 of 3', { timeout: 30_000 })
  await page.getByRole('tab', { name: 'Section' }).click()
  await at(page, 'width')
  await page.getByRole('spinbutton', { name: 'Left half-width (m)' }).fill('4')
  await at(page, 'widths')
  await expect(page.getByTestId('road-section-readout')).toContainText('4.0 / 3.0')
})

test('terrain: the learner chooses the sample file in the real file chooser', async ({ page }) => {
  await openWorkbench(page, practise('terrain'))
  await expect(heading(page)).toHaveText('Practice · 1 of 5', { timeout: 30_000 })
  await page.getByRole('tab', { name: 'Terrain' }).click()
  await at(page, 'options')
  await page.locator('[data-tutorial-id="road.terrain.importOptions"]').click()
  await at(page, 'datum')
  await page.getByRole('textbox', { name: 'Imported DEM vertical datum (metres)' }).fill('Synthetic training metres')
  await at(page, 'import')
  const chooser = page.waitForEvent('filechooser')
  await page.locator('[data-tutorial-id="road.command.import"]').click()
  await (await chooser).setFiles('public/help/terrain/training-slope.tif')
  await at(page, 'source')
  await expect(page.locator('[data-tutorial-id="road.terrain.source"]')).toContainText('training-slope.tif')
  // The import left the training session; the lesson keeps going.
  await page.getByRole('button', { name: 'Finish tutorial' }).click()
  await expect(page.getByText('Nice work — you did it!')).toBeVisible()
})

test('sketch-road: the learner drags the stroke on the real map', async ({ page }) => {
  await openWorkbench(page, practise('sketch-road', '&lesson=sketch-road'))
  await expect(heading(page)).toHaveText('Practice · 1 of 4', { timeout: 30_000 })
  await page.locator('[data-tutorial-id="road.command.sketch"]').click()
  await at(page, 'stroke')
  const plan = await page.locator('[data-tutorial-id="road.plan"] canvas').first().boundingBox()
  if (!plan) throw new Error('The plan is not on screen.')
  const point = (x: number, y: number) => [plan.x + plan.width * x, plan.y + plan.height * y] as const
  await page.mouse.move(...point(0.2, 0.75))
  await page.mouse.down()
  for (const [x, y] of [
    [0.3, 0.62],
    [0.42, 0.56],
    [0.55, 0.45],
    [0.68, 0.3],
  ])
    await page.mouse.move(...point(x, y), { steps: 6 })
  await page.mouse.up()
  await at(page, 'done')
  // Not Escape: with no dialog open, Escape stops a lesson.
  await page.locator('[data-tutorial-id="road.sketch.done"]').click()
  await at(page, 'road')
  await expect(page.locator('[data-tutorial-id="road.design.roadName"]')).toHaveValue('Sketched road 3')
})

test('export-stations: steps inside Save & export complete on what the learner does there', async ({ page }) => {
  await openWorkbench(page, practise('export-stations'))
  await expect(heading(page)).toHaveText('Practice · 1 of 4', { timeout: 30_000 })
  await page.locator('[data-tutorial-id="road.command.export"]').click()
  await at(page, 'format')
  await page.getByRole('button', { name: 'Station CSV', exact: true }).click()
  await at(page, 'download')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Station CSV' }).click()
  const csv = await (await download).path()
  expect(csv).toBeTruthy()
  // The dialog owns Escape while it is open; closing it is the last step, and Finish is then pressable.
  await at(page, 'close')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Finish tutorial' }).click()
  await expect(page.getByText('Nice work — you did it!')).toBeVisible()
})
