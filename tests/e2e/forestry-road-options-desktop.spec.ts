import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import {
  alignmentLength,
  distance,
  horizontalCurveSummary,
  positionAt,
} from '../../src/pages/dev-forestry-roads/engine'
import { terrainFromMetadata } from '../../src/pages/dev-forestry-roads/terrain'
import type { RoadOptimizationResult } from '../../src/pages/dev-forestry-roads/corridorOptimizer'
import type { Alignment, RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { expandRoadSection } from './road-sidebar'

test.skip(
  process.env.PGMAPS_ROAD_OPTIONS !== '1' || !process.env.PGMAPS_ROAD_OPTIONS_PROJECT,
  'Set PGMAPS_ROAD_OPTIONS=1 and PGMAPS_ROAD_OPTIONS_PROJECT to a real saved guide',
)
test.use({ viewport: { width: 1512, height: 982 }, serviceWorkers: 'block', actionTimeout: 15000 })
test.setTimeout(240000)

const baselinePath = process.env.PGMAPS_ROAD_OPTIONS_PROJECT ?? ''

async function routes(page: Page) {
  await page.route('https://**', (route) => route.abort())
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
}

async function open(page: Page, path: string, activeId: string) {
  const pending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (await pending).setFiles(path)
  await expect(page.getByLabel('Active road', { exact: true })).toHaveValue(activeId)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
}

async function downloadJson(page: Page, label: string, path?: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: label, exact: true }).click()
  const download = await pending
  if (path) await download.saveAs(path)
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function save(page: Page, path?: string): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const project = await downloadJson(page, 'Save project JSON', path)
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  return project
}

