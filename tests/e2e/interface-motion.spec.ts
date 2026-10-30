import { expect, test, type Locator, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block', reducedMotion: 'no-preference' })
test.setTimeout(60_000)

/** Check the renderer, rather than accepting a sidebar around an unloaded map. */
async function readMapState(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('.maplibregl-map')
    if (!container) return null
    const key = Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!key) return null
    type Hook = { memoizedState?: unknown; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber: Fiber | undefined = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return) {
      let hook = fiber.memoizedState
      for (let index = 0; hook && index < 50; index++, hook = hook.next) {
        const value = hook.memoizedState
        const candidate = value && typeof value === 'object' && 'current' in value ? value.current : value
        const map = candidate as {
          isStyleLoaded?: () => boolean
          getStyle?: () => { layers?: Array<{ type?: string }> } | undefined
          getCanvas?: () => HTMLCanvasElement
        } | null
        if (typeof map?.getCanvas === 'function' && typeof map.getStyle === 'function') {
          return {
            loaded: map.isStyleLoaded?.() ?? false,
            fillLayers: map.getStyle()?.layers?.filter((layer) => layer.type === 'fill').length ?? 0,
          }
        }
      }
    }
    return null
  })
}

async function openInteract(page: Page, mobile: boolean) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [],
        glyphs: 'https://interface-motion-test.invalid/{fontstack}/{range}.pbf',
      },
    }),
  )
  await page.route('https://interface-motion-test.invalid/**', (route) => route.fulfill({ body: Buffer.alloc(0) }))
  await page.goto('/dev/interact', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => readMapState(page), { timeout: 30_000 }).toMatchObject({ loaded: true })
  await expect.poll(async () => (await readMapState(page))?.fillLayers ?? 0).toBeGreaterThanOrEqual(2)
  if (mobile) {
    const handle = page.getByRole('separator', { name: 'Drag to resize sheet', exact: true })
    await expect(handle).toBeVisible()
    await handle.press('End')
    await expect(handle).toHaveAttribute('aria-valuenow', '2')
  }
  await expect(page.getByRole('button', { name: 'Search locations', exact: true })).toBeVisible()
  return errors
}

function searchDialog(page: Page) {
  // CSS keeps this locator bound to the same closing, inert dialog until exit.
  return page.locator('[role="dialog"]').filter({ has: page.locator('input[aria-label="Search map items"]') })
}

async function openSearch(page: Page, mobile: boolean) {
  const opener = page.getByRole('button', { name: 'Search locations', exact: true })
  if (mobile) await opener.tap()
  else await opener.click()
  const dialog = searchDialog(page)
  await expect(dialog).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'Search locations', exact: true })).toHaveCount(1)
  await expect(dialog.getByRole('textbox', { name: 'Search map items', exact: true })).toBeFocused()
  return { dialog, opener }
}

async function selectCottonwood(page: Page) {
  const { dialog } = await openSearch(page, true)
  await dialog.getByRole('textbox', { name: 'Search map items', exact: true }).fill('Cottonwood')
  await dialog.getByRole('button', { name: /Cottonwood Island Park/ }).tap()
  await expect(dialog).toHaveCount(0)
  const card = page.locator('#feature-inspector [role="dialog"]')
  await expect(card).toHaveAttribute('data-feature-card-state', 'open')
  await expect(card).toHaveAccessibleName('Cottonwood Island Park')
  return card
}

async function touchScrollDown(page: Page, body: Locator) {
  const bounds = await body.boundingBox()
  expect(bounds).not.toBeNull()
  const x = bounds!.x + bounds!.width / 2
  const y = bounds!.y + Math.min(45, bounds!.height / 3)
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (const delta of [12, 28, 46, 64]) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + delta }] })
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await session.detach()
  }
}

