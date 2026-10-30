import { expect, test, type Locator, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({ serviceWorkers: 'block', hasTouch: true, isMobile: true, actionTimeout: 15000 })
test.setTimeout(240000)

async function download(page: Page, control: Locator) {
  const pending = page.waitForEvent('download')
  await control.tap()
  const result = await pending
  const chunks: Buffer[] = []
  for await (const chunk of (await result.createReadStream())!) chunks.push(Buffer.from(chunk))
  return { text: Buffer.concat(chunks).toString('utf8'), name: result.suggestedFilename() }
}
async function closeFiles(page: Page) {
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .tap()
}
async function save(page: Page): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).tap()
  const file = await download(page, page.getByRole('button', { name: 'Save project JSON', exact: true }))
  await closeFiles(page)
  return JSON.parse(file.text) as RoadProject
}
async function showCompare(page: Page) {
  const hide = page.getByRole('button', { name: 'Hide road controls', exact: true })
  if (await hide.isVisible()) await hide.tap()
  await page
    .getByRole('tablist', { name: 'Visible road pane', exact: true })
    .getByRole('tab', { name: 'Detail', exact: true })
    .tap()
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).tap()
  await page.getByRole('option', { name: 'Compare', exact: true }).tap()
  await expect(page.getByTestId('road-vertical-alternatives')).toBeVisible()
}
async function showSidebar(page: Page, tab: 'Design' | 'Section') {
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await show.tap()
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: tab, exact: true })
    .tap()
}
async function choose(page: Page, control: Locator, label: string) {
  await control.tap()
  await page.getByRole('option', { name: label, exact: true }).tap()
}
async function fits(page: Page, selector: string) {
  const result = await page.locator(selector).evaluate((element) => {
    const host = element.getBoundingClientRect()
    const issues: string[] = []
    if (host.left < -1 || host.right > window.innerWidth + 1) issues.push('container outside viewport')
    for (const child of element.querySelectorAll('input, button[role="combobox"], fieldset')) {
      const r = child.getBoundingClientRect()
      if (r.width && r.height && (r.left < host.left - 1 || r.right > host.right + 1))
        issues.push(`${child.tagName} outside container`)
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) issues.push('document horizontal overflow')
    return issues
  })
  expect(result).toEqual([])
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 667, height: 375 },
]) {
  test(`named vertical profiles and authored reports work through touch controls at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
    )
    await page.goto('/dev/forestry/road-design?example=training')
    await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
    const initial = await save(page)
    const original = initial.alignments.find((a) => a.id === initial.activeAlignmentId)!

    await showCompare(page)
    const editor = page.getByTestId('road-vertical-alternatives')
    await editor.getByLabel('New profile name', { exact: true }).fill('Mobile raised profile')
    await editor.getByRole('button', { name: 'Add profile', exact: true }).tap()
    await expect(editor.getByRole('combobox', { name: 'Active vertical alternative', exact: true })).toContainText(
      'Mobile raised profile',
    )
    await choose(
      page,
      editor.getByRole('combobox', { name: 'Vertical alternative engineering mode', exact: true }),
      'Independent engineering per profile',
    )
    await fits(page, '[data-testid="road-vertical-alternatives"]')

    await showSidebar(page, 'Design')
    const level = page.getByRole('spinbutton', { name: 'PVI 1 level', exact: true })
    await level.fill(String(original.vertical[0].elevation + 1))
    await level.press('Tab')
    await showSidebar(page, 'Section')
    await page.getByRole('button', { name: 'Template library & station assignments', exact: true }).tap()
    await page
      .getByRole('tablist', { name: 'Engineering inputs', exact: true })
      .getByRole('tab', { name: 'Haul', exact: true })
      .tap()
    await page.getByRole('button', { name: 'Haul & cost settings', exact: true }).tap()
    const rate = page.getByRole('spinbutton', { name: 'Default borrow ($/compacted m³)', exact: true })
    await rate.fill('77')
    await rate.press('Tab')
    await page
      .getByRole('dialog', { name: 'Haul & cost settings', exact: true })
      .getByRole('button', { name: 'Done', exact: true })
      .tap()
    await showCompare(page)
    await choose(
      page,
      editor.getByRole('combobox', { name: 'Active vertical alternative', exact: true }),
      'Original profile',
    )
    const selectedOriginal = await save(page)
    const base = selectedOriginal.alignments.find((a) => a.id === selectedOriginal.activeAlignmentId)!
    expect(base.points).toEqual(original.points)
    expect(base.vertical).toEqual(original.vertical)
    expect(base.engineering?.haul.borrowRate).toBe(original.engineering?.haul.borrowRate)
    expect(base.verticalAlternatives).toHaveLength(2)

    await choose(
      page,
      editor.getByRole('combobox', { name: 'Active vertical alternative', exact: true }),
      'Mobile raised profile',
    )
    const selectedRaised = await save(page)
    const raised = selectedRaised.alignments.find((a) => a.id === selectedRaised.activeAlignmentId)!
    expect(raised.vertical[0].elevation).toBeCloseTo(original.vertical[0].elevation + 1, 8)
    expect(raised.engineering?.haul.borrowRate).toBe(77)
    await expect(editor.getByRole('img', { name: 'Vertical alternatives profile overlay', exact: true })).toBeVisible()
    await choose(
      page,
      editor.getByRole('combobox', { name: 'Vertical alternative engineering mode', exact: true }),
      'Shared materials, haul and structures',
    )
    const shared = await save(page)
    const sharedRoad = shared.alignments.find((a) => a.id === shared.activeAlignmentId)!
    expect(sharedRoad.verticalAlternativeCostMode).toBe('shared')
    expect(sharedRoad.verticalAlternatives!.every((v) => v.engineering === undefined)).toBe(true)

    await page.getByRole('button', { name: 'Save', exact: true }).tap()
    const dialog = page.getByRole('dialog', { name: 'Save & export', exact: true })
    await dialog.getByRole('button', { name: 'Configure plot book', exact: true }).tap()
    const reports = page.getByTestId('road-report-settings')
    await choose(page, reports.getByRole('combobox', { name: 'Report paper size', exact: true }), 'A4 landscape')
    await reports.getByLabel('Station label expression', { exact: true }).fill('{road} @ {station}')
    await choose(
      page,
      reports.getByRole('combobox', { name: 'New report chapter type', exact: true }),
      'Station schedule',
    )
    await reports.getByRole('button', { name: 'Add chapter', exact: true }).tap()
    await reports.getByLabel('Chapter title', { exact: true }).fill('Mobile station schedule')
    await reports.getByRole('spinbutton', { name: 'Report station interval (m)', exact: true }).fill('50')
    await reports.getByRole('spinbutton', { name: 'Report station interval (m)', exact: true }).press('Tab')
    await fits(page, '[data-testid="road-files-dialog"]')
    await page.screenshot({ path: info.outputPath(`authored-report-${viewport.width}x${viewport.height}.png`), animations: 'disabled', timeout: 60000 })
    const book = await download(page, dialog.getByRole('button', { name: 'Plot book (A4)', exact: true }))
    expect(book.text).toContain('@page{size:A4 landscape')
    expect(book.text).toContain('Mobile station schedule')
    expect(book.text).toContain(' @ 0+000')
    expect(book.text).not.toContain('NaN')
    const projectFile = await download(page, dialog.getByRole('button', { name: 'Save project JSON', exact: true }))
    await closeFiles(page)
    const exported = JSON.parse(projectFile.text) as RoadProject
    expect(exported.reportSettings!.paper).toBe('A4')
    expect(exported.reportSettings!.chapters).toHaveLength(3)

    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Open', exact: true }).tap()
    await (
      await chooser
    ).setFiles({ name: projectFile.name, mimeType: 'application/json', buffer: Buffer.from(projectFile.text) })
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    const reopened = await save(page)
    expect(reopened.reportSettings).toEqual(exported.reportSettings)
    expect(reopened.alignments.find((a) => a.id === reopened.activeAlignmentId)!.verticalAlternatives).toEqual(
      exported.alignments.find((a) => a.id === exported.activeAlignmentId)!.verticalAlternatives,
    )
    expect(errors).toEqual([])
  })
}
