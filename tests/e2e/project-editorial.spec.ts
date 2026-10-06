import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const graph = JSON.parse(readFileSync('public/data/story-documents/prague/story.json', 'utf8')) as {
  nodes: Record<string, { type: string; children?: string[]; data?: Record<string, unknown> }>
}
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`original Prague document preserves reading interactions at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(240_000)
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const exceptions: string[] = []
    const localFailures: string[] = []
    const foreignRuntime: string[] = []
    page.on('request', (request) => {
      if (/js\.arcgis\.com/.test(request.url())) foreignRuntime.push(request.url())
    })
    page.on('pageerror', (error) => exceptions.push(error.message))
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.startsWith('/data/story-documents/') && response.status() >= 400)
        localFailures.push(response.url())
    })
    await page.goto('/dev/projects/example-prague')
    await expect(page.getByTestId('editorial-cover').getByRole('heading', { name: 'The Diverse Prague' })).toBeVisible()
    const originalCover = Object.values(graph.nodes).find((node) => node.type === 'storycover')!.data!
    await expect(
      page.getByTestId('editorial-cover').getByText(String(originalCover.summary), { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByTestId('editorial-cover').getByText(String(originalCover.byline), { exact: true }),
    ).toBeVisible()
    await expect(page.locator('video')).toHaveAttribute('src', /\/data\/story-documents\/prague\/assets\/.*\.mp4/)
    await expect.poll(() => page.locator('video').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(1)
    await expect(page.getByRole('navigation', { name: 'Story chapters' }).getByRole('button')).toHaveCount(7)
    await verifyAppNavigation(page, viewport.width)
    await verifyOriginalText(page)
    await page.getByRole('button', { name: 'Start reading', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'What is urban diversity?', exact: true })).toBeVisible()

    // Every original narrative panel and photo-tour stop must be reachable.
    for (const [id, node] of Object.entries(graph.nodes).filter(
      ([, node]) => node.type === 'immersive' || node.type === 'tour',
    )) {
      const region = page.locator(`[id="${id}"]`)
      const slides = region.locator(node.type === 'tour' ? '.editorial-tour-stop' : '.editorial-slide')
      const count = node.type === 'tour' ? (node.data?.places as unknown[]).length : node.children!.length
      await expect(slides).toHaveCount(count)
      for (const index of [...Array(count).keys(), ...Array(count).keys()].map((i, n) =>
        n < count ? i : count - i - 1,
      )) {
        await slides.nth(index).evaluate((element) => element.scrollIntoView({ block: 'start' }))
        await expect(region).toHaveAttribute(
          node.type === 'tour' ? 'data-active-place' : 'data-active-slide',
          String(index),
        )
      }
    }
    const comparisonId = Object.entries(graph.nodes).find(
      ([, node]) =>
        node.type === 'immersive' &&
        node.children?.some((id) => graph.nodes[id].children?.some((child) => graph.nodes[child].type === 'swipe')),
    )![0]
    const comparison = page.locator(`[id="${comparisonId}"]`)
    await comparison
      .locator('.editorial-slide')
      .first()
      .evaluate((element) => element.scrollIntoView({ block: 'start' }))
    const divider = comparison.getByTestId('editorial-swipe-slider')
    await divider.focus()
    await divider.press('End')
    await expect(divider).toHaveAttribute('aria-valuenow', '100')
    await divider.press('Home')
    await expect(divider).toHaveAttribute('aria-valuenow', '0')
    await comparison.getByRole('button', { name: /Expand media/ }).click()
    await expect(page.getByRole('dialog', { name: 'Expanded story media' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('navigation', { name: 'Story chapters' }).getByRole('button', { name: 'Author team' }).click()
    await expect(page.getByRole('heading', { name: 'Author team' })).toBeVisible()
    expect(
      await page.getByTestId('editorial-story').evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true)
    expect(exceptions).toEqual([])
    expect(localFailures).toEqual([])
    expect(foreignRuntime).toEqual([])
    await verifyAppNavigation(page, viewport.width)
    await page.getByRole('button', { name: 'The Diverse Prague: Return to top', exact: true }).click()
    await expect(page.getByTestId('editorial-cover')).toBeInViewport()
    await page.getByRole('button', { name: /Back to example/ }).click()
    await expect(page).toHaveURL(/collection=example/)
  })
}

// Inspect the actual MapLibre instance; a ready container alone does not prove
// that the authored layers and camera reached the native renderer.
async function nativeMapState(locator: Locator, observePaint = false) {
  return locator.evaluate((element, observePaint) => {
    const key = Object.keys(element).find((key) => key.startsWith('__reactFiber$'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fiber = key ? (element as any)[key] : null
    for (let depth = 0; fiber && depth < 60; depth++, fiber = fiber.return) {
      let hook = fiber.memoizedState
      for (let index = 0; hook && index < 40; index++, hook = hook.next) {
        const candidate = hook.memoizedState?.current ?? hook.memoizedState
        if (candidate && typeof candidate.getZoom === 'function' && typeof candidate.getStyle === 'function') {
          if (observePaint && !candidate.testBackgroundColors) {
            candidate.testBackgroundColors = []
            candidate.on('render', () => {
              if (candidate.getLayer('pgmaps-story-background'))
                candidate.testBackgroundColors.push(
                  candidate.getPaintProperty('pgmaps-story-background', 'background-color'),
                )
            })
          }
          const center = candidate.getCenter()
          return {
            backgroundColors: candidate.testBackgroundColors as string[] | undefined,
            zoom: candidate.getZoom() as number,
            center: [center.lng, center.lat] as [number, number],
            sourceCounts: Object.fromEntries(
              Object.entries(candidate.getStyle()?.sources ?? {}).map(([id, source]) => [
                id,
                (source as { data?: { features?: unknown[] } }).data?.features?.length ?? 0,
              ]),
            ),
            layers:
              candidate
                .getStyle()
                ?.layers?.map((layer: { id: string; type: string; paint?: Record<string, unknown> }) => ({
                  id: layer.id,
                  type: layer.type,
                  paint: layer.paint,
                  renderedFeatures:
                    layer.type === 'fill'
                      ? (candidate.queryRenderedFeatures(undefined, { layers: [layer.id] }).length as number)
                      : 0,
                })) ?? [],
          }
        }
      }
    }
    return null
  }, observePaint)
}

async function verifyOriginalText(page: Page) {
  // Every source text block is rendered, including narrative paragraphs and tour
  // descriptions that simple chapter-count assertions would miss.
  const blocks = Object.entries(graph.nodes)
    .filter(([, node]) => node.type === 'text')
    .map(([id, node]) => ({ id, html: String(node.data?.text ?? '') }))
  const differences = await page.getByTestId('editorial-story').evaluate((story, blocks) => {
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
    return blocks.flatMap(({ id, html }) => {
      const expected = normalize(new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '')
      const actual = story.querySelector(`[id="${id}"]`)
      return actual && normalize(actual.textContent ?? '') === expected ? [] : [id]
    })
  }, blocks)
  expect(differences, 'all 118 original text blocks render without truncating or rewriting content').toEqual([])
}

async function verifyAppNavigation(page: Page, width: number) {
  if (width >= 768) {
    const brand = page.getByRole('link', { name: 'PGMaps', exact: true })
    await expect(brand).toBeVisible()
    await expect(brand).toHaveAttribute('href', '/')
    // Trial clicks verify pointer ownership without leaving the current chapter.
    await brand.click({ trial: true })
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Home', exact: true })
      .click({ trial: true })
  } else {
    const menu = page.getByRole('button', { name: 'Main menu', exact: true })
    await menu.click()
    await expect(page.getByTestId('mobile-nav-menu')).toBeVisible()
    await page.getByTestId('mobile-nav-menu').getByRole('link', { name: 'Home', exact: true }).click({ trial: true })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('mobile-nav-menu')).toHaveCount(0)
    await expect(menu).toBeFocused()
  }
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Prague inline action changes the native MapLibre viewpoint at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120_000)
    const renderedServices = new Set<string>()
    const originalServices = ['UAP_Storymapa_SidlistniPrstenec', 'UAP_Storymapa_TaxonomickyUsporadaneUrbanniVzorce_3']
    page.on('response', (response) => {
      if (!response.ok() || !/\/tile\//.test(response.url())) return
      for (const service of originalServices) if (response.url().includes(`/${service}/`)) renderedServices.add(service)
    })
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/dev/projects/example-prague')
    const sidecar = page.locator('#n-pcY7hL')
    await sidecar
      .locator('.editorial-slide')
      .first()
      .evaluate((element) => element.scrollIntoView({ block: 'start' }))
    const map = sidecar.getByTestId('editorial-map')
    await expect(map).toHaveAttribute('data-state', 'ready', { timeout: 90_000 })
    await expect(map.locator('.maplibregl-canvas')).toBeVisible()
    await expect.poll(() => nativeMapState(map)).not.toBeNull()
    const initial = (await nativeMapState(map))!
    expect(initial.layers.length).toBeGreaterThan(1)
    await expect.poll(() => [...renderedServices].sort(), { timeout: 30_000 }).toEqual([...originalServices].sort())
    await sidecar.getByRole('button', { name: 'structures 12 + 13', exact: true }).click()
    // The authored scale changes by a factor of four, or two native zoom levels.
    await expect.poll(async () => (await nativeMapState(map))!.zoom).toBeCloseTo(initial.zoom + 2, 1)
    await expect(sidecar).toHaveAttribute('data-active-slide', '0')
  })
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Prague tour polygons and original popup render natively at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const queryCounts: number[] = []
    page.on('response', async (response) => {
      if (
        !response.ok() ||
        !response.url().includes('UAP_storymapa_lokalni_index_rozmanitosti_zastavby_WFL1/FeatureServer/1/query')
      )
        return
      try {
        const result = await response.json()
        queryCounts.push(result.features?.length ?? 0)
      } catch {
        /* Navigating away may cancel a completed response body. */
      }
    })
    await page.goto('/dev/projects/example-prague')
    const tour = page.locator('#n-Or5kxQ')
    await tour
      .locator('.editorial-tour-stop')
      .first()
      .evaluate((element) => element.scrollIntoView({ block: 'start' }))
    const map = tour.getByTestId('editorial-map')
    await expect(map).toHaveAttribute('data-engine', 'maplibre')
    const layerId = 'editorial-source-494695100a5b41319757c3a5262455c8'
    await expect
      .poll(
        async () =>
          (await nativeMapState(map))?.layers.find((layer: { id: string }) => layer.id === layerId)?.renderedFeatures ??
          0,
        { timeout: 90_000 },
      )
      .toBeGreaterThan(0)
    expect(queryCounts.some((count) => count > 0)).toBe(true)
    const layer = (await nativeMapState(map))!.layers.find((layer: { id: string }) => layer.id === layerId)!
    expect(layer.type).toBe('fill')
    const original = JSON.parse(
      readFileSync('public/data/story-documents/prague/maps/1e679b95db3e4710855af2ca7fe5bbf9.json', 'utf8'),
    )
    const renderer = original.operationalLayers[0].layerDefinition.drawingInfo.renderer
    const paint = JSON.stringify(layer.paint?.['fill-color'])
    expect(paint).toContain(renderer.field)
    for (const band of renderer.classBreakInfos) {
      expect(paint).toContain(String(band.classMaxValue))
      const [r, g, b, a] = band.symbol.color
      expect(paint).toContain(`rgba(${r},${g},${b},${a / 255})`)
    }
    await verifyOriginalFeaturePopup(page, map, layerId, original.operationalLayers[0].popupInfo)
    await tour.getByRole('button', { name: 'Stop 2', exact: true }).click()
    await expect(tour).toHaveAttribute('data-active-place', '1')
    await expect
      .poll(
        async () =>
          (await nativeMapState(map))?.layers.find((layer: { id: string }) => layer.id === layerId)?.renderedFeatures ??
          0,
      )
      .toBeGreaterThan(0)
  })
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Prague chapter navigation reaches its target with normal motion at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/dev/projects/example-prague')
    const chapters = page.getByRole('navigation', { name: 'Story chapters' })
    const sourceNavigation = Object.values(graph.nodes).find((node) => node.type === 'navigation')!
    const links = sourceNavigation.data!.links as { nodeId: string }[]
    for (const index of [2, 6, 0]) {
      await chapters.getByRole('button').nth(index).click()
      await expect(page.locator(`[id="${links[index].nodeId}"]`)).toBeInViewport({ timeout: 20_000 })
    }
    await page.getByRole('button', { name: 'The Diverse Prague: Return to top', exact: true }).click()
    await expect(page.getByTestId('editorial-cover')).toBeInViewport()
    await verifyAppNavigation(page, viewport.width)
  })
}

async function verifyOriginalFeaturePopup(
  page: Page,
  map: Locator,
  layerId: string,
  popupInfo: {
    title: string
    popupElements: {
      fieldInfos: {
        fieldName: string
        label: string
        visible: boolean
        format?: { places?: number; digitSeparator?: boolean }
      }[]
    }[]
  },
  pointerMap: Locator = map,
) {
  const target = await map.evaluate((element, layerId) => {
    const key = Object.keys(element).find((key) => key.startsWith('__reactFiber$'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fiber = key ? (element as any)[key] : null
    for (let depth = 0; fiber && depth < 60; depth++, fiber = fiber.return) {
      let hook = fiber.memoizedState
      for (let index = 0; hook && index < 40; index++, hook = hook.next) {
        const candidate = hook.memoizedState?.current ?? hook.memoizedState
        if (!candidate || typeof candidate.queryRenderedFeatures !== 'function') continue
        const canvas = candidate.getCanvas()
        const bounds = canvas.getBoundingClientRect()
        // Canvas origins can be fractional. Test actual screen pixels and the
        // polygon interior so browser rounding cannot turn a hit into a miss.
        for (let y = 40; y < canvas.clientHeight - 40; y += 4) {
          for (let x = 40; x < canvas.clientWidth - 40; x += 4) {
            const pageX = Math.round(bounds.left + x),
              pageY = Math.round(bounds.top + y)
            if (pageX < 0 || pageY < 0 || pageX >= innerWidth || pageY >= innerHeight) continue
            if (!document.elementFromPoint(pageX, pageY)?.classList.contains('maplibregl-canvas')) continue
            const px = pageX - bounds.left,
              py = pageY - bounds.top
            const hit = candidate.queryRenderedFeatures([px, py], { layers: [layerId] })[0]
            if (!hit) continue
            const id = hit.properties.FID ?? hit.properties.OBJECTID
            const interior = [
              [-2, 0],
              [2, 0],
              [0, -2],
              [0, 2],
            ].every(([dx, dy]) => {
              const neighbor = candidate.queryRenderedFeatures([px + dx, py + dy], { layers: [layerId] })[0]
              return neighbor && (neighbor.properties.FID ?? neighbor.properties.OBJECTID) === id
            })
            if (interior) return { x: pageX, y: pageY }
          }
        }
      }
    }
    return null
  }, layerId)
  expect(target).not.toBeNull()
  const detailsRequest = page.waitForResponse(
    (response) =>
      /\/FeatureServer\/\d+\/query$/.test(new URL(response.url()).pathname) &&
      new URL(response.url()).searchParams.has('objectIds'),
    { timeout: 15_000 },
  )
  await expect(pointerMap.locator('.maplibregl-canvas')).toBeVisible()
  // A locator click may scroll an oversized sticky canvas and alter its camera.
  await page.mouse.click(target!.x, target!.y)
  const response = await detailsRequest
  expect(response.ok()).toBe(true)
  // Progressive pages may change the topmost polygon between hit sampling and
  // the pointer event; the popup must match the feature the real click selected.
  const selectedObjectId = new URL(response.url()).searchParams.get('objectIds')
  const attributes = (await response.json()).features[0].attributes as Record<string, unknown>
  const objectIdField = new URL(response.url()).searchParams.get('outFields')!.split(',')[0]
  expect(String(attributes[objectIdField])).toBe(selectedObjectId)
  const popup = page.getByTestId('editorial-feature-popup')
  await expect(popup).toBeVisible()
  await expect(popup.getByRole('status')).toHaveCount(0)
  const fields = popupInfo.popupElements.flatMap((element) => element.fieldInfos).filter((field) => field.visible)
  const formatted = (name: string) => {
    const value = attributes[name]
    const field = fields.find((field) => field.fieldName === name)
    return value === null || value === undefined
      ? '—'
      : typeof value === 'number'
        ? value.toLocaleString('en-CA', {
            useGrouping: field?.format?.digitSeparator ?? false,
            ...(field?.format?.places !== undefined
              ? { minimumFractionDigits: field.format.places, maximumFractionDigits: field.format.places }
              : { maximumFractionDigits: 20 }),
          })
        : String(value)
  }
  await expect(popup).toContainText(popupInfo.title.replace(/\{([^}]+)\}/g, (_, name: string) => formatted(name)))
  for (const field of fields) {
    await expect(popup).toContainText(field.label)
    await expect(popup).toContainText(formatted(field.fieldName))
  }
  await page.screenshot({ path: '/tmp/pgmaps-native-feature-popup.png' })
  await popup.getByRole('button', { name: 'Close details', exact: true }).click({ timeout: 10_000 })
  await expect(popup).toHaveCount(0)
}

test('Prague comparison forwards feature clicks to the revealed native map', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/dev/projects/example-prague')
  const section = page.locator('#n-JXRUzL')
  await section
    .locator('.editorial-slide')
    .nth(3)
    .evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await expect(section).toHaveAttribute('data-active-slide', '3')
  const comparison = section.getByTestId('editorial-swipe')
  const slider = comparison.getByTestId('editorial-swipe-slider')
  await slider.focus()
  await slider.press('Home')
  const right = comparison
    .getByTestId('editorial-map')
    .filter({ has: page.locator('[data-map-layout-root]') })
    .nth(1)
  const maps = comparison.getByTestId('editorial-map')
  const original = JSON.parse(
    readFileSync('public/data/story-documents/prague/maps/f7855f008ebd45e3882afb0b642b73fb.json', 'utf8'),
  )
  const layerId = `editorial-source-${original.operationalLayers[0].id}`
  await expect
    .poll(
      async () =>
        (await nativeMapState(right))?.layers.find((layer: { id: string }) => layer.id === layerId)?.renderedFeatures ??
        0,
      { timeout: 90_000 },
    )
    .toBeGreaterThan(0)
  await verifyOriginalFeaturePopup(page, right, layerId, original.operationalLayers[0].popupInfo, maps.first())
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Prague branch scrolling retains its canvas without loading screens at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const exceptions: string[] = []
    page.on('pageerror', (error) => exceptions.push(error.message))
    // Deterministic service responses isolate canvas lifetime from remote latency.
    let releaseTiles!: () => void
    const initialTiles = new Promise<void>((resolve) => {
      releaseTiles = resolve
    })
    await page.route(/^https:\/\//, async (route) => {
      const url = route.request().url()
      if (url.includes('/tile/')) {
        await initialTiles
        await route.fulfill({
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQERH5DwABuAE8a9JwDAAAAABJRU5ErkJggg==',
            'base64',
          ),
        })
      } else if (url.includes('/styles/root.json')) {
        await route.fulfill({ json: { version: 8, sources: {}, layers: [] } })
      } else if (url.includes('/MapServer')) {
        await route.fulfill({
          json: { tileInfo: { spatialReference: { wkid: 3857 }, cols: 256, lods: [{ level: 0 }, { level: 19 }] } },
        })
      } else await route.continue()
    })
    let releaseNext!: () => void
    const nextDocument = new Promise<void>((resolve) => {
      releaseNext = resolve
    })
    let requestedNext!: () => void
    const requested = new Promise<void>((resolve) => {
      requestedNext = resolve
    })
    await page.route('**/maps/ba3a2ac114384e97a2407b90069727de.json', async (route) => {
      requestedNext()
      await nextDocument
      await route.continue()
    })
    await page.goto('/dev/projects/example-prague')
    const section = page.locator('#n-pcY7hL')
    const slides = section.locator('.editorial-slide')
    const map = section.getByTestId('editorial-map')
    await slides.first().evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible()
    // Even the first load must not mount the globe or cover the canvas.
    await expect(map.getByRole('status', { name: 'Loading map data', exact: true })).toHaveCount(0)
    await expect(map.getByText('Loading original map…', { exact: true })).toHaveClass('sr-only')
    releaseTiles()
    await expect(map).toHaveAttribute('data-state', 'ready')
    await nativeMapState(map, true)
    const canvas = await map.locator('canvas.maplibregl-canvas').elementHandle()
    expect(canvas).not.toBeNull()
    await slides.nth(1).evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await requested
    // Hold the next document indefinitely: the previous map must remain visible.
    await expect(map.getByText('Updating map…', { exact: true })).toBeVisible()
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
    await expect(map.getByText('Loading original map…', { exact: true })).toHaveCount(0)
    await expect(map.getByRole('status', { name: 'Loading map data', exact: true })).toBeHidden()
    releaseNext()
    for (const index of [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0]) {
      await slides.nth(index).evaluate((element) => element.scrollIntoView({ block: 'start' }))
      await expect(section).toHaveAttribute('data-active-slide', String(index))
      await expect(map).toHaveAttribute('data-state', 'ready')
      expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
      await expect(map.getByText('Loading original map…', { exact: true })).toHaveCount(0)
      await expect(map.getByRole('status', { name: 'Loading map data', exact: true })).toBeHidden()
      const itemId = await map.getAttribute('data-map-item')
      const original = JSON.parse(readFileSync(`public/data/story-documents/prague/maps/${itemId}.json`, 'utf8'))
      for (const layer of original.operationalLayers) {
        await expect
          .poll(async () => (await nativeMapState(map))?.layers.map((entry: { id: string }) => entry.id))
          .toContain(`editorial-source-${layer.id}`)
      }
    }
    expect((await nativeMapState(map))?.backgroundColors).toContain('#f4f5f2')
    expect((await nativeMapState(map))?.backgroundColors).not.toContain('#343737')
    expect(exceptions).toEqual([])
  })
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Prague comparison drag preserves cameras and queries only settled views at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let queries = 0
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route(/^https:\/\//, async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.includes('/tile/')) {
        await route.fulfill({
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQERH5DwABuAE8a9JwDAAAAABJRU5ErkJggg==',
            'base64',
          ),
        })
      } else if (url.pathname.includes('/styles/root.json')) {
        await route.fulfill({ json: { version: 8, sources: {}, layers: [] } })
      } else if (url.pathname.endsWith('/query')) {
        queries++
        await route.fulfill({
          json: {
            type: 'FeatureCollection',
            exceededTransferLimit: false,
            features: [
              {
                type: 'Feature',
                properties: { OBJECTID: 1, cluster: 12, POCET_PODL: 3 },
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [14, 49.8],
                      [15, 49.8],
                      [15, 50.4],
                      [14, 50.4],
                      [14, 49.8],
                    ],
                  ],
                },
              },
            ],
          },
        })
      } else if (url.pathname.includes('/FeatureServer/')) {
        await route.fulfill({
          json: {
            geometryType: 'esriGeometryPolygon',
            objectIdField: 'OBJECTID',
            drawingInfo: {
              renderer: {
                type: 'simple',
                symbol: { type: 'esriSFS', style: 'esriSFSSolid', color: [30, 160, 110, 255] },
              },
            },
          },
        })
      } else if (url.pathname.includes('/MapServer')) {
        await route.fulfill({
          json: { tileInfo: { spatialReference: { wkid: 3857 }, cols: 256, lods: [{ level: 0 }, { level: 19 }] } },
        })
      } else await route.continue()
    })
    await page.goto('/dev/projects/example-prague')
    const section = page.locator('#n-JXRUzL')
    await section
      .locator('.editorial-slide')
      .nth(3)
      .evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await expect(section).toHaveAttribute('data-active-slide', '3')
    const reveal = section.getByTestId('editorial-swipe')
    const maps = reveal.getByTestId('editorial-map')
    for (const map of [maps.first(), maps.nth(1)]) {
      await expect(map).toHaveAttribute('data-state', 'ready')
      await expect(map).toHaveAttribute('data-features-loading', 'false')
    }
    await expect.poll(() => queries).toBeGreaterThanOrEqual(2)
    const before = await nativeMapState(maps.first())
    const canvas = await maps.first().locator('canvas.maplibregl-canvas').elementHandle()
    const bounds = (await reveal.boundingBox())!
    const slider = reveal.getByRole('slider')
    const y = Math.max(bounds.y + 20, Math.min(viewport.height - 30, bounds.y + bounds.height / 2))
    const beforeDragQueries = queries
    await page.mouse.move(bounds.x + bounds.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * 0.8, y, { steps: 20 })
    await page.mouse.up()
    await expect(slider).toHaveAttribute('aria-valuenow', '80')
    await expect(reveal.getByTestId('editorial-swipe-right')).toHaveCSS('clip-path', /inset\(0px 0px 0px 80%\)/)
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
    expect((await nativeMapState(maps.first()))?.center).toEqual(before?.center)
    expect((await nativeMapState(maps.first()))?.zoom).toEqual(before?.zoom)
    expect(queries, 'revealing pixels must not request map data').toBe(beforeDragQueries)

    // A continuous pan must not turn mirrored jumpTo moveends into a request per frame.
    const beforePanQueries = queries
    await page.mouse.move(bounds.x + bounds.width * 0.25, y)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * 0.25 + 55, y + 15, { steps: 25 })
    expect(queries, 'no viewport queries while the pointer is still panning').toBe(beforePanQueries)
    await page.mouse.up()
    await expect.poll(() => queries).toBeGreaterThan(beforePanQueries)
    for (const map of [maps.first(), maps.nth(1)]) await expect(map).toHaveAttribute('data-features-loading', 'false')
    expect(queries - beforePanQueries, 'one request for each of the two feature layers').toBe(2)
    const primary = await nativeMapState(maps.first())
    const secondary = await nativeMapState(maps.nth(1))
    expect(primary?.center).not.toEqual(before?.center)
    expect(secondary?.center[0]).toBeCloseTo(primary!.center[0], 6)
    expect(secondary?.center[1]).toBeCloseTo(primary!.center[1], 6)
    expect(secondary?.zoom).toBeCloseTo(primary!.zoom, 6)
    if (viewport.width < 768) {
      const scrollTop = await page.getByTestId('editorial-story').evaluate((element) => element.scrollTop)
      const touch = await page.context().newCDPSession(page)
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: bounds.x + bounds.width * 0.8, y }],
      })
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: bounds.x + bounds.width * 0.3, y }],
      })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(slider).toHaveAttribute('aria-valuenow', '30')
      expect(await page.getByTestId('editorial-story').evaluate((element) => element.scrollTop)).toBe(scrollTop)
      expect((await nativeMapState(maps.first()))?.center).toEqual(primary?.center)
      await touch.detach()
    }
    await slider.focus()
    await slider.press('Home')
    await expect(slider).toHaveAttribute('aria-valuenow', '0')
    await slider.press('End')
    await expect(slider).toHaveAttribute('aria-valuenow', '100')
    expect(errors).toEqual([])
  })
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Three city perspectives share PGMaps cartography at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const sourceBasemaps: string[] = []
    const errors: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/resources/styles/root.json')) sourceBasemaps.push(request.url())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/dev/projects/example-prague')
    for (const id of ['n-Or5kxQ', 'n-VsipbN', 'n-KKi8wX']) {
      const tour = page.locator(`#${id}`)
      await tour
        .locator('.editorial-tour-stop')
        .first()
        .evaluate((el) => el.scrollIntoView({ block: 'start' }))
      const map = tour.getByTestId('editorial-map')
      await expect(map).toHaveAttribute('data-basemap', 'pgmaps')
      await expect
        .poll(
          async () => {
            const state = await nativeMapState(map)
            return state?.layers.some(
              (layer: { id: string; renderedFeatures: number }) =>
                layer.id.startsWith('editorial-source-') && layer.renderedFeatures > 0,
            )
          },
          { timeout: 60_000 },
        )
        .toBe(true)
      await expect
        .poll(async () =>
          (await nativeMapState(map))?.layers.some((layer: { id: string }) => layer.id === 'pgmaps-story-roads'),
        )
        .toBe(true)
      await expect(map).toHaveAttribute('data-features-loading', 'false', { timeout: 60_000 })
      await expect(map.getByRole('alert')).toHaveCount(0)
    }
    expect(sourceBasemaps).toEqual([])
    expect(errors).toEqual([])
  })
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Story theme follows the app without reloading map data at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    let queries = 0
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (request.url().includes('/query?')) queries++
    })
    await page.goto('/dev/projects/example-prague')
    const story = page.getByTestId('editorial-story')
    const tour = page.locator('#n-Or5kxQ')
    await tour
      .locator('.editorial-tour-stop')
      .first()
      .evaluate((el) => el.scrollIntoView({ block: 'start' }))
    const map = tour.getByTestId('editorial-map')
    await expect(map).toHaveAttribute('data-state', 'ready')
    await expect
      .poll(
        async () =>
          (await nativeMapState(map))?.layers.some(
            (l: { id: string; renderedFeatures: number }) =>
              l.id.startsWith('editorial-source-') && l.renderedFeatures > 0,
          ),
        { timeout: 60_000 },
      )
      .toBe(true)
    await expect(map).toHaveAttribute('data-features-loading', 'false', { timeout: 60_000 })
    const before = await nativeMapState(map)
    const canvas = await map.locator('canvas.maplibregl-canvas').elementHandle()
    const scroll = await story.evaluate((el) => el.scrollTop)
    const settledQueries = queries
    for (const [theme, background, mapColor] of [
      ['light', 'rgb(255, 255, 255)', '#f4f5f2'],
      ['dark', 'rgb(0, 0, 0)', '#343737'],
    ]) {
      if (viewport.width < 768) await page.getByRole('button', { name: 'Main menu', exact: true }).click()
      await page.getByRole('button', { name: 'Toggle theme', exact: true }).click()
      await expect(page.locator('html')).toHaveClass(new RegExp(theme))
      await expect(story).toHaveCSS('background-color', background)
      await expect(tour.locator('.editorial-tour-narrative')).toHaveCSS('background-color', background)
      await expect
        .poll(
          async () =>
            (await nativeMapState(map))?.layers.find((l: { id: string }) => l.id === 'pgmaps-story-background')
              ?.paint?.['background-color'],
        )
        .toBe(mapColor)
      expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true)
      const state = await nativeMapState(map)
      expect(state?.center).toEqual(before?.center)
      expect(state?.zoom).toEqual(before?.zoom)
      expect(await story.evaluate((el) => el.scrollTop)).toBe(scroll)
      expect(queries).toBe(settledQueries)
      await expect(page.locator('.editorial-cover')).toHaveCSS('color', 'rgb(255, 255, 255)')
    }
    expect(errors).toEqual([])
  })
}

