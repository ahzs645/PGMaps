import { expect, test } from '@playwright/test'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { canforPdfFixture } from '../fixtures/canforPdf'
import { choose } from './styled-select'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 } })
test.setTimeout(90_000)

test('real company maps and their native block import together with usable class summaries', async ({
  page,
}, testInfo) => {
  const maps = process.env.PGMAPS_CANFOR_MAPS,
    block = process.env.PGMAPS_CANFOR_BLOCK
  test.skip(
    !maps || !block,
    'Set PGMAPS_CANFOR_MAPS to the local source directory and PGMAPS_CANFOR_BLOCK to its block id.',
  )
  // JPEG class tiles are decoded against their stored coefficients: several seconds a tile, and a
  // re-saved copy of a class sheet is decoded in full as well. Three block sheets are printed after.
  test.setTimeout(900_000)
  const shapes = path.join(path.dirname(maps!), 'Shapefiles')
  const files = [
    ...(await readdir(maps!)).filter((n) => /\.pdf$/i.test(n)).map((n) => path.join(maps!, n)),
    ...(await readdir(shapes))
      .filter((n) => new RegExp(`^${block}\\.(shp|prj|dbf|shx|cpg)$`, 'i').test(n))
      .map((n) => path.join(shapes, n)),
  ]
  await page.route('https://basemaps.cartocdn.com/**', (r) =>
    r.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?interface=workbench&example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Layers', exact: true }).last().click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add files', exact: true }).click()
  await (await chooser).setFiles(files)
  const dialog = page.getByRole('dialog', { name: 'Import layers' })
  await expect(dialog).toContainText('Canopy height classes', { timeout: 600_000 })
  await expect(dialog).toContainText('Slope classes')
  // The field sheet's labelled contours are offered as terrain, and only as terrain. They start
  // ticked over the training terrain; this run keeps that terrain, so they are left out here.
  await expect(dialog).toContainText('Terrain from contours')
  await dialog.getByLabel(/^Include .*Terrain from contours$/).uncheck()
  await dialog.getByLabel('Prepare 1 m DEM download boxes after import').uncheck()
  await dialog.getByRole('button', { name: 'Import layers', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('road-save-state')).toHaveAttribute('data-save', 'saved')
  const saved = await page.evaluate(async () => {
    const { readLibrary, readProject } = await import('/src/pages/dev-forestry-roads/projectLibrary.ts')
    const library = await readLibrary(),
      project = await readProject(library.activeId!)
    return {
      kinds: project!.reference!.flatMap((f) => (f.classGrid ? [f.classGrid.kind] : [])),
      blocks: project!.context.filter((f) => f.kind === 'harvest').map((f) => f.name),
    }
  })
  expect(saved.kinds.sort()).toEqual(['canopy', 'slope'])
  // The hillshade arrives as the PDF's own tiles, and the class displays at the sheet's own pixels.
  const pictures = await page.evaluate(async () => {
    const { readLibrary, readProject } = await import('/src/pages/dev-forestry-roads/projectLibrary.ts')
    const library = await readLibrary(),
      project = await readProject(library.activeId!)
    const size = async (image: string) => {
      const bitmap = await createImageBitmap(await (await fetch(image)).blob())
      return [bitmap.width, bitmap.height]
    }
    const mosaics = project!.reference!.flatMap((f) => (f.imageMosaic ? [f.imageMosaic] : []))
    return {
      mosaics: mosaics.map((m) => ({ kind: m.kind, width: m.width, height: m.height, tiles: m.tiles.length })),
      tiles: await Promise.all(mosaics.flatMap((m) => m.tiles.map((tile) => size(tile.image)))),
      displays: await Promise.all(
        project!.reference!.flatMap((f) => (f.classGrid && f.sheet ? [size(f.sheet.image)] : [])),
      ),
    }
  })
  expect(pictures.mosaics).toEqual([{ kind: 'hillshade', width: 3637, height: 3004, tiles: 4 }])
  expect(pictures.tiles.map(([w, h]) => w * h).reduce((s, n) => s + n, 0)).toBe(3637 * 3004)
  expect(pictures.displays).toEqual([
    [3637, 3004],
    [3637, 3004],
  ])
  // Reference layers start hidden. Shown, the plan loads every picture: megabyte images reach the
  // map as object URLs, which must stay alive.
  for (const layer of ['Map sheet', 'Hillshade', 'Canopy height classes', 'Slope classes'])
    await page.getByRole('button', { name: `Show layer ${layer}`, exact: true }).click()
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
          if (!container) return 'no map'
          const key = Object.keys(container).find((k) => k.startsWith('__reactFiber$'))
          if (!key) return 'no map'
          type Map = import('maplibre-gl').Map
          type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
          type Fiber = { memoizedState?: Hook; return?: Fiber }
          let fiber = (container as unknown as Record<string, Fiber>)[key]
          for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
            for (let hook = fiber.memoizedState, n = 0; hook && n < 40; hook = hook.next, n++) {
              const state = hook.memoizedState
              const map = state && (('current' in state ? state.current : state) as Map | undefined)
              if (map && typeof map.getStyle === 'function') {
                const ids = Object.keys(map.getStyle()?.sources ?? {}).filter((id) =>
                  /^road-source-(sheet|image)-/.test(id),
                )
                const pending = ids.filter((id) => !map.isSourceLoaded(id))
                return `${ids.filter((id) => id.startsWith('road-source-image-')).length} tiles, ${ids.filter((id) => id.startsWith('road-source-sheet-')).length} sheets, ${pending.length} not loaded`
              }
            }
          }
          return 'no map'
        }),
      { timeout: 60_000 },
    )
    .toBe('4 tiles, 3 sheets, 0 not loaded')
  // Block sheets drawn from the imported rasters, with no terrain of the project's own.
  const sheets = await page.evaluate(async (block) => {
    const { readLibrary, readProject } = await import('/src/pages/dev-forestry-roads/projectLibrary.ts')
    const { blockSheetPdf, blockChoices, DEFAULT_BLOCK_SHEET } =
      await import('/src/pages/dev-forestry-roads/blockSheet.ts')
    const library = await readLibrary(),
      project = (await readProject(library.activeId!))!
    const choice = blockChoices(project).find((entry) => entry.label.includes(block))!
    const out = []
    for (const kind of ['lidar-slope', 'lidar-canopy-height', 'lidar-hillshade'] as const) {
      const started = performance.now()
      const { blob, built } = await blockSheetPdf({
        settings: { ...DEFAULT_BLOCK_SHEET, kind, block: choice.value },
        project,
        analyses: new Map(),
        terrain: null,
        terrainName: 'none',
        terrainResolutionM: 1,
        canopy: null,
        issue: { date: '2026-11-18', preparedBy: '', organisation: '', revision: '' },
        caveat: 'Preliminary',
      })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      const image = built.sheet.ops.find((op) => op.op === 'image' && op.image.kind === 'rgba')
      let painted = 0
      if (image?.op === 'image' && image.image.kind === 'rgba')
        for (let i = 3; i < image.image.data.length; i += 4) if (image.image.data[i]) painted++
      out.push({
        kind,
        seconds: (performance.now() - started) / 1000,
        missing: built.missing,
        texts: built.sheet.ops.flatMap((op) => (op.op === 'text' && /published on/.test(op.text) ? [op.text] : [])),
        legend: built.sheet.classLegend.map((entry) => entry.label),
        painted,
        pdf: btoa(binary),
      })
    }
    return out
  }, block!)
  for (const sheet of sheets) {
    await writeFile(testInfo.outputPath(`${sheet.kind}.pdf`), Buffer.from(sheet.pdf, 'base64'))
    console.log(sheet.kind, sheet.seconds.toFixed(1), 's', sheet.texts, sheet.missing)
    expect(sheet.texts, sheet.missing.join('\n')).toHaveLength(1)
    expect(sheet.painted).toBeGreaterThan(100_000)
    expect(sheet.missing.join(' ')).not.toMatch(/could not be decoded|holds nothing/)
  }
  expect(sheets[0].texts[0]).toMatch(/^Slope classes as published on .*Slope_Map/)
  expect(sheets[0].legend).toContain('Paler: estimated, per 10 m')
  expect(sheets[1].texts[0]).toMatch(/^Canopy height classes as published on /)
  expect(sheets[2].texts[0]).toMatch(/^Hillshade as published on .*Hillshade_Map/)
  for (const layer of ['Canopy height classes', 'Slope classes']) {
    await page.getByRole('button', { name: `${layer} 1`, exact: true }).click()
    await page
      .getByRole('button', { name: layer === 'Slope classes' ? /^Slope Class \(%\)/ : /^Canopy Height \(m\)/ })
      .click()
    const details = page.getByTestId('pdf-raster-details').last()
    await expect(details).toContainText('3,637 × 3,004')
    await details.getByRole('combobox').click()
    await page
      .getByRole('option', { name: new RegExp(block!) })
      .first()
      .click()
    await details.getByRole('button', { name: 'Summarize mapped classes' }).click()
    await expect(details.getByTestId('pdf-class-summary')).toContainText('201.12 ha')
    await expect(details.getByTestId('pdf-class-summary')).toContainText(layer === 'Slope classes' ? '8.3%' : '10.2%')
    // Drawn / not drawn comes from the lossless transparency, so it is exact over the whole block.
    await expect(details.getByTestId('pdf-class-exact-split')).toContainText(
      layer === 'Slope classes' ? 'Under 20 % (not drawn) 13.1%' : 'Under 5 m (not drawn) 63.1%',
    )
  }
  await page.getByRole('button', { name: 'Fit layer Canopy height classes', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('class-summary.png') })
  await page.reload()
  await expect(page.getByTestId('road-save-state')).toHaveAttribute('data-save', 'saved')
})

