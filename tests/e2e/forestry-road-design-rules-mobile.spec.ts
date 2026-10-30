import { expect, test, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { expandRoadSection } from './road-sidebar'

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
  actionTimeout: 15000,
})
test.setTimeout(120000)
async function workflow(page: Page, name: string) {
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await show.tap()
  await page.getByRole('tablist', { name: 'Road workflow', exact: true }).getByRole('tab', { name, exact: true }).tap()
}
async function fill(page: Page, name: string, value: string) {
  const field = page.getByLabel(name, { exact: true })
  await field.fill(value)
  await field.press('Tab')
}
async function save(page: Page): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).tap()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).tap()
  const download = await pending,
    chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .tap()
  return JSON.parse(Buffer.concat(chunks).toString())
}

for (const size of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`road criteria, crossing classes and curvature inputs work on touch ${size.width}×${size.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(size)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
    )
    await page.goto('/dev/forestry/road-design?example=training')
    await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
    await workflow(page, 'Section')
    await fill(page, 'Design speed (km/h)', '20')
    await fill(page, 'Road criteria name', 'Mobile design criteria')
    await fill(page, 'Road criteria source', 'Entered training worksheet, October 2026')
    await fill(page, 'Extra outside widening (m)', '0.3')
    await page.getByText('Widening table · 0 entries', { exact: true }).tap()
    await page.getByLabel('Curve widening table CSV', { exact: true }).fill('50,90,1,0.25')
    await page.getByRole('button', { name: 'Apply widening table', exact: true }).tap()
    await expect(page.getByText('Widening table · 1 entries', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('curve-criteria.png') })
    await workflow(page, 'Design')
    await fill(page, 'New crossing class', 'major')
    await fill(page, 'Class crossing cost ($)', '12000')
    await page.getByRole('button', { name: 'Save crossing class', exact: true }).tap()
    const classes = page.locator('input[aria-label$=" crossing class"]').filter({ visible: true })
    expect(await classes.count()).toBeGreaterThan(0)
    await classes.first().fill('major')
    await classes.first().press('Tab')
    await expandRoadSection(page, 'road-vertical-standards')
    await page.getByRole('button', { name: 'Curvature range', exact: true }).tap()
    await fill(page, 'Range sag K', '7')
    await fill(page, 'Range crest K', '4')
    await page.getByLabel('Profile search band centre', { exact: true }).selectOption('design')
    await expect(page.getByRole('button', { name: 'Refine plan and profile', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('vertical-criteria.png') })
    const project = await save(page),
      road = project.alignments.find((a) => a.id === project.activeAlignmentId)!
    expect(road.curveDesign).toMatchObject({
      criteriaName: 'Mobile design criteria',
      criteriaSource: 'Entered training worksheet, October 2026',
      outsideWideningM: 0.3,
      wideningTable: [{ radiusM: 50, deflectionDegrees: 90, insideM: 1, outsideM: 0.25 }],
    })
    expect(road.verticalStandards?.curvatureRanges).toHaveLength(1)
    expect(road.verticalStandards!.curvatureRanges![0]).toMatchObject({ minSagK: 7, minCrestK: 4 })
    expect(project.routeSearch?.crossingGroups).toEqual({ major: 12000 })
    expect(project.context.some((f) => f.kind === 'stream' && f.crossingGroup === 'major')).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    expect(errors).toEqual([])
  })
}
