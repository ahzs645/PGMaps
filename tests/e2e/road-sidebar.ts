import type { Page } from '@playwright/test'

/**
 * Opens a road sidebar section that starts folded: route finding, vertical standards or the
 * point-cloud import options (a group in Import options, open with it). Safe to call when it is already open.
 */
export async function expandRoadSection(
  page: Page,
  section: 'road-route-tools' | 'road-vertical-standards' | 'road-point-cloud-options',
) {
  if (section === 'road-point-cloud-options') return openRoadPanel(page, 'Import options')
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
