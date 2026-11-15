import { describe, expect, it } from 'vitest'

import { findDocumentFormat } from '../viaDocument/formats'
import { resolveViaDocument, type DocumentFacts } from '../viaDocument/resolve'
import { reportHtml, reportMarkdown } from './html'
import { extraBlockHtml, FIGURES_CSS } from './htmlFigures'
import type { AssembledReport, ReportBlock, ReportFigure } from './model'
import type { ReportContext, ReportImages } from './parts'
import {
  andList,
  FIGURE_PARTS,
  figurePagesPart,
  figureWording,
  firstFigureNumber,
  DEFAULT_FIGURE_WORDING,
} from './partsFigures'

const viewpoint = (name: string): DocumentFacts['viewpoints'][number] => ({
  name,
  landform: 'Landform 1',
  objective: 'PR',
  inventory: null,
  areas: { landform: 10000, proposed: 300, nonVeg: 0, privateLand: 0, rock: 0 },
  sightlinePercent: 3.1,
  distanceKm: 2.6,
  hfovDeg: 39.6,
  lensMm: 50,
  lngLat: [-122.5, 53.9],
  blocks: [{ id: 'X1', status: 'visible', visiblePercent: 40 }],
})

const picture = (view: string, caption = view): ReportFigure => ({
  view,
  caption,
  dataUrl: `data:image/png;base64,${view.replace(/\W/g, '')}`,
  width: 300,
  height: 200,
})

function context(formatId: string, names: string[], over: Partial<ReportContext> = {}): ReportContext {
  const facts: DocumentFacts = { project: 'Block X1', viewpoints: names.map(viewpoint) }
  return {
    date: new Date('2026-11-14T12:00:00Z'),
    office: { licence: 'A00000', cuttingPermit: '7' },
    blocks: [
      { name: 'X1', areaHa: 12, system: 'Clearcut', retentionPercent: null, partialCut: null },
      { name: 'X2', areaHa: 8, system: 'Clearcut', retentionPercent: null, partialCut: null },
    ],
    landform: null,
    inventory: null,
    inventoryRead: false,
    facts,
    document: resolveViaDocument(findDocumentFormat(formatId)!, facts),
    assessment: null,
    review: null,
    breakdown: null,
    method: { terrain: 'AWS Open Data terrain', vegetation: 'VRI', eyeHeightM: 1.6 },
    measures: [],
    figures: names.map((name) => picture(name, `${name} analysis sheet`)),
    recipeParts: ['overview-map', 'overhead-renders', 'ea-figure-pages', 'photo-simulation-pairs'],
    ...over,
  }
}

const allImages = (names: string[]): ReportImages => ({
  overviewMap: {
    ...picture('overview'),
    map: { legend: [{ label: 'Proposed block', color: '#ff0000' }], scale: '1:50,000', northUp: true },
  },
  regionalMap: picture('regional'),
  locationMaps: Object.fromEntries(names.map((name) => [name, picture(`location ${name}`)])),
  before: Object.fromEntries(
    names.map((name, i) => [name, { ...picture(`before ${name}`), source: i ? 'render' : 'photo' }]),
  ),
  overhead: [picture('overhead'), picture('oblique 1', 'Oblique X1'), picture('oblique 2', 'Oblique X2')],
})

const part = (id: string) => FIGURE_PARTS.find((p) => p.id === id)!
const kinds = (blocks: ReportBlock[]) => blocks.map((b) => b.kind)
const report = (blocks: ReportBlock[]): AssembledReport => ({
  id: 'sample',
  title: 'Visual Aesthetics',
  subtitle: 'A00000 CP 7',
  sources: ['26'],
  blocks,
  toComplete: [],
  footer: 'footer',
  layout: { paper: 'letter', cover: false, contents: false },
})

