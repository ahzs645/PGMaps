import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Page, type Browser, type TestInfo } from '@playwright/test'
import { analyzeRoad } from '../../src/pages/dev-forestry-roads/engine'
import { terrainFromMetadata } from '../../src/pages/dev-forestry-roads/terrain'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

const baselinePath = process.env.PGMAPS_ROAD_OPTIONS_PROJECT
test.skip(!baselinePath, 'Supply an exported horizontal baseline project for the opt-in mobile options comparison.')
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  serviceWorkers: 'block',
  actionTimeout: 15000,
})
test.setTimeout(240000)

async function save(page: Page, path?: string, name?: string): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).tap()
  if (name) await page.getByLabel('Project name', { exact: true }).fill(name)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).tap()
  const download = await pending
  if (path) await download.saveAs(path)
  const chunks: Buffer[] = [],
    stream = await download.createReadStream()
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .tap()
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function open(page: Page, path: string) {
  await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeEnabled()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).tap()
  await (await chooser).setFiles(path)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
}

async function design(page: Page) {
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await expect(page.getByTestId('road-workspace')).toHaveAttribute('data-focus-mode', 'true')
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await show.tap()
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Design', exact: true })
    .tap()
}

async function compareOptions(page: Page, browser: Browser, info: TestInfo, inputPath: string) {
  const errors: string[] = [],
    records: Array<Record<string, unknown>> = []
  let complete = false
  page.on('pageerror', (error) => errors.push(error.message))
  const baseline = JSON.parse(await readFile(inputPath, 'utf8')) as RoadProject
  const baseRoad = baseline.alignments.find((a) => a.id === baseline.activeAlignmentId)!
  const source = terrainFromMetadata(baseline.terrain)!
  expect(source).toBeTruthy()
  expect(baseRoad.vertical).toHaveLength(0)
  const search = { k: 4, pviSpacingM: 50, maxDepthM: 5, levelStepM: 0.5, tieEndsToGround: true }
  const initial = analyzeRoad(baseRoad, source, baseline.settings, baseline.context)
  try {
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
    )
    await page.goto('/dev/forestry/road-design?example=training')
    await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')

    for (const [objective, label] of [
      ['earthwork', 'Cut and fill'],
      ['total', 'Total cost incl. haul, borrow, waste'],
    ] as const) {
      // This is the actual downloaded baseline, opened through the file picker before EACH option.
      await open(page, inputPath)
      await design(page)
      await expect(page.getByLabel('Active road', { exact: true })).toHaveValue(baseline.activeAlignmentId)
      expect(await save(page)).toEqual(baseline)
      for (const [name, value] of [
        ['Curve K', '4'],
        ['PVI spacing (m)', '50'],
        ['Search ± (m)', '5'],
        ['Level step (m)', '.5'],
      ]) {
        const input = page.getByRole('spinbutton', { name, exact: true })
        await input.fill(value)
        await input.press('Tab')
      }
      await page.getByRole('checkbox', { name: 'Tie both ends to ground', exact: true }).check()
      await page.getByRole('combobox', { name: 'Profile optimization objective', exact: true }).selectOption(objective)
      await expect(page.getByRole('combobox', { name: 'Profile optimization objective', exact: true })).toHaveValue(
        objective,
      )
      const before = await save(page)
      expect(before).toEqual(baseline)
      await page.screenshot({ path: info.outputPath(`${objective}-settings.png`) })
      await page.getByRole('button', { name: 'Optimize profile (K 4)', exact: true }).tap()
      const failure = page.getByTestId('workspace-toast-error')
      await expect
        .poll(async () => await page.getByLabel('Road name', { exact: true }).inputValue(), { timeout: 60000 })
        .toMatch(/optimized profile$/)
      expect(await failure.isVisible()).toBe(false)
      await page
        .getByLabel('Road name', { exact: true })
        .fill(`Vernon · ${objective === 'earthwork' ? 'Cut and fill' : 'Total cost'} profile`)
      const path = info.outputPath(`${objective}.road.json`)
      const project = await save(page, path)
      const road = project.alignments.find((a) => a.id === project.activeAlignmentId)!
      expect(project.alignments).toHaveLength(baseline.alignments.length + 1)
      expect(project.alignments.find((a) => a.id === baseRoad.id)).toEqual(baseRoad)
      expect(project.settings).toEqual(baseline.settings)
      expect(project.terrain).toEqual(baseline.terrain)
      expect(road.points.map((p) => p.coordinate)).toEqual(baseRoad.points.map((p) => p.coordinate))
      const analysis = analyzeRoad(road, source, project.settings, project.context)
      expect(analysis.coveragePercent).toBeGreaterThan(99.99999)
      expect(analysis.maxGradePercent).toBeLessThanOrEqual(project.settings.maxGradePercent + 1e-6)
      expect(analysis.verticalChecks ?? []).toEqual([])
      expect(road.vertical.length).toBeGreaterThanOrEqual(2)

      const costs = analysis.engineering?.costs ?? {
        cut: analysis.cutVolumeM3 * project.settings.cutRate,
        fill: analysis.fillVolumeM3 * project.settings.fillRate,
        surfacing: analysis.surfaceVolumeM3 * project.settings.surfacingRate,
        clearing: analysis.clearingAreaM2 * project.settings.clearingRate,
        stripping: 0,
        structures: 0,
        haul: 0,
        borrow: 0,
        waste: 0,
        sitePreparation: 0,
        mobilization: 0,
        contingency: 0,
        total: analysis.estimatedCost,
      }
      const earthworkCost = costs.cut + costs.fill
      const engineeringInputs = {
        supplied: !!road.engineering,
        materials: road.engineering?.materials ?? [],
        haul: road.engineering?.haul ?? null,
        caveat: !road.engineering?.haul?.enabled
          ? 'No enabled haul allocation, borrow/waste scenario or supplied material horizons on this baseline. Modeled zero haul/borrow/waste lines mean not supplied, not free real operations. Rates are generic project placeholders. This checks the option mechanics, not economic realism.'
          : 'Hypothetical generic haul rates and fictional sites, not field-calibrated data. No material geology has been supplied. This is an illustrative scenario, not a road-cost quote.',
      }
      await page.getByRole('button', { name: 'Hide road controls', exact: true }).tap()
      await page
        .getByRole('tablist', { name: 'Visible road pane', exact: true })
        .getByRole('tab', { name: 'Profile', exact: true })
        .tap()
      await expect(page.getByTestId('road-profile-chart')).toBeVisible()
      await page.screenshot({ path: info.outputPath(`${objective}-profile.png`) })
      await page.getByRole('button', { name: 'Show how the covered estimate is calculated', exact: true }).tap()
      const costDialog = page.getByRole('dialog').filter({ hasText: 'Covered estimate' })
      await expect(costDialog).toBeVisible()
      const uiCostBreakdown = await costDialog.innerText()
      if (!road.engineering) await expect(costDialog).toContainText('once Engineering inputs are added')
      else if (!road.engineering.haul.enabled) await expect(costDialog).toContainText('Haul allocation is off')
      await page.screenshot({ path: info.outputPath(`${objective}-cost.png`) })
      await costDialog.getByRole('button', { name: 'Close', exact: true }).tap()

      const fresh = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: 'block',
      })
      try {
        const reopened = await fresh.newPage()
        reopened.on('pageerror', (error) => errors.push(error.message))
        await reopened.route('https://**', (route) =>
          route.request().url().startsWith('https://basemaps.cartocdn.com/')
            ? route.fulfill({ json: { version: 8, sources: {}, layers: [] } })
            : route.abort(),
        )
        await reopened.goto(new URL('/dev/forestry/road-design?example=training', page.url()).href)
        await open(reopened, path)
        await design(reopened)
        await expect(reopened.getByLabel('Active road', { exact: true })).toHaveValue(project.activeAlignmentId)
        const restored = await save(reopened)
        expect(restored).toEqual(project)
        const restoredRoad = restored.alignments.find((a) => a.id === restored.activeAlignmentId)!
        const restoredAnalysis = analyzeRoad(
          restoredRoad,
          terrainFromMetadata(restored.terrain)!,
          restored.settings,
          restored.context,
        )
        expect(restoredAnalysis).toEqual(analysis)
      } finally {
        await fresh.close()
      }

      records.push({
        objective,
        label,
        search,
        baselineActiveId: baseline.activeAlignmentId,
        sourceSha256: project.terrain.sha256,
        lengthM: analysis.length,
        cutM3: analysis.cutVolumeM3,
        fillM3: analysis.fillVolumeM3,
        coveragePercent: analysis.coveragePercent,
        maxDesignGradePercent: analysis.maxGradePercent,
        pvis: road.vertical,
        earthworkCost,
        modeledTotalCost: analysis.estimatedCost,
        costBreakdown: costs,
        engineeringInputs,
        warnings: analysis.warnings,
        uiCostBreakdown,
        freshBrowserReopen: 'exact project, settings, geometry, embedded DEM and recomputed analysis retained',
        haulComplete: analysis.engineering?.haul.complete ?? null,
        modeledHaul: analysis.engineering?.haul ?? null,
        runInputPersistence:
          'Objective and search values were set in the UI and recorded here; the project stores the resulting geometry rather than a search-history record.',
      })
    }
    complete = true
    expect(errors).toEqual([])
  } catch (cause) {
    records.push({ status: 'blocked', error: cause instanceof Error ? cause.message : String(cause) })
    throw cause
  } finally {
    await writeFile(
      info.outputPath('mobile-vertical-options.json'),
      JSON.stringify(
        {
          complete,
          baselinePath: inputPath,
          baseline: {
            activeId: baseline.activeAlignmentId,
            settings: baseline.settings,
            originalCutM3: initial.cutVolumeM3,
            originalFillM3: initial.fillVolumeM3,
            originalModeledCost: initial.estimatedCost,
          },
          records,
          errors,
        },
        null,
        2,
      ),
    )
  }
}

