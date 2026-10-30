import { expect, test, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

async function openTraining(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  if ((page.viewportSize()?.width ?? 1512) < 768)
    await expect(page.getByRole('button', { name: 'Main menu', exact: true })).toHaveText('Road design')
  else await expect(page.getByRole('heading', { name: 'Forest road design', exact: true })).toBeVisible()
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  const panes = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
  if (await panes.isVisible()) await panes.getByRole('tab', { name: 'Profile', exact: true }).click()
  await expect(page.getByTestId('road-profile-chart').locator('path[stroke="#a07845"]')).not.toHaveAttribute('d', '')
  if (await panes.isVisible()) await panes.getByRole('tab', { name: 'Plan', exact: true }).click()
}

async function expectStation(page: Page, chainage: number) {
  await expect(page.getByTestId('road-active-map-station')).toHaveAttribute('data-chainage', String(chainage))
  await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', String(chainage))
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', String(chainage))
}

async function downloadProject(page: Page): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const pending = page.waitForEvent('download')
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

/** Check the real MapLibre source, including whether an obsolete preview was cleared. */
async function mapContext(page: Page) {
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
        const features = (id: string) => {
          const source = map.getSource(id)
          return source?.type === 'geojson' ? (source.serialize().data as GeoJSON.FeatureCollection).features : []
        }
        return {
          overlay: features('road-overlay'),
          preview: features('road-overlay').filter((feature) => feature.properties?.kind === 'live-route-preview'),
          context: features('road-context').map((feature) => String(feature.properties?.kind)),
          roads: [...new Set(features('road-roads').map((feature) => feature.properties?.id))],
        }
      }
    }
    return null
  })
}

test('station typing and keyboard stepping update connected views while the field stays focused', async ({ page }) => {
  await openTraining(page)
  const field = page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })
  await field.fill('200')
  await expectStation(page, 200)
  await expect(field).toBeFocused()
  await field.press('ArrowUp')
  await expectStation(page, 210)
  await expect(field).toBeFocused()
  await field.press('ArrowDown')
  await expectStation(page, 200)
  await expect(field).toBeFocused()

  // Empty intermediate text must not jump to zero or destroy the active selection.
  await field.fill('')
  await expectStation(page, 200)
  await field.fill('400')
  await expectStation(page, 400)
  await expect(field).toBeFocused()
})

test('formation-level keyboard changes redraw the profile before blur', async ({ page }) => {
  await openTraining(page)
  const profile = page.getByTestId('road-profile-chart').locator('path[stroke="#0d9488"]')
  const before = await profile.getAttribute('d')
  const level = page.getByRole('spinbutton', { name: 'PVI 1 level', exact: true })
  const initial = Number(await level.inputValue())
  await level.focus()
  await level.press('ArrowUp')
  await expect.poll(async () => Number(await level.inputValue())).toBeCloseTo(initial + 0.1, 5)
  await expect(profile).not.toHaveAttribute('d', before!)
  await expect(level).toBeFocused()
  await level.press('ArrowDown')
  await expect.poll(async () => Number(await level.inputValue())).toBeCloseTo(initial, 5)
  await expect(level).toBeFocused()
})

