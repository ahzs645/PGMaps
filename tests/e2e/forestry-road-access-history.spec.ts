import { expect, test, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { choose } from './road-select'
import { openRoadPanel } from './road-sidebar'
import {
  createAccessHistoryTrainingProject,
  ACCESS_HISTORY_TRAINING_IDS,
  accessHistoryTrainingCoordinate,
} from '../../src/pages/dev-forestry-roads/trainingAccessHistoryScenario'
import { createAccessHistoryState } from '../../src/pages/dev-forestry-roads/accessHistory'
import { starterAlignment } from '../../src/pages/dev-forestry-roads/terrain'
import { INTERNAL_ACCESS_DRAFT_NAME } from '../../src/pages/dev-forestry-roads/investigationWorkspace'

test.use({ serviceWorkers: 'block', actionTimeout: 20_000 })
test.setTimeout(180_000)
const scenario = 'Training · reconstruct block access and bridges'

async function prepare(page: Page, baseURL: string) {
  const errors: string[] = [],
    publicRequests: string[] = []
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
          glyphs: 'https://history-example.invalid/{fontstack}/{range}.pbf',
        },
      })
    if (url.hostname === 'history-example.invalid') return route.fulfill({ body: Buffer.alloc(0) })
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      publicRequests.push(url.toString())
      return route.abort()
    }
    return route.continue()
  })
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('button', { name: /Browse \d+ example scenarios/ }).click()
  await page.getByRole('button', { name: `Load ${scenario}`, exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  return { errors, publicRequests }
}

async function openHistory(page: Page) {
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  const tabs = page.getByRole('tablist', { name: 'Road workflow', exact: true })
  await expect
    .poll(async () => {
      if (await show.isVisible()) await show.click()
      return tabs.isVisible()
    })
    .toBe(true)
  await tabs.getByRole('tab', { name: 'Terrain', exact: true }).click()
  await openRoadPanel(page, 'Access history')
  return page.getByTestId('road-access-history')
}

async function showMap(page: Page) {
  const hide = page.getByRole('button', { name: 'Hide road controls', exact: true })
  if (await hide.isVisible()) await hide.click()
}

/** Actual mounted GeoJSON and layer styles, including stale-safe status, without test-only app globals. */
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
        const route = map.getSource('line-shared-road-access-history-route')
        const structures = map.getSource('circle-shared-road-access-history-structures')
        if (route?.type !== 'geojson' || structures?.type !== 'geojson') return null
        const layer = map
          .getStyle()
          .layers.find((item) => item.type === 'line' && item.source === 'line-shared-road-access-history-route')
        const features = (id: string) => {
          const source = map.getSource(id)
          return source?.type === 'geojson' ? (source.serialize().data as GeoJSON.FeatureCollection).features : []
        }
        return {
          route: (route.serialize().data as GeoJSON.FeatureCollection).features[0]?.properties,
          structures: (structures.serialize().data as GeoJSON.FeatureCollection).features.map(
            (feature) => feature.properties,
          ),
          dash: layer ? map.getPaintProperty(layer.id, 'line-dasharray') : null,
          designRoads: features('road-roads'),
          context: features('road-context'),
          selectedRoad: features('line-shared-road-access-history-selected-road'),
        }
      }
    }
    return null
  })
}

