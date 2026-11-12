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

test('the ribbon stays put while a pane is open, a tool is pegging, or a caption changes', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?interface=ribbon&example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  const ribbon = page.getByRole('region', { name: 'Command ribbon' })
  const tab = (name: string) =>
    ribbon.getByRole('tablist', { name: 'Ribbon tabs' }).getByRole('tab', { name, exact: true })
  const quickUndo = ribbon.locator('.lp-quick-access [data-ribbon-item="undo"]')
  const groupWidths = () =>
    ribbon.locator('.lp-command-group').evaluateAll((groups) => groups.map((g) => Math.round(g.clientWidth)))

  // Opening a comparison is not an edit: nothing to undo afterwards.
  await expect(quickUndo).toBeDisabled()
  await tab('Engineering').click()
  await ribbon.getByRole('button', { name: 'Compare route costs', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(quickUndo).toBeDisabled()

  // All settings holds the tab's fields; the strip keeps inert copies in their places.
  await tab('Section').click()
  const strip = await groupWidths()
  await ribbon.getByRole('button', { name: 'All settings' }).click()
  await expect(ribbon.locator('.lp-quick-setting[data-mirror]').first()).toBeVisible()
  expect(await groupWidths()).toEqual(strip)
  await expect(ribbon.getByRole('spinbutton', { name: 'Left half-width (m)', exact: true })).toHaveCount(0)
  await ribbon.getByRole('button', { name: 'Close settings' }).click()

  // "Undo point" while pegging keeps Undo's width, and Escape puts the tool down from the ribbon.
  await tab('Road').click()
  const undo = ribbon.locator('.lp-group-items [data-ribbon-item="undo"]')
  const before = (await undo.boundingBox())!.width
  const peg = ribbon.getByRole('button', { name: 'Peg road', exact: true })
  await peg.click()
  const plan = (await page.getByTestId('road-plan-view').boundingBox())!
  await page.mouse.click(plan.x + plan.width * 0.4, plan.y + plan.height * 0.5)
  await expect(undo).toHaveAccessibleName('Undo point')
  expect((await undo.boundingBox())!.width).toBe(before)
  await peg.focus()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('pegging-feedback')).toBeHidden()
  await expect(peg).toHaveAttribute('aria-pressed', 'false')
})

test('a narrow ribbon folds quick access and the interface switch into More', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 })
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?interface=ribbon&example=training')
  const ribbon = page.getByRole('region', { name: 'Command ribbon' })
  await expect(ribbon.getByRole('group', { name: 'Quick access' })).toBeHidden()
  await expect(ribbon.getByRole('button', { name: 'Switch workspace interface' })).toBeHidden()
  await ribbon.getByRole('button', { name: 'More workspace commands' }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['Save project file', /^Undo/, /^Redo/, 'Switch interface'])
})