test('an active template preview follows numeric edits without saving the template', async ({ page }) => {
  await openTraining(page)
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Engineering', exact: true })
    .click()
  await page.getByRole('button', { name: 'Add named template', exact: true }).click()
  await page.getByRole('button', { name: 'Preview at station', exact: true }).click()
  await expect(page.getByText(/Template preview:/)).toBeVisible()
  const section = page.getByTestId('road-section-chart').locator('path[stroke="#0d9488"]')
  const before = await section.getAttribute('d')
  const width = page.getByRole('spinbutton', { name: 'Template left width (m)', exact: true })
  const savedWidth = await width.inputValue()
  await width.focus()
  await width.press('ArrowUp')
  await expect(section).not.toHaveAttribute('d', before!)
  await expect(width).toBeFocused()
  await expect(page.getByRole('button', { name: 'Save template', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await expect(page.getByText(/Template preview:/)).toHaveCount(0)
  await expect(width).toHaveValue(savedWidth)
})

test('live route costs refresh before blur and an impossible constraint clears the map preview', async ({ page }) => {
  await openTraining(page)
  await page.getByTestId('road-route-tools').click()
  await page.getByRole('checkbox', { name: 'Live route preview', exact: true }).check()
  const status = page.getByTestId('road-live-route-preview')
  await expect(status).toContainText('search score')
  await expect.poll(async () => (await mapContext(page))?.preview.length).toBe(1)
  const previous = await status.innerText()
  const rate = page.getByRole('spinbutton', { name: 'Road $/m', exact: true })
  await rate.focus()
  await rate.press('ArrowUp')
  await expect(status).not.toHaveText(previous)
  await expect(status).toContainText('search score')
  await expect(rate).toBeFocused()
  await expect.poll(async () => (await mapContext(page))?.preview.length).toBe(1)

  await page.getByRole('spinbutton', { name: 'Maximum grade %', exact: true }).fill('1')
  await expect(status).toContainText(/No terrain-cost path|failed the finer terrain check|budget/)
  await expect.poll(async () => (await mapContext(page))?.preview.length).toBe(0)
  // The live preview must never silently replace or append to the editable alternatives.
  await expect.poll(async () => (await mapContext(page))?.roads.length).toBe(2)
})

test('the library loads a complete offline scenario with its matching terrain and context', async ({ page }) => {
  await openTraining(page)
  const level = page.getByRole('spinbutton', { name: 'PVI 1 level', exact: true })
  const original = await level.inputValue()
  await level.fill('900')
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  const dialog = page.getByTestId('road-projects-dialog')
  await dialog.getByRole('button', { name: /Browse \d+ example scenarios/ }).click()
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveCount(9)
  await dialog.getByRole('button', { name: 'Load Training · nearby free gravel', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(level).toHaveValue(original)
  await expect(page.getByTestId('road-planning-basis')).toHaveText('SYNTHETIC TRAINING')
  await expect.poll(async () => (await mapContext(page))?.roads.length).toBe(2)
  await expect
    .poll(async () => (await mapContext(page))?.context)
    .toEqual(expect.arrayContaining(['existing-road', 'harvest', 'stream', 'avoid']))
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Engineering', exact: true })
    .click()
  await page
    .getByRole('tablist', { name: 'Engineering inputs', exact: true })
    .getByRole('tab', { name: 'Haul', exact: true })
    .click()
  await page.getByRole('button', { name: 'Haul & cost settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Haul & cost settings', exact: true })
  await expect(settings.getByRole('checkbox', { name: 'Use this aggregate source', exact: true })).toBeChecked()
  await expect(settings.getByRole('spinbutton', { name: 'Acquisition ($/compacted m³)', exact: true })).toHaveValue('0')
  const cost = settings.getByText(/Delivered rate \$/)
  const enabled = await cost.innerText()
  await settings.getByRole('checkbox', { name: 'Use this aggregate source', exact: true }).uncheck()
  await expect(cost).not.toHaveText(enabled)
  await expect(cost).toContainText('0.0 m³ from source')
})

test('uploaded roads retain explicit condition evidence in a portable project and closed roads cannot be reused', async ({
  page,
}) => {
  await openTraining(page)
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Terrain', exact: true })
    .click()
  await page.getByTestId('road-existing-roads-input').setInputFiles({
    name: 'survey-roads.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Surveyed spur' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [-122.72, 53.89],
                [-122.716, 53.892],
              ],
            },
          },
        ],
      }),
    ),
  })
  const panel = page.getByTestId('road-existing-roads')
  await expect(panel.getByTestId('road-existing-road-evidence')).toContainText('Construction year: unknown')
  const reuse = panel.getByRole('checkbox', { name: 'Allow this road in the reuse cost scenario', exact: true })
  await expect(reuse).not.toBeChecked()
  await panel.getByRole('combobox', { name: 'Planning condition', exact: true }).selectOption('rehabilitation')
  await panel.getByRole('combobox', { name: 'Condition evidence', exact: true }).selectOption('assumed')
  await panel
    .getByRole('spinbutton', { name: 'Known construction year (leave blank if unknown)', exact: true })
    .fill('2001')
  await reuse.check()
  await expect(panel).toContainText('Reuse is an unverified planning assumption')

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const stream = await (await pending).createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const project = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  expect(
    project.context.find((feature: { name: string }) => feature.name === 'Surveyed spur').roadEvidence,
  ).toMatchObject({
    source: 'user',
    condition: 'rehabilitation',
    conditionBasis: 'assumed',
    constructionYear: 2001,
    reuseAllowed: true,
  })
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await panel.getByRole('combobox', { name: 'Planning condition', exact: true }).selectOption('closed')
  await expect(reuse).not.toBeChecked()
  await expect(reuse).toBeDisabled()
})

