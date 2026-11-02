/** Source-neutral snapshots; source adapters retain their own scientific meanings. */
export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue }
export interface ComparisonPeriod {
  label: string
  /** Both null means that the source's exact token is known but its bounds are not. */
  startYear: number | null
  endYear: number | null
  kind: string
}
export type ComparisonUnit = 'probability' | 'class' | 'score' | 'count' | 'ratio' | 'value' | 'category'
export type ComparisonValue = number | string | null
export interface ComparisonMetric {
  measure: string
  entity: string
  label?: string
  dimensions: Record<string, string>
  period: string | null
  /** Exact contributing IDs for aggregate metrics; absent means unspecified coverage. */
  periodCoverage?: string[]
  value: ComparisonValue
  unit: ComparisonUnit
  direction?: 'lower-better' | 'higher-better' | 'neutral'
  /** Required for numeric ordinal comparison, e.g. cciss-suitability-1-4. */
  scale?: string
  probabilityGroup?: string
}
export interface ComparisonProbabilityGroup {
  id: string
  measure: string
  period: string | null
  /** null means that entity itself is the category (for example a BGC label). */
  entity: string | null
  /** Fixed group dimensions; categoryDimensions names all varying dimensions. */
  dimensions: Record<string, string>
  categoryDimensions: string[]
  /** Only a validated, finite, sum-to-one group can imply absent categories = 0. */
  complete: boolean
}
export interface ComparisonSnapshot {
  schema: 'cciss-comparison-snapshot-v1'
  id: string
  label: string
  /** Different workflow families retain side-by-side values without arithmetic. */
  family: string
  provenance: {
    source: string
    version?: string
    method?: string
    synthetic?: boolean
    limitations?: string[]
    metadata?: Record<string, JSONValue>
  }
  /** Coordinates, site IDs, conditions and model weights belong here, not metric identity. */
  context: Record<string, JSONValue>
  periods: Record<string, ComparisonPeriod>
  metrics: ComparisonMetric[]
  probabilityGroups?: ComparisonProbabilityGroup[]
}
export interface ComparisonRow {
  key: string
  metric: ComparisonMetric
  left: ComparisonMetric | null
  right: ComparisonMetric | null
  leftValue: ComparisonValue
  rightValue: ComparisonValue
  /** B − A; probability changes are multiplied by 100 and expressed in points. */
  delta: number | null
  deltaUnit: 'percentage-points' | 'class-steps' | 'absolute' | 'none'
  compatible: boolean
  reason: string | null
  interpretation: 'improved' | 'declined' | 'unchanged' | 'changed' | 'unknown' | 'incompatible'
  leftImputed: boolean
  rightImputed: boolean
}
export interface ComparisonResult {
  rows: ComparisonRow[]
  warnings: string[]
  compatible: boolean
  comparedCount: number
}

export const COMPARISON_SNAPSHOT_LIMIT = 5_000_000
export const COMPARISON_METRIC_LIMIT = 12_000
const validated = new WeakSet<object>()
const units = new Set<ComparisonUnit>(['probability', 'class', 'score', 'count', 'ratio', 'value', 'category'])
const directions = new Set(['lower-better', 'higher-better', 'neutral'])
const dangerous = new Set(['__proto__', 'prototype', 'constructor'])
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
type InputObject = Record<string, unknown>

