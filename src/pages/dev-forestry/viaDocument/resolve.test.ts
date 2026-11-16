import { describe, expect, it } from 'vitest'

import { VIA_STYLE_PRESETS } from '@/lib/forestry/viaFigure/presets'

import { T4, T5, VIA_DOCUMENT_FORMATS, formatForSource } from './formats'
import {
  blockList,
  chooseKeyViewpoints,
  landformParentFromName,
  significanceScore,
  normalizeBlock,
  otherPlannedName,
  resolveViaDocument,
  type DocumentViewpoint,
} from './resolve'
import { PERCENT_SCALES, readPercent, scaleTerm } from './scales'
import { fillSentence } from './wording'

// Fixtures carry the reference documents' printed areas and figures (by document number); names are placeholders.
const vp = (over: Partial<DocumentViewpoint>): DocumentViewpoint => ({
  name: 'Viewpoint A',
  landform: 'Landform 1',
  objective: 'PR',
  areas: null,
  sightlinePercent: null,
  distanceKm: null,
  blocks: [],
  ...over,
})

const text = (sentences: { id: string; text: string | null }[], id: string) =>
  sentences.find((s) => s.id === id)?.text ?? null

describe('VIA document formats', () => {
  it('cover every BC reference format, each with its own style and rule', () => {
    for (const doc of ['02', '03', '04', '05', '06', '07', '09', '11', '12', '13', '14', '15', '22', '23'])
      expect(formatForSource(doc), doc).not.toBeNull()
    const styles = new Set(VIA_STYLE_PRESETS.map((preset) => preset.id))
    for (const format of VIA_DOCUMENT_FORMATS) {
      if (format.style) expect(styles.has(format.style), format.id).toBe(true)
      for (const recipe of format.recipes) if (recipe.style) expect(styles.has(recipe.style), recipe.id).toBe(true)
      // The analysis image's style prints the same arithmetic the document reads.
      const preset = VIA_STYLE_PRESETS.find((p) => p.id === format.style)
      if (preset?.calc?.rule) expect(preset.calc.rule.deduct, format.id).toEqual(format.rule.deduct)
    }
  })
})

describe('scales read figures as the documents do', () => {
  it('size words (22, 23)', () => {
    expect(scaleTerm(PERCENT_SCALES.sizeWords, 0)).toBe('Very Small')
    expect(scaleTerm(PERCENT_SCALES.sizeWords, 0.32)).toBe('Small')
    expect(scaleTerm(PERCENT_SCALES.sizeWords, 2.59)).toBe('Small to Medium')
  })

  it('strict and inclusive bounds part at the boundary', () => {
    expect(readPercent(PERCENT_SCALES.handbookTable2, 1.5)?.code).toBe('R')
    expect(readPercent(PERCENT_SCALES.guidebookStrict, 1.5)?.code).toBe('PR')
    expect(readPercent(PERCENT_SCALES.handbookTable2, 7.78)?.code).toBe('M')
  })
})

