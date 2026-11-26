import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildGeographicMapSvg, PAGE8_EDITION } from './geographic'
import glyphs from './fontGlyphs.generated.json'
import { lettering, type Glyph } from './lettering'
import { fontFormat, letteringFontFromBytes } from './letteringFont'
import {
  hatchRecipeFromSettings,
  hatchSettingsFromRecipe,
  mapThemeOptions,
  parseMapTheme,
  readMapTheme,
  writeMapTheme,
} from './mapTheme'
import { MAP_THEME_PRESETS } from './mapThemePresets'

const font = (path: string) => new Uint8Array(readFileSync(join('public', path)))
const preset = MAP_THEME_PRESETS.find((candidate) => candidate.id === 'page8-great-forest')!
const presetFonts = preset.fonts.map(({ fontPath, ...entry }) => ({ ...entry, bytes: font(fontPath) }))
const page8Theme = () => writeMapTheme({ ...preset.theme, fonts: presetFonts })

describe('fonts read at run time', () => {
  it('reads the same glyphs as the committed Great Forest outlines from the same font', () => {
    // The map's built-in lettering was outlined from these very files (fontGlyphs.generated.json).
    const pairs = [
      [letteringFontFromBytes(font(preset.fonts[0].fontPath)), 'smallcaps'],
      [letteringFontFromBytes(font(preset.fonts[1].fontPath), { capitalAlternates: true }), 'regular'],
    ] as const
    // The on-curve and control points; the notation differs (H/V, closing lines), not the shape.
    const points = (d: string) => {
      const found = new Set<string>()
      let [x, y] = [0, 0]
      for (const [, command, args] of d.matchAll(/([A-Z])([^A-Z]*)/g)) {
        const values = (args.match(/-?\d*\.?\d+/g) ?? []).map(Number)
        if (command === 'H') x = values[0]
        else if (command === 'V') y = values[0]
        else for (let i = 0; i + 1 < values.length; i += 2) [x, y] = [values[i], values[i + 1]]
        if (command !== 'Z') found.add(`${x},${y}`)
        if (command === 'Q' || command === 'C')
          for (let i = 0; i + 1 < values.length; i += 2) found.add(`${values[i]},${values[i + 1]}`)
      }
      return found
    }
    for (const [runtime, face] of pairs)
      for (const character of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        const read = runtime.glyph(character)!
        const committed = (glyphs[face].glyphs as Record<string, Glyph>)[character] as Glyph & { bounds: number[] }
        expect(read.advance).toBe(committed.advance)
        read.bounds!.forEach((value, index) => expect(Math.abs(value - committed.bounds[index])).toBeLessThan(0.05))
        // Every point of the committed outline is in the runtime one, which keeps a few more where
        // contours start (opentype.js leaves a contour's first point in; fontTools folds it).
        const mine = points(read.d)
        const missing = [...points(committed.d)].filter((point) => !mine.has(point))
        expect(missing).toEqual([])
      }
    // Lettered in the runtime font, a label fills the same box at the same scale.
    const box = [10, 20, 120, 18] as const
    const scale = (svg: string) => svg.match(/data-font-scale="([^"]+)"/)![1]
    expect(scale(lettering('KAMLOOPS', box, pairs[0][0]))).toBe(scale(lettering('KAMLOOPS', box)))
  })

  it('knows font files by their signature and refuses what it cannot read', () => {
    expect(fontFormat(font(preset.fonts[0].fontPath))).toBe('truetype')
    expect(fontFormat(strToU8('wOF2....'))).toBe('woff2')
    expect(fontFormat(strToU8('<svg>'))).toBeNull()
    expect(() => letteringFontFromBytes(strToU8('wOF2....'))).toThrow(/WOFF2/)
    expect(() => letteringFontFromBytes(strToU8('hello'))).toThrow(/not a TrueType/)
  })
})

