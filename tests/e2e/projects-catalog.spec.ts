import { expect, test } from '@playwright/test'

const featuredProjects = [
  'EchoScreen Cumulative Impacts Study',
  'Pedestrian Network Study MI',
  'Where Does Northern B.C. Begin?',
  'Nechako Watershed Research Portal',
]

test('keeps the extended project catalog behind the More projects control', async ({ page }) => {
  await page.goto('/dev/projects')

  const catalogRows = page.locator('tbody tr')
  await expect(catalogRows).toHaveCount(featuredProjects.length)

  for (const [index, title] of featuredProjects.entries()) {
    await expect(catalogRows.nth(index)).toContainText(title)
  }

  await expect(page.getByText('Heat + Shade Relief Priority', { exact: true })).toHaveCount(0)

  const moreProjects = page.getByRole('button', { name: /More projects/ })
  await expect(moreProjects).toHaveAttribute('aria-expanded', 'false')
  await moreProjects.click()

  await expect(page.getByText('Heat + Shade Relief Priority', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show fewer projects' })).toHaveAttribute('aria-expanded', 'true')
})
