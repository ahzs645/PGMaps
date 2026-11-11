import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`personal ribbon order and tool placement survive a reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('https://basemaps.cartocdn.com/**', (r) =>
      r.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
    )
    let updatedCatalog = false
    await page.route('**/workspace-layouts.json', async (route) => {
      const layouts = await (await route.fetch()).json()
      const ribbon = layouts.find((layout: { id: string }) => layout.id === 'ribbon').toolbar
      ribbon.startGroup = 'Field work'
      ribbon.groups = [
        {
          label: 'Field work',
          sections: [
            { label: 'Workspace', items: ['customizeRibbon'] },
            {
              label: 'Cartography',
              rows: 2,
              items: ['contours', 'stationLabels'],
              more: updatedCatalog ? ['fitAll'] : ['earthworks'],
            },
          ],
        },
      ]
      await route.fulfill({ json: layouts })
    })
    const open = async () => {
      await page.goto('/dev/forestry/road-design?example=training')
      await page.getByRole('button', { name: 'Open Ribbon', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Command ribbon' })).toBeVisible()
    }
    await open()
    const bar = page.getByRole('region', { name: 'Command ribbon' })
    const customize = bar.getByRole('button', { name: 'Customize ribbon', exact: true })
    const paneRole = width < 900 ? 'dialog' : 'complementary'
    const pane = page.getByRole(paneRole, { name: 'Customize ribbon', exact: true })
    const group = bar.getByRole('group', { name: 'Cartography', exact: true })
    const labels = () =>
      bar.locator('.lp-command-group').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
    await customize.click()
    await pane.getByRole('button', { name: 'Cartography', exact: true }).click()
    await pane.getByRole('button', { name: 'Move Cartography earlier' }).click()
    await pane.getByRole('button', { name: 'Show Earthworks on the ribbon' }).click()
    await pane.getByRole('button', { name: 'Move Earthworks up' }).click()
    await pane.getByRole('button', { name: 'Move Contours to group settings' }).click()
    await pane.getByRole('button', { name: 'Apply', exact: true }).click()
    expect(await labels()).toEqual(['Cartography', 'Workspace'])
    await expect(group.locator('.lp-group-items button')).toHaveText(['Earthworks', 'Station labels'])

    await open()
    expect(await labels()).toEqual(['Cartography', 'Workspace'])
    await expect(group.locator('.lp-group-items button')).toHaveText(['Earthworks', 'Station labels'])
    const launcher = group.getByRole('button', { name: 'Open Cartography settings' })
    await launcher.click()
    const tools = page.getByRole(paneRole, { name: 'Cartography settings', exact: true })
    await expect(tools.getByRole('button', { name: 'Contours', exact: true })).toBeVisible()
    await tools.getByRole('button', { name: 'Close Cartography settings' }).click()

    updatedCatalog = true
    await open()
    // A hosted catalog update can remove a previously pinned tool and add another setting.
    await expect(group.locator('.lp-group-items button')).toHaveText(['Station labels'])
    await launcher.click()
    await expect(tools.getByRole('button', { name: 'Fit all roads', exact: true })).toBeVisible()
    await tools.getByRole('button', { name: 'Close Cartography settings' }).click()

    await customize.click()
    await pane.getByRole('button', { name: 'Restore defaults' }).click()
    await pane.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await labels()).toEqual(['Cartography', 'Workspace'])
    await customize.click()
    await pane.getByRole('button', { name: 'Restore defaults' }).click()
    await pane.getByRole('button', { name: 'Apply', exact: true }).click()
    expect(await labels()).toEqual(['Workspace', 'Cartography'])
    await expect(group.locator('.lp-group-items button')).toHaveText(['Contours', 'Station labels'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  })
}
