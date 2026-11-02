import RBush from 'rbush'
import { bboxOf } from '../dev-avast/geometry'
import { areaHa, difference, intersect, union } from './geometry'
import type {
  AnalysisInput,
  AnalysisResult,
  InputRole,
  MultiPolygonCoords,
  Piece,
  PolygonInput,
  Settings,
  Summary,
} from './types'

// No small-piece cutoff: retain slivers in calculations and round only for display.
type IndexItem = { minX: number; minY: number; maxX: number; maxY: number; order: number; feature: PolygonInput }
function index(features: PolygonInput[]) {
  const tree = new RBush<IndexItem>()
  tree.load(
    features.map((feature, order) => ({
      minX: feature.bbox[0],
      minY: feature.bbox[1],
      maxX: feature.bbox[2],
      maxY: feature.bbox[3],
      order,
      feature,
    })),
  )
  return (geometry: MultiPolygonCoords) => {
    const [minX, minY, maxX, maxY] = bboxOf(geometry)
    return tree
      .search({ minX, minY, maxX, maxY })
      .sort((a, b) => a.order - b.order)
      .map((item) => item.feature)
  }
}
type Search = ReturnType<typeof index>
type Fragment = Pick<Piece, 'geometry' | 'maturity' | 'admin' | 'deferral'>

function partition(
  fragments: Fragment[],
  search: Search,
  apply: (part: Fragment, feature: PolygonInput) => Fragment,
  warn: () => void,
): Fragment[] {
  const output: Fragment[] = []
  for (const fragment of fragments) {
    let remaining = fragment.geometry
    for (const feature of search(fragment.geometry)) {
      const whole = intersect(fragment.geometry, feature.geometry)
      const geometry = intersect(remaining, feature.geometry)
      if (areaHa(whole) - areaHa(geometry) > 1e-7) warn()
      if (geometry.length) output.push(apply({ ...fragment, geometry }, feature))
      remaining = difference(remaining, feature.geometry)
    }
    if (remaining.length) output.push({ ...fragment, geometry: remaining })
  }
  return output
}

