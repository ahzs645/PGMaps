import type { Page } from '@playwright/test'

/** Enter the linked engineering interface exercised by the road workflow suites. */
export async function openWorkbench(page: Page, url: string) {
  await page.goto(url)
  await selectWorkbench(page)
}

export async function selectWorkbench(page: Page) {
  await page.getByRole('button', { name: 'Open Engineering workbench', exact: true }).click()
}
