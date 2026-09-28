import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const VARIANTS = ['docked', 'floating', 'slideshow', 'mixed'] as const
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
] as const

type Example = {
  scenes: Array<{
    label: string
    visibleLayerIds: string[]
    comparison?: { leftLayerIds: string[]; rightLayerIds: string[] }
    mapActions?: Array<{ label: string; visibleLayerIds: string[] }>
  }>
  workspace: { layers: Array<{ id: string; idProperty: string }> }
}

/** Inspect the actual MapLibre source/layer stack, as in the forestry suite. */
async function mapStates(page: Page) {
  return page.locator('.maplibregl-map').evaluateAll((containers) =>
    containers.map((container) => {
      const key = Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
      // React's test-only inspection avoids adding a production global map handle.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let node = key ? (container as any)[key] : null
      for (let depth = 0; node && depth < 100; depth++, node = node.return) {
        let hook = node.memoizedState
        for (let index = 0; hook && index < 50; index++, hook = hook.next) {
          const map = hook.memoizedState?.current ?? hook.memoizedState
          if (typeof map?.getStyle !== 'function') continue
          const style = map.getStyle()
          const sources = Object.entries(style?.sources ?? {}).filter(
            ([, value]) => (value as { type?: string }).type === 'geojson',
          )
          return {
          // Polygon sources only set promoteId when feature-state hover needs
          // it. The shared-source key carries the authored identity property.
          sourceIds: sources.map(([id]) => id.startsWith('fill-shared-') ? JSON.parse(id.slice('fill-shared-'.length))[1] : id).sort(),
            populated: sources.every(
              ([, value]) => ((value as { data?: { features?: unknown[] } }).data?.features?.length ?? 0) > 0,
            ),
            fills:
              style?.layers?.filter(
                (layer: { type: string; source?: string }) =>
                  layer.type === 'fill' && sources.some(([id]) => id === layer.source),
              ).length ?? 0,
            camera: [map.getCenter().lng, map.getCenter().lat, map.getZoom(), map.getBearing(), map.getPitch()],
          }
        }
      }
      return null
    }),
  )
}

async function expectLayers(page: Page, example: Example, ids: string[], mapIndex = 0) {
  const properties = ids.map((id) => example.workspace.layers.find((layer) => layer.id === id)!.idProperty).sort()
  await expect.poll(async () => (await mapStates(page))[mapIndex]?.sourceIds, { timeout: 30_000 }).toEqual(properties)
  await expect.poll(async () => (await mapStates(page))[mapIndex]?.populated).toBe(true)
  await expect.poll(async () => (await mapStates(page))[mapIndex]?.fills).toBeGreaterThanOrEqual(ids.length)
}

async function selectChapter(page: Page, example: Example, index: number) {
  const chapter = page.getByRole('navigation', { name: 'Story chapters' }).getByRole('button').nth(index)
  await chapter.click()
  await expect(chapter).toHaveAttribute('aria-current', 'step')
  await expect(page.getByTestId(`sidecar-chapter-${index}`)).toHaveAttribute('data-active-scene', 'true')
  const scene = example.scenes[index]
  await expectLayers(page, example, scene.comparison?.leftLayerIds ?? scene.visibleLayerIds)
  if (scene.comparison) await expectLayers(page, example, scene.comparison.rightLayerIds, 1)
}

async function expectAlignedMaps(page: Page) {
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(2)
  await expect
    .poll(async () =>
      page.locator('.maplibregl-canvas').evaluateAll((canvases) => {
        const [left, right] = canvases.map((canvas) => canvas.getBoundingClientRect())
        return Math.max(
          Math.abs(left.width - right.width),
          Math.abs(left.height - right.height),
          Math.abs(left.x - right.x),
          Math.abs(left.y - right.y),
        )
      }),
    )
    .toBeLessThanOrEqual(2)
  await expect
    .poll(async () => {
      const states = await mapStates(page)
      if (!states[0] || !states[1]) return Infinity
      return Math.max(
        ...states[0].camera.map((value: number, index: number) => Math.abs(value - states[1]!.camera[index])),
      )
    })
    .toBeLessThan(0.00001)
}

