import { expect, type Page } from '@playwright/test'

type CulvertDetail = 'Geometry' | 'Levels' | 'Review'

/** Opens the requested part of the selected culvert's editor, not the road's Review workflow. */
export async function culvertDetails(page: Page, detail: CulvertDetail) {
  await page
    .getByTestId('road-culvert-editor')
    .getByRole('tablist', { name: 'Selected culvert details', exact: true })
    .getByRole('tab', { name: detail, exact: true })
    .click()
}

/** Selecting an inventory row also takes the linked road views to that culvert's station. */
export async function selectCulvert(page: Page, name: string, detail: CulvertDetail = 'Geometry') {
  await page
    .getByTestId('road-culvert-inventory')
    .getByRole('button', { name: `Edit ${name} at ` })
    .click()
  await expect(page.getByTestId('road-culvert-editor')).toHaveAttribute('aria-label', `Selected culvert: ${name}`)
  await culvertDetails(page, detail)
}
