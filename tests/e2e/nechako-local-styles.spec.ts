import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { decode } from 'fast-png'

const layerName = 'Typed style fixture'
const fixtureData = {
  type: 'FeatureCollection',
  features: [0, '0', 5, 10, null].map((value, index) => ({
    type: 'Feature',
    id: 'original-' + index,
    properties: { value },
    geometry: { type: 'Point', coordinates: [-124.8 + index * 0.15, 54] },
  })),
}
const workspace = {
  schema: 'nechako-workspace-v1',
  camera: { center: [-124.5, 54], zoom: 8, bearing: 0, pitch: 0 },
  layers: [],
  tiles: [],
  warnings: [],
  vectors: [{ id: 'source-layer-id', name: layerName, color: '#777777', visible: true, data: fixtureData }],
}
async function start(page: Page) {
  const errors: string[] = [],
    unexpected: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'basemaps.cartocdn.com')
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
        },
      })
    unexpected.push(url.href)
    return route.abort('internetdisconnected')
  })
  await page.route('**/api/nechako-portal/status', (route) =>
    route.fulfill({
      json: { available: false, loggedIn: false, isAdmin: false, canWrite: false, readOnly: true },
    }),
  )
  await page.goto('/dev/nechako/portal')
  await expect(page.locator('[data-nechako-portal-map] canvas')).toBeVisible()
  return { errors, unexpected }
}
async function projects(page: Page) {
  await page
    .getByRole('navigation', { name: 'Watershed portal' })
    .getByRole('button', { name: 'Projects', exact: true })
    .click()
  return page.getByRole('dialog', { name: 'Projects', exact: true })
}
async function exportWorkspace(page: Page, save = false) {
  const dialog = await projects(page)
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export workspace JSON', exact: true }).click()
  const result = JSON.parse(readFileSync((await (await downloading).path())!, 'utf8'))
  if (save) await dialog.getByRole('button', { name: 'Save workspace in browser', exact: true }).click()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  return result
}
async function countMapColors(page: Page, colors: number[][]) {
  const png = decode(await page.locator('[data-nechako-portal-map] canvas').screenshot())
  return colors.map(([red, green, blue]) => {
    let count = 0
    for (let index = 0; index < png.data.length; index += png.channels) {
      if (
        Math.abs(png.data[index] - red) <= 2 &&
        Math.abs(png.data[index + 1] - green) <= 2 &&
        Math.abs(png.data[index + 2] - blue) <= 2
      )
        count++
    }
    return count
  })
}
async function assertMapColors(page: Page, colors: number[][], testInfo: TestInfo, filename: string) {
  // Check actual browser-rendered map pixels; sidebar swatches cannot satisfy this assertion.
  await expect
    .poll(async () => (await countMapColors(page, colors)).every((count) => count > 250), { timeout: 20_000 })
    .toBe(true)
  await page.locator('[data-nechako-portal-map] canvas').screenshot({ path: testInfo.outputPath(filename) })
}

