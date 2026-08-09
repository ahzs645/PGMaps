import { expect, test } from '@playwright/test'

test('opens the mobile study-area picker without focusing the search field', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dev/boundaries', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Add' }).click()

  await expect(page.getByRole('heading', { name: 'Add study areas' })).toBeFocused()
  await expect(page.getByPlaceholder('Search sources, categories, levels')).not.toBeFocused()
})

test('keeps the study-area picker stable while choosing and switching levels', async ({ page }) => {
  await page.goto('/dev/boundaries', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Add' }).click()

  const scrollRegion = page.getByTestId('study-area-picker-scroll')
  await expect(scrollRegion).toHaveCSS('scrollbar-gutter', 'stable')

  await page.getByPlaceholder('Search sources, categories, levels').fill('Named watersheds')
  const clientWidthBeforeExpansion = await scrollRegion.evaluate((element) => element.clientWidth)

  const levelToggle = page.getByRole('button', { name: 'Choose a level for Named watersheds' })
  await levelToggle.click()
  await expect(levelToggle).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => scrollRegion.evaluate((element) => element.clientWidth)).toBe(clientWidthBeforeExpansion)

  const selectedLevel = page.getByRole('button', { name: 'Stream Order 8', exact: true })
  await selectedLevel.scrollIntoViewIfNeeded()
  const scrollTopBeforeSelection = await scrollRegion.evaluate((element) => element.scrollTop)
  await selectedLevel.click()

  await expect(levelToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(selectedLevel).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => scrollRegion.evaluate((element) => element.scrollTop)).toBe(scrollTopBeforeSelection)
})