function object(value: unknown, label: string): InputObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected an object.`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label}: expected a JSON object.`)
  return value as InputObject
}
function fields(value: InputObject, allowed: string[], label: string) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key) || dangerous.has(key)) throw new Error(`${label}: unsupported field ${key}.`)
}
function text(value: unknown, label: string, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`${label}: expected nonempty text of at most ${max} characters.`)
  return value
}
function optionalText(value: unknown, label: string, max = 500) {
  return value === undefined ? undefined : text(value, label, max)
}
function stringMap(value: unknown, label: string) {
  const input = object(value, label)
  const entries = Object.entries(input)
  if (entries.length > 24) throw new Error(`${label}: expected at most 24 dimensions.`)
  return Object.fromEntries(
    entries
      .sort(([a], [b]) => compareText(a, b))
      .map(([key, value]) => {
        text(key, `${label} key`, 80)
        if (dangerous.has(key)) throw new Error(`${label}: unsupported dimension key.`)
        return [key, text(value, `${label}.${key}`)]
      }),
  )
}
function jsonMap(value: unknown, label: string): Record<string, JSONValue> {
  const active = new Set<object>()
  let nodes = 0,
    characters = 0
  const clone = (input: unknown, depth: number): JSONValue => {
    if (++nodes > 10_000 || depth > 12) throw new Error(`${label}: JSON context is too large or deeply nested.`)
    if (input === null || typeof input === 'boolean') return input
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error(`${label}: JSON numbers must be finite.`)
      return input
    }
    if (typeof input === 'string') {
      characters += input.length
      if (input.length > 20_000 || characters > 250_000) throw new Error(`${label}: context text is too large.`)
      return input
    }
    if (!input || typeof input !== 'object') throw new Error(`${label}: context must contain JSON values only.`)
    if (active.has(input)) throw new Error(`${label}: cyclic JSON is not supported.`)
    active.add(input)
    let result: JSONValue
    if (Array.isArray(input)) {
      if (input.length > 10_000) throw new Error(`${label}: context array is too large.`)
      result = input.map((item) => clone(item, depth + 1))
    } else {
      const entries = Object.entries(object(input, label))
      if (entries.length > 1_000) throw new Error(`${label}: context object is too large.`)
      result = Object.fromEntries(
        entries.map(([key, item]) => {
          if (key.length > 200 || dangerous.has(key)) throw new Error(`${label}: unsupported context key.`)
          return [key, clone(item, depth + 1)]
        }),
      )
    }
    active.delete(input)
    return result
  }
  object(value, label)
  return clone(value, 0) as Record<string, JSONValue>
}
function deepFreeze(value: object) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child)
  Object.freeze(value)
}
/** Site, coordinates, settings, labels and values intentionally do not identify a metric. */
export function comparisonMetricKey(metric: ComparisonMetric): string {
  return JSON.stringify([
    metric.measure,
    metric.entity,
    metric.period,
    Object.entries(metric.dimensions).sort(([a], [b]) => compareText(a, b)),
  ])
}

