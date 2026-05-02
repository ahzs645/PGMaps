import { expect, test } from '@playwright/test'

const boundaryMatrix = {
  census: [
    { level: 'ct', label: 'Census Tract', count: 23 },
    { level: 'da', label: 'Dissemination Area', count: 135 },
  ],
  bcHealth: [
    { level: 'chsa', label: 'CHSA', count: 229 },
  ],
} as const

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
    await expect(preview).toContainText('Live Results')
    await expect(preview).toContainText('#1')
    await expect(preview).toContainText('5 terms')
  })

  test('boundary levels stay focused and keep region scores available', async ({ page }) => {
    const levelSelect = page.locator('[data-score-builder-level-select="true"]')
    const regionStats = page.locator('[data-score-builder-region-stats="true"]')
    const loadingMessage = page.getByText('Building region scores...')
    const errorMessage = page.getByText('Unable to build scores')

    await page.locator('[data-score-builder-tab="regions"]').click()
    await expect(regionStats).toContainText('23 of 23 regions', { timeout: 20_000 })
    await expect(levelSelect.locator('option')).toHaveText(['Census Tract', 'Dissemination Area'])

    await levelSelect.selectOption('da')
    await expect(loadingMessage).toBeHidden({ timeout: 30_000 })
    await expect(errorMessage).toHaveCount(0)
    await expect(regionStats).toContainText('135 of 135 regions')

    await page.locator('[data-score-builder-boundary-source="bcHealth"]').click()
    await expect(levelSelect.locator('option')).toHaveText(['CHSA'])
    await expect(levelSelect).toHaveValue('chsa')
    await expect(loadingMessage).toBeHidden({ timeout: 30_000 })
    await expect(errorMessage).toHaveCount(0)
    await expect(regionStats).toContainText('229 of 229 regions')
  })

  test('all boundary levels update options, URL state, and region counts', async ({ page }) => {
    const levelSelect = page.locator('[data-score-builder-level-select="true"]')
    const regionStats = page.locator('[data-score-builder-region-stats="true"]')
    const loadingMessage = page.getByText('Building region scores...')
    const errorMessage = page.getByText('Unable to build scores')

    await page.locator('[data-score-builder-tab="regions"]').click()

    for (const [source, levels] of Object.entries(boundaryMatrix)) {
      await page.locator(`[data-score-builder-boundary-source="${source}"]`).click()
      await expect(levelSelect.locator('option')).toHaveText(levels.map((entry) => entry.label))

      for (const entry of levels) {
        await levelSelect.selectOption(entry.level)
        await expect(levelSelect).toHaveValue(entry.level)
        await expect(loadingMessage).toBeHidden({ timeout: 30_000 })
        await expect(errorMessage).toHaveCount(0)
        await expect(regionStats).toContainText(`${entry.count} of ${entry.count} regions`, { timeout: 30_000 })
        await expect(page).toHaveURL(new RegExp(`src=${source}.*level=${entry.level}`))
      }
    }
  })

  test('unsupported boundary URL params fall back to focused builder levels', async ({ page }) => {
    await page.goto('/score-builder?src=bcHealth&level=csd&w=0%2C0%2C0%2C0%2C0%2C0%2C0%2C22%2C28%2C20%2C15%2C0%2C0%2C0%2C0%2C15%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0&ds=parks%2Ccensus', {
      waitUntil: 'domcontentloaded',
    })
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
    await expect(page.locator('[data-score-builder-section="equation"]')).toBeVisible()
    await expect(page.getByText('Normalization')).toBeVisible()

    await page.locator('[data-score-builder-tab="density"]').click()
    await expect(page.locator('[data-score-builder-section="density"]')).toBeVisible()
    await expect(page.getByLabel('Density metric')).toBeVisible()

    await page.locator('[data-score-builder-tab="regions"]').click()
    await expect(page.locator('[data-score-builder-section="regions"]')).toBeVisible()
    await expect(page.locator('[data-score-builder-region-stats="true"]')).toBeVisible()
  })

  test('equation builder can add a metric and generate a share URL', async ({ page }) => {
    await page.getByRole('button', { name: 'Add metric' }).click()
    await expect(page.getByRole('dialog', { name: 'Add Metric' })).toBeVisible()
    await page.getByRole('button', { name: /Raw Sensor Count/i }).click()

    await expect(page.locator('[data-score-builder-equation-slider="monitorCount"]')).toBeVisible()
    await page.getByRole('button', { name: 'Share' }).click()
    await expect(page).toHaveURL(/s=/)
  })

  test('priority mode can rank active metrics and apply weights', async ({ page }) => {
    await page.getByRole('button', { name: 'Priority' }).click()
    await expect(page.getByText('Priority ranking')).toBeVisible()
    await page.getByRole('button', { name: 'Apply ranking' }).click()
    await page.getByRole('button', { name: 'Formula' }).click()
    await expect(page.locator('[data-score-builder-equation-number="parkDensity"]')).toHaveValue('80')
  })

  test('presets enable their required data sources and air networks', async ({ page }) => {
    await page.goto('/score-builder?src=census&level=da&w=0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C4%2C6%2C0%2C28%2C14%2C18%2C0%2C8%2C22%2C0%2C0%2C0&ds=census%2CbcAssessment', {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.locator('[data-score-builder-results-preview="true"]')).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Balanced Coverage' }).click()

    await expect(page.getByRole('button', { name: /Air Quality/i })).toContainText('ON')
    await expect(page.getByRole('button', { name: /BC Assessment/i })).toContainText('OFF')
    await expect(page.getByText('0 networks')).toHaveCount(0)
    await expect(page).toHaveURL(/ds=airQuality/)
  })

  test('preset changes toggle point visibility to match air quality usage', async ({ page }) => {
    await page.goto('/score-builder?src=census&level=da&w=18%2C45%2C8%2C12%2C7%2C10%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0&ds=airQuality', {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.locator('[data-score-builder-results-preview="true"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Hide points' })).toBeVisible()

    await page.getByRole('button', { name: 'Housing Affordability' }).click()

    await expect(page.getByRole('button', { name: 'Show points' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Air Quality/i })).toContainText('OFF')
    await expect(page.getByRole('button', { name: /BC Assessment/i })).toContainText('ON')
    await expect(page).toHaveURL(/ds=bcAssessment%2Ccensus|ds=census%2CbcAssessment/)

    await page.getByRole('button', { name: 'Balanced Coverage' }).click()

    await expect(page.getByRole('button', { name: 'Hide points' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Air Quality/i })).toContainText('ON')
  })

  test('chsa mode only offers air-monitoring presets', async ({ page }) => {
    await page.locator('[data-score-builder-boundary-source="bcHealth"]').click()
    await expect(page.locator('[data-score-builder-level-select="true"]')).toHaveValue('chsa')

    await expect(page.getByRole('button', { name: 'Balanced Coverage' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Low-Cost Expansion' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reference Strength' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Housing Affordability' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Food Inspection Risk' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Safety Pressure' })).toHaveCount(0)
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
    await page.goto('/score-builder?src=census&level=ct&w=0%2C0%2C0%2C0%2C0%2C0%2C0%2C22%2C28%2C20%2C15%2C0%2C0%2C0%2C0%2C15%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0&ds=parks%2Ccensus', {
      waitUntil: 'domcontentloaded',
    })

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
