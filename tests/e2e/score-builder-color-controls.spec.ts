import { expect, test, type Page } from '@playwright/test'

// The user's reported default project URL.
const PROJECT_URL =
  '/score-builder?src=census&level=ct&w=0%2C0%2C0%2C0%2C0%2C0%2C0%2C22%2C28%2C20%2C15%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C15%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0&ds=parks%2Ccensus&norm=percentile&agg=additive&missing=zero&sens=on&scope=activeBoundaryLevel&vis=interpolated&surface=boundary&hpDemo=cimdComposite&hpEnv=canopyProxyRatio&accessMin=0.05&accessHits=1'

async function chooseOption(page: Page, combobox: ReturnType<Page['locator']>, optionName: RegExp) {
  await combobox.click()
  await page.getByRole('option', { name: optionName }).click()
}

test.describe('Score Builder legend color controls (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-score-builder-results-preview="true"]')).toBeVisible({ timeout: 20_000 })
  })

  test('color scale toggle stabilizes coloring and persists to the URL', async ({ page }) => {
    const colorScale = page.getByRole('combobox', { name: 'Color scale' })
    await expect(colorScale).toBeVisible()
    // No cscale param yet -> defaults to the existing stretch behavior.
    await expect(colorScale).toContainText('Stretch to results')

    await chooseOption(page, colorScale, /Fixed 0/)
    await expect(colorScale).toContainText('Fixed 0')
    await expect(page).toHaveURL(/cscale=absolute/)
    await expect(page.getByText('they stay put as you adjust the model')).toBeVisible()

    await page.screenshot({ path: 'test-results/color-scale-absolute-desktop.png' })

    await chooseOption(page, colorScale, /Stretch to results/)
    await expect(page).toHaveURL(/cscale=relative/)
  })

  test('map output lives in the legend and toggles the color-scale control', async ({ page }) => {
    const mapOutput = page.getByRole('combobox', { name: 'Map output' })
    await expect(mapOutput).toBeVisible()
    await expect(mapOutput).toContainText('Interpolated ramp')

    // Color scale only applies to the interpolated ramp.
    await expect(page.getByRole('combobox', { name: 'Color scale' })).toBeVisible()

    await chooseOption(page, mapOutput, /5 score bins/)
    await expect(page).toHaveURL(/vis=binned/)
    // Binned output is inherently absolute, so the color-scale control hides.
    await expect(page.getByRole('combobox', { name: 'Color scale' })).toHaveCount(0)

    await page.screenshot({ path: 'test-results/legend-appearance-controls-desktop.png' })

    await chooseOption(page, mapOutput, /Interpolated ramp/)
    await expect(page).toHaveURL(/vis=interpolated/)
    await expect(page.getByRole('combobox', { name: 'Color scale' })).toBeVisible()
  })

  test('palette picker overrides the gradient and persists to the URL', async ({ page }) => {
    const palette = page.getByRole('combobox', { name: 'Palette' })
    await expect(palette).toBeVisible()
    await expect(palette).toContainText('Auto')

    await chooseOption(page, palette, /Affordability score/)
    await expect(palette).toContainText('Affordability')
    await expect(page).toHaveURL(/pal=affordability/)

    await page.screenshot({ path: 'test-results/palette-affordability-desktop.png' })

    await chooseOption(page, palette, /Auto \(from preset\)/)
    await expect(page).not.toHaveURL(/pal=/)
  })

  test('invalid weight drafts do not remove a metric or reset the auto palette', async ({ page }) => {
    await expect(page.getByText('Benefit score')).toBeVisible()
    await page.getByRole('tab', { name: 'Equation' }).click()

    const parkAreaWeight = page.locator('[data-score-builder-equation-number="parkAreaRatio"]')
    await expect(parkAreaWeight).toHaveValue('28')

    await parkAreaWeight.evaluate((element) => {
      const input = element as HTMLInputElement
      input.value = "'"
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await expect(parkAreaWeight).toHaveValue('28')
    await expect(parkAreaWeight).toHaveCount(1)
    await expect(page.getByText('Benefit score')).toBeVisible()

    await parkAreaWeight.fill('27')
    await expect(parkAreaWeight).toHaveValue('27')
    await expect(parkAreaWeight).toHaveCount(1)
    await expect(page.getByText('Benefit score')).toBeVisible()
  })

  test('slider center touch does not remove a metric or reset the auto palette', async ({ page }) => {
    await expect(page.getByText('Benefit score')).toBeVisible()
    await page.getByRole('tab', { name: 'Equation' }).click()

    const parkAreaWeight = page.locator('[data-score-builder-equation-number="parkAreaRatio"]')
    const parkAreaSlider = page.locator('[data-score-builder-equation-slider="parkAreaRatio"]')
    const parkAreaSliderThumb = parkAreaSlider.locator('[role="slider"]')
    await expect(parkAreaWeight).toHaveValue('28')
    await expect(parkAreaSlider).toHaveCount(1)
    await expect(parkAreaSliderThumb).toHaveCount(1)

    await parkAreaSliderThumb.focus()
    for (let i = 0; i < 40; i += 1) {
      await parkAreaSliderThumb.press('ArrowLeft')
    }

    await expect(parkAreaWeight).toHaveCount(1)
    await expect(parkAreaWeight).toHaveValue('1')
    await expect(page.getByText('Benefit score')).toBeVisible()
  })
})

test.describe('Score Builder legend color controls (mobile)', () => {
  test('both controls are reachable and operable on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-score-builder-share="true"]')).toBeVisible({ timeout: 20_000 })

    const colorScale = page.getByRole('combobox', { name: 'Color scale' })
    await colorScale.scrollIntoViewIfNeeded()
    await expect(colorScale).toBeVisible()
    await chooseOption(page, colorScale, /Fixed 0/)
    await expect(page).toHaveURL(/cscale=absolute/)

    const palette = page.getByRole('combobox', { name: 'Palette' })
    await palette.scrollIntoViewIfNeeded()
    await chooseOption(page, palette, /Risk \/ pressure score/)
    await expect(page).toHaveURL(/pal=riskPressure/)

    await page.screenshot({ path: 'test-results/color-controls-mobile.png' })
  })
})