/** Validate, detach from caller state and recursively freeze an immutable snapshot. */
export function parseComparisonSnapshot(input: unknown): ComparisonSnapshot {
  if (typeof input === 'object' && input !== null && validated.has(input)) return input as ComparisonSnapshot
  let value = input
  if (typeof input === 'string') {
    if (input.length > COMPARISON_SNAPSHOT_LIMIT) throw new Error('Comparison snapshots must be smaller than 5 MB.')
    try {
      value = JSON.parse(input.replace(/^\uFEFF/, ''))
    } catch {
      throw new Error('The comparison snapshot must be valid JSON.')
    }
  }
  const root = object(value, 'Snapshot')
  fields(
    root,
    ['schema', 'id', 'label', 'family', 'provenance', 'context', 'periods', 'metrics', 'probabilityGroups'],
    'Snapshot',
  )
  if (root.schema !== 'cciss-comparison-snapshot-v1') throw new Error('Unsupported comparison snapshot schema.')
  const source = object(root.provenance, 'Provenance')
  fields(source, ['source', 'version', 'method', 'synthetic', 'limitations', 'metadata'], 'Provenance')
  const provenance: ComparisonSnapshot['provenance'] = { source: text(source.source, 'Provenance source', 2_000) }
  for (const key of ['version', 'method'] as const) {
    const value = optionalText(source[key], `Provenance ${key}`, 1_000)
    if (value !== undefined) provenance[key] = value
  }
  if (source.synthetic !== undefined) {
    if (typeof source.synthetic !== 'boolean') throw new Error('Provenance synthetic must be boolean.')
    provenance.synthetic = source.synthetic
  }
  if (source.limitations !== undefined) {
    if (!Array.isArray(source.limitations) || source.limitations.length > 200)
      throw new Error('Expected at most 200 provenance limitations.')
    provenance.limitations = source.limitations.map((value) => text(value, 'Provenance limitation', 2_000))
  }
  if (source.metadata !== undefined) provenance.metadata = jsonMap(source.metadata, 'Provenance metadata')
  const periodsInput = object(root.periods, 'Periods')
  if (Object.keys(periodsInput).length > 128) throw new Error('Expected at most 128 period definitions.')
  const periods: ComparisonSnapshot['periods'] = Object.fromEntries(
    Object.entries(periodsInput).map(([key, value]) => {
      text(key, 'Period ID', 80)
      if (dangerous.has(key)) throw new Error('Unsupported period ID.')
      const p = object(value, `Period ${key}`)
      fields(p, ['label', 'startYear', 'endYear', 'kind'], `Period ${key}`)
      const unknown = p.startYear === null && p.endYear === null
      if (
        !unknown &&
        (!Number.isInteger(p.startYear) ||
          !Number.isInteger(p.endYear) ||
          (p.startYear as number) < 0 ||
          (p.endYear as number) > 9999 ||
          (p.endYear as number) < (p.startYear as number))
      )
        throw new Error(`Period ${key}: provide ordered year boundaries, or null for both unknown boundaries.`)
      return [
        key,
        {
          label: text(p.label, `Period ${key} label`),
          startYear: p.startYear as number | null,
          endYear: p.endYear as number | null,
          kind: text(p.kind, `Period ${key} kind`, 80),
        },
      ]
    }),
  )
  if (!Array.isArray(root.metrics) || root.metrics.length < 1 || root.metrics.length > COMPARISON_METRIC_LIMIT)
    throw new Error(`Expected 1–${COMPARISON_METRIC_LIMIT} comparison metrics.`)
  const identities = new Set<string>()
  const metrics = root.metrics.map((value) => {
    const m = object(value, 'Metric')
    fields(
      m,
      [
        'measure',
        'entity',
        'label',
        'dimensions',
        'period',
        'periodCoverage',
        'value',
        'unit',
        'direction',
        'scale',
        'probabilityGroup',
      ],
      'Metric',
    )
    const unit = m.unit as ComparisonUnit
    if (!units.has(unit)) throw new Error('Unsupported comparison metric unit.')
    const period = m.period === null ? null : text(m.period, 'Metric period', 80)
    if (period !== null && !Object.prototype.hasOwnProperty.call(periods, period))
      throw new Error(`Metric references undefined period ${period}.`)
    if (m.value !== null) {
      if (unit === 'category') text(m.value, 'Categorical metric value', 1_000)
      else {
        if (typeof m.value !== 'number' || !Number.isFinite(m.value))
          throw new Error('Numeric metric values must be finite numbers or null.')
        if (unit === 'probability' && (m.value < 0 || m.value > 1))
          throw new Error('Probability metrics must be between zero and one.')
        if ((unit === 'class' || unit === 'count') && !Number.isSafeInteger(m.value))
          throw new Error('Class and count metrics must be safe integers.')
        if (unit === 'count' && m.value < 0) throw new Error('Count metrics cannot be negative.')
      }
    }
    const metric: ComparisonMetric = {
      measure: text(m.measure, 'Metric measure', 160),
      entity: text(m.entity, 'Metric entity', 300),
      dimensions: stringMap(m.dimensions, 'Metric dimensions'),
      period,
      value: m.value as ComparisonValue,
      unit,
    }
    if (m.periodCoverage !== undefined) {
      if (
        period !== null ||
        !Array.isArray(m.periodCoverage) ||
        !m.periodCoverage.length ||
        m.periodCoverage.length > 128
      )
        throw new Error('Only aggregate metrics can define 1–128 contributing period IDs.')
      const coverage = m.periodCoverage.map((value) => text(value, 'Contributing period ID', 80)).sort()
      if (
        new Set(coverage).size !== coverage.length ||
        coverage.some((id) => !Object.prototype.hasOwnProperty.call(periods, id))
      )
        throw new Error('Contributing periods must be unique IDs defined by this snapshot.')
      metric.periodCoverage = coverage
    }
    for (const key of ['label', 'scale', 'probabilityGroup'] as const) {
      const value = optionalText(m[key], `Metric ${key}`, key === 'label' ? 500 : 160)
      if (value !== undefined) metric[key] = value
    }
    if (m.direction !== undefined) {
      if (!directions.has(m.direction as string)) throw new Error('Unsupported metric direction.')
      metric.direction = m.direction as ComparisonMetric['direction']
    }
    if (metric.probabilityGroup && unit !== 'probability')
      throw new Error('Only probability metrics can belong to probability groups.')
    const key = comparisonMetricKey(metric)
    if (identities.has(key)) throw new Error('Duplicate comparison metric identity.')
    identities.add(key)
    return metric
  })
  let probabilityGroups: ComparisonProbabilityGroup[] | undefined
  if (root.probabilityGroups !== undefined) {
    if (!Array.isArray(root.probabilityGroups) || root.probabilityGroups.length > COMPARISON_METRIC_LIMIT)
      throw new Error('Too many probability groups.')
    const ids = new Set<string>()
    probabilityGroups = root.probabilityGroups.map((value) => {
      const g = object(value, 'Probability group')
      fields(
        g,
        ['id', 'measure', 'period', 'entity', 'dimensions', 'categoryDimensions', 'complete'],
        'Probability group',
      )
      const id = text(g.id, 'Probability group ID', 160)
      if (ids.has(id)) throw new Error('Duplicate probability group ID.')
      ids.add(id)
      if (typeof g.complete !== 'boolean') throw new Error('Probability group completeness must be explicit.')
      const period = g.period === null ? null : text(g.period, 'Probability group period', 80)
      if (period !== null && !Object.prototype.hasOwnProperty.call(periods, period))
        throw new Error('Probability group references an undefined period.')
      const entity = g.entity === null ? null : text(g.entity, 'Probability group entity', 300)
      const dimensions = stringMap(g.dimensions, 'Probability group fixed dimensions')
      if (!Array.isArray(g.categoryDimensions) || g.categoryDimensions.length > 24)
        throw new Error('Probability groups must define their varying category dimensions.')
      const categoryDimensions = g.categoryDimensions.map((name) => text(name, 'Category dimension', 80)).sort()
      if (
        new Set(categoryDimensions).size !== categoryDimensions.length ||
        categoryDimensions.some((name) => dangerous.has(name) || Object.prototype.hasOwnProperty.call(dimensions, name))
      )
        throw new Error('Probability group dimension definitions conflict.')
      return {
        id,
        measure: text(g.measure, 'Probability group measure', 160),
        period,
        entity,
        dimensions,
        categoryDimensions,
        complete: g.complete,
      }
    })
  }
  const groupLookup = new Map(probabilityGroups?.map((g) => [g.id, g]) ?? [])
  const members = new Map<string, ComparisonMetric[]>()
  for (const metric of metrics)
    if (metric.probabilityGroup) {
      const group = groupLookup.get(metric.probabilityGroup)
      if (!group || group.measure !== metric.measure || group.period !== metric.period)
        throw new Error('Probability metric and group definitions do not match.')
      if (group.entity !== null && metric.entity !== group.entity)
        throw new Error('Probability metric is outside its group entity scope.')
      const groupKeys = [...Object.keys(group.dimensions), ...group.categoryDimensions].sort()
      if (
        JSON.stringify(Object.keys(metric.dimensions).sort()) !== JSON.stringify(groupKeys) ||
        Object.entries(group.dimensions).some(([key, value]) => metric.dimensions[key] !== value)
      )
        throw new Error('Probability metric is outside its group dimension scope.')
      const list = members.get(group.id) ?? []
      list.push(metric)
      members.set(group.id, list)
    }
  for (const group of probabilityGroups ?? []) {
    const list = members.get(group.id) ?? []
    if (!list.length) throw new Error('Probability groups must contain metrics.')
    if (new Set(list.map((metric) => JSON.stringify(metric.periodCoverage ?? null))).size !== 1)
      throw new Error('Probability group members must share the same contributing-period definition.')
    if (
      group.complete &&
      (list.some((m) => m.value === null) || Math.abs(list.reduce((sum, m) => sum + (m.value as number), 0) - 1) > 1e-8)
    )
      throw new Error('Complete probability groups must contain known values that sum to one.')
  }
  const result: ComparisonSnapshot = {
    schema: 'cciss-comparison-snapshot-v1',
    id: text(root.id, 'Snapshot ID', 160),
    label: text(root.label, 'Snapshot label'),
    family: text(root.family, 'Snapshot family', 100),
    provenance,
    context: jsonMap(root.context, 'Snapshot context'),
    periods,
    metrics,
    ...(probabilityGroups === undefined ? {} : { probabilityGroups }),
  }
  if (JSON.stringify(result).length > COMPARISON_SNAPSHOT_LIMIT)
    throw new Error('Comparison snapshots must be smaller than 5 MB; capture a smaller result selection.')
  deepFreeze(result)
  validated.add(result)
  return result
}

