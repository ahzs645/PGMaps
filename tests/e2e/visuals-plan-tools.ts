import { expect, type Page } from '@playwright/test'

/**
 * Puts a tool on the visual-quality plan map in hand: its own button in the map's stack, or, where the map is too
 * short for the whole stack (`MapControlOverflow`), its row in *More map tools* under the same name.
 */
export async function takePlanTool(page: Page, name: string) {
  const plan = page.getByTestId('visuals-plan-map')
  const button = plan.getByRole('button', { name, exact: true })
  if (await button.count()) {
    await button.click()
    return
  }
  await plan.getByRole('button', { name: 'More map tools', exact: true }).click()
  const row = page.getByRole('menu', { name: 'More map tools' }).getByRole('menuitemcheckbox', { name, exact: true })
  await expect(row).toBeVisible()
  await row.click()
}