describe('resolving a document from one assessment', () => {
  it('22: net-of-private figure, size term and the all-hidden row', () => {
    const doc = resolveViaDocument(formatForSource('22')!, {
      project: 'the proposed blocks',
      viewpoints: [
        vp({
          areas: { landform: 166538, privateLand: 57419, proposed: 0, nonVeg: 0 },
          blocks: [
            { id: 'X1', status: 'not visible', visiblePercent: 0 },
            { id: 'X2', status: 'not visible', visiblePercent: 0 },
          ],
          distanceKm: 2.1,
        }),
        vp({
          name: 'Viewpoint B',
          areas: { landform: 120991, privateLand: 42763, proposed: 255, nonVeg: 0 },
          blocks: [{ id: 'X1', status: 'visible', visiblePercent: 40 }],
          distanceKm: 2.0,
        }),
      ],
    })
    const [hidden, seen] = doc.viewpoints
    expect(hidden.printed).toMatchObject({ percent: '0.00', term: 'Very Small' })
    expect(hidden.rows['initial-assessment'][0]).toMatchObject({
      [T4.blocks]: 'None visible',
      [T4.visibility]: 'Not easily distinguishable',
      [T4.design]: 'Natural / No visible alteration',
    })
    // X1 is seen from Viewpoint B, so it is discussed there; X2, seen from nowhere, is said so once.
    expect(text(hidden.sentences, 'not-visible')).toContain('Block X2 is not expected to be visible')
    expect(hidden.sentences.some((s) => s.about === 'Block X1')).toBe(false)
    expect(text(seen.sentences, 'key-viewpoint')).toBe(
      'The Viewpoint B viewpoint is the only one assessed that sees the block (40% of its ground in view), so the block is assessed from there.',
    )
    // 0.326% rounds to 0.33 (the document truncated to 0.32), read as Small.
    expect(seen.printed).toMatchObject({ percent: '0.33', term: 'Small' })
    expect(text(seen.sentences, 'scale')).toBe(
      'The scale of the alteration is small relative to the landform (0.33% alteration).',
    )
    expect(text(seen.sentences, 'distance')).toBe(
      'The block is located at a moderate viewing distance of 2.0 km from the Viewpoint B viewpoint.',
    )
    // Judgements the run does not make are listed, not invented.
    const missing = doc.toComplete.filter((item) => item.viewpoint === 'Viewpoint B').map((item) => item.id)
    expect(missing).toEqual(expect.arrayContaining(['visibility', 'force-lines', 'edges', 'position', 'closing']))
    expect(doc.toComplete.some((item) => item.id === 'conclusion')).toBe(true)
  })

  it('22: a glimpsed block is never called visible; block rows carry their own share and the landform its total', () => {
    const doc = resolveViaDocument(formatForSource('22')!, {
      project: 'the proposed blocks',
      viewpoints: [
        vp({
          areas: { landform: 10000, privateLand: 0, proposed: 50, nonVeg: 0 },
          blocks: [
            { id: 'X1', status: 'possible glimpses', visiblePercent: 2 },
            { id: 'X2', status: 'visible', visiblePercent: 40 },
            { id: 'X3', status: 'not visible', visiblePercent: 0 },
          ],
          distanceKm: 3,
        }),
      ],
    })
    const [only] = doc.viewpoints
    expect(text(only.sentences, 'glimpses')).toBe(
      'Block X1 is located on Landform 1; from the Viewpoint A viewpoint at most glimpses of it may be seen.',
    )
    expect(only.sentences.filter((s) => s.id === 'location').map((s) => s.about)).toEqual(['Block X2'])
    const rows = only.rows['detailed-assessment']
    // Two blocks seen share one proposed class: neither block's own share is known, and none is invented.
    expect(rows.map((row) => [row[T5.block], row[T5.percent]])).toEqual([
      ['Block X1', ''],
      ['Block X2', ''],
      ['Block X3', '0.00'],
      ['Overall landform', '0.50 (Small)'],
    ])
    expect(only.rows['initial-assessment'][0][T4.blocks]).toBe('X1, X2')
    expect(doc.toComplete.find((item) => item.id === 'force-lines')?.about).toBe('Block X1')
  })

  it('23: the total is the sum of the rounded parts', () => {
    const doc = resolveViaDocument(formatForSource('23')!, {
      project: 'the proposed blocks',
      viewpoints: [vp({ areas: { landform: 28054, proposed: 254, nonVeg: 471 } })],
    })
    expect(doc.viewpoints[0].printed).toMatchObject({ percent: '2.59', term: 'Small to Medium' })
  })

  it('05: calculation line, class and the report’s own distance zones', () => {
    const doc = resolveViaDocument(formatForSource('05')!, {
      project: 'the proposed blocks',
      viewpoints: [
        vp({ areas: { landform: 303, rock: 27, proposed: 10.7, nonVeg: 0 }, distanceKm: 3.0 }),
        vp({ name: 'Viewpoint D', areas: { landform: 91.3, rock: 23, proposed: 0.5, nonVeg: 0 }, distanceKm: 8.2 }),
      ],
    })
    expect(text(doc.viewpoints[0].sentences, 'calc-line')).toBe('%Alteration: 3.9% (Partial Retention)')
    expect(text(doc.viewpoints[0].sentences, 'zone')).toBe('3.0 Km (Midground)')
    expect(text(doc.viewpoints[1].sentences, 'calc-line')).toBe('%Alteration: 0.7% (Retention)')
    expect(doc.viewpoints[1].distance?.term).toBe('Background')
    expect(doc.recipes.map((recipe) => recipe.id)).toEqual(['existing', 'proposed', 'analysed'])
  })

  it('03: a figure over the objective reads over it, whatever the form ticked', () => {
    const doc = resolveViaDocument(formatForSource('03')!, {
      project: 'the proposed blocks',
      viewpoints: [vp({ areas: { landform: 590161, proposed: 45920, nonVeg: 0 } })],
    })
    expect(doc.viewpoints[0].printed).toMatchObject({ percent: '7.78', classCode: 'M' })
    expect(text(doc.viewpoints[0].sentences, 'objective')).toBe(
      'The established VQO is Partial Retention; the figure is over its range.',
    )
  })

  it('06: the Appendix 1 lines from the assessment’s X, Y and adjusted figure', () => {
    const doc = resolveViaDocument(formatForSource('06')!, {
      project: 'the proposed blocks',
      viewpoints: [
        vp({
          objective: 'M',
          areas: { landform: 155, rock: 27, proposed: 10, nonVeg: 0 },
          appendix1: { a: 7.8, b: 0, c: 0, x: 7.8, y: 3, adjusted: 11.0, rating: 'Well met' },
        }),
      ],
    })
    const s = doc.viewpoints[0].sentences
    expect(text(s, 'x')).toBe('X = a + b + c = 7.8 + 0.0 + 0.0 = 7.8% (M)')
    expect(text(s, 'y')).toBe('Y = +3; X (1 + 0.14 Y) = 11.0% (M)')
    expect(text(s, 'rating')).toBe('The VQO of M is well met from Viewpoint A.')
    expect(doc.toComplete.map((item) => item.id)).toEqual(['rationale'])
  })

  it('02: strict guidelines and the existing + proposed sum', () => {
    const doc = resolveViaDocument(formatForSource('02')!, {
      project: 'the proposed blocks',
      viewpoints: [vp({ areas: { landform: 1000, proposed: 25, nonVeg: 0 } })],
    })
    expect(text(doc.viewpoints[0].sentences, 'total')).toBe(
      'Existing 0.0% + proposed 2.5% = 2.5% of the gross landform',
    )
    expect(doc.viewpoints[0].rows.summary[0]['Within guidelines']).toBe('Yes')
  })

  it('referral: the objective paragraph, a plain caption and the verdict against the ceiling', () => {
    const doc = resolveViaDocument(formatForSource('13')!, {
      project: 'the project',
      viewpoints: [
        vp({
          areas: { landform: 10000, proposed: 120, nonVeg: 0 },
          blocks: [
            { id: 'X1', status: 'possible glimpses', visiblePercent: 2 },
            { id: 'X2', status: 'not visible', visiblePercent: 0 },
          ],
        }),
      ],
    })
    expect(text(doc.summary, 'objective')).toContain('should generally not exceed 7% of the landform')
    expect(text(doc.summary, 'verdict')).toBe(
      'From the viewpoints simulated, the visual quality objective is expected to be well met by these openings (1.20% of the landform at Viewpoint A).',
    )
    expect(text(doc.viewpoints[0].sentences, 'plain')).toBe(
      'The project is not visible except for one small patch from Viewpoint A.',
    )
  })

  it('names block lists as the documents do', () => {
    expect(blockList(['A'])).toBe('Block A')
    expect(blockList(['A', 'B', 'C'])).toBe('Blocks A, B and C')
  })
})

