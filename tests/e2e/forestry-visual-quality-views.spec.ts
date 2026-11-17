import { readFile } from 'node:fs/promises'
import zlib from 'node:zlib'
import ExcelJS from 'exceljs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { choose, expectSelected } from './styled-select'
import { openVisualsExport, openVisualsExportPackage } from './visuals-export'
import { LAND_CHECKS } from '../../src/pages/dev-forestry/landStatusChecks'
import { VIEWPOINT_LAYERS } from '../../src/pages/dev-forestry/viewpointInventory'

/**
 * Views of interest, end to end: planned on the plan map and from BC's viewpoint inventory, edited, captured without
 * driving, stepped through from the Viewpoint summary and written by Save & export's package
 * (`docs/forestry-visual-quality.md`, **Views of interest** and **Save & export**). The network is stubbed as in
 * `forestry-visual-quality.spec.ts`: flat terrain, an empty basemap style that finishes loading, empty DataBC layers,
 * and one VLI viewpoint with two arrows aimed at Block A and one aimed away.
 */

// Production-preview caching would serve around the stubbed sources below.
test.use({ serviceWorkers: 'block' })
// A control that never appears fails its step rather than waiting out the long test budget.
test.use({ actionTimeout: 60_000 })

const PAGE_PATH = '/dev/forestry/visual-quality'

// --- Flat terrain (as in forestry-visual-quality.spec.ts) ---------------------------------------------------------

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

