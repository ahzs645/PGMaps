import { expect, test } from '@playwright/test'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { canforPdfFixture } from '../fixtures/canforPdf'

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
  // JPEG class tiles are decoded against their stored coefficients: several seconds a tile.
  test.setTimeout(420_000)
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
  await expect(dialog).toContainText('Canopy height classes', { timeout: 300_000 })
  await expect(dialog).toContainText('Slope classes')
  // The field sheet's labelled contours are offered as terrain, and only as terrain; not chosen here.
  await expect(dialog).toContainText('Terrain from contours')
  await expect(dialog.getByLabel(/^Include .*Terrain from contours$/)).not.toBeChecked()
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
  const bytes = Array.from(await canforPdfFixture({ raster: 'canopy' }))
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
    return {
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
