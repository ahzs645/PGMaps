import { expect, test } from '@playwright/test'

// The user's reported default project URL.
const PROJECT_URL =
  '/score-builder?src=census&level=ct&w=0%2C0%2C0%2C0%2C0%2C0%2C0%2C22%2C28%2C20%2C15%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C15%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0%2C0&ds=parks%2Ccensus&norm=percentile&agg=additive&missing=zero&sens=on&scope=activeBoundaryLevel&vis=interpolated&surface=boundary&hpDemo=cimdComposite&hpEnv=canopyProxyRatio&accessMin=0.05&accessHits=1'

test.describe('Score Builder model stability (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-score-builder-results-preview="true"]')).toBeVisible({ timeout: 20_000 })
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
