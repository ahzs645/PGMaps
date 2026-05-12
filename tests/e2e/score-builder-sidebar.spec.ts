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
    { level: 'ct', label: 'Census Tract', count: 23 },
    { level: 'da', label: 'Dissemination Area', count: 135 },
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

async function applyPresetFromDialog(page: Page, presetName: string) {
  await page.getByRole('button', { name: /Browse presets|Browse/ }).click()
  await expect(page.getByRole('dialog', { name: 'Browse Presets' })).toBeVisible()
  await page.getByRole('button', { name: presetName }).click()
  await expect(page.getByRole('dialog', { name: 'Browse Presets' })).toHaveCount(0)
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
    for (const example of SCORE_BUILDER_EXAMPLES) {
      const requiredSources = requiredSourcesForWeights(example.weights)
      for (const source of requiredSources) {
        expect(example.dataSources, `${example.key} includes ${source}`).toContain(source)
      }
    }
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

    const preview = page.locator('[data-score-builder-results-preview="true"]')
    await expect(preview).toContainText('Greenest Neighbourhoods')
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
    await page.locator('[data-score-builder-tab="examples"]').click()
    await page.getByRole('button', { name: /Air Monitoring Gaps \(Tract\)/ }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Air Monitoring Gaps (Tract)' })).toBeVisible()
    await expect(dataSourceButton(page, 'Air Quality')).toContainText('ON')
    await expect(dataSourceButton(page, 'Parks & Trails')).toContainText('OFF')
    await expect(dataSourceButton(page, 'Demographics')).toContainText('ON')
    await expect(levelSelectTrigger(page)).toContainText('Census Tract')

    await page.locator('[data-score-builder-tab="equation"]').click()
    await expect(page.locator('[data-score-builder-equation-term="overallDensity"]')).toBeVisible()
    await expect(page.locator('[data-score-builder-equation-term="populationDensity"]')).toBeVisible()
  })

  test('boundary levels stay focused and keep region scores available', async ({ page }) => {
    const levelTrigger = levelSelectTrigger(page)
    const regionStats = page.locator('[data-score-builder-region-stats="true"]')
    const loadingMessage = page.getByText('Building region scores...')
    const errorMessage = page.getByText('Unable to build scores')

    await page.locator('[data-score-builder-tab="regions"]').click()
    await expect(regionStats).toContainText('23 of 23 regions', { timeout: 20_000 })
    await expectLevelOptions(page, ['Census Tract', 'Dissemination Area'])

    await selectLevel(page, 'Dissemination Area')
    await expect(levelTrigger).toContainText('Dissemination Area')
    await expect(loadingMessage).toBeHidden({ timeout: 30_000 })
    await expect(errorMessage).toHaveCount(0)
    await expect(regionStats).toContainText('135 of 135 regions')

    await page.locator('[data-score-builder-boundary-source="bcHealth"]').click()
    await expectLevelOptions(page, ['Health Authority', 'HSDA', 'LHA', 'CHSA'])
    await expect(levelTrigger).toContainText('CHSA')
    await expect(loadingMessage).toBeHidden({ timeout: 30_000 })
    await expect(errorMessage).toHaveCount(0)
    await expect(regionStats).toContainText('229 of 229 regions')
  })

  test('all boundary levels update options, URL state, and region counts', async ({ page }) => {
    const levelTrigger = levelSelectTrigger(page)
    const regionStats = page.locator('[data-score-builder-region-stats="true"]')
    const loadingMessage = page.getByText('Building region scores...')
    const errorMessage = page.getByText('Unable to build scores')

    await page.locator('[data-score-builder-tab="regions"]').click()

    for (const [source, levels] of Object.entries(boundaryMatrix)) {
      await page.locator(`[data-score-builder-boundary-source="${source}"]`).click()
      await expectLevelOptions(page, levels.map((entry) => entry.label))

      for (const entry of levels) {
        await selectLevel(page, entry.label)
        await expect(levelTrigger).toContainText(entry.label)
        await expect(loadingMessage).toBeHidden({ timeout: 30_000 })
        await expect(errorMessage).toHaveCount(0)
        await expect(regionStats).toContainText(`${entry.count} of ${entry.count} regions`, { timeout: 30_000 })
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

    const levelSelect = page.locator('[data-score-builder-level-select="true"]')
    const regionStats = page.locator('[data-score-builder-region-stats="true"]')
    const errorMessage = page.getByText('Unable to build scores')

    await page.locator('[data-score-builder-tab="regions"]').click()
    await expect(levelSelect).toHaveValue('chsa')
    await expect(errorMessage).toHaveCount(0)
    await expect(regionStats).toContainText('229 of 229 regions', { timeout: 30_000 })
    await expect(page).toHaveURL(/src=bcHealth.*level=chsa/)
  })

  test('right-panel tabs expose equation, density, and region workflows', async ({ page }) => {
    await page.locator('[data-score-builder-tab="equation"]').click()
    await expect(page.locator('[data-score-builder-section="equation"]')).toBeVisible()
    await expect(page.getByText('Normalization')).toBeVisible()

    await page.locator('[data-score-builder-tab="density"]').click()
    await expect(page.locator('[data-score-builder-section="density"]')).toBeVisible()
    await expect(page.getByLabel('Density metric')).toBeVisible()
    await expect(page.locator('[data-score-builder-build-density-score="true"]')).toBeVisible()

    await page.locator('[data-score-builder-tab="regions"]').click()
    await expect(page.locator('[data-score-builder-section="regions"]')).toBeVisible()
    await expect(page.locator('[data-score-builder-region-stats="true"]')).toBeVisible()
  })

  test('density heat-map lens can become a one-metric score', async ({ page }) => {
    await page.locator('[data-score-builder-tab="density"]').click()
    await page.getByLabel('Density metric').selectOption('shadeGap')
    await page.locator('[data-score-builder-build-density-score="true"]').click()

    await expect(page.getByRole('button', { name: /Heat & Shade/i })).toContainText('ON')
    await page.locator('[data-score-builder-tab="equation"]').click()
    await expect(page.locator('[data-score-builder-equation-term="shadeGap"]')).toBeVisible()
    await expect(page.locator('[data-score-builder-equation-term]')).toHaveCount(1)
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

  test('equation edits keep the active example context', async ({ page }) => {
    const preview = page.locator('[data-score-builder-results-preview="true"]').first()
    await expect(preview).toContainText('Greenest Neighbourhoods')

    await preview.locator('[data-score-builder-equation-term="parkDensity"] button').first().click()

    await expect(preview).toContainText('Greenest Neighbourhoods')
    await expect(preview).not.toContainText('Custom index')
  })

  test('priority mode can rank active metrics and apply weights', async ({ page }) => {
    await page.locator('[data-score-builder-tab="equation"]').click()
    await page.getByRole('button', { name: 'Priority' }).click()
    await expect(page.getByText('Priority ranking')).toBeVisible()
    await page.getByRole('button', { name: 'Apply ranking' }).click()
    await page.getByRole('button', { name: 'Formula' }).click()
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

    await applyPresetFromDialog(page, 'Balanced Coverage')

    await expect(page.getByRole('button', { name: /Air Quality/i })).toContainText('ON')
    await expect(page.getByRole('button', { name: /BC Assessment/i })).toContainText('OFF')
    await expect(page.getByText('0 networks')).toHaveCount(0)
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
    await expect(page.locator('[data-score-builder-level-select="true"]')).toHaveValue('elementarySchoolCatchment')
    await expect(dataSourceButton(page, 'Air Quality')).toContainText('ON')
    await expect(dataSourceButton(page, 'Crime')).toContainText('ON')
    await expect(dataSourceButton(page, 'BC Assessment')).toContainText('OFF')
    await expect(page).toHaveURL(/src=cityPG.*level=elementarySchoolCatchment/)
  })

  test('chsa mode only offers air-monitoring presets', async ({ page }) => {
    await page.locator('[data-score-builder-boundary-source="bcHealth"]').click()
    await expect(page.locator('[data-score-builder-level-select="true"]')).toHaveValue('chsa')
    await expect(page).toHaveURL(/src=bcHealth/)

    await page.getByRole('button', { name: /Browse presets|Browse/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Browse Presets' })
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
  test('mobile sheet opens to usable controls and exposes equation editing', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 963 })
    await page.goto(
      '/score-builder?src=census&level=ct&w=0%2C0%2C0%2C0%2C0%2C0%2C0%2C22%2C28%2C20%2C15%2C0%2C0%2C0%2C0%2C15%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0&ds=parks%2Ccensus',
      {
        waitUntil: 'domcontentloaded',
      },
    )

    await expect(page.locator('[data-score-builder-share="true"]')).toBeVisible()
    await expect(page.locator('[data-score-builder-section-nav="examples"]')).toBeVisible()

    await page.locator('[data-score-builder-section-nav="equation"]').click()
    const equationSection = page.locator('[data-score-builder-section="equation"]')
    await expect(equationSection).toBeVisible()
    await expect(equationSection.getByText('Active terms')).toBeVisible()
    await expect(equationSection.getByRole('button', { name: 'All metrics' })).toBeVisible()
    await expect(equationSection.getByText('Parks & Recreation')).toBeVisible()
    await expect(page.getByText('Custom metric weight editing is available on desktop')).toHaveCount(0)
  })
})
