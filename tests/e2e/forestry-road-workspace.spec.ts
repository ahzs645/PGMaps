import { inflateSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 }, actionTimeout: 15000 })
test.setTimeout(120000)

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  return errors
}
async function download(page: Page, label: string) {
  const pending = page.waitForEvent('download', { timeout: 90000 })
  await page.getByRole('button', { name: label, exact: true }).click()
  const file = await pending
  const stream = (await file.createReadStream())!
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return { file, bytes: Buffer.concat(chunks) }
}

function pdfContents(bytes: Buffer) {
  const content: string[] = []
  const raw = bytes.toString('latin1')
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index! + match[0].length,
      end = raw.indexOf('endstream', start)
    if (end < 0) continue
    if (!raw.slice(Math.max(0, match.index! - 300), match.index).includes('FlateDecode')) continue
    try {
      content.push(inflateSync(bytes.subarray(start, end)).toString('latin1'))
    } catch {
      /* Image filters may differ. */
    }
  }
  return content.join('\n')
}

test('Save contains project actions and downloads real map and report PDFs', async ({ page }, testInfo) => {
  const errors = await prepare(page)
  await expect(page.getByRole('tab', { name: 'Files', exact: true })).toHaveCount(0)
  const header = page.getByTestId('road-workspace-header')
  await expect(header.getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
  await expect(header.getByText(/synthetic training project/)).not.toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save & export', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Project name', { exact: true }).fill('Road workspace review')
  const project = await download(page, 'Save project JSON')
  expect(JSON.parse(project.bytes.toString()).name).toBe('Road workspace review')
  const map = await download(page, 'Map PDF')
  expect(map.file.suggestedFilename()).toBe('Road-workspace-review-map.pdf')
  expect(map.bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(map.bytes.length).toBeGreaterThan(10000)
  await map.file.saveAs(testInfo.outputPath('map.pdf'))
  await expect(dialog.getByRole('button', { name: 'Report PDF', exact: true })).toBeEnabled()
  const report = await download(page, 'Report PDF')
  expect(report.file.suggestedFilename()).toBe('Road-workspace-review-report.pdf')
  expect(report.bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(report.bytes.length).toBeGreaterThan(10000)
  const contents = pdfContents(report.bytes)
  for (const label of [
    'Source:',
    'Vertical reference:',
    'Sampling interval:',
    'Quantity basis and limitations',
    'Station schedule',
  ])
    expect(contents).toContain(label)
  await report.file.saveAs(testInfo.outputPath('report.pdf'))
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  expect(errors).toEqual([])
})

test('panels close and restore, and divider drags preserve the map drawing buffer', async ({ page }) => {
  const errors = await prepare(page)
  const canvas = page.locator('[data-testid="road-plan-view"] canvas.maplibregl-canvas')
  const originalCanvas = await canvas.elementHandle()
  const before = await canvas.evaluate((el) => ({ width: el.width, css: el.clientWidth }))
  const divider = page.getByRole('separator', { name: 'Resize plan and view column', exact: true })
  const box = (await divider.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 100, box.y + 20, { steps: 8 })
  await expect.poll(() => canvas.evaluate((el) => el.clientWidth)).not.toBe(before.css)
  expect(await canvas.evaluate((el) => el.width)).toBe(before.width)
  await page.mouse.up()
  await expect.poll(() => canvas.evaluate((el) => el.width)).not.toBe(before.width)
  const profile = page.getByRole('region', { name: 'Road profile · ground & formation', exact: true })
  const height = (await profile.boundingBox())!.height
  await page.getByRole('button', { name: 'Close detail view panel', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Cross-section', exact: true })).toHaveCount(0)
  expect((await profile.boundingBox())!.height).toBeGreaterThan(height * 1.4)
  await page.getByRole('button', { name: 'Screen presets & panels', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Show detail view panel', exact: true }).check()
  await page
    .getByRole('dialog', { name: 'Screen layouts', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await expect(page.getByTestId('road-section-chart')).toBeVisible()
  await page.getByRole('button', { name: 'Close plan panel', exact: true }).click()
  await expect(canvas).toBeHidden()
  await page.getByRole('button', { name: 'Screen presets & panels', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Show plan panel', exact: true }).check()
  await page
    .getByRole('dialog', { name: 'Screen layouts', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await expect(canvas).toBeVisible()
  expect(await canvas.evaluate((element, original) => element === original, originalCanvas)).toBe(true)
  for (const id of ['road-profile-chart', 'road-section-chart']) {
    const chart = page.getByTestId(id)
    const plot = (await chart.boundingBox())!
    await page.mouse.move(plot.x + 55, plot.y + 35)
    await page.mouse.down()
    await page.mouse.move(plot.x + 160, plot.y + 75, { steps: 10 })
    await page.mouse.up()
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')
    expect(await chart.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none')
  }
  for (const [label, layout, profileVisible, detailVisible] of [
    ['Two panes · plan & profile', 'split', true, false],
    ['Map only', 'plan', false, false],
    ['Linked overview', 'linked', true, true],
  ] as const) {
    await page.getByRole('combobox', { name: 'Road view layout', exact: true }).click()
    await page.getByRole('option', { name: label, exact: true }).click()
    await expect(page.getByTestId('road-connected-layout')).toHaveAttribute('data-layout', layout)
    expect(await page.locator('[data-pane="profile"]').isVisible()).toBe(profileVisible)
    expect(await page.locator('[data-pane="detail"]').isVisible()).toBe(detailVisible)
  }
  expect(await canvas.evaluate((element, original) => element === original, originalCanvas)).toBe(true)
  expect(errors).toEqual([])
})

test('map settings use styled controls and terrain supports zoom, pan and a compact renderer', async ({ page }) => {
  const errors = await prepare(page)
  const fit = (await page.getByRole('button', { name: 'Fit road alignments', exact: true }).boundingBox())!
  const zoom = (await page.getByRole('button', { name: 'Zoom in', exact: true }).boundingBox())!
  expect(fit.y + fit.height).toBeLessThanOrEqual(zoom.y)
  await page.getByRole('combobox', { name: 'Terrain display', exact: true }).click()
  await page.getByRole('option', { name: 'Slope', exact: true }).click()
  await page.getByRole('button', { name: 'Expand legend', exact: true }).click()
  await expect(page.getByLabel('Terrain slope in degrees')).toBeVisible()
  await page.getByRole('button', { name: 'Map display settings', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Contours', exact: true }).uncheck()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Map display settings', exact: true })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: '3D', exact: true }).click()
  const preview = page.getByTestId('road-terrain-preview')
  const ground = page.getByTestId('road-ground-canvas')
  await expect(ground).toHaveAttribute('data-face-count', /^[1-9][0-9]*$/)
  expect(
    await ground.evaluate((canvas: HTMLCanvasElement) =>
      canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((value, i) => i % 4 === 3 && value > 0),
    ),
  ).toBe(true)
  expect(await preview.locator('polygon[data-terrain-face]').count()).toBe(0)
  expect(await preview.locator('polygon').count()).toBeLessThan(400)
  await expect(preview).not.toContainText('preview spacing')
  await page.getByRole('button', { name: 'Zoom terrain in', exact: true }).click()
  await expect(preview).toHaveAttribute('data-zoom', '1.25')
  const plot = preview.locator('svg[role="group"]')
  const rectangle = (await plot.boundingBox())!
  await page.mouse.move(rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height / 2)
  await page.mouse.wheel(0, -100)
  await expect.poll(async () => Number(await preview.getAttribute('data-zoom'))).toBeGreaterThan(1.25)
  const face = preview.locator('polygon').first()
  const position = await face.getAttribute('points')
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(rectangle.x + rectangle.width / 2 + 35, rectangle.y + rectangle.height / 2 + 20, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(face).not.toHaveAttribute('points', position!)
  await page.getByRole('button', { name: 'Fit terrain view', exact: true }).click()
  await expect(preview).toHaveAttribute('data-zoom', '1')
  await plot.focus()
  await page.keyboard.press('+')
  await expect(preview).toHaveAttribute('data-zoom', '1.25')
  await page.keyboard.press('-')
  await expect(preview).toHaveAttribute('data-zoom', '1')
  expect(errors).toEqual([])
})

test('engineering settings locate features across the connected views', async ({ page }) => {
  const errors = await prepare(page)
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: 'Pegs', exact: true }).click()
  const help = page.getByRole('button', { name: 'About peg measurements', exact: true })
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await help.focus()
  await expect(page.getByRole('tooltip')).toContainText('HD and grade describe straight peg-to-peg legs')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: 'Section', exact: true }).click()

  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Section', exact: true })
    .click()
  await page.getByRole('button', { name: 'Manage landings & turnouts', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Landings & turnouts', exact: true })
  await expect(dialog.getByLabel('Widening name').first()).toHaveValue('Passing turnout')
  await dialog.getByRole('button', { name: 'Locate Passing turnout', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByTestId('road-feature-selection')).toContainText('Passing turnout · 0+200.0–0+260.0')
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', '230')
  await expect(page.getByTestId('road-profile-chart').getByTestId('road-chart-selection')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')!
        type Map = import('maplibre-gl').Map
        type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
        type Fiber = { memoizedState?: Hook; return?: Fiber }
        const key = Object.keys(container).find((k) => k.startsWith('__reactFiber$'))!
        let fiber = (container as unknown as Record<string, Fiber>)[key]
        for (let n = 0; fiber && n < 200; n++, fiber = fiber.return!) {
          for (let hook = fiber.memoizedState, i = 0; hook && i < 40; hook = hook.next, i++) {
            const value = hook.memoizedState
            const map =
              value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
            if (typeof map?.getTerrain !== 'function') continue
            return map.getLayer('road-selection-highlight')
              ? map
                  .queryRenderedFeatures({ layers: ['road-selection-highlight'] })
                  .some((f) => f.properties.label === 'Passing turnout')
              : false
          }
        }
        return false
      }),
    )
    .toBe(true)
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: 'Mass haul', exact: true }).click()
  await expect(page.getByTestId('road-mass-chart').getByTestId('road-chart-selection')).toBeVisible()
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: '3D', exact: true }).click()
  await expect(page.getByTestId('road-terrain-preview').locator('polygon[fill="#e11d48"]')).not.toHaveCount(0)
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click()
  await expect(page.getByTestId('road-chart-selection')).toHaveCount(0)

  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Engineering', exact: true })
    .click()
  await page
    .getByRole('tablist', { name: 'Engineering inputs', exact: true })
    .getByRole('tab', { name: 'Haul', exact: true })
    .click()
  await page.getByLabel('Calculate material haul allocations', { exact: true }).check()
  const haul = page.getByRole('dialog', { name: 'Haul & cost settings', exact: true })
  await expect(haul).toBeVisible()
  await haul.getByRole('button', { name: '+ Borrow', exact: true }).click()
  await haul.getByLabel('Site 1 station (m)', { exact: true }).fill('400')
  await haul.getByLabel('Site 1 station (m)', { exact: true }).press('Tab')
  await haul.getByRole('button', { name: 'borrow · select 0+400.0', exact: true }).click()
  await expect(haul).not.toBeVisible()
  await expect(page.getByTestId('road-feature-selection')).toContainText('Borrow pit 1 · 0+400.0')
  await expect(page.getByTestId('road-terrain-preview')).toHaveAttribute('data-station', '400')
  await page.getByRole('button', { name: 'Haul & cost settings', exact: true }).click()
  await expect(haul.getByLabel('Site 1 station (m)', { exact: true })).toHaveValue('400')
  expect(errors).toEqual([])
})

test('loading notifications align inline without a dismiss button and errors remain dismissible', async ({ page }) => {
  const errors = await prepare(page)
  let releaseManifest!: () => void
  let releaseTerrain!: () => void
  const manifest = new Promise<void>((resolve) => {
    releaseManifest = resolve
  })
  const terrain = new Promise<void>((resolve) => {
    releaseTerrain = resolve
  })
  let terrainRequested = false
  await page.route('**/bc-093g086/checksums.json', async (route) => {
    await manifest
    await route.fulfill({ json: { 'dtm-1m.tif': { sha256: 'a'.repeat(64) } } })
  })
  await page.route('**/bc-093g086/summary.json', (route) =>
    route.fulfill({ json: { source_sha256: 'f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf' } }),
  )
  await page.route('**/bc-093g086/dtm-1m.tif*', async (route) => {
    terrainRequested = true
    await terrain
    await route.fulfill({ status: 503, body: 'Terrain unavailable for notification test' })
  })
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Terrain', exact: true })
    .click()
  await page.getByRole('button', { name: 'Load BC 1 m LiDAR sample', exact: true }).click()
  const toast = page.getByTestId('workspace-toast-loading')
  await expect(toast).toContainText('Reading the published')
  const box = (await toast.boundingBox())!
  expect(box.y).toBeLessThan(30)
  await expect(toast.getByRole('button', { name: 'Dismiss loading notification', exact: true })).toHaveCount(0)
  const icon = (await toast.locator('svg').first().boundingBox())!
  const message = (await toast.getByRole('status').boundingBox())!
  expect(Math.abs(icon.y + icon.height / 2 - (message.y + message.height / 2))).toBeLessThanOrEqual(1)
  releaseManifest()
  await expect.poll(() => terrainRequested).toBe(true)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(toast).toContainText('Loading and verifying')
  releaseTerrain()
  const error = page.getByTestId('workspace-toast-error')
  await expect(error).toBeVisible()
  await expect(toast).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await error.getByRole('button', { name: 'Dismiss error notification', exact: true }).click()
  await expect(error).toHaveCount(0)
  expect(errors).toEqual([])
})
