import { test, expect, type Locator } from '@playwright/test'
async function inspectMap(locator: Locator) {
  return locator.evaluate((element) => {
    const key = Object.keys(element).find((k) => k.startsWith('__reactFiber$'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fiber = key ? (element as any)[key] : null
    for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
      let hook = fiber.memoizedState
      for (let i = 0; hook && i < 40; i++, hook = hook.next) {
        const map = hook.memoizedState?.current ?? hook.memoizedState
        if (map && typeof map.getZoom === 'function' && typeof map.getStyle === 'function') {
          const p = map.project([-122.7, 53.9])
          return {
            moving: map.isMoving(),
            zoom: map.getZoom(),
            center: map.getCenter().toArray(),
            point: { x: p.x, y: p.y },
            layers: map
              .getStyle()
              ?.layers?.filter((l: { id: string }) => !l.id.startsWith('pgmaps'))
              .map((l: { id: string; type: string; paint?: unknown }) => ({ id: l.id, type: l.type, paint: l.paint })),
            features: map
              .queryRenderedFeatures()
              .filter((f: { properties?: Record<string, unknown> }) => f.properties?.ERUID).length,
          }
        }
      }
    }
    return null
  })
}
for (const width of [1440, 390])
  for (const reducedMotion of ['no-preference', 'reduce'] as const)
    test(`native camera revisits animate at ${width}px with ${reducedMotion} motion`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion })
      await page.goto('/dev/projects/example-native-editorial')
      const sidecar = page.locator('#region-sidecar')
      const map = sidecar.getByTestId('native-story-map')
      await page
        .getByTestId('editorial-slide-province-step')
        .evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
      await expect(map.locator('canvas')).toBeVisible()
      await expect.poll(async () => (await inspectMap(map))?.features ?? 0).toBeGreaterThan(0)
      await expect.poll(async () => (await inspectMap(map))?.moving).toBe(false)
      const canvas = await map.locator('canvas').elementHandle()
      // Return to both cached cameras: checking only a first visit misses jumpTo.
      for (const [step, index, longitude] of [
        ['cariboo', 1, -122.7],
        ['coast', 2, -128.4],
        ['cariboo', 1, -122.7],
        ['coast', 2, -128.4],
      ] as const) {
        await page
          .getByTestId(`editorial-slide-${step}-step`)
          .evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
        await expect(sidecar).toHaveAttribute('data-active-slide', String(index))
        if (reducedMotion === 'no-preference') {
          await expect.poll(async () => (await inspectMap(map))?.moving).toBe(true)
          expect(Math.abs((await inspectMap(map))!.center[0] - longitude)).toBeGreaterThan(0.001)
        }
        await expect.poll(async () => (await inspectMap(map))?.moving).toBe(false)
        expect((await inspectMap(map))!.center[0]).toBeCloseTo(longitude, 3)
        expect(await canvas?.evaluate((el) => el.isConnected)).toBe(true)
      }
    })
