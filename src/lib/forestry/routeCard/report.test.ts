import { plainText } from 'document-kit'
import { compileRecipe, renderRecipe, sharedLibrary } from 'document-kit/recipe'
import { describe, expect, it } from 'vitest'

import { considerationFacts } from './facts'
import type { Planar } from './geometry'
import type { RouteCardMatch } from './query'
import { buildRouteCardReport, CONSIDERATION_RULES, type RouteCardKit } from './report'
import { routeCardSheet, type RouteCardRowState } from './results'
import { DEFAULT_ROUTE_CARD_PRESET } from './rows'

const kit: RouteCardKit = { compileRecipe, renderRecipe, sharedLibrary, plainText }

const square = (x: number, y: number, size: number): Planar => ({
  kind: 'polygon',
  polygons: [
    [
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
        [x, y],
      ],
    ],
  ],
})
// A made-up 400 m square block (16 ha).
const block = square(1_200_000, 900_000, 400)

const match = (props: Record<string, unknown>, shape: Planar, distanceMeters = 0, name = 'x'): RouteCardMatch => ({
  name,
  props,
  shape,
  distanceMeters,
})
const read = (
  answer: 'yes' | 'near' | 'no',
  names: string[] = [],
  matches: RouteCardMatch[] = [],
): RouteCardRowState => ({
  status: 'read',
  finding: {
    answer,
    names,
    nearNames: [],
    matches,
    alongAccess: [],
    nearestMeters: matches[0]?.distanceMeters ?? null,
    truncated: false,
  },
})

function made(
  states: Record<string, RouteCardRowState>,
  extra: Partial<Parameters<typeof considerationFacts>[0]> = {},
) {
  const subject = { id: 'b', name: 'Made-up 1', kind: 'block' as const, shape: block }
  const facts = considerationFacts({ subject, states, ...extra })
  const sheet = routeCardSheet(DEFAULT_ROUTE_CARD_PRESET, subject, states, extra.entries)
  return buildRouteCardReport(kit, {
    preset: DEFAULT_ROUTE_CARD_PRESET,
    sheet,
    facts,
    readAt: '2026-11-18',
    notes: ['A screen read live from DataBC, not a legal determination.'],
  })
}

const text = (report: ReturnType<typeof made>, id: string) => report.considerations.find((item) => item.id === id)?.text

