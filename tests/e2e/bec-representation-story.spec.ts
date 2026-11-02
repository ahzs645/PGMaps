import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

type Story = {
  slug: string
  title: string
  sourceNote: string
  links: Array<{ label: string; href: string }>
  scenes: Array<{
    label: string
    title: string
    visibleLayerIds: string[]
    interaction?: { type: string; items: Array<{ label: string; sceneLabel: string }> }
    mapActions?: Array<{ label: string; visibleLayerIds: string[] }>
  }>
  workspace: {
    layers: Array<{
      id: string
      data: string
      idProperty: string
      labelProperty: string
      selectionTitleProperty?: string
      category?: { property: string; colors: Record<string, string> }
    }>
  }
}

const story = JSON.parse(
  readFileSync(new URL('../../public/data/projects/bec-protected-areas.json', import.meta.url), 'utf8'),
) as Story

// A ready canvas or narrative does not prove that study polygons reached MapLibre.
async function mapState(page: Page) {
  return page
    .locator('.maplibregl-map')
    .first()
    .evaluate((element) => {
      const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'))
      // This matches the existing sidecar suite without exposing a production map global.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let node = key ? (element as any)[key] : null
      for (let depth = 0; node && depth < 100; depth++, node = node.return) {
        let hook = node.memoizedState
        for (let index = 0; hook && index < 50; index++, hook = hook.next) {
          const map = hook.memoizedState?.current ?? hook.memoizedState
          if (typeof map?.getStyle !== 'function' || typeof map.queryRenderedFeatures !== 'function') continue
          const style = map.getStyle()
          const sources = Object.entries(style?.sources ?? {}).filter(
            ([, source]) => (source as { type?: string }).type === 'geojson',
          )
          const fills =
            style?.layers?.filter(
              (layer: { type: string; source?: string }) =>
                layer.type === 'fill' && sources.some(([id]) => id === layer.source),
            ) ?? []
          return {
            loaded: map.isStyleLoaded(),
            sourceProperties: sources
              .map(([id]) => (id.startsWith('fill-shared-') ? JSON.parse(id.slice('fill-shared-'.length))[1] : id))
              .sort(),
            populated:
              sources.length > 0 &&
              sources.every(
                ([, source]) => ((source as { data?: { features?: unknown[] } }).data?.features?.length ?? 0) > 0,
              ),
            fills: fills.length,
            rendered: map.queryRenderedFeatures(undefined, {
              layers: fills.map((layer: { id: string }) => layer.id),
            }).length,
          }
        }
      }
      return null
    })
}

async function expectLayers(page: Page, ids: string[]) {
  const properties = [
    ...new Set(ids.map((id) => story.workspace.layers.find((layer) => layer.id === id)!.idProperty)),
  ].sort()
  await expect
    .poll(async () => [...new Set((await mapState(page))?.sourceProperties ?? [])], { timeout: 30_000 })
    .toEqual(properties)
  if (ids.length) {
    await expect.poll(async () => (await mapState(page))?.populated).toBe(true)
    await expect.poll(async () => (await mapState(page))?.fills ?? 0).toBeGreaterThanOrEqual(ids.length)
    await expect.poll(async () => (await mapState(page))?.rendered ?? 0).toBeGreaterThan(0)
  }
}

async function selectChapter(page: Page, index: number) {
  const chapter = page.getByRole('navigation', { name: 'Story chapters' }).getByRole('button').nth(index)
  await chapter.click()
  await expect(chapter).toHaveAttribute('aria-current', 'step')
  await expect(page.getByTestId(`sidecar-chapter-${index}`)).toHaveAttribute('data-active-scene', 'true')
  await expect(
    page.getByTestId(`sidecar-chapter-${index}`).getByRole('heading', { name: story.scenes[index].title, exact: true }),
  ).toBeVisible()
  await expectLayers(page, story.scenes[index].visibleLayerIds)
}

async function useLocalBasemap(page: Page) {
  // Exercise actual local study data. External basemap availability is a separate check.
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e7eceb' } }],
      },
    }),
  )
}

