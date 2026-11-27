/**
 * The Mackenzie order's old forest units: the landscape units and groups of Table 2 as the 2010
 * amendment replaced it, each split into its rows (one target per biogeoclimatic group or groups),
 * with Table 1's groups, Table 3's interior percentages and the order's own definitions of old
 * forest and deciduous species. The tables are data in
 * `packages/legal-rules/rules/bc/omineca/mackenzie-2008-biodiversity-order.json`, transcribed from
 * the signed PDFs; docs/forestry-old-forest.md, **The Mackenzie order**, lists every reading made.
 *
 * Each landscape unit is named by DataBC's `RMP_LANDSCAPE_UNIT_SVW` record (`LANDSCAPE_UNIT_PROVID`),
 * checked on 27 November 2026 to be the one of that name inside the Mackenzie Natural Resource
 * District, with the biodiversity emphasis option Table 2 prints. Names a reader checks again on
 * every read (`mackenzieReads.ts`).
 *
 * DOM- and network-free.
 */
import order from '../../../../packages/legal-rules/rules/bc/omineca/mackenzie-2008-biodiversity-order.json'
import tsr2020 from '../../../../packages/legal-rules/observations/mackenzie-tsr-2020.json'

export type Beo = 'Low' | 'Intermediate' | 'High'
/** Table 1's groups; `6&7` is BWBS deciduous-leading stands. Group 1 has no Table 2 target. */
export type BecGroup = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '6&7'

export const MACKENZIE_ORDER = order

/** One target of Table 2 for a unit: a share of the CFLB in the row's groups kept old. */
export interface MackenzieRow {
  id: string
  groups: BecGroup[]
  /** As Table 2 prints the groups ("4, 5", "BWBS (deciduous leading only)"). */
  groupsAsPrinted: string
  oldPercent: number
  /** Table 3's share of the row's required old forest that must be interior; null when the order leaves it open. */
  interiorPercent: number | null
  /** Why `interiorPercent` is null. */
  interiorNote: string | null
  /** The printed page of the 2010 table the row is on. */
  page: number
}

export interface MackenzieLandscapeUnit {
  /** As DataBC names it. */
  name: string
  provid: number
  beo: Beo
}

/** A landscape unit or group of the 2010 Table 2, with its rows and its DataBC polygons. */
export interface MackenzieUnit {
  id: string
  asPrinted: string
  /** The biodiversity emphasis option as Table 2 prints it ("High", "Low / Intermediate"). */
  beo: string
  beos: Beo[]
  landscapeUnits: MackenzieLandscapeUnit[]
  /** A park Objective 2(d) lets contribute, as DataBC maps it (its own landscape unit polygon, BEO "NA"). */
  park: { asPrinted: string; name: string; provid: number } | null
  rows: MackenzieRow[]
  /** The 2020 TSR data package's figure for one of the unit's rows, where it published one. */
  published: MackenziePublishedRow[]
}

export type MackenziePublishedRow = (typeof tsr2020.rows)[number]

/** Table 2's names as DataBC's landscape unit layer holds them, by printed name. */
const LAYER: Record<string, MackenzieLandscapeUnit> = Object.fromEntries(
  (
    [
      ['Akie', 'Akie', 1469, 'Low'],
      ['Akie River', 'Akie River', 1471, 'Low'],
      ['Blackwater', 'Blackwater', 1483, 'Low'],
      ['Buffalohead', 'Buffalohead', 1492, 'Low'],
      ['Chunamon', 'Chunamon', 1508, 'Low'],
      ['Collins-Davis', 'Collins - Davis', 1512, 'Low'],
      ['Germansen Mountain', 'Germansen Mountain', 1572, 'Low'],
      ['Mesilinka', 'Mesilinka', 1669, 'Low'],
      ['Osilinka', 'Osilinka', 1710, 'Low'],
      ['Aiken', 'Aiken', 8, 'Intermediate'],
      ['Clearwater', 'Clearwater', 1509, 'Intermediate'],
      ['Discovery', 'Discovery', 1527, 'Intermediate'],
      ['Duckling', 'Duckling', 1532, 'Intermediate'],
      ['Ingenika', 'Ingenika', 1604, 'Intermediate'],
      ['Lower Ospika', 'Lower Ospika', 1658, 'Intermediate'],
      ['Morfee', 'Morfee', 1678, 'Intermediate'],
      ['Nabesche', 'Nabesche', 1690, 'Intermediate'],
      ['Pesika', 'Pesika', 1719, 'Intermediate'],
      ['Schooler', 'Schooler', 1748, 'Intermediate'],
      ['Philip', 'Philip', 1724, 'Low'],
      ['Philip Lake', 'Philip Lake', 1725, 'Intermediate'],
      ['Tudyah A', 'Tudyah A', 1796, 'Intermediate'],
      ['Fox', 'Fox', 1562, 'High'],
      ['LowAkie', 'Lower Akie', 1654, 'High'],
      ['LowPesika', 'Lower Pesika', 1659, 'High'],
      ['Nation', 'Nation', 1693, 'High'],
      ['Nina Creek', 'Nina Creek', 1697, 'High'],
      ['North Ingenika', 'North Ingenika', 1701, 'High'],
      ['Swannell', 'Swannell', 1779, 'High'],
      ['Obo River', 'Obo River', 1703, 'High'],
      ['Pelly', 'Pelly', 1718, 'High'],
      ['Selwyn', 'Selwyn', 1750, 'High'],
      ['Thutade', 'Thutade', 1790, 'High'],
      ['Tutizza', 'Tutizza', 1798, 'High'],
      ['Upper Ospika', 'Upper Ospika', 1804, 'High'],
    ] as const
  ).map(([printed, name, provid, beo]) => [printed, { name, provid, beo }]),
)

