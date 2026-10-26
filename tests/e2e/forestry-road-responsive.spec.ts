import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 }, actionTimeout: 15000 })
test.setTimeout(180000)

const viewports = [
  { width: 1920, height: 1080 },
  { width: 1512, height: 982 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 650 },
  { width: 1366, height: 400 },
  { width: 1024, height: 768 },
  { width: 1024, height: 600 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 844, height: 320 },
  { width: 667, height: 375 },
  { width: 320, height: 568 },
]

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {
          attribution: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            attribution: 'Map attribution test',
          },
        },
        layers: [{ id: 'attribution', type: 'circle', source: 'attribution' }],
      },
    }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  return errors
}

/** Check actual geometry as well as scroll extents; clipped or oversized charts must fail. */
async function containment(page: Page) {
  return page.evaluate(() => {
    const issues: string[] = []
    const workspace = document.querySelector('[data-testid="road-workspace"]')!
    const main = document.getElementById('main-content')!
    const root = document.documentElement
    for (const [name, element] of [
      ['route', main],
      ['document', root],
    ] as const) {
      if (element.scrollHeight > element.clientHeight + 1)
        issues.push(`${name} vertical overflow ${element.scrollHeight - element.clientHeight}px`)
      if (element.scrollWidth > element.clientWidth + 1)
        issues.push(`${name} horizontal overflow ${element.scrollWidth - element.clientWidth}px`)
    }
    const inside = (name: string, element: Element, host: Element) => {
      const box = element.getBoundingClientRect()
      const bounds = host.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) return
      if (
        box.left < bounds.left - 1 ||
        box.top < bounds.top - 1 ||
        box.right > bounds.right + 1 ||
        box.bottom > bounds.bottom + 1
      )
        issues.push(
          `${name} outside host: ${JSON.stringify({ x: box.x, y: box.y, w: box.width, h: box.height, hostX: bounds.x, hostY: bounds.y, hostW: bounds.width, hostH: bounds.height })}`,
        )
    }
    inside('workspace', workspace, main)
    const layout = document.querySelector('[data-testid="road-connected-layout"]')!
    inside('connected layout', layout, workspace)
    const station = document.querySelector('[data-testid="road-station-controller"]')!
    inside('station controls', station, workspace)
    const summary = workspace.querySelector('.road-summary')!
    if (window.innerWidth < 768 && summary.getBoundingClientRect().height) {
      for (const [index, tile] of [...summary.children].entries()) {
        inside(`summary tile ${index + 1}`, tile, summary)
        for (const text of tile.querySelectorAll('dt, dd'))
          if (text.scrollWidth > text.clientWidth + 1) issues.push(`summary tile ${index + 1} text does not fit`)
      }
    }
    if (layout.getBoundingClientRect().bottom > station.getBoundingClientRect().top + 1)
      issues.push('connected layout overlaps station controls')
    for (const pane of document.querySelectorAll(
      '[data-pane="plan"], [data-pane="profile"], [data-pane="detail"], [data-pane="data"]',
    )) {
      if (!pane.getBoundingClientRect().width || !pane.getBoundingClientRect().height) continue
      const id = pane.getAttribute('data-pane')!
      inside(id, pane, layout)
      const panel = pane.querySelector('section[aria-label]')
      if (panel) inside(`${id} panel`, panel, pane)
      for (const chart of pane.querySelectorAll(
        'svg[data-testid], canvas.maplibregl-canvas, [data-testid="road-terrain-preview"] svg[role="group"]',
      ))
        inside(`${id} chart/canvas`, chart, panel ?? pane)
    }
    return issues
  })
}

async function expectContained(page: Page) {
  await expect
    .poll(() => containment(page), { message: 'road panes fit their workspace without page scrolling' })
    .toEqual([])
}

