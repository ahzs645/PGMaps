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

  test('mobile sheet supports keyboard snap positions and accessible touch targets', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/airquality', { waitUntil: 'domcontentloaded' })

    const handle = page.locator('[data-map-mobile-sheet-handle="true"]')
    await expect(handle).toBeVisible({ timeout: 30_000 })
    await handle.focus()
    await handle.press('End')
    await expect(handle).toHaveAttribute('aria-valuenow', '2')
    await handle.press('Home')
    await expect(handle).toHaveAttribute('aria-valuenow', '0')

    const panelToggle = page.getByRole('button', { name: 'Show panel' })
    const toggleBox = await panelToggle.boundingBox()
    expect(toggleBox).not.toBeNull()
    expect(toggleBox!.width).toBeGreaterThanOrEqual(44)
    expect(toggleBox!.height).toBeGreaterThanOrEqual(44)

    const zoomIn = page.getByRole('button', { name: 'Zoom in' })
    await expect(zoomIn).toBeVisible({ timeout: 30_000 })
    const zoomBox = await zoomIn.boundingBox()
    expect(zoomBox).not.toBeNull()
    expect(zoomBox!.width).toBeGreaterThanOrEqual(44)
    expect(zoomBox!.height).toBeGreaterThanOrEqual(44)
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

  test('mobile food map docked restaurant card shows restaurant peek text', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/foodmap?restaurant=A+%26+W+Restaurant-+5th+Avenue', { waitUntil: 'domcontentloaded' })

    const card = page.locator('[aria-label="Selected feature"]')
    await expect(card).toBeVisible({ timeout: 30_000 })

    const dockAction = page.locator('[aria-label="Selected feature"] [data-mobile-feature-card-action="true"][aria-label="Dock selected feature behind map controls"]')
    await expect(dockAction).toBeVisible()
    await dockAction.click()

    const peek = page.getByRole('button', { name: 'Show selected feature card' })
    await expect(peek).toBeVisible({ timeout: 5_000 })
    await expect(peek).toContainText('A & W Restaurant- 5th Avenue')
    await expect(peek).not.toContainText('Tap to show selected feature')
  })

  test('mobile BC Assessment deep-linked property card can be dismissed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/bc-assessment?property=D0000SJZAC', { waitUntil: 'domcontentloaded' })

    const card = page.locator('[aria-label="Selected feature"]')
    await expect(card).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Close feature card' }).click()
    await expect(card).toBeHidden({ timeout: 5_000 })
    await expect(page).not.toHaveURL(/property=/)
  })

  test.describe.serial('AQMap main overlays', () => {
  test('mobile legend and bottom status do not overlap', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dev/aqmap/main', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.aqmap-monitor-legend')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-aqmap-status-info="true"]')).toBeVisible()
    await expect(page.locator('[data-aqmap-status-time="true"]')).toBeHidden()
    await page.waitForTimeout(500)

    const measurements = await page.evaluate(() => {
      const legend = document.querySelector<HTMLElement>('.aqmap-monitor-legend')
      const info = document.querySelector<HTMLElement>('[data-aqmap-status-info="true"]')
      const scale = document.querySelector<HTMLElement>('[data-aqmap-scale-bar="true"]')

      const toBox = (element: HTMLElement | null | undefined) => {
        if (!element) return null
        const rect = element.getBoundingClientRect()
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          viewportBottom: window.innerHeight - rect.bottom,
        }
      }

      const overlaps = (
        first: ReturnType<typeof toBox>,
        second: ReturnType<typeof toBox>,
      ) => Boolean(
        first
        && second
        && first.left < second.right
        && second.left < first.right
        && first.top < second.bottom
        && second.top < first.bottom,
      )

      const legendBox = toBox(legend)
      const infoBox = toBox(info)
      const scaleBox = toBox(scale)

      return {
        legend: legendBox,
        info: infoBox,
        scale: scaleBox,
        infoLegendOverlap: overlaps(infoBox, legendBox),
        scaleLegendOverlap: overlaps(scaleBox, legendBox),
        infoScaleOverlap: overlaps(infoBox, scaleBox),
      }
    })

    expect(measurements.legend, 'legend box').not.toBeNull()
    expect(measurements.info, 'info box').not.toBeNull()
    expect(measurements.scale, 'scale box').not.toBeNull()
    expect(measurements.legend!.viewportBottom).toBeLessThanOrEqual(24)
    expect(measurements.info!.viewportBottom).toBeLessThanOrEqual(24)
    expect(measurements.scale!.viewportBottom).toBeLessThanOrEqual(24)
    expect(measurements.infoLegendOverlap).toBe(false)
    expect(measurements.scaleLegendOverlap).toBe(false)
    expect(measurements.infoScaleOverlap).toBe(false)
  })

  test('mobile monitor tap opens feature card instead of tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dev/aqmap/main?lng=-110.6222&lat=64.7112&z=8.5', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.aqmap-monitor-legend')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(5_000)
    await page.mouse.click(195, 422)

    const card = page.locator('[aria-label="Selected feature"]')
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('Ekati Main Camp')
    await expect(page.locator('.aqmap-tooltip')).toHaveCount(0)
  })

  test('narrow desktop controls and status stay out of the legend', async ({ page }) => {
    await page.setViewportSize({ width: 815, height: 815 })
    await page.goto('/dev/aqmap/main', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.aqmap-monitor-legend')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByLabel('Zoom in')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(500)

    const measurements = await page.evaluate(() => {
      const legend = document.querySelector<HTMLElement>('.aqmap-monitor-legend')
      const controls = document.querySelector<HTMLElement>('[aria-label="Zoom in"]')?.closest<HTMLElement>('.absolute')
      const timestamp = document.querySelector<HTMLElement>('[data-aqmap-status-time="true"]')
      const scale = document.querySelector<HTMLElement>('[data-aqmap-scale-bar="true"]')

      const toBox = (element: HTMLElement | null | undefined) => {
        if (!element) return null
        const rect = element.getBoundingClientRect()
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        }
      }

      const overlaps = (
        first: ReturnType<typeof toBox>,
        second: ReturnType<typeof toBox>,
      ) => Boolean(
        first
        && second
        && first.left < second.right
        && second.left < first.right
        && first.top < second.bottom
        && second.top < first.bottom,
      )

      const legendBox = toBox(legend)
      const controlsBox = toBox(controls)
      const scaleBox = toBox(scale)
      const timestampBox = toBox(timestamp)

      return {
        legend: legendBox,
        controls: controlsBox,
        scale: scaleBox,
        timestamp: timestampBox,
        controlsLegendOverlap: overlaps(controlsBox, legendBox),
        scaleLegendOverlap: overlaps(scaleBox, legendBox),
        timestampLegendOverlap: overlaps(timestampBox, legendBox),
        controlsScaleOverlap: overlaps(controlsBox, scaleBox),
        timestampScaleOverlap: overlaps(timestampBox, scaleBox),
        controlsInTopLeft: Boolean(controlsBox && controlsBox.left <= 20 && controlsBox.top <= 72),
      }
    })

    expect(measurements.legend, 'legend box').not.toBeNull()
    expect(measurements.controls, 'controls box').not.toBeNull()
    expect(measurements.scale, 'scale box').not.toBeNull()
    expect(measurements.timestamp, 'timestamp box').not.toBeNull()
    expect(measurements.controlsLegendOverlap).toBe(false)
    expect(measurements.scaleLegendOverlap).toBe(false)
    expect(measurements.timestampLegendOverlap).toBe(false)
    expect(measurements.controlsScaleOverlap).toBe(false)
    expect(measurements.timestampScaleOverlap).toBe(false)
    expect(measurements.controlsInTopLeft).toBe(true)
  })
  })
})
