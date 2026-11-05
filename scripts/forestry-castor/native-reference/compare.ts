/** Compare fresh R/SpaDES evidence with the production TypeScript engine. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runCastor } from '../../../src/features/forestry-castor/engine'
import { parseLegacyPredicate } from '../../../src/features/forestry-castor/legacyPredicates'
import {
  DEFAULT_CASTOR_CONFIG,
  type CastorProject,
  type CastorConfig,
} from '../../../src/features/forestry-castor/types'

interface InputPixel {
  pixelid: number
  blockid: number
  compartid: string
  own: number
  thlb: number
  age: number
  vol: number
  height: number
  eca: number
  dist: number
  salvage_vol: number
  yieldid: number
  yieldid_trans: number
  crownclosure: number
  basalarea: number
  qmd: number
  dec_pcnt: number
  zone1: number
}
interface InputYield {
  yieldid: number
  age: number
  tvol: number
  height: number
  eca: number
  crownclosure: number
  basalarea: number
  qmd: number
  dec_pcnt: number
}
interface InputConstraint {
  id: number
  zone_column: string
  zoneid: number
  type: 'ge' | 'le' | 'nh'
  variable: string
  threshold: number
  percentage: number
  start: number
  stop: number
  denom: string | null
  multi_condition: string | null
}
interface InputFlow {
  compartment: string
  period: number
  flow: number
  partition: string
  partition_type: 'live' | 'dead'
}
interface SharedCase {
  id: string
  periods: number
  stepYears: number
  pixels: InputPixel[]
  yields: InputYield[]
  constraints: InputConstraint[]
  flows: InputFlow[]
  schedule: { period: number; pixelid: number }[]
}
interface NativePixel {
  pixelid: number
  age: number
  vol: number
  height: number
  eca: number
  zone_const: number
  yieldid: number
  salvage_vol: number
  crownclosure: number
  basalarea: number
  qmd: number
}
export interface NativeEvidence {
  schema: string
  harnessSha256: string
  casesSha256: string
  R: string
  packages: Record<string, string>
  sources: Record<string, string>
  cases: {
    id: string
    error?: string | null
    snapshots: {
      period: number
      phase: string
      pixels: NativePixel[]
      constraintPeriods: number[]
      harvested: { pixelid: number }[] | null
      landings: number[] | null
      harvestYear: number[]
      harvestVolumeM3: number[]
    }[]
    harvestReport: { timeperiod: number; volume: number; area: number }[]
    growingStockReport: { timeperiod: number; compartment: string; m_gs: number }[]
    zoneManagement: { zoneid: number; variable: string; timeperiod: number; percent: number }[]
  }[]
}
export interface Difference {
  path: string
  native: number | number[]
  browser: number | number[]
}
export interface CaseComparison {
  id: string
  comparisons: number
  sourceError: string | null
  differences: Difference[]
}
const root = resolve(import.meta.dirname, '../../..')
const folder = resolve(root, 'scripts/forestry-castor/native-reference')
const casesBytes = readFileSync(resolve(folder, 'cases.json'))
const fixture = JSON.parse(casesBytes.toString()) as {
  base: Omit<SharedCase, 'id'>
  cases: (Partial<SharedCase> & { id: string })[]
}
export function compareNative(native: NativeEvidence): CaseComparison[] {
  assert.equal(native.schema, 'castor-native-output-v1')
  assert.equal(
    native.harnessSha256,
    createHash('sha256')
      .update(readFileSync(resolve(folder, 'run.R')))
      .digest('hex'),
    'Native evidence must use this exact harness',
  )
  assert.equal(
    native.casesSha256,
    createHash('sha256').update(casesBytes).digest('hex'),
    'Native evidence must use these exact inputs',
  )
  assert.deepEqual(Object.keys(native.sources).sort(), ['upstream-forestryCastor.R', 'upstream-growingStockCastor.R'])
  assert.equal(native.R, '4.5.0', 'Native evidence must use the reviewed R runtime')
  for (const [name, expected] of Object.entries(native.sources)) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(resolve(folder, '../reference', name)))
        .digest('hex'),
      expected,
      name,
    )
  }
  const results: CaseComparison[] = []
  assert.deepEqual(
    native.cases.map((c) => c.id),
    fixture.cases.map((c) => c.id),
    'Every fixture must run exactly once, in order',
  )
  for (const [name, version] of Object.entries({
    'SpaDES.core': '2.1.8',
    RSQLite: '2.3.9',
    'data.table': '1.17.0',
    terra: '1.8.29',
    raster: '3.6.31',
    dplyr: '1.1.4',
    jsonlite: '1.9.1',
    digest: '0.6.37',
    reproducible: '2.1.2',
    quickPlot: '1.0.2',
    Require: '0.3.1',
    qs: '0.27.3',
    RcppParallel: '5.1.11.1',
    stringfish: '0.16.0',
    fpCompare: '0.2.6',
  }))
    assert.equal(native.packages[name], version, `Native package version: ${name}`)
  for (const override of fixture.cases) {
    const entry: SharedCase = { ...fixture.base, ...override }
    const source = native.cases.find((item) => item.id === entry.id)
    assert.ok(source, `Missing native case ${entry.id}`)
    assert.deepEqual(
      source.snapshots.map((snapshot) => [snapshot.period, snapshot.phase]),
      [
        [0, 'initial'],
        ...Array.from({ length: entry.periods }, (_, i) => [
          [i + 1, 'before'],
          [i + 1, 'after'],
        ]).flat(),
      ],
      `${entry.id}: missing or out-of-order snapshots`,
    )
    const curveIds = [...new Set(entry.yields.map((point) => point.yieldid))]
    const project: CastorProject = {
      schema: 'pgmaps-castor-project-v1',
      name: entry.id,
      description: 'Shared synthetic native-model input',
      provenance: { source: 'Pinned R/SpaDES comparison fixture', notes: [], synthetic: true },
      pixels: entry.pixels.map((p) => ({
        id: p.pixelid,
        blockId: String(p.blockid),
        compartment: p.compartid,
        owned: p.own === 1,
        areaHa: 1,
        thlbHa: p.thlb,
        age: p.age,
        volume: p.vol,
        height: p.height,
        eca: p.eca,
        distance: p.dist,
        salvageVolume: p.salvage_vol,
        curveId: String(p.yieldid),
        managedCurveId: String(p.yieldid_trans),
        crownClosure: p.crownclosure,
        basalArea: p.basalarea,
        qmd: p.qmd,
        deciduousPercent: p.dec_pcnt,
        zones: { zone1: String(p.zone1) },
      })),
      yieldCurves: curveIds.map((id) => ({
        id: String(id),
        points: entry.yields
          .filter((p) => p.yieldid === id)
          .map((p) => ({
            age: p.age,
            volume: p.tvol,
            height: p.height,
            eca: p.eca,
            crownClosure: p.crownclosure,
            basalArea: p.basalarea,
            qmd: p.qmd,
            deciduousPercent: p.dec_pcnt,
          })),
      })),
      constraints: entry.constraints.map((c) => ({
        id: String(c.id),
        zone: c.zone_column,
        zoneId: String(c.zoneid),
        type: c.type,
        variable: c.variable === 'dist' ? 'distance' : c.variable,
        threshold: c.threshold,
        percentage: c.percentage,
        startYear: c.start,
        stopYear: c.stop,
        denominator: c.denom ? parseLegacyPredicate(c.denom) : undefined,
        condition: c.multi_condition ? parseLegacyPredicate(c.multi_condition) : undefined,
      })),
      harvestFlows: entry.flows.map((f, i) => ({
        id: `flow-${i}`,
        compartment: f.compartment,
        period: f.period,
        targetM3: f.flow,
        type: f.partition_type === 'dead' ? 'salvage' : 'live',
        condition: parseLegacyPredicate(f.partition),
      })),
      landings: entry.pixels.map((p) => ({ blockId: String(p.blockid), pixelId: p.pixelid })),
      adjacency: [],
      schedule: entry.schedule.map((s) => ({ period: s.period, pixelIds: [s.pixelid] })),
    }
    const config: CastorConfig = {
      ...DEFAULT_CASTOR_CONFIG,
      scenario: entry.id,
      periods: entry.periods,
      stepYears: entry.stepYears,
      startYear: 0,
      mode: entry.schedule.length ? 'schedule' : 'queue',
    }
    const browser = runCastor(project, config)
    const differences: Difference[] = []
    let comparisons = 0
    function check(path: string, a: number | number[], b: number | number[]) {
      for (const value of [a, b].flat())
        assert.ok(typeof value === 'number' && Number.isFinite(value), `${entry.id}/${path}: nonfinite value`)
      comparisons++
      const equal =
        typeof a === 'number' && typeof b === 'number'
          ? Math.abs(a - b) <= 1e-9
          : JSON.stringify(a) === JSON.stringify(b)
      if (!equal) differences.push({ path, native: a, browser: b })
    }
    for (const snap of source.snapshots) {
      assert.deepEqual(
        snap.pixels.map((pixel) => pixel.pixelid),
        entry.pixels.map((pixel) => pixel.pixelid),
        `${entry.id}: snapshot pixel order`,
      )
      for (const field of ['constraintPeriods', 'harvestYear', 'harvestVolumeM3'] as const)
        assert.equal(snap[field].length, entry.pixels.length, `${entry.id}: ${field} raster length`)
      if (snap.phase === 'before') {
        for (const compartment of [...new Set(entry.pixels.map((p) => p.compartid))]) {
          const nativeStock = snap.pixels.reduce(
            (sum, p, i) => sum + (entry.pixels[i].compartid === compartment ? p.vol * entry.pixels[i].thlb : 0),
            0,
          )
          const row = browser.growingStockReport.find(
            (r) => r.period === snap.period && r.phase === 'before-harvest' && r.compartment === compartment,
          )
          assert.ok(row)
          check(`beforeStock.${snap.period}.${compartment}`, nativeStock, row.stockM3)
        }
        continue
      }
      const prefix = snap.period > 0 ? runCastor(project, { ...config, periods: snap.period }) : null
      const b = browser.snapshots[snap.period]
      for (const [index, p] of snap.pixels.entries()) {
        for (const [r, ts] of [
          ['age', 'age'],
          ['vol', 'volume'],
          ['height', 'height'],
          ['eca', 'eca'],
          ['zone_const', 'constrained'],
        ] as const) {
          check(`period.${snap.period}.pixel.${p.pixelid}.${ts}`, p[r], b[ts][index]!)
        }
        check(
          `period.${snap.period}.pixel.${p.pixelid}.constrainedPeriods`,
          snap.constraintPeriods[index],
          b.constrainedPeriods[index],
        )
        check(
          `period.${snap.period}.pixel.${p.pixelid}.harvestYear`,
          snap.harvestYear[index],
          b.harvestedYear[index] ?? 0,
        )
        check(
          `period.${snap.period}.pixel.${p.pixelid}.harvestVolumeM3`,
          snap.harvestVolumeM3[index],
          b.harvestedVolumeM3[index],
        )
        if (prefix) {
          const final = prefix.finalPixels[index]
          check(`period.${snap.period}.pixel.${p.pixelid}.yieldid`, p.yieldid, Number(final.curveId))
          for (const [r, ts] of [
            ['salvage_vol', 'salvageVolume'],
            ['crownclosure', 'crownClosure'],
            ['basalarea', 'basalArea'],
            ['qmd', 'qmd'],
          ] as const)
            check(`period.${snap.period}.pixel.${p.pixelid}.${ts}`, p[r], final[ts]!)
        }
      }
      if (snap.phase === 'after') {
        const selected = (snap.harvested ?? []).map((p) => p.pixelid).sort((a, b) => a - b)
        check(
          `period.${snap.period}.landings`,
          [...(snap.landings ?? [])].sort((a, b) => a - b),
          browser.landings
            .filter((r) => r.period === snap.period)
            .map((r) => r.pixelId)
            .sort((a, b) => a - b),
        )
        const events = browser.harvestPixelList.filter((p) => p.period === snap.period)
        check(
          `period.${snap.period}.selected`,
          selected,
          events.map((p) => p.pixelId).sort((a, b) => a - b),
        )
        const report = source.harvestReport.filter((r) => r.timeperiod === snap.period * entry.stepYears)
        const nativeVolume = report.reduce((sum, r) => sum + r.volume * entry.stepYears, 0)
        check(
          `period.${snap.period}.harvestVolumeM3`,
          nativeVolume,
          events.reduce((sum, p) => sum + p.volumeM3, 0),
        )
        check(
          `period.${snap.period}.harvestAreaHa`,
          report.reduce((sum, r) => sum + r.area * entry.stepYears, 0),
          events.reduce((sum, p) => sum + p.areaHa, 0),
        )
      }
    }
    for (const r of source.growingStockReport ?? []) {
      const b = browser.growingStockReport.find(
        (row) =>
          row.elapsedYears === r.timeperiod &&
          row.compartment === r.compartment &&
          row.phase === (r.timeperiod === 0 ? 'initial' : 'after-harvest'),
      )
      assert.ok(b)
      check(`stock.${r.timeperiod}.${r.compartment}`, r.m_gs, b.stockM3)
    }
    for (const r of source.zoneManagement) {
      const row = browser.zoneManagement.find(
        (b) =>
          b.period === r.timeperiod &&
          b.zoneId === String(r.zoneid) &&
          b.variable === (r.variable === 'dist' ? 'distance' : r.variable) &&
          b.phase === 'before-harvest',
      )
      assert.ok(row, `Missing browser constraint report: ${entry.id}`)
      check(`constraint.${r.timeperiod}.${r.zoneid}.${r.variable}.percent`, r.percent, row.actualPercent)
    }
    results.push({ id: entry.id, comparisons, sourceError: source.error ?? null, differences })
  }
  return results
}

interface ExpectedDifference extends Difference {
  reason: string
}
interface ExpectedDocument {
  schema: string
  reasons: Record<string, string>
  cases: { id: string; differences: ExpectedDifference[] }[]
}
/** No wildcard exclusions: every reviewed difference has an exact path and both numerical values. */
export function assertExpectedDifferences(results: CaseComparison[]): void {
  const expected = JSON.parse(readFileSync(resolve(folder, 'expected-differences.json'), 'utf8')) as ExpectedDocument
  assert.equal(expected.schema, 'castor-expected-differences-v1')
  for (const result of results) {
    assert.equal(result.sourceError, null, `${result.id}: native execution failed`)
    const entry = expected.cases.find((c) => c.id === result.id)
    assert.ok(entry, `Unreviewed case: ${result.id}`)
    assert.deepEqual(
      result.differences.map((d) => d.path),
      entry.differences.map((d) => d.path),
      `${result.id}: unexplained difference paths`,
    )
    for (const [index, difference] of result.differences.entries()) {
      const reviewed: ExpectedDifference = entry.differences[index]
      assert.ok(expected.reasons[reviewed.reason], `Missing explanation: ${reviewed.reason}`)
      for (const field of ['native', 'browser'] as const) {
        const actual = difference[field]
        const value: number | number[] = reviewed[field]
        if (typeof actual === 'number' && typeof value === 'number')
          assert.ok(Math.abs(actual - value) <= 1e-9, `${result.id}/${difference.path}/${field}: ${actual} != ${value}`)
        else assert.deepEqual(actual, value, `${result.id}/${difference.path}/${field}`)
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const native = JSON.parse(
    readFileSync(process.argv[2] ?? resolve(folder, 'native-output.json'), 'utf8'),
  ) as NativeEvidence
  const results = compareNative(native)
  writeFileSync(
    resolve(folder, 'comparison.json'),
    JSON.stringify(
      { schema: 'castor-native-comparison-v1', nativeRuntime: native.R, packages: native.packages, results },
      null,
      2,
    ) + '\n',
  )
  console.log(
    JSON.stringify(
      {
        cases: results.length,
        comparisons: results.reduce((n, r) => n + r.comparisons, 0),
        differences: results.reduce((n, r) => n + r.differences.length, 0),
        details: results.map((r) => ({ id: r.id, count: r.differences.length, error: r.sourceError })),
      },
      null,
      2,
    ),
  )
}