/** A 256×256 Terrarium tile of flat ground at `elevationMeters`. */
function flatTerrariumTile(elevationMeters: number): Buffer {
  const packed = elevationMeters + 32768
  const size = 256
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let row = 0; row < size; row += 1) {
    const offset = row * (size * 3 + 1)
    for (let column = 0; column < size; column += 1) {
      raw[offset + 1 + column * 3] = Math.floor(packed / 256)
      raw[offset + 2 + column * 3] = packed % 256
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const FLAT_TILE = flatTerrariumTile(800)

// --- Geometry --------------------------------------------------------------------------------------------------------

type LngLat = { lng: number; lat: number }

/** The sample scene's Block A (`createSampleScene`): a box round this centre. */
const BLOCK_A_CENTRE: LngLat = { lng: -122.5085, lat: 53.883 }
/** Where the test places a view with the map's *Add a view of interest* tool: about 2.6 km west-southwest of Block A. */
const MAP_VIEW: LngLat = { lng: -122.545, lat: 53.87 }
/** The stubbed VLI viewpoint, about 2.8 km northwest of Block A. */
const VLI_VIEWPOINT: LngLat = { lng: -122.54, lat: 53.9 }

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

function bearing(from: LngLat, to: LngLat): number {
  const φ1 = toRadians(from.lat),
    φ2 = toRadians(to.lat),
    Δλ = toRadians(to.lng - from.lng)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function metres(a: LngLat, b: LngLat): number {
  const dx = (b.lng - a.lng) * 111_320 * Math.cos(toRadians((a.lat + b.lat) / 2))
  const dy = (b.lat - a.lat) * 110_570
  return Math.hypot(dx, dy)
}

const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

/** A point `distance` metres from `origin` along `degrees`, and `across` metres to its right. */
function offset(origin: LngLat, degrees: number, distance: number, across = 0): [number, number] {
  const θ = toRadians(degrees)
  const east = Math.sin(θ) * distance + Math.cos(θ) * across
  const north = Math.cos(θ) * distance - Math.sin(θ) * across
  return [origin.lng + east / (111_320 * Math.cos(toRadians(origin.lat))), origin.lat + north / 110_570]
}

/** An inventory arrow polygon from the viewpoint along `degrees`, its tip the vertex farthest from the viewpoint. */
function arrowPolygon(degrees: number): GeoJSON.Polygon {
  const tailLeft = offset(VLI_VIEWPOINT, degrees, 10, -15)
  return {
    type: 'Polygon',
    coordinates: [
      [
        tailLeft,
        offset(VLI_VIEWPOINT, degrees, 700, -15),
        offset(VLI_VIEWPOINT, degrees, 700, -60),
        offset(VLI_VIEWPOINT, degrees, 900),
        offset(VLI_VIEWPOINT, degrees, 700, 60),
        offset(VLI_VIEWPOINT, degrees, 700, 15),
        offset(VLI_VIEWPOINT, degrees, 10, 15),
        tailLeft,
      ],
    ],
  }
}

const TO_BLOCK = bearing(VLI_VIEWPOINT, BLOCK_A_CENTRE)
/** Two arrows within the 30° that aims at the block (one straight at it, one 18° off) and one looking away. */
const ARROWS = [
  { id: 'arrow-at-block', degrees: TO_BLOCK },
  { id: 'arrow-near-block', degrees: (TO_BLOCK + 18) % 360 },
  { id: 'arrow-away', degrees: (TO_BLOCK + 170) % 360 },
]
const VLI_NAME = 'VLI major viewpoint 145'

// --- Stubs -----------------------------------------------------------------------------------------------------------

const json = (body: unknown) => ({ json: body })
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features, numberMatched: features.length })

async function stubNetwork(page: Page) {
  // An empty basemap style that finishes loading (never `glyphs: ''`, which never does).
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill(json({ version: 8, sources: {}, layers: [] })),
  )
  await page.route('**/elevation-tiles-prod/terrarium/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: FLAT_TILE }),
  )
  // Existing openings, RESULTS forest cover and planting: none.
  await page.route('**/bcgw_pub_whse_forest_vegetation/MapServer/*/query**', (route) =>
    route.fulfill(json({ type: 'FeatureCollection', features: [] })),
  )
  // VRI rank-1: none (the run's treed area then rests on the stated assumption).
  await page.route('**/WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY/ows**', (route) =>
    route.fulfill(json(collection([]))),
  )

  const landLayers = new Set(LAND_CHECKS.map((check) => check.typeName))
  const viewpointFeatures: Record<string, unknown[]> = {
    [VIEWPOINT_LAYERS.viewpoints]: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [VLI_VIEWPOINT.lng, VLI_VIEWPOINT.lat] },
        properties: {
          VIEWPOINT_ID: 'VP-145',
          VIEWPOINT_NUMBER: 145,
          REC_VIEWPOINT_TYPE_CODE: 'MAJVP',
          DESCRIPTION: 'Highway pullout',
          EXPIRY_DATE: '2009-03-31Z',
        },
      },
    ],
    [VIEWPOINT_LAYERS.arrows]: ARROWS.map((arrow, index) => ({
      type: 'Feature',
      geometry: arrowPolygon(arrow.degrees),
      properties: {
        VIEWING_DIRECTION_ID: arrow.id,
        VIEWPOINT_ID: 'VP-145',
        DIRECTION_NUMBER: index + 1,
        VIEWING_DIRECTION_TYPE: 'Large Arrow',
      },
    })),
  }
  // Every DataBC WFS layer the page reads: the land status checks (typeNames), the viewpoint inventory's five
  // layers and the visual landscape inventory (typeName). Nothing reaches the real service.
  await page.route('**/geo/pub/wfs?**', (route) => {
    const parameters = new URL(route.request().url()).searchParams
    const layer = parameters.get('typeName') ?? parameters.get('typeNames') ?? ''
    if (landLayers.has(layer) || Object.values(VIEWPOINT_LAYERS).includes(layer as never)) {
      return route.fulfill(json(collection(viewpointFeatures[layer] ?? [])))
    }
    if (layer === 'WHSE_FOREST_VEGETATION.REC_VISUAL_LANDSCAPE_INVENTORY') return route.fulfill(json(collection([])))
    return route.fallback()
  })
}

// --- Map state -------------------------------------------------------------------------------------------------------

/**
 * Finds a map by its pane (`visuals-plan-map`, `visuals-road-view`) through the React fiber holding its ref, as the
 * other spec's `readMapState` does, and exposes it to `page.evaluate` as `window.__pgmapsMap(which)`.
 */