for (const width of [1440, 390]) {
  test('local typed styles render, persist and apply defaults at ' + width + 'px', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    const { errors, unexpected } = await start(page)
    const initialCanvas = await page.locator('[data-nechako-portal-map] canvas').elementHandle()
    const dialog = await projects(page)
    await dialog.getByLabel('Import portal project or workspace JSON', { exact: true }).setInputFiles({
      name: 'typed-style-workspace.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(workspace)),
    })
    await expect(
      dialog.getByText('Workspace loaded. Native conversion warnings appear below.', { exact: true }),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Expand Map Tools', exact: true }).click()
    await page.getByText('Style ' + layerName, { exact: true }).click()
    const editor = page.getByRole('region', { name: 'Advanced style for ' + layerName, exact: true })
    await editor.getByLabel('Style geometry for ' + layerName, { exact: true }).selectOption('point')
    await editor.getByLabel('Base style for ' + layerName + ' fillColor', { exact: true }).fill('#ffff00')
    await editor.getByLabel('Base style for ' + layerName + ' pointRadius', { exact: true }).fill('18')
    await editor.getByLabel('Base style for ' + layerName + ' pointOpacity', { exact: true }).fill('1')
    await editor.getByLabel('Base style for ' + layerName + ' pointStrokeWidth', { exact: true }).fill('0')
    await editor.getByLabel('Style mode for ' + layerName, { exact: true }).selectOption('rules')
    for (const [index, color] of ['#ff0000', '#0000ff', '#00ff00'].entries()) {
      await editor.getByRole('button', { name: 'Add comparison rule', exact: true }).click()
      const fieldset = editor.getByRole('group', { name: 'Rule ' + (index + 1), exact: true })
      if (index === 1) {
        await fieldset.getByLabel('Rule 2 type for ' + layerName, { exact: true }).selectOption('string')
        await fieldset.getByLabel('Rule 2 value for ' + layerName, { exact: true }).fill('0')
      }
      if (index === 2) {
        await fieldset.getByLabel('Rule 3 operator for ' + layerName, { exact: true }).selectOption('between')
        await fieldset.getByLabel('Rule 3 value for ' + layerName, { exact: true }).fill('5')
        await fieldset.getByLabel('Rule 3 upper for ' + layerName, { exact: true }).fill('10')
      }
      await fieldset.getByText('Rule symbol and colors', { exact: true }).click()
      await fieldset.getByLabel('Rule ' + (index + 1) + ' for ' + layerName + ' fillColor', { exact: true }).fill(color)
    }
    await editor.getByRole('button', { name: 'Apply style to layer', exact: true }).click()
    await expect(
      editor.getByText('Style applied to this map layer. Source geometry and attributes are unchanged.', {
        exact: true,
      }),
    ).toBeVisible()
    await editor.getByText('Applied map legend', { exact: true }).click()
    await expect(editor.getByLabel('Vector style legend', { exact: true })).toContainText('0 (number)')
    await expect(editor.getByLabel('Vector style legend', { exact: true })).toContainText('"0" (text)')
    await editor.getByLabel('Saved style name for ' + layerName, { exact: true }).fill('Typed class style')
    await editor.getByRole('button', { name: 'Save style in browser', exact: true }).click()
    await expect(
      editor.getByText('Style saved in this browser. Export a file to share or back it up.', { exact: true }),
    ).toBeVisible()
    const library = page.locator('[data-nechako-style-library]')
    await library.locator('summary').first().click()
    await expect(library.getByRole('heading', { name: 'Typed class style', exact: true })).toBeVisible()
    await library.getByRole('button', { name: 'Default for point', exact: true }).click()
    await expect(library).toContainText('Default: point')
    await page.getByRole('button', { name: 'Close Map Tools', exact: true }).click()
    await assertMapColors(
      page,
      [
        [255, 0, 0],
        [0, 0, 255],
        [0, 255, 0],
        [255, 255, 0],
      ],
      testInfo,
      'typed-rule-map-' + width + '.png',
    )
    const saved = await exportWorkspace(page, true)
    expect(saved.vectors[0].id).toBe(workspace.vectors[0].id)
    expect(saved.vectors[0].data).toEqual(fixtureData)
    expect(saved.camera).toEqual(workspace.camera)
    expect(saved.vectors[0].style.rules.map((rule: { condition: unknown }) => rule.condition)).toEqual([
      { property: 'value', operator: 'eq', value: 0 },
      { property: 'value', operator: 'eq', value: '0' },
      { property: 'value', operator: 'between', value: 5, upper: 10 },
    ])
    expect(await initialCanvas!.isVisible()).toBe(true)

    await page.reload()
    await expect(page.locator('[data-nechako-portal-map] canvas')).toBeVisible()
    const restoreDialog = await projects(page)
    await restoreDialog.getByRole('button', { name: 'Restore browser workspace', exact: true }).click()
    await restoreDialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Expand Map Tools', exact: true }).click()
    await library.locator('summary').first().click()
    await expect(library).toContainText('Default: point')
    await page.getByLabel('Drawing mode', { exact: true }).selectOption('Point')
    await page.getByRole('button', { name: 'Close Map Tools', exact: true }).click()
    await page.locator('[data-nechako-portal-map] canvas').click({ position: { x: 180, y: 120 } })
    await page.getByRole('button', { name: 'Expand Map Tools', exact: true }).click()
    await page.getByRole('button', { name: 'Finish drawing', exact: true }).click()
    await expect(page.getByLabel('Drawing mode', { exact: true })).toHaveValue('off')
    await library.getByRole('button', { name: 'Delete saved style', exact: true }).click()
    await expect(library).toContainText('0 matching saved styles')
    await page.getByRole('button', { name: 'Close Map Tools', exact: true }).click()
    const afterDefault = await exportWorkspace(page)
    expect(afterDefault.vectors[1].style).toEqual(saved.vectors[0].style)
    expect(afterDefault.vectors[0].style).toEqual(saved.vectors[0].style)
    expect(afterDefault.vectors[0].data).toEqual(fixtureData)

    await page.getByRole('button', { name: 'Expand Map Tools', exact: true }).click()
    await page.getByText('Style ' + layerName, { exact: true }).click()
    await editor.getByLabel('Style mode for ' + layerName, { exact: true }).selectOption('gradient')
    await editor.getByLabel('Gradient stop 1 value for ' + layerName, { exact: true }).fill('0')
    await editor.getByLabel('Gradient stop 1 color for ' + layerName, { exact: true }).fill('#ff0000')
    await editor.getByLabel('Gradient stop 2 value for ' + layerName, { exact: true }).fill('10')
    await editor.getByLabel('Gradient stop 2 color for ' + layerName, { exact: true }).fill('#0000ff')
    await editor.getByRole('button', { name: 'Apply style to layer', exact: true }).click()
    const sldDownloading = page.waitForEvent('download')
    await editor.getByRole('button', { name: 'Export SLD', exact: true }).click()
    const sld = readFileSync((await (await sldDownloading).path())!, 'utf8')
    expect(sld).toContain('<se:Interpolate')
    expect(sld).toContain('<se:WellKnownName>circle</se:WellKnownName>')
    await page.getByRole('button', { name: 'Close Map Tools', exact: true }).click()
    await assertMapColors(
      page,
      [
        [255, 0, 0],
        [128, 0, 128],
        [0, 0, 255],
        [255, 255, 0],
      ],
      testInfo,
      'numeric-gradient-map-' + width + '.png',
    )
    const afterGradient = await exportWorkspace(page)
    expect(afterGradient.vectors[0].data).toEqual(fixtureData)
    expect(afterGradient.vectors[0].style.mode).toBe('gradient')
    expect(afterGradient.vectors[0].style.stops).toEqual([
      { value: 0, color: '#ff0000' },
      { value: 10, color: '#0000ff' },
    ])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
    expect(unexpected).toEqual([])
  })
}

