import { expect, test, type Page } from '@playwright/test'

/**
 * The visual-quality page on phones, short windows and the keyboard: every plan tool stays in reach as the map gets
 * short (`MapControlOverflow`), *Rate and package…* opens on the package's pane, and a shape is drawn without a
 * pointer (`MapKeyboardPlacement`). The scene is the page's own sample; the network is stubbed.
 */

test.use({ serviceWorkers: 'block' })

const PAGE_PATH = '/dev/forestry/visual-quality'

/** The plan map's tools, by the names the stack and its More menu both give them. */
const PLAN_TOOLS = [
  'Measure',
  'Look from the road',
  'Add a view of interest',
  'Draw the road',
  'Draw block',
  'Draw a wildlife tree patch',
  'Route preview',
  'Layers',
  'Masks and local surfaces',
] as const

/** The five sizes of the mobile review (portrait and landscape phones). */
const SIZES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
] as const

async function stubNetwork(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('**/geo/pub/wfs?**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features: [], numberMatched: 0 } }),
  )
  // The land status checks ask by POST, the layer in the body.
  await page.route('**/geo/pub/wfs', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features: [], numberMatched: 0 } }),
  )
  await page.route('**/ows?**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features: [], numberMatched: 0 } }),
  )
  await page.route('**/MapServer/**/query**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features: [] } }),
  )
}

async function openPage(page: Page) {
  // The page restores its last scene from storage; these tests want the sample.
  await page.addInitScript(() => window.localStorage.clear())
  await stubNetwork(page)
  await page.goto(PAGE_PATH)
  await expect(page.locator('[data-testid="visuals-plan-map"] .maplibregl-canvas')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-testid="visuals-plan-map"] [data-map-control-overflow]')).toBeVisible()
}

const sheetHandle = (page: Page) => page.locator('[data-map-mobile-sheet-handle]')

/** On a phone the sheet covers the map: lower it to its peek, as a swipe down does. */
async function lowerSheet(page: Page) {
  const handle = sheetHandle(page)
  if (!(await handle.isVisible())) return
  if ((await handle.getAttribute('aria-valuenow')) === '0') return
  const sheetTop = () =>
    page.evaluate(() => document.querySelector('[data-map-mobile-sheet="true"]')!.getBoundingClientRect().top)
  await expect(async () => {
    await handle.focus()
    await page.keyboard.press('Home')
    await expect(handle).toHaveAttribute('aria-valuenow', '0')
    // Down to its peek, not caught part way by a snap the page asked for as a tool closed.
    expect(await sheetTop()).toBeGreaterThan(page.viewportSize()!.height - 120)
  }).toPass({ timeout: 15_000 })
  await settled(page)
}

/** Waits out the sheet's slide and the stack's refold: the sheet's top and the More button hold still. */
async function settled(page: Page) {
  let last = ''
  await expect
    .poll(async () => {
      const now = await page.evaluate(() =>
        JSON.stringify([
          Math.round(document.querySelector('[data-map-mobile-sheet="true"]')?.getBoundingClientRect().top ?? 0),
          document.querySelector('[data-map-control-overflow]')?.getAttribute('data-folded') ?? '',
          document.querySelector('[data-map-control-overflow]')?.childElementCount ?? 0,
        ]),
      )
      const still = now === last
      last = now
      return still
    })
    .toBe(true)
}

/** Whether the control's centre is on screen and nothing else takes a tap there. */
async function reachable(page: Page, name: string) {
  return page.evaluate((label) => {
    const plan = document.querySelector('[data-testid="visuals-plan-map"]')!
    const button = plan.querySelector<HTMLElement>(`button[aria-label="${CSS.escape(label)}"]`)
    if (!button) return false
    const box = button.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false
    const hit = document.elementFromPoint(x, y)
    return !!hit && (hit === button || button.contains(hit))
  }, name)
}