test('road panes adapt across desktop, short, tablet and phone viewports without page scrolling or losing map/station state', async ({
  page,
}, info) => {
  const errors = await prepare(page)
  const canvas = page.locator('[data-testid="road-plan-view"] canvas.maplibregl-canvas')
  const originalCanvas = await canvas.elementHandle()
  const controls = page.locator('aside[aria-label="Road design controls"]')
  const originalControls = await controls.elementHandle()
  const station = page.getByLabel('Selected station metres', { exact: true })
  await station.fill('200')
  await station.press('Tab')

  for (const viewport of viewports) {
    await test.step(`${viewport.width} × ${viewport.height}`, async () => {
      await page.setViewportSize(viewport)
      const focused = viewport.width < 1280 || viewport.height <= 620
      const paneTabs = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
      if (focused) {
        await expect(paneTabs).toBeVisible()
        for (const [label, pane, chart] of [
          ['Plan', 'plan', 'road-active-map-station'],
          ['Profile', 'profile', 'road-profile-chart'],
          ['Detail', 'detail', 'road-section-chart'],
        ]) {
          await paneTabs.getByRole('tab', { name: label, exact: true }).click()
          await expect(page.getByTestId('road-connected-layout')).toHaveAttribute('data-focused-pane', pane)
          await expect(page.getByTestId(chart)).toBeVisible()
          if (pane !== 'plan') await expect(page.getByTestId(chart)).toHaveAttribute('data-station', '200')
          await expectContained(page)
        }
        await paneTabs.getByRole('tab', { name: 'Plan', exact: true }).click()
      } else {
        await expect(paneTabs).toHaveCount(0)
        await expect(canvas).toBeVisible()
        await expect(page.getByTestId('road-profile-chart')).toBeVisible()
        await expect(page.getByTestId('road-section-chart')).toBeVisible()
      }
      await expectContained(page)
      await expect(station).toHaveValue('200')
      await expect(page.getByTestId('road-active-map-station')).toHaveAttribute('data-chainage', '200')
      if (!focused) {
        await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', '200')
        await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', '200')
      }
      expect(await canvas.evaluate((element, original) => element === original, originalCanvas)).toBe(true)
      expect(await controls.evaluate((element, original) => element === original, originalControls)).toBe(true)
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeInViewport()
      await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeInViewport()
      await page.screenshot({ path: info.outputPath(`workspace-${viewport.width}x${viewport.height}.png`) })
    })
  }
  expect(errors).toEqual([])
})

