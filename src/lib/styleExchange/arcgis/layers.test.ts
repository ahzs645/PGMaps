import { describe, expect, it } from 'vitest'
import { PAPER_SIZES, SHEET_TEMPLATES, type PaperId } from '@/lib/mapSheet/layout'
import { FIXTURE_DOCUMENT, FIXTURE_LAYOUT } from '../fixtures'
import { STYLE_EXCHANGE_SCHEMA, type StyleDocument } from '../model'
import { arcgisLayerFiles, relativeDatabase, rulesExpression } from './lyrx'
import { arcgisMapx } from './mapx'
import { arcgisPagx } from './pagx'
import { parseRulesExpression, readArcgisFile } from './read'
import { canonicalLayer } from './testCanonical'

const json = (content: string | Uint8Array) => JSON.parse(String(content)) as Record<string, unknown>
const fixtureLayers = FIXTURE_DOCUMENT.layers.map(canonicalLayer)

describe('ArcGIS Pro layer files', () => {
  it('writes one .lyrx per layer reading its shapefile by a relative path', () => {
    const { files } = arcgisLayerFiles(FIXTURE_DOCUMENT)
    expect(files.map((f) => f.path)).toEqual(FIXTURE_DOCUMENT.layers.map((l) => `${l.id}.lyrx`))
    const doc = json(files[2].content)
    expect(doc).toMatchObject({ type: 'CIMLayerDocument', layers: ['CIMPATH=map/road_centrelines.json'] })
    const layer = (doc.layerDefinitions as Record<string, unknown>[])[0]
    expect((layer.featureTable as Record<string, unknown>).dataConnection).toEqual({
      type: 'CIMStandardDataConnection',
      workspaceConnectionString: 'DATABASE=.\\data',
      workspaceFactory: 'Shapefile',
      dataset: 'road_centrelines.shp',
      datasetType: 'esriDTFeatureClass',
    })
    expect(relativeDatabase('.')).toBe('DATABASE=.')
    expect(relativeDatabase('out/data/')).toBe('DATABASE=.\\out\\data')
  })

  it('picks the renderer that keeps first match', () => {
    const renderers = arcgisLayerFiles(FIXTURE_DOCUMENT).files.map(
      (f) => (json(f.content).layerDefinitions as Record<string, Record<string, unknown>>[])[0].renderer,
    )
    expect(renderers.map((r) => r.type)).toEqual([
      'CIMUniqueValueRenderer',
      'CIMUniqueValueRenderer',
      'CIMUniqueValueRenderer',
      'CIMUniqueValueRenderer',
    ])
    expect(renderers[0].fields).toEqual(['SHEET_KEY'])
    expect(renderers[2].valueExpressionInfo).toMatchObject({
      type: 'CIMExpressionInfo',
      expression:
        'When($feature["NAME"] == "Main line", "0", Includes(["Spur A", "Spur B\'s"], $feature["NAME"]), "1", TypeOf($feature["MAXGRADE"]) == "Number" && $feature["MAXGRADE"] >= 12, "2", null)',
    })
  })

  it('reads every fixture layer back from its .lyrx', () => {
    const { files } = arcgisLayerFiles(FIXTURE_DOCUMENT)
    const read = files.map((file) => readArcgisFile(file.path, file.content))
    for (const result of read) expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(read.map((r) => canonicalLayer(r.layers[0]))).toEqual(fixtureLayers)
  })

  it('parses the rule expression it writes, quotes and backslashes included', () => {
    const filters = [
      { field: 'NAME', op: 'eq' as const, value: 'He said "hi" \\ ok' },
      { field: 'N', op: 'in' as const, values: [1, 2.5, -3] },
      { field: 'OK', op: 'eq' as const, value: true },
      { field: 'G', op: 'range' as const, max: 4 },
      { field: 'G', op: 'range' as const },
    ]
    expect(parseRulesExpression(rulesExpression(filters))).toEqual({ filters, keys: ['0', '1', '2', '3', '4'] })
    expect(parseRulesExpression('When($feature.A > 3, "0", null)')).toBeNull()
  })

  it('writes ranges that touch as class breaks, one float below each end, and reads them back exactly', () => {
    const symbol = FIXTURE_DOCUMENT.layers[2].rules[0].symbol
    const doc: StyleDocument = {
      schema: STYLE_EXCHANGE_SCHEMA,
      name: 'Grades',
      layers: [
        {
          id: 'grades',
          name: 'Grades',
          geometry: 'line',
          fields: [{ name: 'GRADE', type: 'number' }],
          rules: [
            { label: 'Flat', filter: { field: 'GRADE', op: 'range', max: 4 }, symbol },
            { label: 'Moderate', filter: { field: 'GRADE', op: 'range', min: 4, max: 10 }, symbol },
            { label: 'Steep', filter: { field: 'GRADE', op: 'range', min: 10 }, symbol },
          ],
        },
      ],
    }
    const written = arcgisLayerFiles(doc)
    expect(written.diagnostics.map((d) => d.severity)).toEqual(['info'])
    const renderer = (json(written.files[0].content).layerDefinitions as Record<string, Record<string, unknown>>[])[0]
      .renderer
    expect(renderer).toMatchObject({ type: 'CIMClassBreaksRenderer', field: 'GRADE', useDefaultSymbol: false })
    const bounds = (renderer.breaks as { upperBound: number }[]).map((b) => b.upperBound)
    expect(bounds[0]).toBeLessThan(4)
    expect(bounds[0]).toBe(3.9999999999999996)
    expect(bounds[2]).toBe(Number.MAX_VALUE)
    expect(renderer.minimumBreak).toBe(-Number.MAX_VALUE)
    const read = readArcgisFile('grades.lyrx', written.files[0].content)
    expect(read.layers[0].rules.map((r) => r.filter)).toEqual(doc.layers[0].rules.map((r) => r.filter))
    expect(read.diagnostics).toEqual([])
  })
})