test('PDF parsing and sheet rendering run in the browser worker without uploading the file', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/geopdf-import.html')
  const bytes = Array.from(await canforPdfFixture({ raster: 'canopy', picture: 'jpeg' }))
  const requests: string[] = []
  page.on('request', (r) => {
    if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) requests.push(r.url())
  })
  const result = await page.evaluate(async (bytes) => {
    const { importGeoPdf } = await import('/src/lib/geoPdf/client.ts')
    const result = await importGeoPdf(new File([new Uint8Array(bytes)], 'Test.pdf'), 'Test.pdf', {
      maxFeatures: 500,
      maxVertices: 50000,
    })
    const sheet = result.layers[0].sheet!
    const bitmap = await createImageBitmap(await (await fetch(sheet.image)).blob())
    const raster = result.layers.find((l) => l.classGrid)!
    const { decodeCells } = await import('/src/lib/geoPdf/classGrid.ts')
    const display = await createImageBitmap(await (await fetch(raster.sheet!.image)).blob())
    const tile = result.layers.find((l) => l.imageMosaic)!.imageMosaic!.tiles[0]
    const picture = await createImageBitmap(await (await fetch(tile.image)).blob())
    return {
      display: [display.width, display.height],
      tile: { type: tile.image.slice(0, 23), size: [picture.width, picture.height], lossy: tile.lossy },
      names: result.layers.map((l) => l.name),
      image: sheet.image.slice(0, 23),
      width: bitmap.width,
      height: bitmap.height,
      cells: [...decodeCells(raster.classGrid!)],
      rasterImage: raster.sheet!.image.slice(0, 22),
    }
  }, bytes)
  expect(result.names).toContain('Streams')
  expect(result.image).toBe('data:image/jpeg;base64,')
  expect(result.width).toBe(1400)
  expect(result.height).toBe(1400)
  expect(result.cells).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0, 240, 242, 4, 5, 6, 7, 8])
  expect(result.rasterImage).toBe('data:image/png;base64,')
  // The class display is the grid's own pixels, and the hillshade tile is the PDF's own JPEG.
  expect(result.display).toEqual([4, 4])
  expect(result.names).toContain('Hillshade')
  expect(result.tile).toEqual({ type: 'data:image/jpeg;base64,', size: [120, 88], lossy: true })
  expect(requests.filter((url) => !url.startsWith('data:'))).toEqual([])
})

