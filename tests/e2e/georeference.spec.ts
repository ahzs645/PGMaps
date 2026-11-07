import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import { decode, encode } from 'fast-png'
import JSZip from 'jszip'
import type { GeoreferenceProject, Point } from '../../src/pages/dev-georeference/model'

// These launch settings are local to this map suite; the shared config still owns
// external baseURL selection and the default development-server lifecycle.
test.use({
  serviceWorkers: 'block',
  acceptDownloads: true,
  launchOptions: {
    ...(process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
  },
})

const width = 800
const height = 600
const earthRadius = 6378137
const origin: Point = [earthRadius * ((-125 * Math.PI) / 180), 7_170_156.293999949]

function imagePng(w = width, h = height): Buffer {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const offset = (y * w + x) * 4
      const gray = (Math.floor(x / 40) + Math.floor(y / 40)) % 2 ? 220 : 245
      const centreMarker = Math.abs(x - 400) <= 9 && Math.abs(y - 300) <= 9
      data.set(centreMarker ? [250, 0, 250, 255] : [gray, gray, gray, 255], offset)
    }
  }
  return Buffer.from(encode({ width: w, height: h, channels: 4, data }))
}

function toCoordinate([x, y]: Point): Point {
  return [
    (x / earthRadius) * (180 / Math.PI),
    (2 * Math.atan(Math.exp(y / earthRadius)) - Math.PI / 2) * (180 / Math.PI),
  ]
}

function affineWorld([x, y]: Point): Point {
  return [origin[0] + 5 * x + 0.5 * y, origin[1] + 0.2 * x - 5 * y]
}

function project(png: Buffer, tps = false): GeoreferenceProject {
  const pixels: Point[] = [
    [0, 0],
    [799, 0],
    [0, 599],
    [799, 599],
    [400, 300],
    [200, 150],
    [600, 150],
    [200, 450],
    [600, 450],
  ]
  const shifts: Point[] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [180, 90],
    [60, 20],
    [70, 30],
    [40, -20],
    [50, -15],
  ]
  return {
    schema: 'pgmaps-georeference-v1',
    pixelConvention: 'pixel-centres-x-right-y-down',
    fitCrs: 'EPSG:3857',
    source: {
      id: 'synthetic-calibration',
      url: null,
      sha256: createHash('sha256').update(png).digest('hex'),
      width,
      height,
      frame: { kind: 'original-image', description: 'Synthetic original PNG pixel frame for browser regression.' },
    },
    title: tps ? 'Calibration local warp' : 'Calibration test image',
    transform: tps ? 'thin-plate-spline' : 'affine',
    points: [
      ...pixels.map((pixel, index) => {
        const world = affineWorld(pixel)
        const shift = tps ? shifts[index] : [0, 0]
        return {
          id: `control-${index}`,
          pixel,
          coordinate: toCoordinate([world[0] + shift[0], world[1] + shift[1]]),
          enabled: true,
          role: 'control' as const,
        }
      }),
      {
        id: 'withheld',
        pixel: [160, 380],
        coordinate: toCoordinate(affineWorld([160, 380])),
        enabled: true,
        role: 'check',
      },
    ],
    notes: 'Synthetic calibration only; no real collection links or geographic accuracy claim.',
  }
}

async function importProject(page: Page, value: GeoreferenceProject) {
  await page
    .locator('input[type="file"]')
    .nth(1)
    .setInputFiles({
      name: 'synthetic.georeference.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(value)),
    })
}

async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path()
  if (!path) throw new Error('Expected a local browser download')
  return readFile(path)
}

async function downloadProject(page: Page): Promise<GeoreferenceProject> {
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download edit file', exact: true }).click()
  return JSON.parse((await readDownload(await event)).toString()) as GeoreferenceProject
}

async function previewZip(page: Page): Promise<JSZip> {
  const button = page.getByRole('button', { name: 'Download preview + world file', exact: true })
  await expect(page.getByText('Updating warped preview…', { exact: true })).toBeHidden()
  await expect(button).toBeEnabled()
  const event = page.waitForEvent('download')
  await button.click()
  return JSZip.loadAsync(await readDownload(await event))
}

function markerWorld(png: Uint8Array, worldFile: string): Point {
  const image = decode(png)
  expect(image.channels).toBe(4)
  const values = worldFile.trim().split(/\s+/).map(Number)
  const [resolutionX, , , resolutionY, westCentre, northCentre] = values
  let total = 0
  let sumX = 0
  let sumY = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * image.channels
      if (
        image.data[offset] > 200 &&
        image.data[offset + 1] < 60 &&
        image.data[offset + 2] > 200 &&
        image.data[offset + 3] > 200
      ) {
        total += 1
        sumX += x
        sumY += y
      }
    }
  }
  expect(total).toBeGreaterThan(100)
  return [westCentre + (sumX / total) * resolutionX, northCentre + (sumY / total) * resolutionY]
}

