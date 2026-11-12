import { expect, test, type Download, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { openWorkbench } from './road-workbench'
import { chooseExport } from './road-files'
import { fieldTeamProfile as profile } from './brandkit-profile'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 }, actionTimeout: 15000 })
test.setTimeout(120000)

async function open(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Branding', exact: true }).click()
}
async function bytes(download: Download) {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

test('the end user chooses branding surfaces independently and can restore the default', async ({ page }) => {
  await open(page)
  const dialog = page.getByRole('dialog', { name: 'Branding', exact: true })
  await dialog.getByLabel('Import Brandkit file').setInputFiles({
    name: 'field-team.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(profile)),
  })
  await expect(dialog.getByRole('status')).toContainText('Brand imported')
  await expect(page.getByTestId('road-workspace-header').locator('[aria-label="DDC Access"]:visible')).toBeVisible()
  await dialog.getByRole('checkbox', { name: 'Workspace headers and interface colours' }).uncheck()
  await expect(dialog.getByRole('checkbox', { name: 'Use brand fonts in PDF', exact: true })).not.toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Use brand fonts in PDF', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Apply choices' }).click()
  await expect(page.getByTestId('road-workspace-header').getByRole('img', { name: 'DDC Access' })).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await chooseExport(page, 'Report HTML')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Report HTML', exact: true }).click()
  const html = (await bytes(await pending)).toString('utf8')
  expect(html).toContain('pgmaps-brand-snapshot')
  expect(html).toContain('Field team · Resource road planning')
  await page.goto('/help/sketch-road/index.html')
  await expect(page.getByRole('img', { name: 'Field team', exact: true })).toBeVisible()
  await page.goto('/help/sketch-road/tour.html')
  await expect(page.getByRole('img', { name: 'Field team', exact: true })).toBeVisible()
  const offline = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download offline lesson', exact: true }).click()
  const lesson = (await bytes(await offline)).toString('utf8')
  expect(lesson).toContain('pgmaps-brand-snapshot')
  expect(lesson).toContain('Field team identity')
  await open(page)
  await dialog.getByRole('checkbox', { name: 'Workspace headers and interface colours' }).check()
  await dialog.getByRole('checkbox', { name: 'Help pages and offline lessons' }).uncheck()
  await dialog.getByRole('checkbox', { name: 'Project reports and drawings' }).uncheck()
  await dialog.getByRole('button', { name: 'Apply choices' }).click()
  await expect(
    page.getByTestId('road-workspace-header').getByRole('img', { name: 'Field team', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByTestId('road-workspace-header').getByRole('img', { name: 'Field team', exact: true }),
  ).toBeVisible()
  await page.goto('/help/sketch-road/index.html')
  await expect(page.getByRole('img', { name: 'DDC Access', exact: true })).toBeVisible()
  // A downloaded lesson keeps its original brand even after the help choice changes.
  await page.goto('about:blank')
  const external: string[] = []
  await page.route('**/*', (route) => {
    if (route.request().isNavigationRequest() && route.request().frame() === page.mainFrame())
      return route.fulfill({ contentType: 'text/html', body: lesson })
    external.push(route.request().url())
    return route.abort()
  })
  await page.context().setOffline(true)
  await page.goto('/offline-brand-lesson.html')
  await expect(page.getByRole('img', { name: 'Field team', exact: true })).toBeVisible()
  const stage = page.frameLocator('iframe').frameLocator('iframe')
  await expect(stage.locator('body > *').first()).toBeAttached()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.locator('.tk-capture-stage-error')).toHaveCount(0)
  expect(external).toEqual([])
  await page.context().setOffline(false)
  await page.unroute('**/*')
  await open(page)
  await dialog.getByRole('button', { name: 'Remove brand', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Brand removed')
  await dialog.getByRole('button', { name: 'Apply choices' }).click()
  await expect(
    page.getByTestId('road-workspace-header').getByRole('img', { name: 'DDC Access', exact: true }),
  ).toBeVisible()
})

for (const [name, variable] of [
  ['Province of British Columbia', 'PGMAPS_BRANDKIT_PROVINCE'],
  ['B.C.Hydro', 'PGMAPS_BRANDKIT_HYDRO'],
]) {
  test(`${name} source pack keeps complete artwork and offers standard PDF fonts`, async ({ page }, testInfo) => {
    const file = process.env[variable]
    test.skip(!file, 'Set ' + variable + ' to a local Brandkit pack.')
    await open(page)
    const dialog = page.getByRole('dialog', { name: 'Branding', exact: true })
    await dialog.getByLabel('Import Brandkit file').setInputFiles(file!)
    await expect(dialog.getByRole('status')).toContainText('Brand imported', { timeout: 30000 })
    await expect(dialog.getByRole('img', { name: name + ' on light background', exact: true })).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: 'Use brand fonts in PDF', exact: true })).toBeDisabled()
    await expect(dialog).toContainText('OpenType')
    await page.screenshot({ path: testInfo.outputPath('branding.png') })
    await dialog.getByRole('button', { name: 'Apply choices' }).click()
    await expect(page.getByTestId('road-workspace-header').getByRole('img', { name, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await chooseExport(page, 'Report PDF')
    const downloading = page.waitForEvent('download', { timeout: 90000 })
    await page.getByRole('button', { name: 'Download Report PDF', exact: true }).click()
    const fileDownload = await downloading,
      data = await bytes(fileDownload)
    expect(data.subarray(0, 5).toString()).toBe('%PDF-')
    expect(data.length).toBeGreaterThan(10000)
    await fileDownload.saveAs(testInfo.outputPath('report.pdf'))
    await chooseExport(page, 'Plot book HTML')
    const bookDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download Plot book HTML', exact: true }).click()
    const book = (await bytes(await bookDownload)).toString('utf8')
    expect(book.includes('data-brand-logo')).toBe(true)
    expect(book.includes(name)).toBe(true)
    expect(book.includes('pgmaps-brand-snapshot')).toBe(true)
    await chooseExport(page, 'Plot book PDF')
    const plotDownloading = page.waitForEvent('download', { timeout: 90000 })
    await page.getByRole('button', { name: 'Download Plot book PDF', exact: true }).click()
    const plotDownload = await plotDownloading
    const plotBytes = await bytes(plotDownload)
    expect(plotBytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(plotBytes.length).toBeGreaterThan(10000)
    await plotDownload.saveAs(testInfo.outputPath('plot-book.pdf'))
    await page.goto('/help/ribbon.html?lesson=sketch-road&view=tour&interface=ribbon')
    await expect(page.getByRole('img', { name, exact: true })).toBeVisible()
    const lessonStage = page
      .frameLocator('iframe[title="Sketch a road · TourKit"]')
      .frameLocator('iframe')
      .frameLocator('iframe')
    await expect(lessonStage.locator('body > *').first()).toBeAttached({ timeout: 60000 })
    const downloadButton = page.getByRole('button', { name: 'Download offline lesson', exact: true })
    await expect(downloadButton).toBeVisible()
    const download = page.waitForEvent('download', { timeout: 60000 })
    await downloadButton.click()
    const html = (await bytes(await download)).toString('utf8')
    expect(html).toContain('pgmaps-brand-snapshot')
    expect(html).toContain('GUST')
    expect(html).toContain('data:font/otf;base64,')
    expect(html).not.toMatch(/\bZod(?:Type|Error)\b/)
    // The serialized copy itself contains the chosen artwork, not a link back to its ZIP.
    expect(html).toContain(name)
    expect(readFileSync(file!).byteLength).toBeGreaterThan(0)
  })
}
