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
