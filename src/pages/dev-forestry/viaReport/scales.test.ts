import { describe, expect, it } from 'vitest'

import { PARTIAL_CUT_EQUIVALENT } from '../vqo'
import { scaleGeometry, scaleHtml, matrixHtml, scaleOrMatrixMarkdown } from './htmlScales'
import {
  CLASS_GUIDE_COLORS,
  clearcutGuide,
  criteriaMatrix,
  designElementsMatrix,
  partialCutMatrix,
  pmmArrow,
  table2Bar,
} from './matrices'
import type { ReportBlock } from './model'

type ScaleBlock = Extract<ReportBlock, { kind: 'scale' }>
type MatrixBlock = Extract<ReportBlock, { kind: 'matrix' }>

const scale = (block: ReportBlock): ScaleBlock => {
  if (block.kind !== 'scale') throw new Error('scale expected')
  return block
}
const matrix = (block: ReportBlock): MatrixBlock => {
  if (block.kind !== 'matrix') throw new Error('matrix expected')
  return block
}

/** The band whose stretch of the axis holds the drawn mark (a point band holds only its own position). */
function bandAt(block: ScaleBlock): string | null {
  const g = scaleGeometry(block)
  if (g.markX === null) return null
  const found = g.bands.find((b) =>
    b.x1 - b.x0 < 0.01 ? Math.abs(g.markX! - b.x0) < 0.01 : g.markX! > b.x0 && g.markX! < b.x1,
  )
  return found?.label ?? null
}

describe('the P to MM arrow axis', () => {
  it.each(['P', 'R', 'PR', 'M', 'MM'] as const)('puts the arrow inside class %s', (code) => {
    const block = scale(pmmArrow('Class by eye', code, 'reviewer'))
    expect(block.style).toBe('arrow-axis')
    expect(bandAt(block)).toBe(code)
    expect(block.markBand).toBe(['P', 'R', 'PR', 'M', 'MM'].indexOf(code))
  })

  it('draws the class labels in the guide colours above an axis with an arrowhead, and the arrow pointing down', () => {
    const block = scale(pmmArrow('Current existing visual condition', 'PR', 'run'))
    const html = scaleHtml(block)
    for (const code of ['P', 'R', 'PR', 'M', 'MM'] as const)
      expect(html).toContain(`fill="${CLASS_GUIDE_COLORS[code]}" text-anchor="middle"`)
    const g = scaleGeometry(block)
    // The axis runs past the last class to its arrowhead, and the classes widen from R to MM as on the 01 form.
    expect(g.tip).toBeGreaterThan(g.bands[4].x1)
    const widths = g.bands.map((b) => b.x1 - b.x0)
    expect(widths[0]).toBe(0)
    expect(widths[1]).toBeLessThan(widths[2])
    expect(widths[2]).toBeLessThan(widths[3])
    expect(html).toMatch(/<path d="M[\d.]+ 34 L[\d.]+ 34 L[\d.]+ 43 Z" fill="#b91c1c"\/>/)
  })

  it('leaves the arrow off when no class is given', () => {
    const block = scale(pmmArrow('Class by eye', null, 'reviewer'))
    expect(scaleGeometry(block).markX).toBeNull()
    expect(scaleHtml(block)).not.toContain('#b91c1c')
    expect(scaleOrMatrixMarkdown(block)).toContain('not marked')
  })
})

describe('the Appendix 1 bar', () => {
  it('draws the same axis, ticked 0 1.5 4 7 12 18 24 30+ at equal spacing', () => {
    const block = scale(table2Bar('X', 7.8, 'run'))
    expect(block.style).toBe('arrow-axis')
    const g = scaleGeometry(block)
    const gaps = g.ticks.slice(1).map((t, i) => t.x - g.ticks[i].x)
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6)
    expect(scaleHtml(block)).toContain('%alt:')
  })

  it.each([
    [0, 'P'],
    [1.5, 'R'],
    [1.6, 'PR'],
    [7, 'PR'],
    [7.8, 'M'],
    [18.1, 'MM'],
  ] as const)('reads %s%% as %s, inclusive at the bounds as Table 2 is', (percent, code) => {
    const block = scale(table2Bar('X', percent, 'run'))
    expect(block.bands[block.markBand!].label).toBe(code)
  })

  it('places a figure past 30 on the arrowhead stretch, with no class', () => {
    const block = scale(table2Bar('X', 34, 'run'))
    const g = scaleGeometry(block)
    expect(g.markX).toBeGreaterThan(g.end)
    expect(g.markX).toBeLessThan(g.tip)
    expect(block.markBand).toBeNull()
  })
})