describe('consultant reports: key viewpoints, other planned blocks and the discussion', () => {
  const doc22 = formatForSource('22')!
  const doc23 = formatForSource('23')!
  const all = (sentences: { text: string | null }[]) => sentences.map((s) => s.text ?? '').join(' ')

  it('read a block named as another sale’s as other planned, and keep a flagged one flagged', () => {
    expect(otherPlannedName('EGG5 (TA0333, other planned)')).toEqual({ id: 'EGG5', plannedUnder: 'TA0333' })
    expect(otherPlannedName('B7 (CP-ready)')).toEqual({ id: 'B7', plannedUnder: null })
    expect(otherPlannedName('Landform 1 (consultant, traced)')).toBeNull()
    expect(normalizeBlock({ id: 'EGG5 (TA0333, other planned)', status: 'visible', visiblePercent: 20 })).toEqual({
      id: 'EGG5',
      status: 'visible',
      visiblePercent: 20,
      proposed: false,
      plannedUnder: 'TA0333',
    })
    const flagged = { id: 'X9', status: 'visible' as const, visiblePercent: 5, proposed: false }
    expect(normalizeBlock(flagged)).toBe(flagged)
  })

  it('count other planned blocks in the figure, name them once, mark them in Table 4 and leave them out of Table 5', () => {
    const doc = resolveViaDocument(doc22, {
      project: 'the proposed blocks',
      viewpoints: [
        vp({
          areas: { landform: 10000, privateLand: 0, proposed: 300, nonVeg: 0 },
          blocks: [
            { id: 'A1', status: 'visible', visiblePercent: 40 },
            { id: 'E6 (S1, other planned)', status: 'visible', visiblePercent: 60 },
            { id: 'E2 (S1, other planned)', status: 'not visible', visiblePercent: 0 },
          ],
          distanceKm: 1,
        }),
      ],
    })
    const [only] = doc.viewpoints
    // The other sale's ground stays in the class pass, so the figure counts it.
    expect(only.printed?.percent).toBe('3.00')
    expect(only.rows['initial-assessment'][0][T4.blocks]).toBe('A1, E6*')
    expect(only.rows['detailed-assessment'].map((row) => row[T5.block])).toEqual(['Block A1', 'Overall landform'])
    expect(doc.discussion.map((section) => section.blocks)).toEqual([['A1']])
    // Every sentence is about the proposal's own block; the other sale's are only named beside it.
    expect(new Set(only.sentences.map((s) => s.about))).toEqual(new Set(['Block A1']))
    expect(doc.otherPlanned.blocks).toEqual(['E2', 'E6'])
    expect(doc.otherPlanned.sentence?.text).toBe(
      'Blocks E2 and E6 are planned under another sale or cutting permit (S1). They are drawn on the renders and counted in the percent alteration, as the landform will carry them, but are assessed in their own VIA and are not discussed as part of this proposal.',
    )
    // Only the proposal is concluded on, and the scale sentence says the figure counts the other sale's block too.
    expect(text(doc.summary, 'conclusion')).toBeNull()
    expect(doc.toComplete.find((item) => item.id === 'conclusion')).toBeDefined()
    expect(text(only.sentences, 'scale')).toBe(
      'The scale of the alteration is small to medium relative to the landform (3.00% alteration, a figure that also counts the other planned block E6 where it lies on the landform).',
    )
  })

  it('per block: the largest share seen wins, a tie goes to the viewpoint whose landform shows the alteration', () => {
    const viewpoints = [
      vp({ name: 'A', blocks: [{ id: 'X', status: 'visible', visiblePercent: 30 }] }),
      vp({ name: 'B', blocks: [{ id: 'X', status: 'visible', visiblePercent: 50 }] }),
      vp({ name: 'C', blocks: [{ id: 'X', status: 'visible', visiblePercent: 50 }] }),
    ]
    expect(chooseKeyViewpoints(viewpoints).byBlock.get('X')).toBe(1)
    expect(chooseKeyViewpoints(viewpoints, 'per-block', (i) => i !== 1).byBlock.get('X')).toBe(2)
    // A larger share beats a landform that shows the alteration: the block is most visible there.
    expect(chooseKeyViewpoints(viewpoints, 'per-block', (i) => i === 0).byBlock.get('X')).toBe(1)
  })

  it('group: the viewpoint seeing the most blocks, then one whose landform shows them, then the largest summed share', () => {
    const seen = (id: string, share: number) => ({ id, status: 'visible' as const, visiblePercent: share })
    const viewpoints = [
      vp({ name: 'Two', blocks: [seen('X', 100), seen('Y', 100)] }),
      vp({ name: 'Three, unaltered', blocks: [seen('X', 99), seen('Y', 99), seen('Z', 99)] }),
      vp({ name: 'Three, less', blocks: [seen('X', 90), seen('Y', 90), seen('Z', 90)] }),
      vp({ name: 'Three, more', blocks: [seen('X', 95), seen('Y', 92), seen('Z', 98)] }),
    ]
    const altered = (i: number) => i !== 1
    const choice = chooseKeyViewpoints(viewpoints, 'group', altered)
    expect(choice.group).toEqual({ index: 3, blocks: ['X', 'Y', 'Z'] })
    expect([...choice.byBlock.values()]).toEqual([3, 3, 3])
    // Per block, the same views give each block its own.
    expect(chooseKeyViewpoints(viewpoints, 'per-block', altered).byBlock.get('X')).toBe(0)
    // A block the group viewpoint does not see is assessed from its own.
    const partial = chooseKeyViewpoints(
      [vp({ name: 'P', blocks: [seen('X', 50), seen('Y', 50)] }), vp({ name: 'Q', blocks: [seen('Z', 10)] })],
      'group',
    )
    expect(partial.group?.blocks).toEqual(['X', 'Y'])
    expect(partial.byBlock.get('Z')).toBe(1)
  })

  it('23: discusses the blocks once as a group, under the references’ three headings, with one row each in Table 5', () => {
    expect(doc23.keyViewpoint).toBe('group')
    expect(doc22.keyViewpoint).toBe('per-block')
    const blocks = (a: number, b: number) => [
      { id: 'AN03', status: 'visible' as const, visiblePercent: a },
      { id: 'AN15', status: 'visible' as const, visiblePercent: b },
    ]
    const doc = resolveViaDocument(doc23, {
      project: 'the proposed blocks',
      viewpoints: [
        vp({
          name: 'Bay',
          areas: { landform: 10000, proposed: 300, nonVeg: 0 },
          blocks: blocks(100, 28),
          distanceKm: 6.2,
          review: { importance: 'Moderate (3)' },
        }),
        vp({
          name: 'Point',
          areas: { landform: 10000, proposed: 200, nonVeg: 0 },
          blocks: blocks(100, 99),
          distanceKm: 4,
          review: { importance: 'High (5)' },
        }),
      ],
    })
    expect(doc.discussion).toHaveLength(1)
    const [group] = doc.discussion
    expect(group.heading).toBe('Blocks AN03 and AN15 – Landform 1')
    expect(group.paragraphs.map((p) => p.label ?? null)).toEqual([
      null,
      'Visibility',
      'Size and scale',
      'Visual design',
      null,
    ])
    const point = doc.viewpoints[1]
    expect(text(point.sentences, 'key-viewpoint')).toBe(
      // 23 chooses by impact: the more significant viewpoint, though Bay shows more alteration.
      'This viewpoint was chosen to assess the blocks as a group as the visual impact is most significant from it: it sees both at once, and of the viewpoints that see both and are of High (5) significance it shows the most alteration of the landform.',
    )
    expect(text(point.sentences, 'scale')).toBe(
      'Assessed as a group, the alteration is small to medium in scale relative to the landform (2.00% alteration).',
    )
    // The figure is said once, for the group, never repeated per block.
    expect(all(point.sentences).match(/2\.00%/g)).toHaveLength(1)
    expect(doc.viewpoints[0].sentences).toEqual([])
    expect(point.rows['detailed-assessment'].map((row) => row[T5.block])).toEqual([
      'Block AN03',
      'Block AN15',
      'Overall landform',
    ])
    expect(doc.viewpoints[0].rows['detailed-assessment']).toEqual([])
    expect(doc.toComplete.find((item) => item.id === 'closing')?.about).toBe('Blocks AN03 and AN15')
    expect(text(doc.summary, 'conclusion-figures')).toBe(
      'From the key viewpoint, the percent alteration is 2.00% (small to medium) at Point.',
    )
    expect(text(doc.summary, 'conclusion-standing')).toBe(
      'The figure is within the Partial Retention range (PR 1.6-7%).',
    )
  })

  it('23 by impact with no significance given: the most alteration, the next viewpoint, and says the reviewer confirms', () => {
    const blocks = [
      { id: 'AN03', status: 'visible' as const, visiblePercent: 50 },
      { id: 'AN15', status: 'visible' as const, visiblePercent: 50 },
    ]
    const doc = resolveViaDocument(doc23, {
      project: 'the proposed blocks',
      viewpoints: [
        vp({ name: 'Bay', areas: { landform: 10000, proposed: 300, nonVeg: 0 }, blocks, distanceKm: 6 }),
        vp({ name: 'Point', areas: { landform: 10000, proposed: 200, nonVeg: 0 }, blocks, distanceKm: 4 }),
      ],
    })
    const bay = doc.viewpoints[0].sentences
    expect(text(bay, 'key-viewpoint')).toContain(
      'of the viewpoints that see both it shows the most alteration of the landform.',
    )
    expect(text(bay, 'key-viewpoint-next')).toBe('Next is Point, at 2.00%.')
    expect(text(bay, 'key-viewpoint-significance')).toContain('No viewpoint’s significance is given in Table 3')
    expect(significanceScore('Moderate to High (4)')).toBe(4)
    expect(significanceScore('Low to Moderate')).toBe(2)
    expect(significanceScore('High')).toBe(5)
  })

  it('splits the group figure by each block’s share of the run’s view, in Table 5 and a by-block size line', () => {
    const doc = resolveViaDocument(doc23, {
      project: 'the proposed blocks',
      viewpoints: [
        vp({
          name: 'Bay',
          areas: { landform: 10000, proposed: 400, nonVeg: 0 },
          blocks: [
            { id: 'AN03', status: 'visible', visiblePercent: 80, share: 0.75 },
            { id: 'AN15', status: 'visible', visiblePercent: 60, share: 0.25 },
          ],
          distanceKm: 3,
        }),
      ],
    })
    const bay = doc.viewpoints[0]
    // 4.00% of the landform: 3.00% AN03, 1.00% AN15.
    expect(text(bay.sentences, 'scale-by-block')).toBe(
      'By block, from each block’s share of the blocks’ visible extent in the run: AN03 small to medium (3.00%) and AN15 small (1.00%).',
    )
    expect(bay.rows['detailed-assessment'].map((row) => row[T5.percent])).toEqual(['3.00', '1.00', expect.any(String)])
  })

  it('a key viewpoint whose landform shows 0% says so, points to where the block is measured, and asks for the outline', () => {
    const doc = resolveViaDocument(doc22, {
      project: 'the proposed blocks',
      viewpoints: [
        vp({
          name: 'Near',
          landform: 'Landform 5',
          areas: { landform: 10000, privateLand: 0, proposed: 400, nonVeg: 0 },
          blocks: [{ id: 'B1', status: 'visible', visiblePercent: 24 }],
          distanceKm: 0.7,
        }),
        vp({
          name: 'Far',
          landform: 'Landform 8',
          areas: { landform: 10000, privateLand: 0, proposed: 0, nonVeg: 0 },
          blocks: [
            { id: 'B1', status: 'visible', visiblePercent: 38 },
            { id: 'B2', status: 'visible', visiblePercent: 24 },
          ],
          distanceKm: 1.2,
        }),
      ],
    })
    const far = doc.viewpoints[1]
    expect(text(far.sentences, 'scale-outside')).toBe(
      'As outlined from this viewpoint, Landform 8 does not take in the block, so its figure here (0.00%) does not measure it.',
    )
    expect(text(far.sentences, 'scale-measured-at')).toBe(
      'Of the viewpoints whose landform shows the alteration, Near sees the most of it, and Landform 5 reads 4.00% (small to medium) from there.',
    )
    // The second block at the same viewpoint is not told the same thing twice.
    expect(far.sentences.filter((s) => s.id === 'scale-outside').map((s) => s.text)).toEqual([
      'As outlined from this viewpoint, Landform 8 does not take in the block, so its figure here (0.00%) does not measure it.',
      'As with Block B1, Landform 8 as outlined from this viewpoint does not take in this block.',
    ])
    expect(far.sentences.filter((s) => s.id === 'distance')).toHaveLength(1)
    expect(doc.toComplete.filter((item) => item.id === 'landform-outline').map((item) => item.about)).toEqual([
      'Block B1',
      'Block B2',
    ])
    // Neither block row claims the landform's 0.00 as its own share.
    expect(far.rows['detailed-assessment'].map((row) => row[T5.percent])).toEqual(['', '', '0.00 (Very Small)'])
    // The conclusion lists only the figures that measure the blocks.
    expect(text(doc.summary, 'conclusion-figures')).toBeNull()
  })

  it('names the runner-up when other viewpoints see the block, and reads a distance as printed', () => {
    const doc = resolveViaDocument(doc22, {
      project: 'the proposed blocks',
      viewpoints: [
        vp({
          name: 'Island',
          areas: { landform: 1000, privateLand: 0, proposed: 10, nonVeg: 0 },
          blocks: [{ id: 'B1', status: 'visible', visiblePercent: 39.4 }],
          distanceKm: 1.998,
        }),
        vp({ name: 'Point', blocks: [{ id: 'B1', status: 'visible', visiblePercent: 29.5 }] }),
        vp({ name: 'Lake', blocks: [{ id: 'B1', status: 'possible glimpses', visiblePercent: 1 }] }),
      ],
    })
    const island = doc.viewpoints[0]
    expect(text(island.sentences, 'key-viewpoint')).toBe(
      'This viewpoint was chosen for the detailed assessment because it sees 39% of the block’s ground, more than any of the other two viewpoints that see it (next, Point at 30%), so the block is most visible and most directly in view from here.',
    )
    // 1.998 km prints as 2.0 km, and 2.0 km reads as moderate on the 2-5 km band.
    expect(text(island.sentences, 'distance')).toBe(
      'The block is located at a moderate viewing distance of 2.0 km from the Island viewpoint.',
    )
    expect(island.rows['detailed-assessment'][0][T5.distance]).toBe('Moderate 2.0 km')
  })

  it('reads each key viewpoint’s figure against its own landform’s objective', () => {
    const doc = resolveViaDocument(doc22, {
      project: 'the proposed blocks',
      viewpoints: [
        vp({
          name: 'Lake',
          objective: 'R',
          areas: { landform: 1000, privateLand: 0, proposed: 30, nonVeg: 0 },
          blocks: [{ id: 'B1', status: 'visible', visiblePercent: 40 }],
        }),
        vp({
          name: 'Road',
          objective: 'PR',
          areas: { landform: 1000, privateLand: 0, proposed: 30, nonVeg: 0 },
          blocks: [{ id: 'B2', status: 'visible', visiblePercent: 40 }],
        }),
      ],
    })
    expect(text(doc.summary, 'conclusion-standing')).toBe('The figure at Lake is over the Retention range (R 0-1.5%).')
  })

  it('never doubles a word a slot repeats from its frame', () => {
    expect(
      fillSentence('x', 'Seen from the {viewpoint} viewpoint.', { viewpoint: 'Lakeshore viewpoint' }, 'run').text,
    ).toBe('Seen from the Lakeshore viewpoint.')
    expect(fillSentence('x', 'From the {viewpoint} viewpoint.', { viewpoint: 'The Shores' }, 'run').text).toBe(
      'From The Shores viewpoint.',
    )
  })
})