test('Layers reviews a supported PDF, saves its source metadata and mounts the source sheet on the plan', async ({
  page,
}) => {
  await page.route('https://basemaps.cartocdn.com/**', (r) =>
    r.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?interface=workbench&example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Layers', exact: true }).last().click()
  const pending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add files', exact: true }).click()
  await (
    await pending
  ).setFiles({
    name: 'Canfor-test.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await canforPdfFixture({ raster: 'canopy' })),
  })
  const dialog = page.getByRole('dialog', { name: 'Import layers' })
  await expect(dialog).toContainText('Recognized: Canfor')
  await dialog.getByLabel('Prepare 1 m DEM download boxes after import').uncheck()
  await dialog.getByRole('button', { name: 'Import layers', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Fit all layers', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
        if (!container) return 0
        const key = Object.keys(container).find((k) => k.startsWith('__reactFiber$'))
        if (!key) return 0
        type Map = import('maplibre-gl').Map
        type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
        type Fiber = { memoizedState?: Hook; return?: Fiber }
        let fiber = (container as unknown as Record<string, Fiber>)[key]
        for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
          for (let hook = fiber.memoizedState, n = 0; hook && n < 40; hook = hook.next, n++) {
            const state = hook.memoizedState
            const map = state && (('current' in state ? state.current : state) as Map | undefined)
            if (map && typeof map.getStyle === 'function')
              return Object.entries(map.getStyle().sources).filter(
                ([id, s]) => id.startsWith('road-source-sheet-') && s.type === 'image',
              ).length
          }
        }
        return 0
      }),
    )
    .toBe(2)
  await page.getByRole('button', { name: 'Canopy height classes 1', exact: true }).click()
  await page.getByRole('button', { name: /^Canopy Height \(m\)/ }).click()
  const rasterDetails = page.getByTestId('pdf-raster-details')
  await expect(rasterDetails).toContainText('4 × 4 pixels')
  // The extracted block is deliberately overlaid by road/stream linework in the source PDF.
  await rasterDetails.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Block outlines 1', exact: true }).click()
  await rasterDetails.getByRole('button', { name: 'Summarize mapped classes' }).click()
  await expect(page.getByTestId('pdf-class-summary')).toContainText('144.00 ha')
  const queryCoordinate = await page.evaluate(async () => {
    const { readLibrary, readProject } = await import('/src/pages/dev-forestry-roads/projectLibrary.ts')
    const library = await readLibrary(),
      project = await readProject(library.activeId!)
    const grid = project!.reference!.find((f) => f.classGrid)!.classGrid!
    const { gridProjection, applyMatrix } = await import('/src/lib/geoPdf/classGrid.ts')
    return gridProjection(grid).inverse(applyMatrix(grid.transform, [0.5, 0.5]))
  })
  // Use MapLibre's real event path and actual canvas click, at the centre of a known native pixel.
  await page.evaluate((coordinate) => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')!
    const key = Object.keys(container).find((k) => k.startsWith('__reactFiber$'))!
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
      for (let hook = fiber.memoizedState, n = 0; hook && n < 40; hook = hook.next, n++) {
        const state = hook.memoizedState,
          map = state && (('current' in state ? state.current : state) as Map | undefined)
        if (map && typeof map.getStyle === 'function') {
          map.jumpTo({ center: coordinate as [number, number], zoom: 15, roll: 0 })
          return
        }
      }
    }
    throw Error('Plan map missing')
  }, queryCoordinate)
  const canvas = page.locator('[data-testid="road-plan-view"] canvas.maplibregl-canvas')
  await canvas.click()
  await expect(page.getByTestId('pdf-class-query')).toContainText('5-10 m · lossless palette match')
  await expect(page.getByTestId('road-save-state')).toHaveAttribute('data-save', 'saved')
  const sourceSaved = await page.evaluate(async () => {
    const { readLibrary, readProject } = await import('/src/pages/dev-forestry-roads/projectLibrary.ts')
    const library = await readLibrary()
    const project = library.activeId && (await readProject(library.activeId))
    return (
      !!project && project.reference?.some((f) => !!f.sheet && !!f.classGrid && f.pdfSource?.file === 'Canfor-test.pdf')
    )
  })
  expect(sourceSaved).toBe(true)
  await page.reload()
  await expect(page.getByTestId('road-save-state')).toHaveAttribute('data-save', 'saved')
})