/** Objective 2(d)'s parks as DataBC's landscape unit layer maps them (each its own polygon, BEO "NA"). */
const PARKS: Record<string, { name: string; provid: number }> = {
  'Muscovite Lakes Park': { name: 'Muscovite', provid: 2214 },
  'Ed Bird Estella Lake Park': { name: 'Ed Bird Estells Lake', provid: 2209 },
  'Heather Dina Lake Park': { name: 'Heather Dina Lake', provid: 2215 },
}

const beosOf = (printed: string): Beo[] => printed.split('/').map((b) => b.trim() as Beo)

/** The variants Table 1 lists, each with its group (and "(Con)" where the group is conifer-leading only). */
const TABLE1 = order.table1.groups.flatMap((g) =>
  (g.variants ?? []).map((variant) => ({ variant, group: g.group as BecGroup })),
)

const TABLE3 = new Map(order.table3.rows.map((r) => [r.group, r]))

/**
 * Table 3's interior share for a row: one figure when every group and emphasis option the row covers
 * gives the same one, else null with the reason. Group `6&7` reads Table 3's rows 6 and 7, which
 * agree. Two rows of the 2010 table are left open: Upper Ospika's "2, 3" (25% and 50% at High) and
 * Philip, Philip Lake, Tudyah A's rows, printed "Low / Intermediate" (10% and 25%).
 */