test('mobile profile options compare Cut and fill versus Total cost from the identical exported horizontal baseline', async ({
  page,
  browser,
}, info) => {
  await compareOptions(page, browser, info, baselinePath!)
})

test('mobile profile options include a separately entered hypothetical haul and two-site scenario', async ({
  page,
  browser,
}, info) => {
  const setupErrors: string[] = []
  page.on('pageerror', (error) => setupErrors.push(error.message))
  const baseline = JSON.parse(await readFile(baselinePath!, 'utf8')) as RoadProject
  const road = baseline.alignments.find((a) => a.id === baseline.activeAlignmentId)!
  const length = analyzeRoad(road, terrainFromMetadata(baseline.terrain)!, baseline.settings, baseline.context).length
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await open(page, baselinePath!)
  await design(page)
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Engineering', exact: true })
    .tap()
  await page
    .getByRole('tablist', { name: 'Engineering inputs', exact: true })
    .getByRole('tab', { name: 'Haul', exact: true })
    .tap()
  await page.getByRole('checkbox', { name: 'Calculate material haul allocations', exact: true }).tap()
  const dialog = page.getByRole('dialog', { name: 'Haul & cost settings', exact: true })
  await expect(dialog).toBeVisible()
  const rates: Array<[string, string]> = [
    ['Free-haul distance (m)', '50'],
    ['Overhaul distance limit (m)', '300'],
    ['Free haul ($/m³·km)', '0'],
    ['Overhaul ($/m³·km)', '6'],
    ['End haul ($/m³·km)', '4'],
    ['Free-haul loading ($/m³)', '0'],
    ['Overhaul loading ($/m³)', '.6'],
    ['End-haul loading ($/m³)', '2.6'],
    ['Default borrow ($/compacted m³)', '80'],
    ['Default waste ($/bank m³)', '20'],
    ['Mobilization ($)', '1000'],
    ['Contingency (%)', '10'],
  ]
  for (const [name, value] of rates) {
    const input = dialog.getByRole('spinbutton', { name, exact: true })
    await input.fill(value)
    await input.press('Tab')
  }
  for (const [index, kind, chainage, rate] of [
    [1, 'Borrow', 0, 80],
    [2, 'Waste', length, 20],
  ] as const) {
    await dialog.getByRole('button', { name: `+ ${kind}`, exact: true }).tap()
    await dialog
      .getByLabel('Haul site name', { exact: true })
      .nth(index - 1)
      .fill(`Hypothetical ${kind.toLowerCase()} site`)
    for (const [name, value] of [
      [`Site ${index} station (m)`, String(chainage)],
      [`Site ${index} access distance (m)`, '1000'],
      [`Site ${index} unit rate ($/${kind === 'Borrow' ? 'compacted' : 'bank'} m³)`, String(rate)],
      [`Site ${index} fixed cost ($)`, '500'],
    ]) {
      const input = dialog.getByRole('spinbutton', { name, exact: true })
      await input.fill(value)
      await input.press('Tab')
    }
    await dialog
      .getByRole('checkbox', { name: 'Unbounded scenario capacity', exact: true })
      .nth(index - 1)
      .tap()
    const capacity = dialog.getByRole('spinbutton', {
      name: `Site ${index} capacity (${kind === 'Borrow' ? 'compacted' : 'bank'} m³)`,
      exact: true,
    })
    await capacity.fill('10000')
    await capacity.press('Tab')
  }
  await page.screenshot({ path: info.outputPath('hypothetical-haul-settings.png') })
  await dialog.getByRole('button', { name: 'Done', exact: true }).tap()
  const scenarioPath = info.outputPath('hypothetical-baseline.road.json')
  const scenario = await save(page, scenarioPath, 'Vernon · hypothetical haul option comparison')
  const scenarioRoad = scenario.alignments.find((a) => a.id === scenario.activeAlignmentId)!
  expect(scenarioRoad.points).toEqual(road.points)
  expect(scenarioRoad.vertical).toEqual(road.vertical)
  expect(scenario.settings).toEqual(baseline.settings)
  expect(scenarioRoad.engineering?.haul.enabled).toBe(true)
  expect(scenarioRoad.engineering?.sites).toHaveLength(2)
  expect(scenarioRoad.engineering?.sites[1].chainage).toBeCloseTo(length, 6)
  await writeFile(
    info.outputPath('hypothetical-inputs.json'),
    JSON.stringify(
      {
        caveat:
          'All rates, site chainages, access distances and capacities are invented demonstration assumptions. They do not represent actual sites or surveyed costs.',
        engineering: scenarioRoad.engineering,
        roadSettings: scenario.settings,
      },
      null,
      2,
    ),
  )
  await compareOptions(page, browser, info, scenarioPath)
  const report = JSON.parse(await readFile(info.outputPath('mobile-vertical-options.json'), 'utf8'))
  const earthwork = report.records.find((record: { objective: string }) => record.objective === 'earthwork')
  const total = report.records.find((record: { objective: string }) => record.objective === 'total')
  expect(total.modeledTotalCost).toBeLessThan(earthwork.modeledTotalCost)
  expect(total.haulComplete).toBe(true)
  expect(earthwork.haulComplete).toBe(true)
  expect(setupErrors).toEqual([])
})
