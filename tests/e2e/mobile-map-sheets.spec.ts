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
  '/dev/interact',
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

  // Regression for iOS Safari URL-bar bug: when 100vh is taller than the
  // visible viewport, the layout root must clip to the visible area so the
  // sheet peek is not pushed below the URL bar.
  test('layout root is bounded to the visible viewport height', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 })
    await page.goto('/airquality', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-map-mobile-sheet="true"]')).toBeVisible({ timeout: 30_000 })
    const measurements = await page.evaluate(() => {
      const root = document.getElementById('root')
      const shell = root?.firstElementChild as HTMLElement | null
      return {
        rootHeight: root?.getBoundingClientRect().height ?? 0,
        shellHeight: shell?.getBoundingClientRect().height ?? 0,
        viewportHeight: window.innerHeight,
      }
    })
    expect(measurements.shellHeight).toBeLessThanOrEqual(measurements.rootHeight + 1)
    expect(measurements.shellHeight).toBeLessThanOrEqual(measurements.viewportHeight + 1)
  })

  test('full mobile sheet snap stays below the floating toolbar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dev/interact', { waitUntil: 'domcontentloaded' })

    const sheet = page.locator('[data-map-mobile-sheet="true"]')
    const handle = page.locator('[data-map-mobile-sheet-handle="true"]')
    const toolbar = page.locator('[data-map-mobile-toolbar="true"]')

    await expect(sheet).toBeVisible({ timeout: 30_000 })
    await handle.click()
    await handle.click()

    await page.waitForTimeout(400)
    const measurements = await page.evaluate(() => {
      const sheetEl = document.querySelector<HTMLElement>('[data-map-mobile-sheet="true"]')
      const toolbarEl = document.querySelector<HTMLElement>('[data-map-mobile-toolbar="true"]')
      return {
        sheetTop: sheetEl?.getBoundingClientRect().top ?? 0,
        toolbarBottom: toolbarEl?.getBoundingClientRect().bottom ?? 0,
      }
    })

    await expect(toolbar).toBeVisible()
    expect(measurements.sheetTop).toBeGreaterThanOrEqual(measurements.toolbarBottom + 7)
  })

  test('mobile food map deep-linked restaurant card can be dismissed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/foodmap?restaurant=A+%26+W+Restaurant-+5th+Avenue', { waitUntil: 'domcontentloaded' })

    const card = page.locator('[aria-label="Selected feature"]')
    await expect(card).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Close feature card' }).click()
    await expect(card).toBeHidden({ timeout: 5_000 })
    await expect(page).not.toHaveURL(/restaurant=/)
  })
})
