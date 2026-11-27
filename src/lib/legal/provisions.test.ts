import { describe, expect, it } from 'vitest'
import { bcLawsSectionUrl, orderRefs, parseOrderProvision, parseProvision, type StatuteRef } from './provisions'

const sections = (text: string, source?: string) =>
  parseProvision(text, source).map((r) =>
    r.kind === 'section'
      ? `${r.source ?? ''}:${r.section}${r.sub}${r.term ? ` "${r.term}"` : ''}`
      : `order:${r.provision}`,
  )

describe('parseProvision', () => {
  it('reads a section with its paragraph and a subsection range', () => {
    expect(sections('64(1)(b) and 64(2)–(4)', 'bc.fppr')).toEqual(['bc.fppr:64(1)(b)', 'bc.fppr:64(2)–(4)'])
  })
  it('continues a bare subsection list on the last section', () => {
    expect(sections('66(1), (3)–(4)')).toEqual([':66(1)', ':66(3)–(4)'])
    expect(sections('s. 56(1), (3), s. 58(1)(a)(ii), (3)')).toEqual([':56(1)', ':56(3)', ':58(1)(a)(ii)', ':58(3)'])
    expect(sections('s. 45(1)(b), (c)')).toEqual([':45(1)(b)', ':45(1)(c)'])
    expect(sections('s. 43.3(1)(b), (c)(i)')).toEqual([':43.3(1)(b)', ':43.3(1)(c)(i)'])
  })
  it('expands a short run of whole sections and keeps decimal ranges as their ends', () => {
    expect(sections('32–35')).toEqual([':32', ':33', ':34', ':35'])
    expect(sections('20.21–20.22')).toEqual([':20.21', ':20.22'])
    expect(sections('ss. 59–63')).toEqual([':59', ':60', ':61', ':62', ':63'])
  })
  it('keeps a defined term with its section', () => {
    expect(sections('s. 1 "farm use", s. 20(1)')).toEqual([':1 "farm use"', ':20(1)'])
    expect(sections('s. 1 "Crown timber", "private land"')).toEqual([':1 "Crown timber"', ':1 "private land"'])
  })
  it('reads a subsection range with paragraphs', () => {
    expect(sections('44(3)(h)–(i), 44(4)')).toEqual([':44(3)(h)–(i)', ':44(4)'])
    expect(sections('29(0.1)–(3)')).toEqual([':29(0.1)–(3)'])
    expect(sections('35(4.1)–(4.2)')).toEqual([':35(4.1)–(4.2)'])
  })
  it('names another instrument the citation leans on', () => {
    expect(sections('1 and 3, with FPPR 44(3)(d)', 'bc.range-act')).toEqual([
      'bc.range-act:1',
      'bc.range-act:3',
      'bc.fppr:44(3)(d)',
    ])
    expect(sections('29 with the 2006 order Part C.5 and FPPR 44(3)', 'bc.frpa')).toEqual([
      'bc.frpa:29',
      'order:C.5',
      'bc.fppr:44(3)',
    ])
  })
  it('leaves free text out', () => {
    const refs = parseProvision('1(2), net area to be reforested (f)') as StatuteRef[]
    expect(refs.map((r) => r.section + r.sub)).toEqual(['1(2)'])
  })
})

describe('parseOrderProvision', () => {
  it('reads parts, objectives and tables', () => {
    expect(parseOrderProvision('I, Part C.5').map((r) => r.provision)).toEqual(['C.5'])
    expect(parseOrderProvision('I, Part C.2–C.4').map((r) => r.provision)).toEqual(['C.2', 'C.3', 'C.4'])
    expect(parseOrderProvision('I, Parts A, B and E').map((r) => r.provision)).toEqual(['A', 'B', 'E'])
    expect(parseOrderProvision('II').map((r) => r.provision)).toEqual(['Part II'])
    expect(parseOrderProvision('D.5(a)').map((r) => r.provision)).toEqual(['D.5(a)'])
    expect(parseOrderProvision('C / Table 7').map((r) => r.provision)).toEqual(['C', 'Table 7'])
  })
})

describe('bcLawsSectionUrl', () => {
  it('adds the section anchor BC Laws uses', () => {
    expect(bcLawsSectionUrl('https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004', '64')).toBe(
      'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004#section64',
    )
  })
  it('leaves other documents and schedules as they are', () => {
    expect(bcLawsSectionUrl('https://example.org/order.pdf', '3')).toBe('https://example.org/order.pdf')
    expect(
      bcLawsSectionUrl('https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004', 'Schedule 2'),
    ).toBe('https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004')
  })
})

describe('orderRefs', () => {
  const ids = (text: string) => orderRefs(text).map((r) => r.provision)
  it('reads a list under one label, with ranges inside one objective', () => {
    expect(ids('Strategy 1.02, 2.02')).toEqual(['Strategy 1.02', 'Strategy 2.02'])
    expect(ids('Strategy 1.01–1.02, 2.01–2.02')).toEqual([
      'Strategy 1.01',
      'Strategy 1.02',
      'Strategy 2.01',
      'Strategy 2.02',
    ])
    expect(ids('Para 1–2')).toEqual(['Para 1', 'Para 2'])
    expect(ids('Objective 2(b)')).toEqual(['Objective 2(b)'])
  })
})