test.describe('source-only access investigation', () => {
  test.use({ viewport: { width: 1512, height: 982 } })
  test('keeps the internal starter off the actual map and engineering views until an explicit design action', async ({
    page,
    baseURL,
  }, info) => {
    // Invented source geometry with offline terrain; this test makes no claim about a BC opening.
    const study = createAccessHistoryTrainingProject()
    study.name = 'Access investigation · synthetic browser fixture'
    const recordIds = new Set<string>([ACCESS_HISTORY_TRAINING_IDS.blockA, ACCESS_HISTORY_TRAINING_IDS.spurA])
    study.context = study.context.filter((feature) => recordIds.has(feature.id))
    const road = study.context.find((feature) => feature.kind === 'existing-road')!
    const internal = starterAlignment(accessHistoryTrainingCoordinate(600, 0))
    internal.name = INTERNAL_ACCESS_DRAFT_NAME
    study.alignments = [internal]
    study.activeAlignmentId = internal.id
    study.workspaceMode = 'access-investigation'
    study.investigation = { openingId: '12345', draftAlignmentId: internal.id }
    study.accessHistory = createAccessHistoryState('2010-06-30')
    study.cables = []
    study.profiles = []
    await page.addInitScript(() => localStorage.setItem('pgmaps-road-layout', 'engineering'))
    const { errors } = await prepare(page, baseURL!)
    const open = async (project: RoadProject) => {
      const picker = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Open', exact: true }).click()
      await (
        await picker
      ).setFiles({
        name: 'access-study.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(project)),
      })
      await expect(page.getByTestId('road-workspace')).toHaveAttribute('data-workspace-mode', 'access-investigation')
    }
    await open(study)
    await expect(page.getByTestId('road-connected-layout')).toHaveAttribute('data-layout', 'plan')
    await expect(page.getByTestId('access-investigation-sidebar')).toBeVisible()
    await expect(page.getByTestId('road-access-history')).toBeVisible()
    await expect(page.locator('.road-summary')).toHaveCount(0)
    await expect(page.getByTestId('road-profile-chart')).not.toBeVisible()
    await expect(page.getByTestId('road-station-controller')).toHaveCount(0)
    await expect(page.getByTestId('road-active-map-station')).toHaveCount(0)
    await expect(page.getByText('Mapped block parts', { exact: true })).toBeVisible()
    await expect(page.getByText('Tenure road records', { exact: true })).toBeVisible()
    await expect.poll(async () => (await mapHistory(page))?.designRoads.length).toBe(0)
    await expect
      .poll(
        async () =>
          (await mapHistory(page))?.context.filter((feature) => feature.properties?.kind === 'existing-road').length,
      )
      .toBe(1)
    await page.getByRole('button', { name: `Inspect nearby road ${road.name}`, exact: true }).click()
    await expect.poll(async () => (await mapHistory(page))?.selectedRoad[0]?.properties?.id).toBe(road.id)
    expect((await mapHistory(page))?.selectedRoad[0]?.geometry).toEqual(road.geometry)
    await page.screenshot({ path: info.outputPath('access-investigation-records.png') })
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const stream = await (await downloading).createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
    const saved = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RoadProject
    expect(saved.workspaceMode).toBe('access-investigation')
    await open(saved)
    await expect.poll(async () => (await mapHistory(page))?.designRoads.length).toBe(0)
    await page.getByRole('button', { name: 'Start design', exact: true }).click()
    await expect(page.getByTestId('road-workspace')).toHaveAttribute('data-workspace-mode', 'design')
    // The design starts with no road: no placeholder line, no summary of one.
    await expect(page.getByTestId('first-road-panel')).toBeVisible()
    await expect(page.locator('.road-summary')).toHaveCount(0)
    await expect.poll(async () => (await mapHistory(page))?.designRoads.length ?? 0).toBe(0)
    // Loading the study's mapped road makes it the first road, held as recorded.
    await page.getByRole('button', { name: `Load ${road.name} as a road`, exact: true }).click()
    await expect(page.getByTestId('mapped-road-panel')).toBeVisible()
    await expect(page.locator('.road-summary')).toBeVisible()
    await expect(page.getByText('Max ground grade', { exact: true })).toBeVisible()
    await expect.poll(async () => (await mapHistory(page))?.designRoads.length ?? 0).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })
})

async function saveProject(page: Page): Promise<RoadProject> {
  await showMap(page)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as RoadProject
}

