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
  await expect(page.getByRole('heading', { name: 'Forest road design', exact: true })).toBeVisible()
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await expect.poll(async () => (await mapState(page))?.renderedRoads ?? 0).toBeGreaterThan(0)
  await expect(page.getByTestId('road-profile-chart').locator('path[stroke="#a07845"]')).not.toHaveAttribute('d', '')
  return errors
}

async function saveProject(page: Page): Promise<RoadProject> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const stream = await (await pending).createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
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
  await page
    .getByRole('tablist', { name: 'Road detail view' })
    .getByRole('tab', { name: 'Mass haul', exact: true })
    .click()
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
  await page.getByLabel('Terrain display', { exact: true }).selectOption('aspect')
  await expect(page.getByText('Aspect · downslope direction', { exact: true })).toBeVisible()
  await expect.poll(async () => (await mapState(page))?.terrainHash).not.toBe(initial.terrainHash)
  await page.getByTestId('road-context-visibility').locator('summary').click()
  await page.getByRole('checkbox', { name: 'Show streams context', exact: true }).uncheck()
  await expect
    .poll(async () => (await mapState(page))!.contextKinds)
    .toEqual(initial.contextKinds.filter((kind) => kind !== 'stream'))
  await page.getByRole('checkbox', { name: 'Show streams context', exact: true }).check()
  await expect.poll(async () => (await mapState(page))!.contextKinds).toEqual(initial.contextKinds)
  await page.getByTestId('road-context-visibility').locator('summary').click()
  await page.getByLabel('Terrain display', { exact: true }).selectOption('hillshade')
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
  await page.getByLabel('Road view layout', { exact: true }).selectOption('engineering')
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

  await page.getByLabel('Road view layout', { exact: true }).selectOption('pegging')
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
