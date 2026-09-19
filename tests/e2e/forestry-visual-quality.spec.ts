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
  await page.route('**/bcgw_pub_whse_forest_vegetation/MapServer/6/query**', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features:
          mode === 'empty'
            ? []
            : [
                inventoryFeature(
                  {
                    VLI_POLYGON_NO: 1668,
                    REC_EVQO_CODE: 'R',
                    REC_VAC_FINAL_VALUE_CODE: 'L',
                    REC_VSC_FINAL_VALUE_CODE: '2',
                    SCENIC_AREA_IND: 'Y',
                  },
                  0,
                ),
                inventoryFeature({ VLI_POLYGON_NO: 1672, REC_VSC_FINAL_VALUE_CODE: 'W' }, 0.3),
              ],
      },
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
        }
        if (map?.queryTerrainElevation) {
          return {
            loaded: Boolean(map.loaded?.()),
            terrain: Boolean(map.getTerrain?.()),
            hillshade: Boolean(map.getLayer?.('forestry-hillshade')),
            treeLayer: Boolean(map.getLayer?.('forestry-trees')),
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
  await page.locator('label', { hasText: 'Treat the entire active landform' }).locator('input[type="checkbox"]').check()
  await page
    .locator('label', { hasText: 'The included features represent the existing disturbance' })
    .locator('input[type="checkbox"]')
    .check()
}

test.describe('forestry visual quality', () => {
  test('opens on the sample scenario with a viewpoint and blocks', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    await expect(page.getByText('Block A — west face')).toBeVisible()
    await expect(page.getByText('Block B — over the height of land')).toBeVisible()
    await expect(page.getByRole('button', { name: /Tabor Mountain landform/ })).toBeVisible()
    // The scene's one landform is the active assessment unit without being asked.
    await expect(page.getByLabel('Active assessment landform').locator('option:checked')).toHaveText(
      'Tabor Mountain landform',
    )
    // The sample viewpoint is a driven length of road, not a single spot.
    await expect(page.getByText(/5 points · 9\.\d+ km/)).toBeVisible()
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
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Provisional result — PDF numerical fields withheld')).toBeVisible({
      timeout: 120_000,
    })
    await expect(page.getByText('Alteration in perspective view')).toHaveCount(0)

    // Stating them also changes the scene, so the earlier result is withdrawn
    // until a run matches it.
    await confirmScenarioAssumptions(page)
    await expect(page.getByText(/Scene changed — rerun the analysis/)).toBeVisible()
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
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Alteration in perspective view')).toBeVisible({ timeout: 120_000 })

    const downloaded = page.waitForEvent('download')
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
    expect(text).toMatch(/\| 1 \| -122\.700000 \| 53\.915000 \| 800\.0 \| \d+\.\d\d \| \d+\.\d\d \| \d+\.\d\d \| \d+\.\d\d \| \S+ \|/)
    // The field half stays blank rather than being inferred.
    expect(text).toContain('2.2.3 Basic VQC (ocular): ______. Not inferred from the numerical class.')
    expect(text).toContain('Signature: ______.')
  })

  test('refuses to report numbers when the terrain cannot be fetched', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page, 'fail')
    await stubVegetation(page)
    await openPage(page)

    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText(/terrain tiles loaded/)).toBeVisible({ timeout: 120_000 })
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

    await page.getByRole('button', { name: 'Look up this view' }).click()
    await expect(page.getByText('2 units · 1 with an established objective · 1 with a VAC rating')).toBeVisible()

    // Only the rated unit is listed; the unrated one stays on the map.
    await expect(page.getByText('1 unrated units are on the map but not listed.')).toBeVisible()
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

  test('says so plainly where the inventory has no coverage', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await stubInventory(page, 'empty')
    await stubHarvest(page)
    await stubForestCover(page)
    await openPage(page)

    await page.getByRole('button', { name: 'Look up this view' }).click()
    await expect(page.getByText('No sensitivity units cover this view', { exact: false })).toBeVisible()
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
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Alteration in perspective view')).toBeVisible({
      timeout: 120_000,
    })

    await page.getByRole('button', { name: 'Look from the road' }).click()
    await expect(page.getByText('Standing on the road')).toBeVisible()
    await expect(page.getByText('Visible from here, right now')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Road view controls' })).toBeVisible()

    // Assert the map, not the copy: an eye-level view of flat sidebar text would
    // pass just as well with terrain switched off entirely.
    await expect.poll(async () => (await readMapState(page))?.terrain, { timeout: 60_000 }).toBe(true)
    expect((await readMapState(page))?.hillshade).toBe(true)

    await expect(page.getByRole('button', { name: 'Drive', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Back to the map' }).click()
    await expect(page.getByText('Standing on the road')).toHaveCount(0)
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
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Alteration in perspective view')).toBeVisible({ timeout: 120_000 })

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
    await expect(page.getByText('Standing on the road')).toHaveCount(0)
    // And the sidebar comes back rather than leaving the phone on a bare map.
    await expect(handle).toHaveAttribute('aria-valuenow', '1')
  })

  test('stands the timber up around the viewpoint', async ({ page }) => {
    // Placing forty thousand stems and rendering them in software is slow here.
    test.setTimeout(240_000)
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    await setNumberField(page, 'Eye height above the road', '500')
    await setNumberField(page, 'Max view distance', '40')
    await confirmScenarioAssumptions(page)
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Alteration in perspective view')).toBeVisible({ timeout: 120_000 })

    // Timber is illustrative and off until asked for: the run had no screening
    // stands, so the preview opens on bare terrain rather than a regional mix.
    await page.getByRole('button', { name: 'Look from the road' }).click()
    await expect(page.getByText(/Bare ground/)).toBeVisible()
    await expect(page.getByLabel(/Stand height/)).toHaveCount(0)

    await page.getByRole('button', { name: 'Stand the timber up' }).click()
    await expect(page.getByLabel(/Stand height/)).toHaveValue('28')
    await expect(page.getByLabel(/Cleared width along the road/)).toBeVisible()

    // The layer reports what it drew, so a shader, buffer or atlas failure shows
    // up here as a count of zero or an error rather than a silently empty view.
    await expect(page.getByText(/stems standing around the camera/)).toBeVisible({ timeout: 90_000 })
    const stems = Number((await page.getByText(/stems standing around the camera/).innerText()).replace(/\D/g, ''))
    expect(stems).toBeGreaterThan(1000)
    expect((await readMapState(page))?.treeLayer).toBe(true)

    await page.getByRole('button', { name: 'Stand the timber up' }).click()
    await expect(page.getByText(/Bare ground/)).toBeVisible()
    await expect(page.getByLabel(/Stand height/)).toHaveCount(0)
    await expect.poll(async () => (await readMapState(page))?.treeLayer, { timeout: 30_000 }).toBe(false)
  })

  test('says which roads see the block, or that none on screen do', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    // The stubbed basemap draws no roads, which is the same answer a real one
    // gives when zoomed out past where it draws them.
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
      const fit = await measure()
      expect(fit.pastTheSlot).toBeLessThanOrEqual(1)
      expect(fit.pastTheWidth).toBeLessThanOrEqual(1)

      // The last section is reachable by scrolling, not merely present.
      await scroll.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await expect(page.getByRole('button', { name: 'Find them on screen' })).toBeInViewport()
    })
  }

  test('leaves a drawn corridor alone when no road is near it', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    await page.getByRole('button', { name: 'Snap to the nearest road' }).click()
    await expect(page.getByText(/No roads drawn at this zoom|Nothing within 250 m/)).toBeVisible()
    // The corridor is untouched, so the run it feeds is unchanged.
    await expect(page.getByText(/points · .* km/)).toBeVisible()
  })
})
