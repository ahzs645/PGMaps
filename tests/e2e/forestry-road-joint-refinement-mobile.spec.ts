import { expect, test, type Page } from '@playwright/test'
import { alignmentLength, analyzeRoad, offsetCoordinate } from '../../src/pages/dev-forestry-roads/engine'
import { parseProject } from '../../src/pages/dev-forestry-roads/project'
import { createDemoProject, demoTerrain, DEMO_ORIGIN } from '../../src/pages/dev-forestry-roads/terrain'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
  actionTimeout: 15_000,
})
test.setTimeout(180_000)

/** A short, feasible synthetic road with deliberately costly fill and a movable plan control. */
function fixture(): RoadProject {
  const project = createDemoProject()
  const road = project.alignments[0]
  road.id = 'phone-joint'
  road.name = 'Phone joint road'
  road.points = [
    { id: 'joint-start', coordinate: DEMO_ORIGIN, radiusM: 0 },
    {
      id: 'joint-middle',
      coordinate: offsetCoordinate(offsetCoordinate(DEMO_ORIGIN, 90, 50), 0, 5),
      radiusM: 20,
    },
    { id: 'joint-end', coordinate: offsetCoordinate(DEMO_ORIGIN, 90, 100), radiusM: 0 },
  ]
  road.overrides = []
  road.template = {
    leftWidth: 3,
    rightWidth: 3,
    crossfallPercent: 0,
    cutSlope: 1.5,
    fillSlope: 1.5,
    ditchWidth: 0,
    ditchDepth: 0,
    surfaceDepth: 0.15,
  }
  road.vertical = [
    {
      id: 'joint-level-start',
      chainage: 0,
      elevation: demoTerrain.elevationAt(...road.points[0].coordinate) + 3,
      curveLength: 0,
    },
    {
      id: 'joint-level-end',
      chainage: alignmentLength(road),
      elevation: demoTerrain.elevationAt(...road.points.at(-1)!.coordinate) + 3,
      curveLength: 0,
    },
  ]
  project.name = 'Joint refinement · synthetic mobile test'
  project.alignments = [road]
  project.activeAlignmentId = road.id
  project.context = []
  project.cables = []
  delete project.profiles
  project.settings = { ...project.settings, minRadius: 10, stationInterval: 10, crossSectionHalfWidth: 35 }
  return parseProject(project)
}

async function designControls(page: Page) {
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await show.tap()
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Design', exact: true })
    .tap()
}

async function numberField(page: Page, name: string, value: string) {
  const field = page.getByLabel(name, { exact: true })
  await field.fill(value)
  await field.press('Tab')
}

async function save(page: Page): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).tap()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).tap()
  const stream = await (await pending).createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .tap()
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function open(page: Page, project: RoadProject, name: string) {
  await page.getByRole('button', { name: 'Open', exact: true }).tap()
  await page.getByTestId('road-file-input').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await expect(page.getByTestId('road-workspace-header').getByRole('status', { includeHidden: true })).toContainText(
    `Opened ${name}.`,
  )
}

test('touch joint refinement adopts a cheaper editable road, retains the original and reopens at 320 px', async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await open(page, fixture(), 'phone-joint.road.json')
  const before = await save(page)
  const original = before.alignments[0]
  const originalAnalysis = analyzeRoad(original, demoTerrain, before.settings)
  expect(originalAnalysis.coveragePercent).toBeGreaterThan(99.99999)
  await designControls(page)
  await numberField(page, 'Curve K', '1')
  await numberField(page, 'PVI spacing (m)', '50')
  await numberField(page, 'Search ± (m)', '1')
  await numberField(page, 'Level step (m)', '0.5')
  await page.getByLabel('Profile search band centre', { exact: true }).selectOption('ground')
  await numberField(page, 'Plan step (m)', '5')
  await numberField(page, 'Refinement rounds', '1')
  await page.getByLabel('Joint refinement objective', { exact: true }).selectOption('engineering')
  await page.getByRole('button', { name: 'Refine plan and profile', exact: true }).tap()
  await expect(page.getByTestId('road-workspace-header').getByRole('status', { includeHidden: true })).toContainText(
    /Plan\/profile refinement: .* engineering cost; 4 evaluated trials/,
    { timeout: 60_000 },
  )
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true }).locator('option')).toHaveCount(2)
  const after = await save(page)
  const refined = after.alignments.find((road) => road.id === after.activeAlignmentId)!
  expect(after.alignments.find((road) => road.id === original.id)).toEqual(original)
  expect(refined.id).not.toBe(original.id)
  expect(refined.name).toBe(`${original.name} · plan/profile refinement`)
  expect(refined.points[0].coordinate).toEqual(original.points[0].coordinate)
  expect(refined.points.at(-1)!.coordinate).toEqual(original.points.at(-1)!.coordinate)
  expect(refined.points[1].coordinate).not.toEqual(original.points[1].coordinate)
  expect(refined.vertical).not.toEqual(original.vertical)
  expect(refined.template).toEqual(original.template)
  expect(after.settings).toEqual(before.settings)
  const calculated = analyzeRoad(refined, demoTerrain, after.settings)
  expect(calculated.coveragePercent).toBeGreaterThan(99.99999)
  expect(calculated.maxGradePercent).toBeLessThanOrEqual(after.settings.maxGradePercent)
  expect(calculated.estimatedCost).toBeLessThan(originalAnalysis.estimatedCost)
  expect(calculated.verticalChecks ?? []).toEqual([])

  // Edit the actual adopted road, then verify the saved/reopened hierarchy, not just the success notice.
  const name = 'Phone-refined road · reviewed'
  await page.getByLabel('Road name', { exact: true }).fill(name)
  await page.getByLabel('Road name', { exact: true }).press('Tab')
  const edited = await save(page)
  expect(edited.alignments.find((road) => road.id === refined.id)?.name).toBe(name)
  expect(edited.alignments.find((road) => road.id === original.id)).toEqual(original)
  await page.setViewportSize({ width: 320, height: 568 })
  await open(page, edited, 'phone-refined-reopen.road.json')
  await designControls(page)
  await expect(page.getByLabel('Road name', { exact: true })).toHaveValue(name)
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true })).toHaveValue(refined.id)
  await page.getByRole('button', { name: 'Refine plan and profile', exact: true }).scrollIntoViewIfNeeded()
  expect(
    await page.evaluate(() => {
      const main = document.getElementById('main-content')!
      return [document.documentElement, main].every((element) => element.scrollWidth <= element.clientWidth + 1)
    }),
  ).toBe(true)
  await page.screenshot({ path: info.outputPath('joint-refinement-320.png'), animations: 'disabled', timeout: 60_000 })
  expect(await save(page)).toEqual(edited)
  expect(errors).toEqual([])
})
