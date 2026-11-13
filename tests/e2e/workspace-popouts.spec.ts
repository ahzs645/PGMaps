import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 } })
test.setTimeout(90_000)

const PLAN = 'Plan · alignment & terrain'
const PROFILE = 'Road profile · ground & formation'

async function openWorkspace(page: Page, interfaceId = 'ribbon') {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto(`/dev/forestry/road-design?interface=${interfaceId}&example=training`)
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
}

async function detach(page: Page, title: string, mode: 'window' | 'tab') {
  await showPane(
    page,
    title === PLAN ? 'Plan' : title === PROFILE ? 'Profile' : title.includes('data') ? 'Data' : 'Detail',
  )
  await page.getByRole('button', { name: `Open ${title} separately`, exact: true }).click()
  const pending = page.waitForEvent('popup')
  await page.getByRole('menuitem', { name: `Open in new ${mode}`, exact: true }).click()
  const child = await pending
  await expect(child.getByRole('region', { name: title, exact: true })).toHaveAttribute('data-detached-panel', 'true')
  await expect(page.getByRole('region', { name: `${title} · detached`, exact: true })).toHaveCount(0)
  const id = title === PLAN ? 'plan' : title === PROFILE ? 'profile' : title.includes('data') ? 'data' : 'detail'
  await expect(page.getByTestId('road-connected-layout').locator(`[data-pane="${id}"]`)).toBeHidden()
  await expect(page.getByRole('button', { name: /^Detached panels \(\d+\)$/ })).toBeVisible()
  return child
}

test('a detached plan frees its column and restores without changing saved panel preferences', async ({ page }) => {
  await openWorkspace(page)
  const layout = page.getByTestId('road-connected-layout')
  const planSlot = layout.locator('[data-pane="plan"]')
  const profileSlot = layout.locator('[data-pane="profile"]')
  const originalPlan = (await planSlot.boundingBox())!
  const originalProfile = (await profileSlot.boundingBox())!
  const chart = await page.getByTestId('road-profile-chart').elementHandle()
  const preferences = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(
          ([key]) => key.startsWith('pgmaps-road-panels:') || key.startsWith('pgmaps-road-panes:'),
        ),
      ),
    )
  const before = await preferences()
  const plan = await detach(page, PLAN, 'window')
  await expect.poll(async () => (await profileSlot.boundingBox())!.width).toBeGreaterThan(originalProfile.width + 200)
  await expect(layout.getByRole('separator')).toHaveCount(0)
  expect(
    await page.getByTestId('road-profile-chart').evaluate((element, previous) => element === previous, chart),
  ).toBe(true)
  expect(await preferences()).toEqual(before)
  await page.getByRole('button', { name: 'Detached panels (1)', exact: true }).click()
  const controls = page.getByRole('dialog', { name: 'Detached panels', exact: true })
  await expect(controls.getByRole('button', { name: `Show ${PLAN}`, exact: true })).toBeVisible()
  await controls.getByRole('button', { name: `Return ${PLAN} to workspace`, exact: true }).click()
  await expect.poll(() => plan.isClosed()).toBe(true)
  await expect(planSlot).toBeVisible()
  await expect.poll(async () => Math.round((await planSlot.boundingBox())!.width)).toBe(Math.round(originalPlan.width))
  await expect(page.getByRole('button', { name: /^Detached panels/ })).toHaveCount(0)
  expect(await preferences()).toEqual(before)
})

