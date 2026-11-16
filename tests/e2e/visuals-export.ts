import { expect, type Download, type Page } from '@playwright/test'

/** The visual-quality page's Save & export dialog, opened (from the toolbar) on one output. */
export async function openVisualsExport(page: Page, output: string | RegExp) {
  const dialog = page.getByTestId('visuals-export-dialog')
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Save & export', exact: true }).click()
  await expect(dialog).toBeVisible()
  const name = typeof output === 'string' ? new RegExp(`^${output}(,|$)`) : output
  await dialog.getByRole('navigation', { name: 'Files' }).getByRole('button', { name }).click()
  return dialog
}

/**
 * The dialog opened on its *Package* entry: the recipe, who draws the figures and the views (views of interest and
 * saved views), chosen once for every output.
 */
export async function openVisualsExportPackage(page: Page) {
  const dialog = page.getByTestId('visuals-export-dialog')
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Save & export', exact: true }).click()
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: /^Package:/ })
    .click()
  await expect(dialog.getByRole('region', { name: 'Package' })).toBeVisible()
  return dialog
}

/** Writes one output from Save & export, in `format` (its segmented label) when given, and returns the download. */
export async function downloadVisualsExport(
  page: Page,
  output: string,
  options: { format?: string } = {},
): Promise<Download> {
  const dialog = await openVisualsExport(page, output)
  if (options.format) await dialog.getByRole('button', { name: options.format, exact: true }).click()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: `Download ${output}`, exact: true }).click()
  return download
}

/** Closes the dialog, as Escape does. */
export async function closeVisualsExport(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('visuals-export-dialog')).toHaveCount(0)
}
