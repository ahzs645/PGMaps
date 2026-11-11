import { expect, type Page } from '@playwright/test'
import { openRoadPanel } from './road-sidebar'
import { choose } from './styled-select'

/** Opens Design → Access from FSR and returns the panel. */
export async function openAccessReview(page: Page) {
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Design', exact: true })
    .click()
  await openRoadPanel(page, 'Access from FSR')
  return page.getByTestId('road-access-review')
}

/** Sets the review's end to the active road's start or end: an FSR connector for that road. */
export async function fromThisRoad(page: Page, endpoint: 'start' | 'end') {
  const panel = await openAccessReview(page)
  await panel.getByRole('group', { name: 'Access end', exact: true }).getByRole('button', { name: 'This road' }).click()
  await choose(panel.getByRole('combobox', { name: 'Connect from', exact: true }), endpoint)
  return panel
}

/** Starts from a road chosen in the nearby-FSR list rather than the nearest ones. */
export async function startFromChosenRoad(page: Page) {
  const panel = page.getByTestId('road-access-review')
  await panel
    .getByRole('group', { name: 'Access start', exact: true })
    .getByRole('button', { name: 'A road I pick' })
    .click()
  return panel.getByRole('combobox', { name: 'FSR to connect to', exact: true })
}

/**
 * Runs the review on the lowest-cost goal alone, which keeps it short, and adds its first variant
 * as a road.
 */
export async function compareAndAddFirst(page: Page, startsToTry?: number) {
  const panel = page.getByTestId('road-access-review')
  if (startsToTry) await choose(panel.getByRole('combobox', { name: 'FSRs to try', exact: true }), String(startsToTry))
  const goals = panel.getByRole('group', { name: 'Access goals', exact: true })
  for (const goal of ['Shortest', 'Gentlest', 'Fewest drainage issues']) {
    const button = goals.getByRole('button', { name: goal, exact: true })
    if ((await button.getAttribute('aria-pressed')) === 'true') await button.click()
  }
  await panel.getByRole('button', { name: 'Compare access routes', exact: true }).click()
  const routes = page.getByRole('radiogroup', { name: 'Access routes', exact: true })
  await expect(routes.getByRole('radio').first()).toBeVisible({ timeout: 180_000 })
  await routes.getByRole('radio').first().click()
  await panel.getByRole('button', { name: 'Add as road', exact: true }).click()
}
