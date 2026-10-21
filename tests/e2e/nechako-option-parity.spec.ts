import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const transparentPng = Buffer.from(
  // RGBA (0, 0, 0, 0): the WMS fixture must not cover the asserted basemap colour.
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64',
)

async function localMap(page: Page) {
  const errors: string[] = []
  const unexpected: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'basemaps.cartocdn.com')
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
        },
      })
    if (['GetMap', 'GetLegendGraphic'].includes(url.searchParams.get('REQUEST') ?? ''))
      return route.fulfill({ contentType: 'image/png', body: transparentPng })
    unexpected.push(url.href)
    return route.abort('internetdisconnected')
  })
  await page.route('**/api/nechako-portal/status', (route) =>
    route.fulfill({ json: { available: false, loggedIn: false, isAdmin: false, canWrite: false, readOnly: true } }),
  )
  return { errors, unexpected }
}

async function exportedWorkspace(page: Page, save = false) {
  await page
    .getByRole('navigation', { name: 'Watershed portal' })
    .getByRole('button', { name: 'Projects', exact: true })
    .click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export workspace JSON', exact: true }).click()
  const data = JSON.parse(readFileSync((await (await downloaded).path())!, 'utf8'))
  if (save) await page.getByRole('button', { name: 'Save workspace in browser', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  return data
}

for (const width of [1440, 390]) {
  test(`map composition preserves geometry, source names and camera at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    const { errors, unexpected } = await localMap(page)
    await page.goto('/dev/nechako/portal')
    const canvas = page.locator('[data-nechako-portal-map] canvas')
    await expect(canvas).toBeVisible()
    const originalCanvas = await canvas.elementHandle()

    await page.getByRole('button', { name: 'Expand Map Tools', exact: true }).click()
    await page.getByLabel('Named layer or group', { exact: true }).selectOption('River')
    await page.getByRole('button', { name: 'Add layer to map', exact: true }).click()
    await page.getByRole('button', { name: 'Close Map Tools', exact: true }).click()
    await page.getByRole('button', { name: 'Expand Map', exact: true }).click()
    await page.getByLabel('Rename River', { exact: true }).click()
    await page.getByLabel('New name for River', { exact: true }).fill('River — local display name')
    await page.getByRole('button', { name: 'Save layer name', exact: true }).click()
    await expect(page.getByLabel('Show River — local display name', { exact: true })).toBeChecked()
    await page.getByRole('button', { name: 'Close Map', exact: true }).click()
    const before = await exportedWorkspace(page, true)
    expect(before.layers[0].layer.name).toBe('River')
    expect(before.layers[0].displayName).toBe('River — local display name')

    await page.getByRole('button', { name: 'Expand Map Tools', exact: true }).click()
    await page.getByRole('button', { name: 'Export map image', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Export Map', exact: true })
    await expect(dialog).toBeVisible()
    await page.getByLabel('Map image size', { exact: true }).selectOption('custom')
    await expect(page.getByLabel('Map image size', { exact: true })).toHaveValue('custom')
    await page.getByLabel('Map image width', { exact: true }).fill('100')
    await page.getByRole('button', { name: 'Prepare image preview', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('between 240 and 4096')
    await page.getByLabel('Map image width', { exact: true }).fill('1024')
    await page.getByLabel('Map image height', { exact: true }).fill('768')
    await page.getByLabel('Map image title', { exact: true }).fill('Nechako watershed · parity preview')
    await page.getByLabel('Map image north arrow', { exact: true }).selectOption('compass')
    await page.getByRole('button', { name: 'Prepare image preview', exact: true }).click()
    const preview = page.getByRole('img', {
      name: 'Map image preview: Nechako watershed · parity preview',
      exact: true,
    })
    await expect(preview).toBeVisible()
    // The image must actually contain the rendered map, not only a white canvas/title/legend.
    const pixels = await preview.evaluate(async (element) => {
      const image = element as HTMLImageElement
      await image.decode()
      const copy = document.createElement('canvas')
      copy.width = image.naturalWidth
      copy.height = image.naturalHeight
      const context = copy.getContext('2d')!
      context.drawImage(image, 0, 0)
      const rgba = context.getImageData(0, 0, copy.width, copy.height).data
      let mapBackground = 0
      for (let i = 0; i < rgba.length; i += 4)
        if (rgba[i] === 220 && rgba[i + 1] === 233 && rgba[i + 2] === 233 && rgba[i + 3] === 255) mapBackground++
      return { width: copy.width, height: copy.height, mapBackground }
    })
    expect(pixels.width).toBe(1024)
    expect(pixels.height).toBe(768)
    expect(pixels.mapBackground).toBeGreaterThan(1024 * 768 * 0.05)
    await page.getByLabel('Map image title', { exact: true }).fill('Nechako watershed · verified preview')
    await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Update image preview', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeEnabled()
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click()
    const download = await downloaded
    const image = readFileSync((await download.path())!)
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([1024, 768])
    await download.saveAs(testInfo.outputPath(`nechako-export-${width}.png`))
    await page.screenshot({ path: testInfo.outputPath(`nechako-map-composer-${width}.png`), fullPage: true })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Close Map Tools', exact: true }).click()
    const after = await exportedWorkspace(page)
    expect(after.layers).toEqual(before.layers)
    expect(after.vectors).toEqual(before.vectors)
    expect(after.camera).toEqual(before.camera)
    expect(await originalCanvas!.isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
    expect(unexpected).toEqual([])
  })
}

test('the options directory distinguishes source handoffs and navigates to the selected admin section', async ({
  page,
}) => {
  const { errors, unexpected } = await localMap(page)
  await page.goto('/dev/nechako/portal?panel=options')
  await expect(page.getByText('77 of 77 options', { exact: true })).toBeVisible()
  await page.getByLabel('Option availability').selectOption('original')
  await page.getByLabel('Find a portal option').fill('impersonation')
  const impersonation = page.locator('[data-portal-option="impersonate"]')
  await expect(impersonation).toBeVisible()
  await expect(impersonation.getByRole('link', { name: 'Open original portal', exact: true })).toHaveAttribute(
    'href',
    'https://nechakowatershed-portal.ca/',
  )
  await expect(impersonation.getByRole('button')).toHaveCount(0)
  await page.getByLabel('Option availability').selectOption('connected')
  await page.getByLabel('Find a portal option').fill('Forms, fields and visibility')
  await page.getByRole('button', { name: 'Open forms, fields and visibility', exact: true }).click()
  await expect(page).toHaveURL(/panel=administration&admin=forms/)
  await expect(page.getByRole('heading', { name: 'Forms', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Forms', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText(/Connect an authorized account in Account/)).toBeVisible()
  expect(errors).toEqual([])
  expect(unexpected).toEqual([])
})
