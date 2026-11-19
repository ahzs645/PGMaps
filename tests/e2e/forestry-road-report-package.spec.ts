import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { expect, test, type Page } from '@playwright/test'
import { openWorkbench } from './road-workbench'
import { choose } from './styled-select'
import { contentsCountLine, contentsList, contentsOrder, moveContentsPart, setContentsState } from './document-contents'
import { chooseExport } from './road-files'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 }, actionTimeout: 15000 })
test.setTimeout(180000)

async function download(page: Page, label: string) {
  const pending = page.waitForEvent('download', { timeout: 150000 })
  await page.getByRole('button', { name: label, exact: true }).click()
  const file = await pending
  const stream = (await file.createReadStream())!
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return { file, bytes: Buffer.concat(chunks) }
}

test('the report package puts a part in an appendix PDF of its own and leaves others out', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save & export', exact: true })
  await dialog.getByLabel('Project name', { exact: true }).fill('Package review')
  const button = await chooseExport(page, 'Report package')

  // The preview lists the default files: the package and its appendices.
  const preview = dialog.frameLocator('iframe[title="Report package preview"]')
  await expect(preview.getByText('Package-review-report-package.pdf')).toBeVisible({ timeout: 30000 })

  await dialog.getByRole('button', { name: 'Contents', exact: true }).click()
  // The shared contents list: a row per part, its placement a dropdown named "<part>: where it goes".
  const editor = contentsList(dialog, { testId: 'road-report-package' })
  await expect(editor.getByLabel('Field Layout: where it goes', { exact: true })).toBeVisible()
  await setContentsState(editor, 'sheet:field-layout', 'omit')
  await setContentsState(editor, 'report:sections', 'omit')
  await setContentsState(editor, 'report:station-schedule', 'omit')
  await setContentsState(editor, 'plotbook:sections', 'omit')
  // The clearing schedule and slope-stake book have been appendices by default since 17 November.
  await setContentsState(editor, 'report:clearing', 'omit')
  await setContentsState(editor, 'report:slope-stakes', 'omit')
  await choose(editor.getByLabel('Plan & profile sheets: where it goes', { exact: true }), { label: /^Appendix/ })
  await expect.poll(() => contentsCountLine(editor)).toBe('The package and 1 appendix PDF; 18 parts left out.')
  // The package's file list is previewed beside the list.
  await expect(
    editor
      .frameLocator('iframe[title="Report package preview"]')
      .getByText('Package-review-appendix-plan-profile-sheets.pdf'),
  ).toBeVisible({ timeout: 30000 })

  await expect(button).toBeEnabled()
  const pkg = await download(page, 'Download Report package')
  expect(pkg.file.suggestedFilename()).toBe('Package-review-report-package.zip')
  await pkg.file.saveAs(testInfo.outputPath('report-package.zip'))
  const zip = await JSZip.loadAsync(pkg.bytes)
  expect(Object.keys(zip.files).sort()).toEqual([
    'Package-review-appendix-plan-profile-sheets.pdf',
    'Package-review-report-package.pdf',
  ])
  const main = await PDFDocument.load(await zip.file('Package-review-report-package.pdf')!.async('uint8array'))
  const appendix = await PDFDocument.load(
    await zip.file('Package-review-appendix-plan-profile-sheets.pdf')!.async('uint8array'),
  )
  expect(main.getTitle()).toBe('Package review · report package')
  expect(appendix.getTitle()).toBe('Package review · Appendix: Plan & profile sheets')
  // A cover, the report and the charts sheet in the package; a cover and plan-and-profile sheets in the appendix.
  expect(main.getPageCount()).toBeGreaterThan(2)
  expect(appendix.getPageCount()).toBeGreaterThan(1)
  // The A3 plot-book sheets are landscape; the cover is A4 portrait.
  const [width, height] = [appendix.getPage(1).getWidth(), appendix.getPage(1).getHeight()]
  expect(width).toBeGreaterThan(height)

  // The choice is saved with the project, keeping only what differs from the default.
  await chooseExport(page, 'Project file')
  const project = await download(page, 'Save project JSON')
  expect(JSON.parse(project.bytes.toString()).reportSettings.package).toEqual({
    parts: {
      'report:sections': 'omit',
      'report:station-schedule': 'omit',
      'report:clearing': 'omit',
      'report:slope-stakes': 'omit',
      'plotbook:plan-profile': 'appendix',
      'plotbook:sections': 'omit',
      'sheet:field-layout': 'omit',
    },
  })
  expect(errors).toEqual([])
})

test('the report contents list leaves a section out, moves one, and the report beside it follows', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save & export', exact: true })
  await chooseExport(page, 'Report HTML')
  await dialog.getByRole('button', { name: 'Contents', exact: true }).click()
  const list = contentsList(dialog, { testId: 'road-report-contents' })
  // The opening parts are locked in place; the live report is previewed beside the list.
  expect((await contentsOrder(list)).slice(0, 4)).toEqual(['title', 'not-current', 'status', 'terrain'])
  const preview = list.frameLocator('iframe[title="Report HTML preview"]')
  await expect(preview.getByRole('heading', { name: 'Station schedule', exact: true })).toBeVisible({
    timeout: 30000,
  })
  await setContentsState(list, 'review', false)
  await moveContentsPart(list, 'station-schedule', 'top')
  await expect.poll(async () => (await contentsOrder(list))[4]).toBe('station-schedule')
  await expect(preview.locator('[data-omitted-sections]')).toContainText('Readiness checks', { timeout: 30000 })
  const report = await download(page, 'Download Report HTML')
  const html = report.bytes.toString()
  expect(html).not.toContain('<h2>Readiness checks</h2>')
  expect(html.indexOf('<h2>Station schedule</h2>')).toBeLessThan(html.indexOf('<h2>Longitudinal profile</h2>'))
  // The order is saved with the project, beside the sections left out.
  await chooseExport(page, 'Project file')
  const project = await download(page, 'Save project JSON')
  const settings = JSON.parse(project.bytes.toString()).reportSettings
  expect(settings.omittedSections).toEqual(['review'])
  expect(settings.sectionOrder[0]).toBe('station-schedule')
  expect(errors).toEqual([])
})