test('the supplied private Canfor sheet renders in the browser', async ({ page }, testInfo) => {
  test.skip(!process.env.PGMAPS_CANFOR_PDF, 'Set PGMAPS_CANFOR_PDF to a local source sheet.')
  await page.goto('/tests/e2e/fixtures/geopdf-import.html')
  const encoded = (await readFile(process.env.PGMAPS_CANFOR_PDF!)).toString('base64')
  const result = await page.evaluate(async (encoded) => {
    const { importGeoPdf } = await import('/src/lib/geoPdf/client.ts')
    const result = await importGeoPdf(
      new File([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], 'Canfor.pdf'),
      'Canfor.pdf',
      {
        maxFeatures: 500,
        maxVertices: 50000,
      },
    )
    const { parseClassGrid } = await import('/src/lib/geoPdf/classGrid.ts')
    return {
      layers: result.layers.map((l) => l.name),
      image: result.layers[0].sheet!.image,
      rasters: result.layers.flatMap((l) =>
        l.classGrid
          ? [
              {
                kind: parseClassGrid(l.classGrid)!.kind,
                width: l.classGrid.width,
                height: l.classGrid.height,
                counts: l.classGrid.counts,
                sourceImages: l.classGrid.sourceImages,
              },
            ]
          : [],
      ),
      notices: result.notices,
    }
  }, encoded)
  expect(result.layers).toContain('Roads')
  expect(result.layers).toContain('Streams')
  expect(result.image.length).toBeGreaterThan(10000)
  if (/Canopy_Height|Slope_Map/.test(process.env.PGMAPS_CANFOR_PDF!)) {
    expect(result.rasters, result.notices.join('\n')).toHaveLength(1)
    expect(result.rasters[0]).toMatchObject({ width: 3637, height: 3004 })
    expect(result.rasters[0].sourceImages.filter((i) => i.lossy)).toHaveLength(
      result.rasters[0].kind === 'canopy' ? 2 : 3,
    )
  }
  await writeFile(testInfo.outputPath('source-sheet.jpg'), Buffer.from(result.image.split(',')[1], 'base64'))
})