test('SLD browser parsing preserves typed round-trips and rejects unsupported or ambiguous semantics', async ({
  page,
}) => {
  await start(page)
  const result = await page.evaluate(async () => {
    const modulePath = '/src/maps/nechako/data/sldStyle.ts'
    const rulesPath = '/src/maps/nechako/data/vectorRules.ts'
    const { exportStyleSld, importStyleSld } = await import(/* @vite-ignore */ modulePath)
    const { DEFAULT_STYLE_SYMBOL } = await import(/* @vite-ignore */ rulesPath)
    const base = { ...DEFAULT_STYLE_SYMBOL, fillColor: '#ff0000', strokeWidth: 0, strokeOpacity: 0, pointOpacity: 0 }
    const style = {
      schema: 'nechako-vector-style-v1',
      geometry: 'point',
      mode: 'rules',
      base,
      rules: [0, '0', null, false, '', ' ', '\r', ' \r\n'].map((value, index) => ({
        id: 'typed-' + index,
        name: 'Typed ' + index,
        enabled: true,
        condition: { property: 'value', operator: 'eq', value },
        symbol: { ...base, fillColor: '#00ff00' },
      })),
    }
    const exported = exportStyleSld(style, 'A < B & "quoted"', 'point')
    const roundtrip = importStyleSld(exported)
    const numericData = {
      type: 'FeatureCollection',
      features: [0, 5, 10].map((value) => ({
        type: 'Feature',
        properties: { value },
        geometry: { type: 'Point', coordinates: [0, 0] },
      })),
    }
    const open =
      '<sld:StyledLayerDescriptor version="1.0.0" xmlns:sld="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"><sld:NamedLayer><sld:Name>External</sld:Name><sld:UserStyle><sld:Name>External</sld:Name><sld:FeatureTypeStyle>'
    const close = '</sld:FeatureTypeStyle></sld:UserStyle></sld:NamedLayer></sld:StyledLayerDescriptor>'
    const symbol =
      '<sld:PolygonSymbolizer><sld:Fill><sld:CssParameter name="fill">#123456</sld:CssParameter><sld:CssParameter name="fill-opacity">0</sld:CssParameter></sld:Fill><sld:Stroke><sld:CssParameter name="stroke">#abcdef</sld:CssParameter><sld:CssParameter name="stroke-width">0</sld:CssParameter></sld:Stroke></sld:PolygonSymbolizer>'
    const equality =
      '<ogc:PropertyIsEqualTo><ogc:PropertyName>value</ogc:PropertyName><ogc:Literal>0</ogc:Literal></ogc:PropertyIsEqualTo>'
    const range = (lower: number, upper: number) =>
      '<ogc:PropertyIsBetween><ogc:PropertyName>value</ogc:PropertyName><ogc:LowerBoundary><ogc:Literal>' +
      lower +
      '</ogc:Literal></ogc:LowerBoundary><ogc:UpperBoundary><ogc:Literal>' +
      upper +
      '</ogc:Literal></ogc:UpperBoundary></ogc:PropertyIsBetween>'
    const rule = (filter: string) => '<sld:Rule><ogc:Filter>' + filter + '</ogc:Filter>' + symbol + '</sld:Rule>'
    const external = open + rule(equality) + close
    const numeric = importStyleSld(external, numericData)
    const unspecified = importStyleSld(external)
    const disjoint = importStyleSld(open + rule(range(0, 5)) + rule(range(6, 10)) + close, numericData)
    const overlapping = open + rule(range(0, 5)) + rule(range(5, 10)) + close
    const single = { schema: 'nechako-vector-style-v1', geometry: 'point', mode: 'single', base }
    const singleXml = exportStyleSld(single, 'Circle', 'point')
    const tampered = importStyleSld(
      singleXml.replace('<sld:CssParameter name="fill">#ff0000', '<sld:CssParameter name="fill">#0000ff'),
    )
    const whitespaceXml = exportStyleSld({ ...style, rules: [style.rules[5]] }, 'Whitespace', 'point')
    const tamperedWhitespace = importStyleSld(
      whitespaceXml.replace('<ogc:Literal> </ogc:Literal>', '<ogc:Literal></ogc:Literal>'),
    )
    const gradient = {
      ...single,
      mode: 'gradient',
      property: 'value',
      channel: 'both',
      stops: [
        { value: 0, color: '#000000' },
        { value: 10, color: '#ffffff' },
      ],
    }
    const gradientXml = exportStyleSld(gradient, 'Gradient', 'point').replace(
      /<!--PGMapsStyleV1:[A-Za-z0-9+/=]+-->/,
      '',
    )
    const parsedGradient = importStyleSld(gradientXml, numericData)
    const unsupported = [
      overlapping,
      external.replace('value</ogc:PropertyName>', 'parent/value</ogc:PropertyName>'),
      external.replace(
        '<sld:PolygonSymbolizer>',
        '<sld:PolygonSymbolizer uom="http://www.opengeospatial.org/se/units/metre">',
      ),
      external
        .replace('<sld:PolygonSymbolizer>', '<sld:TextSymbolizer>')
        .replace('</sld:PolygonSymbolizer>', '</sld:TextSymbolizer>'),
      external.replace(
        '<sld:PolygonSymbolizer>',
        '<sld:MinScaleDenominator>1000</sld:MinScaleDenominator><sld:PolygonSymbolizer>',
      ),
      singleXml.replace('>circle</sld:WellKnownName>', '>square</sld:WellKnownName>'),
      '<!DOCTYPE sld [<!ENTITY secret SYSTEM "https://example.invalid/data">]>' + external,
    ].map((xml) => {
      const parsed = importStyleSld(xml, numericData)
      return {
        hasStyle: !!parsed.style,
        errors: parsed.diagnostics
          .filter((item: { severity: string }) => item.severity === 'error')
          .map((item: { message: string }) => item.message),
        originalPreserved: parsed.originalSld === xml,
      }
    })
    const mixed = importStyleSld(external, {
      ...numericData,
      features: [...numericData.features, { ...numericData.features[0], properties: { value: '0' } }],
    })
    return {
      style,
      roundtrip,
      numeric,
      unspecified,
      disjoint,
      tampered,
      tamperedWhitespace,
      parsedGradient,
      unsupported,
      mixed,
    }
  })
  expect(result.roundtrip.style).toEqual(result.style)
  expect(result.roundtrip.name).toBe('A < B & "quoted"')
  expect(result.numeric.style.rules[0].condition.value).toBe(0)
  expect(result.numeric.style.rules[0].symbol.fillOpacity).toBe(0)
  expect(result.numeric.style.rules[0].symbol.strokeWidth).toBe(0)
  expect(result.unspecified.style.rules[0].condition.value).toBe('0')
  expect(
    result.unspecified.diagnostics.some((item: { message: string }) => item.message.includes('no supplied data type')),
  ).toBe(true)
  expect(result.disjoint.style.rules).toHaveLength(2)
  expect(result.tampered.style.base.fillColor).toBe('#0000ff')
  expect(result.tampered.diagnostics.some((item: { message: string }) => item.message.includes('did not match'))).toBe(
    true,
  )
  expect(result.tamperedWhitespace.style.rules[0].condition.value).toBe('')
  expect(
    result.tamperedWhitespace.diagnostics.some((item: { message: string }) => item.message.includes('did not match')),
  ).toBe(true)
  expect(result.parsedGradient.style).toMatchObject({
    mode: 'gradient',
    property: 'value',
    channel: 'both',
    stops: [
      { value: 0, color: '#000000' },
      { value: 10, color: '#ffffff' },
    ],
  })
  for (const unsupported of result.unsupported) {
    expect(unsupported.hasStyle).toBe(false)
    expect(unsupported.errors.length).toBeGreaterThan(0)
    expect(unsupported.originalPreserved).toBe(true)
  }
  expect(result.mixed.style).toBeUndefined()
  expect(result.mixed.diagnostics.some((item: { message: string }) => item.message.includes('mixed types'))).toBe(true)
})

