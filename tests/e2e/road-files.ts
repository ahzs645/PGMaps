import type { Locator, Page } from '@playwright/test'

/**
 * Selects an output in the open Save & export dialog and returns its Download button, which writes
 * the file. The list rows only select; each output downloads from the preview pane.
 */
export async function chooseExport(page: Page, label: string, { tap = false } = {}): Promise<Locator> {
  const dialog = page.getByTestId('road-files-dialog')
  const row = dialog.getByRole('navigation', { name: 'Files', exact: true }).getByRole('button', {
    name: label,
    exact: true,
  })
  if (tap) await row.tap()
  else await row.click()
  return dialog.getByRole('button', { name: `Download ${label}`, exact: true })
}
