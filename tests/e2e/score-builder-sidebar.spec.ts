import { expect, test, type Page } from '@playwright/test'
import {
  SCORE_BUILDER_EXAMPLES,
  SCORE_METRICS,
  SCORE_PRESETS,
  getScoreDataSourcesForWeights,
} from '../../src/maps/scorebuilder/constants'
import { getActivePresetKey, presetAppliesToBoundary } from '../../src/maps/scorebuilder/lib/presets'
import { metricToDataSource } from '../../src/maps/scorebuilder/lib/metrics'
import type { ScoreDataSource } from '../../src/maps/scorebuilder/types'

const boundaryMatrix = {
  census: [
    // Prince George extracts — the province-wide bc-da-simplified set froze the pipeline.
    { level: 'cd', label: 'Census Division', count: 1 },
    { level: 'csd', label: 'Census Subdivision', count: 1 },
    { level: 'ct', label: 'Census Tract', count: 23 },
    { level: 'da', label: 'Dissemination Area', count: 135 },
    { level: 'db', label: 'Dissemination Block', count: 1011 },
  ],
  bcHealth: [
    { level: 'healthAuthority', label: 'Health Authority', count: 5 },
    { level: 'hsda', label: 'HSDA', count: 16 },
    { level: 'lha', label: 'LHA', count: 89 },
    { level: 'chsa', label: 'CHSA', count: 229 },
  ],
  cityPG: [
    { level: 'elementarySchoolCatchment', label: 'Elementary School Catchment', count: 20 },
    { level: 'secondarySchoolCatchment', label: 'Secondary School Catchment', count: 5 },
  ],
  nrAdmin: [
    { level: 'nrArea', label: 'NR Area', count: 3 },
    { level: 'nrRegion', label: 'NR Region', count: 8 },
    { level: 'nrDistrict', label: 'NR District', count: 23 },
  ],
} as const

/** Presets live on the Presets tab of the unified Recipes dialog. */
async function openRecipesTab(page: Page, tab: 'Examples' | 'Presets' | 'Projects' | 'My indexes') {
  await page.getByRole('button', { name: 'Browse recipes' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Recipes' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: tab }).click()
  return dialog
}

async function applyPresetFromDialog(page: Page, presetName: string) {
  const dialog = await openRecipesTab(page, 'Presets')
  await dialog.getByRole('button', { name: presetName }).click()
  await expect(page.getByRole('dialog', { name: 'Recipes' })).toHaveCount(0)
}

/** Opens the in-place weight editor for an equation-bar chip. */
async function openChipEditor(page: Page, metricKey: string) {
  await page.locator(`[data-score-builder-term-label="${metricKey}"]`).click()
  await expect(page.locator(`[data-score-builder-weight-popover="${metricKey}"]`)).toBeVisible()
}

function dataSourceButton(page: Page, label: string) {
  return page.locator(
    `button[aria-label^="${label}"][aria-label$="ON"], button[aria-label^="${label}"][aria-label$="OFF"]`,
  )
}

function requiredSourcesForWeights(weights: Record<string, number>): ScoreDataSource[] {
  const sources = new Set<ScoreDataSource>()
  SCORE_METRICS.forEach((metric) => {
    if (!weights[metric.key]) return
    const source = metricToDataSource(metric.category)
    if (source) sources.add(source)
    if (metric.key === 'crimePerCapita') sources.add('census')
  })
  return [...sources]
}

function levelSelectTrigger(page: Page) {
  return page.locator('[data-score-builder-level-select="true"]').getByRole('combobox')
}

async function expectLevelOptions(page: Page, labels: string[]) {
  await levelSelectTrigger(page).click()
  await expect(page.getByRole('option')).toHaveText(labels)
  await page.keyboard.press('Escape')
}

async function selectLevel(page: Page, label: string) {
  await levelSelectTrigger(page).click()
  await page.getByRole('option', { name: label }).click()
}

async function chooseBoundarySource(page: Page, source: string) {
  const studyArea = page.locator('[data-score-builder-left-panel="true"]')
  await studyArea.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator(`[data-score-builder-boundary-source="${source}"]`).click()
}

/** Loading a URL with weights collapses both side panels; reopen them so controls are reachable. */
async function openPanels(page: Page) {
  for (const name of ['Show sidebar', 'Show right sidebar']) {
    const button = page.getByRole('button', { name }).first()
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => {})
    }
  }
}