test('recovery controls remain available when every visible pane is detached', async ({ page }) => {
  await openWorkspace(page)
  const plan = await detach(page, PLAN, 'window')
  const profile = await detach(page, PROFILE, 'tab')
  const layout = page.getByTestId('road-connected-layout')
  await expect(layout.locator('[data-pane="plan"]')).toBeHidden()
  await expect(layout.locator('[data-pane="profile"]')).toBeHidden()
  await expect(layout.getByRole('separator')).toHaveCount(0)
  await page.getByRole('button', { name: 'Detached panels (2)', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Detached panels', exact: true })
    .getByRole('button', {
      name: `Return ${PROFILE} to workspace`,
      exact: true,
    })
    .click()
  await expect.poll(() => profile.isClosed()).toBe(true)
  await expect(page.getByTestId('road-profile-chart')).toBeVisible()
  expect(plan.isClosed()).toBe(false)
  await plan.close()
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByRole('button', { name: /^Detached panels/ })).toHaveCount(0)
})

async function showPane(page: Page, name: string) {
  const tabs = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
  if (await tabs.isVisible()) await tabs.getByRole('tab', { name, exact: true }).click()
}

async function layoutsDialog(page: Page) {
  const picker = page.getByRole('button', { name: 'Screen presets & panels', exact: true })
  if (!(await picker.isVisible()))
    await page
      .getByRole('region', { name: 'Command ribbon', exact: true })
      .getByRole('tab', { name: 'View', exact: true })
      .click()
  await picker.click()
  return page.getByTestId('road-layouts-dialog')
}

for (const width of [1512, 900, 390]) {
  test(`detached controls share the ribbon tab row without a second row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 982 })
    await openWorkspace(page)
    const ribbon = page.getByRole('region', { name: 'Command ribbon', exact: true })
    const before = (await ribbon.boundingBox())!
    const plan = await detach(page, PLAN, 'window')
    const trigger = ribbon.locator('.lp-ribbon-tabs').getByRole('button', { name: 'Detached panels (1)', exact: true })
    await expect(trigger).toBeVisible()
    expect((await ribbon.boundingBox())!.height).toBe(before.height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(
      page
        .getByTestId('road-connected-layout')
        .locator('..')
        .getByRole('button', { name: /^Detached panels/ }),
    ).toHaveCount(0)
    await trigger.click()
    await expect(page.getByRole('dialog', { name: 'Detached panels', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await plan.close()
  })
}

test('saved layouts keep window/tab choices and restore them from the tab row after reload', async ({ page }) => {
  await openWorkspace(page)
  const plan = await detach(page, PLAN, 'window')
  await plan.setViewportSize({ width: 1000, height: 700 })
  const profile = await detach(page, PROFILE, 'tab')
  const dialog = await layoutsDialog(page)
  await dialog.getByRole('textbox', { name: 'Name for the current layout', exact: true }).fill('Two screens')
  await dialog.getByRole('button', { name: 'Save current layout', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(plan.isClosed()).toBe(false)
  expect(profile.isClosed()).toBe(false)
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pgmaps-road-saved-layouts') ?? '[]').find(
      (item: { name: string }) => item.name === 'Two screens',
    ),
  )
  expect(saved.windows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        slot: 'plan',
        mode: 'window',
        width: 1000,
        height: 700,
        left: expect.any(Number),
        top: expect.any(Number),
      }),
      { slot: 'profile', mode: 'tab' },
    ]),
  )
  const docked = await layoutsDialog(page)
  await docked.getByRole('button', { name: 'Two panes · plan & profile', exact: true }).click()
  await expect.poll(() => plan.isClosed() && profile.isClosed()).toBe(true)
  const choose = await layoutsDialog(page)
  await choose.getByRole('button', { name: /^Two screens/ }).click()
  await expect(page.getByRole('button', { name: 'Open saved panels (2)', exact: true })).toBeVisible()
  // Remembered placement is also restored when the picker is on an inactive ribbon tab.
  await page
    .getByRole('region', { name: 'Command ribbon', exact: true })
    .getByRole('tab', { name: 'File', exact: true })
    .click()
  await page.reload()
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Open saved panels (2)', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Detached panels', exact: true })
  await page.evaluate(() => {
    const original = window.open
    const features: (string | undefined)[] = []
    Object.assign(window, { savedPanelFeatures: features })
    window.open = (url, target, options) => {
      features.push(options)
      return original.call(window, url, target, options)
    }
  })
  const planPending = page.waitForEvent('popup')
  await manager.getByRole('button', { name: `Open ${PLAN} in saved window`, exact: true }).click()
  const restoredPlan = await planPending
  await expect(restoredPlan.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await restoredPlan.getByRole('button', { name: 'Inspect plan station 600.0 metres', exact: true }).click()
  const profilePending = page.waitForEvent('popup')
  await manager.getByRole('button', { name: `Open ${PROFILE} in saved tab`, exact: true }).click()
  const restoredProfile = await profilePending
  await expect(restoredProfile.getByTestId('road-profile-chart')).toHaveAttribute('data-station', '600')
  const features = await page.evaluate(
    () => (window as unknown as { savedPanelFeatures: (string | undefined)[] }).savedPanelFeatures,
  )
  expect(features[0]).toContain('width=1000')
  expect(features[0]).toContain('height=700')
  expect(features[0]).toContain('left=')
  expect(features[1]).toBeUndefined()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })).toHaveValue('600')
  await restoredPlan.close()
  await restoredProfile.close()
  await expect(page.getByRole('button', { name: /^(Detached panels|Open saved panels)/ })).toHaveCount(0)
})

test('served popup defaults and configurable tab-row tools use the shared manager', async ({ page }) => {
  await page.route('**/workspace-layouts.json', async (route) => {
    const catalog = await (await route.fetch()).json()
    const ribbon = catalog.find((layout: { id: string }) => layout.id === 'ribbon')
    ribbon.panelWindows = [{ slot: 'plan', mode: 'tab' }]
    ribbon.toolbar.tabTools = ['detachedPanels', 'fullscreen']
    await route.fulfill({ json: catalog })
  })
  await openWorkspace(page)
  const row = page.locator('.lp-ribbon-tabs')
  await row.getByRole('button', { name: 'Open saved panels (1)', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Detached panels', exact: true })
  await page.evaluate(() => {
    const original = window.open
    window.open = () => null
    Object.assign(window, {
      retrySavedPanel: () => {
        window.open = original
      },
    })
  })
  await manager.getByRole('button', { name: `Open ${PLAN} in saved tab`, exact: true }).click()
  await expect(manager.getByRole('alert')).toContainText('Allow pop-ups for this site')
  await page.evaluate(() => (window as unknown as { retrySavedPanel: () => void }).retrySavedPanel())
  const pending = page.waitForEvent('popup')
  await manager.getByRole('button', { name: `Open ${PLAN} in saved tab`, exact: true }).click()
  const child = await pending
  await expect(child.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await child.close()
  await expect(row.getByRole('button', { name: /panels \(1\)/ })).toHaveCount(0)
})

for (const interfaceId of ['ribbon', 'guided', 'workbench', 'dashboard']) {
  test(`${interfaceId}: separate windows and tabs share station selection in both directions`, async ({ page }) => {
    await openWorkspace(page, interfaceId)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const profile = await detach(page, PROFILE, 'tab')
    profile.on('pageerror', (error) => errors.push(error.message))
    const station = page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })
    await station.fill('200')
    await station.press('Enter')
    const chart = profile.getByTestId('road-profile-chart')
    await expect(chart).toHaveAttribute('data-station', '200')
    await chart.focus()
    await chart.press('ArrowRight')
    await expect(station).not.toHaveValue('200')
    const selected = await station.inputValue()
    await expect(chart).toHaveAttribute('data-station', selected)

    const plan = await detach(page, PLAN, 'window')
    plan.on('pageerror', (error) => errors.push(error.message))
    await expect(plan.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
    await expect(plan.locator('canvas.maplibregl-canvas')).toBeVisible()
    await expect(plan.getByRole('button', { name: 'Resize plan panel', exact: true })).toHaveCount(0)
    await plan.getByRole('button', { name: 'Inspect plan station 600.0 metres', exact: true }).click()
    await expect(station).toHaveValue('600')
    await expect(chart).toHaveAttribute('data-station', '600')
    await plan.getByRole('button', { name: 'Map display settings', exact: true }).click()
    await expect(plan.getByRole('dialog', { name: 'Map display settings', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Map display settings', exact: true })).toHaveCount(0)
    await plan.keyboard.press('Escape')
    await expect(plan.getByRole('dialog', { name: 'Map display settings', exact: true })).toBeHidden()
    await station.fill('400')
    await station.press('Enter')
    await expect(chart).toHaveAttribute('data-station', '400')
    await expect(plan.getByTestId('road-plan-view')).toContainText('0+400')
    const canvas = plan.locator('canvas.maplibregl-canvas')
    const originalSize = await canvas.boundingBox()
    await plan.setViewportSize({ width: 900, height: 650 })
    await expect.poll(async () => (await canvas.boundingBox())!.width).not.toBe(originalSize!.width)
    // Fullscreen keyboard handling follows the panel's document too.
    await profile.getByRole('button', { name: `Fullscreen ${PROFILE}`, exact: true }).click()
    await expect(profile.getByRole('region', { name: PROFILE, exact: true })).toHaveAttribute('data-fullscreen', 'true')
    await profile.keyboard.press('Escape')
    await expect(profile.getByRole('region', { name: PROFILE, exact: true })).not.toHaveAttribute(
      'data-fullscreen',
      'true',
    )
    await profile.getByRole('button', { name: `Return ${PROFILE} to workspace`, exact: true }).click()
    await expect.poll(() => profile.isClosed()).toBe(true)
    await showPane(page, 'Profile')
    await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', '400')
    expect(plan.isClosed()).toBe(false)
    await plan.close()
    await showPane(page, 'Plan')
    await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByRole('region', { name: `${PLAN} · detached`, exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('blocked pop-ups retain the live panel and can be retried', async ({ page }) => {
  await openWorkspace(page)
  await page.evaluate(() => {
    const original = window.open
    Object.assign(window, {
      restorePanelOpen: () => {
        window.open = original
      },
    })
    window.open = () => null
  })
  await page.getByRole('button', { name: `Open ${PLAN} separately`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Open in new window', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Allow pop-ups for this site')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => (window as unknown as { restorePanelOpen: () => void }).restorePanelOpen())
  const child = await detach(page, PLAN, 'tab')
  await child.close()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('detached detail and station data share the same connected selection', async ({ page }) => {
  await openWorkspace(page, 'dashboard')
  const detail = await detach(page, 'Cross-section', 'window')
  const data = await detach(page, 'Station data · connected selection', 'tab')
  const station = page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })
  await station.fill('400')
  await station.press('Enter')
  await expect(detail.getByTestId('road-section-chart')).toHaveAttribute('data-station', '400')
  await data.getByLabel('Select station 200.0', { exact: true }).click()
  await expect(station).toHaveValue('200')
  await expect(detail.getByTestId('road-section-chart')).toHaveAttribute('data-station', '200')
  await data.close()
  await detail.close()
})

test('theme and styles follow detached panels; reload and host navigation clean up children', async ({ page }) => {
  await openWorkspace(page)
  const profile = await detach(page, PROFILE, 'tab')
  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
    document.documentElement.style.setProperty('--panel-test-color', 'rgb(17, 34, 51)')
    const style = document.createElement('style')
    style.textContent = '[data-detached-panel] h2 { color: rgb(17, 34, 51) !important }'
    document.head.append(style)
  })
  await expect(profile.locator('html')).toHaveClass(/dark/)
  await expect(profile.getByRole('heading', { name: PROFILE, exact: true })).toHaveCSS('color', 'rgb(17, 34, 51)')
  await expect(profile.locator('[data-panel-window-root]')).toHaveCSS('--panel-test-color', 'rgb(17, 34, 51)')
  await profile.reload().catch(() => {
    /* The child closes itself as its panel returns. */
  })
  await expect(page.getByTestId('road-profile-chart')).toBeVisible()
  await expect.poll(() => profile.isClosed()).toBe(true)
  const plan = await detach(page, PLAN, 'window')
  await page.goto('/dev/forestry')
  await expect.poll(() => plan.isClosed()).toBe(true)
})
