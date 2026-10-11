import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

for (const width of [1440, 390]) {
  test(`bundled Nechako showcase works with external data blocked at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    const errors: string[] = []
    const externalData: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://**', (route) => {
      const url = route.request().url()
      if (url.startsWith('https://basemaps.cartocdn.com/'))
        return route.fulfill({
          json: {
            version: 8,
            sources: {},
            layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
          },
        })
      if (url.includes('nechakowatershed-portal.ca') || url.includes('/nwsviz/data/')) externalData.push(url)
      return route.abort('internetdisconnected')
    })
    await page.goto('/dev/nechako')
    await expect(page.getByRole('heading', { name: 'Repository data showcase' })).toBeVisible()
    await expect(page.getByText('1,408', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Public attachment links (8)' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open article', exact: true })).toHaveCount(8)
    await page.getByRole('button', { name: 'Browse bundled research', exact: true }).click()
    await expect(page.getByLabel('Research data source')).toHaveValue('snapshot')
    await expect(page.getByText('1,408 total records · 365 without location tags')).toBeVisible()
    await page.getByRole('button', { name: 'Unmapped records', exact: true }).click()
    await expect(page.getByText('365 matching records', { exact: true })).toBeVisible()
    await page.getByRole('list', { name: 'Research records' }).getByRole('button').first().click()
    await expect(page.getByRole('dialog')).toContainText('No location tags')
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click()
    await page.getByRole('button', { name: 'All records', exact: true }).click()
    await page.getByLabel('Search research records').fill('salmon')
    const csvDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export matching research CSV', exact: true }).click()
    const csv = await csvDownload
    expect(readFileSync((await csv.path())!, 'utf8').split('\r\n')[0]).toContain('"nwsviz_id","title","author"')
    await page.getByRole('tab', { name: 'Showcase', exact: true }).click()
    await page.getByRole('button', { name: 'Load research locations on map', exact: true }).click()
    await expect(page).toHaveURL(/view=layers/)
    await expect(page.getByText('Nechako research locations (46)', { exact: false })).toBeVisible()
    await expect(page.getByText('32 WMS services', { exact: false })).toBeVisible()
    await expect(page.getByLabel('Named layer or group')).not.toHaveValue('')
    await page.getByText('Save, load and import workspaces', { exact: true }).click()
    const workspaceDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export workspace JSON', exact: true }).click()
    const workspaceFile = await workspaceDownload
    const workspace = JSON.parse(readFileSync((await workspaceFile.path())!, 'utf8'))
    expect(workspace.vectors).toHaveLength(1)
    expect(workspace.vectors[0].data.features).toHaveLength(46)
    await page.getByRole('tab', { name: 'Showcase', exact: true }).click()
    await page.getByRole('button', { name: 'Load research locations on map', exact: true }).click()
    await expect(page.getByText('Nechako research locations (46)', { exact: false })).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Bundled portal catalogue' })).toBeVisible()
    await page.getByRole('tab', { name: 'Showcase', exact: true }).click()
    await page.getByRole('button', { name: 'Open research map and timeline', exact: true }).click()
    const researchMap = page.locator('[data-nechako-research-map]')
    if (width === 390) await researchMap.locator('[data-map-mobile-sheet-handle]').press('End')
    await expect(researchMap.getByText('1,408', { exact: true })).toBeVisible()
    await expect(researchMap.getByRole('button', { name: /Journal Articles/ }).first()).toBeVisible()
    await researchMap.getByRole('button', { name: 'Timeline', exact: true }).click()
    await expect(researchMap.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await researchMap.getByRole('button', { name: 'Showcase', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Repository data showcase' })).toBeVisible()
    await page.getByRole('tab', { name: 'Formats', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Bundled spatial format registry' })).toBeVisible()
    await expect(page.getByText('8 records · Page 1 of 1', { exact: true })).toBeVisible()
    expect(externalData).toEqual([])
    expect(errors).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const liveResearchRequests: string[] = []
    await page.route('https://projects.ahmadjalil.com/nwsviz/data/**', (route) => {
      const url = route.request().url()
      const filename = new URL(url).pathname.split('/').pop()!
      liveResearchRequests.push(url)
      return route.fulfill({
        contentType: 'application/json',
        body: readFileSync(`public/data/nechako-showcase/${filename}`),
      })
    })
    await page.goto('/dev/projects/nechako-watershed-research-portal')
    if (width === 390) await page.locator('[data-map-mobile-sheet-handle]').press('End')
    await expect(page.getByRole('button', { name: 'All projects', exact: true })).toBeVisible()
    await expect(page.getByText('1,408', { exact: true })).toBeVisible()
    expect(new Set(liveResearchRequests).size).toBe(4)
    await page.getByRole('button', { name: 'All projects', exact: true }).click()
    await expect(page).toHaveURL(/\/dev\/projects$/)
    expect(errors).toEqual([])
  })
}
