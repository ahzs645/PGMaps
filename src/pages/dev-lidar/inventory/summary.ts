import type { FeatureCollection } from 'geojson'
import { estimatedDbh, stemVolume, volumeGroup, INTERIOR_VOLUME, MODEL_SOURCES } from './allometry'
import { containsTree, scopeArea, type InventoryPolygon } from './geometry'
import { EMPTY_REVIEW, type InventoryData, type InventoryRules, type InventoryTree, type TreeReview } from './types'
export function checkInventoryData(data: InventoryData, source?: string) {
  if (
    data.schema_version !== 1 ||
    !data.run_id ||
    !data.foresttools?.version ||
    !data.support.features.length ||
    (source && source !== data.source_sha256)
  )
    throw Error('Inventory source or execution metadata mismatch')
  const ids = new Set<string>()
  for (const f of data.crowns.features) {
    const p = f.properties
    if (ids.has(p.id) || !Number.isFinite(p.height_m) || p.height_m < 5 || !data.methods.some((m) => m.id === p.method))
      throw Error('Invalid inventory candidate')
    ids.add(p.id)
  }
}
export function treeEstimate(tree: InventoryTree, rules: InventoryRules, reviews: Record<string, TreeReview>) {
  const p = tree.properties,
    review = reviews[p.id] ?? EMPTY_REVIEW
  const species = review.species || (rules.speciesMode === 'vri' ? p.vri_species : null) || 'UNKNOWN'
  const dbh = review.dbh_cm ?? estimatedDbh(p.height_m, p.crown_diameter_m, rules.dbhFactor)
  const volume = stemVolume(species, dbh, p.height_m, rules.minDbh)
  const basal = dbh === null ? null : Math.PI * (dbh / 200) ** 2
  // Published validation scatter is a sensitivity bracket, not a local confidence interval.
  const spread = Math.exp(1.96 * 0.45)
  const dbhRange = review.dbh_cm !== null ? [dbh, dbh] : dbh === null ? [null, null] : [dbh / spread, dbh * spread]
  return {
    tree,
    review,
    species,
    speciesSource: review.species
      ? 'Reviewer assignment'
      : rules.speciesMode === 'vri' && p.vri_species
        ? 'VRI leading-species assumption'
        : 'Unknown',
    dbh,
    dbhSource: review.dbh_cm !== null ? 'User-entered DBH' : 'Jucker global allometry',
    dbhRange,
    basal,
    ...volume,
  }
}
export type EstimatedTree = ReturnType<typeof treeEstimate>
export function inventoryRows(
  data: InventoryData,
  method: string,
  rules: InventoryRules,
  reviews: Record<string, TreeReview>,
  polygon: InventoryPolygon | null,
) {
  return data.crowns.features
    .filter((f) => {
      const p = f.properties
      return (
        p.method === method &&
        p.height_m >= rules.minHeight &&
        (p.point_count === null || p.point_count >= rules.minPoints) &&
        containsTree(polygon, p.lon, p.lat)
      )
    })
    .map((f) => treeEstimate(f, rules, reviews))
}
export function summarizeInventory(
  rows: EstimatedTree[],
  data: InventoryData,
  polygon: InventoryPolygon | null,
  rules: InventoryRules,
) {
  const area = scopeArea(data.support, polygon),
    included = rows.filter((r) => r.review.status !== 'excluded')
  const known = included.filter((r) => r.total !== null),
    merchant = included.filter((r) => r.merchant !== null)
  const total = known.reduce((s, r) => s + r.total!, 0),
    usable = merchant.reduce((s, r) => s + r.merchant!, 0)
  const dbhKnown = included.filter((r) => r.dbh !== null)
  const basal = included.reduce((s, r) => s + (r.basal ?? 0), 0)
  return {
    ...area,
    candidates: included.length,
    excluded: rows.length - included.length,
    boundary: included.filter((r) => r.tree.properties.boundary).length,
    trees_ha: area.covered_ha ? included.length / area.covered_ha : null,
    basal_m2_ha: area.covered_ha && dbhKnown.length ? basal / area.covered_ha : null,
    total_m3: known.length ? total : null,
    merchant_m3: merchant.length ? usable : null,
    merchant_m3_ha: area.covered_ha && merchant.length ? usable / area.covered_ha : null,
    known_volume: known.length,
    missing_volume: included.length - known.length,
    recovered_m3: merchant.length ? (usable * (1 - rules.retention / 100) * rules.recovery) / 100 : null,
    mean_height: included.length
      ? included.reduce((s, r) => s + r.tree.properties.height_m, 0) / included.length
      : null,
    qmd:
      included.length && included.every((r) => r.dbh !== null)
        ? Math.sqrt(included.reduce((s, r) => s + r.dbh! ** 2, 0) / included.length)
        : null,
  }
}
export function standTable(rows: EstimatedTree[], areaHa: number) {
  const groups = new Map<
    string,
    { species: string; diameter: string; n: number; basal: number; total: number; merchant: number; known: number }
  >()
  for (const r of rows.filter((r) => r.review.status !== 'excluded')) {
    const diameter = r.dbh === null ? 'Unknown' : `${Math.floor(r.dbh / 5) * 5}–${Math.floor(r.dbh / 5) * 5 + 5}`
    const key = `${r.species}/${diameter}`
    const g = groups.get(key) ?? { species: r.species, diameter, n: 0, basal: 0, total: 0, merchant: 0, known: 0 }
    g.n++
    g.basal += r.basal ?? 0
    g.total += r.total ?? 0
    g.merchant += r.merchant ?? 0
    g.known += r.total === null ? 0 : 1
    groups.set(key, g)
  }
  return [...groups.values()]
    .sort((a, b) => a.species.localeCompare(b.species) || parseFloat(a.diameter) - parseFloat(b.diameter))
    .map((g) => ({
      ...g,
      n_ha: areaHa ? g.n / areaHa : null,
      basal_ha: areaHa && g.diameter !== 'Unknown' ? g.basal / areaHa : null,
      merchant_ha: areaHa && g.known ? g.merchant / areaHa : null,
    }))
}
export function matchInventories(left: EstimatedTree[], right: EstimatedTree[], distance = 5) {
  const pairs: { a: number; b: number; distance: number }[] = []
  left.forEach((a, i) =>
    right.forEach((b, j) => {
      if (a.tree.properties.chunk !== b.tree.properties.chunk) return
      const p = a.tree.properties,
        q = b.tree.properties
      const d = Math.hypot((p.lon - q.lon) * 111320 * Math.cos((p.lat * Math.PI) / 180), (p.lat - q.lat) * 111320)
      if (d <= distance) pairs.push({ a: i, b: j, distance: d })
    }),
  )
  const usedA = new Set<number>(),
    usedB = new Set<number>(),
    matches: typeof pairs = []
  for (const p of pairs.sort((a, b) => a.distance - b.distance || a.a - b.a || a.b - b.b)) {
    if (usedA.has(p.a) || usedB.has(p.b)) continue
    usedA.add(p.a)
    usedB.add(p.b)
    matches.push(p)
  }
  return {
    matches,
    unmatched_left: left.length - usedA.size,
    unmatched_right: right.length - usedB.size,
    mean_distance: matches.length ? matches.reduce((s, p) => s + p.distance, 0) / matches.length : null,
    height_difference: matches.length
      ? matches.reduce((s, p) => s + right[p.b].tree.properties.height_m - left[p.a].tree.properties.height_m, 0) /
        matches.length
      : null,
  }
}
// The map and its legend both read these, so the two cannot drift apart.
export const INVENTORY_UNAVAILABLE_COLOUR = '#94a3b8'
/** The selected area's outline and the vertices of a polygon being drawn. */
export const INVENTORY_SELECTION_COLOUR = '#e11d48'
export const INVENTORY_SUPPORT_COLOUR = '#94a3b8'
export const INVENTORY_OTHER_SPECIES_COLOUR = '#8b5cf6'
export const INVENTORY_SPECIES_COLOURS: Record<string, string> = {
  SX: '#16a34a',
  AT: '#f59e0b',
  EP: '#d946ef',
  FDI: '#0284c7',
  AC: '#a16207',
  UNKNOWN: INVENTORY_UNAVAILABLE_COLOUR,
}
export const INVENTORY_REVIEW_COLOURS: Record<TreeReview['status'], string> = {
  accepted: '#16a34a',
  excluded: '#ef4444',
  split: '#f59e0b',
  merged: '#c026d3',
  unreviewed: INVENTORY_UNAVAILABLE_COLOUR,
}
/** Five equal classes from zero to each colour's maximum (`INVENTORY_RAMP_SCALES`); the top class is open-ended. */
export const INVENTORY_RAMP = ['#f0fdf4', '#bbf7d0', '#4ade80', '#16a34a', '#166534']
export const INVENTORY_RAMP_SCALES: Record<string, { max: number; unit: string; label: string }> = {
  height: { max: 40, unit: 'm', label: 'Observed height' },
  dbh: { max: 80, unit: 'cm', label: 'Estimated / entered DBH' },
  volume: { max: 3, unit: 'm³', label: 'Modelled total stem' },
  texture: { max: 8, unit: '', label: 'GLCM entropy (ForestTools only)' },
}
export function inventoryMapFeatures(rows: EstimatedTree[], colour: string, selected: string): FeatureCollection {
  const ramp = INVENTORY_RAMP
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => {
      const p = r.tree.properties,
        value =
          colour === 'height'
            ? p.height_m
            : colour === 'dbh'
              ? r.dbh
              : colour === 'volume'
                ? r.total
                : colour === 'texture'
                  ? p.texture_entropy
                  : null
      const t =
        value === null
          ? null
          : Math.min(1, Math.max(0, value / (INVENTORY_RAMP_SCALES[colour] ?? INVENTORY_RAMP_SCALES.texture).max))
      const fill =
        colour === 'species'
          ? (INVENTORY_SPECIES_COLOURS[volumeGroup(r.species)] ?? INVENTORY_OTHER_SPECIES_COLOUR)
          : colour === 'review'
            ? INVENTORY_REVIEW_COLOURS[r.review.status]
            : t === null
              ? INVENTORY_UNAVAILABLE_COLOUR
              : ramp[Math.min(4, Math.floor(t * 5))]
      return { ...r.tree, properties: { ...p, selected: p.id === selected, colour: fill } }
    }),
  }
}
export function inventoryExport(
  data: InventoryData,
  rows: EstimatedTree[],
  rules: InventoryRules,
  polygon: InventoryPolygon | null,
) {
  return {
    type: 'FeatureCollection',
    metadata: {
      source_sha256: data.source_sha256,
      run_id: data.run_id,
      snapshot_utc: data.snapshot_utc,
      scope: data.scope,
      rules,
      processing: {
        methods: data.methods,
        foresttools_version: data.foresttools.version,
        fora: data.fora,
        height_sha256: data.height_sha256,
      },
      models: {
        sources: MODEL_SOURCES,
        dbh_equation: '0.557*(H_m*equivalent_crown_diameter_m)^0.809*exp(0.056^2/2)',
        dbh_validation_log_scatter: 0.45,
        interior_volume_coefficients: INTERIOR_VOLUME,
      },
      polygon,
      area: scopeArea(data.support, polygon),
      definitions: {
        location: 'Canopy apex proxy, not measured stem position',
        dbh: 'User-entered or Jucker eq6; global validation log scatter 0.45 is not local accuracy',
        volume: 'Nigh 2016 eq2 Tables4/6 interior; inside bark, 0.3 m stump / 4 cm top; no defect deductions',
        census: false,
      },
    },
    features: rows.map((r) => ({
      ...r.tree,
      properties: {
        ...r.tree.properties,
        species: r.species,
        species_source: r.speciesSource,
        dbh_cm: r.dbh,
        dbh_source: r.dbhSource,
        basal_area_m2: r.basal,
        total_stem_m3: r.total,
        merchantable_stem_m3: r.merchant,
        volume_status: r.status,
        review: r.review,
      },
    })),
  }
}
const csvEscape = (v: unknown) => {
  const text = String(v ?? '')
  return `"${(typeof v === 'string' && /^[\t\r ]*[=+\-@]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`
}
export function inventoryCsv(rows: EstimatedTree[]) {
  return [
    'id,method,longitude,latitude,height_m,crown_area_m2,crown_diameter_m,species,species_source,dbh_cm,dbh_source,total_stem_m3,merchantable_stem_m3,review_status,note',
    ...rows.map((r) =>
      [
        r.tree.properties.id,
        r.tree.properties.method,
        r.tree.properties.lon,
        r.tree.properties.lat,
        r.tree.properties.height_m,
        r.tree.properties.crown_area_m2,
        r.tree.properties.crown_diameter_m,
        r.species,
        r.speciesSource,
        r.dbh,
        r.dbhSource,
        r.total,
        r.merchant,
        r.review.status,
        r.review.note,
      ]
        .map(csvEscape)
        .join(','),
    ),
  ].join('\n')
}

export function standCsv(rows: EstimatedTree[], areaHa: number) {
  return [
    'species,dbh_class_cm,candidates,candidates_per_ha,known_basal_area_m2_per_ha,known_total_stem_m3,known_merchantable_stem_m3_per_ha,volume_known_candidates,supported_hectares',
    ...standTable(rows, areaHa).map((g) =>
      [g.species, g.diameter, g.n, g.n_ha, g.basal_ha, g.known ? g.total : '', g.merchant_ha, g.known, areaHa]
        .map(csvEscape)
        .join(','),
    ),
  ].join('\n')
}
