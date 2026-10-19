const { chromium, expect } = require('@playwright/test')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { existsSync, createReadStream } = require('node:fs')
const root = path.resolve(__dirname, '../..')
const output = path.join(root, 'test-results/lidar-inspector')
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.svg': 'image/svg+xml',
}
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const [base, relative] = pathname.startsWith('/data/lidar/')
      ? [path.join(root, 'public/data/lidar/bc-093g086'), pathname.slice('/data/lidar/'.length)]
      : pathname.startsWith('/data/lidar-analysis/')
        ? [path.join(root, 'public'), pathname.slice(1)]
        : [
            path.join(root, 'dist-lidar-preview'),
            pathname === '/' || pathname.startsWith('/dev/lidar/') ? 'index.html' : pathname.slice(1),
          ]
    const file = path.resolve(base, relative)
    if (!file.startsWith(base + path.sep)) throw Error('Invalid path')
    const stat = await fs.stat(file)
    if (!stat.isFile()) throw Error('Not a file')
    res.writeHead(200, {
      'content-type': mime[path.extname(file)] || 'application/octet-stream',
      'content-length': stat.size,
    })
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
})
let browser
;(async () => {
  const args = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox']
  if (process.env.HTTPS_PROXY) args.push(`--proxy-server=https=${process.env.HTTPS_PROXY}`)
  if (
    !existsSync(path.join(root, 'dist-lidar-preview/index.html')) ||
    !existsSync(path.join(root, 'public/data/lidar/bc-093g086/ept.json'))
  )
    throw Error('Build lidar:preview:build and prepare the original EPT/analysis data first')
  await fs.mkdir(output, { recursive: true })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/?view=trees`
  browser = await chromium.launch({
    executablePath:
      process.env.LIDAR_CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args,
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
  const page = await context.newPage()
  const errors = [],
    failed = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push({ status: response.status(), url: response.url() })
  })
  const inspector = page.getByLabel('Linked tree inspector')
  const canvas = page.locator('canvas[aria-label^="Interactive side profile for crown-"]').first()
  const visit = async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await canvas.waitFor({ timeout: 65000 })
  }
  const noOuterScroll = async () => {
    const d = await page.evaluate(() => ({
      height: innerHeight,
      scroll: document.documentElement.scrollHeight,
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(d.scroll).toBe(d.height)
    expect(d.scrollWidth).toBe(d.width)
    return d
  }
  await visit()
  await expect(page).toHaveURL(/\/dev\/lidar\/trees\/$/)
  let mobileCanvasBox
  if (!process.env.LIDAR_QA_ROUTES_ONLY) {
    console.log('Desktop actual source loaded')
    await noOuterScroll()
    await page.screenshot({ path: path.join(output, 'desktop.png') })
    await page.getByRole('button', { name: '3D points', exact: true }).click()
    await page.waitForTimeout(1100)
    await page.screenshot({ path: path.join(output, '3d.png') })
    await page.getByRole('button', { name: 'Top map', exact: true }).click()
    await inspector.getByRole('button', { name: 'Thin slice', exact: true }).click()
    await inspector.getByLabel('Total slice width').selectOption('2')
    await expect(inspector.getByLabel('Total slice width')).toHaveValue('2')
    await page.screenshot({ path: path.join(output, 'slice.png') })
    await inspector.getByRole('button', { name: 'Whole crown', exact: true }).click()
    const box = await canvas.boundingBox()
    await canvas.click({ position: { x: box.width / 2, y: box.height * 0.45 } })
    await expect(inspector.getByLabel('Picked original return')).toBeVisible({ timeout: 10000 })
    console.log('Slice and actual point picking passed')
    const png = page.waitForEvent('download')
    await inspector.getByRole('button', { name: 'Download profiles PNG', exact: true }).click()
    await (await png).saveAs(path.join(output, 'browser-export.png'))
    await inspector.getByRole('button', { name: 'Pin for comparison', exact: true }).click()
    await inspector.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(canvas).toHaveAttribute('aria-label', /^Interactive side profile for crown-2;/, { timeout: 65000 })
    await inspector.getByRole('button', { name: 'Pin for comparison', exact: true }).click()
    await inspector.getByRole('tab', { name: 'Review / edit', exact: true }).click()
    await inspector.getByLabel('Tree review decision').selectOption('possible structure')
    await inspector.getByLabel('Tree review notes').fill('Browser QA: inspect original returns')
    await inspector.getByLabel('Tree review notes').press('Tab')
    await inspector.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(inspector.getByLabel('Tree review notes')).toHaveValue('')
    await inspector.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(inspector.getByLabel('Tree review notes')).toHaveValue('Browser QA: inspect original returns')
    const manifest = await page.evaluate(() =>
      JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith('pgmaps-tree-inspection-'))[1]),
    )
    expect(manifest.pins.length).toBe(2)
    expect(manifest.reviews['crown-2'].decision).toBe('possible structure')
    console.log('PNG export, persistent pins, review, undo/redo passed')
    await inspector.getByRole('tab', { name: 'Methods', exact: true }).click()
    await inspector.getByLabel('Segmentation benchmark plot').waitFor({ timeout: 30000 })
    await inspector.getByLabel('Segmentation method A · map').selectOption('pointtree-treex')
    await expect(inspector.getByText('0 core instances', { exact: false }).first()).toBeVisible()
    await inspector.getByLabel('Segmentation benchmark plot').selectOption('crown-85')
    await page.screenshot({ path: path.join(output, 'methods.png') })
    console.log('Actual benchmark selectors passed')
    await page.getByLabel('LiDAR tool', { exact: true }).selectOption('transects')
    const transect = page.getByLabel('Transect workspace', { exact: true })
    const mapBox = await page.locator('[data-lidar-map]').boundingBox()
    await page.waitForTimeout(2500)
    await page.mouse.click(mapBox.x + mapBox.width * 0.4, mapBox.y + mapBox.height * 0.5)
    await page.mouse.click(mapBox.x + mapBox.width * 0.65, mapBox.y + mapBox.height * 0.5)
    await transect.getByRole('button', { name: 'Refresh loaded points', exact: true }).click()
    await expect(transect.getByRole('button', { name: 'Export transect CSV', exact: true })).toBeVisible({
      timeout: 30000,
    })
    await page.screenshot({ path: path.join(output, 'transect.png') })
    console.log('GeoLibre native drawn transect loaded')
    await page.getByLabel('LiDAR tool', { exact: true }).selectOption('trees')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await canvas.waitFor({ timeout: 65000 })
    await noOuterScroll()
    await expect(inspector.getByRole('button', { name: /Profile controls/ })).toHaveAttribute('aria-expanded', 'false')
    mobileCanvasBox = await canvas.boundingBox()
    expect(mobileCanvasBox.height).toBe(180)
    expect(mobileCanvasBox.y).toBeGreaterThanOrEqual(0)
    expect(mobileCanvasBox.y + mobileCanvasBox.height).toBeLessThanOrEqual(844)
    await page.screenshot({ path: path.join(output, 'mobile.png') })
    await page.getByRole('button', { name: 'Panels', exact: true }).click()
    await inspector.getByRole('button', { name: /Profile controls/ }).scrollIntoViewIfNeeded()
    await page.getByRole('button', { name: 'Close side panel', exact: true }).click()
    await noOuterScroll()
    console.log('Mobile fixed viewport, sidebar toggle and visible chart passed')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await inspector.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(canvas).toHaveAttribute('aria-label', /^Interactive side profile for crown-2;/, { timeout: 65000 })
  const map = page.getByLabel('Interactive native LiDAR analysis map', { exact: true })
  await page.waitForTimeout(1100)
  await map.evaluate((el) => {
    el.dataset.qaRetained = 'same-instance'
  })
  await page.getByLabel('Basemap', { exact: true }).selectOption('none')
  const camera = await map.getAttribute('data-map-center')
  expect(camera).not.toBeNull()
  const zoom = await map.getAttribute('data-map-zoom')
  for (const [id, modes] of [
    ['canopy', ['canopy-height', 'canopy-density', 'strata']],
    ['forestry', ['gaps', 'plots', 'texture', 'edges', 'clearance']],
    ['species', null],
    ['buildings', ['models']],
  ]) {
    await page.getByLabel('LiDAR tool', { exact: true }).selectOption(id)
    await expect(page).toHaveURL(new RegExp('/dev/lidar/' + id + '/'))
    if (!(await page.getByRole('button', { name: 'Hide panel', exact: true }).isVisible()))
      await page.getByRole('button', { name: 'Panels', exact: true }).click()
    const analyses = page.getByLabel('LiDAR workflow', { exact: true })
    await analyses.waitFor()
    const values = await analyses.locator('option:not([disabled])').evaluateAll((nodes) => nodes.map((n) => n.value))
    if (modes) expect(values).toEqual(modes)
    else expect(values.every((v) => v.startsWith('species'))).toBe(true)
    await expect(page.getByLabel('Basemap', { exact: true })).toHaveValue('none')
    await expect(map).toHaveAttribute('data-qa-retained', 'same-instance')
    await page.waitForTimeout(1100)
    const retainedCentre = (await map.getAttribute('data-map-center')).split(',').map(Number)
    camera
      .split(',')
      .map(Number)
      .forEach((value, index) => expect(retainedCentre[index]).toBeCloseTo(value, 5))
    expect(Number(await map.getAttribute('data-map-zoom'))).toBeCloseTo(Number(zoom), 7)
    await noOuterScroll()
    await page.screenshot({ path: path.join(output, id + '-workspace.png') })
  }
  await page.getByLabel('LiDAR tool', { exact: true }).selectOption('forestry')
  await page.getByLabel('LiDAR workflow', { exact: true }).selectOption('plots')
  await page
    .getByRole('combobox')
    .filter({ has: page.locator('option[value="25"]') })
    .selectOption('25')
  await page.getByLabel('LiDAR tool', { exact: true }).selectOption('species')
  await page.getByLabel('LiDAR tool', { exact: true }).selectOption('forestry')
  await expect(page.getByLabel('LiDAR workflow', { exact: true })).toHaveValue('plots')
  await expect(page.getByRole('combobox').filter({ has: page.locator('option[value="25"]') })).toHaveValue('25')
  await page.getByLabel('LiDAR tool', { exact: true }).selectOption('canopy')
  await page.getByLabel('LiDAR workflow', { exact: true }).selectOption('canopy-density')
  await expect(page).toHaveURL(/canopy\/\?view=canopy-density/)
  await page.goBack()
  await expect(page.getByLabel('LiDAR workflow', { exact: true })).toHaveValue('canopy-height')
  await page.goForward()
  await expect(page.getByLabel('LiDAR workflow', { exact: true })).toHaveValue('canopy-density')
  await page.getByLabel('LiDAR tool', { exact: true }).selectOption('trees')
  await expect(inspector.getByText('crown-2', { exact: true }).first()).toBeVisible({ timeout: 65000 })
  await page.getByRole('link', { name: 'LiDAR tool library', exact: true }).click()
  await expect(page.getByRole('main', { name: 'LiDAR tool library' })).toBeVisible()
  await expect(page.locator('main a')).toHaveCount(6)
  await page.screenshot({ path: path.join(output, 'tool-library.png') })
  await page.getByRole('link', { name: /Canopy Explore canopy/ }).click()
  await expect(map).toHaveAttribute('data-qa-retained', 'same-instance')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByLabel('LiDAR tool', { exact: true })).toHaveValue('canopy')
  await page.waitForTimeout(3500)
  await page.screenshot({ path: path.join(output, 'canopy-overview.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await noOuterScroll()
  await page.getByRole('link', { name: 'LiDAR tool library', exact: true }).click()
  await noOuterScroll()
  await page.screenshot({ path: path.join(output, 'tool-library-mobile.png') })
  console.log(
    'All focused routes, scoped analyses, retained map/camera, saved selection, legacy redirect, deep reload and history passed',
  )
  expect(errors).toEqual([])
  expect(failed).toEqual([])
  console.log(
    JSON.stringify({
      errors,
      failed,
      mobileCanvasBox,
      exportPngBytes: process.env.LIDAR_QA_ROUTES_ONLY
        ? null
        : (await fs.stat(path.join(output, 'browser-export.png'))).size,
    }),
  )
})()
  .catch((error) => {
    console.error(error.stack)
    process.exitCode = 1
  })
  .finally(async () => {
    await browser?.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