test('local style uploads require review and preserve unsupported originals', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const { errors, unexpected } = await start(page)
  const dialog = await projects(page)
  await dialog.getByLabel('Import portal project or workspace JSON', { exact: true }).setInputFiles({
    name: 'typed-style-workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(workspace)),
  })
  await expect(
    dialog.getByText('Workspace loaded. Native conversion warnings appear below.', { exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Expand Map Tools', exact: true }).click()
  const library = page.locator('[data-nechako-style-library]')
  await library.locator('summary').first().click()
  const original =
    '<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor version="1.0.0" xmlns:sld="http://www.opengis.net/sld"><sld:NamedLayer><sld:Name>Layer</sld:Name><sld:UserStyle><sld:Name>Imported circle</sld:Name><sld:Title>Résumé Δ</sld:Title><sld:FeatureTypeStyle><sld:Rule><sld:PointSymbolizer><sld:Graphic><sld:Mark><sld:WellKnownName>circle</sld:WellKnownName><sld:Fill><sld:CssParameter name="fill">#2266dd</sld:CssParameter><sld:CssParameter name="fill-opacity">1</sld:CssParameter></sld:Fill></sld:Mark><sld:Size>16</sld:Size></sld:Graphic></sld:PointSymbolizer></sld:Rule></sld:FeatureTypeStyle></sld:UserStyle></sld:NamedLayer></sld:StyledLayerDescriptor>'
  await library.getByLabel('Import local style', { exact: true }).setInputFiles({
    name: 'circle.sld',
    mimeType: 'application/vnd.ogc.sld+xml',
    buffer: Buffer.from(original),
  })
  await expect(library.getByRole('heading', { name: 'Review imported style', exact: true })).toBeVisible()
  await expect(library).toContainText('0 matching saved styles')
  await expect(library).toContainText('Target layer for import review: ' + layerName)
  await library.getByRole('button', { name: 'Save imported style', exact: true }).click()
  const imported = library
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Imported circle', exact: true }) })
  await expect(imported).toBeVisible()
  await imported.getByRole('button', { name: 'Apply saved style', exact: true }).click()
  await expect(library).toContainText('Saved style applied to ' + layerName)
  const downloading = page.waitForEvent('download')
  await imported.getByRole('button', { name: 'Download original style', exact: true }).click()
  expect(readFileSync((await (await downloading).path())!, 'utf8')).toBe(original)

  const unsupported = original
    .replace('Imported circle', 'Unsupported labels')
    .replace(/<sld:PointSymbolizer>.*?<\/sld:PointSymbolizer>/, '<sld:TextSymbolizer/>')
  await library.getByLabel('Import local style', { exact: true }).setInputFiles({
    name: 'labels.sld',
    mimeType: 'application/xml',
    buffer: Buffer.from(unsupported),
  })
  await expect(library.getByRole('alert')).toContainText('TextSymbolizer')
  await expect(library).toContainText('unsupported styling cannot be applied')
  await expect(library).toContainText('1 matching saved styles')
  await library.getByRole('button', { name: 'Save imported style', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('style-import-review-390.png'), fullPage: true })
  await library.getByRole('button', { name: 'Save imported style', exact: true }).click()
  const retained = library
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Unsupported labels', exact: true }) })
  await expect(retained.getByRole('button', { name: 'Apply saved style', exact: true })).toBeDisabled()
  await expect(retained.getByRole('button', { name: /^Default for/ })).toHaveCount(0)
  const unsupportedDownloading = page.waitForEvent('download')
  await retained.getByRole('button', { name: 'Download original style', exact: true }).click()
  expect(readFileSync((await (await unsupportedDownloading).path())!, 'utf8')).toBe(unsupported)
  await page.getByRole('button', { name: 'Close Map Tools', exact: true }).click()
  const exported = await exportWorkspace(page)
  expect(exported.vectors[0].data).toEqual(fixtureData)
  expect(exported.vectors[0].styleSource.original).toBe(original)
  expect(exported.vectors[0].style).toMatchObject({
    mode: 'single',
    geometry: 'point',
    base: { fillColor: '#2266dd', pointRadius: 8, pointOpacity: 1, strokeOpacity: 0 },
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
  expect(unexpected).toEqual([])
})
