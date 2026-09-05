import { expect, test, type Page } from '@playwright/test'

const STORIES = [
  { layout: 'panel', slug: 'where-is-north-bc', scenes: 9 },
  { layout: 'panel', slug: 'canada-administrative-divisions', scenes: 11 },
  { layout: 'scrolly', slug: 'bc-population-distribution', scenes: 4 },
  {
    layout: 'slides',
    slug: 'roadless-areas-bc-ecoregions',
    scenes: 4,
    firstTitle: "Two thirds of B.C.'s landbase is roadless",
  },
] as const

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
] as const

const IGNORED_BROWSER_WARNING = /GL Driver Message .*GPU stall due to ReadPixels/

async function activeSceneIndex(page: Page): Promise<number> {
  return page
    .locator('[aria-current="step"]:visible')
    .first()
    .evaluate((node) => {
      const scene = node.closest('[data-scene-index]')
      if (scene) return Number(scene.getAttribute('data-scene-index'))
      const match = (node.getAttribute('aria-label') ?? '').match(/Go to scene (\d+)/)
      return match ? Number(match[1]) - 1 : -1
    })
}

async function expectActiveScene(page: Page, expected: number) {
  await expect.poll(() => activeSceneIndex(page), { timeout: 15_000 }).toBe(expected)
}

async function stepToScene({
  page,
  layout,
  viewport,
  target,
}: {
  page: Page
  layout: (typeof STORIES)[number]['layout']
  viewport: (typeof VIEWPORTS)[number]['name']
  target: number
}) {
  const current = await activeSceneIndex(page)
  if (target === current) return

  if (layout === 'scrolly' && viewport === 'phone') {
    const card = page.locator(`[data-scene-index="${target}"] button`)
    await card.scrollIntoViewIfNeeded()
    await card.click()
  } else {
    const label = target > current ? 'Next scene' : 'Previous scene'
    const button = page.locator(`button[aria-label="${label}"]:visible`).first()
    await expect(button).toBeVisible()
    await button.click()
  }

  await expectActiveScene(page, target)
}

for (const story of STORIES) {
  for (const viewport of VIEWPORTS) {
    test(`${story.layout} story passes the ${viewport.name} interaction loop (${story.slug})`, async ({ browser }) => {
      test.setTimeout(60_000)
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      })
      const page = await context.newPage()
      const consoleProblems: string[] = []
      const localRequestFailures: string[] = []

      page.on('console', (message) => {
        if (
          (message.type() === 'error' || message.type() === 'warning') &&
          !IGNORED_BROWSER_WARNING.test(message.text())
        ) {
          consoleProblems.push(`${message.type()}: ${message.text()}`)
        }
      })
      page.on('pageerror', (error) => consoleProblems.push(`pageerror: ${error.message}`))
      page.on('requestfailed', (request) => {
        const url = new URL(request.url())
        if (url.origin === new URL(page.url()).origin && request.failure()?.errorText !== 'net::ERR_ABORTED') {
          localRequestFailures.push(`${url.pathname}: ${request.failure()?.errorText}`)
        }
      })

      try {
        await page.goto(`/dev/projects/${story.slug}`, { waitUntil: 'domcontentloaded' })
        const map = page.locator('.maplibregl-map')
        const canvas = page.locator('.maplibregl-canvas')
        await expect(map).toBeVisible({ timeout: 30_000 })
        await expect(canvas).toBeVisible({ timeout: 30_000 })

        const swipeHint = page.getByRole('button', { name: 'OK' })
        if (await swipeHint.isVisible().catch(() => false)) await swipeHint.click()
        await expectActiveScene(page, 0)

        const size = await canvas.evaluate((node) => {
          const container = node.closest('.maplibregl-map') as HTMLElement
          return {
            widthDelta: Math.abs(node.clientWidth - container.clientWidth),
            heightDelta: Math.abs(node.clientHeight - container.clientHeight),
            mapY: container.getBoundingClientRect().y,
            mapHeight: container.getBoundingClientRect().height,
          }
        })
        expect(size.widthDelta).toBeLessThanOrEqual(2)
        expect(size.heightDelta).toBeLessThanOrEqual(2)
        if (story.layout === 'panel' && viewport.name === 'phone') {
          expect(Math.abs(size.mapY)).toBeLessThanOrEqual(1)
        }

        if (story.layout === 'scrolly') {
          const pointerEvents = await page.locator('[data-scene-index="0"]').evaluate((card) => {
            let overlay = card.parentElement
            while (overlay && getComputedStyle(overlay).overflowY !== 'auto') overlay = overlay.parentElement
            return {
              card: getComputedStyle(card).pointerEvents,
              overlay: overlay ? getComputedStyle(overlay).pointerEvents : 'missing',
            }
          })
          expect(pointerEvents.card).toBe('auto')
          expect(pointerEvents.overlay).toBe(viewport.name === 'desktop' ? 'none' : 'auto')
        }

        if (story.layout === 'slides') {
          const firstHeading = page.getByRole('heading', { name: story.firstTitle })
          const slideStack = await firstHeading.evaluate((heading) => {
            const stack = heading.parentElement?.parentElement
            return {
              display: stack ? getComputedStyle(stack).display : 'missing',
              count: stack?.children.length ?? -1,
            }
          })
          expect(slideStack.display).toBe('grid')
          expect(slideStack.count).toBe(story.scenes)
        }

        const initialMapHeight = size.mapHeight
        for (let index = 1; index < story.scenes; index += 1) {
          await stepToScene({ page, layout: story.layout, viewport: viewport.name, target: index })
          if (story.layout === 'slides') {
            const currentMapHeight = await map.evaluate((node) => node.getBoundingClientRect().height)
            expect(Math.abs(currentMapHeight - initialMapHeight)).toBeLessThanOrEqual(2)
          }
        }
        for (let index = story.scenes - 2; index >= 0; index -= 1) {
          await stepToScene({ page, layout: story.layout, viewport: viewport.name, target: index })
        }

        await page.waitForTimeout(500)
        expect(consoleProblems).toEqual([])
        expect(localRequestFailures).toEqual([])
      } finally {
        await context.close()
      }
    })
  }
}