describe('fillSentence block names', () => {
  it('prints a block named "Block 1" once in a "Block {block}" frame and in a list', () => {
    expect(fillSentence('a', 'Block {b} keeps it.', { b: 'Block 1' }, 'run').text).toBe('Block 1 keeps it.')
    expect(fillSentence('a', 'Of {b}.', { b: 'Blocks Block 1, Block 2 and Block 3' }, 'run').text).toBe(
      'Of Blocks 1, 2 and 3.',
    )
    expect(fillSentence('a', 'Of {b}; Block {c}.', { b: 'Blocks 1 and 2', c: 'EGG1' }, 'run').text).toBe(
      'Of Blocks 1 and 2; Block EGG1.',
    )
  })
})

describe('key viewpoints the reviewer chose', () => {
  const seen = (id: string, share: number) => ({ id, status: 'visible' as const, visiblePercent: share })
  const doc22 = formatForSource('22')!
  const doc23 = formatForSource('23')!

  it('per block: the reviewer’s viewpoint wins when it sees the block; one that does not is declined', () => {
    const viewpoints = [
      vp({ name: 'A', blocks: [seen('X', 30), seen('Y', 10)] }),
      vp({ name: 'B', blocks: [seen('X', 50)] }),
    ]
    expect(chooseKeyViewpoints(viewpoints).byBlock.get('X')).toBe(1)
    const choice = chooseKeyViewpoints(
      viewpoints,
      'per-block',
      () => true,
      'visibility',
      () => null,
      {
        blocks: { X: { viewpoint: 'A', reason: 'the ferry route' }, Y: { viewpoint: 'B' } },
      },
    )
    expect(choice.byBlock.get('X')).toBe(0)
    expect(choice.reviewer?.blocks.get('X')).toBe('the ferry route')
    // B does not see Y: the run's choice stands and the reviewer's is listed.
    expect(choice.byBlock.get('Y')).toBe(0)
    expect(choice.reviewer?.blocks.has('Y')).toBe(false)
    expect(choice.declined).toEqual([{ block: 'Y', viewpoint: 'B' }])
  })

  it('group: the reviewer’s group viewpoint, and a block given its own viewpoint leaves the group', () => {
    const viewpoints = [
      vp({ name: 'Wide', blocks: [seen('X', 90), seen('Y', 90), seen('Z', 90)] }),
      vp({ name: 'Near', blocks: [seen('X', 40), seen('Y', 40), seen('Z', 10)] }),
    ]
    expect(chooseKeyViewpoints(viewpoints, 'group').group).toEqual({ index: 0, blocks: ['X', 'Y', 'Z'] })
    const choice = chooseKeyViewpoints(
      viewpoints,
      'group',
      () => true,
      'visibility',
      () => null,
      {
        group: { viewpoint: 'Near' },
        blocks: { Z: { viewpoint: 'Wide' } },
      },
    )
    expect(choice.group).toEqual({ index: 1, blocks: ['X', 'Y'] })
    expect(choice.byBlock.get('Z')).toBe(0)
    expect(choice.reviewer?.group).toBe('')
  })

  it('says the reviewer chose it, with the reason when given, and lists a choice it could not take', () => {
    const facts = {
      project: 'the proposed blocks',
      viewpoints: [
        vp({
          name: 'Bay',
          areas: { landform: 10000, proposed: 300, nonVeg: 0 },
          blocks: [seen('A1', 30)],
          distanceKm: 2,
        }),
        vp({
          name: 'Ferry',
          areas: { landform: 10000, proposed: 300, nonVeg: 0 },
          blocks: [seen('A1', 60)],
          distanceKm: 2,
        }),
      ],
    }
    const run = resolveViaDocument(doc22, facts)
    expect(text(run.viewpoints[1].sentences, 'key-viewpoint')).toMatch(/^This viewpoint was chosen/)
    const chosen = resolveViaDocument(doc22, { ...facts, keyViewpoints: { blocks: { A1: { viewpoint: 'Bay' } } } })
    expect(chosen.discussion.map((section) => section.viewpoint)).toEqual(['Bay'])
    expect(text(chosen.viewpoints[0].sentences, 'key-viewpoint')).toBe(
      'The reviewer chose this viewpoint for the detailed assessment.',
    )
    const declined = resolveViaDocument(doc22, {
      ...facts,
      keyViewpoints: { blocks: { A1: { viewpoint: 'Nowhere' } } },
    })
    expect(declined.discussion.map((section) => section.viewpoint)).toEqual(['Ferry'])
    const group = resolveViaDocument(doc23, {
      project: 'the proposed blocks',
      viewpoints: [
        vp({
          name: 'Bay',
          areas: { landform: 10000, proposed: 300, nonVeg: 0 },
          blocks: [seen('A1', 30), seen('A2', 30)],
        }),
        vp({
          name: 'Ferry',
          areas: { landform: 10000, proposed: 300, nonVeg: 0 },
          blocks: [seen('A1', 60), seen('A2', 60)],
        }),
      ],
      keyViewpoints: { group: { viewpoint: 'Bay', reason: 'Most people see it from the beach.' } },
    })
    expect(group.keyViewpoints?.choice.group?.index).toBe(0)
    expect(text(group.viewpoints[0].sentences, 'key-viewpoint')).toBe(
      'The reviewer chose this viewpoint to assess the blocks as a group: most people see it from the beach.',
    )
    const unseen = resolveViaDocument(doc22, {
      ...facts,
      keyViewpoints: { blocks: { A1: { viewpoint: 'Bay' }, B9: { viewpoint: 'Bay' } } },
    })
    expect(unseen.toComplete.find((item) => item.id === 'key-viewpoint-declined')).toEqual({
      viewpoint: 'Bay',
      id: 'key-viewpoint-declined',
      missing: ['a key viewpoint that sees Block B9'],
      about: 'Block B9',
    })
  })
})

