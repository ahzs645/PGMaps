import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { expect, test, type Page } from '@playwright/test'
import { openWorkbench } from './road-workbench'
import { choose } from './styled-select'
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
  const editor = dialog.getByTestId('road-report-package')
  const place = (label: string, placement: string) =>
    choose(editor.getByLabel(`${label}: where it goes`, { exact: true }), { label: new RegExp(`^${placement}`) })
  await place('Field Layout', 'Leave out')
  await place('Cross-sections', 'Leave out')
  await place('Station schedule', 'Leave out')
  await place('Cross-section sheets', 'Leave out')
  await place('Plan & profile sheets', 'Appendix')
  await expect(editor).toContainText('The package and 1 appendix PDF')

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
      'plotbook:plan-profile': 'appendix',
      'plotbook:sections': 'omit',
      'sheet:field-layout': 'omit',
    },
  })
  expect(errors).toEqual([])
})
