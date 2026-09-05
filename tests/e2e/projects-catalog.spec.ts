import { expect, test } from '@playwright/test'

for (const width of [320, 390, 1024, 1440]) {
  test(`catalog stays bounded and searchable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const mapRequests: string[] = []
    page.on('request', (request) => {
      if (/maplibre[^/]*\.(js|css)/.test(request.url())) mapRequests.push(request.url())
    })
    await page.goto('/dev/projects')
    const search = page.getByRole('textbox', { name: 'Search projects' })
    await expect(search).toBeVisible()
    const rows = width < 1280 ? page.locator('article') : page.locator('tbody tr')
    await expect(rows).toHaveCount(12)
    expect(await page.locator(width < 1280 ? 'tbody tr' : 'article').count()).toBe(0)
    const input = await search.boundingBox()
    expect(input!.width).toBeGreaterThan(220)
    await page.getByRole('button', { name: 'Browse all projects' }).click()
    await expect(rows).toHaveCount(12)
    await page
      .getByRole('navigation', { name: 'Project pages' })
      .getByRole('button', { name: 'Next', exact: true })
      .click()
    await expect(rows).toHaveCount(12)
    await search.fill('Heat + Shade Relief')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Heat + Shade Relief Priority')
    await search.fill('zzzz-no-match-audit')
    await expect(rows).toHaveCount(0)
    await expect(page.getByText('No projects match the current search.')).toBeVisible()
    // Searching featured-only browsing must reveal an otherwise hidden match too.
    await search.fill('')
    await page.getByRole('button', { name: 'Show featured' }).click()
    await search.fill('Heat + Shade Relief')
    await expect(rows).toHaveCount(1)
    const action = rows.first().getByRole('button', { name: width < 1280 ? 'Enter Project' : 'Enter', exact: true })
    const rect = await action.boundingBox()
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width)
    expect(mapRequests).toEqual([])
  })
}

test('an imported project is revealed even after filtering or paging', async ({ page }) => {
  const { readFile } = await import('node:fs/promises')
  const fixture = JSON.parse(await readFile('public/data/projects/bc-big-tree-registry.json', 'utf8'))
  fixture.slug = 'pagination-import-fixture'
  fixture.title = 'Pagination import fixture'
  await page.setViewportSize({width:390,height:844})
  await page.goto('/dev/projects')
  await page.getByRole('textbox',{name:'Search projects'}).fill('nothing-matches')
  await page.locator('input[type="file"]').setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))})
  await expect(page.locator('article')).toHaveCount(1)
  await expect(page.locator('article')).toContainText(fixture.title)
})
