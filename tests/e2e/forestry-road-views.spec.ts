import { expect, test, type Locator, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

/** Verify rendered map geometry, not only the React status label. */
async function mapState(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    if (!container) return null
    const key = Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState
        const map =
          value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getTerrain !== 'function') continue
        const source = map.getSource('road-section')
        const context = map.getSource('road-context')
        const terrain = map.getSource('road-terrain')?.serialize()
        const terrainUrl = terrain && 'url' in terrain ? String(terrain.url) : ''
        return {
          renderedRoads: map.getLayer('road-alignments')
            ? map.queryRenderedFeatures({ layers: ['road-alignments'] }).length
            : 0,
          section:
            source?.type === 'geojson'
              ? (source.serialize().data as GeoJSON.FeatureCollection).features[0]?.geometry
              : undefined,
          contextKinds:
            context?.type === 'geojson'
              ? (context.serialize().data as GeoJSON.FeatureCollection).features.map((f) => String(f.properties?.kind))
              : [],
          terrainHash: Array.from(terrainUrl).reduce(
            (hash, character) => ((hash * 31) ^ character.charCodeAt(0)) >>> 0,
            0,
          ),
        }
      }
    }
    return null
  })
}

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  if ((page.viewportSize()?.width ?? 1512) < 768)
    await expect(page.getByRole('button', { name: 'Main menu', exact: true })).toHaveText('Road design')
  else await expect(page.getByRole('heading', { name: 'Forest road design', exact: true })).toBeVisible()
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await expect.poll(async () => (await mapState(page))?.renderedRoads ?? 0).toBeGreaterThan(0)
  const tabs = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
  if (await tabs.isVisible()) await tabs.getByRole('tab', { name: 'Profile', exact: true }).click()
  await expect(page.getByTestId('road-profile-chart').locator('path[stroke="#a07845"]')).not.toHaveAttribute('d', '')
  if (await tabs.isVisible()) await tabs.getByRole('tab', { name: 'Plan', exact: true }).click()
  return errors
}

/** The layout picker is a combobox in the page header. */
async function chooseLayout(page: Page, name: string) {
  await page
    .getByTestId('road-workspace-header')
    .getByRole('combobox', { name: 'Road view layout', exact: true })
    .click()
  await page.getByRole('option', { name, exact: true }).click()
}

async function saveProject(page: Page): Promise<RoadProject> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const stream = await (await pending).createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as RoadProject
}

async function selectStation(page: Page, station: number) {
  const field = page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })
  await field.fill(String(station))
  await field.press('Tab')
}

async function expectLinkedStation(page: Page, station: number) {
  await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', String(station))
  await expect(page.getByTestId('road-active-map-station')).toHaveAttribute('data-chainage', String(station))
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', String(station))
}

async function rangeOf(locator: Locator) {
  return [
    Number(await locator.getAttribute('data-range-start')),
    Number(await locator.getAttribute('data-range-end')),
  ] as const
}

async function hoverSectionCentre(page: Page) {
  const chart = page.getByTestId('road-section-chart')
  await chart.scrollIntoViewIfNeeded()
  const box = (await chart.boundingBox())!
  const left = box.width < 380 ? 48 : 58
  await page.mouse.move(box.x + left + (box.width - left - 16) / 2, box.y + box.height * 0.5)
  const probe = page.getByTestId('road-section-probe')
  await expect(probe).toContainText('Offset 0 m')
  await expect(probe).toContainText('centreline')
  const text = (await probe.textContent())!
  const levels = text.match(/ground ([\d,.-]+) m\s*· design ([\d,.-]+) m/)
  expect(levels).not.toBeNull()
  return { ground: Number(levels![1].replace(/,/g, '')), design: Number(levels![2].replace(/,/g, '')) }
}

