import { describe, expect, it } from 'vitest'
import { DEFAULT_BLOCK_SHEET, type BlockSheetSettings } from './blockSheet'
import { createDemoProject } from './terrain'
import { createReportChapter, createRoadReportSettings } from './reportSettings'
import {
  applySheetSetup,
  createSheetSetup,
  describeSheetSetup,
  emptySheetSetupLibrary,
  MAX_SHEET_SETUPS,
  parseSheetSetup,
  parseSheetSetupLibrary,
  removeSheetSetup,
  saveSheetSetup,
  serializeSheetSetup,
  sheetSetupFilename,
  sheetSetupFromFile,
} from './sheetSetups'

const today = new Date(2026, 10, 10)
const plotBook = {
  ...createRoadReportSettings(),
  paper: 'tabloid' as const,
  chapters: [{ ...createReportChapter('plan-profile', 'pp'), horizontalScale: 1000 }],
  omittedSections: ['sections' as const],
}
const blockSheet: BlockSheetSettings = {
  ...DEFAULT_BLOCK_SHEET,
  kind: 'lidar-slope',
  paper: 'ansi-d',
  scale: 5000,
  block: 'context:block-7',
  fields: { forestLicence: 'A12345', cuttingPermit: '123' },
  comments: 'Gate at 4 km',
}

