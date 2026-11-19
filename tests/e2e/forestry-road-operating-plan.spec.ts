import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { chooseExport, dismissExampleNoticeWhenShown, showRoadPreview } from './road-files'
import { openWorkbench } from './road-workbench'
import { choose, expectSelected } from './styled-select'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

test('operating plan is an additional export option with a native-size vector PDF', async ({ page }, testInfo) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await dismissExampleNoticeWhenShown(page)
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const downloadButton = await chooseExport(page, 'Block map sheet')
  const dialog = page.getByTestId('road-files-dialog')
  const views = dialog.getByRole('group', { name: 'Block map sheet view', exact: true })
  await views.getByRole('button', { name: 'Sheet setup', exact: true }).click()
  const kind = dialog.getByRole('combobox', { name: 'Sheet', exact: true })
  await expectSelected(kind, 'field-layout')
  await choose(kind, 'operating-plan')
  await expectSelected(dialog.getByRole('combobox', { name: 'Paper', exact: true }), '36x29')
  await expectSelected(dialog.getByRole('combobox', { name: 'Scale', exact: true }), '20000')
  await showRoadPreview(views)
  const preview = dialog.getByRole('img', { name: /block map sheet/i })
  await expect(preview).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: testInfo.outputPath('operating-plan-export.png'), animations: 'disabled' })
  const pending = page.waitForEvent('download')
  await downloadButton.click()
  const download = await pending
  const saved = testInfo.outputPath('operating-plan.pdf')
  await download.saveAs(saved)
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const pdf = await PDFDocument.load(Buffer.concat(chunks))
  expect(pdf.getPageCount()).toBe(1)
  expect(pdf.getPage(0).getSize()).toEqual({ width: 2592, height: 2088 })
  // Settings survive reopening the Files panel and retain the current paper on same-kind edits.
  await views.getByRole('button', { name: 'Sheet setup', exact: true }).click()
  await choose(dialog.getByRole('combobox', { name: 'Paper', exact: true }), 'a3')
  await expectSelected(kind, 'operating-plan')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await chooseExport(page, 'Block map sheet')
  await views.getByRole('button', { name: 'Sheet setup', exact: true }).click()
  await expectSelected(kind, 'operating-plan')
  await expectSelected(dialog.getByRole('combobox', { name: 'Paper', exact: true }), 'a3')
})
