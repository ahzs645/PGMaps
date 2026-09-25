import { readFile } from 'node:fs/promises'
import zlib from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'

// Production-preview caching would serve around the stubbed sources below.
test.use({ serviceWorkers: 'block' })

const PAGE_PATH = '/dev/forestry/visual-quality'

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/**
 * A 256×256 Terrarium tile of perfectly flat ground, so the expected answer is
 * geometry rather than whatever the real world does today. Terrarium packs
 * metres as `r * 256 + g + b / 256 - 32768`.
 */
function flatTerrariumTile(elevationMeters: number): Buffer {
  const packed = elevationMeters + 32768
  const red = Math.floor(packed / 256)
  const green = packed % 256

  const size = 256
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let row = 0; row < size; row += 1) {
    const offset = row * (size * 3 + 1)
    raw[offset] = 0 // filter: none
    for (let column = 0; column < size; column += 1) {
      const pixel = offset + 1 + column * 3
      raw[pixel] = red
      raw[pixel + 1] = green
      raw[pixel + 2] = 0
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const FLAT_TILE = flatTerrariumTile(800)

/**
 * An empty basemap style that actually finishes loading.
 *
 * `glyphs: ''` does not: MapLibre never resolves an empty glyph URL template, so
 * the style stays unloaded, `map.loaded()` never returns true, and the map
 * context's `isLoaded` stays false for the whole run. Everything guarded on it —
 * 3D terrain, hillshade, the 3D stand — then silently does nothing, and a test
 * that only reads sidebar text passes anyway. (`sprite: ''` is harmless; it was
 * the glyphs.)
 */
async function stubBasemap(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
}

async function stubTerrain(page: Page, status: 'ok' | 'fail' = 'ok') {
  await page.route('**/elevation-tiles-prod/terrarium/**', (route) =>
    status === 'ok'
      ? route.fulfill({ status: 200, contentType: 'image/png', body: FLAT_TILE })
      : route.fulfill({ status: 503, body: '' }),
  )
}

/** One rated unit and one unrated one, matching the shape DataBC returns. */
function inventoryFeature(properties: Record<string, unknown>, offsetLng: number) {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-122.6 + offsetLng, 53.86],
          [-122.45 + offsetLng, 53.86],
          [-122.45 + offsetLng, 53.93],
          [-122.6 + offsetLng, 53.93],
          [-122.6 + offsetLng, 53.86],
        ],
      ],
    },
    properties,
  }
}

async function stubInventory(page: Page, mode: 'covered' | 'empty' = 'covered') {
  const features =
    mode === 'empty'
      ? [inventoryFeature({ OBJECTID: 99, VLI_POLYGON_NO: 999 }, 10)]
      : [
          inventoryFeature(
            {
              OBJECTID: 1,
              VLI_POLYGON_NO: 1668,
              REC_EVQO_CODE: 'R',
              REC_VAC_FINAL_VALUE_CODE: 'L',
              REC_VSC_FINAL_VALUE_CODE: '2',
              SCENIC_AREA_IND: 'Y',
            },
            0,
          ),
          inventoryFeature({ OBJECTID: 2, VLI_POLYGON_NO: 1672, REC_VSC_FINAL_VALUE_CODE: 'W' }, 0.08),
        ]
  await page.route('**/data/forest/visual-inventory/manifest.json', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 2,
        retrievedAt: '2026-09-22T00:00:00Z',
        featureCount: features.length,
        simplification: { toleranceMetres: 0 },
        shards: [{ file: 'units-000.geojson.gz', featureCount: features.length }],
      },
    }),
  )
  await page.route('**/data/forest/visual-inventory/index.json.gz', (route) =>
    route.fulfill({
      json: features.map((f) => ({
        id: String(f.properties.OBJECTID),
        bbox: [f.geometry.coordinates[0][0][0], 53.86, f.geometry.coordinates[0][1][0], 53.93],
        shard: 'units-000.geojson.gz',
      })),
    }),
  )
  await page.route('**/data/forest/visual-inventory/units-000.geojson.gz', (route) =>
    route.fulfill({
      contentType: 'application/gzip',
      body: zlib.gzipSync(JSON.stringify({ type: 'FeatureCollection', features })),
    }),
  )
}

/** The lookup also asks for existing openings; keep the test off the network. */
async function stubHarvest(page: Page, features: unknown[] = []) {
  await page.route('**/bcgw_pub_whse_forest_vegetation/MapServer/4/query**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features } }),
  )
}

/** RESULTS forest cover, which the lookup pulls to draw the 3D stand. */
async function stubForestCover(page: Page, features: unknown[] = []) {
  await page.route('**/bcgw_pub_whse_forest_vegetation/MapServer/27/query**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features } }),
  )
}

/**
 * VRI rank-1, which the run asks for whenever the scene carries a landform: it
 * supplies the treed area the planimetric figure divides by. Un-stubbed, the
 * worker waits on a multi-megabyte live query.
 */
async function stubVegetation(page: Page, features: unknown[] = []) {
  await page.route('**/WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY/ows**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features, numberMatched: features.length } }),
  )
}

async function openPage(page: Page) {
  // The page restores its last scene from storage; tests want the sample.
  await page.addInitScript(() => window.localStorage.clear())
  await page.goto(PAGE_PATH)
  await expect(page.getByRole('heading', { name: 'Visual quality' })).toBeVisible()
  await openAllSteps(page)
}

/** The sidebar shows one handbook step at a time, as tabs; this brings one forward. */
async function showStep(page: Page, id: 'identify' | 'visit' | 'design' | 'assess' | 'rate') {
  const tab = page.locator(`[data-via-step="${id}"]`)
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(page.locator(`[data-via-panel="${id}"]`)).toBeVisible()
}

/**
 * Unfolds every folded section in every step, so tests can reach any control,
 * and leaves the Simulate step showing. Tests then switch steps with `showStep`.
 */
async function openAllSteps(page: Page) {
  await expect(page.locator('[data-via-step]')).toHaveCount(5)
  for (const id of ['identify', 'visit', 'design', 'assess', 'rate'] as const) {
    await showStep(page, id)
    const panel = page.locator(`[data-via-panel="${id}"]`)
    const folded = panel.locator('[data-forestry-disclosure][aria-expanded="false"]')
    while ((await folded.count()) > 0) await folded.first().click()
    for (const details of await panel.locator('details[data-forestry-disclosure]:not([open]) > summary').all()) await details.click()
  }
  await showStep(page, 'design')
}

