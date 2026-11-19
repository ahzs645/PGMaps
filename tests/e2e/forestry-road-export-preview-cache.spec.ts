import { expect, test } from '@playwright/test'
import { chooseExport } from './road-files'
import { openWorkbench } from './road-workbench'

/**
 * Save & export keeps the previews it has written while the content is unchanged (`FilesDialog`, `KEPT_PREVIEWS`):
 * going back to an output shows its file at once rather than writing it again.
 */
test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

test('going back to an output shows its kept preview at once, and an edit writes it again', async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const dialog = page.getByTestId('road-files-dialog')
  const preparing = dialog.getByText('Preparing preview…')

  await chooseExport(page, 'Report PDF')
  await expect(dialog.locator('[data-pdf-page]').first()).toBeVisible({ timeout: 60_000 })
  await chooseExport(page, 'Station CSV')
  await expect(dialog.getByRole('region', { name: 'Station CSV preview' })).toBeVisible()
  await expect(preparing).toHaveCount(0, { timeout: 30_000 })

  // Back to the report: its pages come straight back, with no "Preparing preview" in between.
  await chooseExport(page, 'Report PDF')
  await expect(preparing).toHaveCount(0)
  await expect(dialog.locator('[data-pdf-page]').first()).toBeVisible()

  // A change to what the report prints writes it again.
  await dialog.getByRole('button', { name: 'Issue stamp', exact: true }).click()
  await dialog.getByTestId('road-issue-stamp').getByRole('textbox', { name: 'Prepared by' }).fill('A. Tester')
  await expect(preparing).toBeVisible()
  await expect(dialog.locator('[data-pdf-page]').first()).toBeVisible({ timeout: 60_000 })
})
