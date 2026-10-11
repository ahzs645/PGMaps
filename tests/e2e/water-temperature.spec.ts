import { expect, test, type Locator, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
const stations = ['A', 'B', 'C', 'D', 'E'].map((id, index) => ({
  station_id: id,
  station_code: id,
  station_description: `Stream ${id}`,
  waterbody_name: `River ${id}`,
  latitude: 54 + index * 0.1,
  longitude: -125 + index * 0.3,
  filename: `${id}.json`,
  start: '2023-01-01',
  end: '2023-03-31',
  n: 90,
  provider_name: 'UNBC',
  url: '',
}))
const observations = Array.from({ length: 90 }, (_, index) => ({
  date: new Date(Date.UTC(2023, 0, index + 1)).toISOString().slice(0, 10),
  temp_c: index % 20,
  airtemp_c: index % 25,
}))

async function prepare(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('**/__dev_water_temp/stations.json', (route) => route.fulfill({ json: stations }))
  await page.route('**/__dev_water_temp/config.json', (route) =>
    route.fulfill({ json: { last_updated: '2025-07-16', daymet_last_year: 2023 } }),
  )
  await page.route('**/__dev_water_temp/data/*.json', (route) => route.fulfill({ json: observations }))
  await page.goto('/dev/water-temperature')
  await expect(page.getByRole('heading', { name: 'Nechako water temperature' })).toBeVisible()
}

async function selectStation(page: Page, code: string) {
  await page.getByRole('button', { name: 'Browse stations', exact: true }).click()
  await page.getByRole('button', { name: `Select station ${code}`, exact: true }).click()
  await page.getByRole('button', { name: 'Close station browser', exact: true }).click()
}

async function dragZoom(page: Page, region: Locator) {
  const plot = region.getByTestId('xy-plot')
  await plot.scrollIntoViewIfNeeded()
  const box = await plot.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 70, box!.y + 25)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.65, { steps: 6 })
  await page.mouse.up()
}