for (const variant of VARIANTS) {
  const example = JSON.parse(
    readFileSync(new URL(`../../public/data/projects/example/sidecar-${variant}.json`, import.meta.url), 'utf8'),
  ) as Example
  for (const viewport of VIEWPORTS) {
    test(`sidecar ${variant} passes the ${viewport.name} reading and comparison loop`, async ({ browser }) => {
      test.setTimeout(150_000)
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
        ignoreHTTPSErrors: true,
        reducedMotion: 'reduce',
      })
      const page = await context.newPage()
      const consoleProblems: string[] = []
      const localRequestFailures: string[] = []
      // Isolate external basemap availability while rendering real local boundary data.
      await page.route('https://basemaps.cartocdn.com/**', (route) =>
        route.fulfill({
          json: {
            version: 8,
            sources: {},
            layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e7eceb' } }],
          },
        }),
      )
      page.on('console', (message) => {
        if (
          ['error', 'warning'].includes(message.type()) &&
          !/GL Driver Message .*GPU stall due to ReadPixels/.test(message.text())
        ) {
          consoleProblems.push(`${message.type()}: ${message.text()}`)
        }
      })
      page.on('pageerror', (error) => consoleProblems.push(error.message))
      page.on('requestfailed', (request) => {
        if (
          new URL(request.url()).origin === new URL(page.url()).origin &&
          request.failure()?.errorText !== 'net::ERR_ABORTED'
        ) {
          localRequestFailures.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`)
        }
      })
      page.on('response', (response) => {
        if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url()).origin) {
          localRequestFailures.push(`${new URL(response.url()).pathname}: HTTP ${response.status()}`)
        }
      })

      try {
        await page.goto(`/dev/projects/example-sidecar-${variant}`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('sidecar-cover')).toBeVisible()
        await expect(page.locator('.maplibregl-canvas')).toHaveCount(1)
        const primaryCanvas = await page.locator('.maplibregl-canvas').elementHandle()
        expect(primaryCanvas).not.toBeNull()
        await page.getByRole('button', { name: 'Start reading', exact: true }).click()
        await expect(page.getByTestId('sidecar-cover')).toHaveCount(0)
        await expect(page.getByTestId('sidecar-narrative')).not.toHaveAttribute('inert', '')

        for (let index = 0; index < example.scenes.length; index++) await selectChapter(page, example, index)
        for (let index = example.scenes.length - 2; index >= 0; index--) await selectChapter(page, example, index)

        const action = example.scenes[0].mapActions!.find(
          (item) => item.visibleLayerIds[0] !== example.scenes[0].visibleLayerIds[0],
        )!
        await page.getByTestId('sidecar-chapter-0').getByRole('button', { name: action.label, exact: true }).click()
        await expect(page.getByTestId('sidecar-chapter-0')).toHaveAttribute('data-active-scene', 'true')
        await expect(page.getByTestId('sidecar-chapters').getByRole('button').nth(0)).toHaveAttribute(
          'aria-current',
          'step',
        )
        await expectLayers(page, example, action.visibleLayerIds)

        await selectChapter(page, example, 3)
        await expectAlignedMaps(page)
        const slider = page.getByRole('slider', { name: 'Comparison divider' })
        await slider.focus()
        await page.keyboard.press('Home')
        await expect(slider).toHaveValue('0')
        await expect(page.getByTestId('story-comparison-right')).toHaveCSS('clip-path', 'inset(0px 0px 0px 0%)')
        await page.getByRole('button', { name: 'Show left', exact: true }).click()
        await expect(slider).toHaveValue('100')
        await expect(page.getByTestId('story-comparison-right')).toHaveCSS('clip-path', 'inset(0px 0px 0px 100%)')
        await page.getByRole('button', { name: 'Show right', exact: true }).click()
        await expect(slider).toHaveValue('0')
        await page.getByRole('button', { name: 'Both', exact: true }).click()
        await expect(slider).toHaveValue('50')

        await page.getByRole('button', { name: 'Expand map', exact: true }).click()
        await expect(page.getByTestId('sidecar-story')).toHaveAttribute('data-exploring', 'true')
        await expect(page.getByTestId('sidecar-chapter-3')).toHaveAttribute('data-active-scene', 'true')
        expect(await primaryCanvas!.evaluate((node) => node.isConnected)).toBe(true)
        await expectAlignedMaps(page)
        await page.setViewportSize({ width: viewport.width + 40, height: viewport.height + 40 })
        await expectAlignedMaps(page)
        await page.getByRole('button', { name: 'Read story', exact: true }).click()
        await expect(page.getByTestId('sidecar-story')).toHaveAttribute('data-exploring', 'false')
        await expect(page.getByTestId('sidecar-chapter-3')).toHaveAttribute('data-active-scene', 'true')
        expect(await primaryCanvas!.evaluate((node) => node.isConnected)).toBe(true)
        await expectAlignedMaps(page)
        await selectChapter(page, example, 4)
        await expect(page.locator('.maplibregl-canvas')).toHaveCount(1)
        expect(await primaryCanvas!.evaluate((node) => node.isConnected)).toBe(true)

        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(
          1,
        )
        expect(consoleProblems).toEqual([])
        expect(localRequestFailures).toEqual([])
      } finally {
        await context.close()
      }
    })
  }
}
