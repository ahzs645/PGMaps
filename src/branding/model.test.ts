import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { zipSync, strToU8 } from 'fflate'
import { brandArchive, importBrand } from './importBrand'
import {
  defaultBrandSettings,
  parseBrandProfile,
  parseBrandRecord,
  parseBrandSettings,
  pdfFontProblem,
  type BrandRecord,
} from './model'
import { brandHeader, brandLogoSvg, brandedHtml, brandVariables, fontCss } from './presentation'
import { configurePdfBrand, setPdfBrandFont } from './pdf'

const logo = (paint = '#0069A2') => ({
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><g fill="${paint}"><path d="M0 0H120V40H0Z"/></g></svg>`,
  viewBox: [0, 0, 120, 40],
})
function profile() {
  return {
    schema: 'brandkit/consumer-profile/1',
    id: 'test',
    name: 'Test brand',
    version: '1',
    colours: {
      ink: '#000000',
      paper: '#FFFFFF',
      primary: '#0069A2',
      muted: '#555555',
      light: '#EAF0F6',
      reverse: '#FFFFFF',
      line: '#CCCCCC',
      rule: '#000000',
    },
    typography: Object.fromEntries(
      ['body', 'heading', 'label'].map((role) => [
        role,
        { family: 'Test font', weight: 400, style: 'normal', fallback: 'Arial, sans-serif' },
      ]),
    ),
    logos: { primary: logo(), black: logo('#000000'), reverse: logo('#FFFFFF') },
    provenance: { source: 'Test source', status: 'Test reconstruction' },
  }
}
function record(): BrandRecord {
  return parseBrandRecord({ key: 'test', profile: profile(), fonts: [], notices: ['Test font licence'] })
}

describe('Brandkit handoff', () => {
  it('preserves supplied geometry and paints and rejects unknown schemas', () => {
    const p = profile()
    expect(parseBrandProfile(p).logos).toEqual(p.logos)
    expect(() => parseBrandProfile({ ...p, schema: 'brandkit/consumer-profile/2' })).toThrow('schema')
  })
  it.each([
    '<script>alert(1)</script>',
    '<image href="https://example.com/a"/>',
    '<foreignObject/>',
    '<path d="M0 0" onload="alert(1)"/>',
    '<path d="M0 0" fill="url(https://example.com/a)"/>',
    '<path d="M0 0" fill="currentColor"/>',
  ])('rejects active or external artwork: %s', (content) => {
    const p = profile()
    p.logos.primary.svg = p.logos.primary.svg.replace('<g fill="#0069A2">', content + '<g fill="#0069A2">')
    expect(() => parseBrandProfile(p)).toThrow()
  })
  it('rejects malformed geometry, mismatched bounds and invalid paints', () => {
    const p = profile()
    expect(() =>
      parseBrandProfile({ ...p, logos: { ...p.logos, primary: { ...p.logos.primary, viewBox: [0, 0, 999, 40] } } }),
    ).toThrow('viewBox')
    expect(() => parseBrandProfile({ ...p, colours: { ...p.colours, primary: 'url(x)' } })).toThrow('hex')
    p.logos.primary.svg = '<!DOCTYPE svg [<!ENTITY x "value">]>' + p.logos.primary.svg
    expect(() => parseBrandProfile(p)).toThrow('declarations')
  })
  it('keeps every surface and typography option independent and defaults PDF brand fonts off', () => {
    expect(defaultBrandSettings.selected).toBeNull()
    expect(defaultBrandSettings.pdfFonts).toBe(false)
    const settings = { ...defaultBrandSettings, selected: 'test', workspace: false, help: true, exports: false }
    expect(parseBrandSettings(settings)).toEqual(settings)
    expect(() => parseBrandSettings({ ...settings, exports: 'true' })).toThrow('true or false')
  })
  it('bounds ZIP expansion and rejects traversal before interpreting a pack', () => {
    expect(brandArchive(zipSync({ 'brand.json': strToU8('{}') })).has('brand.json')).toBe(true)
    expect(() => brandArchive(zipSync({ '../brand.json': strToU8('{}') }))).toThrow()
    expect(() => brandArchive(zipSync({ 'too-big': new Uint8Array(17 * 1024 * 1024) }))).toThrow('limit')
  })
  it('rejects an unsupported source schema before rendering or loading its fonts', async () => {
    const bytes = zipSync({
      'brand.json': strToU8(JSON.stringify({ id: 'future', name: 'Future', schema: 'brandkit/2' })),
    })
    const file = new File([bytes.slice().buffer as ArrayBuffer], 'future.zip')
    await expect(importBrand(file)).rejects.toThrow('Unsupported source brand schema')
  })
  it('snapshots selected artwork, fonts and notices into HTML without changing project text', () => {
    const brand = record(),
      html =
        '<html><head></head><body><div class="eyebrow">DDC Access · Resource road planning</div><h1>DDC Access project</h1></body></html>'
    expect(brandedHtml(html)).toBe(html)
    const result = brandedHtml(html, { brand, typography: true, pdfFonts: false })
    expect(result).toContain('Test brand · Resource road planning')
    expect(result).toContain('<h1>DDC Access project</h1>')
    expect(result).toContain('pgmaps-brand-snapshot')
    expect(result).toContain('Test font licence')
    expect(brandedHtml(result, { brand, typography: true, pdfFonts: false })).toBe(result)
  })
  it('does not allow font metadata to break out of an embedded stylesheet', () => {
    const brand = record()
    brand.fonts = [
      {
        family: '</style><script>alert(1)</script>',
        weight: 400,
        style: 'normal',
        file: 'font.ttf',
        dataUrl: 'data:font/ttf;base64,AAEAAAAA',
      },
    ]
    expect(fontCss(brand)).not.toContain('</style>')
  })
  it('keeps literal brand names and root paints in export artwork and honours print restrictions', () => {
    const brand = record()
    brand.profile.name = '$& Field team'
    const html = brandedHtml('<head></head><body><p class="eyebrow">DDC Access</p></body>', {
      brand,
      typography: false,
      pdfFonts: false,
    })
    expect(html).toContain('<p class="eyebrow">$&amp; Field team</p>')
    brand.profile.logos.primary.svg = brand.profile.logos.primary.svg.replace('<svg ', '<svg fill="#AABBCC" ')
    expect(brandLogoSvg(brand, 0, 0, 120, 40)).toContain('fill="#AABBCC"')
    brand.profile.identity = { minimumLogoWidthMm: 32, logo: { clearSpaceRatio: 0.2 } }
    expect(() => brandLogoSvg(brand, 0, 0, 20, 10)).toThrow('minimum')
    expect(brandHeader(brand)).not.toContain('max-height')
  })
  it('maps interface colours without changing the independent status colours', () => {
    const variables = brandVariables(record(), true)
    expect(variables['--primary']).toBeDefined()
    expect(variables['--danger']).toBeUndefined()
    expect(variables['--warning']).toBeUndefined()
    expect(variables['--muted']).not.toBe('#555555')
    expect(brandVariables(record(), true, true)['--muted']).toBe('#555555')
  })
  it('uses standard PDF fonts when opted out and refuses unavailable or CFF fonts when opted in', () => {
    const brand = record(),
      pdf = new jsPDF()
    expect(configurePdfBrand(pdf, { brand, typography: true, pdfFonts: false }).custom).toBe(false)
    expect(() => configurePdfBrand(pdf, { brand, typography: true, pdfFonts: true })).toThrow('does not include')
    brand.fonts = [
      { family: 'Test font', weight: 400, style: 'normal', file: 'font.otf', dataUrl: 'data:font/otf;base64,T1RUTw==' },
    ]
    expect(pdfFontProblem(brand)).toContain('OpenType')
  })
  it('embeds a real compatible TrueType font when the user opts in', () => {
    const brand = record(),
      pdf = new jsPDF()
    const data = readFileSync(new URL('../../vendor/brandkit/library/fonts/desktop/Inter-Regular.ttf', import.meta.url))
    brand.fonts = [
      {
        family: 'Test font',
        weight: 400,
        style: 'normal',
        file: 'font.ttf',
        dataUrl: 'data:font/ttf;base64,' + data.toString('base64'),
      },
    ]
    expect(pdfFontProblem(brand)).toBeNull()
    const fonts = configurePdfBrand(pdf, { brand, typography: true, pdfFonts: true })
    setPdfBrandFont(pdf, fonts)
    pdf.text('Test brand report', 10, 10)
    expect(pdf.getFont().fontName).toBe('pgmaps-brand-body')
    expect(pdf.output('arraybuffer').byteLength).toBeGreaterThan(10000)
  })
})