describe('consultant discussion: sub-landforms and the group’s viewing distance (23)', () => {
  const doc23 = formatForSource('23')!
  const doc22 = formatForSource('22')!
  const pair = (near?: number, far?: number) => [
    { id: 'B1', status: 'visible' as const, visiblePercent: 90, ...(near === undefined ? {} : { distanceKm: near }) },
    { id: 'B2', status: 'visible' as const, visiblePercent: 80, ...(far === undefined ? {} : { distanceKm: far }) },
  ]
  const facts = (landform: string, blocks: ReturnType<typeof pair>, parents?: Record<string, string>) => ({
    project: 'the proposed blocks',
    viewpoints: [
      vp({
        name: 'Shore',
        landform,
        areas: { landform: 10000, proposed: 300, nonVeg: 0 },
        blocks,
        distanceKm: 5.3,
        review: { importance: 'High (5)' },
      }),
    ],
    ...(parents ? { landformParents: parents } : {}),
  })

  it('reads a sub-landform’s parent from its name, its trailing source note aside', () => {
    expect(landformParentFromName('Landform 1a (consultant, traced)')).toBe('Landform 1')
    expect(landformParentFromName('Sub-landform 5b')).toBe('Landform 5')
    expect(landformParentFromName('Landform 1')).toBeNull()
    expect(landformParentFromName('VSU 1284')).toBeNull()
  })

  it('places the blocks in the parent landform within the sub-landform, from the record or the name', () => {
    const named = resolveViaDocument(doc23, facts('Landform 1a (traced)', pair(5.3, 5.8)))
    expect(text(named.viewpoints[0].sentences, 'location')).toBe(
      'Blocks B1 and B2 are located in Landform 1 within Landform 1a (traced) and are visible from the Shore viewpoint.',
    )
    const recorded = resolveViaDocument(doc23, facts('East face', pair(5.3, 5.8), { 'East face': 'Landform 3' }))
    expect(text(recorded.viewpoints[0].sentences, 'location')).toBe(
      'Blocks B1 and B2 are located in Landform 3 within East face and are visible from the Shore viewpoint.',
    )
    const whole = resolveViaDocument(doc23, facts('Landform 1', pair(5.3, 5.8)))
    expect(text(whole.viewpoints[0].sentences, 'location')).toBe(
      'Blocks B1 and B2 are located on Landform 1 and are visible from the Shore viewpoint.',
    )
    // Per block (22), the same.
    const single = resolveViaDocument(doc22, {
      ...facts('Landform 2b', [{ id: 'B1', status: 'visible', visiblePercent: 90 }]),
    })
    expect(text(single.viewpoints[0].sentences, 'location')).toBe(
      'Block B1 is located in Landform 2 within Landform 2b and is visible from the Shore viewpoint.',
    )
  })

  it('gives the group’s viewing distance as the range of the blocks’ own distances, else the nearest block’s', () => {
    const ranged = resolveViaDocument(doc23, facts('Landform 1', pair(5.31, 5.84)))
    expect(text(ranged.viewpoints[0].sentences, 'distance')).toBe(
      'The viewing distance is between 5.3 and 5.8 km from the Shore viewpoint, a good viewing distance.',
    )
    const across = resolveViaDocument(doc23, facts('Landform 1', pair(4.2, 6.1)))
    expect(text(across.viewpoints[0].sentences, 'distance')).toBe(
      'The viewing distance is between 4.2 and 6.1 km from the Shore viewpoint, a moderate to good viewing distance.',
    )
    // A block without its own distance: only the nearest block in view is known.
    const unknown = resolveViaDocument(doc23, facts('Landform 1', pair(5.3)))
    expect(text(unknown.viewpoints[0].sentences, 'distance')).toBe(
      'The nearest block in view is 5.3 km from the Shore viewpoint, a good viewing distance.',
    )
  })
})