export function interiorPercentOf(groups: BecGroup[], beos: Beo[]): { percent: number | null; note: string | null } {
  const values: { group: string; beo: Beo; value: number }[] = []
  for (const g of groups.flatMap((x) => (x === '6&7' ? ['6', '7'] : [x])))
    for (const beo of beos) {
      const row = TABLE3.get(g)
      if (!row) return { percent: null, note: `Table 3 has no row for group ${g}.` }
      values.push({ group: g, beo, value: row[beo] })
    }
  const distinct = [...new Set(values.map((v) => v.value))]
  if (distinct.length === 1) return { percent: distinct[0], note: null }
  return {
    percent: null,
    note: `Table 3 gives ${values.map((v) => `${v.value}% for group ${v.group} at ${v.beo}`).join(', ')}; the order does not say which applies to this row, so its interior requirement is left to you.`,
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const DECIDUOUS_ROWS = order.table2.rows.filter((r) => r.groups.includes('6&7'))

function unitFrom(asPrinted: string): MackenzieUnit {
  const rows2010 = order.table2.rows.filter((r) => r.unitsAsPrinted === asPrinted)
  const beo = rows2010[0].beo
  const beos = beosOf(beo)
  const names = asPrinted.split(',').map((n) => n.trim())
  const landscapeUnits = names.map((n) => {
    const lu = LAYER[n]
    if (!lu) throw Error(`No DataBC landscape unit is recorded for ${n}.`)
    return lu
  })
  const rows: MackenzieRow[] = rows2010.map((r) => {
    const groups = r.groups as BecGroup[]
    const interior = interiorPercentOf(groups, beos)
    return {
      id: `g${groups.join('+')}`,
      groups,
      groupsAsPrinted: r.groupsAsPrinted,
      oldPercent: r.oldPercent,
      interiorPercent: interior.percent,
      interiorNote: interior.note,
      page: r.page,
    }
  })
  // The BWBS deciduous-leading rows are by emphasis option, for every unit that has it. A unit
  // printed "Low / Intermediate" takes both, which agree on 13% old.
  const decid = DECIDUOUS_ROWS.filter((r) => beos.includes(r.beo as Beo))
  const decidPercents = [...new Set(decid.map((r) => r.oldPercent))]
  if (decidPercents.length === 1) {
    const interior = interiorPercentOf(['6&7'], beos)
    rows.push({
      id: 'g6&7',
      groups: ['6&7'],
      groupsAsPrinted: decid[0].groupsAsPrinted,
      oldPercent: decidPercents[0],
      interiorPercent: interior.percent,
      interiorNote: interior.note,
      page: decid[0].page,
    })
  }
  const parkRow = order.parksMayContribute.parks.find((p) => names.includes(p.unit))
  const park = parkRow ? { asPrinted: parkRow.park, ...PARKS[parkRow.park] } : null
  return {
    id: slug(asPrinted),
    asPrinted,
    beo,
    beos,
    landscapeUnits,
    park,
    rows,
    published: tsr2020.rows.filter((r) => r.unit === asPrinted),
  }
}

/** Every unit or group of the 2010 Table 2, in the table's order. */
export const MACKENZIE_UNITS: MackenzieUnit[] = [
  ...new Set(order.table2.rows.filter((r) => !r.groups.includes('6&7')).map((r) => r.unitsAsPrinted)),
].map(unitFrom)

export const mackenzieUnit = (id: string) => MACKENZIE_UNITS.find((u) => u.id === id) ?? null

/** The groups 2010 removed from Table 2 (their landscape units got legal OGMAs), as printed in 2008. */
export const DROPPED_IN_2010: readonly string[] = order.droppedIn2010

/** Birch or aspen (1.5, "Deciduous species"): a leading code of birch (E…) or trembling aspen (AT). */
export function deciduousByOrder(leading: string | null | undefined): boolean {
  if (!leading) return false
  const code = leading.trim().toUpperCase()
  return code.startsWith('E') || code === 'AT'
}

/** A VRI BEC label as Table 1 writes it: zone, subzone and variant run together ("SBSwk1"). */
export const becLabel = (bec: string | null | undefined) => (bec ? bec.replace(/\s+/g, '') : null)

/**
 * The Table 1 variants a VRI label stands for. A label Table 1 lists is itself. A label of a later BEC
 * version that dropped a variant number (BWBSdk for BWBSdk1, ESSFmvp for ESSFmvp2 to 4) stands for
 * the Table 1 variants it begins, but only when they all lie in one group; otherwise for none.
 */
export function table1Variants(label: string | null): { variants: string[]; group: BecGroup | null } {
  if (!label) return { variants: [], group: null }
  const exact = TABLE1.filter((t) => t.variant === label)
  const list = exact.length ? exact : TABLE1.filter((t) => t.variant.startsWith(label))
  const groups = [...new Set(list.map((t) => t.group))]
  return groups.length === 1
    ? { variants: list.map((t) => t.variant), group: groups[0] }
    : { variants: [], group: null }
}

/** A stand's Table 1 group: BWBS deciduous-leading stands are `6&7`; groups 6 and 7 are conifer-leading only. */
export function standGroup(stand: { bec?: string | null; leading: string | null }): BecGroup | null {
  const label = becLabel(stand.bec)
  if (label?.startsWith('BWBS') && deciduousByOrder(stand.leading)) return '6&7'
  return table1Variants(label).group
}

/**
 * The age from which a stand is old (1.5, "Old Forest"): older than 120 in SBSmk1 and SBSmk2, older
 * than 100 in deciduous-leading BWBS stands, older than 140 in all other stands and units.
 */
export function mackenzieOldFrom(stand: { bec?: string | null; leading: string | null }): number {
  const label = becLabel(stand.bec)
  if (label?.startsWith('BWBS') && deciduousByOrder(stand.leading)) return 101
  const { variants } = table1Variants(label)
  if (variants.length && variants.every((v) => v === 'SBSmk1' || v === 'SBSmk2')) return 121
  return 141
}

/** A row as the panel and the evidence name it: "group 4, 5", or "BWBS deciduous-leading". */
export const rowName = (row: Pick<MackenzieRow, 'groups' | 'groupsAsPrinted'>) =>
  row.groups.includes('6&7') ? 'BWBS deciduous-leading' : `group ${row.groupsAsPrinted.replace(/,\s*/g, ', ')}`

/** The row of a unit that counts a stand, or null when no row covers its group. */
export function rowOf(unit: MackenzieUnit, group: BecGroup | null): MackenzieRow | null {
  if (!group) return null
  return unit.rows.find((r) => r.groups.includes(group)) ?? null
}

/** Objective 2(b): younger stands count toward at most this share of the target's live old forest part. */
export const MACKENZIE_YOUNGER_MAX_SHARE = order.youngerStands.maxShareOfLiveOldPortion

export const MACKENZIE_SOURCES = {
  order: {
    label: 'Mackenzie non-spatial landscape biodiversity objectives, 9 April 2008',
    url: order.sources.order.url,
  },
  amendment: { label: 'Amendment order, 23 September 2010 (Table 2 replaced)', url: order.sources.amendment.url },
  tsr2020: { label: tsr2020.title, url: tsr2020.source },
}