export function serializeComparisonSnapshot(snapshot: ComparisonSnapshot): string {
  return JSON.stringify(parseComparisonSnapshot(snapshot), null, 2)
}
const periodMeaning = (period: ComparisonPeriod) => JSON.stringify([period.startYear, period.endYear, period.kind])
function periodIssue(
  left: ComparisonSnapshot,
  right: ComparisonSnapshot,
  period: string | null,
  leftMetric: ComparisonMetric | null,
  rightMetric: ComparisonMetric | null,
): string | null {
  if (period === null) {
    const leftCoverage = leftMetric?.periodCoverage,
      rightCoverage = rightMetric?.periodCoverage
    if (!leftCoverage && !rightCoverage)
      return 'Aggregate contributing periods are unspecified; displayed periods do not establish summary coverage.'
    if (leftMetric && rightMetric && JSON.stringify(leftCoverage) !== JSON.stringify(rightCoverage))
      return 'Aggregate contributing periods differ or one coverage definition is unspecified.'
    const keys = leftCoverage ?? rightCoverage!
    if (
      keys.some(
        (key) =>
          !left.periods[key] ||
          !right.periods[key] ||
          periodMeaning(left.periods[key]) !== periodMeaning(right.periods[key]),
      )
    )
      return 'Summary period definitions differ; their time coverage cannot be assumed equivalent.'
    if (keys.some((key) => left.periods[key].startYear === null)) return 'Summary period boundaries are unknown.'
    return null
  }
  const a = left.periods[period],
    b = right.periods[period]
  if (!a || !b) return 'This exact source period is absent from one snapshot.'
  if (periodMeaning(a) !== periodMeaning(b)) return 'The same period ID has different boundaries or meaning.'
  if (a.startYear === null) return 'Period boundaries are unknown; matching labels alone do not establish equivalence.'
  return null
}

