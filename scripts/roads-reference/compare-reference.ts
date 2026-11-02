/** Compare native R output with the actual TypeScript exports; never substitute a hand-computed R reference. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { ROADS_UPSTREAM } from '../../src/pages/dev-forestry-roads/roads/compatibility'
import { getCLUSExample } from '../../src/pages/dev-forestry-roads/roads/examples'
import { projectRoads, extendRoads } from '../../src/pages/dev-forestry-roads/roads/projectRoads'
import { simpleCostFn, gradePenaltyFn } from '../../src/pages/dev-forestry-roads/roads/weights'
import type { GradePenaltyOptions, RoadsMethod, RoadsResult } from '../../src/pages/dev-forestry-roads/roads/types'

const directory = dirname(fileURLToPath(import.meta.url))
type FormulaCase = {
  id: string
  function: 'simpleCostFn' | 'gradePenaltyFn'
  x1: number | null
  x2: number | null
  distance: number
  options?: Partial<GradePenaltyOptions>
}
interface Cases {
  schema: string
  repository: string
  version: string
  commit: string
  methods: ('lcp' | 'mst' | 'snap')[]
  formulaCases: FormulaCase[]
}
interface EncodedNumber {
  kind: 'finite' | 'missing' | 'positive-infinity' | 'negative-infinity'
  value: number | null
}
interface NativeReference {
  schema: string
  producer: string
  upstream: { repository: string; version: string; commit: string }
  generatedAt: string
  session: { R: string; platform: string; packages: Record<string, string> }
  fixture: {
    name: string
    grid: { origin: number[]; width: number; height: number; cellM: number; values: number[] }
    roadCells: number[]
    landingCells: number[]
  }
  formulas: { id: string; function_name: string; result: EncodedNumber }[]
  networks: { method: string; roadCells: number[]; rasterRoadCells: number[] }[]
  diagnostics?: {
    ilcp?: { error?: string; roadCells?: number[] }
    staged_ilcp?: { error?: string; stageLandingIndexes?: number[][]; stages?: { roadCells: number[] }[] }
  }
}
type Check = { id: string; passed: boolean; expected?: unknown; actual?: unknown; detail?: string }

function loadCases(): Cases {
  const cases = JSON.parse(readFileSync(resolve(directory, 'cases.json'), 'utf8')) as Cases
  if (cases.schema !== 'pgmaps-roads-reference-cases-v1') throw Error('Unknown reference case schema.')
  for (const key of ['repository', 'version', 'commit'] as const) {
    if (cases[key] !== ROADS_UPSTREAM[key]) throw Error(`Reference ${key} disagrees with the browser source inventory.`)
  }
  if (JSON.stringify(cases.methods) !== JSON.stringify(['lcp', 'mst', 'snap']))
    throw Error('The three fixed-fixture methods are required.')
  const ids = new Set<string>()
  if (!cases.formulaCases.length) throw Error('Reference formula cases are missing.')
  for (const test of cases.formulaCases) {
    if (!test.id || ids.has(test.id)) throw Error('Reference case IDs must be non-empty and unique.')
    ids.add(test.id)
    if (!['simpleCostFn', 'gradePenaltyFn'].includes(test.function)) throw Error('Unknown formula case.')
    if (![test.x1, test.x2].every((value) => value === null || (typeof value === 'number' && Number.isFinite(value))))
      throw Error('Formula endpoints must be finite or explicitly missing.')
    if (!Number.isFinite(test.distance) || test.distance <= 0)
      throw Error('Formula cases require a positive finite distance.')
    if (test.options && Object.values(test.options).some((value) => !Number.isFinite(value) || value < 0))
      throw Error('Formula options require non-negative finite values.')
  }
  return cases
}

function close(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))
}
function equalNumbers(a: number[], b: number[]): boolean {
  return (
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => close(value, b[index]))
  )
}
function equalCells(a: number[], b: number[]): boolean {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => Number.isInteger(value) && value === b[index])
  )
}
function encode(value: number): EncodedNumber {
  if (Number.isNaN(value)) return { kind: 'missing', value: null }
  if (!Number.isFinite(value)) return { kind: value > 0 ? 'positive-infinity' : 'negative-infinity', value: null }
  return { kind: 'finite', value }
}
function numberEqual(expected: EncodedNumber, actual: EncodedNumber): boolean {
  return (
    expected.kind === actual.kind &&
    (expected.kind !== 'finite' ||
      (typeof expected.value === 'number' && typeof actual.value === 'number' && close(expected.value, actual.value)))
  )
}

export function compareReference(reference: NativeReference) {
  const start = performance.now()
  const cases = loadCases()
  if (reference.schema !== 'pgmaps-roads-native-r-reference-v1' || reference.producer !== 'native-R-roads-package') {
    throw Error('Supply output generated by generate-reference.R with the installed native R package.')
  }
  for (const key of ['repository', 'version', 'commit'] as const) {
    if (reference.upstream?.[key] !== cases[key])
      throw Error(`Native R reference ${key} does not match the pinned source.`)
  }
  if (!reference.session?.R?.startsWith('R version ') || reference.session.packages?.roads !== cases.version) {
    throw Error('Native R version and package-session evidence are missing.')
  }
  const gates: Check[] = []
  const add = (id: string, passed: boolean, expected: unknown, actual: unknown) =>
    gates.push({ id, passed, expected, actual })
  const fixture = getCLUSExample()
  const rGrid = reference.fixture?.grid
  add('fixture.name', reference.fixture?.name === 'CLUSexample', 'CLUSexample', reference.fixture?.name)
  add(
    'fixture.dimensions',
    rGrid?.width === fixture.grid.width && rGrid?.height === fixture.grid.height,
    [fixture.grid.width, fixture.grid.height],
    [rGrid?.width, rGrid?.height],
  )
  add('fixture.origin', equalNumbers(rGrid?.origin ?? [], fixture.grid.origin), fixture.grid.origin, rGrid?.origin)
  add('fixture.spacing', close(rGrid?.cellM, fixture.grid.cellM), fixture.grid.cellM, rGrid?.cellM)
  add(
    'fixture.values',
    equalNumbers(rGrid?.values ?? [], Array.from(fixture.grid.values)),
    Array.from(fixture.grid.values),
    rGrid?.values,
  )
  add(
    'fixture.seed-cells',
    equalCells(reference.fixture?.roadCells ?? [], fixture.roadCells),
    fixture.roadCells,
    reference.fixture?.roadCells,
  )
  add(
    'fixture.landing-cells',
    equalCells(
      reference.fixture?.landingCells ?? [],
      fixture.landings.map((target) => target.cell),
    ),
    fixture.landings.map((target) => target.cell),
    reference.fixture?.landingCells,
  )
  const formulas = Array.isArray(reference.formulas) ? reference.formulas : []
  add(
    'formulas.count',
    formulas.length === cases.formulaCases.length && new Set(formulas.map((f) => f.id)).size === formulas.length,
    cases.formulaCases.length,
    formulas.length,
  )
  for (const test of cases.formulaCases) {
    const native = formulas.find((formula) => formula.id === test.id)
    const value =
      test.function === 'simpleCostFn'
        ? simpleCostFn(test.x1 ?? NaN, test.x2 ?? NaN, test.distance)
        : gradePenaltyFn(test.x1 ?? NaN, test.x2 ?? NaN, test.distance, test.options)
    const actual = encode(value)
    add(
      `formula.${test.id}`,
      native?.function_name === test.function && !!native.result && numberEqual(native.result, actual),
      native?.result ?? 'missing native case',
      actual,
    )
  }
  const networks = Array.isArray(reference.networks) ? reference.networks : []
  add(
    'networks.count',
    networks.length === cases.methods.length && new Set(networks.map((n) => n.method)).size === networks.length,
    cases.methods.length,
    networks.length,
  )
  for (const method of cases.methods) {
    const native = networks.find((network) => network.method === method)
    const result = projectRoads({ ...fixture, options: { ...fixture.options, method } })
    add(
      `network.${method}.road-cells`,
      !!native && equalCells(native.roadCells, result.simulation.roadCells),
      native?.roadCells ?? 'missing native method',
      result.simulation.roadCells,
    )
    add(
      `network.${method}.connected-targets`,
      result.targets.every((target) => target.status === 'connected'),
      fixture.landings.length,
      result.targets.filter((target) => target.status === 'connected').length,
    )
  }

  const diagnostics: Check[] = []
  const recordDiagnostic = (id: string, nativeCells: number[] | undefined, result: RoadsResult, error?: string) => {
    diagnostics.push({
      id,
      passed: !!nativeCells && equalCells(nativeCells, result.simulation.roadCells),
      expected: nativeCells ?? error ?? 'native diagnostic unavailable',
      actual: result.simulation.roadCells,
      detail:
        'Informational: staged vector-road targets and cell-centre targets can differ; this comparison is recorded without claiming universal tie or geometry parity.',
    })
  }
  const ilcp = projectRoads({ ...fixture, options: { ...fixture.options, method: 'ilcp' } })
  recordDiagnostic('diagnostic.ilcp', reference.diagnostics?.ilcp?.roadCells, ilcp, reference.diagnostics?.ilcp?.error)
  const nativeStages = reference.diagnostics?.staged_ilcp
  const stageIndexes = nativeStages?.stageLandingIndexes ?? [
    [0, 1],
    [2, 3],
  ]
  let staged: RoadsResult | undefined
  for (let index = 0; index < stageIndexes.length; index++) {
    const landingIndexes = stageIndexes[index]
    if (
      !Array.isArray(landingIndexes) ||
      !landingIndexes.length ||
      landingIndexes.some((i) => !Number.isInteger(i) || i < 0 || i >= fixture.landings.length)
    ) {
      diagnostics.push({
        id: `diagnostic.stage-${index + 1}`,
        passed: false,
        detail: 'Invalid native stage target indexes.',
      })
      break
    }
    const landings = landingIndexes.map((i) => fixture.landings[i])
    staged = staged
      ? extendRoads(staged.simulation, landings)
      : projectRoads({ ...fixture, landings, options: { ...fixture.options, method: 'ilcp' as RoadsMethod } })
    recordDiagnostic(
      `diagnostic.stage-${index + 1}`,
      nativeStages?.stages?.[index]?.roadCells,
      staged,
      nativeStages?.error,
    )
  }
  return {
    schema: 'pgmaps-roads-r-comparison-v1',
    passed: gates.every((gate) => gate.passed),
    checkedAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - start),
    upstream: reference.upstream,
    referenceGeneratedAt: reference.generatedAt,
    session: reference.session,
    nodeVersion: process.version,
    tolerance: '1e-12 × max(1, |R|, |TypeScript|) for finite values; exact missing states and cell arrays',
    gates,
    diagnostics,
    scope:
      '25 scalar formula cases and the exact CLUS LCP/MST/snap road-cell fixture. No universal geometry, R object, random sampling or engineering-validation claim.',
  }
}

export function main(args = process.argv.slice(2)): void {
  if (args[0] === '--check-config') {
    const cases = loadCases()
    console.log(
      `Reference configuration valid: ${cases.formulaCases.length} formulas, ${cases.methods.join(', ')}, roads@${cases.commit}. Native R has not been run by this command.`,
    )
    return
  }
  const referencePath = resolve(args[0] ?? resolve(directory, 'output/native-r.json'))
  const outputPath = resolve(args[1] ?? resolve(directory, 'output/comparison.json'))
  mkdirSync(dirname(outputPath), { recursive: true })
  try {
    const reference = JSON.parse(readFileSync(referencePath, 'utf8')) as NativeReference
    const report = compareReference(reference)
    writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n')
    console.log(
      JSON.stringify(
        {
          passed: report.passed,
          gates: report.gates.length,
          failures: report.gates.filter((gate) => !gate.passed),
          diagnostics: report.diagnostics.map(({ id, passed }) => ({ id, matches: passed })),
          report: outputPath,
        },
        null,
        2,
      ),
    )
    if (!report.passed) process.exitCode = 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeFileSync(
      outputPath,
      JSON.stringify({ schema: 'pgmaps-roads-r-comparison-v1', passed: false, error: message }, null, 2) + '\n',
    )
    console.error(message)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
