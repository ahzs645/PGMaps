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

async function stubBasemap(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: { version: 8, sources: {}, layers: [], glyphs: '', sprite: '' },
    }),
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

async function setNumberField(page: Page, label: string, value: string) {
  const field = page.locator('label', { hasText: label }).locator('input[type="number"]')
  await field.fill(value)
  await field.blur()
}

test.describe('forestry visual quality', () => {
  test('opens on the sample scenario with a viewpoint and blocks', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    await expect(page.getByText('Block A — west face')).toBeVisible()
    await expect(page.getByText('Block B — over the height of land')).toBeVisible()
    await expect(page.getByText('Tabor Mountain landform')).toBeVisible()
    // The sample viewpoint is a driven length of road, not a single spot.
    await expect(page.getByText(/5 points · 9\.\d+ km/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run visibility' })).toBeEnabled()
  })

  test('reports every block as visible when nothing can block the view', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    // Flat ground plus an eye well above it leaves no terrain to hide behind,
    // and a long enough view distance to keep both blocks in range.
    await setNumberField(page, 'Eye height above the road', '500')
    await setNumberField(page, 'Max view distance', '40')

    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Alteration in perspective view')).toBeVisible({
      timeout: 120_000,
    })

    // Both blocks, whole: a bare "100" would also match the chart's axis label,
    // so assert on the rows that only a fully visible block can produce.
    await expect(page.getByText('131.2 ha of 131.2 ha')).toHaveCount(2)
    await expect(page.getByText('100.0%')).toHaveCount(2)

    // Both scales are reported, each against its own thresholds. Collapsing
    // them into one number is the mistake this page previously made.
    await expect(page.getByText('Alteration in perspective view')).toBeVisible()
    await expect(page.getByText('Planimetric denudation')).toBeVisible()
    await expect(page.getByText('Bare-earth terrain only', { exact: false })).toBeVisible()
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
    await expect(page.getByText('VLI 1668 · R (established)')).toBeVisible()
    await expect(page.getByText('BC visual landscape inventory', { exact: false })).toBeVisible()
    const adopted = page.locator('li').filter({ hasText: 'VLI 1668 · R (established)' })
    await expect(adopted.locator('select[aria-label*="objective"]')).toHaveValue('retention')
    await expect(adopted.locator('select[aria-label*="absorption"]')).toHaveValue('low')
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
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    await setNumberField(page, 'Eye height above the road', '500')
    await setNumberField(page, 'Max view distance', '40')
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Alteration in perspective view')).toBeVisible({
      timeout: 120_000,
    })

    await page.getByRole('button', { name: 'Look from the road' }).click()
    await expect(page.getByText('Standing on the road')).toBeVisible()
    await expect(page.getByText('Visible from here, right now')).toBeVisible()

    await expect(page.getByRole('button', { name: 'Drive', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Back to the map' }).click()
    await expect(page.getByText('Standing on the road')).toHaveCount(0)
  })

  // The 3D stand itself is not covered here: the stubbed style never reports
  // itself loaded, so nothing that waits on the map being ready runs. What is
  // covered is the control and its copy; the geometry and placement carry unit
  // tests, and the drawing was checked against live terrain in a real browser.
  test('offers the 3D stand and says what bare ground means', async ({ page }) => {
    await stubBasemap(page)
    await stubTerrain(page)
    await stubVegetation(page)
    await openPage(page)

    await setNumberField(page, 'Eye height above the road', '500')
    await setNumberField(page, 'Max view distance', '40')
    await page.getByRole('button', { name: 'Run visibility' }).click()
    await expect(page.getByText('Alteration in perspective view')).toBeVisible({ timeout: 120_000 })

    await page.getByRole('button', { name: 'Look from the road' }).click()
    await expect(page.getByLabel(/Stand height/)).toHaveValue('28')
    await expect(page.getByLabel(/Cleared width along the road/)).toBeVisible()

    await page.getByRole('button', { name: 'Stand the timber up' }).click()
    await expect(page.getByText(/Bare ground/)).toBeVisible()
    await expect(page.getByLabel(/Stand height/)).toHaveCount(0)
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
