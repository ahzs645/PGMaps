import type { Locator } from '@playwright/test'

/**
 * Opens the Drainage view's Inputs section (`DrainagePanel.tsx`), which folds when the road's
 * first run starts. Nothing happens when it is already open.
 */
export async function openDrainageInputs(panel: Locator) {
  const toggle = panel.locator('[data-workflow-section="Inputs"]')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
}
