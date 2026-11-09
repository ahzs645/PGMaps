import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { ImageVariant, RasterRecord } from '../../src/pages/dev-view/catalogue'

test.use({ serviceWorkers: 'block', hasTouch: true, viewport: { width: 320, height: 844 } })

const host = 'https://source-image-fixture.test'
const catalogueUrl = `${host}/catalog.json`
const fixtureDirectory = path.resolve('tests/e2e/fixtures/source-image-pyramid')
const fixtureVariant = JSON.parse(readFileSync(path.join(fixtureDirectory, 'variant.json'), 'utf8')) as ImageVariant
const title = 'Synthetic source-image collection'
const variant: ImageVariant = {
  ...fixtureVariant,
  role: 'original-scan',
  image: { ...fixtureVariant.image, url: `${host}/source.png` },
  preview: { ...fixtureVariant.preview!, url: `${host}/preview.webp` },
  thumbnail: { ...fixtureVariant.thumbnail!, url: `${host}/thumbnail.webp` },
  pyramid: { ...fixtureVariant.pyramid!, format: 'pmtiles-image-v1', url: `${host}/pyramid.pmtiles` },
}

test('reads original detail on a phone, switches source images and compares the rectified view on desktop', async ({
  page,
  context,
}, testInfo) => {
  const files = new Map(
    await Promise.all(
      ['source.png', 'preview.webp', 'thumbnail.webp', 'pyramid.pmtiles'].map(
        async (name) => [name, await readFile(path.join(fixtureDirectory, name))] as const,
      ),
    ),
  )
  const requests: { url: string; range?: string }[] = []
  const record: RasterRecord = {
    id: 'synthetic-map',
    title,
    bounds: [-126, 53, -124, 55],
    thumbnail: `${host}/thumbnail.webp`,
    sources: [],
    fullSheets: [],
    assets: [{ tiles: [`${host}/map-tiles/{z}/{x}/{y}.png`], bounds: [-126, 53, -124, 55], minZoom: 0, maxZoom: 8 }],
    downloads: [{ url: `${host}/rectified.tif`, width: 800, height: 600, crs: 'EPSG:3857' }],
    imageVariants: [
      variant,
      { id: 'small-edit-image', label: 'Small edit image', role: 'edit-source', image: variant.preview! },
    ],
  }
  await page.route(`${host}/**`, async (route) => {
    const request = route.request()
    const url = request.url()
    const range = request.headers().range
    requests.push({ url, range })
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, X-Content-SHA256',
    }
    if (url === catalogueUrl)
      return route.fulfill({ headers, json: { schema: 'raster-catalog-v1', title, items: [record] } })
    if (url.includes('/map-tiles/'))
      return route.fulfill({ headers, contentType: 'image/webp', body: files.get('thumbnail.webp')! })
    const name = new URL(url).pathname.slice(1)
    const file = files.get(name)
    if (!file) return route.fulfill({ status: 404, headers })
    if (name !== 'pyramid.pmtiles')
      return route.fulfill({ headers, contentType: name.endsWith('.webp') ? 'image/webp' : 'image/png', body: file })
    const match = /^bytes=(\d+)-(\d+)$/.exec(range || '')
    if (!match) return route.fulfill({ status: 400, headers })
    const start = Number(match[1]),
      end = Math.min(file.length - 1, Number(match[2]))
    if (start > end)
      return route.fulfill({ status: 416, headers: { ...headers, 'Content-Range': `bytes */${file.length}` } })
    return route.fulfill({
      status: 206,
      contentType: 'application/vnd.pmtiles',
      headers: {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Content-Length': String(end - start + 1),
        'X-Content-SHA256': variant.pyramid!.sha256!,
      },
      body: file.subarray(start, end + 1),
    })
  })

  await page.goto(`/dev/view/#catalog=${encodeURIComponent(catalogueUrl)}`)
  await page.getByRole('button', { name: `Preview image: ${title}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: title, exact: true })
  const viewport = dialog.locator('[data-image-viewport]')
  await expect(dialog.getByRole('button', { name: 'Original scan', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await expect
    .poll(() =>
      viewport
        .locator('img[data-image-tile]')
        .evaluateAll(
          (images) =>
            images.length > 0 &&
            images.every(
              (image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
            ),
        ),
    )
    .toBe(true)
  expect(requests.filter((request) => request.url.endsWith('/source.png'))).toHaveLength(0)
  const overviewRequests = requests.filter((request) => request.url.endsWith('/pyramid.pmtiles'))
  expect(overviewRequests.length).toBeGreaterThan(0)
  expect(overviewRequests.every((request) => !!request.range)).toBe(true)
  await expect(dialog.getByRole('link', { name: /Download original scan/ })).toHaveAttribute(
    'href',
    `${host}/source.png`,
  )

  await dialog.getByRole('button', { name: 'View source image at 100 percent' }).click()
  await expect
    .poll(() =>
      viewport
        .locator('img[data-image-tile^="3/"]')
        .evaluateAll(
          (images) =>
            images.length > 0 &&
            images.every(
              (image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
            ),
        ),
    )
    .toBe(true)
  const box = await viewport.boundingBox()
  if (!box) throw new Error('The source image viewport is missing.')
  const cdp = await context.newCDPSession(page)
  const touch = (id: number, x: number) => ({ id, x: box.x + x, y: box.y + box.height / 2 })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, 70), touch(2, 150)] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, 70), touch(2, 190)] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(
    dialog.getByRole('group', { name: 'Source image zoom' }).getByText('150%', { exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Fit sheet', exact: true }).click()

  await dialog.getByRole('combobox', { name: 'Source image', exact: true }).selectOption('small-edit-image')
  await expect(viewport).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: /Download edit source/ })).toHaveAttribute(
    'href',
    `${host}/preview.webp`,
  )
  await expect(dialog.locator('img[data-image-tile]')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Source image', exact: true })).toHaveValue('small-edit-image')
  await expect(dialog.getByRole('link', { name: /Download edit source/ })).toHaveAttribute(
    'href',
    `${host}/preview.webp`,
  )
  await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await dialog.getByRole('button', { name: 'Map overlay', exact: true }).click()
  await dialog.getByRole('button', { name: 'Edit source', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Source image', exact: true })).toHaveValue('small-edit-image')
  await dialog.getByRole('combobox', { name: 'Source image', exact: true }).selectOption('synthetic-original')

  await page.setViewportSize({ width: 1280, height: 900 })
  await dialog.getByRole('button', { name: 'Compare', exact: true }).click()
  const rectified = dialog.getByRole('img', { name: `${title} · rectified map preview`, exact: true })
  await expect
    .poll(() =>
      rectified.evaluate(
        (image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true)
  await expect(dialog.getByRole('link', { name: /Download rectified GeoTIFF/ })).toHaveAttribute(
    'href',
    `${host}/rectified.tif`,
  )
  await expect(dialog.getByText(/2,049 × 1,025 px/)).toBeVisible()
  await expect(dialog.getByText(/800 × 600 px/)).toBeVisible()
  expect(requests.filter((request) => request.url.endsWith('/source.png'))).toHaveLength(0)
  await page.screenshot({ path: testInfo.outputPath('source-and-rectified.png') })
})
