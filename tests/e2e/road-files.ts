import type { Locator, Page } from '@playwright/test'
import { choose } from './styled-select'

/**
 * Outputs listed as one row with a format dropdown (`EXPORT_FORMAT_FAMILIES`): the row's name and the format's label.
 * A test names the output as its Download button does ("Report HTML").
 */
const FORMAT_ROWS: Record<string, readonly [row: string, format: string]> = {
  'Report PDF': ['Report', 'PDF'],
  'Report HTML': ['Report', 'HTML'],
  'Plot book PDF': ['Plot book', 'PDF'],
  'Plot book HTML': ['Plot book', 'HTML'],
}

/**
 * Selects an output in the open Save & export dialog and returns its Download button, which writes
 * the file. The list rows only select; each output downloads from the preview pane. An output that
 * is one format of a row ("Report HTML") selects the row, then the format.
 */
export async function chooseExport(page: Page, label: string, { tap = false } = {}): Promise<Locator> {
  const dialog = page.getByTestId('road-files-dialog')
  const [name, format] = FORMAT_ROWS[label] ?? [label, null]
  const row = dialog.getByRole('navigation', { name: 'Files', exact: true }).getByRole('button', {
    name,
    exact: true,
  })
  if (tap) await row.tap()
  else await row.click()
  if (format) await choose(dialog.getByRole('combobox', { name: `${name} format`, exact: true }), { label: format })
  return dialog.getByRole('button', { name: `Download ${label}`, exact: true })
}

/**
 * Shows an output's preview: its Preview tab where the pane is narrow, nothing where the preview already sits beside
 * the settings (`data-layout="side-by-side"`), which has no such tab.
 */
export async function showRoadPreview(views: Locator) {
  const tab = views.getByRole('button', { name: 'Preview', exact: true })
  if (await tab.count()) await tab.click()
}

/**
 * The active road of the project this browser has autosaved, or undefined before the first save.
 * Projects live under `project:<id>` and `active` names the open one (`projectLibrary.ts`); the
 * single `current` slot is only read once, to migrate an older save.
 */
export function savedActiveRoadId(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      new Promise<string | undefined>((resolve, reject) => {
        const request = indexedDB.open('pgmaps-forestry-roads-v1', 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const store = db.transaction('projects', 'readonly').objectStore('projects')
          const active = store.get('active')
          active.onerror = () => reject(active.error)
          active.onsuccess = () => {
            if (typeof active.result !== 'string') {
              db.close()
              resolve(undefined)
              return
            }
            const project = store.get(`project:${active.result}`)
            project.onerror = () => reject(project.error)
            project.onsuccess = () => {
              db.close()
              resolve(project.result?.activeAlignmentId)
            }
          }
        }
      }),
  )
}

/**
 * Opening a project file whose name matches a project this browser already holds asks whether to
 * replace the saved one or keep both. Outside training mode the example a first visit opens is
 * autosaved under its own name, and a file made from it by importing terrain keeps that name, so
 * the question depends on whether the autosave has landed. Call this once per page: whenever the
 * question appears it is answered with "Replace saved project", which opens the file as it is.
 */
export async function replaceSavedProjectWhenAsked(page: Page) {
  await page.addLocatorHandler(page.getByTestId('road-project-file-conflict'), async (dialog) => {
    await dialog.getByRole('button', { name: 'Replace saved project', exact: true }).click()
  })
}

/**
 * A first visit outside training mode opens an example road and says so in a card that stays until
 * it is dismissed. On a phone the notification stack runs along the bottom, above dialogs, where
 * the card covers the Save dialog's button and the station bar. Call this once per page: the card
 * is dismissed whenever it is in the way of the next action.
 */
export async function dismissExampleNoticeWhenShown(page: Page) {
  await page.addLocatorHandler(page.getByTestId('road-example-start'), async (card) => {
    await card.getByRole('button', { name: 'Dismiss the example notice', exact: true }).click()
  })
}