test('profile zoom, pan, fit and vertical exaggeration affect only the display', async ({ page }) => {
  const errors = await prepare(page)
  const original = await saveProject(page)
  await selectStation(page, 200)
  const chart = page.getByTestId('road-profile-chart')
  const initial = await rangeOf(chart)
  const initialGround = await chart.locator('path[stroke="#a07845"]').getAttribute('d')
  await page.getByRole('button', { name: 'Zoom profile in', exact: true }).click()
  const zoomed = await rangeOf(chart)
  expect(zoomed[1] - zoomed[0]).toBeCloseTo((initial[1] - initial[0]) / 2, 5)
  expect(zoomed[0]).toBeLessThanOrEqual(200)
  expect(zoomed[1]).toBeGreaterThanOrEqual(200)
  await expect(chart.locator('path[stroke="#a07845"]')).not.toHaveAttribute('d', initialGround!)

  await page.getByRole('button', { name: 'Pan profile forward', exact: true }).click()
  const panned = await rangeOf(chart)
  expect(panned[0]).toBeGreaterThan(zoomed[0])
  expect(panned[1] - panned[0]).toBeCloseTo(zoomed[1] - zoomed[0], 5)
  await page.getByRole('button', { name: 'Pan profile backward', exact: true }).click()
  const returned = await rangeOf(chart)
  expect(returned[0]).toBeCloseTo(zoomed[0], 5)
  expect(returned[1]).toBeCloseTo(zoomed[1], 5)

  // Wheel zoom about the pointer, then a horizontal scroll pans; neither scrolls the page.
  const plot = (await chart.boundingBox())!
  await page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5)
  const scrollBefore = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)
  await page.mouse.wheel(0, -240)
  await expect
    .poll(async () => (await rangeOf(chart))[1] - (await rangeOf(chart))[0])
    .toBeLessThan(returned[1] - returned[0])
  const wheeled = await rangeOf(chart)
  await page.mouse.wheel(200, 0)
  await expect.poll(async () => (await rangeOf(chart))[0]).toBeGreaterThan(wheeled[0])
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(scrollBefore)
  for (let notch = 0; notch < 8; notch++) await page.mouse.wheel(0, 400)
  await expect.poll(() => rangeOf(chart)).toEqual(initial)
  await page.getByRole('button', { name: 'Zoom profile in', exact: true }).click()
  await page.getByRole('button', { name: 'Pan profile forward', exact: true }).click()
  await page.getByRole('button', { name: 'Pan profile backward', exact: true }).click()

  await page.getByLabel('Profile vertical exaggeration', { exact: true }).selectOption('5')
  await expect.poll(async () => Number(await chart.getAttribute('data-vertical-exaggeration'))).toBeCloseTo(5, 5)
  await expectLinkedStation(page, 200)
  await page.getByRole('button', { name: 'Zoom profile out', exact: true }).click()
  expect(await rangeOf(chart)).toEqual(initial)
  await page.getByRole('button', { name: 'Fit full road profile', exact: true }).click()
  expect(await rangeOf(chart)).toEqual(initial)
  await expect(page.getByLabel('Profile vertical exaggeration', { exact: true })).toHaveValue('fit')
  expect(await saveProject(page)).toEqual(original)
  expect(errors).toEqual([])
})

