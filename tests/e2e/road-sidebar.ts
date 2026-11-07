import type { Page } from '@playwright/test'

/**
 * Opens a road sidebar section that starts folded: route finding, vertical standards or the
 * point-cloud import options. Safe to call when it is already open.
 */
export async function expandRoadSection(
  page: Page,
  section: 'road-route-tools' | 'road-vertical-standards' | 'road-point-cloud-options',
) {
  if (section === 'road-point-cloud-options') {
    await openRoadPanel(page, 'Import options')
    const details = page.getByTestId(section)
    if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) await details.locator('summary').click()
    return
  }
  const toggle = page.getByTestId(section)
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

/** Opens a folded road sidebar section by its title. Safe to call when it is already open. */
export async function openRoadPanel(page: Page, title: string) {
  const toggle = page
    .getByRole('complementary', { name: 'Road design controls', exact: true })
    .locator('button[aria-expanded]', { hasText: title })
    .first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}
