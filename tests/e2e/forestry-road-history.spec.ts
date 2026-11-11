import { openWorkbench } from './road-workbench'
import { expect, test, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { choose } from './styled-select'
import { openRoadPanel } from './road-sidebar'

test.use({ serviceWorkers: 'block', actionTimeout: 20_000 })
test.setTimeout(180_000)

const SCENARIO = 'Training · cutblocks and old access roads'
const RECENT = 'Synthetic block · harvested 2021–2022'
const DEACTIVATED = 'Synthetic spur · deactivated 2016'

async function prepare(page: Page, baseURL: string) {
  const errors: string[] = [],
    publicDataRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const origin = new URL(baseURL).origin
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'basemaps.cartocdn.com')
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [],
          glyphs: 'https://road-history-test.invalid/{fontstack}/{range}.pbf',
        },
      })
    if (url.hostname === 'road-history-test.invalid') return route.fulfill({ body: Buffer.alloc(0) })
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      publicDataRequests.push(url.toString())
      return route.abort()
    }
    return route.continue()
  })
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('button', { name: /Browse \d+ example scenarios/ }).click()
  await page.getByRole('button', { name: `Load ${SCENARIO}`, exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  return { errors, publicDataRequests }
}

async function showControls(page: Page) {
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  const workflow = page.getByRole('tablist', { name: 'Road workflow', exact: true })
  // A phone layout settles after loads and reopens: keep opening the controls until the tabs show.
  await expect
    .poll(async () => {
      if (await show.isVisible()) await show.click()
      return workflow.isVisible()
    })
    .toBe(true)
  await workflow.getByRole('tab', { name: 'Terrain', exact: true }).click()
}

async function showMap(page: Page, phone: boolean) {
  if (!phone) return
  const hide = page.getByRole('button', { name: 'Hide road controls', exact: true })
  if (await hide.isVisible()) await hide.click()
}

async function openHistory(page: Page) {
  await showControls(page)
  await openRoadPanel(page, 'Cutblocks & harvest history')
  return page.getByTestId('road-cutblock-history')
}

/** Check the actual GeoJSON and line styling, not only the sidebar's description of the map. */
async function mapHistory(page: Page) {
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
        const source = map.getSource('road-context')
        if (source?.type !== 'geojson' || !map.getLayer('road-history-deactivated')) return null
        return {
          features: (source.serialize().data as GeoJSON.FeatureCollection).features.map(
            (feature) => feature.properties,
          ),
          deactivatedColor: map.getPaintProperty('road-history-deactivated', 'line-color'),
          deactivatedDash: map.getPaintProperty('road-history-deactivated', 'line-dasharray'),
          unknownColor: map.getPaintProperty('road-history-unknown', 'line-color'),
        }
      }
    }
    return null
  })
}