describe('conclusion standing', () => {
  it('says a figure under the objective’s range is below it, within what the objective allows', () => {
    const blocks = [
      { id: 'AN03', status: 'visible' as const, visiblePercent: 60 },
      { id: 'AN15', status: 'visible' as const, visiblePercent: 50 },
    ]
    const doc = resolveViaDocument(formatForSource('23')!, {
      project: 'the proposed blocks',
      viewpoints: [vp({ name: 'Bay', areas: { landform: 10000, proposed: 150, nonVeg: 0 }, blocks, distanceKm: 5 })],
    })
    expect(text(doc.summary, 'conclusion-standing')).toBe(
      'The figure is below the Partial Retention range (PR 1.6-7%), within what Partial Retention allows.',
    )
  })
})

describe('several landforms from one viewpoint (23: Sechelt Golf Club, Landform 1, 1a and 1b)', () => {
  // 23 A6's printed pixel areas; the sub-landform 1a is the assessed landform, Landform 1 (Full) and 1b are read beside it.
  const golfClub = () =>
    resolveViaDocument(formatForSource('23')!, {
      project: 'Blocks AN03, AN3A, AN15',
      viewpoints: [
        vp({
          name: 'Sechelt Golf Club',
          landform: 'Landform 1a (traced)',
          areas: { landform: 25807, privateLand: 0, proposed: 240, nonVeg: 478 },
          otherLandforms: [
            {
              landform: 'Landform 1b (traced)',
              objective: 'PR',
              areas: { landform: 109838, privateLand: 0, proposed: 0, nonVeg: 1018 },
              blocks: [],
            },
            {
              landform: 'Landform 1 (traced)',
              objective: 'PR',
              areas: { landform: 141912, privateLand: 0, proposed: 240, nonVeg: 1496 },
              blocks: ['AN03', 'AN3A', 'AN15'],
            },
            {
              landform: 'Landform 1c (traced)',
              objective: 'PR',
              areas: { landform: 6267, privateLand: 0, proposed: 0, nonVeg: 0 },
              blocks: [],
            },
            // Another landform merely in view, with no alteration: not assessed from here.
            {
              landform: 'Landform 4 (traced)',
              objective: 'PR',
              areas: { landform: 5000, privateLand: 0, proposed: 0, nonVeg: 0 },
              blocks: [],
            },
          ],
          blocks: [
            { id: 'AN03', status: 'visible', visiblePercent: 60 },
            { id: 'AN3A', status: 'visible', visiblePercent: 30 },
            { id: 'AN15', status: 'possible glimpses', visiblePercent: 2 },
          ],
          distanceKm: 6.3,
        }),
      ],
    })

  it('Table 4 gives each landform its row, in order, each figure from its own areas', () => {
    const rows = golfClub().viewpoints[0].rows['initial-assessment']
    expect(rows.map((row) => [row[T4.landform], row[T4.percent], row[T4.blocks]])).toEqual([
      ['Landform 1 (traced)', '1.22', 'AN03, AN3A, AN15'],
      ['Landform 1a (traced)', '2.78', 'AN03, AN3A, AN15'],
      ['Landform 1b (traced)', '0.93', 'Existing openings only'],
      ['Landform 1c (traced)', '0.00', 'None'],
    ])
    // A sub-landform seen without alteration reads N/A; the reviewer's terms stay the assessed landform's.
    expect(rows[3][T4.met]).toBe('N/A')
    expect(rows[0][T4.met]).toBe('')
  })

  it('Table 5 closes the key viewpoint with the sub-landform holding the blocks, then the whole landform', () => {
    const rows = golfClub().viewpoints[0].rows['detailed-assessment']
    expect(rows.slice(-2).map((row) => [row[T5.block], row[T5.percent]])).toEqual([
      ['Landform 1a', '2.78 (Small to Medium)'],
      ['Overall Landform 1', '1.22 (Small)'],
    ])
    expect(rows.some((row) => row[T5.block] === 'Overall landform')).toBe(false)
  })

  it('keeps one row per table for a viewpoint reading one landform', () => {
    const doc = resolveViaDocument(formatForSource('23')!, {
      project: 'Blocks AN03',
      viewpoints: [
        vp({
          areas: { landform: 25807, privateLand: 0, proposed: 240, nonVeg: 478 },
          blocks: [{ id: 'AN03', status: 'visible', visiblePercent: 60 }],
        }),
      ],
    })
    expect(doc.viewpoints[0].rows['initial-assessment']).toHaveLength(1)
    expect(doc.viewpoints[0].rows['detailed-assessment'].at(-1)?.[T5.block]).toBe('Overall landform')
  })
})
