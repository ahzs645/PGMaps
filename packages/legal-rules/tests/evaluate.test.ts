import { describe, it, expect } from 'vitest'
import { assess } from '../engine/evaluate'
import { parsePack, parseFacts, authoringSchema, type Scalar, type Pack } from '../src/contract'
import bc from '../packs/bc-fppr.json'
import regional from '../packs/bc-pgtsa-biodiversity.json'
import example from '../examples/water-monitoring.json'
import waterFacts from '../examples/water-facts.json'
import { legacyPatchFacts } from '../../../src/pages/forest-patches/legacyFacts'
import { exampleProject } from '../../../src/pages/forest-patches/project'
const day = '2026-11-17'
const base = parsePack(bc),
  pg = parsePack(regional),
  water = parsePack(example)
function run(p: Pack, values: Record<string, Scalar | null>, date = day) {
  return assess(
    date,
    [p],
    [
      {
        format: 'pgmaps-legal-facts/v1',
        pack: p.id,
        version: p.version,
        source: 'test',
        facts: Object.entries(values).map(([id, value]) => ({ id, value })),
      },
    ],
  ).releases[0].findings
}
describe('declarative pack runtime', () => {
  it('runs an unrelated policy using the same interface', () => {
    const facts = parseFacts(waterFacts, water)
    expect(assess(day, [water], [facts]).releases[0].findings[0]).toMatchObject({
      status: 'review_required',
      provision: 'Teaching policy §1',
      actions: [{ kind: 'monitor' }],
    })
    expect(authoringSchema().properties?.format).toMatchObject({ const: 'pgmaps-legal-pack/v1' })
  })
  it('treats zero, false and unknown distinctly, including explicit missing readings', () => {
    expect(run(water, { site: false })[0].status).toBe('outside_scope')
    expect(run(water, { site: true, reading: 0 })[0].status).toBe('condition_not_triggered')
    expect(run(water, { site: true, reading: null })[0].status).toBe('missing_evidence')
    expect(run(water, { reading: 20 })[0].status).toBe('missing_evidence')
  })
  it('uses three-valued logic in alternative condition groups', () => {
    const other = structuredClone(water)
    other.rules[0].when.push([{ fact: 'site', op: 'eq', value: true }])
    expect(run(other, { site: true })[0].status).toBe('review_required')
  })
  it('pins the coverage and the release used for each fact', () => {
    expect(run(base, {}, '2026-11-18')[0].status).toBe('outside_source_window')
    expect(() => parseFacts({ ...waterFacts, version: '1.0.1' }, water)).toThrow(/matching/)
    expect(() => assess(day, [water, { ...water, version: '2.0.0' }], [])).toThrow(/one release/)
  })
  it.each([
    ['Omineca', 60, 'condition_not_triggered'],
    ['Omineca', 61, 'review_required'],
    ['South Coast', 41, 'review_required'],
  ])('screens §64 with the regional value', (region, nar, status) => {
    const findings = run(base, { applicable: true, holder: true, minor: false, region, nar })
    expect(findings.find((r) => r.rule === (region === 'Omineca' ? 'limit-60' : 'limit-40'))?.status).toBe(status)
  })
  it('separates annual and per-block retention, including fibre recovery tenure', () => {
    const facts = {
      applicable: true,
      holder: true,
      completed: true,
      'period-ended': true,
      'retention-block': 3.5,
      'retention-period': 6.9,
      fibre: false,
    }
    const results = run(base, facts)
    expect(results.find((r) => r.rule === 'retention-period')?.status).toBe('review_required')
    expect(results.find((r) => r.rule === 'retention-block')?.status).toBe('condition_not_triggered')
    expect(run(base, { ...facts, fibre: true }).find((r) => r.rule === 'retention-block')?.status).toBe('outside_scope')
  })
  it('composes instruments while preserving independent regional decisions', () => {
    const facts = parseFacts(
      {
        format: 'pgmaps-legal-facts/v1',
        pack: pg.id,
        version: pg.version,
        source: 'reviewer',
        facts: [
          { id: 'applicable', value: true },
          { id: 'patch-class-away', value: true },
          { id: 'patch-unachievable', value: true },
          { id: 'old-unachievable', value: true },
        ],
      },
      pg,
    )
    const report = assess(day, [base, pg], [facts])
    expect(report.releases[0].findings[0].status).toBe('missing_evidence')
    expect(report.releases[1].findings.find((r) => r.rule === 'recruitment')).toMatchObject({
      actions: [{ kind: 'submit' }, { kind: 'obtain-approval' }, { kind: 'implement' }],
    })
    expect(report.releases[1].findings.find((r) => r.rule === 'rationale')).toMatchObject({
      actions: [{ kind: 'submit' }],
    })
    expect(run(pg, { applicable: true, 'patch-class-away': true }).find((r) => r.rule === 'rationale')?.status).toBe(
      'missing_evidence',
    )
  })
  it('rejects malformed imports and incompatible comparisons', () => {
    expect(() => parsePack({ ...example, script: 'some code' })).toThrow()
    const p = structuredClone(water)
    p.parameters[0].unit = 'm'
    expect(() => parsePack(p)).toThrow(/units/)
    p.rules[0].source = 'missing'
    expect(() => parsePack(p)).toThrow(/source/)
    expect(() => parseFacts({ ...waterFacts, facts: [{ id: 'reading', value: '15' }] }, water)).toThrow(
      /Invalid case fact/,
    )
  })
  it('adapts previous patch exports and explicitly records missing intervals', () => {
    const assessment = {
      method: 'pg-2005-buffer-v1',
      project: exampleProject(),
      displayed: { year: 2026, scenario: 'proposed' },
    }
    expect(parseFacts(legacyPatchFacts(assessment), pg).facts).toMatchObject([{ id: 'patch-class-away', value: null }])
    expect(
      typeof legacyPatchFacts({ ...assessment, displayed: { year: 2031, scenario: 'proposed' } }).facts[0].value,
    ).toBe('boolean')
  })
})

it('ships the generated releases and the schema used by the installer', async () => {
  const { readFileSync } = await import('node:fs')
  const { execFileSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  execFileSync(process.execPath, [
    fileURLToPath(new URL('../../../scripts/legal-rules/build-packs.mjs', import.meta.url)),
    '--check',
  ])
  const schema = JSON.parse(readFileSync(new URL('../schemas/legal-pack-v1.schema.json', import.meta.url), 'utf8'))
  expect(schema).toEqual(authoringSchema())
})