test("a sheet's hillshade is drawn on the plan from its own tiles and prints as a block sheet without terrain", async ({
  page,
}) => {
  await page.route('https://basemaps.cartocdn.com/**', (r) =>
    r.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?interface=workbench&example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Layers', exact: true }).last().click()
  const pending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add files', exact: true }).click()
  await (
    await pending
  ).setFiles({
    name: 'Hillshade-test.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await canforPdfFixture({ picture: 'png' })),
  })
  const dialog = page.getByRole('dialog', { name: 'Import layers' })
  await expect(dialog).toContainText("Hillshade at the sheet's own pixels: 4 × 4")
  await expect(dialog.getByLabel(/^Include .*Hillshade$/)).toBeChecked()
  await dialog.getByLabel('Prepare 1 m DEM download boxes after import').uncheck()
  await dialog.getByRole('button', { name: 'Import layers', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Fit all layers', exact: true }).click()
  // One image source a tile, beside the sheet preview's.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
        if (!container) return []
        const key = Object.keys(container).find((k) => k.startsWith('__reactFiber$'))
        if (!key) return []
        type Map = import('maplibre-gl').Map
        type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
        type Fiber = { memoizedState?: Hook; return?: Fiber }
        let fiber = (container as unknown as Record<string, Fiber>)[key]
        for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
          for (let hook = fiber.memoizedState, n = 0; hook && n < 40; hook = hook.next, n++) {
            const state = hook.memoizedState
            const map = state && (('current' in state ? state.current : state) as Map | undefined)
            if (map && typeof map.getStyle === 'function')
              // No style yet while the map is still loading: the poll asks again.
              return Object.entries(map.getStyle()?.sources ?? {})
                .filter(([id, s]) => /^road-source-(sheet|image)-/.test(id) && s.type === 'image')
                .map(([id]) => id.replace(/-[0-9a-f-]{36}/, ''))
                .sort()
          }
        }
        return []
      }),
    )
    .toEqual(['road-source-image-0', 'road-source-image-1', 'road-source-sheet'])
  await expect(page.getByTestId('road-save-state')).toHaveAttribute('data-save', 'saved')
  const sheet = await page.evaluate(async () => {
    const { readLibrary, readProject } = await import('/src/pages/dev-forestry-roads/projectLibrary.ts')
    const { buildBlockSheet, blockChoices, blockSheetUnavailable, DEFAULT_BLOCK_SHEET } =
      await import('/src/pages/dev-forestry-roads/blockSheet.ts')
    const { publishedOffers } = await import('/src/pages/dev-forestry-roads/pdfSheetRasters.ts')
    const library = await readLibrary(),
      project = (await readProject(library.activeId!))!
    const block = blockChoices(project).find((entry) => entry.label.startsWith('Block outlines'))!
    const built = await buildBlockSheet({
      settings: { ...DEFAULT_BLOCK_SHEET, kind: 'lidar-hillshade', scale: 'fit', block: block.value },
      project,
      analyses: new Map(),
      terrain: null,
      terrainName: 'none',
      terrainResolutionM: 1,
      canopy: null,
      issue: { date: '2026-11-18', preparedBy: '', organisation: '', revision: '' },
      caveat: 'Preliminary',
      preview: true,
    })
    const image = built.sheet.ops.find((op) => op.op === 'image' && op.image.kind === 'rgba')
    const greys = new Set<number>()
    if (image?.op === 'image' && image.image.kind === 'rgba')
      for (let i = 0; i < image.image.data.length; i += 4) if (image.image.data[i + 3]) greys.add(image.image.data[i])
    return {
      unavailable: {
        hillshade: blockSheetUnavailable('lidar-hillshade', {}, publishedOffers(project.reference)),
        slope: blockSheetUnavailable('lidar-slope', {}, publishedOffers(project.reference)),
      },
      missing: built.missing,
      texts: built.sheet.ops.flatMap((op) => (op.op === 'text' && /published on/.test(op.text) ? [op.text] : [])),
      greys: [...greys].sort((a, b) => a - b),
    }
  })
  expect(sheet.unavailable.hillshade).toBeNull()
  expect(sheet.unavailable.slope).toMatch(/terrain/)
  expect(sheet.texts).toEqual(['Hillshade as published on Hillshade-test.pdf'])
  expect(sheet.missing.join(' ')).not.toMatch(/could not be decoded/)
  // The fixture's greys are 10 × column + row; the block sits inside the picture.
  expect(sheet.greys.length).toBeGreaterThan(3)
  expect(sheet.greys.every((grey) => grey <= 33 && grey % 10 <= 3)).toBe(true)
})