function installMapFinder() {
  ;(window as unknown as { __pgmapsMap: (which: 'plan' | 'eye') => unknown }).__pgmapsMap = (which) => {
    const container = document.querySelector(
      `[data-testid="${which === 'eye' ? 'visuals-road-view' : 'visuals-plan-map'}"] .maplibregl-map`,
    )
    if (!container) return null
    const fiberKey = Object.keys(container).find((key) => key.startsWith('__reactFiber$'))
    if (!fiberKey) return null
    type Hook = { memoizedState?: unknown; next?: Hook }
    let node = (container as unknown as Record<string, { memoizedState?: Hook; return?: unknown }>)[fiberKey]
    for (let depth = 0; node && depth < 200; depth += 1) {
      let hook = node.memoizedState
      for (let index = 0; hook && index < 40; index += 1) {
        const map = (
          hook.memoizedState as { current?: { queryTerrainElevation?: unknown; getContainer?: () => Element } }
        )?.current
        if (map?.queryTerrainElevation && map.getContainer?.() === container) return map
        hook = hook.next
      }
      node = node.return as typeof node
    }
    return null
  }
}

type PlanMap = {
  getSource: (id: string) => { getData: () => Promise<GeoJSON.FeatureCollection> } | undefined
  getStyle: () => { layers: Array<{ id: string; source?: string; layout?: { visibility?: string } }> }
  project: (point: [number, number]) => { x: number; y: number }
  getContainer: () => HTMLElement
}

/** The features of a plan-map GeoJSON source, and whether a visible layer draws it; null when the source is absent. */
async function planSource(page: Page, sourceId: string) {
  return page.evaluate(async (sourceId) => {
    const map = (window as unknown as { __pgmapsMap: (which: string) => PlanMap | null }).__pgmapsMap('plan')
    const source = map?.getSource(sourceId)
    if (!map || !source) return null
    const data = await source.getData()
    const drawn = map
      .getStyle()
      .layers.some((layer) => layer.source === sourceId && layer.layout?.visibility !== 'none')
    return { features: data.features, drawn }
  }, sourceId)
}

/** Ids of the plan's view cones (`ViewsOfInterestLayers`), with their `included` property. */
async function viewCones(page: Page) {
  const source = await planSource(page, 'fill-shared-forestry-views-of-interest-cones')
  return source
    ? {
        drawn: source.drawn,
        cones: source.features.map((feature) => ({
          id: String(feature.properties?.id),
          included: feature.properties?.included,
          ring: (feature.geometry as GeoJSON.Polygon).coordinates[0] as Array<[number, number]>,
        })),
      }
    : null
}

/** Where the plan's viewer cone puts the road view's eye (`MapViewerCone`), or null while no road view is open. */
async function planEye(page: Page): Promise<LngLat | null> {
  return page.evaluate(async () => {
    const map = (window as unknown as { __pgmapsMap: (which: string) => PlanMap | null }).__pgmapsMap('plan')
    if (!map) return null
    const id = map.getStyle().layers.find((layer) => layer.id.startsWith('viewer-cone-eye'))?.source
    const source = id ? map.getSource(id) : undefined
    if (!source) return null
    const eye = (await source.getData()).features.find((feature) => feature.properties?.kind === 'eye')
    if (!eye) return null
    const [lng, lat] = (eye.geometry as GeoJSON.Point).coordinates
    return { lng, lat }
  })
}

/** Clicks the plan map at a place, checking nothing covers the canvas there. */
async function clickPlanAt(page: Page, point: LngLat) {
  const screen = await page.evaluate((point) => {
    const map = (window as unknown as { __pgmapsMap: (which: string) => PlanMap | null }).__pgmapsMap('plan')
    if (!map) return null
    const projected = map.project([point.lng, point.lat])
    const box = map.getContainer().getBoundingClientRect()
    const x = box.left + projected.x,
      y = box.top + projected.y
    const hit = document.elementFromPoint(x, y)
    return { x, y, onCanvas: !!hit?.classList.contains('maplibregl-canvas') }
  }, point)
  expect(screen, 'the plan map is mounted').not.toBeNull()
  expect(screen!.onCanvas, 'nothing covers the plan where the view is placed').toBe(true)
  await page.mouse.click(screen!.x, screen!.y)
}

// --- Page ------------------------------------------------------------------------------------------------------------

async function showStep(page: Page, id: 'identify' | 'visit' | 'design' | 'assess' | 'rate') {
  const tab = page.locator(`[data-via-step="${id}"]`)
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(page.locator(`[data-via-panel="${id}"]`)).toBeVisible()
}