for (const objective of ['shortest', 'balanced', 'contour'] as const) {
  test(`desktop ${objective} preference on the same real Kamloops guide and 100 m corridor`, async ({
    page,
    context,
  }, info) => {
    const input = await readFile(baselinePath)
    const baseline: RoadProject = JSON.parse(input.toString())
    const guide = baseline.alignments.find((a) => a.id === baseline.activeAlignmentId)!
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    expect(baseline.settings.maxGradePercent).toBe(12)
    expect(baseline.settings.minRadius).toBe(25)
    await routes(page)
    await page.goto('/dev/forestry/road-design')
    await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeEnabled()
    // The baseline is an actual UI-produced edited road file, opened afresh for every preference.
    await open(page, baselinePath, baseline.activeAlignmentId)
    expect(await save(page)).toEqual(baseline)
    await expandRoadSection(page, 'road-route-tools')
    await page.getByLabel('Corridor optimization objective', { exact: true }).selectOption(objective)
    await page.getByLabel('Corridor half-width metres', { exact: true }).fill('100')
    await expect(page.getByLabel('Corridor optimization objective', { exact: true })).toHaveValue(objective)
    await expect(page.getByLabel('Corridor half-width metres', { exact: true })).toHaveValue('100')
    const started = Date.now()
    await page.getByRole('button', { name: 'Optimize sketched corridor', exact: true }).click()
    const review = page.getByTestId('road-optimization-review')
    const failure = page.getByRole('alert').filter({ hasText: /budget|no verified candidate|candidate failed/i })
    await expect
      .poll(async () => (await review.isVisible()) || (await failure.count()) > 0, { timeout: 150000 })
      .toBe(true)
    const durationMs = Date.now() - started
    const common = {
      schema: 'pgmaps-road-option-trial-v1',
      objective,
      corridorHalfWidthM: 100,
      inputProjectSha256: createHash('sha256').update(input).digest('hex'),
      guideId: guide.id,
      sourceSha256: baseline.terrain.sha256,
      maxGradePercent: baseline.settings.maxGradePercent,
      minimumRadiusM: baseline.settings.minRadius,
      durationMs,
      comparisonLimit:
        'Every run uses the same saved guide and corridor. Objective scores use different weights and cannot be ranked across preferences. No global optimum or field suitability claim.',
    }
    if (!(await review.isVisible())) {
      const message = await failure.allTextContents()
      expect(await save(page, info.outputPath('unchanged-after-failure.road.json'))).toEqual(baseline)
      await page.screenshot({ path: info.outputPath('no-candidate.png') })
      await writeFile(
        info.outputPath('outcome.json'),
        JSON.stringify(
          { ...common, outcome: 'no verified candidate', message, savedProjectPreserved: true, browserErrors: errors },
          null,
          2,
        ),
      )
      expect(errors).toEqual([])
      return
    }

    const report = await downloadJson(page, 'Download optimization report', info.outputPath('optimization-report.json'))
    expect(report.schema).toBe('pgmaps-road-corridor-review-v1')
    expect(report.options).toEqual({ objective, corridorHalfWidthM: 100 })
    expect(report.settings).toEqual(baseline.settings)
    expect(report.guide).toEqual(guide)
    expect(report.source.sha256).toBe(baseline.terrain.sha256)
    const result = report.result as RoadOptimizationResult
    const candidate = report.candidate as Alignment
    expect(result.complete).toBe(true)
    expect(result.maxSampledGroundPitchPercent).toBeLessThanOrEqual(12.000001)
    if (result.minimumRadiusM !== null) expect(result.minimumRadiusM).toBeGreaterThanOrEqual(25 - 1e-6)
    expect(distance(result.coordinates[0], guide.points[0].coordinate)).toBeLessThan(0.002)
    expect(
      distance(result.coordinates[result.coordinates.length - 1], guide.points[guide.points.length - 1].coordinate),
    ).toBeLessThan(0.002)
    expect(alignmentLength(candidate)).toBeCloseTo(result.lengthM, 3)
    for (const curve of horizontalCurveSummary(candidate)) expect(curve.radius).toBeGreaterThanOrEqual(25 - 1e-6)
    const source = terrainFromMetadata(baseline.terrain)!
    expect(result.profile.length).toBe(result.coordinates.length)
    for (let i = 0; i < result.profile.length; i++) {
      expect(source.elevationAt(...result.coordinates[i])).toBeCloseTo(result.profile[i].elevationM, 6)
      expect(
        distance(positionAt(candidate, result.profile[i].stationM).coordinate, result.coordinates[i]),
      ).toBeLessThan(0.002)
    }
    await page.screenshot({ path: info.outputPath('option-review.png') })
    await review.getByRole('button', { name: 'Use candidate as new road', exact: true }).click()
    const adopted = await save(page, info.outputPath('adopted.road.json'))
    expect(adopted.alignments).toHaveLength(baseline.alignments.length + 1)
    expect(adopted.alignments.find((a) => a.id === guide.id)).toEqual(guide)
    expect(adopted.alignments.find((a) => a.id === adopted.activeAlignmentId)).toEqual(candidate)
    expect(adopted.terrain).toEqual(baseline.terrain)
    expect(adopted.settings).toEqual(baseline.settings)

    const fresh = await context
      .browser()!
      .newContext({ viewport: { width: 1512, height: 982 }, serviceWorkers: 'block' })
    try {
      const reopened = await fresh.newPage()
      reopened.on('pageerror', (error) => errors.push(error.message))
      await routes(reopened)
      await reopened.goto(new URL('/dev/forestry/road-design', page.url()).href)
      await expect(reopened.getByRole('button', { name: 'Open', exact: true })).toBeEnabled()
      await open(reopened, info.outputPath('adopted.road.json'), adopted.activeAlignmentId)
      expect(await save(reopened)).toEqual(adopted)
      await expect(reopened.getByTestId('road-profile-chart')).toBeVisible()
      await expect(reopened.getByTestId('road-section-chart')).toBeVisible()
      await reopened.screenshot({ path: info.outputPath('fresh-reopened.png') })
    } finally {
      await fresh.close()
    }
    await writeFile(
      info.outputPath('outcome.json'),
      JSON.stringify(
        {
          ...common,
          outcome: result.searchStatus,
          savedAndFreshlyReopened: true,
          lengthM: result.lengthM,
          sampledGroundGradePercent: result.maxSampledGroundPitchPercent,
          minimumFittedRadiusM: result.minimumRadiusM,
          objectiveScore: result.objectiveCost,
          excessRiseFallM: result.excessVerticalM,
          ascentM: result.groundAscentM,
          descentM: result.groundDescentM,
          baseline: result.baseline,
          exploredStates: result.explored,
          terrainSamples: result.terrainSamples,
          candidateControls: candidate.points.length,
          warnings: result.warnings,
          browserErrors: errors,
        },
        null,
        2,
      ),
    )
    expect(errors).toEqual([])
  })
}