describe('route card report', () => {
  it('compiles every consideration with its rule', () => {
    expect(CONSIDERATION_RULES.map((rule) => rule.id).sort()).toEqual(
      [...DEFAULT_ROUTE_CARD_PRESET.considerations].sort(),
    )
    const report = made({})
    expect(report.document.sections).toHaveLength(1)
  })

  it('writes Watershed only from what was read, never N for a layer not read', () => {
    expect(text(made({ 'fisheries-sensitive-watershed': read('no') }), 'watershed')).toBe(
      'Made-up 1 does not overlap any fisheries sensitive watersheds.',
    )
    const unread = made({})
    expect(text(unread, 'watershed')).toMatch(/\[fisheries sensitive watershed check/)
    expect(unread.toComplete.some((item) => /fisheries sensitive watershed/.test(item.what))).toBe(true)
  })

  it('calls for Visuals only when an EVQO polygon overlaps the block, and prints the page paragraph', () => {
    const visuals = { text: 'The southeastern portion of the block overlaps EVQO Modification.', drafted: true }
    expect(text(made({ evqc: read('near') }, { visuals }), 'visuals')).toBeUndefined()
    expect(made({ evqc: read('near') }, { visuals }).notCalledFor.map((item) => item.id)).toContain('visuals')
    expect(text(made({ evqc: read('yes', ['M']) }, { visuals }), 'visuals')).toBe(visuals.text)
  })

  it('writes Old Forest from the NDT, subzone, BEO and the guidebook table, and asks for the unit statement', () => {
    const report = made({
      ndt: read('yes', ['NDT1']),
      'landscape-unit': read(
        'yes',
        ['Madeup'],
        [match({ BIODIVERSITY_EMPHASIS_OPTION: 'Low' }, square(1_190_000, 890_000, 20_000))],
      ),
      'bec-subzone': read(
        'yes',
        ['ESSFwk 2'],
        [
          match(
            { ZONE: 'ESSF', SUBZONE: 'wk', VARIANT: '2', NATURAL_DISTURBANCE: 'NDT1' },
            square(1_190_000, 890_000, 20_000),
          ),
        ],
      ),
      'non-legal-ogma': read('yes', ['1'], [match({}, square(1_200_400, 900_000, 100))]),
      'cofa-non-legal-ogma': read(
        'yes',
        ['X'],
        [match({ NON_LEGAL_OGMA_PROVID: 'OGMA_1' }, square(1_200_400, 900_000, 100))],
      ),
    })
    const paragraph = text(report, 'old-forest')!
    expect(paragraph).toContain('Made-up 1 is located in NDT 1 (ESSFwk2) within the Madeup Landscape Unit.')
    expect(paragraph).toContain(
      'Within the Madeup LU, NDT 1 (ESSFwk2) has an old seral-stage (>250 years) retention target of greater than 19%.',
    )
    expect(paragraph).toContain('[how the unit meets its old forest objective]')
    expect(paragraph).toContain('outside the d-OGMA boundaries')
  })

  it('prints the reviewer’s own paragraph in place of the draft', () => {
    const report = made({ 'fisheries-sensitive-watershed': read('no') }, { own: { watershed: 'Our own words.' } })
    expect(report.considerations.find((item) => item.id === 'watershed')).toMatchObject({
      text: 'Our own words.',
      own: true,
    })
  })

  it('lists the fisher classes and bird rankings the reviewer entered, with the advice', () => {
    const report = made(
      { 'fisher-harvest-impact': { status: 'notPublic' }, 'migratory-bird-rankings': { status: 'notPublic' } },
      {
        entries: {
          'fisher-harvest-impact': {
            answer: 'yes',
            names: "'None', 'Caution: Harvest of this rare stand type is predicted to reduce.'",
          },
          'migratory-bird-rankings': { answer: 'yes', names: "'4', '5'" },
        },
      },
    )
    expect(text(report, 'fisher')).toMatch(
      /^Block overlaps fisher habitat 'caution' polygons developed by the BC Fisher Habitat Working Group\. If there are areas/,
    )
    expect(text(report, 'migratory-birds')).toBe(
      "Block overlaps with Migratory Bird Habitat Ranking '4' and '5'. Follow steps 4-14 in the SOP to eliminate, reduce, or mitigate incidental take.",
    )
  })

  it('names the side of a TAP remnant polygon and the road through it', () => {
    const access: Planar = {
      kind: 'line',
      lines: [
        [
          [1_199_000, 900_200],
          [1_200_000, 900_200],
        ],
      ],
    }
    const report = made(
      {
        'tap-remnant': read(
          'yes',
          ['50001'],
          [match({ REMNANT_OLD_ECOSYS_ID: 50001 }, square(1_199_500, 900_000, 500))],
        ),
      },
      { access },
    )
    const paragraph = text(report, 'tap-ogma')!
    expect(paragraph).toContain(
      'Proposed access road to the block goes through TAP remnant ecosystem polygon 50001 for about 500 m.',
    )
    expect(paragraph).toContain('Block boundary borders TAP - Remnant Old Ecosystem polygon 50001 to the west.')
  })

  it('works out the patch from the block and openings within 100 m', () => {
    const report = made(
      {
        ndt: read('yes', ['NDT2']),
        'opening-results': read('near', [], [match({ OPENING_ID: 9001 }, square(1_200_450, 900_000, 400), 50)]),
      },
      { inputs: { patchCurrentPercent: '37.8%', patchFutureTarget: '34.9%' } },
    )
    expect(text(report, 'patch-size')).toMatch(
      /^NDT2 - Currently, the proximity of Made-up 1 to other openings \(9001 - 16 ha\) would contribute to a small patch size of 32 ha \(0–40 ha\)\. Small patches in the NDT2 have a target of 30–40% and a current percentage of 37\.8% and a future target of 34\.9%\. \[patch size decision/,
    )
  })
})

describe('route card files', () => {
  it('writes the workbook at the route card tool’s own cells, and the Word file from the same render', async () => {
    const ExcelJS = await import('exceljs')
    const { writeDocx } = await import('document-kit/docx')
    const states = {
      district: read('yes', ['Made-up Natural Resource District']),
      'fisheries-sensitive-watershed': read('no'),
    }
    const report = made(states)
    const sheet = routeCardSheet(DEFAULT_ROUTE_CARD_PRESET, { name: 'Made-up 1', kind: 'block' }, states)
    const { routeCardWorkbook } = await import('./excel')
    const bytes = await routeCardWorkbook(
      { preset: DEFAULT_ROUTE_CARD_PRESET, sheet, considerations: report.considerations, notes: ['A note.'] },
      ExcelJS,
    )
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes)
    const card = workbook.getWorksheet('Route Card Tool Assessment')!
    expect(card.getCell('B2').value).toBe('Made-up 1')
    expect(card.getCell('B4').value).toBe('Operating Plan Summary')
    expect([card.getCell('B5').value, card.getCell('C5').value, card.getCell('D5').value]).toEqual([
      'District',
      'Y',
      "'Made-up Natural Resource District'",
    ])
    expect(card.getCell('C5').font.bold).toBe(true)
    // The tool's sheet ends with the RVQC row at 77.
    expect(card.getCell('B77').value).toBe('Recommended Visual Quality Code (RVQC)')
    expect(card.getCell('C77').value).toBe('Not read')
    expect(card.getCell('B54').value).toBe('Arch Sites')
    expect(card.getCell('C54').value).toBe('Not public')
    const other = workbook.getWorksheet('Other Considerations')!
    expect(other.getCell('B2').value).toBe('Old Forest')
    const watershedRow = report.considerations.findIndex((item) => item.id === 'watershed') + 2
    expect(other.getCell(`C${watershedRow}`).value).toBe(
      'Made-up 1 does not overlap any fisheries sensitive watersheds.',
    )
    const docx = await writeDocx(report.document)
    expect(docx.byteLength).toBeGreaterThan(5_000)
    // No per-paragraph status notes beside the paragraphs: the provenance is on the Notes sheet.
    expect(other.getCell('D2').value).toBeNull()
    expect(workbook.getWorksheet('Notes')!.getCell('B4').value).toBe('A note.')
  })

  it('puts each figure under its paragraph, in its row, in both files', async () => {
    const ExcelJS = await import('exceljs')
    const { routeCardWorkbook } = await import('./excel')
    // A 1 × 1 PNG.
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0),
    )
    const figures = [
      {
        consideration: 'watershed' as const,
        caption: 'A map.',
        bytes: png,
        format: 'png' as const,
        width: 4,
        height: 3,
      },
    ]
    const states = { 'fisheries-sensitive-watershed': read('no') }
    const subject = { id: 'b', name: 'Made-up 1', kind: 'block' as const, shape: block }
    const sheet = routeCardSheet(DEFAULT_ROUTE_CARD_PRESET, subject, states)
    const report = buildRouteCardReport(kit, {
      preset: DEFAULT_ROUTE_CARD_PRESET,
      sheet,
      facts: considerationFacts({ subject, states }),
      readAt: '2026-11-18',
      notes: [],
      figures,
    })
    const blocks = report.document.sections[0].body
    const part = blocks.findIndex((entry) => entry.type === 'heading' && JSON.stringify(entry).includes('Watershed'))
    expect(blocks.slice(part, part + 4).some((entry) => entry.type === 'figure')).toBe(true)
    const bytes = await routeCardWorkbook(
      { preset: DEFAULT_ROUTE_CARD_PRESET, sheet, considerations: report.considerations, notes: [], figures },
      ExcelJS,
    )
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes)
    const other = workbook.getWorksheet('Other Considerations')!
    const images = other.getImages()
    expect(images).toHaveLength(1)
    const row = report.considerations.findIndex((item) => item.id === 'watershed') + 2
    expect(images[0].range.tl.nativeRow).toBe(row - 1)
    expect(images[0].range.tl.nativeCol).toBe(2)
  })
})
