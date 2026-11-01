import { expect, type Page } from '@playwright/test'

/**
 * A closed modal stays mounted through its exit animation. Until it unmounts, Radix keeps the rest
 * of the page aria-hidden and blocks outside pointer events, so role queries find nothing and taps
 * are swallowed. Wait for both locks to clear before using the page behind a dialog.
 */
export async function dialogsClosed(page: Page) {
  await expect(page.locator('[data-aria-hidden="true"]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe('none')
}