/** The plan tools a finger cannot reach: drawn in the stack but covered, or folded with More out of reach. */
async function unreachableTools(page: Page) {
  return page.evaluate(
    (names) => {
      const plan = document.querySelector('[data-testid="visuals-plan-map"]')!
      const inReach = (button: HTMLElement | null) => {
        if (!button) return false
        const box = button.getBoundingClientRect()
        const x = box.left + box.width / 2
        const y = box.top + box.height / 2
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false
        const hit = document.elementFromPoint(x, y)
        return !!hit && (hit === button || button.contains(hit))
      }
      const button = (name: string) => plan.querySelector<HTMLElement>(`button[aria-label="${CSS.escape(name)}"]`)
      const more = inReach(button('More map tools'))
      return names.filter((name) => (button(name) ? !inReach(button(name)) : !more))
    },
    [...PLAN_TOOLS],
  )
}

/** Puts a plan tool in hand by touch: its own button when the stack shows it, else its row in More map tools. */
async function tapTool(page: Page, name: (typeof PLAN_TOOLS)[number]) {
  const plan = page.getByTestId('visuals-plan-map')
  if (await reachable(page, name)) {
    await plan.getByRole('button', { name, exact: true }).tap()
    return
  }
  expect(await reachable(page, 'More map tools'), `${name} is in neither the stack nor reach of More`).toBe(true)
  await plan.getByRole('button', { name: 'More map tools', exact: true }).tap()
  await page.getByRole('menu', { name: 'More map tools' }).getByRole('menuitemcheckbox', { name, exact: true }).tap()
}

/** Points on the plan where a tap reaches the map itself, clear of every card, control and sheet. */
async function openMapPoints(page: Page, count: number) {
  const points = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="visuals-plan-map"] .maplibregl-canvas')!
    const box = canvas.getBoundingClientRect()
    const found: Array<{ x: number; y: number }> = []
    for (let row = 1; row < 24; row += 1)
      for (let column = 1; column < 24; column += 1) {
        const x = box.left + (box.width * column) / 24
        const y = box.top + (box.height * row) / 24
        if (y > innerHeight - 4) continue
        // Clear of anything over the map for a finger's width round the point.
        const clear = [-10, 0, 10].every((dx) =>
          [-10, 0, 10].every((dy) => document.elementFromPoint(x + dx, y + dy) === canvas),
        )
        if (clear) found.push({ x: Math.round(x), y: Math.round(y) })
      }
    return found
  })
  expect(points.length, 'the map has room to tap').toBeGreaterThanOrEqual(count)
  // Spread over the open ground, so no two taps make a double tap.
  const step = Math.max(1, Math.floor(points.length / count))
  return Array.from({ length: count }, (_, index) => points[Math.min(points.length - 1, index * step)])
}

async function tapMap(page: Page, count: number) {
  for (const point of await openMapPoints(page, count)) {
    await page.touchscreen.tap(point.x, point.y)
    // Past a double tap's window.
    await page.waitForTimeout(400)
  }
}

