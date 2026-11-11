import { expect, type Page } from '@playwright/test'

/**
 * Open the linked engineering interface exercised by the road workflow suites. The designer
 * opens straight into an interface (no chooser), and a fresh browser has no stored choice, so
 * the workbench is the default; the URL names it anyway so a suite never depends on that.
 */
export async function openWorkbench(page: Page, url: string) {
  const target = new URL(url, 'http://localhost')
  if (!target.searchParams.has('interface')) target.searchParams.set('interface', 'workbench')
  await page.goto(`${target.pathname}${target.search}${target.hash}`)
  await selectWorkbench(page)
}

/** Wait for the workbench after a reload or a navigation that reopens the designer. */
export async function selectWorkbench(page: Page) {
  await expect(page.getByTestId('road-workspace')).toHaveAttribute('data-interface', 'workbench')
}