test('original image edits round-trip, pick/undo, warp the TPS interior and remain reachable on mobile', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const png = imagePng()
  const basemap = imagePng(256, 256)
  for (const pattern of ['https://server.arcgisonline.com/**', 'https://tile.openstreetmap.org/**']) {
    await page.route(pattern, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: basemap }))
  }
  const affine = project(png)
  await page.goto('/dev/georeference')
  await expect(page.getByRole('heading', { name: 'Georeference a map', exact: true })).toBeVisible()
  await importProject(page, affine)
  await page
    .locator('input[type="file"]')
    .nth(0)
    .setInputFiles({ name: 'calibration.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByRole('heading', { name: 'Calibration test image', exact: true })).toBeVisible()
  await expect(page.getByText(/Native source pixel frame\s*·\s*800\s*×\s*600 px/)).toBeVisible()
  await expect(page.getByTestId('georeference-map-status')).toHaveText('Reference map ready')
  const first = await downloadProject(page)
  expect(first.source).toEqual(affine.source)
  expect(first.points).toEqual(affine.points)

  // Pick a pair through the actual image SVG and MapLibre canvas, then undo it.
  const image = page.getByTestId('georeference-source')
  await image.scrollIntoViewIfNeeded()
  const point = await image.evaluate((element) => {
    const matrix = (element as SVGSVGElement).getScreenCTM()
    if (!matrix) throw new Error('Source image has no screen transform')
    const p = new DOMPoint(300, 150).matrixTransform(matrix)
    return { x: p.x, y: p.y }
  })
  await page.mouse.click(point.x, point.y)
  await expect(page.getByText('Now click the same landmark', { exact: false })).toBeVisible()
  const reference = page.getByTestId('georeference-reference').locator('canvas').first()
  await reference.scrollIntoViewIfNeeded()
  const box = await reference.boundingBox()
  if (!box) throw new Error('Reference map canvas is missing')
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.75)
  await expect(page.getByText('Pair added.', { exact: false })).toBeVisible()
  expect((await downloadProject(page)).points).toHaveLength(11)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  expect((await downloadProject(page)).points).toEqual(affine.points)

  // Reopening uses the same immutable PNG bytes and native coordinates.
  const saved = await downloadProject(page)
  await page.reload()
  await importProject(page, saved)
  await page
    .locator('input[type="file"]')
    .nth(0)
    .setInputFiles({ name: 'calibration.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByRole('heading', { name: 'Calibration test image', exact: true })).toBeVisible()
  expect((await downloadProject(page)).source).toEqual(saved.source)
  const affineZip = await previewZip(page)
  const affineMarker = markerWorld(
    await affineZip.file('rectified-preview.png')!.async('uint8array'),
    await affineZip.file('rectified-preview.pgw')!.async('string'),
  )
  expect(
    Math.hypot(affineMarker[0] - affineWorld([400, 300])[0], affineMarker[1] - affineWorld([400, 300])[1]),
  ).toBeLessThan(15)

  const tps = project(png, true)
  await importProject(page, tps)
  await expect(page.getByRole('heading', { name: 'Calibration local warp', exact: true })).toBeVisible()
  const tpsZip = await previewZip(page)
  const tpsMarker = markerWorld(
    await tpsZip.file('rectified-preview.png')!.async('uint8array'),
    await tpsZip.file('rectified-preview.pgw')!.async('string'),
  )
  const expected = affineWorld([400, 300])
  // The four outer controls did not move. A corner-only preview would leave this
  // interior magenta marker unchanged; the TPS must move it by the central GCP.
  expect(Math.hypot(tpsMarker[0] - expected[0] - 180, tpsMarker[1] - expected[1] - 90)).toBeLessThan(20)
  expect(Math.hypot(tpsMarker[0] - affineMarker[0], tpsMarker[1] - affineMarker[1])).toBeGreaterThan(150)
  const zippedProject = JSON.parse(
    await tpsZip.file('project.georeference.json')!.async('string'),
  ) as GeoreferenceProject
  expect(zippedProject.source).toEqual(affine.source)
  expect(zippedProject.points).toEqual(tps.points)
  expect(zippedProject.transform).toBe('thin-plate-spline')

  // The native GDAL download can be opted into when its runtime is available;
  // the deterministic default suite needs no CDN/WASM network request.
  if (process.env.PGMAPS_E2E_GDAL_EXPORT === '1') {
    const event = page.waitForEvent('download', { timeout: 180_000 })
    await page.getByRole('button', { name: 'Download rectified GeoTIFF', exact: true }).click()
    expect((await readDownload(await event)).length).toBeGreaterThan(500)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const notes = page.getByRole('textbox', { name: 'Georeferencing notes', exact: true })
  await notes.scrollIntoViewIfNeeded()
  await expect(notes).toBeInViewport()
  await notes.fill('Mobile edits keep the same original source frame.')
  const save = page.getByRole('button', { name: 'Download edit file', exact: true })
  await save.scrollIntoViewIfNeeded()
  await expect(save).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Download rectified GeoTIFF', exact: true })).toBeEnabled()
  const mobileProject = await downloadProject(page)
  expect(mobileProject.notes).toContain('Mobile edits')
  expect(mobileProject.source).toEqual(affine.source)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false)
  await page.screenshot({ path: testInfo.outputPath('mobile-bottom-controls.png') })
  expect(errors).toEqual([])
})