describe('figure parts', () => {
  it('register five parts with their own ids', () => {
    expect(FIGURE_PARTS.map((p) => p.id)).toEqual([
      'overview-map',
      'overview-sheet',
      'overhead-renders',
      'ea-figure-pages',
      'photo-simulation-pairs',
    ])
  })

  it('number figures in the order the recipe lists the figure parts', () => {
    const names = ['Lakeshore', 'Ridge road']
    const ctx = context('referral-panoramas', names, { images: allImages(names) })
    expect(firstFigureNumber(ctx, 'overview-map')).toBe(1)
    // One overhead render and one figure for both obliques.
    expect(firstFigureNumber(ctx, 'overhead-renders')).toBe(2)
    expect(firstFigureNumber(ctx, 'ea-figure-pages')).toBe(4)
    const pages = part('ea-figure-pages').build(ctx).blocks
    expect(pages.map((b) => (b.kind === 'figurePage' ? b.number : ''))).toEqual(['Figure 4', 'Figure 5'])
    // Parts the recipe does not list start at 1.
    expect(firstFigureNumber({ ...ctx, recipeParts: ['ea-figure-pages'] }, 'ea-figure-pages')).toBe(1)
  })

  describe('the figure page', () => {
    it('lays out the title, the project facts, both maps, before and after for each viewpoint', () => {
      const names = ['Lakeshore', 'Ridge road']
      const out = part('ea-figure-pages').build(context('referral-panoramas', names, { images: allImages(names) }))
      expect(out.toComplete).toEqual([])
      const page = out.blocks[1] as Extract<ReportBlock, { kind: 'figurePage' }>
      expect(page.title).toBe('Visualization from Ridge road')
      expect(page.facts.map((f) => [f.label, f.value])).toEqual([
        ['Project Number', 'A00000 CP 7'],
        ['Date', 'November 14, 2026'],
      ])
      expect(page.side.map((s) => [s.label, s.figure?.view])).toEqual([
        ['Location map and viewpoint', 'location Ridge road'],
        ['Regional map', 'regional'],
      ])
      expect(page.main.map((s) => [s.label, s.figure?.view])).toEqual([
        ['Before project', 'before Ridge road'],
        ['After project', 'Ridge road'],
      ])
      // The before picture says where it came from.
      expect(page.main[0].note).toMatch(/^Rendered before harvest/)
      const html = extraBlockHtml(page)
      expect(html).toContain('class="vf-page"')
      expect(html).toContain('<div class="vf-bar">Before project</div>')
      expect(html).toContain('Project Number: A00000 CP 7')
      expect(FIGURES_CSS).toMatch(/@page via-figure\{size:letter landscape/)
      expect(FIGURES_CSS).toContain('.vf-page{page:via-figure')
    })

    it('prints a box saying what goes where for each missing picture, and lists it', () => {
      const ctx = context('referral-panoramas', ['Lakeshore'], { office: {}, figures: [] })
      const out = part('ea-figure-pages').build(ctx)
      expect(out.toComplete).toEqual([
        'Project number (licence and cutting permit)',
        'Regional map',
        'Lakeshore: location map and viewpoint',
        'Lakeshore: picture before the project (field photograph or render)',
        'Lakeshore: simulation (save the viewpoint)',
      ])
      const html = extraBlockHtml(out.blocks[0])
      expect(html.match(/vf-pic vf-empty/g)).toHaveLength(4)
      expect(html).toContain('Regional map placing the project in its region')
      expect(html).toContain('Project Number: <span class="blank"></span>')
      expect(html).not.toContain('<img')
    })

    it('says so when no viewpoint was saved', () => {
      const out = part('ea-figure-pages').build(context('referral-panoramas', []))
      expect(kinds(out.blocks)).toEqual(['text'])
      expect(out.toComplete).toEqual(['Figure pages: save a viewpoint'])
    })

    it('takes its wording from a parameter', () => {
      const own = figurePagesPart('my-figure-pages', {
        ...DEFAULT_FIGURE_WORDING,
        number: 'Plate {n}',
        page: { ...DEFAULT_FIGURE_WORDING.page, title: 'View from {viewpoint}' },
      })
      const page = own.build(context('referral-panoramas', ['Lakeshore'])).blocks[0]
      expect(page).toMatchObject({ number: 'Plate 1', title: 'View from Lakeshore' })
    })
  })

  describe('photograph / simulation pairs', () => {
    it('caption each picture under it, numbered when there are several, and label the before by its source', () => {
      const names = ['Lakeshore', 'Ridge road']
      const out = part('photo-simulation-pairs').build(
        context('form-2001-analysis-sheets', names, { images: allImages(names) }),
      )
      expect(out.toComplete).toEqual([])
      expect(out.blocks.map((b) => (b.kind === 'figurePair' ? b.slots.map((s) => s.label) : []))).toEqual([
        ['Photograph 1: Lakeshore', 'Simulation 1: Lakeshore'],
        ['Before-harvest render 2: Ridge road', 'Simulation 2: Ridge road'],
      ])
      // One viewpoint: no number.
      const one = part('photo-simulation-pairs').build(
        context('form-2001-analysis-sheets', ['Lakeshore'], { images: allImages(['Lakeshore']) }),
      ).blocks[0] as Extract<ReportBlock, { kind: 'figurePair' }>
      expect(one.slots[0].label).toBe('Photograph: Lakeshore')
      expect(extraBlockHtml(one)).toContain('<figcaption>Photograph: Lakeshore</figcaption>')
    })

    it('put the labels in the picture’s corner for the formats that do, under the view’s name', () => {
      const names = ['Lakeshore']
      const pair = part('photo-simulation-pairs').build(
        context('form-2001-analysed-photos', names, { images: allImages(names) }),
      ).blocks[0] as Extract<ReportBlock, { kind: 'figurePair' }>
      expect(pair).toMatchObject({ placement: 'inset', title: 'Lakeshore' })
      expect(pair.slots.map((s) => s.label)).toEqual(['Existing Condition', 'Proposed Development'])
      const html = extraBlockHtml(pair)
      expect(html).toContain('<span class="vf-inset">Existing Condition</span>')
      expect(html).not.toContain('<figcaption>')
      expect(figureWording('appendix-1-net-rock').pair.before.photo).toBe('Photo')
      expect(figureWording('unknown').pair).toEqual(DEFAULT_FIGURE_WORDING.pair)
    })

    it('print placeholders and list both pictures when missing', () => {
      const out = part('photo-simulation-pairs').build(
        context('appendix-1-net-private-rock', ['Lakeshore'], { figures: [] }),
      )
      expect(out.toComplete).toEqual([
        'Lakeshore: field photograph or render before harvest',
        'Lakeshore: simulation (save the viewpoint)',
      ])
      expect(extraBlockHtml(out.blocks[0]).match(/vf-pic vf-empty/g)).toHaveLength(2)
    })
  })

  describe('map pages', () => {
    it('caption the overview map by format and viewpoint count, with its legend, scale and north arrow', () => {
      const names = ['Lakeshore', 'Ridge road']
      const map = part('overview-map').build(context('referral-panoramas', names, { images: allImages(names) }))
      expect(map.toComplete).toEqual([])
      const block = map.blocks[0] as Extract<ReportBlock, { kind: 'mapFigure' }>
      expect(block.caption).toBe('Figure 1: Observer viewpoint locations')
      const html = extraBlockHtml(block)
      expect(html).toContain('class="vf-north"')
      expect(html).toContain('Proposed block')
      expect(html).toContain('1:50,000')
      expect(
        (part('overview-map').build(context('referral-panoramas', ['Lakeshore'])).blocks[0] as { caption: string })
          .caption,
      ).toBe('Figure 1: Observer viewpoint location')
      expect(
        (part('overview-map').build(context('perspective-report-gross', names)).blocks[0] as { caption: string })
          .caption,
      ).toBe('Appendix A1: Viewpoint map')
    })

    it('add nothing over a map that prints its own legend, scale and north arrow', () => {
      const images = allImages(['Lakeshore'])
      images.overviewMap = { ...images.overviewMap!, map: { ...images.overviewMap!.map, inPicture: true } }
      const html = extraBlockHtml(
        part('overview-map').build(context('referral-panoramas', ['Lakeshore'], { images })).blocks[0],
      )
      expect(html).not.toContain('vf-north')
      expect(html).not.toContain('vf-key')
    })

    it('print a placeholder overview map and list it when missing', () => {
      const out = part('overview-map').build(context('referral-panoramas', ['Lakeshore']))
      expect(out.toComplete).toEqual(['Overview map'])
      expect(extraBlockHtml(out.blocks[0])).toContain('vf-pic vf-empty')
    })

    it('lay out each overhead render, then the obliques side by side under one caption naming the blocks', () => {
      const names = ['Lakeshore']
      const out = part('overhead-renders').build(
        context('form-2001-analysis-sheets', names, { images: allImages(names) }),
      )
      expect(out.toComplete).toEqual([])
      expect(kinds(out.blocks)).toEqual(['mapFigure', 'figureGrid'])
      expect(out.blocks[0]).toMatchObject({ caption: 'Figure 2: Overhead render, model confirmation' })
      expect(out.blocks[1]).toMatchObject({
        columns: 2,
        caption: 'Figure 3: Oblique renders, model confirmation - Blocks X1 and X2',
      })
      expect(extraBlockHtml(out.blocks[1])).toContain('vf-cols-2')
    })

    it('print an overhead and an oblique placeholder when no render was given', () => {
      const out = part('overhead-renders').build(context('form-2001-analysis-sheets', ['Lakeshore']))
      expect(kinds(out.blocks)).toEqual(['mapFigure', 'figureGrid'])
      expect(out.toComplete).toEqual(['Overhead render of the blocks', 'Oblique renders of the blocks'])
      expect(andList(['A', 'B', 'C'])).toBe('A, B and C')
    })
  })

  it('print through the report: no template braces, Markdown names every picture place', () => {
    const names = ['Lakeshore']
    const ctx = context('referral-panoramas', names, { images: allImages(names) })
    const blocks = FIGURE_PARTS.flatMap((p) => p.build(ctx).blocks)
    const html = reportHtml(report(blocks), null)
    expect(html).not.toMatch(/\{\w+\}|undefined|NaN/)
    expect(html).toContain('@page via-figure')
    const md = reportMarkdown(report(blocks))
    expect(md).toContain('**Figure 4: Visualization from Lakeshore**')
    expect(md).toContain('- Regional map: _regional_')
    const empty = FIGURE_PARTS.flatMap((p) => p.build(context('referral-panoramas', names, { figures: [] })).blocks)
    expect(reportMarkdown(report(empty))).toContain('- Before project: to come, Lakeshore: a field photograph')
  })
})

describe('block marks on the plain simulation', () => {
  const marked = (name: string): ReportFigure => ({
    ...picture(`after ${name}`),
    marks: [
      { x: 0.5, y: 0.6, label: 'Block X1', status: 'visible' },
      { x: 0.2, y: 0.4, label: 'Block X2', status: 'possible glimpses' },
    ],
  })
  const names = ['Hwy 31']
  const ctx = context('referral-panoramas', names, {
    images: { ...allImages(names), after: { 'Hwy 31': marked('Hwy 31') } },
  })

  it('26: rings only the block that is glimpsed, over the picture, never an outline', () => {
    const html = part('ea-figure-pages').build(ctx).blocks.map(extraBlockHtml).join('')
    expect(html).toContain('<svg class="vf-marks" viewBox="0 0 300 200"')
    expect(html).toContain('Block X2 (glimpses only)')
    expect(html).not.toContain('>Block X1<')
  })

  it('05/06 pairs: an arrow and label to every block', () => {
    const html = part('photo-simulation-pairs').build(ctx).blocks.map(extraBlockHtml).join('')
    expect(html).toContain('>Block X1<')
    expect(html).toContain('Block X2 (glimpses only)')
  })
})

describe('the 11 x 17 overview sheet', () => {
  const names = ['Lakeshore']
  const sheet: ReportFigure = {
    ...picture('sheet'),
    width: 3300,
    height: 2130,
    map: { scale: '1:15,000', inPicture: true },
  }

  it('prints full-size on a sheet page of its own, its scale named, and falls back to the overview map', () => {
    const ctx = context('perspective-report-gross', names, { images: { ...allImages(names), overviewSheet: sheet } })
    const [block] = part('overview-sheet').build(ctx).blocks
    expect(block).toMatchObject({ kind: 'figure', figure: sheet })
    expect((block as { caption: string }).caption).toContain('(1:15,000 at 11 × 17)')
    const html = reportHtml(report([block]), null)
    expect(html).toContain('<figure class="sheet full">')
    expect(html).toContain('@page sheetfull{size:17in 11in;margin:0')
    const without = part('overview-sheet').build(
      context('perspective-report-gross', names, { images: allImages(names) }),
    )
    expect(without.blocks[0].kind).toBe('mapFigure')
  })
})