async function expandLegend(page: Page) {
  const toggle = page.getByTestId('road-terrain-legend').getByRole('button', { name: 'Expand legend', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  return page.getByTestId('road-plan-legend-content')
}

const tablePane = (page: Page, phone: boolean) =>
  page.locator(phone ? '[data-map-feature-card-panel="true"]' : '[data-panel="data-table-panel"]')

async function closeTable(page: Page, phone: boolean) {
  await tablePane(page, phone)
    .getByRole('button', { name: phone ? 'Close feature card' : 'Close', exact: true })
    .click()
}

/** The history table opens from the map settings popover, not a toolbar button. */
async function openHistoryTable(page: Page) {
  await page.getByRole('button', { name: 'Map display settings', exact: true }).click()
  await page.getByRole('button', { name: 'Cutblock & road history table', exact: true }).click()
}

async function setHarvestVisibility(page: Page, visible: boolean) {
  await page.getByRole('button', { name: 'Map display settings', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Show harvest areas context', exact: true }).setChecked(visible)
  await page.getByRole('button', { name: 'Close map settings', exact: true }).click()
}

async function saveProject(page: Page): Promise<RoadProject> {
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

for (const phone of [false, true]) {
  test.describe(phone ? 'harvest history on a narrow phone' : 'harvest history on desktop', () => {
    test.use({
      viewport: phone ? { width: 320, height: 668 } : { width: 1512, height: 982 },
      hasTouch: phone,
      isMobile: phone,
    })

    test('shows sourced ages and nearby road events, keeps the map/table in sync, and reopens saved evidence', async ({
      page,
      baseURL,
    }, info) => {
      const { errors, publicDataRequests } = await prepare(page, baseURL!)
      const history = await openHistory(page)
      const selection = history.getByRole('combobox', { name: 'Cutblock history selection', exact: true })
      const evidence = page.getByTestId('road-cutblock-history-evidence')
      await expect(history.getByLabel('Harvest age reference year', { exact: true })).toHaveValue('2026')
      await choose(selection, 'history-recent')
      await expect(evidence).toContainText('4–5 calendar years since reported harvest (2021–2022)')
      // The evidence reads as label/value rows: dates as one range, the source and its record.
      await expect(evidence).toContainText(/Dates\s*2021-09-01 – 2022-02-15/)
      await expect(evidence).toContainText(/Source\s*Synthetic teaching record/)
      await expect(evidence).toContainText(/Record\s*teaching-recent/)
      await expect(evidence).toContainText(/Area\s*\d+\.\d{2} ha/)
      await choose(selection, 'history-older')
      await expect(evidence).toContainText('36–37 calendar years since reported harvest (1989–1990)')
      await choose(selection, 'history-estimated')
      await expect(evidence).toContainText('About 18 calendar years since estimated harvest (2008)')
      await expect(evidence).toContainText(/Harvested\s*≈ 2008 \(midpoint\)/)
      await choose(selection, 'history-unknown')
      await expect(evidence).toContainText('Harvest date unknown')
      await expect(evidence).not.toContainText('calendar years since')
      // Planned blocks are a group of their own: the ones roads get built to, not harvest history.
      const groups = history.getByRole('group', { name: 'Cutblock group', exact: true })
      await groups.getByRole('button', { name: /^Planned/ }).click()
      await expect(selection).toHaveAttribute('data-value', 'history-proposed')
      await expect(evidence).toContainText('Proposed cutblock · no harvest history')
      await expect(page.getByTestId('road-cutblock-nearby-roads')).toHaveCount(0)
      await groups.getByRole('button', { name: /^Harvested/ }).click()
      await choose(selection, 'history-recent')

      const nearby = page.getByTestId('road-cutblock-nearby-roads')
      // Nearby roads list distance and status only; a row opens the road in Existing roads & reuse.
      const deactivated = nearby.getByRole('button', {
        name: 'Review road Synthetic spur · deactivated 2016',
        exact: true,
      })
      await expect(nearby).toContainText('proximity only')
      await expect(deactivated).toContainText('Recorded deactivation')
      await expect(deactivated).toContainText(/\d+ m$/)
      await deactivated.click()
      const roadSelection = page.getByRole('combobox', { name: 'Review existing road', exact: true })
      await expect(roadSelection).toHaveAttribute('data-value', 'history-road-deactivated')
      await expect(page.getByTestId('road-existing-road-evidence')).toContainText('Synthetic training assumption')
      await expect(page.getByTestId('road-deactivation-summary')).toHaveText('Deactivation: 2016-09-15')
      await page.getByTestId('road-deactivation-toggle').click()
      const editor = page.getByTestId('road-deactivation-editor')
      await expect(editor.getByRole('combobox', { name: 'Recorded physical status', exact: true })).toHaveAttribute(
        'data-value',
        'deactivated',
      )
      await expect(editor.getByLabel('Deactivated on (known event date)', { exact: true })).toHaveValue('2016-09-15')
      await editor.getByLabel('Observed on (optional)', { exact: true }).fill('2026-10-01')
      await editor
        .getByLabel('Road event notes (optional)', { exact: true })
        .fill('Reviewed in the synthetic history scenario.')
      await editor.getByRole('button', { name: 'Save road history', exact: true }).click()
      await expect(page.getByTestId('road-existing-road-evidence')).toContainText(/Event status observed\s*2026-10-01/)
      await choose(roadSelection, 'history-road-undated')
      await expect(page.getByTestId('road-deactivation-summary')).toHaveText('Deactivation: date unknown')
      await page.getByTestId('road-deactivation-toggle').click()
      await expect(editor.getByLabel('Deactivated on (known event date)', { exact: true })).toHaveValue('')
      await showMap(page, phone)

      await expect
        .poll(async () =>
          (await mapHistory(page))?.features.map((feature) => [
            feature?.id,
            feature?.historyKey,
            feature?.historyColor,
          ]),
        )
        .toEqual(
          expect.arrayContaining([
            ['history-recent', 'recent', '#d97706'],
            ['history-older', 'older', '#166534'],
            ['history-estimated', 'medium', '#0d9488'],
            ['history-unknown', 'unknown', '#64748b'],
            ['history-proposed', 'proposed', '#7c3aed'],
            ['history-road-deactivated', 'deactivated', '#b91c1c'],
            ['history-road-undated', 'deactivated', '#b91c1c'],
            ['history-road-unreviewed', 'unknown', '#64748b'],
          ]),
        )
      expect(await mapHistory(page)).toMatchObject({
        deactivatedColor: '#b91c1c',
        deactivatedDash: [3, 2],
        unknownColor: '#64748b',
      })
      const legend = await expandLegend(page)
      for (const label of [
        'Harvest 0–10 calendar years ago',
        'Harvest 11–30 calendar years ago',
        'Harvest over 30 calendar years ago',
        'Harvest age unknown or uncertain',
        'Proposed cutblock',
        'Recorded deactivation',
        'Road condition unknown',
      ])
        await expect(legend.getByText(label, { exact: true })).toHaveCount(1)
      const swatch = legend.getByText('Recorded deactivation', { exact: true }).locator('..').locator('svg line')
      await expect(swatch).toHaveAttribute('stroke', '#b91c1c')
      await expect(swatch).toHaveAttribute('stroke-dasharray', '9 6')
      await page.screenshot({ path: info.outputPath('harvest-age-and-road-status-legend.png') })
      await page.getByRole('button', { name: 'Collapse legend', exact: true }).click()

      await openHistoryTable(page)
      const pane = tablePane(page, phone)
      await expect(pane.getByRole('table')).toHaveAttribute('aria-rowcount', '5')
      const recentRow = pane.getByRole('row').filter({ hasText: RECENT })
      await expect(recentRow).toContainText('4–5 calendar years since reported harvest (2021–2022)')
      await recentRow.getByRole('cell', { name: RECENT, exact: true }).click()
      await expect(recentRow).toHaveAttribute('aria-selected', 'true')
      await expect(selection).toHaveAttribute('data-value', 'history-recent')
      await showMap(page, phone)
      await pane.getByRole('heading', { name: 'Cutblocks and harvest history', exact: true }).click()
      await page
        .getByRole('listbox', { name: 'Table layer', exact: true })
        .getByRole('option', { name: 'Existing road history', exact: true })
        .click()
      await expect(pane.getByRole('table')).toHaveAttribute('aria-rowcount', '3')
      const roadRow = pane.getByRole('row').filter({ hasText: DEACTIVATED })
      await expect(roadRow).toContainText('Recorded deactivation')
      await expect(roadRow).toContainText('Deactivation: 2016-09-15')
      await roadRow.getByRole('cell', { name: DEACTIVATED, exact: true }).click()
      await expect(roadSelection).toHaveAttribute('data-value', 'history-road-deactivated')
      await showMap(page, phone)
      await closeTable(page, phone)

      await setHarvestVisibility(page, false)
      await expect
        .poll(async () => (await mapHistory(page))?.features.some((feature) => feature?.kind === 'harvest'))
        .toBe(false)
      await expandLegend(page)
      await expect(legend.getByText('Harvest 0–10 calendar years ago', { exact: true })).toHaveCount(0)
      await expect(legend.getByText('Recorded deactivation', { exact: true })).toHaveCount(1)
      await page.getByRole('button', { name: 'Collapse legend', exact: true }).click()
      await openHistoryTable(page)
      await expect(pane.getByRole('table')).toHaveAttribute('aria-rowcount', '3')
      await pane.getByRole('heading', { name: 'Existing road history', exact: true }).click()
      await expect(page.getByRole('listbox', { name: 'Table layer', exact: true }).getByRole('option')).toHaveCount(1)
      await expect(page.getByRole('option', { name: 'Cutblocks and harvest history', exact: true })).toHaveCount(0)
      await page.keyboard.press('Escape')
      await closeTable(page, phone)
      await setHarvestVisibility(page, true)
      await expect
        .poll(async () => (await mapHistory(page))?.features.filter((feature) => feature?.kind === 'harvest').length)
        .toBe(5)

      await openHistory(page)
      const referenceYear = history.getByLabel('Harvest age reference year', { exact: true })
      await referenceYear.fill('2030')
      await referenceYear.press('Tab')
      await choose(selection, 'history-recent')
      await expect(evidence).toContainText('8–9 calendar years since reported harvest (2021–2022)')
      if (phone) {
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
          .toBeLessThanOrEqual(1)
        const bounds = await selection.boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321)
      }
      await showMap(page, phone)
      const saved = await saveProject(page)
      expect(saved.scenario?.id).toBe('training-harvest-history')
      expect(saved.harvestHistoryYear).toBe(2030)
      expect(saved.context.find((feature) => feature.id === 'history-recent')?.harvestEvidence).toMatchObject({
        source: 'scenario',
        sourceId: 'teaching-recent',
        startDate: '2021-09-01',
        endDate: '2022-02-15',
        yearMethod: 'reported-dates',
      })
      const savedRoad = saved.context.find((feature) => feature.id === 'history-road-deactivated')?.roadEvidence
      expect(savedRoad).toMatchObject({
        reuseAllowed: false,
        deactivation: {
          status: 'deactivated',
          basis: 'scenario',
          deactivatedOn: '2016-09-15',
          observedOn: '2026-10-01',
          notes: 'Reviewed in the synthetic history scenario.',
        },
      })
      expect(
        saved.context.find((feature) => feature.id === 'history-road-undated')?.roadEvidence?.deactivation
          ?.deactivatedOn,
      ).toBeUndefined()

      // Change the working copy first: a successful reopen must restore the file's reference year and evidence.
      await openHistory(page)
      await referenceYear.fill('2026')
      await referenceYear.press('Tab')
      await expect(evidence).toContainText('4–5 calendar years since reported harvest (2021–2022)')
      await showMap(page, phone)
      const pending = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Open', exact: true }).click()
      await (
        await pending
      ).setFiles({
        name: 'harvest-history.road.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(saved)),
      })
      await openHistory(page)
      await expect(referenceYear).toHaveValue('2030')
      await choose(selection, 'history-recent')
      await expect(evidence).toContainText('8–9 calendar years since reported harvest (2021–2022)')
      await expect(evidence).toContainText(/Record\s*teaching-recent/)
      await nearby.getByRole('button', { name: 'Review road Synthetic spur · deactivated 2016', exact: true }).click()
      await expect(page.getByTestId('road-deactivation-summary')).toHaveText('Deactivation: 2016-09-15')
      await expect(page.getByTestId('road-existing-road-evidence')).toContainText(/Event status observed\s*2026-10-01/)
      await showMap(page, phone)
      const reopened = await saveProject(page)
      expect(reopened.context).toEqual(saved.context)
      expect(reopened.harvestHistoryYear).toBe(2030)
      expect(errors).toEqual([])
      expect(publicDataRequests).toEqual([])
    })
  })
}
