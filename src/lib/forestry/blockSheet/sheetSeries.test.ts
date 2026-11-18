import { unzipSync, strFromU8 } from 'fflate'
import { GState, jsPDF } from 'jspdf'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import type { SheetPicture } from '@/lib/mapSheet/sheetFormats'
import {
  DEFAULT_SHEET_OUTPUT,
  fillSeriesFields,
  fillSeriesTokens,
  MAX_SERIES_FILE_NAME_LENGTH,
  MAX_SHEET_SERIES_PAGES,
  parseSheetOutputSettings,
  pdfSeriesWriter,
  runSheetSeries,
  safeFileName,
  SERIES_NOTES_FILE,
  seriesContainer,
  seriesFileNames,
  seriesPages,
  uniqueFileNames,
  unfilledSeriesTokens,
  writeSheetSeries,
  zipSeriesWriter,
  type SheetSeriesBlock,
  type SheetSeriesWriter,
} from './sheetSeries'

const blocks: SheetSeriesBlock[] = [
  { id: 'c', name: 'Block 10', attributes: { CP: '412', licence: 'A12345', note: null } },
  { id: 'a', name: 'Block 2', attributes: { CP: '411', licence: 'A12345' } },
  { id: 'b', name: 'block 1', attributes: { CP: '411' } },
]
const jspdf = { jsPDF, GState }
const picture = (width: number, height: number): SheetPicture => ({
  width,
  height,
  ops: [
    { op: 'rect', x: 0, y: 0, w: width, h: height, fill: '#ffd37f' },
    {
      op: 'image',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      image: { kind: 'rgba', data: new Uint8ClampedArray(4).fill(200), width: 1, height: 1 },
    },
    { op: 'text', x: 10, y: 20, text: 'Sheet', size: 8, color: '#000000' },
  ],
})

