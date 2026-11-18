import { expect, test, type Page } from '@playwright/test'
import { choose, expectSelected } from './styled-select'
import { openVisualsExport } from './visuals-export'

/**
 * Save & export on the visual quality page (docs/forestry-visual-quality.md, **Save & export**): a part of *What
 * goes in* that a sidebar section sets is edited under its rows, with that section moved into the dialog rather than
 * copied; a map style is chosen from a list of sample maps; and an output's options carry one link to Your details.
 */
test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(180_000)

async function stubMaps(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
}

test('a part is edited under its rows with the sidebar’s own section, and a drawing closes the dialog', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await stubMaps(page)
  await page.addInitScript(() => window.localStorage.clear())
  await page.goto('/dev/forestry/visual-quality')
  await expect(page.getByRole('heading', { name: 'Visual quality' })).toBeVisible()
  const dialog = await openVisualsExport(page, 'Block note')

  // The block's part opens the step's Cutblocks section in place: one editor, moved, not a second form.
  const block = dialog.getByRole('region', { name: 'Block', exact: true })
  await block.getByRole('button', { name: 'Edit here: Block' }).click()
  const editor = block.locator('[data-export-editor="cutblocks"]')
  await expect(editor.getByRole('heading', { name: 'Cutblocks' })).toBeVisible()
  await expect(page.locator('[data-projection-slot] h2', { hasText: 'Cutblocks' })).toHaveCount(1)
  await expect(page.locator('h2', { hasText: /^Cutblocks$/ })).toHaveCount(1)
  // Its place in the sidebar says where it went.
  await expect(page.locator('[data-via-panel="identify"]')).toContainText(
    'Open in Save & export, where it is being edited.',
  )

  // A change made in the dialog is the scene's: the block's objective changes there and stays after closing.
  const objective = editor.getByRole('combobox', { name: /^Visual quality objective for / }).first()
  const name = (await objective.getAttribute('aria-label'))!
  await choose(objective, 'retention')
  await expectSelected(objective, 'retention')

  // Opening another part's editor closes this one: an editor is one element, shown in one place.
  await dialog.getByRole('button', { name: 'Edit here: Landform' }).click()
  await expect(dialog.locator('[data-export-editor]')).toHaveCount(1)
  const landform = dialog.locator('[data-export-editor="landform"]')
  await expect(landform.getByRole('heading', { name: 'Landform and objective' })).toBeVisible()

  // A drawing cannot be made behind the dialog: starting one closes it and shows the step with its controls.
  await landform.getByRole('button', { name: 'Draw landform' }).click()
  await expect(dialog).toBeHidden()
  const step = page.locator('[data-via-panel="identify"]')
  await expect(step).toBeVisible()
  await expect(step.getByRole('button', { name: 'Draw landform' })).toHaveAttribute('aria-pressed', 'true')
  await expect(step).not.toContainText('Open in Save & export')
  await expectSelected(step.getByRole('combobox', { name }), 'retention')
  expect(errors).toEqual([])
})

test('a map style is chosen from sample maps, and the options carry one link to Your details', async ({ page }) => {
  await stubMaps(page)
  await page.addInitScript(() => window.localStorage.clear())
  await page.goto('/dev/forestry/visual-quality')
  await expect(page.getByRole('heading', { name: 'Visual quality' })).toBeVisible()
  const dialog = await openVisualsExport(page, 'VIA report')

  // Every style in the open list carries its sample; none of them is a rendered map.
  const style = dialog.getByRole('combobox', { name: 'Map style', exact: true })
  await style.click()
  const list = page.getByRole('listbox').last()
  const options = list.getByRole('option')
  await expect(options.first()).toBeVisible()
  const count = await options.count()
  expect(count).toBeGreaterThan(3)
  await expect(list.locator('img[data-map-style-sample]')).toHaveCount(count)
  const samples = await list
    .locator('img[data-map-style-sample]')
    .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src))
  expect(samples.every((src) => src.startsWith('data:image/svg+xml'))).toBe(true)
  // The report's own symbols and a figure style's are different pictures.
  expect(new Set(samples).size).toBeGreaterThan(1)
  await list.locator('[role="option"][data-value="analysis-sheet-purple"]').click()
  await expect(list).toBeHidden()

  // The chosen style's sample sits under the field with a key of what it draws.
  const preview = dialog.locator('[data-map-style-preview="analysis-sheet-purple"]')
  await expect(preview.locator('img[data-map-style-sample]')).toBeVisible()
  await expect(preview.getByRole('list')).toContainText('Proposed Block')
  await expect(dialog.getByText(/draw the proposed blocks and existing openings with this figure style/)).toBeVisible()

  // With no details entered there is one link to them, not two that open the same form.
  const printed = dialog.getByTestId('printed-preparer')
  await expect(printed.getByRole('button')).toHaveCount(1)
  await expect(printed.getByRole('button', { name: 'Enter your details…' })).toBeVisible()

  // The report says what it follows once, in its part, with the package's link beside it.
  const report = dialog.getByRole('region', { name: 'Report', exact: true })
  await expect(report).toContainText('Structure of')
  await expect(report.getByRole('button', { name: 'Change in Package' })).toBeVisible()
  await expect(dialog.getByText('chosen under Package')).toHaveCount(0)
})
