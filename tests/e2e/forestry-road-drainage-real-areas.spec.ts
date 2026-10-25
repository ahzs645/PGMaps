import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { analyzeRoad, nearestStation } from '../../src/pages/dev-forestry-roads/engine'
import { terrainFromMetadata, localMetricGrid } from '../../src/pages/dev-forestry-roads/terrain'
import {
  runDrainage,
  DEFAULT_DRAINAGE_SETTINGS,
  type DrainageRun,
} from '../../src/pages/dev-forestry-roads/drainageRun'
import { formatRoadStation } from '../../src/pages/dev-forestry-roads/Charts'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

const root = process.env.PGMAPS_ROAD_DRAINAGE_PROJECT_DIR
test.skip(!root, 'Supply the directory containing the actual Kamloops and Vernon exported road projects.')
test.setTimeout(240000)

function summary(run: DrainageRun) {
  return {
    cells: run.cells,
    cellM: run.cellM,
    changedCells: run.changedCells,
    settings: run.settings,
    crossings: run.crossings,
    lowPoints: run.lowPoints,
    culverts: run.culverts,
    newPonding: {
      cells: run.newPonding.cells,
      areaM2: run.newPonding.areaM2,
      volumeM3: run.newPonding.volumeM3,
      maxDepthM: run.newPonding.maxDepthM,
    },
    warnings: run.warnings,
    roles: run.plan.features.reduce<Record<string, number>>((roles, feature) => {
      const role = String(feature.properties?.role)
      roles[role] = (roles[role] ?? 0) + 1
      return roles
    }, {}),
  }
}

async function actualRun(page: Page) {
  return page.getByTestId('road-drainage').evaluate((element) => {
    type Fiber = { memoizedProps?: { run?: DrainageRun; stale?: boolean }; return?: Fiber }
    const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'))!
    let fiber = (element as unknown as Record<string, Fiber>)[key]
    for (let i = 0; fiber && i < 100; i++, fiber = fiber.return!) {
      const run = fiber.memoizedProps?.run
      if (!run) continue
      return {
        stale: !!fiber.memoizedProps?.stale,
        cells: run.cells,
        cellM: run.cellM,
        changedCells: run.changedCells,
        settings: run.settings,
        crossings: run.crossings,
        lowPoints: run.lowPoints,
        culverts: run.culverts,
        newPonding: {
          cells: run.newPonding.cells,
          areaM2: run.newPonding.areaM2,
          volumeM3: run.newPonding.volumeM3,
          maxDepthM: run.newPonding.maxDepthM,
        },
        warnings: run.warnings,
        roles: run.plan.features.reduce<Record<string, number>>((roles, feature) => {
          const role = String(feature.properties?.role)
          roles[role] = (roles[role] ?? 0) + 1
          return roles
        }, {}),
      }
    }
    return null
  })
}

async function mapRoles(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')!
    const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'))!
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (element as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!)
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState
        const map = value && typeof value === 'object' && 'current' in value ? value.current : (value as Map)
        if (typeof map?.getTerrain !== 'function') continue
        const source = map.getSource('road-drainage')
        if (source?.type !== 'geojson') return {}
        return (source.serialize().data as GeoJSON.FeatureCollection).features.reduce<Record<string, number>>(
          (roles, feature) => {
            const role = String(feature.properties?.role)
            roles[role] = (roles[role] ?? 0) + 1
            return roles
          },
          {},
        )
      }
    return null
  })
}

async function save(page: Page, path?: string): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const download = await pending
  if (path) await download.saveAs(path)
  const chunks: Buffer[] = [],
    stream = await download.createReadStream()
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function detail(page: Page) {
  const tabs = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
  if (await tabs.isVisible()) await tabs.getByRole('tab', { name: 'Detail', exact: true }).click()
  const select = page.getByRole('combobox', { name: 'Road detail view', exact: true })
  if (!(await select.innerText()).includes('Drainage')) {
    await select.click()
    await page.getByRole('option', { name: 'Drainage', exact: true }).click()
  }
}

async function field(page: Page, label: string, value: number) {
  const input = page.getByLabel(label, { exact: true })
  await input.fill(String(value))
  await input.press('Tab')
}

async function run(page: Page) {
  await page
    .getByTestId('road-drainage')
    .getByRole('button', { name: /^(Run drainage check|Re-run drainage)$/ })
    .click()
  await expect
    .poll(async () => {
      const result = await actualRun(page)
      return !!result && !result.stale
    })
    .toBe(true)
  return (await actualRun(page))!
}

