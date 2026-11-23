import { expect, it } from 'vitest'
import fppr from '../packs/bc-fppr.json'
import { parsePack } from '../src/contract'
import { assess } from '../engine/evaluate'
import { spatialFacts } from '../engine/spatialFacts'
import { exampleProject } from '../../../src/pages/forest-patches/project'
import { blockAreaHa } from '../../../src/lib/forestry/blockSheet/blockFacts'
import { overlapHa, readZones } from '../../../src/pages/block-planning/riparian'

it('resolves mapped area once per block and keeps an absent zone layer unknown', () => {
  const { features } = exampleProject()
  const geometry = features[0].geometry
  const zones = readZones({ type: 'FeatureCollection', features: [features[0], features[0]] }, 'zone inventory')
  expect(overlapHa(geometry, zones)).toBeCloseTo(blockAreaHa(geometry), 5)
  expect(overlapHa(features[1].geometry, zones)).toBe(0)
  expect(overlapHa(geometry)).toBeNull()
})
it('can bind a new pack to an existing measurement without changing the engine', () => {
  const pack = parsePack({
    ...fppr,
    facts: [...fppr.facts, { id: 'zone-area', type: 'number', label: 'Mapped area', unit: 'ha' }],
    spatialBindings: [{ fact: 'zone-area', operation: 'mapped-riparian-overlap-v1', output: 'overlap-ha' }],
  })
  const measured = spatialFacts(pack, [
    { operation: 'mapped-riparian-overlap-v1', output: 'overlap-ha', value: 0, evidence: 'Inventory 2025' },
  ])
  expect(measured).toEqual([{ id: 'zone-area', value: 0, evidence: 'Inventory 2025' }])
  expect(spatialFacts(pack, [])[0].value).toBeNull()
  expect(() => parsePack({ ...pack, spatialBindings: [{ ...pack.spatialBindings![0], output: 'unknown' }] })).toThrow(
    /binding/,
  )
})
it('requires verified NAR even when the mapped gross block area is known', () => {
  const pack = parsePack(fppr)
  const set = {
    format: 'pgmaps-legal-facts/v1' as const,
    pack: pack.id,
    version: pack.version,
    source: 'Planning record',
    facts: [
      { id: 'region', value: 'Omineca' },
      { id: 'minor', value: false },
      { id: 'holder', value: true },
      { id: 'applicable', value: true },
    ],
  }
  const findings = assess('2026-11-17', [pack], [set]).releases[0].findings
  expect(findings.find((row) => row.rule === 'limit-60')?.status).toBe('missing_evidence')
})
