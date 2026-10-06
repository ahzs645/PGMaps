import { expect, test, type Page } from '@playwright/test'
import type MapLibreGL from 'maplibre-gl'

declare global {
  interface Window {
    __efficiencyMap: MapLibreGL.Map
    __efficiencyUpdates: number
  }
}

async function stubBasemap(page: Page) {
  await page.route(/https:\/\/.*cartocdn.*\/style\.json/, (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [],
        glyphs: 'https://glyphs.test/{fontstack}/{range}.pbf',
      },
    }),
  )
  await page.route('https://glyphs.test/**', (route) => route.fulfill({ body: Buffer.alloc(0) }))
}

async function captureMap(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        let container = document.querySelector('.maplibregl-map')
        let fiberKey: string | undefined
        // PersistentMapProvider reparents a detached DOM node, so its nearest
        // React-owned ancestor carries the fiber rather than the map div itself.
        while (container) {
          fiberKey = Object.keys(container).find((key) => key.startsWith('__reactFiber$'))
          if (fiberKey) break
          container = container.parentElement
        }
        if (!container || !fiberKey) return false
        type Hook = { memoizedState?: unknown; next?: Hook }
        type Fiber = { memoizedState?: Hook; return?: Fiber }
        let node = (container as unknown as Record<string, Fiber>)[fiberKey]
        for (let depth = 0; node && depth < 100; depth++, node = node.return!) {
          for (let hook = node.memoizedState, index = 0; hook && index < 50; hook = hook.next, index++) {
            const value = hook.memoizedState as { current?: unknown } | undefined
            for (const candidate of [value, value?.current]) {
              const map = candidate as MapLibreGL.Map | undefined
              if (typeof map?.querySourceFeatures === 'function' && typeof map?.getStyle === 'function') {
                window.__efficiencyMap = map
                return map.loaded() && !map.isMoving()
              }
            }
          }
        }
        return false
      }),
    )
    .toBe(true)
}

function censusFeature(level: string) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { id: `${level}-1`, level, name: `${level} fixture`, population: 100 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-122.8, 53.9],
              [-122.7, 53.9],
              [-122.7, 54],
              [-122.8, 53.9],
            ],
          ],
        },
      },
    ],
  }
}

test('census fetches only the selected level and loads a second level on demand', async ({ page }) => {
  await stubBasemap(page)
  const requested: string[] = []
  await page.route('**/data/census/prince_george_*.geo.json', (route) => {
    const level = route
      .request()
      .url()
      .match(/prince_george_(\w+)\.geo\.json/)![1]
    requested.push(level)
    return route.fulfill({ json: censusFeature(level) })
  })
  await page.route('**/data/census/variables/catalog.json', (route) => route.fulfill({ json: { categories: [] } }))
  await page.goto('/census?level=da')
  await expect(page.getByText('1 of 1 units', { exact: true })).toBeVisible()
  await captureMap(page)
  expect(requested).toEqual(['da'])
  await page.getByRole('combobox', { name: 'Boundary level', exact: true }).click()
  await page.getByRole('option', { name: 'Census Tract (CT)', exact: true }).click()
  await expect(page).toHaveURL(/level=ct/)
  await expect(page.getByText('1 of 1 units', { exact: true })).toBeVisible()
  await expect.poll(() => requested).toEqual(['da', 'ct'])
  await page.getByRole('combobox', { name: 'Boundary level', exact: true }).click()
  await page.getByRole('option', { name: 'Dissemination Area (DA)', exact: true }).click()
  await expect(page).toHaveURL(/level=da/)
  await expect(page.getByText('1 of 1 units', { exact: true })).toBeVisible()
  await expect.poll(() => requested).toEqual(['da', 'ct'])
})

test('Explorer retains an unchanged dataset source during search and sorting', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await stubBasemap(page)
  await page.route('**/data/restaurants.json', (route) =>
    route.fulfill({
      json: ['Alpha Cafe', 'Beta Cafe'].map((name, index) => ({
        name,
        details_url: `https://inspections.test/cafe/${index}`,
        facility_type: 'Restaurant',
        address: 'Prince George',
        latitude: 53.91 + index * 0.001,
        longitude: -122.76,
        inspections: [],
        hazard_rating: 'Low',
      })),
    }),
  )
  await page.route('**/data/restaurant-classifications.json', (route) => route.fulfill({ json: {} }))
  await page.route('**/data/restaurant-location-overrides.json', (route) => route.fulfill({ json: {} }))
  await page.route('**/data/ui/restaurant-locations.json', (route) => route.fulfill({ json: {} }))
  await page.route('**/data/citypg/transit_bus_stops.geojson', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { StopID: 'bus1', StopName: 'Bus Stop' },
            geometry: { type: 'Point', coordinates: [-122.75, 53.91] },
          },
        ],
      },
    }),
  )
  await page.route('**/data/transit/prince_george_gtfs_summary.json', (route) => route.fulfill({ json: [] }))
  await page.goto('/explorer?datasets=restaurants,transitStops')
  await expect(page.getByText('3 items visible', { exact: true })).toBeVisible()
  await captureMap(page)
  await page.evaluate(() => {
    const map = window.__efficiencyMap
    window.__efficiencyUpdates = 0
    const entry = Object.entries(map.getStyle().sources).find(
      ([, spec]) =>
        spec.type === 'geojson' &&
        typeof spec.data === 'object' &&
        (spec.data as GeoJSON.FeatureCollection).features[0]?.properties?.datasetId === 'restaurants',
    )
    if (!entry) throw new Error('Restaurant source did not load')
    const source = map.getSource(entry[0]) as MapLibreGL.GeoJSONSource
    const original = source.setData
    source.setData = function (...args) {
      window.__efficiencyUpdates++
      return original.apply(this, args)
    }
  })
  await page.getByRole('textbox', { name: 'Search explorer items' }).fill('Cafe')
  await expect(page.getByText('2 items visible', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Sort explorer items' }).click()
  await page.getByRole('option', { name: 'Name', exact: true }).click()
  await expect(page).toHaveURL(/sort=name/)
  expect(await page.evaluate(() => window.__efficiencyUpdates)).toBe(0)
  await page.getByRole('textbox', { name: 'Search explorer items' }).fill('Alpha')
  await expect(page.getByText('1 item visible', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__efficiencyUpdates)).toBe(1)
  expect(errors).toEqual([])
})

