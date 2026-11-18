import { describe, expect, it } from 'vitest'
import { parseTools, serializeTools } from './assessmentTools'
import { emptyProjectMedia, openProjectArchive, writeProjectArchive } from './projectArchive'
import { createEmptyScene } from './scene'
import {
  importReferenceCase,
  mergeReferences,
  parseReferenceRows,
  referenceArithmetic,
  referenceClass,
} from './referenceMeasurements'

// Made-up cases: real assessments, their names and figures stay outside the repository.
const original = 'A Example block - VIA page 03.jpg'
const context = { views: [{ id: 'case-a-view-1', name: 'VP1 · null' }], landforms: [], attachments: [original] }
const caseA = {
  id: 'case-a',
  doc: 'A',
  pages: { VP1: 3 },
  reference: [
    {
      viewpoint: 'VP1',
      landform: 'VLU (gross, rock NOT removed from denominator)',
      percent: 12.4,
      numerator: 25,
      denominator: 200,
      unit: 'cm2',
      method: 'polygons measured on gridded photo (on-image key)',
      existingIncluded: true,
      proposedCm2: 20,
      existingNonVegCm2: 5,
      rockCm2: 40,
      netVluCm2: 160,
      percentOfNetVlu: 15.6,
      rating: null,
    },
  ],
}
describe('historical reference measurements', () => {
  it('keeps the gross percentage, the rock deduction and the net calculation on their own bases', () => {
    const [row] = importReferenceCase(caseA, context)
    expect(row).toMatchObject({
      viewId: 'case-a-view-1',
      landformId: '',
      printed: { source: original, page: '3', unit: 'cm2', percent: '12.4', netComparison: '15.6' },
    })
    const check = referenceArithmetic(row.printed)
    expect(check.percentage).toBeCloseTo(12.5, 3)
    expect(check.difference).toBeCloseTo(0.1, 3)
    expect(check.netArea).toBeCloseTo(160)
    expect(check.netPercentage).toBeCloseTo(15.625, 3)
    expect(check.componentArea).toBeCloseTo(25)
    const edited = { ...row, corrections: { denominator: '250', deduction: '30' } }
    expect(referenceArithmetic({ ...row.printed, ...edited.corrections }).percentage).toBeCloseTo(10)
    expect(mergeReferences([edited], [row])).toEqual([edited])
  })

  it('keeps zero, incomplete and ocular-only measurements distinct', () => {
    expect(referenceArithmetic({ numerator: '0', denominator: '20' }).percentage).toBe(0)
    for (const denominator of ['', '0', '-5', '4 hectares', 'NaN'])
      expect(referenceArithmetic({ numerator: '0', denominator }).percentage).toBeNull()
    expect(referenceArithmetic({ rating: 'R' }).percentage).toBeNull()
    expect(referenceArithmetic({ proposedPercent: '2.5', existingPercent: '0' }).componentPercentage).toBe(2.5)
    expect(referenceArithmetic({ gross: '2', deduction: '3' }).netArea).toBeNull()
  })

  it('preserves sub-landform sheet links and only rates explicitly transcribed ranges', () => {
    const source = 'B Example landform - VIA.pdf'
    const [a, b] = importReferenceCase(
      {
        id: 'case-b',
        doc: 'B',
        appendixPageOffset: 22,
        method: 'Thresholds quoted: R 0-1.5%, PR 1.6-7%.',
        reference: ['Landform 1a', 'Landform 1b'].map((landform) => ({
          viewpoint: 'VP03',
          landform,
          sheet: 'Appendix A10',
          numerator: 0,
          denominator: 10,
          unit: 'px',
        })),
      },
      { ...context, attachments: [source] },
    )
    expect(a.id).not.toBe(b.id)
    expect(b.printed).toMatchObject({ source, page: '32', landform: 'Landform 1b', numerator: '0' })
    expect(referenceClass(a.printed.rule, 1.55)).toBeNull()
    expect(referenceClass(a.printed.rule, 1.6)).toBe('PR')
    expect(referenceClass(undefined, 2)).toBeNull()
    expect(referenceClass('Table 3', 2)).toBeNull()
    expect(referenceClass('R 0-1.5%, PR 1.5-7%', 1.5)).toBeNull()
    expect(() => parseReferenceRows([a, a])).toThrow('duplicate')
    expect(parseReferenceRows(undefined)).toEqual([])
    // A field from a newer file is left out and named, never the row or the workspace.
    const dropped: string[] = []
    const [kept] = parseReferenceRows(
      [{ ...a, printed: { ...a.printed, laterField: 'x' }, useSource: ['percent', 'laterField'] }],
      dropped,
    )
    expect(kept.printed).toEqual(a.printed)
    expect(kept.useSource).toEqual(['percent'])
    expect(dropped).toEqual(['laterField'])
  })

  it('opens an attached case, then saves and reopens the edited workspace and original sheets together', async () => {
    const media = {
      ...emptyProjectMedia(),
      attachments: [
        { name: 'case.json', blob: new Blob([JSON.stringify(caseA)]) },
        { name: original, blob: new Blob(['original sheet']) },
      ],
    }
    const state = {
      scene: createEmptyScene(),
      workspace: null,
      views: [],
      shelved: [],
      images: {},
      capturedBefore: {},
      engineFigures: {},
      pkg: { renderer: null, recipeId: null },
    }
    const opened = await openProjectArchive(await writeProjectArchive(state, media))
    const ws = parseTools(JSON.parse(opened.state.workspace!))
    ws.referenceMeasurements[0].corrections = { numerator: '32', rating: '' }
    ws.referenceMeasurements[0].viewId = 'reviewed-view'
    const reopened = await openProjectArchive(
      await writeProjectArchive({ ...opened.state, workspace: serializeTools(ws) }, opened.media),
    )
    expect(parseTools(JSON.parse(reopened.state.workspace!)).referenceMeasurements).toEqual(ws.referenceMeasurements)
    expect(reopened.media.attachments.map((f) => f.name)).toEqual(['case.json', original])
    expect(await reopened.media.attachments[0].blob.text()).toBe(JSON.stringify(caseA))
    expect(reopened.state.scene.targets).toEqual([])
    const bad = await openProjectArchive(
      await writeProjectArchive(state, { ...media, attachments: [{ name: 'case.json', blob: new Blob(['{bad']) }] }),
    )
    expect(bad.summary.dropped[0]).toContain('case.json')
    expect(bad.media.attachments).toHaveLength(1)
    expect(bad.state.workspace).toBeNull()
  })
})
