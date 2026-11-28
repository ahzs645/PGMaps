import { describe, expect, it } from 'vitest'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { parsePack } from '../../../../packages/legal-rules/src/contract'
import fpprPack from '../../../../packages/legal-rules/packs/bc-fppr-planning-1.3.0.json'
import permitsPack from '../../../../packages/legal-rules/packs/bc-forest-permits.json'
import type { Fetch, Shape } from '../wfsReads'
import { withSignalEvidence } from './ExceptionClaim'
import {
  AUTHORITY_FIELDS,
  BLOCK_FIELDS,
  HARVEST_AUTHORITY_LAYER,
  MIN_RECORD_OVERLAP_HA,
  readTenureSignals,
  signalsOf,
  type TenureRecord,
} from './tenureSignals'

// A made-up block and made-up records: no real licence, permit or opening.
const square = (x: number, y: number, d: number): Shape => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + d, y],
      [x + d, y + d],
      [x, y + d],
      [x, y],
    ],
  ],
})
const footprint = square(-122.5, 54, 0.01)
const record = (kind: TenureRecord['kind'], id: string, fields: Record<string, string>): TenureRecord => ({
  kind,
  id,
  overlapHa: 30,
  sharePercent: 50,
  fields,
})

describe('tenure record signals', () => {
  it('says what each record says, on the exception it bears on, and never why', () => {
    const signals = signalsOf([
      record('authority', 'A99999 · CP 7', {
        FOREST_FILE_ID: 'A99999',
        CUTTING_PERMIT_ID: '7',
        CATASTROPHIC_IND: 'Y',
        SALVAGE_TYPE_CODE: 'FIR',
        ISSUE_DATE: '2019-03-04',
        HARVEST_AUTH_STATUS_CODE: 'HC',
      }),
      record('cut-block', 'Cut block A99999 CP 7 block 2', { SP_EXEMPT_IND: 'Y' }),
      record('opening', 'Opening 42', { OPENING_CATEGORY_CODE: 'SPEX' }),
      record('opening', 'Opening 43', { OPENING_CATEGORY_CODE: 'FTML' }),
      record('authority', 'A99998', { CATASTROPHIC_IND: 'N', ISSUE_DATE: '2019-03-04' }),
    ])
    expect(signals.map((s) => [s.pack, s.exception, s.record])).toEqual([
      ['bc.fppr', 'salvage-or-natural', 'A99999 · CP 7'],
      ['bc.forest-permits', 'earlier-permit', 'A99999 · CP 7'],
      ['bc.forest-permits', 'fppr-33-cutblock', 'Cut block A99999 CP 7 block 2'],
      ['bc.forest-permits', 'fppr-33-cutblock', 'Opening 42'],
    ])
    expect(signals[0].text).toContain('catastrophic (CATASTROPHIC_IND = Y), salvage type FIR')
    expect(signals[1]).toMatchObject({ date: '2019-03-04' })
    for (const s of signals) {
      expect(s.text).toMatch(/does not say/)
      expect(s.text).not.toMatch(/compl|exception (holds|applies)/i)
    }
  })

  it('names only exceptions the shipped releases list', () => {
    const fppr = parsePack(fpprPack)
    const permits = parsePack(permitsPack)
    const listed = (pack: typeof fppr, id: string) => pack.rules.some((r) => r.exceptions?.some((x) => x.id === id))
    expect(listed(fppr, 'salvage-or-natural')).toBe(true)
    expect(listed(permits, 'earlier-permit')).toBe(true)
    expect(listed(permits, 'fppr-33-cutblock')).toBe(true)
  })

  it('reads by the block’s own parts, keeps no client field and leaves out slivers and failed layers as such', async () => {
    const asked: URLSearchParams[] = []
    const fetcher: Fetch = async (_url, init) => {
      const body = new URLSearchParams(init?.body)
      asked.push(body)
      const layer = body.get('typeNames')
      if (layer?.includes('RSLT_OPENING')) return { ok: false, status: 503, json: async () => ({}) }
      const features =
        layer === HARVEST_AUTHORITY_LAYER
          ? [
              {
                geometry: footprint,
                properties: {
                  OBJECTID: 1,
                  FOREST_FILE_ID: 'A99999',
                  CUTTING_PERMIT_ID: '7',
                  CATASTROPHIC_IND: 'Y',
                  ISSUE_DATE: '2019-03-04Z',
                  CLIENT_NAME: 'Should never be kept',
                  CLIENT_NUMBER: '00000001',
                },
              },
              { geometry: square(-122.49, 54, 0.01), properties: { OBJECTID: 2, FOREST_FILE_ID: 'A99997' } },
            ]
          : [
              {
                geometry: footprint,
                properties: { OBJECTID: 3, CUT_BLOCK_FOREST_FILE_ID: 'A99999', SP_EXEMPT_IND: 'Y', CLIENT_NAME: 'x' },
              },
            ]
      return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features }) }
    }
    // The second authority only touches the block: below the sliver, it offers nothing.
    const measure = (_f: Shape, others: Shape[]) => ({
      footprintHa: 60,
      eachHa: others.map((o) => (o === footprint ? 60 : MIN_RECORD_OVERLAP_HA / 10)),
    })
    const read = await readTenureSignals({ footprint, fetch: fetcher, measure, readOn: '2026-11-27' })
    for (const body of asked) {
      expect(body.get('CQL_FILTER')).toMatch(/^INTERSECTS\(GEOMETRY,SRID=4326;POLYGON\(\(/)
      expect(body.has('bbox')).toBe(false)
      expect(body.get('propertyName')).not.toMatch(/CLIENT/)
    }
    expect(read.records.map((r) => r.id)).toEqual(['A99999 · CP 7', 'Cut block A99999'])
    expect(read.slivers).toBe(1)
    expect(JSON.stringify(read)).not.toMatch(/CLIENT|Should never/)
    expect(read.failed).toEqual([{ layer: 'opening', message: expect.stringContaining('503') }])
    expect(read.signals.map((s) => s.exception)).toEqual(['salvage-or-natural', 'earlier-permit', 'fppr-33-cutblock'])
    expect(AUTHORITY_FIELDS.some((f) => f.startsWith('CLIENT'))).toBe(false)
    expect(BLOCK_FIELDS.some((f) => f.startsWith('CLIENT'))).toBe(false)
  })

  it('puts a record in a claim only by the reviewer’s click, as evidence, and never clears the finding', () => {
    const fppr = parsePack(fpprPack)
    const [signal] = signalsOf([
      record('authority', 'A99999 · CP 7', { CATASTROPHIC_IND: 'Y', ISSUE_DATE: '2019-03-04', CUTTING_PERMIT_ID: '7' }),
    ])
    const claim = withSignalEvidence({ rule: 'limit-60', exception: 'salvage-or-natural' }, signal)
    expect(claim.evidence).toEqual([{ label: 'Other evidence', reference: signal.text, date: '2019-03-04' }])
    // Once only, and appended to what the reviewer wrote.
    expect(withSignalEvidence(claim, signal)).toBe(claim)
    const typed = withSignalEvidence(
      { ...claim, evidence: [{ label: 'Other evidence', reference: 'Fire report 12' }] },
      signal,
    )
    expect(typed.evidence?.[0].reference).toBe(`Fire report 12 ${signal.text}`)
    const report = assess(
      '2026-11-27',
      [fppr],
      [
        {
          format: 'pgmaps-legal-facts/v1',
          pack: fppr.id,
          version: fppr.version,
          source: 'test',
          facts: Object.entries({ applicable: true, holder: true, minor: false, region: 'Omineca', nar: 120 }).map(
            ([id, value]) => ({ id, value }),
          ),
          claims: [claim],
        },
      ],
    )
    const finding = report.releases[0].findings.find((f) => f.rule === 'limit-60')!
    expect(finding.status).toBe('review_required')
    expect('exception' in finding && finding.exception?.standing).toBe('relied_on')
  })
})