export function analyze(input: AnalysisInput, settings: Settings): AnalysisResult {
  if (!input.areas.length) throw new Error('Add at least one assessment polygon.')
  if (
    !input.official.length &&
    !input.proxy.length &&
    !input.assessedRoles?.some((role) => role === 'official' || role === 'proxy')
  )
    throw new Error('Add official THLB or Proxy THLB polygons.')
  if (!Number.isFinite(settings.matureAge) || settings.matureAge < 0)
    throw new Error('Maturity age must be zero or greater.')
  if (
    settings.reductionPercent !== null &&
    (!Number.isFinite(settings.reductionPercent) || settings.reductionPercent < 0 || settings.reductionPercent > 100)
  )
    throw new Error('Reduction must be between 0 and 100%.')
  const ids = new Set<string>()
  for (const area of input.areas) {
    if (ids.has(area.id))
      throw new Error(
        `Duplicate assessment ID “${area.id}”. Use unique IDs or dissolve multipart areas before importing.`,
      )
    ids.add(area.id)
  }
  const warnings = new Set<string>()
  const searches = {
    official: index(input.official),
    proxy: index(input.proxy),
    vri: index(input.vri),
    admin: index(input.admin),
    deferral: index(input.deferral),
  }
  const hasDeferral = input.assessedRoles?.includes('deferral') ?? input.deferral.length > 0
  const hasVri = input.assessedRoles?.includes('vri') ?? input.vri.length > 0
  const hasAdmin = input.assessedRoles?.includes('admin') ?? input.admin.length > 0

  function assess(id: string, geometry: MultiPolygonCoords): { row: Summary; pieces: Piece[] } {
    const pieces: Piece[] = []
    let remaining = geometry
    let claimedOfficial: MultiPolygonCoords = []
    for (const kind of ['official', 'proxy'] as const) {
      let sourceClaimed: MultiPolygonCoords = []
      for (const feature of searches[kind](geometry)) {
        const relevant = intersect(geometry, feature.geometry)
        if (areaHa(intersect(relevant, sourceClaimed)) > 1e-7)
          warnings.add(`Overlapping ${kind} features: earlier imported features take precedence.`)
        const part = intersect(remaining, feature.geometry)
        sourceClaimed = union([sourceClaimed, relevant])
        if (!part.length) continue
        remaining = difference(remaining, feature.geometry)
        let fragments: Fragment[] = [
          {
            geometry: part,
            maturity: 'unknown',
            admin: hasAdmin ? 'Unclassified' : feature.name || 'Not assessed',
            deferral: hasDeferral ? 'outside' : 'not assessed',
          },
        ]
        if (hasVri)
          fragments = partition(
            fragments,
            searches.vri,
            (fragment, stand) => ({
              ...fragment,
              maturity: stand.age === null ? 'unknown' : stand.age >= settings.matureAge ? 'mature' : 'immature',
            }),
            () => warnings.add('Overlapping VRI features: earlier imported features take precedence.'),
          )
        if (hasAdmin)
          fragments = partition(
            fragments,
            searches.admin,
            (fragment, admin) => ({ ...fragment, admin: admin.name || 'Unclassified' }),
            () => warnings.add('Overlapping administrative polygons: earlier imported features take precedence.'),
          )
        // Deferrals are a binary union mask; overlapping designations count once.
        if (hasDeferral) {
          const mask = union(searches.deferral(part).map((item) => intersect(part, item.geometry)))
          fragments = fragments.flatMap((fragment) => {
            const inside = intersect(fragment.geometry, mask)
            const outside = difference(fragment.geometry, mask)
            return [
              ...(inside.length ? [{ ...fragment, geometry: inside, deferral: 'inside' as const }] : []),
              ...(outside.length ? [{ ...fragment, geometry: outside, deferral: 'outside' as const }] : []),
            ]
          })
        }
        for (const fragment of fragments) {
          const hectares = areaHa(fragment.geometry)
          pieces.push({
            ...fragment,
            areaId: id,
            source: feature.source,
            kind,
            factor: feature.factor,
            year: feature.year,
            areaHa: hectares,
            thlbHa: feature.factor === null ? null : hectares * feature.factor,
          })
        }
      }
      if (kind === 'official') claimedOfficial = difference(geometry, remaining)
    }
    // Official zeros (and missing factors) own their footprint too; proxy only fills gaps.
    const officialHa = areaHa(claimedOfficial)
    const grossHa = areaHa(geometry)
    const uncoveredHa = areaHa(remaining)
    const sum = (predicate: (piece: Piece) => boolean) =>
      pieces.reduce((total, piece) => total + (predicate(piece) ? (piece.thlbHa ?? 0) : 0), 0)
    const thlbHa = sum(() => true)
    const row: Summary = {
      id,
      areaHa: grossHa,
      coveredHa: grossHa - uncoveredHa,
      uncoveredHa,
      unknownFactorHa: pieces.reduce((total, piece) => total + (piece.factor === null ? piece.areaHa : 0), 0),
      officialThlbHa: sum((piece) => piece.kind === 'official'),
      proxyThlbHa: sum((piece) => piece.kind === 'proxy'),
      thlbHa,
      reductionHa: settings.reductionPercent === null ? null : (thlbHa * settings.reductionPercent) / 100,
      matureThlbHa: sum((piece) => piece.maturity === 'mature'),
      immatureThlbHa: sum((piece) => piece.maturity === 'immature'),
      unknownAgeThlbHa: sum((piece) => piece.maturity === 'unknown'),
      deferralThlbHa: hasDeferral ? sum((piece) => piece.deferral === 'inside') : null,
    }
    const ledgerHa = pieces.reduce((total, piece) => total + piece.areaHa, 0)
    if (Math.abs(ledgerHa + uncoveredHa - grossHa) > Math.max(1e-6, grossHa * 1e-8))
      throw new Error(`${id}: overlay areas do not reconcile. Check input topology.`)
    if (officialHa > grossHa + 1e-7) throw new Error(`${id}: official coverage exceeds the assessment area.`)
    return { row, pieces }
  }
  const assessed = input.areas.map((area) => assess(area.id, area.geometry))
  const combined = assess('All areas (union)', union(input.areas.map((area) => area.geometry)))
  const grossSum = assessed.reduce((total, item) => total + item.row.areaHa, 0)
  if (grossSum - combined.row.areaHa > 1e-6)
    warnings.add('Assessment areas overlap. Individual rows share ground; the combined total uses their union.')
  if (combined.row.uncoveredHa > 1e-7)
    warnings.add('Some assessment area has no THLB source coverage. It is unknown, not zero THLB.')
  if (combined.row.unknownFactorHa > 1e-7)
    warnings.add(
      'Some official THLB polygons have missing factors. Their area is reported separately and excluded from known THLB totals.',
    )
  if (!hasVri) warnings.add('Forest maturity was not assessed. Known THLB remains in the unknown-age category.')
  if (input.proxy.length)
    warnings.add('Proxy THLB is a strategic estimate; keep proxy hectares distinct from the official TSR compilation.')
  if (settings.demo) warnings.add('SYNTHETIC EXAMPLE: these geometries and results are not real forestry data.')
  return {
    settings,
    rows: assessed.map((item) => item.row),
    combined: combined.row,
    pieces: assessed.flatMap((item) => item.pieces),
    combinedPieces: combined.pieces,
    warnings: [...warnings],
    areas: input.areas,
    sources:
      input.suppliedSources ??
      (['areas', 'official', 'proxy', 'vri', 'deferral', 'admin'] as InputRole[]).flatMap((role) =>
        [...new Set(input[role].map((feature) => feature.source))].map((name) => ({
          role,
          name,
          features: input[role].filter((feature) => feature.source === name).length,
        })),
      ),
  }
}