for (const phone of [false, true]) {
  test.describe(phone ? 'historical access on a narrow phone' : 'historical access on desktop', () => {
    test.use({
      viewport: phone ? { width: 320, height: 668 } : { width: 1512, height: 982 },
      hasTouch: phone,
      isMobile: phone,
    })
    test('traces past access, exposes closure conflicts, and reopens reviewed evidence', async ({
      page,
      baseURL,
    }, info) => {
      const { errors, publicRequests } = await prepare(page, baseURL!)
      const history = await openHistory(page)
      await expect(history).toContainText('Synthetic worked example')
      const card = page.getByTestId('history-selected-path')
      await expect(card).toContainText('Inferred access')
      await expect(card).toContainText('Synthetic shared bridge')
      await expect.poll(async () => (await mapHistory(page))?.route?.date).toBe('2010-06-30')
      expect((await mapHistory(page))?.dash).toEqual([2, 1])
      await choose(
        history.getByRole('combobox', { name: 'Access-history cutblock', exact: true }),
        'history-example-block-b',
      )
      await expect(card).toContainText('Synthetic spur B culvert')
      await expect.poll(async () => (await mapHistory(page))?.route?.name).toContain('block B')
      await choose(
        history.getByRole('combobox', { name: 'Access-history cutblock', exact: true }),
        'history-example-block-a',
      )

      await history.getByLabel('Historical date', { exact: true }).fill('2022-08-01')
      await history.getByRole('button', { name: 'Trace historical access', exact: true }).click()
      await expect(card).toContainText('Synthetic bypass · built 2016')
      await expect.poll(async () => (await mapHistory(page))?.route?.date).toBe('2022-08-01')
      await page
        .getByTestId('history-trace-results')
        .locator('summary', { hasText: 'Structure evidence and conflicts' })
        .click()
      await expect(page.getByTestId('history-trace-results')).toContainText('conflict')
      await expect
        .poll(
          async () =>
            (await mapHistory(page))?.structures.find((item) => item?.id === 'history-example-bridge')?.status,
        )
        .toBe('conflict')

      // Document the supported 2010 route. Changing the query date did not rewrite it.
      await choose(card.getByRole('combobox', { name: 'Historical route', exact: true }), { label: /2010-06-30/ })
      await card.locator('summary', { hasText: 'Review this association' }).click()
      await choose(card.getByRole('combobox', { name: 'Reviewed relationship', exact: true }), 'documented-use')
      await choose(card.getByRole('combobox', { name: 'Review source', exact: true }), 'example-haul-ledger')
      await card.getByLabel('Reviewer', { exact: true }).fill('Synthetic training reviewer')
      await card
        .getByLabel('Evidence reference and reasoning', { exact: true })
        .fill('Invented haul ledger, route A, page 2. Demonstration only.')
      await card.getByRole('button', { name: 'Save reviewed assertion', exact: true }).click()
      await expect(card).toContainText('Documented use')
      await expect.poll(async () => (await mapHistory(page))?.route?.relationship).toBe('Documented use')
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1)
      await page.screenshot({ path: info.outputPath('historical-access-review.png') })

      const saved = await saveProject(page)
      expect(saved.accessHistory!.paths.some((path) => path.relationship === 'documented-use')).toBe(true)
      expect(
        saved.context
          .filter((feature) => feature.kind === 'existing-road')
          .every((feature) => feature.roadEvidence?.reuseAllowed === false),
      ).toBe(true)
      expect(saved.context.find((feature) => feature.id === 'history-example-bridge-road')?.roadEvidence).toMatchObject(
        { forestFileId: '009900', roadSectionId: '002' },
      )
      const picker = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Open', exact: true }).click()
      await (
        await picker
      ).setFiles({
        name: 'access-history.road.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(saved)),
      })
      await openHistory(page)
      await expect(page.getByTestId('history-selected-path')).toContainText('Invented haul ledger, route A, page 2')
      await expect.poll(async () => (await mapHistory(page))?.route?.relationship).toBe('Documented use')
      await showMap(page)
      await page.screenshot({ path: info.outputPath('historical-access-map.png') })
      expect(errors).toEqual([])
      expect(publicRequests.filter((url) => url.includes('delivery.maps.gov.bc.ca'))).toEqual([])
    })
  })
}