for (const size of SIZES) {
  test.describe(`at ${size.width} × ${size.height}`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true })

    test('keeps every plan tool reachable, with the legend shut or open', async ({ page }) => {
      test.setTimeout(120_000)
      await openPage(page)
      await lowerSheet(page)
      await settled(page)
      const check = async (state: string) => {
        // Each tool is in reach in the stack, or folded (not in the stack) with More in reach.
        await expect
          .poll(() => unreachableTools(page), { message: `${state}: tools out of reach`, timeout: 10_000 })
          .toEqual([])
        const folded = await page.evaluate(
          (names) =>
            names.filter(
              (name) =>
                !document
                  .querySelector('[data-testid="visuals-plan-map"]')!
                  .querySelector(`button[aria-label="${CSS.escape(name)}"]`),
            ),
          [...PLAN_TOOLS],
        )
        // Layers opens its own panel and never folds.
        expect(folded).not.toContain('Layers')
        if (!folded.length) return
        await page.getByTestId('visuals-plan-map').getByRole('button', { name: 'More map tools' }).tap()
        const menu = page.getByRole('menu', { name: 'More map tools' })
        for (const name of folded)
          await expect(menu.getByRole('menuitemcheckbox', { name, exact: true }), `${state}: ${name}`).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)
      }
      await check('legend shut')
      const legend = page.getByTestId('visual-quality-legend')
      const expand = legend.getByRole('button', { name: /Expand legend/ })
      if (await expand.isVisible()) {
        await expand.tap()
        await settled(page)
        await check('legend open')
      }
    })

    test('places a view, draws a road and a block, and opens Layers and Masks by touch', async ({ page }) => {
      test.setTimeout(180_000)
      await openPage(page)

      await lowerSheet(page)
      await tapTool(page, 'Add a view of interest')
      await expect(page.getByTestId('plan-tool-card')).toBeVisible()
      await tapMap(page, 1)
      await expect(page.getByTestId('plan-tool-card')).toHaveCount(0)

      await lowerSheet(page)
      await tapTool(page, 'Draw the road')
      const card = page.getByTestId('plan-tool-card')
      await tapMap(page, 2)
      await expect(card).toContainText('2 points added')
      await card.getByRole('button', { name: 'Finish drawing' }).tap()
      await expect(card).toHaveCount(0)

      await lowerSheet(page)
      await tapTool(page, 'Draw block')
      await tapMap(page, 2)
      // Turned mid-draw: the draft and its card stay, and the tools are still in reach.
      await page.setViewportSize({ width: size.height, height: size.width })
      await expect(card).toContainText('2 points added')
      await tapMap(page, 1)
      await expect(card).toContainText('3 points added')
      await card.getByRole('button', { name: 'Finish drawing' }).tap()
      await expect(card).toHaveCount(0)
      await page.setViewportSize(size)
      // Turned back, a phone's sheet opens again as the layout changes: let it, then lower it.
      await page.waitForTimeout(1500)

      await lowerSheet(page)
      await tapTool(page, 'Layers')
      await expect(page.getByText('Established VQO polygons')).toBeVisible()
      await page.keyboard.press('Escape')

      await lowerSheet(page)
      await tapTool(page, 'Masks and local surfaces')
      await expect(page.getByTestId('tool-sources-card')).toBeVisible()
    })
  })
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('Rate and package opens on the package, with a way back to the files and focus handed back', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openPage(page)
    const rate = page.locator('[data-via-step="rate"]')
    await rate.tap()
    await expect(page.locator('[data-via-panel="rate"]')).toBeVisible()
    const opener = page.getByRole('button', { name: 'Rate and package…' })
    await opener.tap()
    const dialog = page.getByTestId('visuals-export-dialog')
    await expect(dialog).toBeVisible()
    const heading = dialog.getByRole('heading', { name: 'Package', exact: true })
    await expect(heading).toBeFocused()
    await expect(heading).toBeInViewport()
    await dialog.getByTestId('visuals-export-all-files').first().tap()
    await expect(dialog.getByRole('navigation', { name: 'Files' })).toBeInViewport()
    await expect(
      dialog.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Package\b/ }),
    ).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  })

  test("leaves the sheet's Hide panel button uncovered", async ({ page }) => {
    test.setTimeout(120_000)
    await openPage(page)
    const hide = page.getByRole('button', { name: 'Hide panel' })
    expect(
      await hide.evaluate((button) => {
        const box = button.getBoundingClientRect()
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return !!hit && (hit === button || button.contains(hit))
      }),
    ).toBe(true)
  })
})

test.describe('with the keyboard', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('draws a block and places a view without a pointer', async ({ page }) => {
    test.setTimeout(120_000)
    await openPage(page)
    const plan = page.getByTestId('visuals-plan-map')
    const canvas = plan.locator('.maplibregl-canvas')

    const drawBlock = plan.getByRole('button', { name: 'Draw block', exact: true })
    await drawBlock.focus()
    await page.keyboard.press('Enter')
    const card = page.getByTestId('plan-tool-card')
    await expect(card).toBeVisible()
    // Started from the keyboard, the map takes focus and marks its centre.
    await expect(canvas).toBeFocused()
    await expect(page.getByTestId('map-keyboard-cross')).toBeVisible()
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(400)
    await page.keyboard.press('Space')
    await expect(card).toContainText('3 points added')
    await page.keyboard.press('Backspace')
    await expect(card).toContainText('2 points added')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    await expect(card).toContainText('3 points added')
    await page.keyboard.press('Shift+Enter')
    await expect(card).toHaveCount(0)

    const addView = plan.getByRole('button', { name: 'Add a view of interest', exact: true })
    await addView.focus()
    await page.keyboard.press('Enter')
    await expect(card).toBeVisible()
    await expect(canvas).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(card).toHaveCount(0)
  })
})