test('donut markers ignore unrelated repaints and unchanged positions', async ({ page }) => {
  await stubBasemap(page)
  await page.goto('/foodmap')
  await expect(page.locator('.maplibregl-marker svg path').first()).toBeVisible()
  await captureMap(page)
  const counts = await page.evaluate(async () => {
    const map = window.__efficiencyMap
    let scans = 0,
      positions = 0
    const originalQuery = map.querySourceFeatures
    map.querySourceFeatures = function (...args) {
      scans++
      return originalQuery.apply(this, args)
    }
    const runtimeUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => url.includes('/maplibre-gl.js?'))!
    const runtime = (await import(runtimeUrl)).default as typeof import('maplibre-gl')
    const originalPosition = runtime.Marker.prototype.setLngLat
    runtime.Marker.prototype.setLngLat = function (...args) {
      positions++
      return originalPosition.apply(this, args)
    }
    // Consume any pending source event before measuring unrelated frames.
    map.fire('render')
    scans = 0
    positions = 0
    for (let i = 0; i < 60; i++) map.fire('render')
    const unrelatedScans = scans
    map.fire('move')
    map.fire('render')
    runtime.Marker.prototype.setLngLat = originalPosition
    return { unrelatedScans, relevantScans: scans, positions }
  })
  expect(counts.unrelatedScans).toBe(0)
  expect(counts.relevantScans).toBeGreaterThan(0)
  expect(counts.positions).toBe(0)
})

test('AQMap ring clusters release departed markers instead of retaining them across views', async ({ page }) => {
  await stubBasemap(page)
  const monitors = Array.from({ length: 20 }, (_, index) => ({
    id: String(index),
    name: `Monitor ${index}`,
    network: 'FEM',
    latitude: 53.91 + index * 0.001,
    longitude: -122.76,
    pm25Recent: 10,
    pm25_24hr: 10,
    status: 'active',
  }))
  await page.route('**/data/**', (route) => {
    const path = new URL(route.request().url()).pathname
    return path === '/data/recent/all/json' ? route.fulfill({ json: monitors }) : route.fulfill({ status: 404 })
  })
  await page.goto('/dev/aqmap?icons=ring')
  await expect(page.locator('.maplibregl-marker svg').first()).toBeVisible()
  await captureMap(page)
  const result = await page.evaluate(async () => {
    const map = window.__efficiencyMap
    const sourceId = 'aqmap-monitor-source-ring'
    const runtimeUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => url.includes('/maplibre-gl.js?'))!
    const runtime = (await import(runtimeUrl)).default as typeof import('maplibre-gl')
    const added: MapLibreGL.Marker[] = []
    const originalAdd = runtime.Marker.prototype.addTo
    runtime.Marker.prototype.addTo = function (...args) {
      added.push(this)
      return originalAdd.apply(this, args)
    }
    let clusterId = 10000
    const originalQuery = map.querySourceFeatures
    map.querySourceFeatures = function (id, options) {
      if (id !== sourceId) return originalQuery.call(this, id, options)
      return [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-122.76, 53.91] },
          properties: { cluster: true, cluster_id: clusterId, point_count: 20, band0: 20 },
        },
      ] as ReturnType<typeof originalQuery>
    }
    const reconcile = () => {
      map.fire('sourcedata', { sourceId })
      map.fire('render')
    }
    reconcile()
    const first = added.at(-1)!
    clusterId = 10001
    reconcile()
    const departed = !first.getElement().isConnected
    clusterId = 10000
    reconcile()
    const fresh = added.at(-1) !== first
    const count = document.querySelectorAll('.maplibregl-marker').length
    runtime.Marker.prototype.addTo = originalAdd
    map.querySourceFeatures = originalQuery
    return { departed, fresh, count }
  })
  expect(result).toEqual({ departed: true, fresh: true, count: 1 })
})