for (const width of [1440, 390]) {
  test(`Slow zoom refresh retains buildings and reuses completed views at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let slow = false
    let queries = 0
    let nextPageRequested = false
    let release!: () => void
    const waitForPage = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = JSON.parse(
      readFileSync('public/data/story-documents/prague/maps/1e679b95db3e4710855af2ca7fe5bbf9.json', 'utf8'),
    )
    const sourceId = `editorial-source-${original.operationalLayers[0].id}`
    const score = original.operationalLayers[0].layerDefinition.drawingInfo.renderer.field
    await page.route('**/FeatureServer/1/query?*', async (route) => {
      queries++
      const offset = Number(new URL(route.request().url()).searchParams.get('resultOffset'))
      if (slow && offset) {
        nextPageRequested = true
        await waitForPage
      }
      await route.fulfill({
        json: {
          type: 'FeatureCollection',
          exceededTransferLimit: slow && !offset,
          features: Array.from({ length: slow && !offset ? 2 : 1 }, (_, i) => ({
            type: 'Feature',
            properties: { OBJECTID: offset + i, [score]: 0.5 },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [14.3, 50],
                  [14.6, 50],
                  [14.6, 50.2],
                  [14.3, 50.2],
                  [14.3, 50],
                ],
              ],
            },
          })),
        },
      })
    })
    await page.goto('/dev/projects/example-prague')
    const tour = page.locator('#n-Or5kxQ')
    await tour
      .locator('.editorial-tour-stop')
      .first()
      .evaluate((el) => el.scrollIntoView({ block: 'start' }))
    const map = tour.getByTestId('editorial-map')
    await expect.poll(async () => (await nativeMapState(map))?.sourceCounts[sourceId]).toBe(1)
    await expect(map).toHaveAttribute('data-features-loading', 'false')
    slow = true
    await map.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect.poll(() => nextPageRequested).toBe(true)
    await expect(map).toHaveAttribute('data-features-loading', 'true')
    expect((await nativeMapState(map))?.sourceCounts[sourceId]).toBe(1)
    release()
    await expect.poll(async () => (await nativeMapState(map))?.sourceCounts[sourceId]).toBe(3)
    await expect(map).toHaveAttribute('data-features-loading', 'false')
    const beforeReturn = queries
    await map.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await expect.poll(async () => (await nativeMapState(map))?.sourceCounts[sourceId]).toBe(1)
    expect(queries).toBe(beforeReturn)
  })
}
