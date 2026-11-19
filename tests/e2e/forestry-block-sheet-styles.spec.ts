import { expect, test, type Page } from '@playwright/test'
import { encode } from 'fast-png'
import { PDFDocument } from 'pdf-lib'
import { chooseExport, dismissExampleNoticeWhenShown, showRoadPreview } from './road-files'
import { openWorkbench } from './road-workbench'
import { choose, expectSelected } from './styled-select'
import { openVisualsExport } from './visuals-export'

/**
 * Block map sheets and their map styles (docs/forestry-block-map-sheets.md, **Map styles on a sheet**):
 * the visual quality page prints the road designer's sheet types from its own scene, in PGMaps' sheet
 * symbols or a figure style, and the road designer's sheet draws with this browser's saved styles
 * when its map style asks for them.
 */
test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(180_000)

// Terrarium tiles of ground rising to the east, so a slope or hillshade sheet has something to draw.
const ramp = new Uint8Array(256 * 256 * 3)
for (let row = 0; row < 256; row += 1)
  for (let column = 0; column < 256; column += 1) {
    const packed = 800 + column * 2 + 32768
    ramp[(row * 256 + column) * 3] = Math.floor(packed / 256)
    ramp[(row * 256 + column) * 3 + 1] = packed % 256
  }
const RAMP_TILE = Buffer.from(encode({ width: 256, height: 256, data: ramp, channels: 3 }))

async function stubMaps(page: Page, terrain: 'ok' | 'fail' = 'ok') {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('**/elevation-tiles-prod/terrarium/**', (route) =>
    terrain === 'ok'
      ? route.fulfill({ contentType: 'image/png', body: RAMP_TILE })
      : route.fulfill({ status: 503, body: '' }),
  )
}

async function savedPdf(page: Page, click: () => Promise<void>) {
  const pending = page.waitForEvent('download')
  await click()
  const download = await pending
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return { name: download.suggestedFilename(), pdf: await PDFDocument.load(Buffer.concat(chunks)) }
}

test('the visual quality page prints the block sheet types in a chosen map style', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await stubMaps(page)
  await page.goto('/dev/forestry/visual-quality')
  const dialog = await openVisualsExport(page, 'Block map sheet')

  // The sheet types are the road designer's; canopy height says why it cannot be made here.
  const kind = dialog.getByRole('combobox', { name: 'Sheet', exact: true })
  await expectSelected(kind, 'general-access')
  await kind.click()
  const list = page.getByRole('listbox').last()
  await expect(list.getByRole('option')).toHaveCount(7)
  await expect(list.locator('[role="option"][data-value="lidar-canopy-height"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await list.locator('[role="option"][data-value="lidar-hillshade"]').click()
  await expectSelected(dialog.getByRole('combobox', { name: 'Scale', exact: true }), '10000')

  // The map style is PGMaps' sheet symbols until a figure style is chosen, and What goes in says which.
  const style = dialog.getByRole('combobox', { name: 'Map style', exact: true })
  await expectSelected(style, 'sheet')
  await choose(style, 'analysis-sheet-magenta')
  const contents = dialog.getByRole('region', { name: 'Sheet', exact: true })
  await expect(contents).toContainText('Design Hillshade')
  await expect(contents).toContainText('Analysis sheet · magenta landform')

  const hillshade = await savedPdf(page, () =>
    dialog.getByRole('button', { name: 'Download Block map sheet', exact: true }).click(),
  )
  expect(hillshade.name).toMatch(/-lidar-hillshade\.pdf$/)
  expect(hillshade.pdf.getPageCount()).toBe(1)
  expect(hillshade.pdf.getPage(0).getSize()).toEqual({ width: 1224, height: 792 })
  await expect(dialog.getByRole('status').filter({ hasText: /^Saved .*-lidar-hillshade\.pdf\.$/ })).toBeVisible()

  // The choice is this browser's: it is still there after a reload.
  await page.reload()
  await openVisualsExport(page, 'Block map sheet')
  await expectSelected(kind, 'lidar-hillshade')
  await expectSelected(style, 'analysis-sheet-magenta')

  // The VIA report's maps keep their own symbols until a figure style is chosen for them.
  await openVisualsExport(page, 'VIA report')
  const reportStyle = dialog.getByRole('combobox', { name: 'Map style', exact: true })
  await expectSelected(reportStyle, 'sheet')
  await choose(reportStyle, 'analysis-sheet-magenta')
  await expect(dialog.getByText(/draw the proposed blocks and existing openings with this figure style/)).toBeVisible()
  expect(errors).toEqual([])
})

test('a sheet whose terrain does not load is written without contours and says so', async ({ page }) => {
  await stubMaps(page, 'fail')
  await page.goto('/dev/forestry/visual-quality')
  const dialog = await openVisualsExport(page, 'Block map sheet')
  await choose(dialog.getByRole('combobox', { name: 'Sheet', exact: true }), 'general-access')
  const access = await savedPdf(page, () =>
    dialog.getByRole('button', { name: 'Download Block map sheet', exact: true }).click(),
  )
  expect(access.pdf.getPageCount()).toBe(1)
  await expect(dialog.getByRole('status').filter({ hasText: /The terrain did not load/ })).toContainText(
    'no contours or block elevations',
  )
  // A slope sheet is the terrain: without it there is nothing to print.
  await choose(dialog.getByRole('combobox', { name: 'Sheet', exact: true }), 'lidar-slope')
  await dialog.getByRole('button', { name: 'Download Block map sheet', exact: true }).click()
  await expect(dialog.getByRole('status').filter({ hasText: /terrain for this sheet did not load/ })).toBeVisible()
})

/** A style library holding one stream style, chosen for streams (`styleLibrary.ts`). */
const CREEK_LIBRARY = {
  schema: 'pgmaps-road-style-library-v1',
  styles: [
    {
      id: 'style-creek',
      name: 'Office creek',
      fileName: 'office.qml',
      format: 'qml',
      savedOn: '2026-11-18T00:00:00.000Z',
      symbol: { kind: 'line', label: 'Office creek', layers: [{ color: '#0044aa', width: 1.4 }] },
      notes: [],
    },
  ],
  roles: { stream: 'style-creek' },
}

/** The plan map's paint for one layer, read off the map as the legend spec reads it. */
async function planLineColor(page: Page, layer: string) {
  return page.evaluate((id) => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    const key = container && Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!container || !key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!)
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState
        const map =
          value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getTerrain !== 'function') continue
        return map.getLayer(id) ? String(map.getPaintProperty(id, 'line-color')) : null
      }
    return null
  }, layer)
}