describe('the partial-cut alteration guide', () => {
  const block = matrix(partialCutMatrix({ removedPercent: 40, residualHeightM: 25 }))

  it('colours and letters every cell by the class its clearcut-equivalent number reads as', () => {
    expect(block.style).toBe('class-grid')
    PARTIAL_CUT_EQUIVALENT.forEach((row, r) =>
      row.forEach((value, c) => {
        const expected = value <= 1.5 ? 'R' : value <= 7 ? 'PR' : value <= 18 ? 'M' : 'MM'
        expect(block.letters![r][c]).toBe(expected)
        expect(block.tint![r][c]).toBe(CLASS_GUIDE_COLORS[expected])
        expect(block.cells[r][c]).toBe(value.toFixed(1))
      }),
    )
    expect(block.legend?.items.map((item) => item.label)).toEqual(['Retention', 'Partial Retention', 'Modification'])
  })

  it('marks the reading with an X where the prescription falls, letters only, as the poster and 01 print it', () => {
    expect(block.marks).toEqual([])
    expect(block.point).toEqual({ row: 3, column: 4 })
    const html = matrixHtml(block)
    expect(html.match(/class="grid-x"/g)).toHaveLength(1)
    expect(html).not.toContain('<small>')
    expect(html).not.toContain('Nothing marked yet.')
    // 10% removed at 27.5 m: on the first row, halfway between the 25 and 30 m columns (01's mark).
    const between = matrixHtml(matrix(partialCutMatrix({ removedPercent: 10, residualHeightM: 27.5 })))
    expect(between).toMatch(/<td[^>]*><span class="grid-x" style="left:100%;top:50%"/)
    expect(scaleOrMatrixMarkdown(block)).toContain('X: 40% removed, 25 m residual trees')
  })

  it('draws a rule where the class changes, and none inside a class', () => {
    const html = matrixHtml(block)
    const firstRow = html.split('<tr>').find((row) => row.includes('<th>10</th><td'))!
    // 10% removed: R up to 40 m, then PR.
    const classes = [...firstRow.matchAll(/<td(?: class="([^"]*)")?/g)].map((m) => m[1] ?? '')
    expect(classes[7]).toContain('edge-r')
    expect(classes[8]).toContain('edge-l')
    expect(classes[0]).not.toContain('edge-r')
  })

  it('marks nothing below 10% removed or with no cut', () => {
    expect(matrix(partialCutMatrix(null)).marks).toEqual([])
    expect(matrix(partialCutMatrix(null)).point).toBeUndefined()
    expect(matrixHtml(matrix(partialCutMatrix(null)))).toContain('Nothing marked yet.')
  })
})

describe('the clearcut alteration guide', () => {
  it('draws a bar per objective on a 0-30% axis with the poster’s ranges', () => {
    const block = scale(clearcutGuide(null))
    expect(block.style).toBe('guide')
    expect(block.bands.map((b) => [b.name, b.range])).toEqual([
      ['Preservation', '0%'],
      ['Retention', '0 - 1.5%'],
      ['Partial Retention', '1.6 - 7.0%'],
      ['Modification', '7.1 - 18.0%'],
      ['Maximum Modification', '18.1 - 30.0+%'],
    ])
    const g = scaleGeometry(block)
    // A linear axis: 15% is halfway.
    expect(g.ticks.find((t) => t.label === '15')!.x).toBeCloseTo((g.start + g.end) / 2, 6)
    expect(g.markX).toBeNull()
  })

  it('marks the reading at its percent and picks out its class’s row', () => {
    const block = scale(clearcutGuide(4.2))
    const g = scaleGeometry(block)
    expect(g.markX).toBeCloseTo(g.start + ((g.end - g.start) * 4.2) / 30, 6)
    expect(block.markBand).toBe(2)
    const html = scaleHtml(block)
    expect(html).toContain('stroke-dasharray="4 3"')
    expect(html).toContain('4.2%')
    expect(html).toContain(`fill="${CLASS_GUIDE_COLORS.PR}" fill-opacity="0.14"`)
    expect(scaleOrMatrixMarkdown(block)).toContain('**Partial Retention: 1.6 - 7.0%**')
  })
})

describe('form tables', () => {
  it('tick the marked cell and strip each class row in its colour', () => {
    const html = matrixHtml(matrix(criteriaMatrix('PR')))
    expect(html).toContain('<td class="marked"><span class="tick" aria-label="marked">✓</span>easy to see</td>')
    expect(html).toContain(`border-left:5px solid ${CLASS_GUIDE_COLORS.P}`)
    expect(html).toContain(`border-left:5px solid ${CLASS_GUIDE_COLORS.MM}`)
  })

  it('name the column group once over a multi-column table', () => {
    const html = matrixHtml(matrix(designElementsMatrix({ 'force-lines': 0 }, 'reviewer')))
    expect(html).toContain('<th class="span" colspan="3">Rating</th>')
    expect(html.match(/class="marked"/g)).toHaveLength(1)
  })
})