describe('map theme files', () => {
  it('writes a ZIP that reads back to the same theme and fonts', async () => {
    const zip = await page8Theme()
    const members = unzipSync(zip)
    expect(Object.keys(members).sort()).toEqual(
      ['README.txt', 'theme.json', ...preset.fonts.map((entry) => entry.file)].sort(),
    )
    expect(new TextDecoder().decode(members['README.txt'])).toContain('SIL Open Font License')
    const { theme, fonts } = await readMapTheme(zip)
    expect(theme.name).toBe(preset.theme.name)
    expect(theme.map).toEqual(preset.theme.map)
    expect(theme.hatch).toEqual(preset.theme.hatch)
    expect(theme.lettering).toEqual(preset.theme.lettering)
    expect([...fonts.keys()]).toEqual(preset.fonts.map((entry) => entry.id))
    expect(theme.fonts.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true)
  })

  it('sets the map from a theme: the page 8 theme draws page 8, lettered from its own fonts', async () => {
    const options = mapThemeOptions(await readMapTheme(await page8Theme()))
    expect(options).toMatchObject({ coverage: 'page8', labelSet: 'page8', hatchStyle: 'patch', minIslandKm2: 1 })
    expect(options.lettering?.places?.name).toBe('Great Forest Small Caps')
    expect(options.lettering?.body?.src).toMatch(/^data:font\/ttf;base64,/)
    const svg = buildGeographicMapSvg(options)
    expect(svg).toContain('data-font="Great Forest Small Caps"')
    expect(svg).toContain("@font-face{font-family:'BC Sans'")
    expect(svg).toContain(`font-family="'BC Sans',Arial,sans-serif"`)
    // The same fonts as the built-in lettering: each label fills the same box at the same scale.
    const builtIn = buildGeographicMapSvg({ ...PAGE8_EDITION, minIslandKm2: 1, minLakeKm2: 2 })
    const fit = (text: string) =>
      text.match(/<g id="geo-label-vancouver"><g [^>]*data-ink-box="([^"]+)"[^>]*data-font-scale="([^"]+)"/)!.slice(1)
    expect(fit(svg)).toEqual(fit(builtIn))
  })

  it('refuses a theme whose font was swapped, is missing, or is not a font', async () => {
    const members = unzipSync(await page8Theme())
    const repack = (change: (files: Record<string, Uint8Array>) => void) => {
      const files = { ...members }
      change(files)
      return zipSync(files)
    }
    const places = preset.fonts[0].file
    await expect(readMapTheme(repack((files) => (files[places] = font(preset.fonts[1].fontPath))))).rejects.toThrow(
      /not the file the theme was saved with/,
    )
    await expect(readMapTheme(repack((files) => delete files[places]))).rejects.toThrow(/does not have it/)
    await expect(readMapTheme(repack((files) => delete files['theme.json']))).rejects.toThrow(/no theme.json/)
    await expect(readMapTheme(strToU8('not a zip'))).rejects.toThrow(/not a map theme ZIP/)
    await expect(readMapTheme(zipSync({ '../theme.json': strToU8('{}') }))).rejects.toThrow(/unsafe path/)
    await expect(
      writeMapTheme({
        ...preset.theme,
        fonts: [{ ...presetFonts[0], file: 'fonts/fake.ttf', bytes: strToU8('wOF2 nope') }],
      }),
    ).rejects.toThrow(/WOFF2/)
  })

  it('checks the JSON: known settings in range, and lettering that names an included font', () => {
    const valid = { ...preset.theme, fonts: [] as unknown[], lettering: {} }
    expect(parseMapTheme(valid).name).toBe(preset.theme.name)
    expect(() => parseMapTheme({ ...valid, lettering: { places: 'missing' } })).toThrow(/does not include/)
    expect(() => parseMapTheme({ ...valid, map: { ...valid.map, channelGap: 9 } })).toThrow(/map.channelGap/)
    expect(() => parseMapTheme({ ...valid, map: { ...valid.map, colour: 'red' } })).toThrow(/map/)
    expect(() => parseMapTheme({ ...valid, version: 2 })).toThrow(/version/)
    expect(() => parseMapTheme({ ...valid, hatch: { type: 'other' } })).toThrow(/hatch/)
  })

  it('keeps the workshop hatch settings through a recipe', () => {
    const contour = { seed: 4, spacing: 3.5, bandHeight: 15, strokeWidth: 1.2, curvature: 6 }
    const patch = { ...contour, patchSize: 120, lean: 10, leanBias: 2, seam: 0 }
    expect(hatchSettingsFromRecipe(hatchRecipeFromSettings('contour', contour, patch, '#bcc454'))).toEqual({
      hatchStyle: 'contour',
      hatch: contour,
    })
    expect(hatchSettingsFromRecipe(hatchRecipeFromSettings('patch', contour, patch, '#bcc454'))).toEqual({
      hatchStyle: 'patch',
      patchHatch: patch,
    })
  })
})