for (const mobile of [false, true]) {
  test.describe(`legacy interface motion on ${mobile ? 'a touch phone' : 'desktop'}`, () => {
    test.use({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
      hasTouch: mobile,
      isMobile: mobile,
    })

    test('search mounts one labelled input, focuses without scrolling, and restores focus on Escape', async ({
      page,
    }) => {
      const errors = await openInteract(page, mobile)
      const { dialog, opener } = await openSearch(page, mobile)
      const input = dialog.getByRole('textbox', { name: 'Search map items', exact: true })
      const titleId = await dialog.getAttribute('aria-labelledby')
      expect(titleId).toBeTruthy()
      await expect(page.locator(`[id="${titleId}"]`)).toHaveCount(1)
      await expect(page.locator('input[aria-label="Search map items"]')).toHaveCount(1)
      await expect(dialog.getByRole('button', { name: 'Close search', exact: true })).toHaveCount(1)
      expect(
        await page.evaluate(() => ({
          page: window.scrollY,
          layout: document.querySelector('[data-map-layout-root]')?.scrollTop,
        })),
      ).toEqual({ page: 0, layout: 0 })

      await input.fill('Cottonwood')
      await expect(dialog.getByRole('button', { name: /Cottonwood Island Park/ })).toBeVisible()
      await input.press('Escape')
      await expect(opener).toBeFocused()
      await expect
        .poll(async () => !(await dialog.count()) || dialog.evaluate((element) => (element as HTMLElement).inert))
        .toBe(true)
      await expect(dialog).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('reopening during the exit cancels stale removal and keeps the live input ref', async ({ page }) => {
      const errors = await openInteract(page, mobile)
      const { dialog } = await openSearch(page, mobile)
      // Advance component timers deterministically; no wall-clock sleep is needed
      // to prove that the previous onExited callback was cancelled.
      await page.clock.install()
      await page.clock.pauseAt(new Date(Date.now() + 1000))
      const race = await page.evaluate(async () => {
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Search map items"]')!
        const panel = input.closest<HTMLElement>('[role="dialog"]')!
        const close = panel.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')!
        const opener = Array.from(
          document.querySelectorAll<HTMLButtonElement>('[data-map-sidebar-wrapper] button'),
        ).find((button) => button.textContent?.trim() === 'Search locations')!
        // Two real button activations, with React's close commit between them,
        // preserve the in-flight panel instead of mounting a fresh instance.
        close.click()
        await Promise.resolve()
        const wasClosing = panel.inert && panel.dataset.open === 'false'
        opener.click()
        await Promise.resolve()
        return { wasClosing, sameInput: document.querySelector('input[aria-label="Search map items"]') === input }
      })
      expect(race).toEqual({ wasClosing: true, sameInput: true })
      await page.clock.runFor(1000)
      await expect(dialog).toHaveCount(1)
      await expect(dialog).toHaveAttribute('data-open', 'true')
      const input = dialog.getByRole('textbox', { name: 'Search map items', exact: true })
      await expect(input).toBeFocused()
      await input.fill('Route 15')
      await expect(dialog.getByRole('button', { name: /Route 15/ })).toBeVisible()
      const nextExit = await page.evaluate(async () => {
        const panel = document
          .querySelector<HTMLInputElement>('input[aria-label="Search map items"]')!
          .closest<HTMLElement>('[role="dialog"]')!
        panel.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')!.click()
        await Promise.resolve()
        return { connected: panel.isConnected, inert: panel.inert, open: panel.dataset.open }
      })
      // A stale onExited would clear searchMounted while searchOpen was true,
      // making this next close unmount immediately instead of retaining its exit.
      expect(nextExit).toEqual({ connected: true, inert: true, open: 'false' })
      await page.clock.runFor(1000)
      await expect(dialog).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}

test.describe('legacy feature cards on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the grip supports keyboard detents and collapsed contents are inert', async ({ page }) => {
    const errors = await openInteract(page, true)
    const card = await selectCottonwood(page)
    const handle = card.getByRole('separator', { name: 'Resize feature card', exact: true })
    const body = card.locator('[aria-label="Vector feature popup contents"]').locator('..')
    await expect(handle).toHaveAttribute('aria-valuenow', '1')
    await handle.press('Home')
    await expect(handle).toHaveAttribute('aria-valuenow', '0')
    await expect(body).toHaveAttribute('aria-hidden', 'true')
    expect(await body.evaluate((element) => (element as HTMLElement).inert)).toBe(true)
    await expect.poll(() => card.evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(92)

    await handle.press('End')
    await expect(handle).toHaveAttribute('aria-valuenow', '1')
    await expect(body).toHaveAttribute('aria-hidden', 'false')
    expect(await body.evaluate((element) => (element as HTMLElement).inert)).toBe(false)
    await expect.poll(() => card.evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(360)
    await handle.press(' ')
    await expect(handle).toHaveAttribute('aria-valuenow', '0')
    await handle.press('Enter')
    await expect(handle).toHaveAttribute('aria-valuenow', '1')
    expect(errors).toEqual([])
  })

  test('body scrolling and action buttons preserve the expanded detent', async ({ page }) => {
    const errors = await openInteract(page, true)
    const card = await selectCottonwood(page)
    const handle = card.getByRole('separator', { name: 'Resize feature card', exact: true })
    const body = card.locator('[aria-label="Vector feature popup contents"]').locator('..')
    await expect.poll(() => card.evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(360)
    await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
    const scrolled = await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight - element.clientHeight
      return element.scrollTop
    })
    expect(scrolled).toBeGreaterThan(0)
    await touchScrollDown(page, body)
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeLessThan(scrolled)
    await expect(handle).toHaveAttribute('aria-valuenow', '1')
    await expect(card).toHaveAttribute('data-map-target-visible-height', '360')

    const actions = card.getByRole('button', { name: 'Feature actions', exact: true })
    await actions.tap()
    await expect(actions).toHaveAttribute('aria-expanded', 'true')
    await expect(card.getByRole('menu')).toBeVisible()
    await actions.tap()
    await expect(actions).toHaveAttribute('aria-expanded', 'false')
    await expect(handle).toHaveAttribute('aria-valuenow', '1')
    await expect(card).toHaveAttribute('data-map-target-visible-height', '360')
    expect(errors).toEqual([])
  })

  test('reduced motion removes search and selected cards without an animated exit', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const errors = await openInteract(page, true)
    const { dialog, opener } = await openSearch(page, true)
    // The application's reduced-motion stylesheet enforces a 0.01ms duration
    // with !important, even when the component explicitly sets transition:none.
    expect(
      await dialog.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration)),
    ).toBeLessThanOrEqual(0.001)
    await dialog.getByRole('button', { name: 'Close search', exact: true }).tap()
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
    const card = await selectCottonwood(page)
    expect(
      await card.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration)),
    ).toBeLessThanOrEqual(0.001)
    await card.getByRole('button', { name: 'Close card', exact: true }).tap()
    await expect(page.locator('#feature-inspector')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})
