import type { Locator, Page } from '@playwright/test'

const FOLD = /^View options/

/**
 * A road chart's show/hide toggle (bands, value bands, details below the chart). A narrow chart lists
 * them under one "View options" button (`CHART_TOGGLES_FOLD_BELOW_PX`, `Charts.tsx`), so this
 * opens that list when the chart has one. `close` shuts the list again; it does nothing for a toggle in
 * the header. Scope to the chart's panel when more than one chart is on screen.
 */
export async function chartToggle(page: Page, scope: Page | Locator, name: string) {
  const fold = scope.getByRole('button', { name: FOLD }).filter({ visible: true }).first()
  if (!(await fold.count()))
    return {
      toggle: scope.getByRole('button', { name, exact: true }).filter({ visible: true }).first(),
      close: async () => {},
    }
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click()
  const toggle = page
    .getByRole('dialog', { name: 'View options', exact: true })
    .getByRole('button', { name, exact: true })
  return {
    toggle,
    close: async () => {
      if ((await fold.getAttribute('aria-expanded')) === 'true') await page.keyboard.press('Escape')
    },
  }
}

/** Presses a chart toggle, or sets it to `pressed` when given, and closes the folded list after. */
export async function pressChartToggle(page: Page, scope: Page | Locator, name: string, pressed?: boolean) {
  const { toggle, close } = await chartToggle(page, scope, name)
  if (pressed === undefined || (await toggle.getAttribute('aria-pressed')) !== String(pressed)) await toggle.click()
  await close()
}

/** The road profile's panel, whichever profile view it shows. */
export const profilePanel = (page: Page) => page.getByRole('region', { name: /^Road profile/ })