/** Density and Correlate are map-lens toggles in the Index Lab header, not standalone right-panel tabs. */
async function setMapLens(page: Page, lens: 'Score' | 'Density' | 'Correlate') {
  await page.getByRole('group', { name: 'Map lens' }).getByRole('button', { name: lens }).click()
}

test.describe('Score Builder preset model', () => {
  test('presets have coherent metadata, source derivation, and active matching', () => {
    const metricKeys = new Set(SCORE_METRICS.map((metric) => metric.key))

    for (const preset of SCORE_PRESETS) {
      expect(preset.key, 'preset key').toBeTruthy()
      expect(preset.label, `label for ${preset.key}`).toBeTruthy()
      expect(preset.description, `description for ${preset.key}`).toBeTruthy()

      const activeKeys = Object.entries(preset.weights).filter(([, weight]) => weight !== 0)
      expect(activeKeys.length, `${preset.key} has active weights`).toBeGreaterThan(0)
      for (const [key, weight] of activeKeys) {
        expect(metricKeys.has(key as keyof typeof preset.weights), `${preset.key} metric ${key}`).toBe(true)
        expect(Math.abs(weight), `${preset.key} metric ${key} weight`).toBeLessThanOrEqual(100)
      }

      const derivedSources = getScoreDataSourcesForWeights(preset.weights)
      const requiredSources = requiredSourcesForWeights(preset.weights)
      expect(new Set(derivedSources), `${preset.key} sources`).toEqual(new Set(requiredSources))
      expect(derivedSources.length, `${preset.key} source count`).toBe(requiredSources.length)

      const activeBoundarySource =
        preset.recommendedBoundarySource || (presetAppliesToBoundary(preset, 'census') ? 'census' : 'bcHealth')
      expect(getActivePresetKey(preset.weights, derivedSources, activeBoundarySource), `${preset.key} active key`).toBe(
        preset.key,
      )

      if (preset.recommendedBoundaryLevel) {
        expect(preset.recommendedBoundarySource, `${preset.key} level needs source`).toBeTruthy()
      }
    }
  })

  test('examples enable every source required by active weights', () => {
    const violations: string[] = []
    for (const example of SCORE_BUILDER_EXAMPLES) {
      const requiredSources = requiredSourcesForWeights(example.weights)
      for (const source of requiredSources) {
        if (!example.dataSources.includes(source)) {
          violations.push(`${example.key} is missing required source "${source}"`)
        }
      }
    }
    expect(violations, `Examples with weights whose data source is not enabled:\n${violations.join('\n')}`).toEqual([])
  })
})