/** What the map is actually doing, rather than what the sidebar says about it. */
async function readMapState(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('.maplibregl-map')
    if (!container) return null
    const fiberKey = Object.keys(container).find((key) => key.startsWith('__reactFiber$'))
    if (!fiberKey) return null

    let node = (container as unknown as Record<string, { memoizedState?: unknown; return?: unknown }>)[fiberKey]
    for (let depth = 0; node && depth < 200; depth += 1) {
      let hook = (node as { memoizedState?: { memoizedState?: unknown; next?: unknown } }).memoizedState
      for (let index = 0; hook && index < 40; index += 1) {
        const value = (hook as { memoizedState?: unknown }).memoizedState as { current?: Record<string, never> }
        const map = value?.current as unknown as {
          queryTerrainElevation?: unknown
          getTerrain?: () => unknown
          loaded?: () => boolean
          getLayer?: (id: string) => unknown
          getSource?: (id: string) => unknown
          getZoom?: () => number
          getCenter?: () => { lng: number; lat: number }
          getBearing?: () => number
          getPitch?: () => number
        }
        if (map?.queryTerrainElevation) {
          const tree = map.getLayer?.('forestry-trees') as
            | {
                implementation?: {
                  distanceRanges: number[][]
                  renderLayerCount: number
                  treeCount: number
                  nearTreeCount: number
                  coverageMeters: number
                  error: string | null
                }
              }
            | undefined
          return {
            loaded: Boolean(map.loaded?.()),
            terrain: Boolean(map.getTerrain?.()),
            hillshade: Boolean(map.getLayer?.('forestry-hillshade')),
            treeLayer: Boolean(map.getLayer?.('forestry-trees')),
            treeCount: tree?.implementation?.treeCount ?? 0,
            nearTreeCount: tree?.implementation?.nearTreeCount ?? 0,
            forestError: tree?.implementation?.error ?? null,
            forestDistanceRanges: tree?.implementation?.distanceRanges,
            forestRenderLayerCount: tree?.implementation?.renderLayerCount,
            forestReach: tree?.implementation?.coverageMeters ?? 0,
            zoom: map.getZoom?.() ?? 0,
            camera: {
              center: map.getCenter?.(),
              bearing: map.getBearing?.(),
              pitch: map.getPitch?.(),
              zoom: map.getZoom?.(),
            },
          }
        }
        hook = (hook as { next?: unknown }).next as typeof hook
      }
      node = (node as { return?: unknown }).return as typeof node
    }
    return null
  })
}

async function setNumberField(page: Page, label: string, value: string) {
  const field = page.locator('label', { hasText: label }).locator('input[type="number"]')
  await field.fill(value)
  await field.blur()
}

/**
 * The verdict scales are only shown once the numerical evidence is complete.
 * The stubbed vegetation query answers nothing, so the green base is unverified
 * and no existing-disturbance inventory was requested; both have to be stated
 * as scenario assumptions before a run reports percentages rather than a
 * provisional result with its numerical fields withheld.
 */
async function confirmScenarioAssumptions(page: Page) {
  await showStep(page, 'design')
  await page.locator('label', { hasText: 'Treat the entire active landform' }).locator('input[type="checkbox"]').check()
  await page
    .locator('label', { hasText: 'The included features represent the existing disturbance' })
    .locator('input[type="checkbox"]')
    .check()
}

test.beforeEach(async ({ page }) => {
  if (process.env.PGMAPS_FORESTRY_LIVE === '1') return
  await stubInventory(page)
  await stubHarvest(page)
  await stubForestCover(page)
  await page.route('**/bcgw_pub_whse_forest_vegetation/MapServer/20/query**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features: [] } }),
  )
})

