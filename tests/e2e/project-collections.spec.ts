import { expect, test } from '@playwright/test'

const folderUrl = '/dev/projects?collection=bc-climate-health'

for (const width of [320, 390, 1024, 1440]) {
  test(`climate folder supports browsing, search, links, and return at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const problems: string[] = []
    const dataRequests: string[] = []
    page.on('pageerror', (e) => problems.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text())
    })
    page.on('request', (r) => {
      if (/data\.map\.ahmad\.sh|\/data\/projects\/(?!index\.json)/.test(r.url())) dataRequests.push(r.url())
    })
    await page.goto('/dev/projects')
    const folder = page.getByRole('navigation', { name: 'Project folders' }).getByRole('link')
    await expect(folder).toContainText('B.C. Climate & Health')
    await expect(folder).toContainText('20 projects')
    await expect(folder).toHaveAttribute('href', folderUrl)
    await folder.click()
    await expect(page.getByRole('heading', { name: 'B.C. Climate & Health', exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toContainText('1–12 of 20 projects')
    const rows = width < 1280 ? page.locator('article') : page.locator('tbody tr')
    await expect(rows).toHaveCount(12)
    await expect(rows.first()).toContainText('Northern Health')
    await page
      .getByRole('navigation', { name: 'Project pages' })
      .getByRole('button', { name: 'Next', exact: true })
      .click()
    await expect(rows).toHaveCount(8)
    const search = page.getByRole('textbox', { name: 'Search projects' })
    await search.fill('Seasonal total precipitation')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Seasonal total precipitation')
    await search.fill('no-such-project')
    await expect(page.getByText('No projects match the current search.')).toBeVisible()
    await search.fill('')
    await expect(rows).toHaveCount(12)
    await page.getByRole('combobox', { name: 'Filter projects' }).click()
    await page.getByRole('option', { name: 'Index presets', exact: true }).click()
    await expect(page.getByText('No projects match the current search.')).toBeVisible()
    await page.getByRole('combobox', { name: 'Filter projects' }).click()
    await page.getByRole('option', { name: 'All types', exact: true }).click()
    await expect(rows).toHaveCount(12)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`climate-folder-${width}.png`), fullPage: true })
    // Catalog folders must stay metadata-only, with no climate or member-package fetches.
    expect(dataRequests).toEqual([])
    expect(problems).toEqual([])
    await page.reload()
    await expect(page.getByRole('heading', { name: 'B.C. Climate & Health', exact: true })).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Project breadcrumb' })
      .getByRole('button', { name: 'All projects', exact: true })
      .click()
    await expect(folder).toBeVisible()
    await search.fill('Seasonal total precipitation')
    await expect(rows).toHaveCount(0)
    await expect(folder).toContainText('1 matching project · 20 total')
    await folder.click()
    await expect(rows).toHaveCount(1)
    await rows
      .first()
      .getByRole('button', { name: width < 1280 ? 'Enter Project' : 'Enter', exact: true })
      .click()
    await expect(page).toHaveURL(/\/dev\/projects\/bc-climate-seasonal-precipitation$/)
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'B.C. Climate & Health', exact: true })).toBeVisible()
  })
}

test('unknown folder offers a way back instead of showing unrelated projects', async ({ page }) => {
  await page.goto('/dev/projects?collection=does-not-exist')
  await expect(page.getByText('This project folder does not exist.')).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Project breadcrumb' })
    .getByRole('button', { name: 'All projects' })
    .click()
  await expect(page.getByRole('navigation', { name: 'Project folders' })).toBeVisible()
})
