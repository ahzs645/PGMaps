import { expect, test, type Locator } from '@playwright/test'

/** Rounded top, height and left edge, so a sub-pixel difference is not a move. */
const box = async (locator: Locator) => {
  const b = (await locator.boundingBox())!
  return { y: Math.round(b.y), height: Math.round(b.height), x: Math.round(b.x) }
}

// Changing ribbon tabs must not move the panes below or the tools beside the tabs: every tab
// is one height whatever its tools are (`--ribbon-*` in interfaces.css), and a tab's own
// "All settings" sits beside the tabs rather than among the fixed tools on the right.
for (const width of [1440, 1024, 390]) {
  test(`every ribbon tab keeps one height and the tab row stays put at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 900 })
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
    )
    await page.goto('/dev/forestry/road-design?interface=ribbon&example=training')
    const ribbon = page.getByRole('region', { name: 'Command ribbon' })
    const tabs = ribbon.getByRole('tablist', { name: 'Ribbon tabs' })
    const find = ribbon.getByRole('button', { name: /Find tools/ })
    const plan = page.getByTestId('road-plan-view')
    await expect(plan).toBeVisible()
    const names = (await tabs.getByRole('tab').allInnerTexts()).map((name) => name.trim())
    expect(names.length).toBeGreaterThan(4)
    let first: { ribbon: Awaited<ReturnType<typeof box>>; plan: number; find: number } | undefined
    for (const name of names) {
      await tabs.getByRole('tab', { name, exact: true }).click()
      await expect(tabs.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
      const now = { ribbon: await box(ribbon), plan: (await box(plan)).y, find: (await box(find)).x }
      first ??= now
      expect(now.ribbon, `ribbon on ${name}`).toEqual(first.ribbon)
      expect(now.plan, `plan top on ${name}`).toBe(first.plan)
      expect(now.find, `Find tools on ${name}`).toBe(first.find)
    }
  })
}