describe('series pages', () => {
  it('keeps the tool order or sorts names as people read them', () => {
    expect(seriesPages(blocks).map((page) => page.id)).toEqual(['c', 'a', 'b'])
    const byName = seriesPages(blocks, { order: 'name' })
    expect(byName.map((page) => page.name)).toEqual(['block 1', 'Block 2', 'Block 10'])
    expect(byName.map((page) => [page.number, page.total])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('takes the chosen blocks only, each once, and ignores ids no longer listed', () => {
    const doubled = [...blocks, { id: 'a', name: 'Duplicate' }]
    expect(seriesPages(doubled, { selected: ['b', 'gone', 'a'] }).map((page) => page.name)).toEqual([
      'Block 2',
      'block 1',
    ])
    expect(seriesPages(blocks, { selected: [] })).toEqual([])
    expect(seriesPages(doubled, { selected: 'all' })).toHaveLength(3)
  })
})

describe('series tokens', () => {
  const [page] = seriesPages(blocks)
  it('fills the name, page, total and attributes', () => {
    expect(fillSeriesTokens('{name} ({page}/{total}) CP {attr:CP}, {ATTR:licence}', page)).toBe(
      'Block 10 (1/3) CP 412, A12345',
    )
    expect(fillSeriesTokens('{Name}', page)).toBe('Block 10')
  })

  it('leaves unknown tokens and missing attributes as typed, and blank attributes empty', () => {
    expect(fillSeriesTokens('{block} {attr:district} {attr:} {name', page)).toBe(
      '{block} {attr:district} {attr:} {name',
    )
    expect(fillSeriesTokens('[{attr:note}]', page)).toBe('[]')
    expect(unfilledSeriesTokens('{name}-{blok}-{attr:CP}-{attr:district}-{blok}', blocks)).toEqual([
      '{blok}',
      '{attr:district}',
    ])
  })

  it('fills every typed field of a page', () => {
    expect(fillSeriesFields({ blockId: '{name}', cuttingPermit: '{attr:CP}', forestLicence: 'A1' }, page)).toEqual({
      blockId: 'Block 10',
      cuttingPermit: '412',
      forestLicence: 'A1',
    })
  })
})

describe('series file names', () => {
  it('makes names safe on every file system', () => {
    expect(safeFileName('Block 12/A: "north"?', 'x')).toBe('Block-12-A-north')
    expect(safeFileName('..hidden..', 'x')).toBe('hidden')
    expect(safeFileName('CON', 'x')).toBe('CON_')
    expect(safeFileName('Bloc forêt Ünter', 'x')).toBe('Bloc-forêt-Ünter')
    expect(safeFileName('///', 'sheet-3')).toBe('sheet-3')
    expect(safeFileName('a'.repeat(300), 'x')).toHaveLength(MAX_SERIES_FILE_NAME_LENGTH)
  })

  it('numbers repeats so no page overwrites another', () => {
    expect(uniqueFileNames(['A', 'a', 'A', 'B'], 'png')).toEqual(['A.png', 'a-2.png', 'A-3.png', 'B.png'])
    const twins = seriesPages([
      { id: '1', name: 'Same' },
      { id: '2', name: 'Same' },
    ])
    expect(seriesFileNames('{name}', twins, 'svg')).toEqual(['Same.svg', 'Same-2.svg'])
    // An unknown token stays visible in the name, without its braces.
    expect(seriesFileNames('{name}-{nope}', twins, 'pdf')[0]).toBe('Same-nope.pdf')
    expect(seriesFileNames('  ', twins, 'pdf')[0]).toBe('1-Same.pdf')
  })
})

describe('output settings', () => {
  it('reads stored settings back, defaulting what it does not know', () => {
    expect(parseSheetOutputSettings(null)).toEqual(DEFAULT_SHEET_OUTPUT)
    expect(
      parseSheetOutputSettings({
        format: 'svg',
        series: true,
        blocks: ['a', 'a', 3],
        order: 'name',
        bundle: 'zip',
        mask: true,
      }),
    ).toEqual({
      ...DEFAULT_SHEET_OUTPUT,
      format: 'svg',
      series: true,
      blocks: ['a'],
      order: 'name',
      bundle: 'zip',
      mask: true,
    })
    expect(parseSheetOutputSettings({ format: 'tiff', blocks: 'some' })).toMatchObject({ format: 'pdf', blocks: 'all' })
  })

  it('bundles only PDF pages into one file', () => {
    expect(seriesContainer({ format: 'pdf', bundle: 'pdf' })).toBe('pdf')
    expect(seriesContainer({ format: 'pdf', bundle: 'zip' })).toBe('zip')
    expect(seriesContainer({ format: 'png', bundle: 'pdf' })).toBe('zip')
  })
})

describe('runSheetSeries', () => {
  const recorder = (): SheetSeriesWriter & { added: string[] } => {
    const added: string[] = []
    return {
      added,
      add: async (_page, _sheet, fileName) => {
        added.push(fileName)
      },
      finish: async () => new Blob(['done']),
    }
  }
  const pages = seriesPages(blocks)
  const names = seriesFileNames('{name}', pages, 'pdf')

  it('builds the pages in order, reporting progress and what each page lacked', async () => {
    const progress = vi.fn()
    const writer = recorder()
    const result = await runSheetSeries({
      pages,
      fileNames: names,
      build: async (page) => ({
        sheet: picture(100, 50),
        missing: page.id === 'a' ? ['No terrain under the block.'] : [],
      }),
      writer,
      onProgress: progress,
    })
    expect(writer.added).toEqual(['Block-10.pdf', 'Block-2.pdf', 'block-1.pdf'])
    expect(progress.mock.calls.map(([p]) => [p.done, p.page])).toEqual([
      [0, 'Block 10'],
      [1, 'Block 2'],
      [2, 'block 1'],
      [3, null],
    ])
    expect(result.written).toBe(3)
    expect(result.missing).toEqual([{ page: 'Block 2', sentences: ['No terrain under the block.'] }])
    expect(result.notes).toEqual(['Block 2: No terrain under the block.'])
  })

  it('leaves a failing page out by name and goes on', async () => {
    const writer = recorder()
    const result = await runSheetSeries({
      pages,
      fileNames: names,
      build: async (page) => {
        if (page.id === 'c') throw Error('Needs terrain under the block.')
        return { sheet: picture(100, 50), missing: [] }
      },
      writer,
    })
    expect(writer.added).toEqual(['Block-2.pdf', 'block-1.pdf'])
    expect(result.leftOut).toEqual([{ page: 'Block 10', reason: 'Needs terrain under the block.' }])
    expect(result.notes).toEqual(['Block 10 left out: Needs terrain under the block.'])
  })

  it('fails naming every page when none could be built', async () => {
    await expect(
      runSheetSeries({
        pages,
        fileNames: names,
        build: async () => {
          throw Error('No room for the logo.')
        },
        writer: recorder(),
      }),
    ).rejects.toThrow(/No sheet could be made\. Block 10: No room for the logo\. Block 2: .* block 1: /)
  })

  it('stops on Cancel, between pages or from inside one', async () => {
    const controller = new AbortController()
    const build = vi.fn(async () => {
      controller.abort()
      return { sheet: picture(100, 50), missing: [] }
    })
    await expect(
      runSheetSeries({ pages, fileNames: names, build, writer: recorder(), signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(build).toHaveBeenCalledTimes(1)
    const inside = vi.fn(async () => {
      throw new DOMException('Block sheet cancelled.', 'AbortError')
    })
    await expect(runSheetSeries({ pages, fileNames: names, build: inside, writer: recorder() })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(inside).toHaveBeenCalledTimes(1)
  })

  it('refuses an empty series and one over the page cap before building anything', async () => {
    const build = vi.fn()
    await expect(runSheetSeries({ pages: [], fileNames: [], build, writer: recorder() })).rejects.toThrow(
      /at least one block/,
    )
    const many = seriesPages(
      Array.from({ length: MAX_SHEET_SERIES_PAGES + 1 }, (_, i) => ({ id: `${i}`, name: `B${i}` })),
    )
    await expect(runSheetSeries({ pages: many, fileNames: [], build, writer: recorder() })).rejects.toThrow(
      new RegExp(`at most ${MAX_SHEET_SERIES_PAGES} sheets`),
    )
    expect(build).not.toHaveBeenCalled()
  })
})

describe('series files', () => {
  it('writes one PDF with a page a sheet, each its own size, set up once', async () => {
    const configurePdf = vi.fn(() => undefined)
    const sizes: [number, number][] = [
      [1224, 792],
      [612, 792],
      [1224, 792],
    ]
    const result = await writeSheetSeries({
      blocks,
      settings: { ...DEFAULT_SHEET_OUTPUT },
      build: async (page) => ({ sheet: picture(...sizes[page.number - 1]), missing: [] }),
      deps: { jspdf, configurePdf },
    })
    expect(result.container).toBe('pdf')
    expect(result.blob.type).toBe('application/pdf')
    const pdf = await PDFDocument.load(await result.blob.arrayBuffer())
    expect(pdf.getPageCount()).toBe(3)
    expect(pdf.getPages().map((page) => Object.values(page.getSize()).map(Math.round))).toEqual(sizes)
    expect(configurePdf).toHaveBeenCalledTimes(1)
  })

  it('writes a ZIP of PNGs named from the pattern, with a notes file for what was left out', async () => {
    const rasterise = vi.fn(async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
    const result = await writeSheetSeries({
      blocks,
      settings: { ...DEFAULT_SHEET_OUTPUT, format: 'png', order: 'name', fileName: '{page}-{attr:CP}-{name}' },
      build: async (page) => {
        if (page.id === 'a') throw Error('Needs a canopy height grid.')
        return { sheet: picture(100, 50), missing: [] }
      },
      deps: { rasterise },
    })
    expect(result.container).toBe('zip')
    const entries = unzipSync(new Uint8Array(await result.blob.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual(['1-411-block-1.png', '3-412-Block-10.png', SERIES_NOTES_FILE])
    expect(Array.from(entries['1-411-block-1.png'])).toEqual([137, 80, 78, 71])
    expect(strFromU8(entries[SERIES_NOTES_FILE])).toBe('Block 2 left out: Needs a canopy height grid.\n')
  })

  it('writes standalone SVGs and PDFs into a ZIP, and no notes file when there is nothing to say', async () => {
    for (const format of ['svg', 'pdf'] as const) {
      const writer = zipSeriesWriter(format, { jspdf })
      const result = await runSheetSeries({
        pages: seriesPages(blocks.slice(0, 2)),
        fileNames: seriesFileNames('{name}', seriesPages(blocks.slice(0, 2)), format),
        build: async () => ({ sheet: picture(100, 50), missing: [] }),
        writer,
      })
      const entries = unzipSync(new Uint8Array(await result.blob.arrayBuffer()))
      expect(Object.keys(entries)).toEqual([`Block-10.${format}`, `Block-2.${format}`])
      const head = strFromU8(entries[`Block-10.${format}`].slice(0, 5))
      expect(head).toBe(format === 'svg' ? '<?xml' : '%PDF-')
    }
    expect(() => pdfSeriesWriter({})).toThrow(/jsPDF/)
  })
})