async function selectVisiblePolygon(page: Page) {
  const firstLayer = story.workspace.layers.find((layer) => story.scenes[0].visibleLayerIds.includes(layer.id))!
  // Expansion resizes the persistent map. Let its resize observer and paint
  // settle before translating a rendered polygon into a screen click.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
  const target = await page
    .locator('.maplibregl-map')
    .first()
    .evaluate((element, titleProperty) => {
      const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let node = key ? (element as any)[key] : null
      for (let depth = 0; node && depth < 100; depth++, node = node.return) {
        let hook = node.memoizedState
        for (let index = 0; hook && index < 50; index++, hook = hook.next) {
          const map = hook.memoizedState?.current ?? hook.memoizedState
          if (typeof map?.queryRenderedFeatures !== 'function') continue
          if (map.isMoving()) return null
          const canvas = map.getCanvas() as HTMLCanvasElement
          const box = canvas.getBoundingClientRect()
          const fillIds = map
            .getStyle()
            .layers.filter((layer: { id: string; type: string }) => layer.type === 'fill')
            .map((layer: { id: string }) => layer.id)
          for (let y = 0.25; y <= 0.8; y += 0.08) {
            for (let x = 0.25; x <= 0.8; x += 0.08) {
              const px = box.width * x,
                py = box.height * y
              if (!document.elementFromPoint(box.x + px, box.y + py)?.classList.contains('maplibregl-canvas')) continue
              const feature = map
                .queryRenderedFeatures([px, py], { layers: fillIds })
                .find(
                  (value: { properties?: Record<string, unknown> }) =>
                    typeof value.properties?.[titleProperty] === 'string',
                )
              const stableInterior =
                feature &&
                [
                  [-3, 0],
                  [3, 0],
                  [0, -3],
                  [0, 3],
                ].every(
                  ([dx, dy]) =>
                    map.queryRenderedFeatures([px + dx, py + dy], { layers: fillIds })[0]?.properties?.[
                      titleProperty
                    ] === feature.properties[titleProperty],
                )
              if (stableInterior)
                return { x: box.x + px, y: box.y + py, title: String(feature.properties[titleProperty]) }
            }
          }
        }
      }
      return null
    }, firstLayer.selectionTitleProperty ?? firstLayer.labelProperty)
  expect(target, 'The displayed study polygons must have an exposed, selectable map location').not.toBeNull()
  await page.mouse.click(target!.x, target!.y)
  await expect(page.getByRole('button', { name: 'Close selected feature', exact: true })).toBeVisible()
  await expect(page.getByText(target!.title, { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Close selected feature', exact: true }).click()
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
]) {
  test(`BEC representation story renders study polygons and all chapters on ${viewport.name}`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000)
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    const problems: string[] = []
    const localFailures: string[] = []
    await useLocalBasemap(page)
    page.on('pageerror', (error) => problems.push(error.message))
    page.on('console', (message) => {
      if (
        ['error', 'warning'].includes(message.type()) &&
        !/GL Driver Message .*GPU stall due to ReadPixels/.test(message.text())
      )
        problems.push(message.text())
    })
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.startsWith('/data/bec-representation/') && response.status() >= 400)
        localFailures.push(`${response.status()}: ${response.url()}`)
    })
    try {
      await page.goto(`/projects/${story.slug}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('sidecar-cover')).toBeVisible()
      await expect(
        page.getByTestId('sidecar-cover').getByRole('heading', { name: story.title, exact: true }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Start reading', exact: true }).click()
      await expect(page.getByTestId('sidecar-cover')).toHaveCount(0)
      await expect(page.getByRole('navigation', { name: 'Story chapters' }).getByRole('button')).toHaveCount(
        story.scenes.length,
      )
      const legend = page.locator('.story-map-legend')
      const expandLegend = page.getByRole('button', { name: 'Expand legend', exact: true })
      if (await expandLegend.isVisible()) await expandLegend.click()
      await expect(legend.getByText('Below 1%', { exact: true })).toBeVisible()
      for (const internalKey of [
        'below-1',
        '1-to-5',
        '5-to-15',
        '15-to-30',
        '30-plus',
        'invalid-denominator',
        'not-in-study',
      ]) {
        await expect(legend.getByText(internalKey, { exact: true })).toHaveCount(0)
      }
      if (viewport.isMobile) await page.getByRole('button', { name: 'Collapse legend', exact: true }).click()
      const canvas = await page.locator('.maplibregl-canvas').elementHandle()
      expect(canvas).not.toBeNull()

      for (let index = 0; index < story.scenes.length; index++) await selectChapter(page, index)
      for (let index = story.scenes.length - 2; index >= 0; index--) await selectChapter(page, index)

      for (let index = 0; index < story.scenes.length; index++) {
        const scene = story.scenes[index]
        if (!scene.interaction?.items.length) continue
        for (const item of scene.interaction.items) {
          await selectChapter(page, index)
          await page.getByTestId(`sidecar-chapter-${index}`).getByRole('button', { name: item.label }).click()
          const target = story.scenes.findIndex((value) => value.label === item.sceneLabel)
          await expect(page.getByTestId(`sidecar-chapter-${target}`)).toHaveAttribute('data-active-scene', 'true')
          await expectLayers(page, story.scenes[target].visibleLayerIds)
        }
      }

      for (let index = 0; index < story.scenes.length; index++) {
        const scene = story.scenes[index]
        if (!scene.mapActions?.length) continue
        await selectChapter(page, index)
        for (const action of scene.mapActions) {
          await page
            .getByTestId(`sidecar-chapter-${index}`)
            .getByRole('button', { name: action.label, exact: true })
            .click()
          await expect(page.getByTestId(`sidecar-chapter-${index}`)).toHaveAttribute('data-active-scene', 'true')
          await expectLayers(page, action.visibleLayerIds)
        }
      }

      await selectChapter(page, 0)
      await page.getByRole('button', { name: 'Expand map', exact: true }).click()
      await expect(page.getByTestId('sidecar-story')).toHaveAttribute('data-exploring', 'true')
      await expectLayers(page, story.scenes[0].visibleLayerIds)
      expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
      await selectVisiblePolygon(page)
      await page.getByRole('button', { name: 'Read story', exact: true }).click()
      await expect(page.getByTestId('sidecar-story')).toHaveAttribute('data-exploring', 'false')

      await page.getByRole('button', { name: 'Sources and downloads', exact: true }).click()
      await expect(page.getByRole('dialog')).toContainText(story.sourceNote)
      for (const link of story.links.filter((value) => value.href.startsWith('/data/bec-representation/'))) {
        await expect(page.getByRole('dialog').getByRole('link', { name: link.label, exact: true })).toHaveAttribute(
          'href',
          link.href,
        )
        const response = await page.request.get(link.href)
        expect(response.ok(), `${link.label} is available from the same origin`).toBe(true)
        expect((await response.text()).trimStart().startsWith('<!doctype html>')).toBe(false)
      }
      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Download story JSON', exact: true }).click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toContain(story.slug)
      const downloaded = JSON.parse(readFileSync((await download.path())!, 'utf8')) as Story
      expect(downloaded.slug).toBe(story.slug)
      expect(downloaded.scenes).toHaveLength(story.scenes.length)
      await page.getByRole('button', { name: 'Close', exact: true }).click()

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      const deltas = await page.locator('.maplibregl-canvas').evaluate((element) => {
        const box = element.closest('.maplibregl-map')!.getBoundingClientRect()
        return [Math.abs(element.clientWidth - box.width), Math.abs(element.clientHeight - box.height)]
      })
      for (const delta of deltas) expect(delta).toBeLessThanOrEqual(2)
      await page.screenshot({ path: testInfo.outputPath(`bec-story-${viewport.name}.png`) })
      expect(problems).toEqual([])
      expect(localFailures).toEqual([])
    } finally {
      await context.close()
    }
  })
}

test('BEC story names a failed source and recovers through Retry layers', async ({ page }) => {
  await useLocalBasemap(page)
  const firstLayer = story.workspace.layers.find((layer) => story.scenes[0].visibleLayerIds.includes(layer.id))!
  let fail = true
  await page.route(`**${firstLayer.data}*`, (route) => {
    if (fail) return route.fulfill({ status: 503, body: 'Temporary test failure' })
    return route.continue()
  })
  await page.goto(`/projects/${story.slug}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Start reading', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not load')
  fail = false
  await page.getByRole('button', { name: 'Retry layers', exact: true }).click()
  await expectLayers(page, story.scenes[0].visibleLayerIds)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