test('an off-screen shared station is revealed and profile bands keep the same chainage domain', async ({ page }) => {
  const errors = await prepare(page)
  await selectStation(page, 100)
  const chart = page.getByTestId('road-profile-chart')
  const full = await rangeOf(chart)
  await page.getByRole('button', { name: 'Zoom profile in', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom profile in', exact: true }).click()
  const zoomed = await rangeOf(chart)
  const bands = page.getByTestId('road-engineering-bands')
  await bands.getByRole('button', { name: /Grade, curve, template & material bands/ }).click()
  await expect(bands.locator('svg')).toBeVisible()
  expect(await rangeOf(bands)).toEqual(zoomed)

  const destination = Math.floor((full[1] - 20) / 10) * 10
  expect(destination).toBeGreaterThan(zoomed[1])
  await selectStation(page, destination)
  await expectLinkedStation(page, destination)
  const revealed = await rangeOf(chart)
  expect(revealed[0]).toBeGreaterThan(zoomed[0])
  expect(revealed[0]).toBeLessThanOrEqual(destination)
  expect(revealed[1]).toBeGreaterThanOrEqual(destination)
  expect(revealed[1] - revealed[0]).toBeCloseTo(zoomed[1] - zoomed[0], 5)
  expect(await rangeOf(bands)).toEqual(revealed)

  // Select through the visible data band using a real pointer hit.
  const target = Math.round((revealed[0] + (revealed[1] - revealed[0]) / 3) / 10) * 10
  const svg = bands.locator('svg')
  await svg.scrollIntoViewIfNeeded()
  const box = (await svg.boundingBox())!
  const left = box.width < 380 ? 48 : 58
  const x = box.x + left + ((target - revealed[0]) / (revealed[1] - revealed[0])) * (box.width - left - 16)
  await page.mouse.click(x, box.y + 11)
  await expectLinkedStation(page, target)
  await expect
    .poll(async () => Number(await page.getByLabel('Selected station metres', { exact: true }).inputValue()))
    .toBeCloseTo(target, 0)
  expect(await rangeOf(bands)).toEqual(await rangeOf(chart))
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: 'Mass haul', exact: true }).click()
  const mass = page.getByTestId('road-mass-chart')
  await expect(mass).toBeVisible()
  await expect.poll(async () => rangeOf(mass)).toEqual(await rangeOf(chart))
  await page.getByRole('button', { name: 'Zoom profile out', exact: true }).click()
  await expect.poll(async () => rangeOf(mass)).toEqual(await rangeOf(chart))
  expect(await rangeOf(bands)).toEqual(await rangeOf(chart))
  await page.getByRole('button', { name: 'Fit full road profile', exact: true }).click()
  await expect.poll(async () => rangeOf(mass)).toEqual(full)
  expect(errors).toEqual([])
})

