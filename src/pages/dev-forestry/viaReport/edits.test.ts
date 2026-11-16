import { describe, expect, it } from 'vitest'

import { editKeysOf, editPartBlocks, orphanEdits, parseReportEdits, withReportEdit } from './edits'
import { reportHtml, reportMarkdown } from './html'
import { field, fields, heading, text, type AssembledReport, type ReportBlock } from './model'

const part = { id: 'demo', title: 'Demo part' }
const blocks = (): ReportBlock[] => [
  heading('Site'),
  fields([field('Licence', null, 'scene'), field('Blocks', 'PL-1', 'scene')]),
  text('The landform is steep.', 'run'),
  { kind: 'paragraph', sentences: [{ id: 'a', text: 'Seen from Hwy 16.', source: 'run', missing: [], template: '' }] },
  { kind: 'table', columns: ['Viewpoint', 'Seen'], rows: [['VP 1', '36%']], source: 'run' },
  {
    kind: 'choices',
    label: 'Meets the objective?',
    options: ['Yes', 'No'],
    chosen: null,
    source: 'reviewer',
    answer: null,
  },
  {
    kind: 'form',
    rows: [[{ title: '3.1 Viewpoint', blocks: [fields([field('Licence', 'inner', 'scene')])] }]],
  },
]

describe('report edits', () => {
  it('leaves a part untouched, object for object, when nothing is edited', () => {
    const given = blocks()
    const out = editPartBlocks(part, given, {})
    expect(out.blocks.every((block, i) => block === given[i])).toBe(true)
    expect(out.targets.every((target) => target.edited === undefined)).toBe(true)
    // Two fields named alike under different headings keep different keys.
    expect(new Set(out.targets.map((target) => target.key)).size).toBe(out.targets.length)
  })

  it('prints an edit as the reviewer’s in place of the value, in every format', () => {
    const first = editPartBlocks(part, blocks(), {})
    const key = (kind: string, label = '') =>
      first.targets.find((target) => target.kind === kind && target.label.endsWith(label))!.key
    const edits = {
      [key('field', 'Site › Licence')]: 'A12345',
      [key('text')]: 'The landform is gentle.',
      [key('paragraph')]: 'Seen briefly from Hwy 16.',
      [key('cell', 'Seen')]: '40%',
      [key('choice')]: 'No',
      [key('answer')]: 'The opening is too large.',
    }
    const out = editPartBlocks(part, blocks(), edits)
    expect(out.filled).toEqual(['Licence'])
    expect(out.targets.filter((target) => target.edited !== undefined)).toHaveLength(6)
    const report: AssembledReport = {
      id: 'demo',
      title: 'Demo',
      subtitle: 'PL-1',
      sources: [],
      blocks: [heading('Demo', 1), ...out.blocks],
      toComplete: [],
      footer: 'footer',
      layout: { paper: 'letter', cover: false, contents: false },
    }
    const html = reportHtml(report, null)
    for (const value of Object.values(edits)) expect(html).toContain(value)
    expect(html).not.toContain('The landform is steep.')
    expect(html).toContain('☒ No')
    expect(html).not.toContain('data-edit')
    expect(reportMarkdown(report)).toContain('- Licence: A12345')
    // The draft marks each value with its key, and the edited ones.
    const draft = reportHtml(report, null, {
      parts: [],
      editKeys: editKeysOf([out.keys]),
      edited: new Set(Object.keys(edits)),
    })
    // Six marked elements: the field, the text, the paragraph, the cell and the two tick boxes (no answer line prints).
    expect(draft.match(/ data-edited[ >]/g)).toHaveLength(6)
    // The inner form field was not edited: it keeps its own key and value.
    expect(draft).toContain('inner')
  })

  it('never applies a tick that is not one of the options, and reports an edit with no place', () => {
    const first = editPartBlocks(part, blocks(), {})
    const tick = first.targets.find((target) => target.kind === 'choice')!.key
    const edits = { [tick]: 'Maybe', 'demo|Gone|field|Licence': 'x', 'other|x|field|y': 'z' }
    const out = editPartBlocks(part, blocks(), edits)
    expect(out.targets.find((target) => target.key === tick)!.edited).toBeUndefined()
    expect(orphanEdits(edits, ['demo'], out.targets)).toEqual(['demo|Gone|field|Licence'])
  })

  it('keeps an edit only while it differs from what the part printed', () => {
    expect(withReportEdit(undefined, 'a|b', 'x', 'y')).toEqual({ 'a|b': 'x' })
    expect(withReportEdit({ 'a|b': 'x' }, 'a|b', 'y', 'y')).toBeUndefined()
    expect(withReportEdit({ 'a|b': 'x', 'c|d': 'z' }, 'a|b', null)).toEqual({ 'c|d': 'z' })
    expect(parseReportEdits({ 'a|b': 'x', bad: 'y', 'c|d': 3 })).toEqual({ 'a|b': 'x' })
  })
})