describe('sheet setups', () => {
  it('keeps the plot book and the block sheet, but never the block or its comments', () => {
    const setup = createSheetSetup('  Office   11 × 17 ', { plotBook, blockSheet }, today)
    expect(setup.name).toBe('Office 11 × 17')
    expect(setup.savedOn).toBe('2026-11-10')
    expect(setup.plotBook).toEqual(plotBook)
    expect(setup.blockSheet).toEqual({
      kind: 'lidar-slope',
      paper: 'ansi-d',
      scale: 5000,
      fields: { forestLicence: 'A12345', cuttingPermit: '123' },
      // How the sheet is written is an office standard; the blocks a series takes are not kept.
      output: { format: 'pdf', series: false, order: 'listed', fileName: '{page}-{name}', bundle: 'pdf', mask: false },
    })
    expect(JSON.stringify(setup)).not.toContain('block-7')
    expect(JSON.stringify(setup)).not.toContain('Gate')
    expect(describeSheetSetup(setup)).toEqual([
      'Plot book: Tabloid 11 × 17 in (ANSI B) landscape, 1 chapter; report leaves out 1 section',
      'Block sheet: LiDAR Design Slope, ANSI D 22 × 34 in, 1:5,000, 2 typed fields',
    ])
    expect(() => createSheetSetup('', { plotBook }, today)).toThrow(/1–80/)
    expect(() => createSheetSetup('x', {}, today)).toThrow(/no sheet setup/)
  })

  it('round-trips through its file and refuses one that is not a setup', () => {
    const setup = createSheetSetup('Mainline', { plotBook, blockSheet }, today)
    expect(sheetSetupFilename(setup)).toBe('Mainline.sheet-setup.json')
    expect(sheetSetupFromFile(serializeSheetSetup(setup))).toEqual(setup)
    expect(() => sheetSetupFromFile('not json')).toThrow(/not JSON/)
    expect(() => sheetSetupFromFile('{"schema":"other"}')).toThrow(/not a PG Maps sheet setup/)
    expect(() => parseSheetSetup({ ...setup, plotBook: { ...plotBook, paper: 'B5' } })).toThrow(/report paper/)
  })

  it("reads a project file's plot-book settings as a setup named after the project", () => {
    const project = { ...createDemoProject(), name: 'Tabor spur', reportSettings: plotBook }
    const setup = sheetSetupFromFile(JSON.stringify(project), today)
    expect(setup.name).toBe('Tabor spur plot book')
    expect(setup.plotBook).toEqual(plotBook)
    expect(setup.blockSheet).toBeUndefined()
    expect(() => sheetSetupFromFile(JSON.stringify(createDemoProject()))).toThrow(/no plot-book settings/)
  })

  it('applies each part it holds, keeping the block and comments of the project it is applied to', () => {
    const setup = createSheetSetup('Slope', { blockSheet }, today)
    const here: BlockSheetSettings = { ...DEFAULT_BLOCK_SHEET, block: 'reference:r1', comments: 'Here' }
    const applied = applySheetSetup(setup, { blockSheet: here })
    expect(applied.plotBook).toBeUndefined()
    expect(applied.blockSheet).toEqual({ ...blockSheet, block: 'reference:r1', comments: 'Here' })
  })

  it('keeps the format, series, file names and mask, never the blocks a series takes', () => {
    const output = {
      format: 'svg' as const,
      series: true,
      blocks: ['context:block-7', 'reference:r9'],
      order: 'name' as const,
      fileName: '{attr:CP}-{name}',
      bundle: 'zip' as const,
      mask: true,
    }
    const setup = createSheetSetup('Series', { blockSheet: { ...blockSheet, output } }, today)
    expect(setup.blockSheet?.output).toEqual({
      format: 'svg',
      series: true,
      order: 'name',
      fileName: '{attr:CP}-{name}',
      bundle: 'zip',
      mask: true,
    })
    expect(JSON.stringify(setup)).not.toContain('block-7')
    expect(JSON.stringify(setup)).not.toContain('r9')
    expect(sheetSetupFromFile(serializeSheetSetup(setup))).toEqual(setup)
    expect(describeSheetSetup(setup)[0]).toBe(
      'Block sheet: LiDAR Design Slope, ANSI D 22 × 34 in, 1:5,000, 2 typed fields, SVG (editable), one sheet per block, dimmed outside the block',
    )
    // Applied, it keeps the blocks this project's series takes.
    const here: BlockSheetSettings = {
      ...DEFAULT_BLOCK_SHEET,
      output: { ...DEFAULT_BLOCK_SHEET.output, blocks: ['context:here'] },
    }
    expect(applySheetSetup(setup, { blockSheet: here }).blockSheet?.output).toEqual({
      ...output,
      blocks: ['context:here'],
    })
    // A setup saved before the output was kept leaves the output as it is.
    const older = parseSheetSetup({
      ...JSON.parse(serializeSheetSetup(setup)),
      blockSheet: { kind: 'lidar-slope', paper: 'a3', scale: 'fit', fields: {} },
    })
    expect(older.blockSheet?.output).toBeUndefined()
    expect(applySheetSetup(older, { blockSheet: here }).blockSheet?.output).toEqual(here.output)
  })

  it('keeps a library of named setups, replacing one of the same name and dropping damaged entries', () => {
    let library = emptySheetSetupLibrary()
    library = saveSheetSetup(library, createSheetSetup('A', { plotBook }, today))
    library = saveSheetSetup(library, createSheetSetup('B', { blockSheet }, today))
    library = saveSheetSetup(library, createSheetSetup('a', { blockSheet }, today))
    expect(library.setups.map((s) => s.name)).toEqual(['a', 'B'])
    expect(library.setups[0].blockSheet).toBeDefined()
    const stored = JSON.parse(JSON.stringify(library))
    stored.setups.push({ schema: 'pgmaps-sheet-setup-v1', name: 'Broken', plotBook: { schema: 'nope' } })
    expect(parseSheetSetupLibrary(stored).setups.map((s) => s.name)).toEqual(['a', 'B'])
    expect(parseSheetSetupLibrary(null)).toEqual(emptySheetSetupLibrary())
    expect(removeSheetSetup(library, 'b').setups.map((s) => s.name)).toEqual(['a'])
    let full = emptySheetSetupLibrary()
    for (let i = 0; i < MAX_SHEET_SETUPS; i++)
      full = saveSheetSetup(full, createSheetSetup(`S${i}`, { plotBook }, today))
    expect(() => saveSheetSetup(full, createSheetSetup('One more', { plotBook }, today))).toThrow(/Delete one/)
    // Replacing one still works when the library is full.
    expect(saveSheetSetup(full, createSheetSetup('S3', { blockSheet }, today)).setups).toHaveLength(MAX_SHEET_SETUPS)
  })
})