test('FSR connectors meet the mapped segment from either road endpoint and preserve the original road', async ({
  page,
}) => {
  await openTraining(page)
  const before = await downloadProject(page)
  const original = before.alignments.find((alignment) => alignment.id === before.activeAlignmentId)!
  const endpoints = [original.points[0].coordinate, original.points.at(-1)!.coordinate]
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Terrain', exact: true })
    .click()
  // Two known vertical FSR segments: the nearest junction is in a segment's interior,
  // which catches a connector that only snaps to the nearest stored road vertex.
  await page.getByTestId('road-existing-roads-input').setInputFiles({
    name: 'mapped-fsr-junctions.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        features: endpoints.map(([lon, lat], index) => ({
          type: 'Feature',
          properties: {
            name: `Mapped fixture FSR ${index + 1}`,
            roadEvidence: {
              source: 'user',
              roadClass: 'fsr',
              lifecycleStatus: 'ACTIVE',
              condition: 'unknown',
              conditionBasis: 'unreviewed',
              reuseAllowed: false,
            },
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [lon - 0.004, lat - 0.001],
              [lon - 0.004, lat + 0.001],
            ],
          },
        })),
      }),
    ),
  })
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Design', exact: true })
    .click()
  await page.getByTestId('road-route-tools').click()
  for (const [index, endpoint] of ['start', 'end'].entries()) {
    await page.getByRole('combobox', { name: 'Active road', exact: true }).selectOption(original.id)
    await page.getByRole('combobox', { name: 'Connect from', exact: true }).selectOption(endpoint)
    await page.getByRole('button', { name: 'Find FSR connection', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Active road', exact: true }).locator('option')).toHaveCount(
      3 + index,
    )
    const connected = await downloadProject(page)
    const connector = connected.alignments.find((alignment) => alignment.id === connected.activeAlignmentId)!
    expect(connector.name).toContain('FSR connection')
    expect(connector.points[0].coordinate).toEqual(endpoints[index])
    expect(connector.points.at(-1)!.coordinate[0]).toBeCloseTo(endpoints[index][0] - 0.004, 10)
    expect(connector.points.at(-1)!.coordinate[1]).toBeCloseTo(endpoints[index][1], 10)
    expect(connected.alignments.find((alignment) => alignment.id === original.id)).toEqual(original)
  }
})

