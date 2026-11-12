import { expect, test, type Locator, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
})

const INTERFACE_IDS: Record<string, string> = {
  Ribbon: 'ribbon',
  'Guided map': 'guided',
  'Guided mode': 'workbench',
  Dashboard: 'dashboard',
}

// The designer opens straight into the interface a link names; there is no chooser in front of it.
async function openWorkspace(page: Page, name: string) {
  await page.goto(`/dev/forestry/road-design?interface=${INTERFACE_IDS[name]}&example=training`)
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
}

async function dragCorner(page: Page, button: Locator, dx: number, dy: number, touch: boolean) {
  const box = (await button.boundingBox())!
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const finish = { x: start.x + dx, y: start.y + dy }
  if (touch) {
    const input = await page.context().newCDPSession(page)
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [finish] })
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await input.detach()
  } else {
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(finish.x, finish.y, { steps: 8 })
    await page.mouse.up()
  }
}

for (const width of [1440, 390]) {
  test.describe(`Guided panels at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width === 390 })
    test('drags, remembers and resets the guide and the live map', async ({ page }) => {
      await openWorkspace(page, 'Guided map')
      const isPhone = width === 390
      const workspace = page.getByTestId('road-workspace')
      const station = page.getByRole('spinbutton', { name: 'Selected station metres' })
      await station.fill('200')
      await station.press('Enter')
      const guideGrip = page.getByRole('button', { name: 'Resize road guide', exact: true })
      const planGrip = page.getByRole('button', { name: 'Resize plan panel', exact: true })
      const guide = guideGrip.locator('..')
      const plan = planGrip.locator('..')
      await expect(workspace).toHaveAttribute('data-panel-background', 'gray')
      const inset = (await guide.boundingBox())!.x
      expect(inset).toBeCloseTo(isPhone ? 15.6 : 24, 0)
      const initialGuide = (await guide.boundingBox())!
      await dragCorner(page, guideGrip, isPhone ? -40 : 60, isPhone ? 20 : -70, isPhone)
      const resizedGuide = (await guide.boundingBox())!
      expect(Math.abs(initialGuide.width - resizedGuide.width)).toBeGreaterThan(32)
      expect(Math.abs(initialGuide.height - resizedGuide.height)).toBeGreaterThan(15)
      const initialPlan = (await plan.boundingBox())!
      const canvas = page.getByTestId('road-plan-view').locator('canvas.maplibregl-canvas')
      const initialCanvas = (await canvas.boundingBox())!
      await dragCorner(page, planGrip, -50, -46, isPhone)
      await expect.poll(async () => (await canvas.boundingBox())!.width).toBeLessThan(initialCanvas.width - 40)
      const resizedPlan = (await plan.boundingBox())!
      expect(resizedPlan.height).toBeCloseTo(initialPlan.height - 46, 0)
      await expect(station).toHaveValue('200')
      await plan.getByRole('button', { name: /^Fullscreen Plan/ }).click()
      await expect(planGrip).toHaveCount(0)
      await page.getByRole('button', { name: /^Exit fullscreen Plan/ }).click()
      await expect(planGrip).toBeVisible()
      expect((await plan.boundingBox())!.width).toBeCloseTo(resizedPlan.width, 0)

      await openWorkspace(page, 'Guided map')
      expect((await guide.boundingBox())!.width).toBeCloseTo(resizedGuide.width, 0)
      expect((await plan.boundingBox())!.width).toBeCloseTo(resizedPlan.width, 0)
      const presets = page.getByRole('button', { name: 'Screen presets & panels', exact: true })
      await presets.click()
      await page.getByRole('textbox', { name: 'Name for the current layout' }).fill('Field inspection')
      await page.getByRole('button', { name: 'Save current layout', exact: true }).click()
      await expect(page.getByTestId('road-layouts-dialog')).toBeHidden()
      expect((await plan.boundingBox())!.width).toBeCloseTo(resizedPlan.width, 0)
      await planGrip.press('ArrowRight')
      expect((await plan.boundingBox())!.width).toBeCloseTo(resizedPlan.width + 16, 0)
      await planGrip.press('Enter')
      await guideGrip.dblclick()
      expect((await guide.boundingBox())!.width).toBeCloseTo(initialGuide.width, 0)
      await presets.click()
      await page.getByRole('button', { name: 'Linked overview', exact: true }).click()
      await expect(page.getByTestId('road-layouts-dialog')).toBeHidden()
      expect((await plan.boundingBox())!.width).toBeCloseTo(resizedPlan.width, 0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  })
}

test('the served layout controls margins and corner handles', async ({ page }) => {
  await page.setViewportSize({ width: 1108, height: 954 })
  await page.route('**/workspace-layouts.json', async (route) => {
    const layouts = await (await route.fetch()).json()
    const guided = layouts.find((layout: { id: string }) => layout.id === 'guided')
    guided.panelFrame = { background: 'gray', grayPercent: 30, inset: 32, gap: 20, resizeCorners: false }
    await route.fulfill({ json: layouts })
  })
  await openWorkspace(page, 'Guided map')
  await expect(page.getByTestId('road-workspace')).toHaveCSS('--workspace-panel-gray', '30%')
  await expect(page.getByTestId('road-workspace')).toHaveCSS('padding-left', '32px')
  await expect(page.getByRole('button', { name: 'Resize plan panel', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Resize road guide', exact: true })).toHaveCount(0)
})

for (const width of [1440, 390]) {
  test.describe(`Ribbon panels at ${width}px`, () => {
    const phone = width === 390
    test.use({ viewport: { width, height: 900 }, hasTouch: phone, reducedMotion: 'reduce' })

    test('the settings pane remembers its dragged size and resets', async ({ page }) => {
      await openWorkspace(page, 'Ribbon')
      const workspace = page.getByTestId('road-workspace')
      await expect(workspace).toHaveAttribute('data-panel-background', 'gray')
      await expect(page.getByRole('button', { name: 'Resize plan panel', exact: true })).toBeVisible()
      const ribbon = page.getByRole('region', { name: 'Command ribbon' })
      await ribbon.getByRole('tab', { name: 'Engineering', exact: true }).click()
      const launcher = ribbon.getByRole('button', { name: 'Open Drainage settings', exact: true })
      await launcher.click()
      const pane = page.getByRole(phone ? 'dialog' : 'complementary', { name: 'Drainage settings' })
      const grip = pane.getByRole('button', { name: 'Resize settings panel' })
      await expect(grip).toBeInViewport()
      if (phone) await expect.poll(async () => (await pane.boundingBox())!.x).toBeCloseTo(15.6, 0)
      const initial = (await pane.boundingBox())!
      if (phone) expect(width - initial.x - initial.width).toBeCloseTo(initial.x, 0)
      await dragCorner(page, grip, -36, -56, phone)
      const resized = (await pane.boundingBox())!
      expect(resized.width).toBeCloseTo(initial.width - 36, 0)
      expect(resized.height).toBeCloseTo(initial.height - 56, 0)
      await pane.getByRole('button', { name: 'Close Drainage settings' }).click()
      await launcher.click()
      await expect(grip).toBeVisible()
      expect((await pane.boundingBox())!.width).toBeCloseTo(resized.width, 0)
      await grip.press('Enter')
      expect((await pane.boundingBox())!.height).toBeCloseTo(initial.height, 0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  })
}

test('workbench controls and engineering views each have an independent corner', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openWorkspace(page, 'Guided mode')
  await expect(page.getByTestId('road-workspace')).toHaveCSS('padding-left', '24px')
  const presets = page.getByRole('button', { name: 'Screen presets & panels', exact: true })
  await presets.click()
  await page.getByRole('button', { name: 'Plan · profile · section · data', exact: true }).click()
  await expect(page.getByTestId('road-layouts-dialog')).toBeHidden()
  const grip = (name: string) => page.getByRole('button', { name: `Resize ${name} panel`, exact: true })
  for (const name of ['plan', 'profile', 'detail', 'data', 'road controls']) {
    await expect(grip(name)).toBeInViewport()
  }
  const controls = page.getByRole('complementary', { name: 'Road design controls' })
  const initial = (await controls.boundingBox())!
  const map = page.getByTestId('road-plan-view')
  const mapWidth = (await map.boundingBox())!.width
  await dragCorner(page, grip('road controls'), -30, -40, false)
  const resized = (await controls.boundingBox())!
  expect(resized.width).toBeCloseTo(initial.width - 30, 0)
  expect(resized.height).toBeCloseTo(initial.height - 40, 0)
  expect((await map.boundingBox())!.width).toBeCloseTo(mapWidth, 0)
  await openWorkspace(page, 'Guided mode')
  expect((await controls.boundingBox())!.width).toBeCloseTo(resized.width, 0)
})