test('terrain aspect and context visibility change actual map sources without modifying the project', async ({
  page,
}) => {
  const errors = await prepare(page)
  const original = await saveProject(page)
  const initial = (await mapState(page))!
  expect(initial.terrainHash).not.toBe(0)
  expect(initial.contextKinds).toContain('stream')
  await page.getByRole('combobox', { name: 'Terrain display', exact: true }).click()
  await page.getByRole('option', { name: 'Aspect', exact: true }).click()
  await page.getByRole('button', { name: 'Expand legend', exact: true }).click()
  await expect(page.getByText('Aspect · downslope direction', { exact: true })).toBeVisible()
  await expect.poll(async () => (await mapState(page))?.terrainHash).not.toBe(initial.terrainHash)
  await page.getByRole('button', { name: 'Map display settings', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Show streams context', exact: true }).uncheck()
  await expect
    .poll(async () => (await mapState(page))!.contextKinds)
    .toEqual(initial.contextKinds.filter((kind) => kind !== 'stream'))
  await page.getByRole('checkbox', { name: 'Show streams context', exact: true }).check()
  await expect.poll(async () => (await mapState(page))!.contextKinds).toEqual(initial.contextKinds)
  await page.getByRole('button', { name: 'Map display settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'Terrain display', exact: true }).click()
  await page.getByRole('option', { name: 'Hillshade', exact: true }).click()
  await expect.poll(async () => (await mapState(page))?.terrainHash).toEqual(initial.terrainHash)
  expect(await saveProject(page)).toEqual(original)
  expect(errors).toEqual([])
})

test('section probe and vertical shifts update calculated levels and persist the selected PVI', async ({ page }) => {
  const errors = await prepare(page)
  const original = await saveProject(page)
  const initial = original.alignments.find((a) => a.id === original.activeAlignmentId)!
  expect(initial.vertical.some((p) => Math.abs(p.chainage - 200) < 0.001)).toBe(false)
  await selectStation(page, 200)
  await expectLinkedStation(page, 200)
  const before = await hoverSectionCentre(page)
  expect(Number.isFinite(before.ground)).toBe(true)
  expect(Number.isFinite(before.design)).toBe(true)
  const chart = page.getByTestId('road-section-chart')
  const designPath = await chart.locator('path[stroke="#0d9488"]').getAttribute('d')

  await page.getByRole('button', { name: 'Raise formation 0.25 metres', exact: true }).click()
  await expect(chart.locator('path[stroke="#0d9488"]')).not.toHaveAttribute('d', designPath!)
  const raised = await hoverSectionCentre(page)
  expect(raised.ground).toBe(before.ground)
  expect(raised.design - before.design).toBeCloseTo(0.25, 2)
  const savedRaised = await saveProject(page)
  const raisedAlignment = savedRaised.alignments.find((a) => a.id === initial.id)!
  const pvi = raisedAlignment.vertical.find((p) => Math.abs(p.chainage - 200) < 0.001)!
  expect(pvi).toBeDefined()
  expect(pvi.elevation).toBeCloseTo(raised.design, 2)
  expect(raisedAlignment.vertical.filter((p) => p.id !== pvi.id)).toEqual(initial.vertical)
  expect(raisedAlignment.points).toEqual(initial.points)
  expect(raisedAlignment.template).toEqual(initial.template)
  await expectLinkedStation(page, 200)

  await page.getByRole('button', { name: 'Lower formation 0.25 metres', exact: true }).click()
  const lowered = await hoverSectionCentre(page)
  expect(lowered.design).toBeCloseTo(before.design, 2)
  expect(lowered.ground).toBe(before.ground)
  const savedLowered = await saveProject(page)
  const lowerPvi = savedLowered.alignments.find((a) => a.id === initial.id)!.vertical.find((p) => p.id === pvi.id)!
  expect(lowerPvi.elevation).toBeCloseTo(pvi.elevation - 0.25, 8)
  expect(errors).toEqual([])
})

test('engineering and pegging four-pane layouts keep one map and a shared station', async ({ page }, testInfo) => {
  const errors = await prepare(page)
  const original = await saveProject(page)
  await chooseLayout(page, 'Plan · profile · section · data')
  await expect(page.getByTestId('road-connected-layout')).toHaveAttribute('data-layout', 'engineering')
  await expect(page.getByRole('region', { name: 'Station data · connected selection', exact: true })).toBeVisible()
  await expect(page.locator('[data-testid="road-plan-view"] .maplibregl-map')).toHaveCount(1)
  const before = (await mapState(page))!.section
  await page.getByRole('button', { name: 'Select station 400.0', exact: true }).click()
  await expectLinkedStation(page, 400)
  expect((await mapState(page))!.section).not.toEqual(before)
  const selectedRow = page.getByTestId('road-station-table').locator('tr[aria-selected="true"]')
  await expect(selectedRow).toContainText('0+400.0')
  const profile = page.getByTestId('road-profile-chart')
  await profile.focus()
  await profile.press('ArrowRight')
  await expectLinkedStation(page, 410)
  await expect(selectedRow).toContainText('0+410.0')
  await page.screenshot({ path: testInfo.outputPath('engineering-four-pane.png'), fullPage: true })

  await chooseLayout(page, 'Plan · profile · section · pegging')
  await expect(page.getByTestId('road-connected-layout')).toHaveAttribute('data-layout', 'pegging')
  const pegPanel = page.getByRole('region', { name: 'Pegging data · editable legs', exact: true })
  await expect(pegPanel).toBeVisible()
  // The editable table must scroll inside its panel instead of covering the section controls.
  await expect
    .poll(async () => {
      const panel = (await pegPanel.boundingBox())!
      const editor = (await page.getByTestId('road-pegging-editor').boundingBox())!
      return editor.x + editor.width <= panel.x + panel.width
    })
    .toBe(true)
  await expectLinkedStation(page, 410)
  await expect(page.locator('[data-testid="road-plan-view"] .maplibregl-map')).toHaveCount(1)
  const sectionAt410 = (await mapState(page))!.section
  await page.getByTestId('peg-row-2').getByRole('button', { name: '2', exact: true }).click()
  const fromPeg = Number(await page.getByTestId('road-active-map-station').getAttribute('data-chainage'))
  expect(fromPeg).toBeGreaterThan(0)
  expect(fromPeg).not.toBe(410)
  await expectLinkedStation(page, fromPeg)
  expect(Number(await page.getByLabel('Selected station metres', { exact: true }).inputValue())).toBeCloseTo(fromPeg, 1)
  expect((await mapState(page))!.section).not.toEqual(sectionAt410)
  await expect.poll(async () => (await mapState(page))?.renderedRoads ?? 0).toBeGreaterThan(0)
  await page.screenshot({ path: testInfo.outputPath('pegging-four-pane.png'), fullPage: true })
  expect(await saveProject(page)).toEqual(original)
  expect(errors).toEqual([])
})

async function dragBy(page: Page, handle: Locator, dx: number, dy: number) {
  await handle.scrollIntoViewIfNeeded()
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2)
  await page.mouse.move(x + dx, y + dy)
  await page.mouse.up()
}
const widthOf = async (locator: Locator) => (await locator.boundingBox())!.width
const heightOf = async (locator: Locator) => (await locator.boundingBox())!.height

test('every pane boundary drags, and each layout keeps its own sizes', async ({ page }, testInfo) => {
  const errors = await prepare(page)
  const original = await saveProject(page)
  const plan = page.getByRole('region', { name: 'Plan · alignment & terrain', exact: true })
  const profile = page.getByRole('region', { name: 'Road profile · ground & formation', exact: true })
  const columns = page.getByRole('separator', { name: 'Resize plan and view column', exact: true })
  const views = page.getByRole('separator', { name: 'Resize profile and detail view', exact: true })
  const controls = page.getByRole('separator', { name: 'Resize road controls and connected views', exact: true })

  const defaultPlanWidth = await widthOf(plan)
  const defaultShare = await columns.getAttribute('aria-valuenow')
  await dragBy(page, columns, -120, 0)
  await expect.poll(() => widthOf(plan)).toBeCloseTo(defaultPlanWidth - 120, -1)
  const profileHeight = await heightOf(profile)
  await dragBy(page, views, 0, 90)
  await expect.poll(() => heightOf(profile)).toBeCloseTo(profileHeight + 90, -1)
  const controlsShare = Number(await controls.getAttribute('aria-valuenow'))
  await dragBy(page, controls, 60, 0)
  await expect.poll(async () => Number(await controls.getAttribute('aria-valuenow'))).toBeGreaterThan(controlsShare)

  // Keyboard resizing, and the map and charts follow their new pane sizes.
  await columns.focus()
  const share = Number(await columns.getAttribute('aria-valuenow'))
  await columns.press('ArrowRight')
  await expect.poll(async () => Number(await columns.getAttribute('aria-valuenow'))).toBeGreaterThan(share)
  await expect
    .poll(async () => (await page.locator('[data-testid="road-plan-view"] .maplibregl-canvas').boundingBox())!.width)
    .toBeLessThan(defaultPlanWidth - 60)
  const linkedPlanWidth = await widthOf(plan)
  const linkedProfileHeight = await heightOf(profile)

  await page.reload()
  await expect(page.getByTestId('road-profile-chart')).toBeVisible()
  await expect.poll(() => widthOf(plan)).toBeCloseTo(linkedPlanWidth, -1)
  await expect.poll(() => heightOf(profile)).toBeCloseTo(linkedProfileHeight, -1)

  // The four-view layouts start from their own defaults and remember their own boundaries.
  await chooseLayout(page, 'Plan · profile · section · data')
  const planData = page.getByRole('separator', { name: 'Resize plan and data', exact: true })
  await expect(planData).toBeVisible()
  const planHeight = await heightOf(plan)
  await dragBy(page, planData, 0, -70)
  await expect.poll(() => heightOf(plan)).toBeCloseTo(planHeight - 70, -1)
  const engineeringPlanHeight = await heightOf(plan)
  await page.screenshot({ path: testInfo.outputPath('resized-engineering.png') })
  await chooseLayout(page, 'Linked overview')
  await expect.poll(() => widthOf(plan)).toBeCloseTo(linkedPlanWidth, -1)
  await chooseLayout(page, 'Plan · profile · section · data')
  await expect.poll(() => heightOf(plan)).toBeCloseTo(engineeringPlanHeight, -1)
  await chooseLayout(page, 'Linked overview')

  // Double-click restores a boundary's default share.
  await columns.dblclick()
  await expect(columns).toHaveAttribute('aria-valuenow', defaultShare!)
  expect(await saveProject(page)).toEqual(original)
  expect(errors).toEqual([])
})

test('phone widths switch bounded panes without scrolling or losing the shared station', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await prepare(page)
  await expect(page.getByRole('button', { name: 'Screen presets & panels', exact: true })).toBeVisible()
  await expect(page.getByTestId('road-connected-layout')).toHaveAttribute('data-focused-pane', 'plan')
  await expect(page.getByRole('separator', { name: 'Resize plan and view column', exact: true })).toHaveCount(0)
  const plan = page.getByRole('region', { name: 'Plan · alignment & terrain', exact: true })
  await expect(plan).toBeVisible()
  await selectStation(page, 200)
  await page
    .getByRole('tablist', { name: 'Visible road pane', exact: true })
    .getByRole('tab', { name: 'Profile', exact: true })
    .click()
  const profile = page.getByRole('region', { name: 'Road profile · ground & formation', exact: true })
  await expect(profile).toBeVisible()
  await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', '200')
  await expect(plan).toBeHidden()
  await page
    .getByRole('tablist', { name: 'Visible road pane', exact: true })
    .getByRole('tab', { name: 'Detail', exact: true })
    .click()
  await expect(page.getByTestId('road-section-chart')).toBeVisible()
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', '200')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  expect(
    await page.evaluate(() => {
      const shell = document.getElementById('main-content')!
      return shell.scrollHeight <= shell.clientHeight + 1
    }),
  ).toBe(true)
  expect(errors).toEqual([])
})

test('header picker, no footer or status row, profile controls on the chart, section seen up-station', async ({
  page,
}, testInfo) => {
  const errors = await prepare(page)
  await expect(
    page.getByTestId('road-workspace-header').getByRole('combobox', { name: 'Road view layout', exact: true }),
  ).toHaveText(/Linked overview/)
  await expect(page.getByText(/Concept planning/)).toHaveCount(0)
  await expect(page.getByText(/average end areas/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Dismiss status', exact: true })).toHaveCount(0)
  // The planning basis stays one hover away on the terrain badge.
  expect(await page.getByTestId('road-planning-basis').getAttribute('title')).toMatch(
    /Concept planning.*average end areas.*engineering review/,
  )

  const chart = (await page.getByTestId('road-profile-chart').boundingBox())!
  const toolbar = page.getByRole('toolbar', { name: 'Profile view', exact: true })
  const bar = (await toolbar.boundingBox())!
  expect(bar.y).toBeGreaterThanOrEqual(chart.y - 1)
  expect(bar.y + bar.height).toBeLessThanOrEqual(chart.y + 32)
  expect(bar.x + bar.width).toBeLessThanOrEqual(chart.x + chart.width + 1)
  for (const name of ['Pan profile backward', 'Zoom profile in', 'Zoom profile out', 'Pan profile forward'])
    await expect(toolbar.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(toolbar.getByLabel('Profile vertical exaggeration', { exact: true })).toBeVisible()
  await expect(page.getByTestId('road-profile-range')).toHaveText(/0\+000\.0–\d\+\d{3}\.\d/)

  // The detail view picker sits in the panel's title row, beside the title and Section CSV.
  const sectionPanel = page.getByRole('region', { name: 'Cross-section', exact: true })
  const title = (await sectionPanel.getByRole('heading', { name: 'Cross-section', exact: true }).boundingBox())!
  const picker = (await sectionPanel.getByRole('combobox', { name: 'Road detail view', exact: true }).boundingBox())!
  const csv = (await sectionPanel.getByRole('button', { name: 'Section CSV', exact: true }).boundingBox())!
  expect(Math.abs(picker.y + picker.height / 2 - (title.y + title.height / 2))).toBeLessThan(8)
  expect(picker.x).toBeGreaterThan(title.x)
  expect(csv.x).toBeGreaterThan(picker.x)
  await expect(sectionPanel.getByRole('tablist')).toHaveCount(0)

  // Plan labels follow the zoom: few at the overview, more after zooming in, and the
  // selected station always carries its readout.
  await expect(page.getByTestId('road-active-map-label')).toContainText('0+000.0')
  const spacing = async () => {
    const values = await page
      .locator('[data-plan-station-label]')
      .evaluateAll((nodes) => nodes.map((n) => Number(n.getAttribute('data-plan-station-label'))))
    values.sort((x, y) => x - y)
    return values.length > 2 ? values[2] - values[1] : Infinity
  }
  expect(await page.locator('[data-plan-station-label]').count()).toBeGreaterThanOrEqual(2)
  const overviewSpacing = await spacing()
  for (let i = 0; i < 2; i++)
    await page
      .getByTestId('road-plan-view')
      .getByRole('button', { name: /zoom in/i })
      .click()
  await expect.poll(spacing).toBeLessThan(overviewSpacing)

  // Looking up-station: L on the left, R on the right, and the left of the plot is a negative offset.
  await selectStation(page, 300)
  const label = (await page.getByTestId('road-section-station-label').boundingBox())!
  await expect(page.getByTestId('road-section-station-label')).toHaveText('0+300.0')
  expect((await page.locator('[data-section-side="left"]').boundingBox())!.x).toBeLessThan(label.x)
  expect((await page.locator('[data-section-side="right"]').boundingBox())!.x).toBeGreaterThan(label.x)
  const section = page.getByTestId('road-section-chart')
  const box = (await section.boundingBox())!
  await page.mouse.move(box.x + 58 + (box.width - 74) * 0.2, box.y + box.height * 0.5)
  await expect(page.getByTestId('road-section-probe')).toContainText(/Offset -\d/)
  await expect(page.getByTestId('road-section-readout')).toContainText('L-Stn:0+300.0')
  await page.screenshot({ path: testInfo.outputPath('linked-overview.png') })
  expect(errors).toEqual([])
})

test('the covered estimate opens its calculation and rate edits recalculate the road', async ({ page }, testInfo) => {
  const errors = await prepare(page)
  const original = await saveProject(page)
  const tile = page.getByRole('button', { name: 'Show how the covered estimate is calculated', exact: true })
  const headline = async () => Number((await tile.locator('xpath=..').locator('dd').innerText()).replace(/[$,]/g, ''))
  const before = await headline()
  await tile.click()
  const dialog = page.getByTestId('road-cost-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('road-rate-source')).toContainText('not taken from a published cost survey')
  await expect(dialog.getByRole('combobox', { name: 'Rate preset', exact: true })).toHaveText(
    /PG Maps placeholder rates/,
  )
  const money = (text: string | null) => Number(text!.replace(/[$,]/g, ''))
  const total = dialog.getByTestId('road-cost-total')
  expect(money(await total.textContent())).toBeCloseTo(before, -1)

  // Each line is quantity × rate; editing a rate recalculates the line, the total and the headline.
  const fill = dialog.locator('[data-cost-row="fill"]')
  const fillQuantity = money(await fill.locator('td').nth(1).textContent())
  await dialog.getByLabel('Fill rate', { exact: true }).fill('10')
  await dialog.getByLabel('Fill rate', { exact: true }).press('Tab')
  await expect.poll(async () => money(await fill.locator('td').nth(4).textContent())).toBeCloseTo(fillQuantity * 10, 0)
  const raised = money(await total.textContent())
  expect(raised).toBeGreaterThan(before)
  await expect(dialog.getByTestId('road-cost-change')).toContainText('since opened')
  await expect(dialog.getByRole('combobox', { name: 'Rate preset', exact: true })).toHaveText(/Custom/)
  await page.screenshot({ path: testInfo.outputPath('cost-breakdown.png') })
  await page.keyboard.press('Escape')
  await expect.poll(headline).toBeCloseTo(raised, -1)
  expect((await saveProject(page)).settings.fillRate).toBe(10)

  // The preset restores every base rate.
  await tile.click()
  await dialog.getByRole('combobox', { name: 'Rate preset', exact: true }).click()
  await page.getByRole('option', { name: 'PG Maps placeholder rates', exact: true }).click()
  await expect.poll(async () => money(await total.textContent())).toBeCloseTo(before, -1)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect((await saveProject(page)).settings).toEqual(original.settings)
  expect(errors).toEqual([])
})
