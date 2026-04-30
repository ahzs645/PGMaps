import { expect, test } from '@playwright/test'

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

  test('boundary source and level switching keeps region scores available', async ({ page }) => {
    const levelSelect = page.locator('[data-score-builder-level-select="true"]')
    const regionStats = page.locator('[data-score-builder-region-stats="true"]')
    const loadingMessage = page.getByText('Building region scores...')
    const errorMessage = page.getByText('Unable to build scores')

    await page.locator('[data-score-builder-tab="regions"]').click()
    await expect(regionStats).toContainText('23 of 23 regions', { timeout: 20_000 })

    await page.locator('[data-score-builder-boundary-source="bcHealth"]').click()
    await expect(levelSelect).toHaveValue('lha')
    await levelSelect.selectOption('chsa')
    await expect(loadingMessage).toBeHidden({ timeout: 30_000 })
    await expect(errorMessage).toHaveCount(0)
    await expect(regionStats).not.toHaveText('0 of 0 regions')
  })

  test('right-panel tabs expose equation, density, and region workflows', async ({ page }) => {
    await expect(page.locator('[data-score-builder-section="equation"]')).toBeVisible()

    await page.locator('[data-score-builder-tab="density"]').click()
    await expect(page.locator('[data-score-builder-section="density"]')).toBeVisible()
    await expect(page.getByLabel('Density metric')).toBeVisible()

    await page.locator('[data-score-builder-tab="regions"]').click()
    await expect(page.locator('[data-score-builder-section="regions"]')).toBeVisible()
    await expect(page.locator('[data-score-builder-region-stats="true"]')).toBeVisible()
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
