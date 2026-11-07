import { expect, test, type Locator, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { choose } from './road-select'

test.use({ serviceWorkers: 'block', actionTimeout: 20_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

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
async function openNetwork(page: Page) {
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await show.click()
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Design', exact: true })
    .click()
  await page.getByRole('button', { name: 'Plan road network', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Road network planning', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
async function tab(dialog: Locator, name: string) {
  await dialog
    .getByRole('tablist', { name: 'Network planning view', exact: true })
    .getByRole('tab', { name, exact: true })
    .click()
}
async function calculate(dialog: Locator, compare = false) {
  const run = dialog.getByRole('button', {
    name: compare ? 'Compare network methods' : 'Project road network',
    exact: true,
  })
  await run.click()
  await expect(run).toBeEnabled({ timeout: 90_000 })
  await expect(dialog.getByTestId('network-result-preview')).toBeVisible()
}
async function downloadText(page: Page, button: Locator) {
  const pending = page.waitForEvent('download')
  await button.click()
  const download = await pending
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return { name: download.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') }
}
async function saveProject(page: Page): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const exported = await downloadText(page, page.getByRole('button', { name: 'Save project JSON', exact: true }))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  return JSON.parse(exported.text) as RoadProject
}

/** Read rendered application state; all state changes still go through visible UI controls. */
async function mapNetwork(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    if (!element) return null
    const key = Object.keys(element).find((key) => key.startsWith('__reactFiber$'))
    if (!key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (element as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState
        const map =
          value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getTerrain !== 'function') continue
        const source = map.getSource('road-overlay')
        const data = source?.type === 'geojson' ? (source.serialize().data as GeoJSON.FeatureCollection) : undefined
        return {
          lines: data?.features.filter((feature) => feature.properties?.kind === 'network-projection').length ?? 0,
          targets: data?.features.filter((feature) => feature.properties?.kind === 'network-landing').length ?? 0,
          lineLayer: !!map.getLayer('road-exploration-line'),
          loaded: !!source && map.isSourceLoaded('road-overlay'),
        }
      }
    }
    return null
  })
}

for (const viewport of [
  { width: 1512, height: 982 },
  { width: 390, height: 844 },
]) {
  test(`network examples compare, preserve exports and expose infeasible targets at ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    const errors = await prepare(page)
    const dialog = await openNetwork(page)
    await choose(dialog.getByRole('combobox', { name: 'Network input source', exact: true }), 'example')
    await choose(dialog.getByRole('combobox', { name: 'Network example', exact: true }), 'clus-reference')
    await dialog
      .getByRole('checkbox', { name: 'Compare all four methods using the same inputs and stages', exact: true })
      .check()
    await calculate(dialog, true)
    const bundle = await downloadText(page, dialog.getByRole('button', { name: 'Network scenario JSON', exact: true }))
    const saved = JSON.parse(bundle.text)
    expect(saved.schema).toBe('pgmaps-road-network-planning-v1')
    expect(saved.input.grid.values).toHaveLength(25)
    expect(saved.results.map((result: { method: string }) => result.method)).toEqual(['ilcp', 'lcp', 'mst', 'snap'])
    expect(
      saved.results.every((result: { targets: { status: string }[] }) =>
        result.targets.every((target) => ['connected', 'already-connected'].includes(target.status)),
      ),
    ).toBe(true)
    await expect(dialog.getByRole('button', { name: 'Use branch as new road', exact: true })).toBeDisabled()
    const grid = await downloadText(
      page,
      dialog.getByRole('button', { name: 'Weight and road-cell grid CSV', exact: true }),
    )
    expect(grid.text.trim().split(/\r?\n/)).toHaveLength(26)
    await dialog.getByText('Reconstruct raster road lines', { exact: true }).click()
    const reconstructed = await downloadText(
      page,
      dialog.getByRole('button', { name: 'Export reconstructed raster lines', exact: true }),
    )
    expect(JSON.parse(reconstructed.text).status).toContain('not proposed or surveyed roads')
    expect(JSON.parse(reconstructed.text).warnings.length).toBeGreaterThan(0)
    await page.screenshot({ path: info.outputPath('network-example.png') })
    await tab(dialog, 'Inputs & scenarios')
    await choose(dialog.getByRole('combobox', { name: 'Network example', exact: true }), 'isolated-target')
    await dialog
      .getByRole('checkbox', { name: 'Compare all four methods using the same inputs and stages', exact: true })
      .uncheck()
    await calculate(dialog)
    await expect(dialog.getByRole('table', { name: 'Network target outcomes', exact: true })).toContainText(
      'unreachable',
    )
    await tab(dialog, 'Inputs & scenarios')
    await dialog
      .getByLabel('Network scenario file', { exact: true })
      .setInputFiles({ name: 'network-roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(bundle.text) })
    await expect(dialog.getByRole('combobox', { name: 'Network example', exact: true })).toHaveAttribute('data-value', 'imported')
    await calculate(dialog)
    const imported = JSON.parse(
      (await downloadText(page, dialog.getByRole('button', { name: 'Network scenario JSON', exact: true }))).text,
    )
    expect(imported.input.grid).toEqual(saved.input.grid)
    expect(imported.input.roadCells).toEqual(saved.input.roadCells)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    expect(errors).toEqual([])
  })
}

test('project network preview reaches the actual map and selected branch adoption survives project round trip', async ({
  page,
}, info) => {
  const errors = await prepare(page)
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('button', { name: /Browse \d+ example scenarios/ }).click()
  await page
    .getByRole('button', { name: 'Load Training · connected access, gravel and condition', exact: true })
    .click()
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true, includeHidden: true })).toHaveAttribute('data-value', 
    'training-full-cost-short-a',
  )
  const initial = await saveProject(page)
  let dialog = await openNetwork(page)
  await dialog.getByRole('button', { name: 'Use active road start', exact: true }).click()
  await dialog.getByRole('button', { name: 'Add landing target', exact: true }).click()
  await calculate(dialog)
  await expect(dialog.getByRole('button', { name: 'Use branch as new road', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Inspect network on project map', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect.poll(async () => (await mapNetwork(page))?.lines ?? 0).toBeGreaterThan(0)
  await expect.poll(async () => (await mapNetwork(page))?.loaded).toBe(true)
  expect((await mapNetwork(page))?.lineLayer).toBe(true)
  await page.screenshot({ path: info.outputPath('network-project-map.png') })
  dialog = await openNetwork(page)
  await dialog.getByRole('button', { name: 'Use branch as new road', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const saved = await saveProject(page)
  expect(saved.alignments).toHaveLength(initial.alignments.length + 1)
  const candidate = saved.alignments.find((alignment) => alignment.id === saved.activeAlignmentId)!
  expect(candidate.points.length).toBeGreaterThanOrEqual(2)
  expect(candidate.points.every((point) => point.radiusM === 0)).toBe(true)
  expect(candidate.vertical).toEqual([])
  expect(saved.networkPlanning?.targets).toHaveLength(1)
  expect(saved.networkPlanning?.options.gradeMode).toBe('terrain')
  expect(saved.networkPlanning?.options.preventCornerCutting).toBe(true)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByTestId('road-file-input').setInputFiles({
    name: 'network-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  })
  await expect(page.getByRole('combobox', { name: 'Active road', exact: true, includeHidden: true })).toHaveAttribute('data-value', 
    candidate.id,
  )
  const reopened = await saveProject(page)
  expect(reopened).toEqual(saved)
  expect(errors).toEqual([])
})