test('short workspace keeps controls internally scrollable, reaches all engineering panes and expands charts in place', async ({
  page,
}, info) => {
  const errors = await prepare(page)
  await page.setViewportSize({ width: 844, height: 390 })
  await page.getByRole('button', { name: 'Show road summary', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Show how the covered estimate is calculated', exact: true }),
  ).toBeVisible()
  await expectContained(page)
  await page.getByRole('button', { name: 'Hide road summary', exact: true }).click()
  await page.getByRole('button', { name: 'Show road controls', exact: true }).click()
  const controls = page.getByRole('complementary', { name: 'Road design controls', exact: true })
  await expect(controls).toBeVisible()
  const scroll = controls.locator('.overflow-y-auto').first()
  await expect.poll(() => scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await expectContained(page)
  await page.getByRole('button', { name: 'Hide road controls', exact: true }).click()

  await page.getByRole('button', { name: 'Screen presets & panels', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Screen layouts', exact: true })
    .getByRole('button', { name: 'Four panes', exact: true })
    .click()
  const tabs = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
  for (const label of ['Plan', 'Profile', 'Detail', 'Data']) {
    await tabs.getByRole('tab', { name: label, exact: true }).click()
    await expectContained(page)
  }
  await tabs.getByRole('tab', { name: 'Profile', exact: true }).click()
  const profile = page.getByRole('region', { name: 'Road profile · ground & formation', exact: true })
  // A short chart starts folded; the header switch shows the details under it or on their own.
  const views = profile.getByRole('group', { name: 'Chart details layout', exact: true })
  await expect(views.getByRole('button', { name: 'Chart only', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await views.getByRole('button', { name: 'Chart with details below', exact: true }).click()
  await expect(profile.locator('[data-chart-slot]')).toHaveAttribute('data-chart-view', 'both')
  await expectContained(page)
  await views.getByRole('button', { name: 'Details only', exact: true }).click()
  await expect(profile.locator('[data-chart-slot]')).toHaveAttribute('data-chart-view', 'details')
  await expectContained(page)
  await views.getByRole('button', { name: 'Chart with details below', exact: true }).click()
  await profile.getByRole('button', { name: 'Fullscreen Road profile · ground & formation', exact: true }).click()
  await expect(profile).toHaveAttribute('data-fullscreen', 'true')
  await expect
    .poll(() =>
      profile.evaluate((el) => {
        const rect = el.getBoundingClientRect()
        const chart = el.querySelector('[data-testid="road-profile-chart"]')!.getBoundingClientRect()
        return chart.top >= rect.top && chart.bottom <= rect.bottom + 1 && chart.right <= rect.right + 1
      }),
    )
    .toBe(true)
  await page.screenshot({ path: info.outputPath('short-profile-fullscreen.png') })
  await page.keyboard.press('Escape')
  await expect(profile).not.toHaveAttribute('data-fullscreen', 'true')
  await expectContained(page)

  await tabs.getByRole('tab', { name: 'Detail', exact: true }).click()
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: '3D', exact: true }).click()
  await expect(page.getByTestId('road-terrain-preview').locator('svg[role="group"]')).toBeVisible()
  await expectContained(page)
  await page.screenshot({ path: info.outputPath('short-terrain-preview.png') })
  expect(errors).toEqual([])
})

test('map legend and scale stay bottom aligned and map buttons share the settings button size', async ({
  page,
}, info) => {
  const errors = await prepare(page)
  const legend = page.getByTestId('road-terrain-legend').locator('.road-map-legend')
  const map = page.getByTestId('road-plan-view')
  for (const viewport of [
    { width: 1512, height: 982 },
    { width: 390, height: 844 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport)
    if (viewport.width < 1280)
      await page
        .getByRole('tablist', { name: 'Visible road pane', exact: true })
        .getByRole('tab', { name: 'Plan', exact: true })
        .click()
    await expect(legend).toBeVisible()
    const reference = (await map.getByRole('button', { name: 'Map display settings', exact: true }).boundingBox())!
    for (const name of ['Fit road alignments', 'Fit terrain coverage', 'Zoom in', 'Zoom out']) {
      const button = map.getByRole('button', { name, exact: true })
      await expect(button).toBeVisible()
      const box = (await button.boundingBox())!
      expect(box.width, `${name} width matches settings`).toBeCloseTo(reference.width, 0)
      expect(box.height, `${name} height matches settings`).toBeCloseTo(reference.height, 0)
    }
    for (const expanded of [false, true]) {
      if (expanded) await legend.getByRole('button', { name: 'Expand legend', exact: true }).click()
      await expect
        .poll(async () => {
          const bounds = (await map.boundingBox())!
          const panel = (await legend.boundingBox())!
          const scale = (await map.locator('[data-map-scale]').boundingBox())!
          return {
            bottom: Math.abs(bounds.y + bounds.height - panel.y - panel.height - 8) <= 2,
            right: Math.abs(bounds.x + bounds.width - panel.x - panel.width - 8) <= 2,
            scaleBottom: Math.abs(bounds.y + bounds.height - scale.y - scale.height - 8) <= 2,
            scaleLeft: Math.abs(scale.x - bounds.x - 8) <= 2,
            within:
              panel.x >= bounds.x &&
              panel.y >= bounds.y &&
              panel.x + panel.width <= bounds.x + bounds.width + 1 &&
              panel.y + panel.height <= bounds.y + bounds.height + 1,
          }
        })
        .toEqual({ bottom: true, right: true, scaleBottom: true, scaleLeft: true, within: true })
      await expectContained(page)
      await page.screenshot({
        path: info.outputPath(`legend-${viewport.width}x${viewport.height}-${expanded ? 'expanded' : 'collapsed'}.png`),
      })
    }
    await legend.getByRole('button', { name: 'Collapse legend', exact: true }).click()
    const attribution = map.locator('.maplibregl-ctrl-attrib-button')
    const credit = map.getByText('Map attribution test', { exact: true })
    await expect(attribution).toBeVisible()
    const attributionBox = (await attribution.boundingBox())!
    const scaleBox = (await map.locator('[data-map-scale]').boundingBox())!
    expect(attributionBox.y + attributionBox.height).toBeLessThanOrEqual(scaleBox.y)
    if (await credit.isVisible()) await attribution.click()
    await expect(credit).toBeHidden()
    await attribution.click()
    await expect(credit).toBeVisible()
    await attribution.click()
  }
  expect(errors).toEqual([])
})
