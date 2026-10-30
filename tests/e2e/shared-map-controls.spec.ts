import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
test.setTimeout(90_000)

const areas: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
  type: 'FeatureCollection',
  features: ['West', 'East'].map((name, index) => ({
    type: 'Feature',
    properties: { boundaryCode: String(index + 1), boundaryName: `Test ${name}`, name: `Test ${name}` },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-126 + index * 6, 53],
          [-125.8 + index * 6, 53],
          [-125.8 + index * 6, 53.2],
          [-126 + index * 6, 53.2],
          [-126 + index * 6, 53],
        ],
      ],
    },
  })),
}

async function offlineMap(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edf2f7' } }],
        glyphs: 'https://shared-map-test.invalid/{fontstack}/{range}.pbf',
      },
    }),
  )
  await page.route('https://shared-map-test.invalid/**', (route) => route.fulfill({ body: Buffer.alloc(0) }))
  return errors
}

// Read rendered MapLibre sources/layers, rather than trusting sidebar descriptions.
async function mapState(page: Page) {
  return page.evaluate(() => {
    type MapLike = {
      loaded: () => boolean
      getZoom: () => number
      getCenter: () => { lng: number; lat: number }
      getStyle: () => {
        layers: {
          id: string
          type: string
          source?: string
          layout?: { visibility?: string }
          paint?: Record<string, unknown>
        }[]
      }
      getSource: (id: string) => { serialize: () => { data?: GeoJSON.FeatureCollection } } | undefined
    }
    type Hook = { memoizedState?: unknown; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    const element = document.querySelector('.maplibregl-map')
    const key = element && Object.keys(element).find((name) => name.startsWith('__reactFiber$'))
    if (!element || !key) return null
    let node = (element as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; node && depth < 200; depth++, node = node.return!) {
      for (let hook = node.memoizedState, count = 0; hook && count < 50; count++, hook = hook.next) {
        const value = hook.memoizedState as { current?: MapLike; getStyle?: unknown } | undefined
        const map = typeof value?.getStyle === 'function' ? (value as MapLike) : value?.current
        if (typeof map?.getStyle !== 'function' || typeof map.getZoom !== 'function') continue
        const layers = map
          .getStyle()
          .layers.filter((layer) => layer.type === 'fill')
          .map((layer) => {
            const data = layer.source && map.getSource(layer.source)?.serialize().data
            return {
              id: layer.id,
              visibility: layer.layout?.visibility ?? 'visible',
              opacity: layer.paint?.['fill-opacity'],
              names:
                typeof data === 'object' && data?.features
                  ? data.features.map((feature) =>
                      String(feature.properties?.name ?? feature.properties?.boundaryName ?? ''),
                    )
                  : [],
            }
          })
        return { loaded: map.loaded(), zoom: map.getZoom(), center: map.getCenter(), layers }
      }
    }
    return null
  })
}

async function fullSheet(page: Page, mobile: boolean) {
  if (mobile) {
    const handle = page.locator('[data-map-mobile-sheet-handle]')
    await handle.press('End')
    await expect(handle).toHaveAttribute('aria-valuenow', '2')
  }
}

for (const mobile of [false, true]) {
  test.describe(mobile ? 'shared map controls on a phone' : 'shared map controls on desktop', () => {
    test.use({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
      hasTouch: mobile,
      isMobile: mobile,
    })

    test('boundary source selection, numeric opacity and focus update the real layer and camera', async ({ page }) => {
      const errors = await offlineMap(page)
      await page.route('**/data/boundaries/BCER/*.geojson', (route) => route.fulfill({ json: areas }))
      await page.goto('/dev/boundaries')
      await fullSheet(page, mobile)
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await page.getByRole('button', { name: /^BCER admin zones/ }).click()
      await page.getByRole('button', { name: /Done/ }).click()
      await expect(page.getByText('BCER admin zones · Administrative Zone · 2')).toBeVisible()
      await expect
        .poll(async () => (await mapState(page))?.layers.some((layer) => layer.names.includes('Test West')))
        .toBe(true)
      const before = (await mapState(page))!
      const opacity = page.getByRole('slider', { name: 'BCER admin zones fill opacity', exact: true })
      await opacity.press('Home')
      await expect(opacity).toHaveValue('0.04')
      await expect
        .poll(async () =>
          (await mapState(page))?.layers.some((layer) => layer.names.includes('Test West') && layer.opacity === 0.04),
        )
        .toBe(true)
      await page
        .getByRole('button', { name: /^Test West/ })
        .first()
        .click()
      await expect.poll(async () => (await mapState(page))?.zoom).toBeGreaterThan(before.zoom)
      await expect.poll(async () => Math.round((await mapState(page))?.center.lng ?? 0)).toBe(-126)
      expect(errors).toEqual([])
    })

    test('interaction layer toggles change rendered visibility and remain reachable through the sheet', async ({
      page,
    }) => {
      const errors = await offlineMap(page)
      await page.goto('/dev/interact')
      await fullSheet(page, mobile)
      const parks = page.getByRole('listitem').filter({ hasText: 'Parks' }).first()
      const toggle = parks.getByRole('button', { name: 'Toggle legend item visibility', exact: true })
      await expect
        .poll(async () =>
          (await mapState(page))?.layers.some(
            (layer) => layer.names.includes('Cottonwood Island Park') && layer.visibility === 'visible',
          ),
        )
        .toBe(true)
      await parks.hover()
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await expect
        .poll(async () =>
          (await mapState(page))?.layers
            .filter((layer) => layer.names.includes('Cottonwood Island Park'))
            .every((layer) => layer.visibility === 'none'),
        )
        .toBe(true)
      await toggle.click()
      await parks.getByRole('button', { name: 'Show only Parks', exact: true }).click()
      await expect
        .poll(async () =>
          (await mapState(page))?.layers.some(
            (layer) => layer.names.includes('Cottonwood Island Park') && layer.visibility === 'visible',
          ),
        )
        .toBe(true)
      await expect
        .poll(async () =>
          (await mapState(page))?.layers
            .filter((layer) => layer.names.includes('Downtown'))
            .every((layer) => layer.visibility === 'none'),
        )
        .toBe(true)
      if (mobile) {
        const handle = page.locator('[data-map-mobile-sheet-handle]')
        await handle.press('Home')
        await expect(handle).toHaveAttribute('aria-valuenow', '0')
        await handle.press('End')
        await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      }
      expect(errors).toEqual([])
    })

    test('uploaded data retain shared layer visibility and camera fit across panel changes', async ({ page }) => {
      const errors = await offlineMap(page)
      await page.goto('/dev/data')
      await fullSheet(page, mobile)
      await page.locator('[data-map-sidebar-wrapper]').getByRole('button', { name: 'Add data', exact: true }).click()
      const library = page.locator('[data-dev-data-library]')
      await library.getByLabel('Choose files to upload').setInputFiles({
        name: 'shared_areas.geojson',
        mimeType: 'application/geo+json',
        buffer: Buffer.from(JSON.stringify(areas)),
      })
      await expect(library).toBeHidden()
      const layer = page.locator('[data-layer-item="shared areas"]')
      await expect(layer).toContainText('2 rows')
      await expect
        .poll(async () => (await mapState(page))?.layers.some((item) => item.names.includes('Test West')))
        .toBe(true)
      await layer.getByRole('button', { name: 'Hide shared areas', exact: true }).click()
      await expect
        .poll(async () =>
          (await mapState(page))?.layers
            .filter((item) => item.names.includes('Test West'))
            .every((item) => item.visibility === 'none'),
        )
        .toBe(true)
      await layer.getByRole('button', { name: 'Show shared areas', exact: true }).click()
      await layer.getByRole('button', { name: 'shared areas options', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Zoom to layer', exact: true }).click()
      await expect.poll(async () => Math.round((await mapState(page))?.center.lng ?? 0)).toBe(-123)
      if (mobile) await page.locator('[data-map-mobile-sheet-handle]').press('Home')
      await expect
        .poll(async () =>
          (await mapState(page))?.layers.some(
            (item) => item.names.includes('Test West') && item.visibility === 'visible',
          ),
        )
        .toBe(true)
      expect(errors).toEqual([])
    })
  })
}