test('the hillshade sheet refines the contour terrain when the import asks for it', async ({ page }) => {
  const maps = process.env.PGMAPS_CANFOR_MAPS
  test.skip(!maps, 'Set PGMAPS_CANFOR_MAPS to the local source directory.')
  // The refinement solves about two million cells in a worker: the better part of a minute.
  test.setTimeout(600_000)
  const names = await readdir(maps!)
  const files = [/Field_Layout/, /Hillshade/].map((pattern) =>
    path.join(maps!, names.find((name) => pattern.test(name) && /\.pdf$/i.test(name))!),
  )
  await page.route('https://basemaps.cartocdn.com/**', (r) =>
    r.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?interface=workbench&example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Layers', exact: true }).last().click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add files', exact: true }).click()
  await (await chooser).setFiles(files)
  const dialog = page.getByRole('dialog', { name: 'Import layers' })
  await expect(dialog).toContainText('Terrain from contours', { timeout: 300_000 })
  await dialog.getByLabel(/^Include .*Terrain from contours$/).check()
  // Offered because the import holds the hillshade sheet, and off until asked for.
  const refine = dialog.getByLabel(/^Read the ground between the contours from .*Hillshade/)
  await expect(refine).not.toBeChecked()
  await refine.check()
  await dialog.getByLabel(/^Fill past the contours/).uncheck()
  await dialog.getByLabel('Prepare 1 m DEM download boxes after import').uncheck()
  await dialog.getByRole('button', { name: 'Import layers', exact: true }).click()
  const question = page.getByTestId('road-terrain-import-question')
  await expect(question).toBeVisible({ timeout: 300_000 })
  await choose(question.getByLabel('Vertical datum of the elevations', { exact: true }), {
    value: 'CGVD2013 (CGG2013), EPSG:6647; metres',
  })
  await question.getByText('Elevations are in metres').click()
  await question.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByTestId('road-save-state')).toHaveAttribute('data-save', 'saved', { timeout: 120_000 })
  const terrain = await page.evaluate(async () => {
    const { readLibrary, readProject } = await import('/src/pages/dev-forestry-roads/projectLibrary.ts')
    const library = await readLibrary(),
      project = await readProject(library.activeId!)
    return { name: project!.terrain.name, relief: project!.terrain.relief, cell: project!.terrain.resolutionM }
  })
  expect(terrain.name).toMatch(/^Contours \+ hillshade · .*Field_Layout/)
  expect(terrain.relief?.name).toMatch(/Hillshade/)
  expect(terrain.relief!.sharePercent).toBeGreaterThan(85)
  // Typical change is decimetres; nearly all of it under the 10 m interval.
  expect(terrain.relief!.medianChangeM).toBeGreaterThan(0.1)
  expect(terrain.relief!.medianChangeM).toBeLessThan(1)
  expect(terrain.relief!.p99ChangeM).toBeLessThan(10)
  await page.reload()
  await expect(page.getByTestId('road-save-state')).toHaveAttribute('data-save', 'saved')
})
