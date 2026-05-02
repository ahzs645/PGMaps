import { expect, test } from '@playwright/test'

test.describe('Explorer Section', () => {
  test('loads and displays dataset toggles', async ({ page }) => {
    await page.goto('/explorer', { waitUntil: 'domcontentloaded' })

    // Should show explorer sidebar with dataset options
    await expect(page.getByRole('heading', { name: 'Active Layers' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /Property Crime/ })).toBeVisible()
  })

  test('heatmap toggle button is present', async ({ page }) => {
    await page.goto('/explorer', { waitUntil: 'domcontentloaded' })

    // Should show the heatmap toggle in the legend
    const heatmapBtn = page.getByRole('button', { name: /Heatmap/i })
    await expect(heatmapBtn).toBeVisible({ timeout: 15_000 })

    // Click to enable
    await heatmapBtn.click()
    await expect(page.getByText('Heatmap ON')).toBeVisible()

    // Click to disable
    await heatmapBtn.click()
    await expect(page.getByText('Heatmap ON')).toBeHidden()
  })
})
