import { expect, test } from '@playwright/test'

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
