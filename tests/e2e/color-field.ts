import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Colours are picked with the shared `ColorField`: a swatch button that opens a picker, not a
 * native colour input, so `fill` on the labelled control does not apply. This opens the picker
 * from the swatch named `label`, types the colour into its hex box and closes the picker again.
 * The swatch carries the colour in use in `data-color-value`.
 */
export async function pickColor(scope: Page | Locator, label: string, hex: string) {
  const page = 'page' in scope ? scope.page() : scope
  const swatch = scope.getByRole('button', { name: label, exact: true })
  await swatch.click()
  const box = page.getByRole('textbox', { name: `${label}: hex`, exact: true })
  await box.fill(hex)
  await box.press('Enter')
  await expect(swatch).toHaveAttribute('data-color-value', hex.toLowerCase())
  // An Escape sent while the picker is still settling can be swallowed, so send it until it closes.
  await expect(async () => {
    if (await box.isVisible()) await page.keyboard.press('Escape')
    await expect(box).toBeHidden({ timeout: 1_000 })
  }).toPass()
}
