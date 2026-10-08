import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { execute, installHost, ready, summary } from './flatten-helpers'

test.use({ launchOptions: { executablePath: process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] } })

test('Prince George routes update live, export, share and switch cities', async ({ page, context }) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await installHost(page)
  await page.goto('/dev/flatten/pg')
  await ready(page)
  const initial = await summary(page)
  expect(initial).toMatchObject({ city: 'Prince George', units: 'km', mode: 'walk' })
  expect(initial.from.lat).toBeGreaterThan(53)
  expect(initial.route.distanceMeters).toBeGreaterThan(5000)
  expect(initial.route.climbMeters).toBeGreaterThan(50)
  await expect(page).toHaveTitle('Flatten PG · PGMaps Dev')
  await expect(page.getByRole('button', { name: 'Prince George', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const search = await execute<{ matches: { name: string; latitude: number }[] }>(page, 'search_flatten_places', { query: 'UNBC' })
  expect(search.matches[0].name).toBe('UNBC')
  expect(search.matches[0].latitude).toBeGreaterThan(53)
  for (const which of ['from', 'to'] as const) {
    const before = await summary(page)
    const marker = page.getByRole('button', { name: which === 'from' ? 'Move start point' : 'Move finish point', exact: true })
    const box = (await marker.boundingBox())!
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    const dx = which === 'from' ? -65 : 65
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y + 30, { steps: 20 })
    await expect.poll(async () => {
      const state = await summary(page)
      return state.dragging && state[which]!.lon !== before[which]!.lon && state.route.distanceMeters !== before.route.distanceMeters
    }).toBe(true)
    const held = (await marker.boundingBox())!
    expect(Math.hypot(held.x - box.x - dx, held.y - box.y - 30)).toBeLessThan(3)
    await page.mouse.up()
    await ready(page)
    const after = await summary(page)
    expect(after[which === 'from' ? 'to' : 'from']).toEqual(before[which === 'from' ? 'to' : 'from'])
  }
  const from = page.getByRole('combobox', { name: 'From', exact: true })
  await from.fill('Prince George City Hall')
  await from.press('Enter')
  await ready(page)
  const selected = await summary(page)
  const shared = await context.newPage()
  await installHost(shared)
  await shared.goto(selected.route.shareUrl)
  await ready(shared)
  expect((await summary(shared))).toMatchObject({ city: 'Prince George', route: { distanceMeters: selected.route.distanceMeters, climbMeters: selected.route.climbMeters } })
  await shared.close()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'GPX', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('flattenpg-route.gpx')
  const gpx = await readFile((await file.path())!, 'utf8')
  expect(gpx).toContain('creator="PGMaps Flatten PG"')
  expect(gpx).toContain('lat="53.')
  expect(gpx).not.toMatch(/NaN|undefined/)
  await page.getByRole('button', { name: 'Bike', exact: true }).click()
  await ready(page)
  expect((await summary(page)).mode).toBe('bike')
  await page.getByRole('button', { name: 'Make a loop', exact: true }).click()
  await ready(page)
  expect((await summary(page))).toMatchObject({ loop: true, to: null })
  await page.screenshot({ path: '/workspace/flatten-pg-desktop.png' })
  await page.getByRole('button', { name: 'San Francisco', exact: true }).click()
  await expect(page).toHaveURL(/\/dev\/flatten(?:#|$)/)
  await expect.poll(async () => (await summary(page)).city).toBe('San Francisco')
  await ready(page)
  const sf = await summary(page)
  expect(sf.city).toBe('San Francisco')
  expect(sf.from.lat).toBeLessThan(38)
  expect(sf.route.distanceMeters).toBeCloseTo(7822.2, 6)
  await page.getByRole('button', { name: 'Prince George', exact: true }).click()
  await expect(page).toHaveURL(/\/dev\/flatten\/pg(?:#|$)/)
  await expect.poll(async () => (await summary(page)).city).toBe('Prince George')
  await ready(page)
  expect((await summary(page)).city).toBe('Prince George')
  expect(errors).toEqual([])
})

test('Prince George touch dragging updates the route before release', async ({ browser }) => {
  test.setTimeout(60000)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    const page = await context.newPage()
    await installHost(page)
    await page.goto('/dev/flatten/pg')
    await ready(page)
    const before = await summary(page)
    const marker = page.getByRole('button', { name: 'Move start point', exact: true })
    const box = (await marker.boundingBox())!
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    const client = await context.newCDPSession(page)
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let step = 1; step <= 20; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 75 * step / 20, y: y + 40 * step / 20 }] })
      await page.waitForTimeout(25)
    }
    await expect.poll(async () => {
      const state = await summary(page)
      return state.dragging && state.from.lon !== before.from.lon && state.route.distanceMeters !== before.route.distanceMeters
    }).toBe(true)
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await ready(page)
    expect((await summary(page)).to).toEqual(before.to)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: '/workspace/flatten-pg-mobile.png' })
  } finally { await context.close() }
})