for (const width of [1440, 390])
  test(`native blocks, diagrams and linked maps at ${width}px`, async ({ page }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/dev/projects/example-native-editorial')
    await expect(page.getByRole('heading', { name: 'One story, reusable pieces', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to example', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Categories that connect', exact: true }).click()
    const hierarchy = page.getByTestId('radial-hierarchy')
    await expect(hierarchy).toBeVisible()
    await hierarchy.getByRole('button', { name: 'Cariboo', exact: true }).click()
    await expect(page.getByTestId('native-editorial')).toHaveAttribute('data-selected-category', '5950')
    const linked = page.locator('#linked-map')
    await linked.scrollIntoViewIfNeeded()
    await expect(linked.locator('canvas')).toBeVisible()
    await expect
      .poll(async () => (await inspectMap(linked.getByTestId('native-story-map')))?.features ?? 0)
      .toBeGreaterThan(0)
    await expect(linked.getByTestId('native-story-map')).toHaveAttribute('data-selected-category', '5950')
    const canvas = await linked.locator('canvas').elementHandle()
    if (width < 768) await page.getByRole('button', { name: 'Main menu', exact: true }).click()
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click()
    expect(await canvas?.evaluate((el) => el.isConnected)).toBe(true)
    await hierarchy.getByRole('button', { name: 'British Columbia', exact: true }).click()
    await expect(page.getByTestId('native-editorial')).toHaveAttribute('data-selected-category', '')
    await linked.scrollIntoViewIfNeeded()
    await expect
      .poll(async () => (await inspectMap(linked.getByTestId('native-story-map')))?.features ?? 0)
      .toBeGreaterThan(0)
    const state = await inspectMap(linked.getByTestId('native-story-map'))
    const bounds = await linked.locator('canvas').boundingBox()
    expect(bounds).not.toBeNull()
    expect(state).not.toBeNull()
    await page.mouse.click(bounds!.x + state!.point.x, bounds!.y + state!.point.y)
    await expect(page.getByTestId('native-editorial')).toHaveAttribute('data-selected-category', '5950')
    await expect(hierarchy).toHaveAttribute('data-selected-category', '5950')
    // Stable dot identities and explicit illustration semantics across scroll steps.
    const dots = page.locator('#dot-sidecar')
    for (const step of ['all', 'sample', 'cariboo', 'sample', 'all']) {
      await page.getByTestId('editorial-slide-dot-step-' + step).evaluate((el) => el.scrollIntoView({ block: 'start' }))
      await expect(dots.getByTestId('category-dots')).toHaveAttribute('data-step', step)
      await expect(dots.locator('[data-point-id]')).toHaveCount(80)
    }
    await expect(dots.getByText(/Illustrative data/)).toBeVisible()
    await dots.getByRole('button', { name: 'All categories', exact: true }).click()
    await expect(page.getByTestId('native-editorial')).toHaveAttribute('data-selected-category', '')
    const sidecar = page.locator('#region-sidecar')
    await page.getByTestId('editorial-slide-province-step').evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await expect(sidecar.locator('canvas')).toBeVisible()
    const stableCanvas = await sidecar.locator('canvas').elementHandle()
    await sidecar.getByRole('button', { name: 'Select Cariboo', exact: true }).click()
    await expect(sidecar.getByTestId('native-story-map')).toHaveAttribute('data-selected-category', '5950')
    await sidecar.getByRole('button', { name: 'zoom closer', exact: true }).click()
    await expect
      .poll(async () => (await inspectMap(sidecar.getByTestId('native-story-map')))?.center[0])
      .toBeCloseTo(-122.7, 1)
    expect(await stableCanvas?.evaluate((el) => el.isConnected)).toBe(true)
    await page.getByTestId('editorial-slide-cariboo-step').evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await expect(sidecar).toHaveAttribute('data-active-slide', '1')
    expect(await stableCanvas?.evaluate((el) => el.isConnected)).toBe(true)
    const compare = page.locator('#map-reveal')
    await compare.scrollIntoViewIfNeeded()
    await expect(compare.locator('canvas')).toHaveCount(2)
    const slider = compare.getByRole('slider')
    await slider.focus()
    await slider.press('End')
    await expect(slider).toHaveAttribute('aria-valuenow', '100')
    await slider.press('Home')
    await expect(slider).toHaveAttribute('aria-valuenow', '0')
    await slider.press('ArrowRight')
    await expect(slider).toHaveAttribute('aria-valuenow', '1')
    await page.getByRole('button', { name: 'A guided journey', exact: true }).click()
    const tour = page.locator('#regional-tour')
    await tour.getByRole('button', { name: 'Stop 2', exact: true }).click()
    await expect(tour).toHaveAttribute('data-active-place', '1')
    await tour.getByRole('button', { name: 'Stop 1', exact: true }).click()
    await expect(tour).toHaveAttribute('data-active-place', '0')
    await page.getByRole('button', { name: 'Media and credits', exact: true }).click()
    const gallery = page.locator('#gallery')
    await gallery.getByRole('button', { name: 'Next image', exact: true }).click()
    await expect(gallery.getByRole('img', { name: 'Different views, shared data' })).toBeVisible()
    await gallery.getByRole('button', { name: 'Expand media ↗', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await page.getByTestId('editorial-story').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
    expect(errors).toEqual([])
  })

for (const [width, sameStyle] of [
  [1440, false],
  [390, false],
  [1440, true],
] as const)
  test(`native layers survive a delayed ${sameStyle ? 'identical' : 'changed'} theme style at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(() => localStorage.setItem('theme', 'light'))
    let requested = false
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('https://basemaps.cartocdn.com/gl/**/style.json', async (route) => {
      const dark = route.request().url().includes('dark-matter')
      if (dark) {
        requested = true
        await pending
      }
      await route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [
            {
              id: 'background',
              type: 'background',
              paint: {
                'background-color': dark && !sameStyle ? '#17212b' : '#f4f5f2',
              },
            },
          ],
        },
      })
    })
    await page.goto('/dev/projects/example-native-editorial')
    const linked = page.locator('#linked-map')
    await linked.scrollIntoViewIfNeeded()
    const map = linked.getByTestId('native-story-map')
    await expect.poll(async () => (await inspectMap(map))?.features ?? 0).toBeGreaterThan(0)
    const canvas = await linked.locator('canvas').elementHandle()
    if (width < 768) await page.getByRole('button', { name: 'Main menu', exact: true }).click()
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click()
    await expect.poll(() => requested).toBe(true)
    // Old styledata events must not reattach layers before the new JSON arrives.
    await page.waitForTimeout(450)
    expect((await inspectMap(map))?.features ?? 0).toBe(0)
    release()
    await linked.scrollIntoViewIfNeeded()
    await expect.poll(async () => (await inspectMap(map))?.features ?? 0).toBeGreaterThan(0)
    expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true)
    if (width < 768) await page.getByRole('button', { name: 'Main menu', exact: true }).click()
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click()
    await expect.poll(async () => (await inspectMap(map))?.features ?? 0).toBeGreaterThan(0)
    expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true)
  })