/** Opens a folded section in a step by its disclosure key. */
async function unfold(page: Page, step: 'identify' | 'visit', key: string) {
  await showStep(page, step)
  const toggle = page.locator(`[data-via-panel="${step}"] [data-forestry-disclosure="${key}"]`)
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

const viewsList = (page: Page) =>
  page.locator('[data-via-panel="visit"]').getByRole('list', { name: 'Views of interest', exact: true })
const viewRow = (page: Page, name: string) =>
  viewsList(page)
    .locator('li[data-view-of-interest]')
    .filter({ has: page.getByText(name, { exact: true }) })
const captureState = (row: Locator) => row.locator('[data-capture-state]')

/** Opens a view's row on one of its tabs (its fields show only while it is open, a tab at a time). */
async function openViewRow(page: Page, name: string, tab: 'View' | 'Record' | 'Field' | 'Report' = 'View') {
  const row = viewRow(page, name)
  const toggle = row.getByRole('button', { name }).first()
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await row.getByRole('button', { name: tab, exact: true }).click()
  await expect(row.locator(`[data-view-tab="${tab.toLowerCase()}"]`)).toBeVisible()
  return row
}

test.beforeEach(async ({ page }) => {
  await stubNetwork(page)
  // The page restores its last scene from storage; the test wants the sample.
  await page.addInitScript(() => window.localStorage.clear())
  await page.addInitScript(installMapFinder)
})

test('plans views of interest, captures them without driving and writes them through the package', async ({ page }) => {
  // Two places stood at and run, two views saved with their class passes, the summary standing at two views, then a
  // block note with its run: well past the default on SwiftShader under load.
  test.setTimeout(20 * 60_000)
  await page.goto(PAGE_PATH)
  await expect(page.getByRole('heading', { name: 'Visual quality' })).toBeVisible()
  await expect(page.locator('[data-via-step]')).toHaveCount(5)

  const mapViewName = 'Viewpoint 1, toward Block A — west face'
  const arrowOneName = `${VLI_NAME}, arrow 1`
  const arrowTwoName = `${VLI_NAME}, arrow 2`

  await test.step('The map tool places a view facing the block', async () => {
    await unfold(page, 'visit', 'views-of-interest')
    const add = page.getByRole('button', { name: 'Add a view of interest', exact: true })
    await add.click()
    await expect(add).toHaveAttribute('aria-pressed', 'true')
    // The sample has two blocks; the view is for the first unless another is chosen in the tool's card.
    await expect(
      page.getByTestId('plan-tool-card').getByRole('combobox', { name: 'Block a new view is for' }),
    ).toHaveText('For Block A — west face')
    await clickPlanAt(page, MAP_VIEW)
    // One click places one view and puts the plan's click mode down.
    await expect(add).toHaveAttribute('aria-pressed', 'false')

    await expect(viewsList(page).locator('li[data-view-of-interest]')).toHaveCount(1)
    const row = viewRow(page, mapViewName)
    await expect(row).toContainText('Picked on the map')
    await expect(row).toContainText('faces the block')
    await expect(captureState(row)).toHaveAttribute('data-capture-state', 'not-captured')

    // The plan draws it: one cone, from the clicked place toward the block's centre, and one numbered point there.
    await expect.poll(async () => (await viewCones(page))?.cones.length, { timeout: 30_000 }).toBe(1)
    const { cones, drawn } = (await viewCones(page))!
    expect(drawn).toBe(true)
    const [apex, ...rim] = cones[0].ring
    // The click lands on a whole pixel, which is tens of metres at the plan's zoom.
    expect(metres({ lng: apex[0], lat: apex[1] }, MAP_VIEW)).toBeLessThan(60)
    const middle = {
      lng: rim.reduce((sum, point) => sum + point[0], 0) / rim.length,
      lat: rim.reduce((sum, point) => sum + point[1], 0) / rim.length,
    }
    expect(angleBetween(bearing(MAP_VIEW, middle), bearing(MAP_VIEW, BLOCK_A_CENTRE))).toBeLessThan(3)
    await expect(page.getByTestId('view-of-interest-marker')).toHaveCount(1)
  })

  await test.step('Add to views on an inventory viewpoint adds its two arrows aimed at the block', async () => {
    // The finder sits under the views of interest in step 2, which it adds to.
    await unfold(page, 'visit', 'inventory-viewpoints')
    // Found by its fold, not its list: the list only exists once loaded.
    const finder = page
      .locator('[data-via-panel="visit"] > *')
      .filter({ has: page.locator('[data-forestry-disclosure="inventory-viewpoints"]') })
    await finder.getByRole('button', { name: 'Load around the block' }).click()
    const list = finder.getByRole('list', { name: 'Inventory viewpoints near the block' })
    // The row itself, not its own Add button, which reads "… is in the views" once added.
    const candidate = list.getByRole('button', { name: new RegExp(`^${VLI_NAME}(?! is in the views)`) })
    await expect(candidate).toBeVisible({ timeout: 30_000 })
    await expect(candidate).toContainText('3 arrows, 2 at it')
    await candidate.click()
    await expect(finder.getByRole('radio', { name: 'The 2 arrows at the block' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // While the row is open the plan highlights the two arrows the default adds, not the third.
    await expect
      .poll(async () =>
        (await planSource(page, 'fill-shared-forestry-views-of-interest-arrows'))?.features
          .map((feature) => feature.properties?.arrowId)
          .sort(),
      )
      .toEqual(['arrow-at-block', 'arrow-near-block'])

    await finder.getByRole('button', { name: 'Add 2 views' }).click()
    await expect(finder.getByRole('status').filter({ hasText: /Added/ })).toBeVisible()
    await expect(candidate).toContainText('· in views')

    await showStep(page, 'visit')
    await expect(viewsList(page).locator('li[data-view-of-interest]')).toHaveCount(3)
    for (const name of [arrowOneName, arrowTwoName]) {
      await expect(viewRow(page, name)).toContainText('VLI viewpoint')
      await expect(viewRow(page, name)).toContainText(/arrow \d · /)
    }
    await expect.poll(async () => (await viewCones(page))?.cones.length).toBe(3)
    // The planned views face along exactly the two aimed arrows.
    const arrows = await planSource(page, 'fill-shared-forestry-views-of-interest-arrows')
    expect(
      arrows?.features.map((feature) => [feature.properties?.arrowId, feature.properties?.preview]).sort(),
    ).toEqual([
      ['arrow-at-block', 0],
      ['arrow-near-block', 0],
    ])
  })

  await test.step('A view takes a 28 mm lens and another is left out of exports', async () => {
    const lensRow = await openViewRow(page, arrowOneName)
    await choose(lensRow.getByRole('combobox', { name: 'Lens', exact: true }), '28')
    await expectSelected(lensRow.getByRole('combobox', { name: 'Lens', exact: true }), '28')
    await expect(lensRow).toContainText('· 28 mm')

    const leftOut = await openViewRow(page, mapViewName, 'Report')
    await leftOut.getByRole('checkbox', { name: 'Include in exports' }).uncheck()
    await expect(leftOut).toContainText('left out of exports')
    const mapViewId = await leftOut.getAttribute('data-view-of-interest')
    await expect
      .poll(async () => (await viewCones(page))?.cones.find((cone) => cone.id === mapViewId)?.included)
      .toBe(0)
    // Only the included views count toward the capture.
    await expect(page.getByRole('button', { name: 'Capture 2 views' })).toBeEnabled()
  })

  await test.step('Capture 2 views saves both without driving', async () => {
    const panel = page.locator('[data-via-panel="visit"]')
    await panel.getByRole('button', { name: 'Capture 2 views' }).click()
    await expect(panel.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    // The batch ends with its closing line; each wait has its own budget inside the page. Under SwiftShader the
    // framed class pass draws, so both views are saved with their analysis sheets: *Captured*, not *Saved, no
    // analysis sheet*.
    await expect(panel.getByRole('status').filter({ hasText: /^Captured \d+ of 2 views/ })).toHaveText(
      'Captured 2 of 2 views.',
      { timeout: 15 * 60_000 },
    )
    for (const name of [arrowOneName, arrowTwoName]) {
      await expect(captureState(viewRow(page, name))).toHaveAttribute('data-capture-state', 'captured')
      await expect(captureState(viewRow(page, name))).toHaveText('Captured')
    }
    // The view left out of exports is not captured, and nothing included is left to capture.
    await expect(captureState(viewRow(page, mapViewName))).toHaveAttribute('data-capture-state', 'not-captured')
    await expect(panel.getByRole('button', { name: 'All captured' })).toBeDisabled()
    // The headline carries step 2's progress.
    await expect(page.getByRole('region', { name: 'VIA headline result' })).toContainText('2/2')
  })

  await test.step("The summary's arrows stand at the planned views in turn", async () => {
    // The capture put the reviewer back where they were, with no run, so the summary (shown once a run has
    // something to say) is not up yet: *Stand here* on a row runs there and brings it up.
    const summary = page.getByRole('complementary', { name: 'Viewpoint summary', exact: true })
    const switcher = summary.getByRole('group', { name: 'Planned view' })
    await expect(switcher).toBeHidden()
    const row = await openViewRow(page, mapViewName)
    await row.getByRole('button', { name: 'Stand here' }).click()
    await expect(switcher).toBeVisible({ timeout: 5 * 60_000 })
    await expect(switcher).toContainText(mapViewName)
    await expect(switcher).toContainText('1 of 3')
    // The road view stands at the view's place: the plan's viewer cone puts the eye there.
    await expect
      .poll(
        async () => {
          const eye = await planEye(page)
          return eye ? metres(eye, MAP_VIEW) : Infinity
        },
        { timeout: 5 * 60_000 },
      )
      .toBeLessThan(60)

    await switcher.getByRole('button', { name: 'Next planned view' }).click()
    await expect(switcher).toContainText(arrowOneName)
    await expect(switcher).toContainText('2 of 3')
    await expect
      .poll(
        async () => {
          const eye = await planEye(page)
          return eye ? metres(eye, VLI_VIEWPOINT) : Infinity
        },
        { timeout: 5 * 60_000 },
      )
      .toBeLessThan(30)
    // Facing the view's arrow, not the block: the road view's camera turns to the arrow's bearing.
    await expect
      .poll(
        async () => {
          const bearing = await page.evaluate(() => {
            const map = (
              window as unknown as { __pgmapsMap: (which: string) => { getBearing: () => number } | null }
            ).__pgmapsMap('eye')
            return map ? map.getBearing() : null
          })
          return bearing === null ? 180 : angleBetween(bearing, ARROWS[0].degrees)
        },
        { timeout: 2 * 60_000 },
      )
      .toBeLessThan(2)
  })

  await test.step("Save & export writes the package's included views", async () => {
    const dialog = await openVisualsExportPackage(page)
    const checklist = dialog.getByRole('region', { name: 'Package' }).getByRole('list', { name: 'Views of interest' })
    await expect(checklist.getByRole('listitem')).toHaveCount(3)
    await expect(checklist.getByRole('checkbox', { name: mapViewName })).not.toBeChecked()
    await expect(checklist.getByRole('listitem').filter({ hasText: mapViewName })).toContainText(
      'To capture on Preview or Download',
    )
    for (const name of [arrowOneName, arrowTwoName]) {
      const item = checklist.getByRole('listitem').filter({ hasText: name })
      await expect(checklist.getByRole('checkbox', { name })).toBeChecked()
      await expect(item).toContainText('Captured')
      // A captured view shows its picture.
      await expect(item.locator('img')).toHaveCount(1)
    }
    await expect(checklist.getByRole('listitem').filter({ hasText: arrowOneName })).toContainText('28 mm')

    // What goes in, for the files that take the package's views: the left-out view is named as left out.
    for (const output of ['VIA report', 'Block note']) {
      await openVisualsExport(page, output)
      const section = dialog.getByRole('region', { name: 'Views of interest', exact: true })
      await expect(section.getByRole('listitem')).toHaveCount(3)
      await expect(section.getByRole('listitem').filter({ hasText: mapViewName })).toContainText('· Left out')
      for (const name of [arrowOneName, arrowTwoName])
        await expect(section.getByRole('listitem').filter({ hasText: name })).toContainText('· Captured: in the file')
      await expect(section).toContainText('2 views of interest in the file.')
    }

    // The block note, written: Excel, with the run it reads made first when it is missing.
    await dialog.getByRole('button', { name: 'Excel', exact: true }).click()
    const downloading = page.waitForEvent('download', { timeout: 10 * 60_000 })
    await dialog.getByRole('button', { name: 'Download Block note', exact: true }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/)
    const bytes = await readFile((await download.path())!)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer)
    const other = workbook.getWorksheet('Other Considerations')!
    const captions: string[] = []
    other.eachRow((row) => {
      const value = row.getCell(2).value
      if (typeof value === 'string') captions.push(value)
    })
    // The planner's layout: one picture per view in the package, captioned with its name, then the plan map. The
    // view left out of exports is in neither the pictures nor the viewpoint list.
    expect(captions).toEqual([
      'Visuals',
      `${arrowOneName}.`,
      `${arrowTwoName}.`,
      `Plan: Block A — west face and ${VLI_NAME}.`,
    ])
    expect(other.getImages()).toHaveLength(3)
    const viewpoints: string[] = []
    workbook.getWorksheet('Viewpoints')!.eachRow((row, index) => {
      if (index > 1) viewpoints.push(String(row.getCell(1).value))
    })
    expect(viewpoints).toEqual([arrowOneName, arrowTwoName])
  })
})

test('drafts the VIA report without capturing, draws its pictures one group at a time, and makes the recipe yours', async ({
  page,
}) => {
  // One view captured with its class pass, then the report's maps drawn on their own: well past the default on
  // SwiftShader under load.
  test.setTimeout(25 * 60_000)
  await page.goto(PAGE_PATH)
  await expect(page.getByRole('heading', { name: 'Visual quality' })).toBeVisible()
  const viewName = 'Viewpoint 1, toward Block A — west face'

  await test.step('A view of interest is captured', async () => {
    await unfold(page, 'visit', 'views-of-interest')
    const panel = page.locator('[data-via-panel="visit"]')
    await page.getByRole('button', { name: 'Add a view of interest', exact: true }).click()
    await clickPlanAt(page, MAP_VIEW)
    await expect(viewsList(page).locator('li[data-view-of-interest]')).toHaveCount(1)
    await panel.getByRole('button', { name: 'Capture 1 view' }).click()
    await expect(captureState(viewRow(page, viewName))).toHaveAttribute('data-capture-state', 'captured', {
      timeout: 8 * 60_000,
    })
  })

  const dialog = await openVisualsExportPackage(page)
  const pane = dialog.getByRole('region', { name: 'Package' })

  await test.step('Make a copy turns the recipe into your own, edited in place', async () => {
    await choose(pane.getByLabel('Package recipe'), 'form-2001-sheets')
    await pane.getByRole('button', { name: 'Make a copy', exact: true }).click()
    await expect(pane.getByLabel('Package recipe')).toHaveText(
      'Yours: 2001 VIA summary form with analysis sheets (your copy)',
    )
    const editor = pane.getByLabel('Edit your recipe')
    await expect(editor).toBeVisible()
    const parts = editor.getByRole('region', { name: 'Parts' }).getByRole('listitem')
    const before = await parts.count()
    await editor.getByRole('button', { name: 'Remove Notes', exact: false }).first().click()
    await expect(parts).toHaveCount(before - 1)
    // A shared part is added by id, never copied: the overview map, at the end.
    await choose(editor.getByLabel('Part to add'), 'overview-map')
    await editor.getByRole('button', { name: 'Add at the end' }).click()
    await choose(editor.getByLabel('Part to add'), 'overhead-renders')
    await editor.getByRole('button', { name: 'Add at the end' }).click()
    await expect(parts).toHaveCount(before + 1)
    await expect(parts.last()).toContainText('Overhead and oblique renders')
  })

  await test.step('The draft lays the report out at once, with stand-ins where pictures go', async () => {
    await pane.getByRole('button', { name: 'See the report’s draft' }).click()
    await expect(
      dialog.getByRole('group', { name: 'VIA report view' }).getByRole('button', { name: 'Draft' }),
    ).toHaveAttribute('aria-pressed', 'true')
    const made = dialog.getByRole('complementary', { name: 'What the report is made of' })
    await expect(made).toBeVisible({ timeout: 60_000 })
    await expect(made.getByRole('region', { name: 'Made of' })).toContainText(
      'Your own, copied from 2001 VIA summary form',
    )
    const frame = dialog.frameLocator('iframe[title="VIA report draft"]')
    // Every part that printed is marked in the page, and the last added part is the overview map.
    await expect(frame.locator('.draft-part').last()).toContainText('Overhead and oblique renders')
    const overviewMark = frame.locator('.draft-part').filter({ hasText: 'Overview map' })
    await expect(frame.locator('[data-src="run"], [data-src="scene"]').first()).toBeVisible()
    // The maps are stand-ins until drawn.
    const maps = made
      .getByRole('region', { name: 'Pictures' })
      .getByRole('listitem')
      .filter({ hasText: 'Maps from the plan' })
    await expect(maps).toContainText('Stand-in')
    await expect(frame.locator('img[src*="data-draw%3D%22maps%22"]').first()).toBeVisible()
    // A part in the list scrolls the page to its mark.
    await made
      .getByRole('region', { name: 'Parts' })
      .getByRole('button', { name: /Overview map/ })
      .click()
    await expect(overviewMark).toBeInViewport()
  })

  await test.step('Clicking a stand-in draws its group alone, and the draft keeps it', async () => {
    const frame = dialog.frameLocator('iframe[title="VIA report draft"]')
    await frame.locator('img[src*="data-draw%3D%22maps%22"]').first().click()
    const made = dialog.getByRole('complementary', { name: 'What the report is made of' })
    const maps = made
      .getByRole('region', { name: 'Pictures' })
      .getByRole('listitem')
      .filter({ hasText: 'Maps from the plan' })
    await expect(maps).toContainText('Drawn', { timeout: 3 * 60_000 })
    await expect(frame.locator('img[src*="data-draw%3D%22maps%22"]')).toHaveCount(0)
    // The renders are still stand-ins: drawing one group draws nothing else.
    await expect(frame.locator('img[src*="data-draw%3D%22renders%22"]').first()).toBeVisible()
  })

  await test.step('Your recipe goes out as a file and comes back as a second recipe', async () => {
    // Back on the package, the editor is folded again; the recipe chosen is still yours.
    await openVisualsExportPackage(page)
    await expect(pane.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
    const downloading = page.waitForEvent('download')
    await pane.getByRole('button', { name: 'Share as a file' }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe('2001-via-summary-form-with-analysis-sheets-your-copy.via-recipe.json')
    const file = JSON.parse(await readFile((await download.path())!, 'utf8'))
    expect(file.kind).toBe('pgmaps-via-recipe')
    expect(file.recipe.parts.slice(-2)).toEqual(['overview-map', 'overhead-renders'])
    await pane.getByLabel('Import a recipe file').setInputFiles((await download.path())!)
    await expect(
      pane.getByText('Imported 2001 VIA summary form with analysis sheets (your copy) (imported).'),
    ).toBeVisible()
    await expect(pane.getByLabel('Package recipe')).toHaveText(
      'Yours: 2001 VIA summary form with analysis sheets (your copy) (imported)',
    )
  })

  await test.step('The file is written from the same pictures, with no stand-in, mark or tint', async () => {
    await openVisualsExport(page, 'VIA report')
    // PDF is the report's default format; the printable HTML is the one these marks would show in.
    await dialog.getByRole('button', { name: 'Printable HTML', exact: true }).click()
    const downloading = page.waitForEvent('download', { timeout: 10 * 60_000 })
    await dialog.getByRole('button', { name: 'Download VIA report', exact: true }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/\.html$/)
    const html = await readFile((await download.path())!, 'utf8')
    expect(html).toContain('PGMaps report from your own recipe')
    expect(html).not.toContain('data-draw')
    expect(html).not.toContain('draft-part')
    expect(html).not.toContain('data-src=')
    // The overview map drawn in the draft is in the file.
    expect(html).toMatch(/<img src="data:image\/(png|jpeg)/)
  })
})
