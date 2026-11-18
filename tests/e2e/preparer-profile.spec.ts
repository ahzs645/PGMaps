import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

import { openWorkbench } from './road-workbench'
import { openVisualsExport } from './visuals-export'

/**
 * Your details (`src/branding/PreparerProfile.tsx`; `docs/shared-ui.md`, **Your details and person fields**): entered
 * once from either tool's Save & export, kept in the browser, copied into a project's blank preparer fields only by
 * *Use my details*, and printed with the user's logo on the road designer's documents. Inside Save & export they are
 * a pane beside the file list, never a second modal.
 */

// A 4 × 2 red PNG.
const LOGO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGP4z8AARwzIHABvqgf5gNwAKAAAAABJRU5ErkJggg==',
  'base64',
)

async function stubMaps(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
}

async function enterDetails(page: Page, dialog: ReturnType<Page['getByTestId']>) {
  await dialog.getByTestId('preparer-profile-row').click()
  const profile = dialog.getByTestId('preparer-profile-pane')
  await expect(profile).toBeVisible()
  await expect(page.getByTestId('preparer-profile-dialog')).toHaveCount(0)
  await profile.getByLabel('Name').fill('J. Smith')
  await profile.getByLabel('Designation').fill('RPF')
  await profile.getByLabel('Registration number').fill('4521')
  await profile.getByLabel('Organisation').fill('Northwood Forestry')
  await profile
    .getByLabel('Choose a logo image')
    .setInputFiles({ name: 'mark.png', mimeType: 'image/png', buffer: LOGO })
  await expect(profile.getByText('Your logo, mark.png')).toBeVisible()
  await expect(profile.getByText('Not saved yet.')).toBeVisible()
  await profile.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(profile.getByText('Not saved yet.')).toHaveCount(0)
  await expect(dialog.getByTestId('preparer-profile-row')).toContainText(
    'J. Smith, RPF #4521 · Northwood Forestry · logo',
  )
}

test('Your details fill the road issue stamp on a click and print with the logo', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await stubMaps(page)
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const dialog = page.getByTestId('road-files-dialog')
  await expect(dialog).toBeVisible()
  await enterDetails(page, dialog)

  await dialog.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: 'Report HTML' }).click()
  await dialog.getByRole('button', { name: 'Issue stamp', exact: true }).click()
  const stamp = dialog.getByTestId('road-issue-stamp')
  await stamp.getByRole('textbox', { name: 'Prepared by' }).fill('A. Other')
  await stamp.getByTestId('use-my-details').click()
  // A filled field is the project's own; only the blanks take your details.
  await expect(stamp.getByRole('textbox', { name: 'Prepared by' })).toHaveValue('A. Other')
  await expect(stamp.getByRole('textbox', { name: 'Designation' })).toHaveValue('RPF #4521')
  await expect(stamp.getByRole('textbox', { name: 'Organisation' })).toHaveValue('Northwood Forestry')
  await expect(stamp.getByText('Every field your details would fill is already filled here.')).toBeVisible()
  await expect(dialog.getByTestId('road-issue-line')).toContainText(
    'Prepared by A. Other, RPF #4521, Northwood Forestry',
  )

  const pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download Report HTML', exact: true }).click()
  const html = await readFile((await (await pending).path())!, 'utf8')
  expect(html).toContain('A. Other, RPF #4521, Northwood Forestry')
  expect(html).toContain('data-brand-header')
  expect(html).toContain(LOGO.toString('base64').slice(0, 24))
})

test('Your details fill the VIA preparer, and person fields offer your name', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await stubMaps(page)
  await page.addInitScript(() => window.localStorage.clear())
  await page.goto('/dev/forestry/visual-quality')
  await expect(page.getByRole('heading', { name: 'Visual quality' })).toBeVisible()

  const dialog = await openVisualsExport(page, 'VIA report')
  await enterDetails(page, dialog)
  await openVisualsExport(page, 'VIA report')
  const printed = dialog.getByTestId('printed-preparer')
  await expect(printed).toContainText('Prepared by: not entered')
  await expect(printed).toContainText('Logo: yours, mark.png')
  await printed.getByTestId('use-my-details').click()
  await expect(printed).toContainText('Prepared by: J. Smith, RPF #4521, Northwood Forestry')

  // An output's *Edit your details* opens the same pane, and an unsaved edit survives a look at another file.
  await printed.getByRole('button', { name: 'Edit your details' }).click()
  const pane = dialog.getByTestId('preparer-profile-pane')
  await expect(pane).toBeVisible()
  await expect(page.getByTestId('preparer-profile-dialog')).toHaveCount(0)
  await pane.getByLabel('Contact').fill('250-555-0100')
  await openVisualsExport(page, 'VIA report')
  await expect(pane).toBeHidden()
  await dialog.getByTestId('preparer-profile-row').click()
  await expect(pane.getByLabel('Contact')).toHaveValue('250-555-0100')
  await pane.getByRole('button', { name: 'Discard changes' }).click()
  await expect(pane.getByLabel('Contact')).toHaveValue('')

  // The FS1252 office information holds them, and Licensee (who the work is for) stays blank.
  await openVisualsExport(page, 'FS1252 form')
  await dialog.locator('[data-forestry-disclosure="office-fields"]').click()
  await expect(dialog.getByLabel('Prepared/evaluated by (optional)')).toHaveValue('J. Smith')
  await expect(dialog.getByLabel('Evaluator’s designation, e.g. RPF #4521')).toHaveValue('RPF #4521')
  await expect(dialog.getByLabel('Licensee', { exact: true })).toHaveValue('')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()

  // Field brief's Checked by, in its Save & export options: a person field fills your name on a click, and can be
  // someone else's.
  await openVisualsExport(page, 'Field brief')
  const checkedBy = dialog.getByRole('textbox', { name: 'Checked by' })
  await expect(checkedBy).toBeVisible()
  await dialog.getByRole('button', { name: 'Fill in your name, J. Smith' }).click()
  await expect(checkedBy).toHaveValue('J. Smith')
  await checkedBy.fill('Crew lead B.')
  await expect(dialog.getByRole('button', { name: 'Replace with your name, J. Smith' })).toBeVisible()
})

test('a logo may be an SVG, kept as a PNG drawn from it', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await stubMaps(page)
  await page.goto('/dev/forestry/visual-quality')
  const dialog = await openVisualsExport(page, 'VIA report')
  await dialog.getByTestId('preparer-profile-row').click()
  const profile = dialog.getByTestId('preparer-profile-pane')
  await expect(profile.getByTestId('logo-file-types')).toHaveText('PNG, JPEG or SVG, up to 2 MB')
  await profile.getByLabel('Choose a logo image').setInputFiles({
    name: 'mark.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 10"><rect width="40" height="10" fill="#c00"/></svg>',
    ),
  })
  await expect(profile.getByText('Your logo, mark.svg')).toBeVisible()
  const stored = await page.evaluate(
    () =>
      new Promise<{ format: string; width: number; height: number; png: boolean }>((resolve, reject) => {
        const open = indexedDB.open('pgmaps-branding', 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const get = open.result.transaction('preferences').objectStore('preferences').get('logo')
          get.onsuccess = () => {
            const logo = get.result
            resolve({
              format: logo.format,
              width: logo.width,
              height: logo.height,
              png: logo.dataUrl.startsWith('data:image/png;base64,'),
            })
          }
        }
      }),
  )
  expect(stored).toEqual({ format: 'PNG', width: 1200, height: 300, png: true })
})
