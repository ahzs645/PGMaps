import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block', reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 } })
test.setTimeout(60_000)

declare global {
  interface Window {
    __tableMap?: {
      getCanvas(): HTMLCanvasElement
      getContainer(): HTMLElement
      getPadding(): { bottom: number }
      getCenter(): { toArray(): [number, number] }
      project(lngLat: [number, number]): { x: number; y: number }
      isStyleLoaded(): boolean
    }
  }
}

/** Expose the page's MapLibre instance, found through the React fiber of its container. */
async function exposeMap(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('.maplibregl-map')
    if (!container) return false
    const key = Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!key) return false
    type Hook = { memoizedState?: unknown; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber: Fiber | undefined = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return) {
      let hook = fiber.memoizedState
      for (let index = 0; hook && index < 50; index++, hook = hook.next) {
        const value = hook.memoizedState
        const candidate = (value && typeof value === 'object' && 'current' in value ? value.current : value) as
          | Window['__tableMap']
          | null
        if (typeof candidate?.getCanvas === 'function' && typeof candidate.getPadding === 'function') {
          window.__tableMap = candidate
          return candidate.isStyleLoaded()
        }
      }
    }
    return false
  })
}

async function openInteract(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/interact', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => exposeMap(page), { timeout: 30_000 }).toBe(true)
}

/** Run an action, then sample the canvas and a fixed place's screen position every frame until the pane settles. */
function recordPaneTransition(page: Page, action: 'open' | 'toggle-full-screen' | 'close') {
  return page.evaluate(async (action) => {
    const map = window.__tableMap!
    const canvas = map.getCanvas()
    const place = map.getCenter().toArray()
    const samples: Array<{ size: string; x: number; y: number }> = []
    const sample = () => {
      const point = map.project(place)
      samples.push({ size: `${canvas.width}x${canvas.height}`, x: point.x, y: point.y })
    }
    sample()
    if (action === 'open') {
      ;[...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.getAttribute('aria-label') === 'Open table')!
        .click()
    } else {
      const label = action === 'close' ? 'Close' : /Expand table pane|Collapse table pane/
      ;[...document.querySelectorAll<HTMLButtonElement>('[data-panel="data-table-panel"] button')]
        .find((button) => {
          const name = button.getAttribute('aria-label') ?? ''
          return typeof label === 'string' ? name === label : label.test(name)
        })!
        .click()
    }
    let stable = 0
    for (let frame = 0; frame < 150 && stable < 6; frame++) {
      await new Promise(requestAnimationFrame)
      sample()
      const running = document
        .querySelector('[data-map-layout-root="true"]')!
        .getAnimations({ subtree: true })
        .some((animation) => animation.playState === 'running')
      stable = running ? 0 : stable + 1
    }
    return samples
  }, action)
}

function expectStill(samples: Array<{ size: string; x: number; y: number }>) {
  expect(samples.length).toBeGreaterThan(8)
  expect(new Set(samples.map((sample) => sample.size)).size).toBe(1)
  for (const sample of samples) {
    expect(Math.abs(sample.x - samples[0].x)).toBeLessThan(0.5)
    expect(Math.abs(sample.y - samples[0].y)).toBeLessThan(0.5)
  }
}

test('the feature table opens, goes full screen and closes over a still map', async ({ page }) => {
  await openInteract(page)
  const pane = page.locator('[data-panel="data-table-panel"]')
  const layoutHeight = await page.locator('.geo-map-layout').evaluate((node) => node.getBoundingClientRect().height)

  expectStill(await recordPaneTransition(page, 'open'))
  await expect(pane).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__tableMap!.getPadding().bottom)).toBe(320)

  expectStill(await recordPaneTransition(page, 'toggle-full-screen'))
  // Full screen covers the whole layout, like Felt, rather than leaving a strip of map.
  await expect.poll(async () => Math.round((await pane.boundingBox())!.height)).toBe(Math.round(layoutHeight))
  await expect(pane.getByRole('button', { name: 'Collapse table pane' })).toHaveAttribute('aria-pressed', 'true')

  expectStill(await recordPaneTransition(page, 'toggle-full-screen'))
  await expect.poll(async () => Math.round((await pane.boundingBox())!.height)).toBe(320)

  expectStill(await recordPaneTransition(page, 'close'))
  await expect.poll(() => page.evaluate(() => window.__tableMap!.getPadding().bottom)).toBe(0)
})
