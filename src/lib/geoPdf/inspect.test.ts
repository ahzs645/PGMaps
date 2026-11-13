import { describe, expect, it } from 'vitest'
import * as runtime from 'pdfjs-dist/legacy/build/pdf.mjs'
import { canforPdfFixture } from '../../../tests/fixtures/canforPdf'
import { formatInspection, inspectPdf } from './inspect'
import { readGeoPdf } from './read'
import { CANFOR_PROFILE, type PdfTemplateProfile } from './profiles'

const limits = { maxFeatures: 500, maxVertices: 50_000 }

describe('map PDF inspection', () => {
  it('reports registration, painted layers, images with their masks, and legend swatches', async () => {
    const report = await inspectPdf(await canforPdfFixture({ raster: 'canopy' }), 'Synthetic.pdf', runtime as never)
    expect(report.profile).toBe(CANFOR_PROFILE.label)
    expect(report.frames[0]).toMatchObject({ page: 1, epsg: 3005 })
    expect(report.frames[0].metresPerPoint).toBeCloseTo(10, 0)
    const blocks = report.layers.find((l) => l.name === 'Blocks - 0k - 25k')!
    expect(blocks).toMatchObject({ strokedPaths: 1, filledPaths: 0, rule: 'Block outlines' })
    const reserves = report.layers.find((l) => l.name.startsWith('SU: Reserves'))!
    expect(reserves).toMatchObject({ strokedPaths: 0, filledPaths: 1, rule: 'Reserves' })
    expect(report.images).toHaveLength(1)
    expect(report.images[0]).toMatchObject({
      width: 4,
      height: 4,
      lossy: false,
      layers: ['Canopy Height - 9 Category'],
    })
    expect(report.images[0].filter).toMatch(/FlateDecode/)
    expect(report.images[0].mask).toMatchObject({ lossless: true })
    expect(report.images[0].mask!.alphaValues).toEqual(expect.arrayContaining([0, 255]))
    // The synthetic tile draws every legend colour plus one off-legend grey, and black under its transparent pixel.
    expect(report.images[0].colours!.drawn.join(' ')).toMatch(/#ff7f7f/)
    expect(report.images[0].colours!.drawn.join(' ')).toMatch(/#646464/)
    expect(report.swatches).toEqual(
      expect.arrayContaining([expect.objectContaining({ colour: '#ff7f7f', label: '5-10' })]),
    )
    expect(report.outsideText).toContain('Canopy Height (m)')
    const markdown = formatInspection(report)
    expect(markdown).toMatch(/## Layers/)
    expect(markdown).toMatch(/\| Blocks - 0k - 25k \|/)
  })

  it('reports an unregistered PDF instead of refusing it', async () => {
    const report = await inspectPdf(await canforPdfFixture({ registered: false }), 'Plain.pdf', runtime as never)
    expect(report.frames).toHaveLength(0)
    expect(report.notices.join(' ')).toMatch(/No usable map registration/)
    expect(report.layers.length).toBeGreaterThan(0)
  })
})

describe('company profiles', () => {
  const acme: PdfTemplateProfile = { ...CANFOR_PROFILE, id: 'acme-test', label: 'Acme · test template', rasters: [] }

  it('reads with whichever profile recognizes the PDF, and only that profile’s rasters', async () => {
    const bytes = await canforPdfFixture({ raster: 'canopy' })
    const result = await readGeoPdf(bytes, 'Acme.pdf', runtime, { ...limits, profiles: [acme] })
    expect(result.layers[0].source.profile).toBe('Acme · test template')
    expect(result.layers.some((l) => l.classGrid)).toBe(false)
    expect(result.layers.some((l) => l.name === 'Block outlines')).toBe(true)
  })

  it('names the supported profiles when none recognizes the PDF', async () => {
    const bytes = await canforPdfFixture({ raster: 'canopy' })
    const never: PdfTemplateProfile = { ...acme, matches: () => false }
    await expect(readGeoPdf(bytes, 'Other.pdf', runtime, { ...limits, profiles: [never] })).rejects.toThrow(
      /Supported: Acme · test template\./,
    )
  })

  it('finds legend swatches only with the profile’s geometry', async () => {
    const bytes = await canforPdfFixture({ raster: 'canopy' })
    // The synthetic legend's swatches are 12 points wide; a template drawing 20–40 point swatches has none.
    const wide: PdfTemplateProfile = { ...CANFOR_PROFILE, legend: { ...CANFOR_PROFILE.legend, swatchWidth: [20, 40] } }
    const result = await readGeoPdf(bytes, 'Wide.pdf', runtime, { ...limits, profiles: [wide] })
    expect(result.layers.some((l) => l.classGrid)).toBe(false)
    expect(result.notices.join(' ')).toMatch(/legend swatch/)
  })
})