describe('ArcGIS Pro map and layout files', () => {
  it('writes a map in BC Albers listing layers top first, and reads it back', () => {
    const { files } = arcgisMapx(FIXTURE_DOCUMENT)
    expect(files[0].path).toBe('Fixture-road-project.mapx')
    const map = json(files[0].content).mapDefinition as Record<string, unknown>
    expect(map.spatialReference).toEqual({ wkid: 3005, latestWkid: 3005 })
    expect(map.layers).toEqual(
      [...FIXTURE_DOCUMENT.layers].reverse().map((l) => `CIMPATH=fixture-road-project/${l.id}.json`),
    )
    const extent = map.defaultExtent as Record<string, number>
    expect(extent.xmin).toBeLessThan(extent.xmax)
    const read = readArcgisFile(files[0].path, files[0].content)
    expect(read.format).toBe('mapx')
    expect(read.layers.map(canonicalLayer)).toEqual(fixtureLayers)
    expect(json(arcgisMapx(FIXTURE_DOCUMENT, { wkid: 3857 }).files[0].content).mapDefinition).toMatchObject({
      spatialReference: { wkid: 102100, latestWkid: 3857 },
    })
  })

  it('writes the fixture layout with its map inside and reads the sheet back', () => {
    const { files } = arcgisPagx(FIXTURE_LAYOUT, FIXTURE_DOCUMENT)
    const doc = json(files[0].content)
    const layout = doc.layoutDefinition as Record<string, unknown>
    expect(layout.page).toMatchObject({ width: 17, height: 11, units: { uwkid: 109008 } })
    const types = (layout.elements as Record<string, unknown>[]).map((e) => e.type)
    for (const type of ['CIMMapFrame', 'CIMLegend', 'CIMScaleLine', 'CIMMarkerNorthArrow', 'CIMGraphicElement'])
      expect(types).toContain(type)
    const arrow = (layout.elements as Record<string, unknown>[]).find((e) => e.type === 'CIMMarkerNorthArrow')!
    expect(JSON.stringify(arrow)).not.toMatch(/CIMCharacterMarker|fontFamilyName/)
    expect((doc.mapDefinitions as unknown[]).length).toBe(1)

    const read = readArcgisFile(files[0].path, files[0].content)
    expect(read.layers.map(canonicalLayer)).toEqual(fixtureLayers)
    const back = read.layouts[0]
    expect(back).toMatchObject({
      name: FIXTURE_LAYOUT.name,
      paper: 'tabloid',
      title: FIXTURE_LAYOUT.title,
      subtitle: FIXTURE_LAYOUT.subtitle,
      scale: 10000,
    })
    expect(back.template).toEqual(FIXTURE_LAYOUT.template)
    // The frame shows the sheet's scale round the extent's centre.
    const [w, s, e, n] = back.extent!
    const [fw, fs, fe, fn] = FIXTURE_LAYOUT.extent!
    expect((w + e) / 2).toBeCloseTo((fw + fe) / 2, 4)
    expect((s + n) / 2).toBeCloseTo((fs + fn) / 2, 4)
  })

  it.each(
    SHEET_TEMPLATES.flatMap((template) => (Object.keys(PAPER_SIZES) as PaperId[]).map((paper) => [template.id, paper])),
  )('reads the %s template on %s back to the same fractions', (id, paper) => {
    const template = SHEET_TEMPLATES.find((t) => t.id === id)!
    const layout = { ...FIXTURE_LAYOUT, template, paper: paper as PaperId }
    const read = readArcgisFile('sheet.pagx', arcgisPagx(layout, FIXTURE_DOCUMENT).files[0].content)
    expect(read.layouts[0].paper).toBe(paper)
    expect(read.layouts[0].template).toEqual(template)
  })
})