test('map and station list share selection, with a four-station limit and stable colours', async ({ page }) => {
  const errors: string[] = []
  const requestedStyles = new Set<string>()
  page.on('request', (request) => {
    if (request.url().startsWith('https://basemaps.cartocdn.com/gl/')) requestedStyles.add(request.url())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text())
  })
  await prepare(page)
  await expect(page.getByRole('region', { name: 'Station browser', exact: true })).toHaveCSS('overflow-y', 'visible')
  await expect(page.getByRole('button', { name: 'Map station A', exact: true }).locator('circle')).toHaveAttribute(
    'stroke',
    '#1b9e77',
  )
  await page.getByRole('button', { name: 'Map station A', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Map station A', exact: true }).locator('circle')).toHaveAttribute(
    'stroke',
    '#e41a1c',
  )
  await expect(page.getByRole('button', { name: 'Map station B', exact: true }).locator('circle')).toHaveAttribute(
    'stroke',
    '#808080',
  )
  await expect(page.getByTestId('range-summary')).toContainText('90 water observations')
  await expect(page.getByRole('button', { name: 'Map station A', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await selectStation(page, 'B')
  await expect(page.getByTestId('range-summary')).toContainText('180 water observations')
  const stationToggle = page
    .getByTestId('selected-stations')
    .getByRole('button', { name: 'Show series A', exact: true })
  const markerAndText = await stationToggle.locator('span').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect()
      return box.y + box.height / 2
    }),
  )
  expect(Math.max(...markerAndText) - Math.min(...markerAndText)).toBeLessThan(2)
  await expect(
    page.getByTestId('range-toolbar').getByRole('button', { name: 'Show series A', exact: true }),
  ).toHaveCount(0)
  const colour = await page.getByRole('button', { name: 'Map station B', exact: true }).getAttribute('style')
  await expect(page.getByRole('combobox', { name: 'Station basemap', exact: true })).toHaveCount(0)
  for (let themeChange = 0; themeChange < 2; themeChange++) {
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Fit all stations', exact: true })).toBeEnabled()
    await expect(page.getByTestId('range-summary')).toContainText('180 water observations')
    await expect(page.getByRole('button', { name: 'Map station B', exact: true }).locator('circle')).toHaveAttribute(
      'stroke',
      '#377eb8',
    )
  }
  await expect.poll(() => [...requestedStyles].sort()).toEqual([
    'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  ].sort())
  await selectStation(page, 'C')
  await selectStation(page, 'D')
  await selectStation(page, 'E')
  await expect(page.getByText('Compare up to four stations.')).toBeVisible()
  await page.getByRole('button', { name: 'Remove A', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Map station B', exact: true })).toHaveAttribute('style', colour!)
  await selectStation(page, 'E')
  await expect(page.getByRole('button', { name: 'Map station E', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByTestId('range-summary')).toContainText('0 water observations')
  expect(errors).toEqual([])
})

test('date range links charts and CSV, and aggregation and seasonality controls work', async ({ page }) => {
  await prepare(page)
  await selectStation(page, 'A')
  await selectStation(page, 'B')
  await expect(page.getByTestId('range-summary')).toContainText('180 water observations')
  await page.getByLabel('Plot range starts', { exact: true }).fill('2023-02-01')
  await page.getByLabel('Plot range ends', { exact: true }).fill('2023-02-28')
  await expect(page.getByTestId('range-summary')).toContainText('56 water observations')
  await expect(page.getByTestId('paired-count')).toContainText('56 paired days')
  await page.getByLabel('Minimum air temperature (°C)', { exact: true }).fill('100')
  await expect(page.getByTestId('paired-count')).toContainText('0 paired days')
  await expect(page.getByText('No paired air/water observations')).toBeVisible()
  await page.getByLabel('Minimum air temperature (°C)', { exact: true }).fill('-10')
  await page.getByRole('button', { name: 'Years', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Years', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download daily CSV', exact: true }).click()
  const result = await download
  expect(result.suggestedFilename()).toBe('unbc-water-temperature.csv')
  const stream = await result.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const csv = Buffer.concat(chunks).toString()
  expect(csv).toContain('2023-02-01')
  expect(csv).not.toContain('2023-01-01')
  expect(csv.split('\r\n')).toHaveLength(57)
  await page.getByRole('button', { name: 'Monthly', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Monthly', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Seasonal', exact: true }).click()
  await page.getByRole('combobox', { name: 'Season starts', exact: true }).selectOption('11')
  await page.getByRole('combobox', { name: 'Season ends', exact: true }).selectOption('2')
  await page.getByRole('button', { name: 'Daily', exact: true }).click()
  await page.getByRole('button', { name: 'Browse stations', exact: true }).click()
  await page.getByLabel('Search stations', { exact: true }).fill('River B')
  await expect(page.getByRole('button', { name: /^Select station / })).toHaveCount(1)
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Select station / })).toHaveCount(5)
  await page.getByRole('button', { name: 'Close station browser', exact: true }).click()
})

test('failed observations retry, mobile controls fit, and selection survives resizing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await prepare(page)
  let attempts = 0
  await page.route('**/__dev_water_temp/data/A.json', (route) => {
    attempts += 1
    return attempts === 1 ? route.fulfill({ status: 503 }) : route.fulfill({ json: observations })
  })
  await selectStation(page, 'A')
  await expect(page.getByRole('button', { name: 'Retry observations', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Retry observations', exact: true }).click()
  await expect(page.getByTestId('range-summary')).toContainText('90 water observations')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Fullscreen dashboard', exact: true }).click()
  await page.getByRole('button', { name: 'Fullscreen Air vs. water', exact: true }).click()
  const mobilePlot = await page.getByRole('region', { name: 'Air vs. water', exact: true }).boundingBox()
  expect(mobilePlot!.width).toBe(390)
  expect(mobilePlot!.height).toBe(844)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Exit fullscreen dashboard', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.getByRole('button', { name: 'Map station A', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('range-summary')).toContainText('90 water observations')
})

test('dragging the navigator filters downstream plots and scatter zoom resets', async ({ page }) => {
  await prepare(page)
  await selectStation(page, 'A')
  await expect(page.getByTestId('range-summary')).toContainText('90 water observations')
  const handle = page.locator('.recharts-brush-traveller').first()
  await handle.scrollIntoViewIfNeeded()
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + 120, box!.y + box!.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByTestId('range-summary')).not.toContainText('90 water observations')
  const count = Number((await page.getByTestId('range-summary').innerText()).split(' ')[0])
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThan(90)
  await expect(page.getByTestId('paired-count')).toContainText(`${count} paired days`)
  const scatter = page.getByRole('region', { name: 'Air vs. water', exact: true })
  await dragZoom(page, scatter)
  await expect(scatter.getByRole('button', { name: 'Reset zoom', exact: true })).toBeEnabled()
  await scatter.getByRole('button', { name: 'Reset zoom', exact: true }).click()
  await expect(scatter.getByRole('button', { name: 'Reset zoom', exact: true })).toHaveCount(0)
})

test('reference dashboard shows simultaneous graphs, collapses stations, and keeps state through every fullscreen view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await prepare(page)
  await selectStation(page, 'A')
  await selectStation(page, 'B')
  await expect(page.getByTestId('range-summary')).toContainText('180 water observations')
  for (const title of ['Water temperature over time', 'Seasonality', 'Air vs. water']) {
    const region = page.getByRole('region', { name: title, exact: true })
    const box = await region.boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(721)
    await expect(region.locator('.recharts-wrapper')).toBeVisible()
    if (title !== 'Water temperature over time') {
      const plot = await region.getByTestId('xy-plot').boundingBox()
      expect(plot!.height).toBeGreaterThan(150)
      expect(plot!.height / box!.height).toBeGreaterThan(0.7)
      await expect(region.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCount(0)
      await expect(region.getByRole('button', { name: 'Reset zoom', exact: true })).toHaveCount(0)
    }
    await region.getByRole('button', { name: `Fullscreen ${title}`, exact: true }).click()
    await expect(region).toHaveAttribute('data-fullscreen', 'true')
    const full = await region.boundingBox()
    expect(full!.width).toBeGreaterThanOrEqual(1279)
    expect(full!.height).toBeGreaterThanOrEqual(719)
    if (title === 'Seasonality') {
      await region.getByRole('button', { name: 'Years', exact: true }).click()
      await dragZoom(page, region)
      await expect(region.getByRole('button', { name: 'Reset zoom', exact: true })).toBeEnabled()
      await region.getByRole('button', { name: 'Reset zoom', exact: true }).click()
    }
    if (title === 'Air vs. water') await dragZoom(page, region)
    await region.getByRole('button', { name: `Exit fullscreen ${title}`, exact: true }).click()
    await expect(region).not.toHaveAttribute('data-fullscreen', 'true')
  }
  await expect(page.getByRole('button', { name: 'Years', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('region', { name: 'Air vs. water', exact: true }).getByRole('button', { name: 'Reset zoom' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Show series A', exact: true }).click()
  await expect(page.getByTestId('range-summary')).toContainText('90 water observations')
  await expect(page.getByRole('button', { name: 'Map station A', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Show series A', exact: true }).click()
  await expect(page.getByTestId('range-summary')).toContainText('180 water observations')
  await page.getByRole('button', { name: 'Hide stations', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Station browser', exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Fullscreen dashboard', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Exit fullscreen dashboard', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Fullscreen Seasonality', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Fullscreen Seasonality', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Exit fullscreen dashboard', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Exit fullscreen dashboard', exact: true }).click()
  await page.getByRole('button', { name: 'Show stations', exact: true }).click()
  await page.getByRole('button', { name: '1m', exact: true }).click()
  await expect(page.getByLabel('Plot range starts', { exact: true })).toHaveValue('2023-02-28')
  await page.getByRole('button', { name: 'All dates', exact: true }).click()
  const stationPane = page.getByRole('region', { name: 'Station browser', exact: true })
  const paneSize = await stationPane.evaluate((element) => ({
    client: element.clientHeight,
    scroll: element.scrollHeight,
  }))
  expect(paneSize.scroll).toBeLessThanOrEqual(paneSize.client + 1)
  await page.getByRole('button', { name: 'Fullscreen dashboard', exact: true }).click()
  await page.getByRole('button', { name: 'Browse stations', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Find stations', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Find stations', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Exit fullscreen dashboard', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Browse stations', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Fullscreen Station map', exact: true }).click()
  await expect(page.getByTestId('station-map')).toHaveAttribute('data-fullscreen', 'true')
  const mapBox = await page.getByTestId('station-map').boundingBox()
  expect(mapBox!.height).toBeGreaterThanOrEqual(719)
  expect(mapBox!.width).toBeGreaterThanOrEqual(1279)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('station-map')).not.toHaveAttribute('data-fullscreen', 'true')
  await expect(page.getByTestId('range-summary')).toContainText('180 water observations')
  await page.setViewportSize({ width: 1024, height: 720 })
  await selectStation(page, 'C')
  await selectStation(page, 'D')
  const controlCenters = await page
    .getByRole('group', { name: 'Page controls', exact: true })
    .locator('input,button,a[aria-label="Dev library"]')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect()
        return box.y + box.height / 2
      }),
    )
  expect(Math.max(...controlCenters) - Math.min(...controlCenters)).toBeLessThan(2)
  await expect(page.getByLabel('Plot range starts', { exact: true })).toHaveCSS('width', '134px')
  await expect(page.getByLabel('Plot range ends', { exact: true })).toHaveCSS('width', '134px')
  await page.getByRole('button', { name: 'Hide stations', exact: true }).click()
  const collapsedCenters = await page
    .getByRole('group', { name: 'Page controls', exact: true })
    .locator('input,button,a[aria-label="Dev library"]')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect()
        return box.y + box.height / 2
      }),
    )
  expect(Math.max(...collapsedCenters) - Math.min(...collapsedCenters)).toBeLessThan(2)
  await page.getByRole('button', { name: 'Show stations', exact: true }).click()
  for (const title of ['Water temperature over time', 'Seasonality', 'Air vs. water']) {
    const region = page.getByRole('region', { name: title, exact: true })
    const heading = await region.getByRole('heading', { name: title, exact: true }).boundingBox()
    const action = await region.getByRole('button', { name: `Fullscreen ${title}`, exact: true }).boundingBox()
    expect(Math.abs(heading!.y + heading!.height / 2 - action!.y - action!.height / 2)).toBeLessThan(2)
  }
  const finalPane = await stationPane.evaluate((element) => ({
    client: element.clientHeight,
    scroll: element.scrollHeight,
  }))
  expect(finalPane.scroll).toBeLessThanOrEqual(finalPane.client + 1)
  const scatter = page.getByRole('region', { name: 'Air vs. water', exact: true })
  await expect(scatter.getByText('Air temperature (°C)', { exact: true })).toHaveCSS('font-size', '11px')
  await expect(scatter.getByText('Water °C', { exact: true })).toHaveCSS('font-size', '11px')
})

test('scatter renders raw observations on canvas with precise point tooltips and keyboard zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await prepare(page)
  await selectStation(page, 'A')
  const scatter = page.getByRole('region', { name: 'Air vs. water', exact: true })
  const canvas = scatter.getByTestId('scatter-points')
  await expect(canvas).toBeVisible()
  await expect(scatter.locator('.recharts-scatter-symbol')).toHaveCount(0)
  await expect
    .poll(() =>
      canvas.evaluate((element: HTMLCanvasElement) => {
        const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data
        let colored = 0
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) colored++
        return colored
      }),
    )
    .toBeGreaterThan(100)
  const bounds = await canvas.boundingBox()
  // Jan 11: air=10, water=10; independent axes span [0,24] and [0,19].
  await page.mouse.move(bounds!.x + (bounds!.width * 10) / 24, bounds!.y + (bounds!.height * 9) / 19)
  await expect(scatter.getByRole('tooltip')).toContainText('A · 2023-01-11')
  await expect(scatter.getByRole('tooltip')).toContainText('Air 10.0 °C · Water 10.0 °C')
  await scatter.getByTestId('xy-plot').press('+')
  await expect(scatter.getByRole('button', { name: 'Reset zoom', exact: true })).toBeVisible()
  await scatter.getByTestId('xy-plot').press('Home')
  await expect(scatter.getByRole('button', { name: 'Reset zoom', exact: true })).toHaveCount(0)
  await page.getByLabel('Minimum air temperature (°C)', { exact: true }).fill('12')
  await expect(scatter.getByRole('tooltip')).toHaveCount(0)
  await expect(page.getByTestId('paired-count')).toContainText('42 paired days')

  const season = page.getByRole('region', { name: 'Seasonality', exact: true })
  const seasonPlot = await season.getByTestId('xy-plot').boundingBox()
  const x = seasonPlot!.x + 45 + ((seasonPlot!.width - 57) * 10) / 365
  const y = seasonPlot!.y + 8 + ((seasonPlot!.height - 42) * 9) / 19
  await page.mouse.move(x, y)
  await expect(season.getByRole('tooltip')).toContainText('A mean')
  await expect(season.getByRole('tooltip')).toContainText('Range 10.0–10.0 °C')
  await page.getByRole('button', { name: 'Years', exact: true }).click()
  await page.mouse.move(x + 30, y)
  await page.mouse.move(x, y)
  await expect(season.getByRole('tooltip')).toContainText('A · 2023')
  await expect(season.getByRole('tooltip')).toContainText('2023-01-11')
})