test.describe('forestry visual quality', () => {
  test('opens on the sample scenario with a viewpoint and blocks', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    await showStep(page, 'identify')
    await expect(page.getByRole('button', { name: /Block A — west face/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Block B — over the height of land/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Tabor Mountain landform/ })).toBeVisible()
    // The scene's one landform is the active assessment unit without being asked.
    await expect(page.getByLabel('Active assessment landform').locator('option:checked')).toHaveText(
      'Tabor Mountain landform',
    )
    // The sample viewpoint is a driven length of road, not a single spot.
    await expect(page.getByText(/5 points · 9\.\d+ km/)).toBeVisible()
    await showStep(page, 'design')
    await expect(page.getByRole('button', { name: 'Run visibility' })).toBeEnabled()
  })

  test('reports every block as visible when nothing can block the view', async ({ page }) => {
    test.setTimeout(180_000)
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    // Flat ground plus an eye well above it leaves no terrain to hide behind,
    // and a long enough view distance to keep both blocks in range.
    await setNumberField(page, 'Eye height above the road', '500')
    await setNumberField(page, 'Max view distance', '40')

    // Without the assumptions stated the run is provisional and shows no scales.
    await showStep(page, 'design')
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Provisional result — PDF numerical fields withheld')).toBeVisible({
      timeout: 120_000,
    })
    await expect(page.getByText('Alteration in perspective view')).toHaveCount(0)

    // Stating them also changes the scene, so the earlier result is withdrawn
    // until a run matches it.
    await confirmScenarioAssumptions(page)
    await expect(page.getByText(/Scene changed — rerun the analysis/)).toBeVisible()
    await showStep(page, 'design')
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Alteration in perspective view')).toBeVisible({
      timeout: 120_000,
    })
    await expect(page.getByText('Scenario numerical fields available')).toBeVisible()

    // Both blocks, whole: a bare "100" would also match the chart's axis label,
    // so assert on the rows that only a fully visible block can produce. The
    // 40 km view distance above makes this the heaviest run in the file, and
    // the per-block rows land after the headline under parallel load, so these
    // get more than the default expect budget.
    await expect(page.getByText('131.2 ha of 131.2 ha')).toHaveCount(2, { timeout: 60_000 })
    await expect(page.getByText('100.0%')).toHaveCount(2, { timeout: 60_000 })

    // Both scales are reported, each against its own thresholds. Collapsing
    // them into one number is the mistake this page previously made.
    await expect(page.getByText('Alteration in perspective view')).toBeVisible()
    await expect(page.getByText('Planimetric denudation')).toBeVisible()
    await expect(page.getByText('Bare-earth terrain only', { exact: false })).toBeVisible()
  })

  test('walks the handbook steps to a Table 7 rating', async ({ page }) => {
    test.setTimeout(180_000)
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await page.addInitScript(() => window.localStorage.clear())
    await page.goto(PAGE_PATH)

    // The sample already has a road, blocks and a landform, so step 1 is done
    // and the headline points at the next step rather than at a rating.
    const rating = page.locator('[data-via-rating]')
    await expect(rating).toHaveAttribute('data-via-rating', 'none')
    await expect(page.locator('[data-via-panel="identify"] [data-step-status]')).toHaveAttribute(
      'data-step-status',
      'done',
    )
    // The page opens on the step to work on next, so the headline has no
    // "go to" prompt for it; from another step it offers one.
    await expect(page.locator('[data-via-step="visit"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Go to step 2' })).toHaveCount(0)
    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'Go to step 2' }).click()
    await expect(page.locator('[data-via-step="visit"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-via-step="assess"]')).toHaveAttribute('aria-selected', 'false')

    await openAllSteps(page)
    await confirmScenarioAssumptions(page)
    await showStep(page, 'design')
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Scenario numerical fields available')).toBeVisible({ timeout: 120_000 })
    const headline = page.getByRole('region', { name: 'VIA headline result' })
    await expect(headline.getByText(/^\d+\.\d%$/).first()).toBeVisible()

    // The ocular class is the reviewer's to give. Very easy to see, very large
    // and geometric is maximum modification, which cannot achieve partial
    // retention whatever the measured percentage.
    await showStep(page, 'assess')
    await page.getByLabel('Ease of seeing').selectOption('very-easy')
    await page.getByLabel('Scale relative to the landform').selectOption('very-large')
    await page.getByLabel('Shape', { exact: true }).selectOption('geometric')
    for (const label of [
      'Response to visual force lines',
      'Borrows from natural character',
      'Incorporates edge treatments',
      'Position on the landform',
      'Number, size and spacing',
    ]) {
      await page.getByLabel(label, { exact: true }).selectOption('0')
    }
    await page.getByLabel('Roads, landings and sidecast').selectOption('0')
    await page.getByLabel('Tree retention', { exact: true }).selectOption('low')
    await expect(rating).toHaveAttribute('data-via-rating', /^(not-met|clearly-not-met)$/)
    await expect(headline.getByText('Definition not achieved', { exact: true })).toBeVisible()

    // Placed on the class boundary, Table 7 calls it inconclusive.
    await page.getByLabel('Ease of seeing').selectOption('easy')
    await page.getByLabel('Scale relative to the landform').selectOption('medium')
    await page.getByLabel('Shape', { exact: true }).selectOption('natural')
    await page.locator('label', { hasText: 'On the class boundary.' }).locator('input[type="checkbox"]').check()
    await expect(rating).toHaveAttribute('data-via-rating', 'inconclusive')

    // A rating with its rationale finishes step 5.
    await showStep(page, 'rate')
    await page.getByLabel('Rationale', { exact: true }).fill('Opening follows the hollow; skyline left intact.')
    await expect(page.locator('[data-via-panel="rate"] [data-step-status]')).toHaveAttribute(
      'data-step-status',
      'done',
    )

    // The review is a record, not a run input: editing it must not stale the run.
    await expect(page.getByText(/Scene changed — rerun the analysis/)).toHaveCount(0)
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('pgmaps.forestry-visual-quality.v1') ?? '{}'),
    )
    expect(stored.viaReview).toMatchObject({ ocular: { visibleness: 'easy', onBoundary: true }, retention: 'low' })
  })

  test('reads a partial cut from Table 6 and retention from the blocks', async ({ page }) => {
    test.setTimeout(180_000)
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await page.addInitScript(() => window.localStorage.clear())
    await page.goto(PAGE_PATH)
    await openAllSteps(page)
    await confirmScenarioAssumptions(page)

    await showStep(page, 'identify')
    const system = page.getByLabel(/^Harvest system for /).first()
    const name = ((await system.getAttribute('aria-label')) ?? '').replace('Harvest system for ', '')

    // Retention is a record for Table 5, not a run input: it does not stale a run.
    await showStep(page, 'design')
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Scenario numerical fields available')).toBeVisible({ timeout: 120_000 })
    await showStep(page, 'identify')
    await system.selectOption('retention')
    // Area-weighted with the sample's clearcut blocks, so well over 22% here.
    await page.getByLabel(`Stand retained in ${name}`).fill('80')
    await expect(page.getByText(/Scene changed — rerun the analysis/)).toHaveCount(0)
    await expect(page.getByLabel('Tree retention', { exact: true }).locator('option').first()).toHaveText(/^From the blocks: .*retained \([−-]2\)$/)

    // A partial cut changes what the run counts as cleared, so it does stale it.
    await showStep(page, 'identify')
    await system.selectOption('partial')
    await expect(page.getByText(/Scene changed — rerun the analysis/).first()).toBeVisible()
    await showStep(page, 'design')
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Scenario numerical fields available')).toBeVisible({ timeout: 120_000 })
    const numerical = page.getByLabel('Numerical assessment')
    await showStep(page, 'assess')
    await expect(numerical.getByText(`Partial cut · ${name} (Table 6)`)).toBeVisible()
    await expect(numerical.getByText('needs volume and height')).toBeVisible()
    await showStep(page, 'identify')
    await page.getByLabel(`Volume removed from ${name}`).fill('40')
    await page.getByLabel(`Residual tree height in ${name}`).fill('25')
    await showStep(page, 'assess')
    await expect(numerical.getByText('+3.4%')).toBeVisible()
  })

  test('lines the road view up with a street-level field photo', async ({ page }) => {
    test.setTimeout(180_000)
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    // A photo on the sample road, looking east along it and tipped up 5°.
    const photoAt = [-122.62, 53.9085]
    const requests: string[] = []
    await page.route('**/graph.mapillary.com/**', (route) => {
      const url = route.request().url()
      requests.push(url)
      expect(route.request().headers().authorization).toBe('OAuth MLY|e2e-stub')
      if (url.includes('/images?') && url.includes('is_pano=true')) return route.fulfill({ json: { data: [] } })
      if (url.includes('/images?')) {
        return route.fulfill({
          json: {
            data: [
              {
                id: '1111111111',
                computed_geometry: { type: 'Point', coordinates: photoAt },
                computed_compass_angle: 100,
                captured_at: 1690318393383,
                is_pano: false,
              },
            ],
          },
        })
      }
      return route.fulfill({
        json: {
          id: '1111111111',
          computed_geometry: { type: 'Point', coordinates: photoAt },
          computed_compass_angle: 95,
          // Level camera, bearing 95°, pitched 5° up (OpenSfM angle-axis).
          computed_rotation: [1.104727, -1.205598, 1.31568],
          camera_type: 'perspective',
          camera_parameters: [0.6, 0, 0],
          captured_at: 1690318393383,
          creator: { username: 'e2e-photographer' },
          width: 4000,
          height: 3000,
          make: 'Test',
          model: 'Camera',
          is_pano: false,
          thumb_2048_url: 'https://photos.e2e.test/photo.png',
        },
      })
    })
    await page.route('https://photos.e2e.test/**', (route) =>
      route.fulfill({ contentType: 'image/png', body: FLAT_TILE }),
    )
    await openPage(page)

    await showStep(page, 'visit')
    const panel = page.getByLabel('Field photo')
    await panel.getByRole('button', { name: 'Find photos facing the cutblock' }).click()
    await expect(panel.getByText(/photos along the road look toward the cutblock/)).toBeVisible()

    await panel
      .getByLabel('Mapillary photo link or image key')
      .fill('https://www.mapillary.com/app/?pKey=1111111111&focus=photo')
    await panel.getByRole('button', { name: 'Load', exact: true }).click()
    await expect(panel.getByText('e2e-photographer · Mapillary · CC BY-SA 4.0').first()).toBeVisible()
    await expect(panel.getByText('80° × 64°')).toBeVisible()

    await panel.getByRole('button', { name: 'Line up the road view' }).click()
    const comparison = page.getByRole('region', { name: 'Photo comparison' })
    await expect(comparison).toBeVisible({ timeout: 120_000 })
    // The map camera takes the photo's bearing, pitch and lens: this is map
    // state, not the panel's description of it.
    await expect
      .poll(async () => (await readMapState(page))?.camera.bearing, { timeout: 30_000 })
      .toBeCloseTo(95, 0)
    await expect.poll(async () => (await readMapState(page))?.camera.pitch).toBeCloseTo(95, 0)

    // Nudging turns the camera, and closing ends the comparison.
    await comparison.getByRole('button', { name: 'Turn right' }).click()
    await comparison.getByRole('button', { name: 'Turn right' }).click()
    await expect.poll(async () => (await readMapState(page))?.camera.bearing).toBeCloseTo(96, 0)
    await comparison.getByRole('button', { name: 'Stop comparing' }).click()
    await expect(comparison).toHaveCount(0)
    expect(requests.some((url) => url.includes('MLY|'))).toBe(false)
  })

  test('writes the run up as a worksheet you can check the figures in', async ({ page }) => {
    test.setTimeout(180_000)
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    // Nothing to download before there is a run to write up.
    await expect(page.getByRole('button', { name: 'Download the worksheet' })).toHaveCount(0)

    // Well above the default 1.6 m, and inside the field's own 100 m ceiling.
    await setNumberField(page, 'Eye height above the road', '90')
    await confirmScenarioAssumptions(page)
    await showStep(page, 'design')
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Alteration in perspective view')).toBeVisible({ timeout: 120_000 })

    const downloaded = page.waitForEvent('download')
    await showStep(page, 'rate')
    await page.getByRole('button', { name: 'Download the worksheet' }).click()
    const download = await downloaded
    expect(download.suggestedFilename()).toMatch(/^visual-quality-worksheet-\d{4}-\d{2}-\d{2}\.md$/)

    const text = await readFile(await download.path(), 'utf8')
    expect(text.split('\n')[0]).toBe('# Visual Quality Effectiveness Evaluation — simulation draft')
    expect(text).toContain('FS1252 2008/04. Not a field evaluation')
    // Bound to the run: the active landform, the stated assumptions, and a
    // station row from the flat stub terrain at the corridor's first vertex.
    expect(text).toContain('Active landform: Tabor Mountain landform.')
    expect(text).toContain('Green denominator: confirmed-landform. Existing disturbance: scenario-only.')
    expect(text).toContain('Numerical form fields: available as modelled scenario estimates.')
    expect(text).toMatch(
      /\| 1 \| -122\.700000 \| 53\.915000 \| 800\.0 \| \d+\.\d\d \| \d+\.\d\d \| \d+\.\d\d \| \d+\.\d\d \| \S+ \|/,
    )
    // The field half stays blank rather than being inferred.
    expect(text).toContain('2.2.3 Basic VQC (ocular): ______. Not inferred from the numerical class.')
    expect(text).toContain('Signature: ______.')
  })

  test('refuses to report numbers when the terrain cannot be fetched', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page, 'fail')
    await stubVegetation(page)
    await openPage(page)

    await showStep(page, 'design')
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByLabel('Design and simulate').getByText(/terrain tiles loaded/)).toBeVisible({
      timeout: 120_000,
    })
    await expect(page.getByText('Alteration in perspective view')).toHaveCount(0)
  })

  test('adopts a BC inventory unit as the landform with its own rating', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await stubInventory(page)
    await stubHarvest(page)
    await stubForestCover(page)
    await openPage(page)

    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'Look up this view' }).click()
    await expect(page.getByText('2 units · 1 with an established objective · 1 with a VAC rating')).toBeVisible()

    // Unrated units are selectable too; missing objectives stay explicit.
    await expect(page.getByRole('button', { name: /VLI 1672/ })).toBeVisible()
    await page.getByRole('button', { name: /VLI 1668/ }).click()

    // The province's own objective and absorption rating come across, rather
    // than the page's defaults.
    const adopted = page.locator('li').filter({ hasText: 'VLI 1668 · R (established)' })
    await expect(adopted).toBeVisible()
    await expect(page.getByText('BC visual landscape inventory', { exact: false })).toBeVisible()
    await expect(adopted.locator('select[aria-label*="objective"]')).toHaveValue('retention')
    await expect(adopted.locator('select[aria-label*="absorption"]')).toHaveValue('low')
    // Adopting it makes it the active assessment landform, displacing the sample's.
    await expect(page.getByLabel('Active assessment landform').locator('option:checked')).toHaveText(
      'VLI 1668 · R (established)',
    )
  })

  test('automatically suggests and downloads nearby full-resolution boundaries without a live VLI query', async ({
    page,
  }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    let liveVliCalls = 0
    page.on('request', (request) => {
      if (request.url().includes('/MapServer/6/query')) liveVliCalls++
    })
    await openPage(page)
    const suggestions = page
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: /^Find a landform in the BC inventory$/ }) })
    await showStep(page, 'identify')
    await expect(suggestions.getByText('VLI 1668 · intersects road')).toBeVisible()
    await suggestions.getByLabel('Landform search area').selectOption('block')
    await showStep(page, 'identify')
    await expect(suggestions.getByText('VLI 1668 · contains search point')).toBeVisible()
    await suggestions.getByLabel('Landform search area').selectOption('road')
    await suggestions.getByRole('button', { name: 'Show boundary' }).first().click()
    await expect(page.getByLabel('Active assessment landform').locator('option:checked')).toHaveText(
      'Tabor Mountain landform',
    )
    const pending = page.waitForEvent('download')
    await suggestions.getByRole('button', { name: 'Download nearby inventory (GeoJSON)' }).click()
    const download = await pending
    const contents = JSON.parse(await readFile((await download.path())!, 'utf8'))
    expect(contents.features).toHaveLength(2)
    expect(contents.features[0].geometry.coordinates[0][0]).toEqual([-122.6, 53.86])
    await suggestions.getByRole('button', { name: 'Use candidate' }).first().click()
    await expect(page.getByLabel('Active assessment landform').locator('option:checked')).toHaveText(
      'VLI 1668 · R (established)',
    )
    await suggestions.getByRole('button', { name: 'Use candidate' }).first().click()
    await expect(
      page.getByLabel('Active assessment landform').locator('option', { hasText: 'VLI 1668 · R (established)' }),
    ).toHaveCount(1)
    expect(liveVliCalls).toBe(0)
  })

  test('says so plainly where the inventory has no coverage', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await stubInventory(page, 'empty')
    await stubHarvest(page)
    await stubForestCover(page)
    await openPage(page)

    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'Look up this view' }).click()
    await expect(page.getByText('No inventory boundaries intersect this map extent', { exact: false })).toBeVisible()
  })

  test('drives the corridor from eye level and reports what that point sees', async ({ page }) => {
    // Now that the stubbed style loads, this really does switch on 3D terrain
    // and render it on SwiftShader, which the 30 s default does not cover.
    test.setTimeout(180_000)
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    await setNumberField(page, 'Eye height above the road', '500')
    await setNumberField(page, 'Max view distance', '40')
    await confirmScenarioAssumptions(page)
    await showStep(page, 'design')
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Alteration in perspective view')).toBeVisible({
      timeout: 120_000,
    })

    await showStep(page, 'visit')
    await page.getByRole('button', { name: 'Look from the road' }).click()
    await expect(page.getByText(/Standing on the road ·/)).toBeVisible()
    await expect(page.getByText('Ground visible at nearest station')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Road view controls' })).toBeVisible()

    // Assert the map, not the copy: an eye-level view of flat sidebar text would
    // pass just as well with terrain switched off entirely.
    await expect.poll(async () => (await readMapState(page))?.terrain, { timeout: 60_000 }).toBe(true)
    expect((await readMapState(page))?.hillshade).toBe(true)
    // A horizon target kilometres away clips nearby trees even at the right altitude.
    await expect.poll(async () => (await readMapState(page))?.zoom, { timeout: 60000 }).toBeGreaterThan(18)

    // Playback lives on the road-view panel over the map, not in the sidebar.
    await expect(page.getByRole('region', { name: 'Road view controls' }).getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await page.getByRole('region', { name: 'Road view controls' }).getByRole('button', { name: 'Return to map' }).click()
    await expect(page.getByText(/Standing on the road ·/)).toHaveCount(0)
    // Leaving the drive puts the map back to a flat basemap.
    await expect.poll(async () => (await readMapState(page))?.terrain, { timeout: 30_000 }).toBe(false)
  })

  /**
   * On a phone the sheet covers the map, so opening the road view with it up
   * reads as nothing happening, and the drive's own controls used to float
   * over the sidebar instead of sitting in the map layer.
   */
  test('clears the phone sheet out of the road view and drives from the map', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    const handle = page.locator('[data-map-mobile-sheet-handle]')
    await handle.press('End')
    await confirmScenarioAssumptions(page)
    await showStep(page, 'design')
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Alteration in perspective view')).toBeVisible({ timeout: 120_000 })

    await showStep(page, 'visit')
    await page.getByRole('button', { name: 'Look from the road' }).click()
    // 0 is the collapsed peek: the sheet gets out of the way by itself.
    await expect(handle).toHaveAttribute('aria-valuenow', '0')

    const controls = page.getByRole('region', { name: 'Road view controls' })
    await expect(controls).toBeInViewport()
    // In the map layer, so the sheet is what covers it — not the other way round.
    const overlapWithSheet = () =>
      page.evaluate(() => {
        const panel = document.querySelector('[role="region"][aria-label="Road view controls"]')!
        const sheet = document.querySelector('[data-map-mobile-sheet="true"]')!
        return Math.round(Math.max(0, panel.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top))
      })
    await expect.poll(overlapWithSheet).toBeLessThanOrEqual(1)

    // Playback is reachable while the view is: the sidebar's own control is
    // behind the peek.
    await controls.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(controls.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await controls.getByRole('button', { name: 'Pause', exact: true }).click()

    await controls.getByRole('button', { name: 'Return to map' }).click()
    await expect(page.getByText(/Standing on the road ·/)).toHaveCount(0)
    // And the sidebar comes back rather than leaving the phone on a bare map.
    await expect(handle).toHaveAttribute('aria-valuenow', '2')
  })

  test('stands the timber up around the viewpoint', async ({ page }) => {
    // Placing forty thousand stems and rendering them in software is slow here.
    test.setTimeout(240_000)
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    await confirmScenarioAssumptions(page)
    await showStep(page, 'design')
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Alteration in perspective view')).toBeVisible({ timeout: 120_000 })

    // Preview defaults to forward-facing driving and illustrative timber.
    await showStep(page, 'visit')
    await page.getByRole('button', { name: 'Look from the road' }).click()
    await showStep(page, 'visit')
    await expect(page.getByLabel('Where to look')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Stable silhouettes' })).toBeVisible()
    // The region's mature median height from VRI (REGIONAL_STAND).
    await expect(page.getByLabel(/Stand height/)).toHaveValue('25')
    await expect(page.getByLabel(/Cleared width along the road/)).toBeVisible()

    // The layer reports what it drew, so a shader, buffer or atlas failure shows
    // up here as a count of zero or an error rather than a silently empty view.
    await expect(page.getByText(/stems standing around the camera/)).toBeVisible({ timeout: 90_000 })
    const stems = Number((await page.getByText(/stems standing around the camera/).innerText()).replace(/\D/g, ''))
    expect(stems).toBeGreaterThan(1000)
    await expect.poll(async () => (await readMapState(page))?.treeCount, { timeout: 60000 }).toBeGreaterThan(1000)
    await expect.poll(async () => (await readMapState(page))?.nearTreeCount, { timeout: 60000 }).toBeGreaterThan(50)
    expect((await readMapState(page))?.forestError).toBeNull()
    expect((await readMapState(page))?.forestReach).toBeGreaterThan(10000)
    // No separate close mesh may appear inside the persistent foreground.
    const forest = await readMapState(page)
    // Four bands: stem for stem to 300 m, then coarser shells holding the same closure.
    expect(forest?.forestRenderLayerCount).toBe(4)
    expect(forest?.forestDistanceRanges?.[0]).toEqual([-2, -1, 250, 300])
    expect(forest?.forestDistanceRanges?.slice(1).every((range) => range[0] >= 250)).toBe(true)
    // The same test exercises the default hybrid, billboard fallback and cleanup.
    await page.screenshot({ path: test.info().outputPath('forest-hybrid.png') })
    await page.getByRole('button', { name: 'Billboards', exact: true }).click()
    await expect.poll(async () => (await readMapState(page))?.treeCount, { timeout: 60000 }).toBeGreaterThan(1000)
    expect((await readMapState(page))?.nearTreeCount).toBe(0)
    expect((await readMapState(page))?.treeLayer).toBe(true)

    await page.getByRole('button', { name: /Standing timber: on/ }).click()
    await expect(page.getByText(/Bare ground/)).toBeVisible()
    await expect(page.getByLabel(/Stand height/)).toHaveCount(0)
    await expect.poll(async () => (await readMapState(page))?.treeLayer, { timeout: 30_000 }).toBe(false)
  })

  test('compares a roadside opening before and after harvest from the same eye', async ({ page }) => {
    test.setTimeout(180_000)
    // Opt in for an additional screenshot/acceptance run against live terrain.
    if (process.env.PGMAPS_FORESTRY_LIVE !== '1') {
      await stubBasemap(page)
      await stubTerrain(page)
      await stubVegetation(page)
    }
    await openPage(page)
    // The demo has no landform (its block stands on the valley floor), so it
    // goes straight into the road view rather than through the assessment steps.
    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'Roadside demo drive', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Road view controls' })).toBeVisible({ timeout: 60000 })
    await expect(page.getByText(/Opening on your right in 150 m/)).toBeVisible()
    const controls = page.getByRole('region', { name: 'Road view controls' })
    await controls.getByRole('button', { name: 'View opening', exact: true }).click()
    await expect(page.getByText(/Route position · 0.60/)).toBeVisible()
    await expect.poll(async () => (await readMapState(page))?.nearTreeCount, { timeout: 60000 }).toBeGreaterThan(100)
    await expect.poll(async () => Math.abs((await readMapState(page))?.camera.bearing ?? 0)).toBeGreaterThan(150)
    const after = await readMapState(page)
    const ratio = await page.getByText('Ground visible at nearest station', { exact: true }).locator('..').innerText()
    await page.screenshot({ path: test.info().outputPath('cutblock-after.png') })
    await controls.getByRole('button', { name: 'Before harvest', exact: true }).click()
    await expect(controls.getByRole('button', { name: 'Before harvest', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect
      .poll(async () => (await readMapState(page))?.nearTreeCount, { timeout: 60000 })
      .toBeGreaterThan(after!.nearTreeCount + 100)
    expect((await readMapState(page))?.camera).toEqual(after?.camera)
    expect(await page.getByText('Ground visible at nearest station', { exact: true }).locator('..').innerText()).toBe(
      ratio,
    )
    await page.screenshot({ path: test.info().outputPath('cutblock-before.png') })
    const before = await readMapState(page)
    await controls.getByRole('button', { name: 'After harvest', exact: true }).click()
    await expect.poll(async () => (await readMapState(page))?.nearTreeCount, { timeout: 60000 }).toBeGreaterThan(100)
    expect((await readMapState(page))?.nearTreeCount).toBeLessThan(before!.nearTreeCount)
    expect((await readMapState(page))?.camera).toEqual(after?.camera)
    expect((await readMapState(page))?.forestError).toBeNull()
    await controls.getByRole('button', { name: 'Replay approach', exact: true }).click()
    await expect(controls.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await showStep(page, 'visit')
    await expect(page.getByLabel('Where to look')).toHaveValue('')
    await controls.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(page.getByText(/Opening on your right in/)).toBeVisible()
  })

  test('previews and saves a comparison without opening the assessment steps', async ({ page }) => {
    test.setTimeout(180_000)
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await page.goto(PAGE_PATH)
    await expect(page.locator('[data-via-step="rate"]')).toHaveAttribute('aria-selected', 'false')
    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'Roadside demo drive', exact: true }).click()
    const controls = page.getByRole('region', { name: 'Road view controls' })
    await expect(controls).toBeVisible({ timeout: 60000 })
    await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60000 })
    await controls.getByLabel('Driving speed').selectOption('5')
    await expect(controls.getByLabel('Driving speed')).toHaveValue('5')
    const previousPosition = Number(await controls.getByLabel('Route position').inputValue())
    await controls.getByRole('button', { name: 'Forward 10 m', exact: true }).click()
    await expect(controls.getByLabel('Route position')).toHaveValue(String(previousPosition + 10))
    await controls.getByRole('button', { name: 'Back 10 m', exact: true }).click()
    await expect(controls.getByLabel('Route position')).toHaveValue(String(previousPosition))
    await controls.getByRole('button', { name: 'View opening', exact: true }).click()
    await controls.getByText('Viewpoints, save & display', { exact: true }).click()
    await expect(controls.getByRole('button', { name: 'Save viewpoint', exact: true })).toBeEnabled({ timeout: 60000 })
    await page.locator('canvas.maplibregl-canvas').press('ArrowRight')
    await controls.getByRole('button', { name: 'Save viewpoint', exact: true }).click()
    await expect(controls.getByText(/Saved View 1/)).toBeVisible()
    const savedCamera = (await readMapState(page))?.camera
    await controls.getByLabel('Route position', { exact: true }).press('End')
    await controls.getByLabel('Saved viewpoint').selectOption({ label: 'View 1 · 0.60 km' })
    await expect(controls.getByLabel('Route position', { exact: true })).toHaveValue('600')
    await expect.poll(async () => (await readMapState(page))?.camera.bearing).toBeCloseTo(savedCamera!.bearing!, 4)
    await expect(controls.getByRole('button', { name: 'Download image', exact: true })).toBeEnabled({ timeout: 60000 })
    const imageDownload = page.waitForEvent('download')
    await controls.getByRole('button', { name: 'Download image', exact: true }).click()
    const downloadedImage = await imageDownload
    await downloadedImage.saveAs(test.info().outputPath('saved-view.png'))
    const imageBytes = await readFile((await downloadedImage.path())!)
    expect(imageBytes.subarray(1, 4).toString()).toBe('PNG')
    const download = page.waitForEvent('download')
    await showStep(page, 'visit')
    await page.getByRole('button', { name: 'Download preview', exact: true }).click()
    const preview = await download
    const json = JSON.parse(await readFile((await preview.path())!, 'utf8'))
    expect(json.views).toHaveLength(1)
    expect(json.scene.settings.greenAreaConfirmed).toBe(false)
    await page.reload()
    await showStep(page, 'visit')
    await page.getByRole('button', { name: 'View 1 · 0.60 km', exact: true }).click()
    await expect(controls).toBeVisible({ timeout: 60000 })
    await expect(controls.getByLabel('Route position', { exact: true })).toHaveValue('600')
    await expect.poll(async () => (await readMapState(page))?.camera.bearing).toBeCloseTo(savedCamera!.bearing!, 4)
    await expect(page.locator('[data-via-step="rate"]')).toHaveAttribute('aria-selected', 'false')
    await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60000 })
    await page.screenshot({ path: test.info().outputPath('preview-workflow.png') })
    await controls.getByRole('button', { name: 'Return to map' }).click()
    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'New site', exact: true }).click()
    await showStep(page, 'visit')
    await expect(page.getByRole('button', { name: 'Reopen previous saved preview' })).toBeVisible()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Open saved preview', exact: true }).click()
    await (
      await chooser
    ).setFiles({ name: 'preview.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) })
    await page.getByRole('button', { name: 'View 1 · 0.60 km', exact: true }).click()
    await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60000 })
    await expect(controls.getByLabel('Route position', { exact: true })).toHaveValue('600')
    await expect.poll(async () => (await readMapState(page))?.camera.bearing).toBeCloseTo(savedCamera!.bearing!, 4)
  })

  test('keeps the simple setup, drawing and drive controls reachable on a phone', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await page.goto(PAGE_PATH)
    const handle = page.locator('[data-map-mobile-sheet-handle]')
    await expect(handle).toHaveAttribute('aria-valuenow', '2')
    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'New site', exact: true }).click()
    await page.getByRole('button', { name: 'Draw the road', exact: true }).click()
    await expect(handle).toHaveAttribute('aria-valuenow', '0')
    const drawing = page.getByRole('region', { name: 'Map drawing controls' })
    await expect(drawing).toBeInViewport()
    await drawing.getByRole('button', { name: 'Cancel drawing' }).click()
    await expect(handle).toHaveAttribute('aria-valuenow', '2')
    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'Roadside demo drive', exact: true }).click()
    const controls = page.getByRole('region', { name: 'Road view controls' })
    await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60000 })
    await expect(handle).toHaveAttribute('aria-valuenow', '0')
    // On a phone the panel opens folded to one bar, leaving the view clear.
    await expect(controls.getByRole('button', { name: 'Before harvest', exact: true })).toBeHidden()
    await controls.getByRole('button', { name: 'Show options', exact: true }).click()
    await controls.getByRole('button', { name: 'View opening', exact: true }).click()
    await controls.getByRole('button', { name: 'Before harvest', exact: true }).click()
    await controls.getByRole('button', { name: 'After harvest', exact: true }).click()
    await controls.getByRole('button', { name: 'Play', exact: true }).click()
    await controls.getByRole('button', { name: 'Pause', exact: true }).click()
    await controls.getByText('Viewpoints, save & display', { exact: true }).click()
    await expect(controls.getByRole('button', { name: 'Save viewpoint', exact: true })).toBeEnabled({ timeout: 60000 })
    await controls.getByRole('button', { name: 'Save viewpoint', exact: true }).click()
    await controls.getByText('Viewpoints, save & display', { exact: true }).click()
    await controls.getByRole('button', { name: 'Hide options', exact: true }).click()
    await expect(controls.getByRole('button', { name: 'Before harvest', exact: true })).toBeHidden()
    await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath('phone-preview.png') })
    await controls.getByRole('button', { name: 'Show options', exact: true }).click()
    await expect(controls.getByRole('button', { name: 'Before harvest', exact: true })).toBeVisible()
    await controls.getByRole('button', { name: 'Return to map', exact: true }).click()
    await expect(handle).toHaveAttribute('aria-valuenow', '2')
    await expect(page.locator('[data-via-step="rate"]')).toHaveAttribute('aria-selected', 'false')
  })

  test('loads existing forest automatically and recovers a missing planting source', async ({ page }) => {
    test.setTimeout(180_000)
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    const requests: string[] = []
    page.on('request', (request) => {
      if (/MapServer\/(4|20|27)\/query/.test(request.url())) requests.push(request.url())
    })
    await stubHarvest(page, [
      inventoryFeature({ OBJECTID: 1, HARVEST_MID_YEAR_CALENDAR: 2020, PERCENT_CLEARCUT: 100 }, 0),
    ])
    await stubForestCover(page, [
      inventoryFeature({ OBJECTID: 2, I_SPECIES_HEIGHT_1: 8, I_SPECIES_CODE_1: 'PL', REFERENCE_YEAR: 2015 }, 0),
    ])
    await page.route('**/bcgw_pub_whse_forest_vegetation/MapServer/20/query**', (route) =>
      route.fulfill({ status: 503, body: 'Unavailable' }),
    )
    await page.goto(PAGE_PATH)
    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'Roadside demo drive', exact: true }).click()
    const controls = page.getByRole('region', { name: 'Road view controls' })
    await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60000 })
    await controls.getByText('Viewpoints, save & display', { exact: true }).click()
    await expect(
      controls.getByText('0 recorded heights · 1 projected heights · 0 planting estimates · 1 harvest-age estimates', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(controls.getByRole('button', { name: 'Retry forest data' })).toBeVisible()
    await page.unroute('**/bcgw_pub_whse_forest_vegetation/MapServer/20/query**')
    await page.route('**/bcgw_pub_whse_forest_vegetation/MapServer/20/query**', (route) =>
      route.fulfill({
        json: {
          type: 'FeatureCollection',
          features: [
            inventoryFeature(
              {
                OBJECTID: 3,
                ACTIVITY_TREATMENT_UNIT_ID: 3,
                ATU_COMPLETION_DATE: Date.UTC(2021, 5, 1),
                SILV_TREE_SPECIES_CODE: 'SX',
                NUMBER_PLANTED: 10000,
              },
              0,
            ),
          ],
        },
      }),
    )
    await controls.getByRole('button', { name: 'Retry forest data' }).click()
    await expect(
      controls.getByText('0 recorded heights · 1 projected heights · 1 planting estimates · 1 harvest-age estimates', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 60000 })
    await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60000 })
    expect(requests.filter((url) => url.includes('/20/'))).toHaveLength(2)
    await controls.getByLabel('Project older heights to visual year', { exact: true }).uncheck()
    await expect(
      controls.getByText('1 recorded heights · 0 projected heights · 1 planting estimates · 1 harvest-age estimates', {
        exact: true,
      }),
    ).toBeVisible()
    await controls.getByLabel('Project older heights to visual year', { exact: true }).check()
    await expect.poll(async () => (await readMapState(page))?.nearTreeCount).toBeGreaterThan(0)
    await controls.getByLabel('Assumed height growth', { exact: true }).fill('0.5')
    await controls.getByText('Height sources and dates', { exact: true }).click()
    const expectedHeight = (0.3 + (new Date().getFullYear() - 2021) * 0.5).toFixed(1)
    await expect(
      controls.getByText(`planting estimate · ${expectedHeight} m · 2021 · planting-3`, { exact: true }),
    ).toBeVisible()
    await expect(controls.getByRole('button', { name: 'Save viewpoint', exact: true })).toBeEnabled({ timeout: 60000 })
    await controls.getByRole('button', { name: 'Save viewpoint', exact: true }).click()
    const download = page.waitForEvent('download')
    await showStep(page, 'visit')
    await page.getByRole('button', { name: 'Download preview', exact: true }).click()
    const data = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
    expect(data.views[0].growthMetersPerYear).toBe(0.5)
    expect(data.scene.targets.filter((t: { role: string }) => t.role === 'harvested')).toHaveLength(0)
    expect(data.scene.settings.greenAreaConfirmed).toBe(false)
    await page.screenshot({ path: test.info().outputPath('dynamic-forest.png') })
  })

  test('cancels preparation and can start again', async ({ page }) => {
    test.setTimeout(120_000)
    await stubBasemap(page)
    await stubVegetation(page)
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/elevation-tiles-prod/terrarium/**', async (route) => {
      await held
      await route.fulfill({ status: 200, contentType: 'image/png', body: FLAT_TILE }).catch(() => {})
    })
    await page.goto(PAGE_PATH)
    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'Roadside demo drive', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel preparation', exact: true }).click()
    await showStep(page, 'visit')
    await expect(page.getByRole('button', { name: 'Look from the road', exact: true })).toBeEnabled()
    release()
    await expect(page.getByRole('region', { name: 'Road view controls' })).toHaveCount(0)
    await showStep(page, 'visit')
    await page.getByRole('button', { name: 'Look from the road', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Road view controls' })).toBeVisible({ timeout: 60000 })
  })

  test('imports a road and cutblock and recovers from failed preparation', async ({ page }) => {
    test.setTimeout(180_000)
    await stubBasemap(page)
    await stubVegetation(page)
    await page.route('**/elevation-tiles-prod/terrarium/**', (route) =>
      route.fulfill({ status: 503, body: 'Unavailable' }),
    )
    await page.goto(PAGE_PATH)
    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'New site', exact: true }).click()
    await showStep(page, 'visit')
    await expect(page.getByRole('button', { name: 'Look from the road', exact: true })).toBeDisabled()
    const importGeometry = async (button: string, name: string, geometry: unknown) => {
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: button, exact: true }).click()
      await (
        await chooser
      ).setFiles({
        name,
        mimeType: 'application/geo+json',
        buffer: Buffer.from(JSON.stringify({ type: 'Feature', properties: { name }, geometry })),
      })
    }
    await showStep(page, 'identify')
    await importGeometry('Import a road (GeoJSON or zipped shapefile)', 'my-road.geojson', {
      type: 'LineString',
      coordinates: [
        [-122.64, 53.91],
        [-122.62, 53.91],
      ],
    })
    await importGeometry('Import', 'my-block.geojson', {
      type: 'Polygon',
      coordinates: [
        [
          [-122.635, 53.9098],
          [-122.625, 53.9098],
          [-122.625, 53.907],
          [-122.635, 53.907],
          [-122.635, 53.9098],
        ],
      ],
    })
    await showStep(page, 'visit')
    await page.getByRole('button', { name: 'Look from the road', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({ timeout: 60000 })
    await expect(page.getByRole('region', { name: 'Road view controls' })).toHaveCount(0)
    await page.unroute('**/elevation-tiles-prod/terrarium/**')
    await stubTerrain(page)
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Road view controls' })).toBeVisible({ timeout: 60000 })
    await expect.poll(async () => (await readMapState(page))?.terrain).toBe(true)
    await expect(page.locator('[data-via-step="rate"]')).toHaveAttribute('aria-selected', 'false')
  })

  test('says which roads see the block, or that none on screen do', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    // The stubbed basemap draws no roads, which is the same answer a real one
    // gives when zoomed out past where it draws them.
    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'Find them on screen' }).click()
    await expect(page.getByText(/No roads in view to test against|No road on screen can see it/)).toBeVisible({
      timeout: 120_000,
    })
  })

  /**
   * The layout hands a section one fixed-height sidebar slot that does not
   * scroll, so everything the sidebar renders has to sit inside the shell's own
   * scroll container. Stacked beside it, the assessment panel pushed the shell
   * — and the bottom of its scroll port — off the screen, and no amount of
   * scrolling brought the last sections back.
   */
  for (const [device, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['phone', { width: 390, height: 844 }],
  ] as const) {
    test(`keeps every sidebar section reachable and inside the panel width on ${device}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await stubBasemap(page)
      await stubTerrain(page)
      await stubVegetation(page)
      await openPage(page)

      if (device === 'phone') await page.locator('[data-map-mobile-sheet-handle]').press('End')

      // One scroll container: the assessment panel is inside it, not above it.
      const scroll = page.locator('[data-map-sidebar-scroll]')
      await expect(scroll.locator('section[aria-label="Assessment integrity and PDF export"]')).toHaveCount(1)

      const measure = () =>
        page.evaluate(() => {
          const slot = document.querySelector('[data-map-mobile-sheet-content]')!
          const port = document.querySelector('[data-map-sidebar-scroll]')!
          return {
            pastTheSlot: slot.scrollHeight - slot.clientHeight,
            pastTheWidth: port.scrollWidth - port.clientWidth,
            portBelowTheScreen: Math.round(port.getBoundingClientRect().bottom - window.innerHeight),
          }
        })

      // The phone sheet springs into place, so let it land before measuring.
      await expect.poll(async () => (await measure()).portBelowTheScreen).toBeLessThanOrEqual(1)
      // Every step, each on its own tab, fits the panel's width.
      for (const id of ['identify', 'visit', 'design', 'assess', 'rate'] as const) {
        await showStep(page, id)
        const fit = await measure()
        expect(fit.pastTheSlot, id).toBeLessThanOrEqual(1)
        expect(fit.pastTheWidth, id).toBeLessThanOrEqual(1)
      }

      // The last section — step 5's package — is reachable by scrolling, not merely present.
      await showStep(page, 'rate')
      await scroll.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await expect(page.getByRole('button', { name: 'Export the scene (JSON)' })).toBeInViewport()
    })
  }

  test('leaves a drawn corridor alone when no road is near it', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    await showStep(page, 'identify')
    await page.getByRole('button', { name: 'Snap to the nearest road' }).click()
    await expect(page.getByText(/No roads drawn at this zoom|Nothing within 250 m/)).toBeVisible()
    // The corridor is untouched, so the run it feeds is unchanged.
    await expect(page.getByText(/points · .* km/)).toBeVisible()
  })
})