test('an explicitly selected farther FSR is highlighted and connected without falling back to the nearest road', async ({
  page,
}) => {
  await openTraining(page)
  const before = await downloadProject(page)
  const original = before.alignments.find((alignment) => alignment.id === before.activeAlignmentId)!
  const [lon, lat] = original.points[0].coordinate
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Terrain', exact: true })
    .click()
  await page.getByTestId('road-existing-roads-input').setInputFiles({
    name: 'choose-fsr-target.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          ['Nearest fixture FSR', 0.004, 'unknown'],
          ['Farther fixture FSR', 0.006, 'unknown'],
          ['Closed fixture FSR', 0.002, 'closed'],
        ].map(([name, offset, condition]) => ({
          type: 'Feature',
          properties: {
            name,
            roadEvidence: {
              source: 'user',
              roadClass: 'fsr',
              lifecycleStatus: 'ACTIVE',
              condition,
              conditionBasis: 'unreviewed',
              reuseAllowed: false,
            },
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [lon - Number(offset), lat - 0.001],
              [lon - Number(offset), lat + 0.001],
            ],
          },
        })),
      }),
    ),
  })
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Design', exact: true })
    .click()
  await page.getByTestId('road-route-tools').click()
  await page.getByRole('combobox', { name: 'Connect from', exact: true }).selectOption('start')
  await page.getByRole('button', { name: 'Find nearby FSRs', exact: true }).click()
  const picker = page.getByRole('combobox', { name: 'FSR to connect to', exact: true })
  await expect(picker.locator('option')).toHaveCount(3)
  await expect(picker).not.toContainText('Closed fixture FSR')
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true }).locator('option')).toHaveCount(2)
  const fartherId = await picker.locator('option').filter({ hasText: 'Farther fixture FSR' }).getAttribute('value')
  expect(fartherId).toBeTruthy()
  await picker.selectOption(fartherId!)
  await expect(page.getByTestId('road-fsr-selected-target')).toContainText('Farther fixture FSR')
  await expect
    .poll(async () =>
      (await mapContext(page))?.overlay.some(
        (feature) =>
          feature.geometry.type === 'LineString' &&
          feature.geometry.coordinates.length === 2 &&
          feature.geometry.coordinates.every((point) => Math.abs(point[0] - (lon - 0.006)) < 1e-10),
      ),
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Connect to selected FSR', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true }).locator('option')).toHaveCount(3)
  const connected = await downloadProject(page)
  const connector = connected.alignments.find((alignment) => alignment.id === connected.activeAlignmentId)!
  expect(connector.name).toContain('Farther fixture FSR')
  expect(connector.points.at(-1)!.coordinate[0]).toBeCloseTo(lon - 0.006, 10)
  expect(connector.points.at(-1)!.coordinate[1]).toBeCloseTo(lat, 10)
  expect(connector.fsrConnection).toMatchObject({
    preference: 'chosen',
    targetName: 'Farther fixture FSR',
    targetCoordinate: connector.points.at(-1)!.coordinate,
  })
  const expectRecordedDestinationOnPlan = async () => {
    await expect
      .poll(async () =>
        (await mapContext(page))?.overlay
          .filter((feature) => feature.properties?.kind === 'reviewed-existing-road')
          .map((feature) => feature.properties?.label),
      )
      .toEqual(['Farther fixture FSR'])
    await expect
      .poll(
        async () =>
          (await mapContext(page))?.overlay.find((feature) => feature.properties?.kind === 'fsr-target')?.geometry,
      )
      .toEqual({ type: 'Point', coordinates: connector.points.at(-1)!.coordinate })
  }
  await expectRecordedDestinationOnPlan()
  expect(connected.alignments.find((alignment) => alignment.id === original.id)).toEqual(original)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByTestId('road-file-input').setInputFiles({
    name: 'chosen-fsr.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(connected)),
  })
  await page.getByTestId('road-fsr-connection-record').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('road-fsr-connection-record')).toContainText(
    'Recorded FSR connection: Farther fixture FSR',
  )
  await expectRecordedDestinationOnPlan()

  // A road closed after selection must become unavailable, without silently choosing another target.
  await page.getByRole('combobox', { name: 'Active road', exact: true }).selectOption(original.id)
  await page.getByRole('combobox', { name: 'Connect from', exact: true }).selectOption('start')
  await picker.selectOption(fartherId!)
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Terrain', exact: true })
    .click()
  const existing = page.getByTestId('road-existing-roads')
  await existing.getByRole('combobox', { name: 'Review existing road', exact: true }).selectOption(fartherId!)
  await existing.getByRole('combobox', { name: 'Planning condition', exact: true }).selectOption('closed')
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Design', exact: true })
    .click()
  await expect(page.getByRole('button', { name: 'Connect to selected FSR', exact: true })).toBeDisabled()
  await expect(
    page.getByText('The selected FSR is unavailable. Refresh the choices or choose another section.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true }).locator('option')).toHaveCount(3)
})