function compare(actual: NonNullable<Awaited<ReturnType<typeof actualRun>>>, expected: ReturnType<typeof summary>) {
  expect(actual.cells).toBe(expected.cells)
  expect(actual.cellM).toBe(expected.cellM)
  expect(actual.changedCells).toBe(expected.changedCells)
  expect(actual.settings).toEqual(expected.settings)
  expect(actual.roles).toEqual(expected.roles)
  expect(actual.crossings.length).toBe(expected.crossings.length)
  expect(actual.lowPoints.length).toBe(expected.lowPoints.length)
  expect(actual.culverts.length).toBe(expected.culverts.length)
  expect(actual.newPonding.areaM2).toBeCloseTo(expected.newPonding.areaM2, 6)
  for (let i = 0; i < actual.crossings.length; i++) {
    expect(actual.crossings[i].chainage).toBeCloseTo(expected.crossings[i].chainage, 5)
    expect(actual.crossings[i].areaHa).toBeCloseTo(expected.crossings[i].areaHa, 6)
  }
  for (let i = 0; i < actual.culverts.length; i++) {
    expect(actual.culverts[i].designFlowM3s).toBeCloseTo(expected.culverts[i].designFlowM3s, 7)
    expect(actual.culverts[i].capacityM3s).toBeCloseTo(expected.culverts[i].capacityM3s, 7)
    expect(actual.culverts[i].adequate).toBe(expected.culverts[i].adequate)
  }
}