test.describe('Score Builder desktop interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/score-builder', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-score-builder-left-panel="true"]')).toBeVisible()
    await expect(page.locator('[data-score-builder-right-panel="true"]')).toBeVisible()
    await expect(page.locator('[data-score-builder-results-preview="true"]')).toBeVisible({ timeout: 20_000 })
  })

  test('default example applies matching data sources and live results', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Parks & Trails/i })).toContainText('ON')
    await expect(page.getByRole('button', { name: /Demographics/i })).toContainText('ON')
    await expect(page.getByRole('button', { name: /Air Quality/i })).toContainText('OFF')

    // The recipe title lives in the shared Index Lab header; the preview card holds the equation.
    await expect(page.locator('[data-index-lab-header="true"]')).toContainText('Greenest Neighbourhoods')
    const preview = page.locator('[data-score-builder-results-preview="true"]')
    await expect(preview).toContainText('Score=')
    await expect(preview).not.toContainText('|weights|')
    await expect(page.locator('[data-score-builder-equation-term]')).toHaveCount(5)

    await preview.getByRole('button', { name: 'Hide equation' }).click()
    await expect(page.locator('[data-score-builder-equation-term]')).toHaveCount(0)
    await expect(preview.getByRole('button', { name: 'Show equation' })).toBeVisible()

    await preview.getByRole('button', { name: 'Show equation' }).click()
    await expect(page.locator('[data-score-builder-equation-term]')).toHaveCount(5)
  })

  test('clicking an example card immediately applies it to the builder', async ({ page }) => {
    // Examples live on the Examples tab of the Recipes dialog.
    const dialog = await openRecipesTab(page, 'Examples')
    await dialog.getByRole('button', { name: /Air Monitoring Gaps \(Tract\)/ }).click()
    await expect(page.getByRole('dialog', { name: 'Recipes' })).toHaveCount(0)

    await expect(page.locator('[data-index-lab-header="true"]').first()).toContainText(
      'Air Monitoring Gaps (Tract)',
    )
    await expect(dataSourceButton(page, 'Air Quality')).toContainText('ON')
    await expect(dataSourceButton(page, 'Parks & Trails')).toContainText('OFF')
    await expect(dataSourceButton(page, 'Demographics')).toContainText('ON')
    await expect(levelSelectTrigger(page)).toContainText('Census Tract')

    // Equation-term chips live in the always-visible top equation bar.
    await expect(page.locator('[data-score-builder-equation-term="overallDensity"]')).toBeVisible()
    await expect(page.locator('[data-score-builder-equation-term="populationDensity"]')).toBeVisible()
  })

  test('boundary levels stay focused and keep region scores available', async ({ page }) => {
    const levelTrigger = levelSelectTrigger(page)
    const regionStats = page.locator('[data-score-builder-region-stats="true"]')
    const loadingMessage = page.getByText('Building region scores...')
    const errorMessage = page.getByText('Unable to build scores')

    await page.locator('[data-score-builder-tab="regions"]').click()
    // Cold start lands on the 31 CityPG community polygons.
    await expect(regionStats).toContainText('31 of 31 regions', { timeout: 20_000 })

    await chooseBoundarySource(page, 'census')
    await expect(regionStats).toContainText('23 of 23 regions', { timeout: 20_000 })
    await expectLevelOptions(page, ['Census Division', 'Census Subdivision', 'Census Tract', 'Dissemination Area', 'Dissemination Block'])

    await selectLevel(page, 'Dissemination Area')
    await expect(levelTrigger).toContainText('Dissemination Area')
    await expect(loadingMessage).toBeHidden({ timeout: 30_000 })
    await expect(errorMessage).toHaveCount(0)
    await expect(regionStats).toContainText('135 of 135 regions')

    await chooseBoundarySource(page, 'bcHealth')
    await expectLevelOptions(page, ['Health Authority', 'HSDA', 'LHA', 'CHSA'])
    await expect(levelTrigger).toContainText('CHSA')
    await expect(loadingMessage).toBeHidden({ timeout: 30_000 })
    await expect(errorMessage).toHaveCount(0)
    await expect(regionStats).toContainText('229 of 229 regions')
  })

  test('all boundary levels update options, URL state, and region counts', async ({ page }) => {
    test.slow() // Iterates every boundary level with a data load + region-count wait apiece.
    const levelTrigger = levelSelectTrigger(page)
    const regionStats = page.locator('[data-score-builder-region-stats="true"]')
    const loadingMessage = page.getByText('Building region scores...')
    const errorMessage = page.getByText('Unable to build scores')

    await page.locator('[data-score-builder-tab="regions"]').click()

    for (const [source, levels] of Object.entries(boundaryMatrix)) {
      await chooseBoundarySource(page, source)
      await expectLevelOptions(page, levels.map((entry) => entry.label))

      for (const entry of levels) {
        await selectLevel(page, entry.label)
        await expect(levelTrigger).toContainText(entry.label)
        await expect(loadingMessage).toBeHidden({ timeout: 30_000 })
        await expect(errorMessage).toHaveCount(0)
        const formattedCount = entry.count.toLocaleString()
        await expect(regionStats).toContainText(`${formattedCount} of ${formattedCount} regions`, { timeout: 30_000 })
        await expect(page).toHaveURL(new RegExp(`src=${source}.*level=${entry.level}`))
      }
    }
  })

  test('unsupported boundary URL params fall back to focused builder levels', async ({ page }) => {
    await page.goto(
      '/score-builder?src=bcHealth&level=csd&w=0%2C0%2C0%2C0%2C0%2C0%2C0%2C22%2C28%2C20%2C15%2C0%2C0%2C0%2C0%2C15%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0&ds=parks%2Ccensus',
      {
        waitUntil: 'domcontentloaded',
      },
    )
    await expect(page.locator('[data-score-builder-results-preview="true"]')).toBeVisible({ timeout: 20_000 })
    await openPanels(page)

    const regionStats = page.locator('[data-score-builder-region-stats="true"]')
    const errorMessage = page.getByText('Unable to build scores')

    await page.locator('[data-score-builder-tab="regions"]').click()
    await expect(levelSelectTrigger(page)).toContainText('CHSA')
    await expect(errorMessage).toHaveCount(0)
    await expect(regionStats).toContainText('229 of 229 regions', { timeout: 30_000 })
    await expect(page).toHaveURL(/src=bcHealth.*level=chsa/)
  })

  test('right panel follows the map lens between density and regions', async ({ page }) => {
    await expect(page.locator('[data-score-builder-section="regions"]')).toBeVisible()

    // Density is a map lens; enabling it surfaces the density panel.
    await setMapLens(page, 'Density')
    await expect(page.locator('[data-score-builder-section="density"]')).toBeVisible()
    await expect(page.getByLabel('Density metric')).toBeVisible()
    await expect(page.locator('[data-score-builder-build-density-score="true"]')).toBeVisible()

    await setMapLens(page, 'Score')
    await page.locator('[data-score-builder-tab="regions"]').click()
    await expect(page.locator('[data-score-builder-section="regions"]')).toBeVisible()
    await expect(page.locator('[data-score-builder-region-stats="true"]')).toBeVisible()
  })

  test('density heat-map lens can become a one-metric score', async ({ page }) => {
    await setMapLens(page, 'Density')
    // Density metric is an AppSelect (Radix), not a native <select>.
    await page.getByLabel('Density metric').click()
    await page.getByRole('option', { name: 'Shade Gap' }).click()
    await page.locator('[data-score-builder-build-density-score="true"]').click()

    await expect(page.getByRole('button', { name: /Heat & Shade/i })).toContainText('ON')
    // Leave the density lens so the right panel settles on a stable (non-density) tab.
    await setMapLens(page, 'Score')
    // Equation-term chips live in the always-visible top equation bar.
    await expect(page.locator('[data-score-builder-equation-term="shadeGap"]')).toBeVisible()
    await expect(page.locator('[data-score-builder-equation-term]')).toHaveCount(1)
    // The numeric weight input lives in the chip's in-place editor.
    await openChipEditor(page, 'shadeGap')
    await expect(page.locator('[data-score-builder-equation-number="shadeGap"]')).toHaveValue('100')
  })

  test('equation builder can add a metric and generate a share URL', async ({ page }) => {
    await page
      .locator('[data-score-builder-results-preview="true"]')
      .getByRole('button', { name: 'Add metric' })
      .click()
    await expect(page.getByRole('dialog', { name: 'Add Metric' })).toBeVisible()
    await page.getByRole('button', { name: /Raw Sensor Count/i }).click()

    await expect(page.locator('[data-score-builder-equation-term="monitorCount"]')).toBeVisible()
    await page.locator('[data-score-builder-share="true"]').click({ force: true })
    await expect(page).toHaveURL(/s=/)
  })

  test('flipping a metric turns the active example into a custom index', async ({ page }) => {
    const header = page.locator('[data-index-lab-header="true"]').first()
    const preview = page.locator('[data-score-builder-results-preview="true"]').first()
    await expect(header).toContainText('Greenest Neighbourhoods')

    // The first chip button flips the metric's direction — a real edit that no longer matches the example.
    await preview.locator('[data-score-builder-equation-term="parkDensity"] button').first().click()

    await expect(header).toContainText('Custom index')
    await expect(header).not.toContainText('Greenest Neighbourhoods')
  })

  test('priority mode can rank active metrics and apply weights', async ({ page }) => {
    // Priority ranking is a Build-view equation mode.
    await page.getByRole('group', { name: 'Lab view' }).getByRole('button', { name: 'Build' }).click()
    const builderMode = page.getByRole('group', { name: 'Builder mode' })
    await builderMode.getByRole('button', { name: 'Priority' }).click()
    await expect(page.getByRole('button', { name: 'Apply ranking' })).toBeVisible()
    await page.getByRole('button', { name: 'Apply ranking' }).click()
    await builderMode.getByRole('button', { name: 'Formula' }).click()
    await expect(page.locator('[data-score-builder-equation-number="parkDensity"]')).toHaveValue('80')
  })

  test('presets enable their required data sources and air networks', async ({ page }) => {
    await page.goto(
      '/score-builder?src=census&level=da&w=0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C4%2C6%2C0%2C28%2C14%2C18%2C0%2C8%2C22%2C0%2C0%2C0&ds=census%2CbcAssessment',
      {
        waitUntil: 'domcontentloaded',
      },
    )
    await expect(page.locator('[data-score-builder-results-preview="true"]')).toBeVisible({ timeout: 20_000 })
    await openPanels(page)

    await applyPresetFromDialog(page, 'Balanced Coverage')

    await expect(page.getByRole('button', { name: /Air Quality/i })).toContainText('ON')
    await expect(page.getByRole('button', { name: /BC Assessment/i })).toContainText('OFF')
    // Monitors load asynchronously; the preset selects every network once they arrive.
    await expect(page.getByText('0 networks')).toHaveCount(0, { timeout: 30_000 })
    await expect(page).toHaveURL(/ds=airQuality/)
    await expect(page).toHaveURL(/norm=winsorizedMinMax/)
  })

  test('preset changes toggle point visibility to match air quality usage', async ({ page }) => {
    await page.goto(
      '/score-builder?src=census&level=da&w=18%2C45%2C8%2C12%2C7%2C10%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0&ds=airQuality',
      {
        waitUntil: 'domcontentloaded',
      },
    )
    await expect(page.locator('[data-score-builder-results-preview="true"]')).toBeVisible({ timeout: 20_000 })
    await openPanels(page)
    await expect(page.getByRole('button', { name: 'Hide points' })).toBeVisible()

    await applyPresetFromDialog(page, 'Housing Affordability')

    await expect(page.getByRole('button', { name: 'Show points' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Air Quality/i })).toContainText('OFF')
    await expect(page.getByRole('button', { name: /BC Assessment/i })).toContainText('ON')
    await expect(page).toHaveURL(/ds=bcAssessment%2Ccensus|ds=census%2CbcAssessment/)

    await applyPresetFromDialog(page, 'Balanced Coverage')

    await expect(page.getByRole('button', { name: 'Hide points' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Air Quality/i })).toContainText('ON')
  })

  test('transit and school presets apply source and boundary intent', async ({ page }) => {
    await applyPresetFromDialog(page, 'Transit Access')

    await expect(dataSourceButton(page, 'Transit')).toContainText('ON')
    await expect(dataSourceButton(page, 'Demographics')).toContainText('ON')
    await expect(dataSourceButton(page, 'Parks & Trails')).toContainText('ON')
    await expect(page).toHaveURL(/ds=parks%2Ccensus%2Ctransit|ds=parks,census,transit/)
    await expect(page).toHaveURL(/w=.*30%2C28%2C22|w=.*30,28,22/)

    await applyPresetFromDialog(page, 'School Access + Safety')

    await expect(page.locator('[data-score-builder-boundary-source="cityPG"]')).toContainText('School catchments')
    await expect(levelSelectTrigger(page)).toContainText('Elementary School Catchment')
    await expect(dataSourceButton(page, 'Air Quality')).toContainText('ON')
    await expect(dataSourceButton(page, 'Crime')).toContainText('ON')
    await expect(dataSourceButton(page, 'BC Assessment')).toContainText('OFF')
    await expect(page).toHaveURL(/src=cityPG.*level=elementarySchoolCatchment/)
  })

  test('chsa mode only offers air-monitoring presets', async ({ page }) => {
    await chooseBoundarySource(page, 'bcHealth')
    await expect(levelSelectTrigger(page)).toContainText('CHSA')
    await expect(page).toHaveURL(/src=bcHealth/)

    const dialog = await openRecipesTab(page, 'Presets')
    await expect(dialog.getByRole('button', { name: /Balanced Coverage/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Low-Cost Expansion/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Reference Strength/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Housing Affordability/ })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /Food Inspection Risk/ })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /Safety Pressure/ })).toHaveCount(0)
  })

  test('desktop can open and close region insight modal', async ({ page }) => {
    await page.locator('[data-score-builder-tab="regions"]').click()

    const insightButtons = page.locator('[data-score-builder-region-insight]')
    await expect(insightButtons.first()).toBeVisible({ timeout: 20_000 })
    await insightButtons.first().click()

    const dialog = page.locator('[data-score-builder-region-insight-dialog="true"]')
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('Score Builder mobile interface', () => {
  const MOBILE_URL =
    '/score-builder?src=census&level=ct&w=0%2C0%2C0%2C0%2C0%2C0%2C0%2C22%2C28%2C20%2C15%2C0%2C0%2C0%2C0%2C15%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0&ds=parks%2Ccensus'

  test('phone sheet edits weights in place and follows the map lens', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(MOBILE_URL, { waitUntil: 'domcontentloaded' })

    const handle = page.locator('[data-map-mobile-sheet-handle="true"]')
    await expect(handle).toBeVisible()
    // Collapsed, the sheet peeks the recipe name rather than a page title.
    await expect(handle).toContainText('Custom index')
    await expect(page.getByText('Index Lab', { exact: true })).toHaveCount(1)

    await handle.press('End')
    await expect(handle).toHaveAttribute('aria-valuenow', '2')

    const sheet = page.locator('[data-score-builder-mobile-sheet="true"]')
    await expect(sheet.getByRole('button', { name: 'Browse recipes' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Open build view' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Open index settings' })).toBeVisible()
    await expect(sheet.locator('[data-score-builder-share="true"]')).toBeVisible()

    const equationSection = sheet.locator('[data-score-builder-section="equation"]')
    await expect(equationSection.locator('[data-score-builder-weight-row]')).toHaveCount(5)
    await expect(equationSection.getByRole('button', { name: 'Add metric' })).toBeVisible()
    // Method, model, and examples no longer crowd the sheet; they sit behind Settings and Recipes.
    await expect(page.locator('[data-score-builder-section-nav]')).toHaveCount(0)

    // Same weight editor as the Build view, with phone-sized targets.
    const flip = equationSection.locator('[data-score-builder-flip="parkDensity"]')
    const flipBox = await flip.boundingBox()
    expect(flipBox!.height).toBeGreaterThanOrEqual(40)
    await equationSection.locator('[data-score-builder-equation-number="parkAreaRatio"]').fill('40')
    await expect(page).toHaveURL(/w=.*40/)

    // Choosing a lens raises the sheet to that lens panel.
    await handle.press('Home')
    await page.getByRole('group', { name: 'Map lens' }).getByRole('button', { name: 'Density' }).click()
    await expect(handle).toHaveAttribute('aria-valuenow', '1')
    await expect(sheet.locator('[data-score-builder-lens-panel="density"]')).toBeVisible()
    await expect(sheet.getByLabel('Density metric')).toBeVisible()
  })

  test('phone Build view puts results under the equation and adds metrics through the picker', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${MOBILE_URL}&view=build`, { waitUntil: 'domcontentloaded' })

    const equation = page.locator('[data-score-builder-section="equation"]')
    await expect(equation.locator('[data-score-builder-weight-row]')).toHaveCount(5)
    // The library column is gone below lg; the picker takes its place.
    await expect(page.locator('[data-score-builder-metric-library="true"]')).toHaveCount(0)
    await equation.getByRole('button', { name: 'Add metric' }).click()
    await expect(page.getByRole('dialog', { name: 'Add Metric' })).toBeVisible()
    await page.getByRole('button', { name: /Raw Sensor Count/i }).click()
    await expect(equation.locator('[data-score-builder-weight-row]')).toHaveCount(6)

    // Live results sit directly under the equation instead of at the bottom of the page.
    const equationBox = await equation.boundingBox()
    const resultsBox = await page.locator('[data-score-builder-live-results="true"]').boundingBox()
    expect(resultsBox!.y - (equationBox!.y + equationBox!.height)).toBeLessThan(40)
  })
})