test('mobile controls stay above map chrome and expose existing-road review and aggregate settings directly', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openTraining(page)
  await page.getByRole('button', { name: 'Show road controls', exact: true }).click()
  const controls = page.getByRole('complementary', { name: 'Road design controls', exact: true })
  await expect(controls).toBeVisible()
  // Map controls formerly floated over the open sidebar, intercepting its inputs.
  await expect
    .poll(async () =>
      controls.evaluate((aside) => {
        const legend = document.querySelector('button[aria-label="Expand legend"]')
        if (!legend) return true
        const box = legend.getBoundingClientRect(),
          bounds = aside.getBoundingClientRect()
        const x = box.x + box.width / 2,
          y = box.y + box.height / 2
        if (!box.width || !box.height || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom)
          return true
        return aside.contains(document.elementFromPoint(x, y))
      }),
    )
    .toBe(true)
  await controls.getByRole('button', { name: 'Review existing roads', exact: true }).click()
  await expect(controls.getByRole('button', { name: 'Import road GeoJSON', exact: true })).toBeInViewport()
  await controls.getByRole('button', { name: 'Locate selected road on plan', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Show road controls', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Show road controls', exact: true }).click()
  await controls.getByRole('tab', { name: 'Design', exact: true }).click()
  await controls.getByRole('button', { name: 'Gravel & aggregate costs', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Haul & cost settings', exact: true })
  await expect(settings.getByRole('heading', { name: 'Surfacing aggregate source', exact: true })).toBeVisible()
  await expect(settings.getByRole('checkbox', { name: 'Use this aggregate source', exact: true })).toBeVisible()
  await settings.getByRole('button', { name: 'Done', exact: true }).click()
})

test('choosing a new mapped pit reference clears the previous enabled supply assumptions', async ({ page }) => {
  await openTraining(page)
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('button', { name: /Browse \d+ example scenarios/ }).click()
  await page.getByRole('button', { name: 'Load Training · nearby free gravel', exact: true }).click()
  await page.getByRole('button', { name: 'Gravel & aggregate costs', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Haul & cost settings', exact: true })
  await expect(settings.getByRole('checkbox', { name: 'Use this aggregate source', exact: true })).toBeChecked()
  await expect(settings.getByRole('spinbutton', { name: 'Processing ($/compacted m³)', exact: true })).toHaveValue('2')
  await settings.getByLabel('Import BC special-use pit GeoJSON export', { exact: true }).setInputFiles({
    name: 'mapped-pit.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              FOREST_FILE_ID: 'S_FIXTURE',
              MAP_LABEL: 'Imported candidate pit',
              SPECIAL_USE_DESCRIPTION: 'Gravel Pit, Rock Quarry',
              LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
              FILE_STATUS_CODE: 'HI',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.72, 53.89],
                  [-122.719, 53.89],
                  [-122.719, 53.891],
                  [-122.72, 53.891],
                  [-122.72, 53.89],
                ],
              ],
            },
          },
        ],
      }),
    ),
  })
  await settings.getByRole('button', { name: 'Use as source reference', exact: true }).click()
  await expect(settings.getByRole('checkbox', { name: 'Use this aggregate source', exact: true })).not.toBeChecked()
  await expect(settings.getByRole('textbox', { name: 'Aggregate source name', exact: true })).toHaveValue(
    'Imported candidate pit',
  )
  for (const label of [
    'Acquisition ($/compacted m³)',
    'Processing ($/compacted m³)',
    'Loading ($/compacted m³)',
    'Aggregate haul ($/m³·km)',
    'Placement ($/compacted m³)',
    'Available aggregate (compacted m³)',
  ])
    await expect(settings.getByRole('spinbutton', { name: label, exact: true })).toHaveValue('0')
  await expect(
    settings.getByRole('textbox', { name: 'Aggregate source evidence / access and quality notes', exact: true }),
  ).toHaveValue(/unverified/)
  await expect(settings.getByRole('spinbutton', { name: 'One-way aggregate haul (km)', exact: true })).toHaveValue('1')
  await expect(settings.getByText(/Delivered rate \$/)).toContainText('0.0 m³ from source')
  await settings.getByRole('button', { name: 'Done', exact: true }).click()
  const project = await downloadProject(page)
  const source = project.alignments.find((alignment) => alignment.id === project.activeAlignmentId)!.engineering!
    .surfacingSupply!
  expect(source).toMatchObject({ enabled: false, capacityM3: 0, processingRate: 0, haulDistanceKm: 1 })
  expect(source.sourceNotes).toContain('unverified')
})
