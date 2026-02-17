import { expect, test, type Page } from '@playwright/test'

async function ensureSectionExpanded(page: Page, sectionId: string) {
  const toggle = page.locator(`[data-score-builder-toggle="${sectionId}"]`)
  await expect(toggle).toBeVisible()

  const expanded = await toggle.getAttribute('aria-expanded')
  if (expanded !== 'true') {
    await toggle.click()
  }
}

test.describe('Score Builder Sidebar', () => {
  test('boundary source and level switching does not break region scoring', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/score-builder', { waitUntil: 'domcontentloaded' })

    await ensureSectionExpanded(page, 'setup')
    await ensureSectionExpanded(page, 'filters')
    await ensureSectionExpanded(page, 'regions')

    const levelSelect = page.locator('[data-score-builder-level-select="true"]')
    const regionStats = page.locator('[data-score-builder-region-stats="true"]')
    const errorMessage = page.getByText('Unable to build scores')
    const loadingMessage = page.getByText('Building region scores...')

    await expect(page.locator('[data-score-builder-network]').first()).toBeVisible({ timeout: 20_000 })
    await page
      .locator('[data-score-builder-section="filters"]')
      .getByRole('button', { name: 'All' })
      .click()

    await expect(levelSelect).toBeVisible()
    await levelSelect.selectOption('chsa')
    await expect(loadingMessage).toBeHidden({ timeout: 30_000 })
    await expect(errorMessage).toHaveCount(0)
    await expect(regionStats).not.toHaveText('0 of 0 regions')

    await page.locator('[data-score-builder-boundary-source="census"]').click()
    await expect(levelSelect).toHaveValue('csd')
    await expect(loadingMessage).toBeHidden({ timeout: 30_000 })
    await expect(errorMessage).toHaveCount(0)
    await expect(regionStats).not.toHaveText('0 of 0 regions')
  })

  test('desktop sidebar scrolls and section ribbon navigation works', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/score-builder', { waitUntil: 'domcontentloaded' })

    const scrollContainer = page.locator('[data-score-builder-scroll="true"]')
    await expect(scrollContainer).toBeVisible()

    const initialTop = await scrollContainer.evaluate((node) => node.scrollTop)

    await page.locator('[data-score-builder-tab="regions"]').click()
    await expect(page.locator('[data-score-builder-section="regions"]')).toBeInViewport()

    const regionsTop = await scrollContainer.evaluate((node) => node.scrollTop)
    expect(regionsTop).toBeGreaterThan(initialTop + 20)

    await page.locator('[data-score-builder-tab="setup"]').click()
    await expect(page.locator('[data-score-builder-section="setup"]')).toBeInViewport()

    const setupTop = await scrollContainer.evaluate((node) => node.scrollTop)
    expect(setupTop).toBeLessThan(regionsTop)
  })

  test('desktop can open and close region insight modal', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/score-builder', { waitUntil: 'domcontentloaded' })

    await ensureSectionExpanded(page, 'filters')
    await ensureSectionExpanded(page, 'regions')

    const networkButtons = page.locator('[data-score-builder-network]')
    await expect(networkButtons.first()).toBeVisible({ timeout: 20_000 })

    await page
      .locator('[data-score-builder-section="filters"]')
      .getByRole('button', { name: 'All' })
      .click()

    const insightButtons = page.locator('[data-score-builder-region-insight]')
    await expect(insightButtons.first()).toBeVisible({ timeout: 20_000 })

    await insightButtons.first().click()

    const dialog = page.locator('[data-score-builder-region-insight-dialog="true"]')
    await expect(dialog).toBeVisible()

    await dialog.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test.describe('mobile preset guardrails', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('mobile keeps presets, hides manual controls, and supports simplified insight modal', async ({ page }) => {
      await page.goto('/score-builder', { waitUntil: 'domcontentloaded' })

      await ensureSectionExpanded(page, 'equation')

      await expect(page.locator('[data-score-builder-mobile-note="true"]')).toBeVisible()
      await expect(page.locator('[data-score-builder-equation-number]')).toHaveCount(0)
      await expect(page.locator('[data-score-builder-equation-slider]')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Balanced Coverage' })).toBeVisible()

      await ensureSectionExpanded(page, 'filters')
      const networkButtons = page.locator('[data-score-builder-network]')
      await expect(networkButtons.first()).toBeVisible({ timeout: 20_000 })

      await page
        .locator('[data-score-builder-section="filters"]')
        .getByRole('button', { name: 'All' })
        .click()

      await ensureSectionExpanded(page, 'regions')
      const insightButtons = page.locator('[data-score-builder-region-insight]')
      await expect(insightButtons.first()).toBeVisible({ timeout: 20_000 })

      await insightButtons.first().click()
      await expect(page.locator('[data-score-builder-region-insight-dialog="true"]')).toBeVisible()
      await expect(page.locator('[data-score-builder-mobile-insight="true"]')).toBeVisible()

      await page
        .locator('[data-score-builder-region-insight-dialog="true"]')
        .getByRole('button', { name: 'Close' })
        .click()
      await expect(page.locator('[data-score-builder-region-insight-dialog="true"]')).toBeHidden()
    })
  })
})