test('the plan, its legend and the block sheet draw a saved style when asked', async ({ page }) => {
  await stubMaps(page)
  await page.addInitScript((library) => {
    window.localStorage.setItem('pgmaps.forestryRoads.styleLibrary', JSON.stringify(library))
  }, CREEK_LIBRARY)
  await dismissExampleNoticeWhenShown(page)
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  const legend = page.getByTestId('road-terrain-legend')
  if (await legend.getByRole('button', { name: 'Expand legend', exact: true }).isVisible())
    await legend.getByRole('button', { name: 'Expand legend', exact: true }).click()
  const content = page.getByTestId('road-plan-legend-content')

  // The block sheet's own symbols until the plan is asked for the saved styles.
  await expect(content.locator('[data-sheet-symbol="Stream"]')).toBeVisible()
  const own = await planLineColor(page, 'road-sheet-stream-0')
  expect(own).not.toBe('#0044aa')
  await page.getByRole('button', { name: 'Map display settings', exact: true }).click()
  const symbols = page.getByRole('combobox', { name: 'Legend and map symbols', exact: true })
  await choose(symbols, 'saved-styles')
  await expect(content.locator('[data-sheet-symbol="Office creek"]')).toBeVisible()
  await expect(content.locator('[data-sheet-symbol="Stream"]')).toHaveCount(0)
  await expect.poll(() => planLineColor(page, 'road-sheet-stream-0')).toBe('#0044aa')
  // And back: the sheet's own layers return.
  await choose(symbols, 'block-sheet')
  await expect(content.locator('[data-sheet-symbol="Stream"]')).toBeVisible()
  await expect.poll(() => planLineColor(page, 'road-sheet-stream-0')).toBe(own)
  await choose(symbols, 'saved-styles')
  await page.getByRole('button', { name: 'Close map settings', exact: true }).click()

  // The block sheet draws the same style once its map style asks for it, and lists it in its legend.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await chooseExport(page, 'Block map sheet')
  const dialog = page.getByTestId('road-files-dialog')
  const views = dialog.getByRole('group', { name: 'Block map sheet view', exact: true })
  const sheetSvg = async () => {
    await showRoadPreview(views)
    const image = dialog.getByRole('img', { name: /block map sheet/i })
    await expect(image).toBeVisible({ timeout: 30_000 })
    return decodeURIComponent((await image.getAttribute('src')) ?? '')
  }
  expect(await sheetSvg()).not.toContain('Office creek')
  await views.getByRole('button', { name: 'Sheet setup', exact: true }).click()
  await choose(dialog.getByRole('combobox', { name: 'Map style', exact: true }), 'library')
  await expect.poll(sheetSvg, { timeout: 30_000 }).toContain('Office creek')
})

test('the road designer’s block sheet offers this browser’s saved styles as its map style', async ({ page }) => {
  await stubMaps(page)
  await dismissExampleNoticeWhenShown(page)
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await chooseExport(page, 'Block map sheet')
  const dialog = page.getByTestId('road-files-dialog')
  const views = dialog.getByRole('group', { name: 'Block map sheet view', exact: true })
  await views.getByRole('button', { name: 'Sheet setup', exact: true }).click()

  // PGMaps' symbols until asked; the style library is where each feature's style is chosen.
  const style = dialog.getByRole('combobox', { name: 'Map style', exact: true })
  await expectSelected(style, 'pgmaps')
  await expect(dialog.getByTestId('road-style-library')).toHaveCount(0)
  await choose(style, 'library')
  const library = dialog.getByTestId('road-style-library')
  await expect(library).toBeVisible()
  await expect(library.getByRole('list', { name: 'Exported features and their styles', exact: true })).toBeVisible()

  // The sheet still builds, and the choice survives reopening the dialog.
  await showRoadPreview(views)
  await expect(dialog.getByRole('img', { name: /block map sheet/i })).toBeVisible({ timeout: 30_000 })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await chooseExport(page, 'Block map sheet')
  await views.getByRole('button', { name: 'Sheet setup', exact: true }).click()
  await expectSelected(style, 'library')
})