export function compareSnapshots(leftInput: ComparisonSnapshot, rightInput: ComparisonSnapshot): ComparisonResult {
  const left = parseComparisonSnapshot(leftInput),
    right = parseComparisonSnapshot(rightInput)
  const warnings: string[] = []
  const sharedIssues: string[] = []
  if (left.family !== right.family)
    sharedIssues.push('Different workflow families; side-by-side values do not establish equivalent calculations.')
  if ((left.provenance.synthetic === true) !== (right.provenance.synthetic === true))
    sharedIssues.push('Synthetic and non-synthetic snapshots cannot be treated as equivalent results.')
  if (left.provenance.method !== right.provenance.method && (left.provenance.method || right.provenance.method))
    sharedIssues.push('Calculation methods differ or one method is unspecified.')
  warnings.push(...sharedIssues)
  if (left.provenance.version !== right.provenance.version)
    warnings.push('Source versions differ or one is unspecified; inspect each snapshot’s provenance.')
  if (left.provenance.source !== right.provenance.source)
    warnings.push('The snapshots use different sources; preserve that distinction when interpreting differences.')
  if (left.provenance.synthetic || right.provenance.synthetic)
    warnings.push('Synthetic verification snapshots are not real-site ecological assessments.')
  for (const [label, snapshot] of [
    ['A', left],
    ['B', right],
  ] as const)
    for (const limitation of snapshot.provenance.limitations ?? []) warnings.push(`${label}: ${limitation}`)
  const leftMetrics = new Map(left.metrics.map((m) => [comparisonMetricKey(m), m]))
  const rightMetrics = new Map(right.metrics.map((m) => [comparisonMetricKey(m), m]))
  const leftGroups = new Map(left.probabilityGroups?.map((g) => [g.id, g]) ?? [])
  const rightGroups = new Map(right.probabilityGroups?.map((g) => [g.id, g]) ?? [])
  const leftAggregateGroups = new Set(
    left.metrics.filter((m) => m.periodCoverage && m.probabilityGroup).map((m) => m.probabilityGroup),
  )
  const rightAggregateGroups = new Set(
    right.metrics.filter((m) => m.periodCoverage && m.probabilityGroup).map((m) => m.probabilityGroup),
  )
  const keys = [...new Set([...leftMetrics.keys(), ...rightMetrics.keys()])]
  const periodIssues = new Map<string, string | null>()
  let comparedCount = 0
  const rows = keys.map((key): ComparisonRow => {
    const a = leftMetrics.get(key) ?? null,
      b = rightMetrics.get(key) ?? null
    const metric = a ?? b!
    const timeKey = JSON.stringify([
      metric.period,
      a?.periodCoverage ?? null,
      b?.periodCoverage ?? null,
      a !== null,
      b !== null,
    ])
    if (!periodIssues.has(timeKey)) periodIssues.set(timeKey, periodIssue(left, right, metric.period, a, b))
    const timeIssue = periodIssues.get(timeKey) ?? null
    let reason = sharedIssues[0] ?? timeIssue
    if (!reason && a && b) {
      if (a.unit !== b.unit) reason = 'Metric units differ.'
      else if (a.scale !== b.scale) reason = 'Metric scales differ or one scale is unspecified.'
      else if (a.unit === 'class' && !a.scale) reason = 'Ordinal class scale is unspecified.'
      else if ((a.direction ?? 'neutral') !== (b.direction ?? 'neutral')) reason = 'Metric directions differ.'
    }
    let leftValue = a?.value ?? null,
      rightValue = b?.value ?? null
    let leftImputed = false,
      rightImputed = false
    const completeAbsence = (
      present: ComparisonMetric,
      absentGroups: Map<string, ComparisonProbabilityGroup>,
      presentGroups: Map<string, ComparisonProbabilityGroup>,
    ) => {
      // Aggregate-group coverage is not specified by this schema's group domain;
      // keep an absent aggregate unknown rather than borrowing another time basis.
      if (!present.probabilityGroup || present.unit !== 'probability' || present.periodCoverage) return false
      const missingGroup = absentGroups.get(present.probabilityGroup),
        existingGroup = presentGroups.get(present.probabilityGroup)
      if ((absentGroups === leftGroups ? leftAggregateGroups : rightAggregateGroups).has(present.probabilityGroup))
        return false
      return (
        !!missingGroup?.complete &&
        !!existingGroup &&
        JSON.stringify([
          missingGroup.measure,
          missingGroup.period,
          missingGroup.entity,
          missingGroup.dimensions,
          missingGroup.categoryDimensions,
        ]) ===
          JSON.stringify([
            existingGroup.measure,
            existingGroup.period,
            existingGroup.entity,
            existingGroup.dimensions,
            existingGroup.categoryDimensions,
          ])
      )
    }
    if (!reason && !a && b && completeAbsence(b, leftGroups, rightGroups)) {
      leftValue = 0
      leftImputed = true
    }
    if (!reason && !b && a && completeAbsence(a, rightGroups, leftGroups)) {
      rightValue = 0
      rightImputed = true
    }
    const compatible = !reason
    let delta: number | null = null
    const deltaUnit: ComparisonRow['deltaUnit'] =
      metric.unit === 'probability'
        ? 'percentage-points'
        : metric.unit === 'class'
          ? 'class-steps'
          : metric.unit === 'category'
            ? 'none'
            : 'absolute'
    let interpretation: ComparisonRow['interpretation'] = compatible ? 'unknown' : 'incompatible'
    if (compatible && leftValue !== null && rightValue !== null) {
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        delta = (rightValue - leftValue) * (metric.unit === 'probability' ? 100 : 1)
        if (
          !Number.isFinite(delta) ||
          ((metric.unit === 'class' || metric.unit === 'count') && !Number.isSafeInteger(delta))
        ) {
          delta = null
          reason = 'The difference exceeds the supported numeric range.'
          interpretation = 'incompatible'
        } else {
          comparedCount++
          const direction = metric.direction ?? 'neutral'
          interpretation =
            delta === 0
              ? 'unchanged'
              : direction === 'neutral'
                ? 'changed'
                : (direction === 'higher-better' ? delta > 0 : delta < 0)
                  ? 'improved'
                  : 'declined'
        }
      } else interpretation = leftValue === rightValue ? 'unchanged' : 'changed'
    }
    if (!reason && (leftValue === null || rightValue === null))
      reason = !a || !b ? 'No matching metric; absence remains unknown.' : 'A source value is unknown.'
    if (timeIssue && !warnings.includes(timeIssue)) warnings.push(timeIssue)
    return {
      key,
      metric,
      left: a,
      right: b,
      leftValue,
      rightValue,
      delta,
      deltaUnit,
      compatible: compatible && interpretation !== 'incompatible',
      reason,
      interpretation,
      leftImputed,
      rightImputed,
    }
  })
  if (rows.some((r) => r.leftImputed || r.rightImputed))
    warnings.push(
      'Absent categories were treated as zero only where an explicitly complete probability group sums to one.',
    )
  if (rows.some((r) => r.leftValue === null || r.rightValue === null))
    warnings.push('Missing metrics and unknown values retain their missingness; they are not zero.')
  return { rows, warnings, compatible: sharedIssues.length === 0 && rows.every((r) => r.compatible), comparedCount }
}