for (const area of ['kamloops-desktop', 'vernon-mobile'])
  for (const device of ['desktop', 'mobile']) {
    test.describe(`${area} / ${device}`, () => {
      test.use({
        viewport: device === 'mobile' ? { width: 390, height: 844 } : { width: 1512, height: 982 },
        isMobile: device === 'mobile',
        hasTouch: device === 'mobile',
        serviceWorkers: 'block',
      })
      test('real-area drainage, linked plan, buffer sensitivity and pipe checks', async ({ page }, info) => {
        const errors: string[] = [],
          records: Array<Record<string, unknown>> = []
        page.on('pageerror', (error) => errors.push(error.message))
        const baseline: RoadProject = JSON.parse(await readFile(`${root}/${area}.road.json`, 'utf8'))
        const source = terrainFromMetadata(baseline.terrain)!
        let project = baseline
        const road = () => project.alignments.find((a) => a.id === project.activeAlignmentId)!
        const expected = (settings: typeof DEFAULT_DRAINAGE_SETTINGS) =>
          summary(
            runDrainage({
              terrain: source,
              analysis: analyzeRoad(road(), source, project.settings, project.context),
              culverts: road().engineering?.culverts ?? [],
              ...localMetricGrid(road().points[0].coordinate),
              resolutionM: project.terrain.resolutionM,
              settings,
            }),
          )
        await page.route('https://**', (route) => route.abort())
        await page.route('https://basemaps.cartocdn.com/**', (route) =>
          route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
        )
        await page.goto('/dev/forestry/road-design?example=training')
        await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
        const chooser = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Open', exact: true }).click()
        await (await chooser).setFiles(`${root}/${area}.road.json`)
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
        expect(await save(page)).toEqual(baseline)
        await detail(page)

        for (const bufferM of [250, 500, 1000]) {
          await field(page, 'Upslope buffer (m)', bufferM)
          const actual = await run(page),
            reference = expected({ ...DEFAULT_DRAINAGE_SETTINGS, bufferM })
          compare(actual, reference)
          await expect.poll(() => mapRoles(page)).toEqual(actual.roles)
          records.push({ phase: 'buffer comparison', ...actual })
          await page.screenshot({ path: info.outputPath(`drainage-buffer-${bufferM}.png`) })
        }
        expect(await save(page)).toEqual(baseline)
        const baselineRun = expected({ ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 1000 })
        const target = baselineRun.crossings[0]?.chainage ?? baselineRun.lowPoints[0]?.chainage
        expect(target).toBeDefined()
        const region = page.getByRole('region', {
          name: baselineRun.crossings.length ? 'Stream crossings' : 'Ditch low points',
          exact: true,
        })
        await region
          .getByRole('button', { name: formatRoadStation(target), exact: true })
          .first()
          .click()
        const nearest = nearestStation(analyzeRoad(road(), source, project.settings).stations, target)!
        if (device === 'mobile')
          await expect(page.getByTestId('road-connected-layout')).toHaveAttribute('data-focused-pane', 'plan')
        await expect(page.getByTestId('road-active-map-station')).toHaveAttribute(
          'data-chainage',
          String(nearest.chainage),
        )
        await page.screenshot({ path: info.outputPath('selected-drainage-on-plan.png') })
        await detail(page)

        if (area === 'vernon-mobile') {
          await field(page, 'Upslope buffer (m)', 500)
          const reference = expected({ ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 500 })
          const inlet = [...reference.lowPoints]
            .filter((p) => p.chainage > 20 && p.chainage < 180)
            .sort((a, b) => b.areaHa - a.areaHa)[0]
          expect(inlet).toBeTruthy()
          const editPipe = async (add: boolean, chainage: number, diameterM: number) => {
            const show = page.getByRole('button', { name: 'Show road controls', exact: true })
            if (await show.isVisible()) await show.click()
            await page
              .getByRole('tablist', { name: 'Road workflow', exact: true })
              .getByRole('tab', { name: 'Engineering', exact: true })
              .click()
            await page
              .getByRole('tablist', { name: 'Engineering inputs', exact: true })
              .getByRole('tab', { name: 'Drainage', exact: true })
              .click()
            if (add) await page.getByRole('button', { name: 'Add culvert at station', exact: true }).click()
            await page.getByLabel('Culvert 1 name', { exact: true }).fill('Illustrative test pipe; not field data')
            await field(page, 'Culvert 1 station (m)', chainage)
            await field(page, 'Culvert 1 diameter (m)', diameterM)
            project = await save(page, info.outputPath(`pipe-${diameterM}-${Math.round(chainage)}.road.json`))
            expect(project.terrain).toEqual(baseline.terrain)
            expect(road().points).toEqual(baseline.alignments.find((a) => a.id === baseline.activeAlignmentId)!.points)
            if (device === 'mobile') await page.getByRole('button', { name: 'Hide road controls', exact: true }).click()
            await detail(page)
          }
          await editPipe(true, reference.crossings[0].chainage, 0.3)
          let actual = await run(page)
          compare(actual, expected({ ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 500 }))
          expect(actual.warnings.join(' ')).toContain('much smaller than the existing-ground catchment')
          records.push({ phase: 'pipe at crossing needs catchment review', ...actual })
          await page.screenshot({ path: info.outputPath('pipe-catchment-warning.png') })

          await editPipe(false, inlet.chainage, 0.3)
          actual = await run(page)
          compare(actual, expected({ ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 500 }))
          expect(actual.culverts[0].adequate).toBe(false)
          expect(actual.culverts[0].slopeAssumed).toBe(true)
          const initialQ = actual.culverts[0].designFlowM3s
          records.push({ phase: 'illustrative small pipe at largest interior outlet', ...actual })
          await page.screenshot({ path: info.outputPath('small-pipe-review.png') })

          await field(page, 'Rainfall (mm/h)', 100)
          await expect(page.getByText(/changed since this run/)).toBeVisible()
          await expect.poll(() => mapRoles(page)).toEqual({})
          actual = await run(page)
          expect(actual.culverts[0].designFlowM3s).toBeCloseTo(initialQ * 2, 7)
          records.push({ phase: 'double rainfall', ...actual })
          await editPipe(false, inlet.chainage, 1.2)
          actual = await run(page)
          compare(actual, expected({ ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 500, rainfallMmPerHr: 100 }))
          expect(actual.culverts[0].adequate).toBe(true)
          records.push({ phase: 'larger illustrative pipe', ...actual })
          await page.screenshot({ path: info.outputPath('larger-pipe-review.png') })
        }
        if (device === 'mobile')
          for (const viewport of [
            { width: 320, height: 568 },
            { width: 667, height: 375 },
          ]) {
            await page.setViewportSize(viewport)
            const panel = page.getByTestId('road-drainage')
            await panel.getByRole('region', { name: 'Culvert sizing', exact: true }).scrollIntoViewIfNeeded()
            expect(
              await page.evaluate(() => ({
                x: document.documentElement.scrollWidth - innerWidth,
                y: document.documentElement.scrollHeight - innerHeight,
              })),
            ).toEqual({ x: 0, y: 0 })
            await page.screenshot({ path: info.outputPath(`drainage-${viewport.width}x${viewport.height}.png`) })
          }
        await writeFile(
          info.outputPath('results.json'),
          JSON.stringify(
            {
              area,
              device,
              sourceSha256: baseline.terrain.sha256,
              gridEpsg: localMetricGrid(road().points[0].coordinate).epsg,
              records,
              errors,
            },
            null,
            2,
          ),
        )
        expect(errors).toEqual([])
      })
    })
  }
