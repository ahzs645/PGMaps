import { expect, test } from '@playwright/test'

const mapRoutes = [
  '/foodmap',
  '/airquality',
  '/census',
  '/score-builder',
  '/explorer',
  '/bc-assessment',
  '/pgdata?tab=crime',
  '/pgdata?tab=parks',
  '/pgdata?tab=transit',
  '/misc',
] as const

test.describe('mobile map sidebars', () => {
  for (const route of mapRoutes) {
    test(`${route} renders its sidebar as a visible bottom sheet`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(route, { waitUntil: 'domcontentloaded' })

      const sheet = page.locator('[data-map-mobile-sheet="true"]')
      const handle = page.locator('[data-map-mobile-sheet-handle="true"]')

      await expect(sheet).toBeVisible({ timeout: 30_000 })
      await expect(handle).toBeVisible()
      await expect(handle).toBeInViewport()

      const sheetBox = await sheet.boundingBox()
      const handleBox = await handle.boundingBox()
      expect(sheetBox, 'sheet box').not.toBeNull()
      expect(handleBox, 'handle box').not.toBeNull()
      expect(sheetBox!.y).toBeLessThan(844)
      expect(handleBox!.y).toBeGreaterThanOrEqual(0)
      expect(handleBox!.y).toBeLessThan(844)
    })
  }
})
