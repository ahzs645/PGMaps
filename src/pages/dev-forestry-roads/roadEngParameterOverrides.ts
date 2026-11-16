/**
 * Writes back to a RoadEng design what `roadEngDesignSettings.ts` reads of a template's AUTO slopes
 * and the design's parameter overrides, each only where PGMaps' value differs from what was read:
 *
 * - **AUTO slopes.** A template slope's AUTO is flag 2 of its parameter (`T<t>-C<c>-U<u>`, the field
 *   after the name). Where a RoadEng template's batter source in PGMaps (`cutSlopeFrom` and its kin,
 *   `groundBatters.ts`) is no longer the one read, that flag is set (`material`) or cleared
 *   (`template`) on the parameter the slope came from, leaving the rest of the line as it stands. A
 *   closing slope RoadEng shares between cut and fill (`FinalSlpL/R`) takes one flag: where PGMaps
 *   holds different sources for the two, it is left as read and the notice says so.
 * - **Parameter overrides.** `[design] ParmOverrides-1` counts the entries, `ParmOverrides-2…` hold
 *   them (`station|code|parameter|value|description`; the code is the side, 4096 left and 8192
 *   right, as `RoadEngParameterOverrideEntry` reads it). An override read from RoadEng and unchanged
 *   keeps its entries as read. A changed one, or one added here, is written from PGMaps' stations:
 *   the design station in project units (a station read from the design keeps its text, ±FLT_MAX at
 *   the road's ends included, and its description), `**` for a blank, and the value the parameter
 *   takes to give PGMaps' side value, found by solving the template mapping
 *   (`roadEngTemplateToPgmaps`) for it at the template in force there. Two stations
 *   `ROADENG_OVERRIDE_STEP_M` apart are written at one station, RoadEng's step. An added override
 *   names the parameter the template's side value came from (`RoadEngSideSources`), with its side's
 *   code and the override's name as each new row's description. A value no parameter can give is
 *   left out and said.
 *
 * Pure: no DOM or network access.
 */
import {
  parseRoadEngSettings,
  readRoadEngIni,
  roadEngOverrideParameter,
  roadEngParameterOverridesFor,
  roadEngTemplateCodeAt,
  roadEngTemplateFor,
  roadEngTemplateToPgmaps,
  roadEngTemplateWithParameter,
  ROADENG_OVERRIDE_BEYOND,
  ROADENG_OVERRIDE_STEP_M,
  roadEngOverrideCode,
  type RoadEngRangeOptions,
  type RoadEngSettings,
  type RoadEngSideSources,
  type RoadEngSource,
  type RoadEngTemplate,
} from './roadEngDesignSettings'
import type { RoadEngDsnOverrides } from './roadEngExport'
import type { RoadEngOriginal } from './roadEngSectionExport'
import { batterSource } from './groundBatters'
import {
  OVERRIDE_FIELDS,
  overrideFieldValue,
  type OverrideField,
  type TemplateParameterOverride,
} from './templateParameterOverrides'
import type { Alignment, RoadTemplate } from './types'

type Side = 'left' | 'right'
const SIDES: Side[] = ['left', 'right']

export interface RoadEngDesignWriteBack {
  /** Keys for the `.dsn` holding `[TemplatesSct]` (the first alignment's). */
  templates: RoadEngDsnOverrides
  /** Keys for the alignment's own `.dsn` (`[design]`). */
  alignment: RoadEngDsnOverrides
  written: string[]
  notWritten: string[]
}

/** Up to nine decimals, no exponent, no trailing zeros. */
function text(value: number): string {
  const t = value.toFixed(9).replace(/\.?0+$/, '')
  return t === '-0' ? '0' : t
}

const parameterKey = (s: Extract<RoadEngSource, { kind: 'parameter' }>) =>
  `T${s.template}-C${s.component}-U${s.parameter}`

/**
 * The `.dsn` keys that carry PGMaps' batter sources and parameter overrides into the design `original`
 * the road was read from. `templatesText` is the `.dsn` holding the template table as the other
 * writers have left it, so a line another writer changed keeps that change.
 */
export function roadEngDesignWriteBack(
  alignment: Pick<Alignment, 'template' | 'engineering' | 'name'>,
  original: RoadEngOriginal & {
    /**
     * The frame the road was read in (`RoadEngSource`), when it is written in another: what was read
     * is compared in it, so an override nobody touched keeps its entries as read.
     */
    readFrame?: RoadEngRangeOptions
  },
  templatesText: string,
): RoadEngDesignWriteBack {
  const result: RoadEngDesignWriteBack = { templates: {}, alignment: {}, written: [], notWritten: [] }
  const settings = parseRoadEngSettings(original.dsnText, original.ds2Text, original.unitM, {
    ...(original.projectDsnText !== undefined ? { projectDsnText: original.projectDsnText } : {}),
  })
  const options = {
    startStation: original.startStation,
    endStation: original.endStation,
    ...(original.stationScale !== undefined ? { stationScale: original.stationScale } : {}),
    ...original.templateOptions,
    fallback: original.fallback,
  }
  const byCode = new Map<string, RoadEngTemplate>()
  for (const t of settings.templates) if (!t.folder && t.code && !byCode.has(t.code)) byCode.set(t.code, t)
  const mapping = roadEngTemplateFor(settings, options)
  // The PGMaps template each RoadEng template in use became.
  const current = (code: string): RoadTemplate | null =>
    code === mapping.baseCode
      ? alignment.template
      : (alignment.engineering?.templates.find((t) => t.id === `roadeng-${code.replace(/[^a-zA-Z0-9_.:-]/g, '_')}`)
          ?.template ?? null)

  // ---- AUTO slopes
  const table = readRoadEngIni(templatesText).get('TemplatesSct')
  const flagEdits = new Map<string, boolean>()
  const codes = new Set(settings.stationRanges.flatMap((r) => [r.leftTemplate, r.rightTemplate]))
  for (const code of codes) {
    const t = byCode.get(code)
    const now = current(code)
    if (!t || !now) continue
    const read = roadEngTemplateToPgmaps(t, original.fallback, original.templateOptions)
    if (!read.template) continue
    for (const side of SIDES) {
      const src: RoadEngSideSources = read.sources[side]
      const want = (which: 'cut' | 'fill') => batterSource(now, side, which)
      const was = (which: 'cut' | 'fill') => batterSource(read.template!, side, which)
      if (want('cut') === was('cut') && want('fill') === was('fill')) continue
      const label = `${alignment.name}: ${t.code} (${t.name}) ${side}`
      if (src.sharedSlope && want('cut') !== want('fill')) {
        result.notWritten.push(
          `${label}: cut and fill slopes from different sources, which RoadEng's one closing slope (${src.cutSlope?.kind === 'parameter' ? src.cutSlope.name : 'FinalSlp'}) cannot hold; its AUTO stays as read.`,
        )
        continue
      }
      for (const which of ['cut', 'fill'] as const) {
        if (want(which) === was(which)) continue
        const from = which === 'cut' ? src.cutSlope : src.fillSlope
        if (!from || from.kind !== 'parameter') {
          result.notWritten.push(`${label}: the ${which} slope's source, which has no RoadEng slope parameter here.`)
          continue
        }
        flagEdits.set(parameterKey(from), want(which) === 'material')
      }
    }
  }
  for (const [key, auto] of flagEdits) {
    const line = table?.get(key)
    if (line === undefined) continue
    const f = line.split('|')
    const flags = Number(f[1])
    if (!Number.isFinite(flags)) continue
    const next = auto ? flags | 2 : flags & ~2
    if (next === flags) continue
    f[1] = String(next)
    ;(result.templates.TemplatesSct ??= {})[key] = f.join('|')
    result.written.push(`${key.split('-')[0]} ${f[0].split('~')[0]}: ${auto ? 'AUTO' : 'its stated slope'}`)
  }

  // ---- Parameter overrides
  const readOptions = original.readFrame ? { ...options, ...original.readFrame } : options
  const read = roadEngParameterOverridesFor(settings, readOptions).overrides
  const now = alignment.engineering?.parameterOverrides ?? []
  if (JSON.stringify(read) === JSON.stringify(now)) return result
  const entries = overrideEntries(
    now,
    read,
    settings,
    options,
    readOptions,
    alignment.name,
    mapping.baseCode,
    result.notWritten,
  )
  const design = readRoadEngIni(original.dsnText).get('design')
  const oldCount = [...(design?.keys() ?? [])].filter((k) => /^ParmOverrides-\d+$/.test(k)).length
  const keys: Record<string, string | null> = { 'ParmOverrides-1': String(entries.length) }
  entries.forEach((e, k) => (keys[`ParmOverrides-${k + 2}`] = e))
  for (let k = entries.length + 2; k <= oldCount; k++) keys[`ParmOverrides-${k}`] = null
  // Only keys that read differently from the design's own.
  for (const [k, v] of Object.entries(keys)) if ((design?.get(k) ?? null) === v) delete keys[k]
  if (Object.keys(keys).length) {
    result.alignment.design = keys
    result.written.push(`${entries.length} parameter override entr${entries.length === 1 ? 'y' : 'ies'}`)
  }
  return result
}

/** The order an override's fields are tried to find the parameter value it stands for. */
const PRIMARY: OverrideField[] = [
  'Width',
  'DitchDepth',
  'DitchBottomWidth',
  'CutSlope',
  'FillSlope',
  'CrossfallPercent',
  'SurfaceDepth',
  'DitchWidth',
]

function overrideEntries(
  now: readonly TemplateParameterOverride[],
  read: readonly TemplateParameterOverride[],
  settings: RoadEngSettings,
  options: Parameters<typeof roadEngParameterOverridesFor>[1],
  /** The frame stations were read in: a kept entry is found at its chainage in it. */
  readOptions: RoadEngRangeOptions,
  roadName: string,
  baseCode: string | null,
  notWritten: string[],
): string[] {
  const byCode = new Map<string, RoadEngTemplate>()
  for (const t of settings.templates) if (!t.folder && t.code && !byCode.has(t.code)) byCode.set(t.code, t)
  const scale = options.stationScale ?? 1
  const unitM = settings.unitM
  const station = (chainage: number) => (chainage / scale + options.startStation) / unitM
  const designStation = (chainage: number) => chainage / scale + options.startStation
  const out: string[] = []
  // Series read from RoadEng, in the order read, then overrides added here.
  const seriesKey = (o: TemplateParameterOverride) =>
    o.roadEng ? `${o.roadEng.parameter}\u0000${o.roadEng.code}` : null
  const readSeries = new Map<string, TemplateParameterOverride[]>()
  for (const o of read) readSeries.set(seriesKey(o)!, [...(readSeries.get(seriesKey(o)!) ?? []), o])
  const nowSeries = new Map<string, TemplateParameterOverride[]>()
  for (const o of now) {
    const k = seriesKey(o)
    if (k) nowSeries.set(k, [...(nowSeries.get(k) ?? []), o])
  }
  // A series whose every field reads as it did keeps its entries as read; one removed here is dropped.
  const written = new Set<string>()
  for (const [k, list] of readSeries) {
    const mine = nowSeries.get(k)
    written.add(k)
    if (!mine) continue
    if (JSON.stringify(mine) === JSON.stringify(list)) {
      out.push(...list[0].roadEng!.entries)
      continue
    }
    out.push(
      ...entriesFor(primaryOf(mine), mine[0].roadEng!.parameter, mine[0].roadEng!.code, mine[0].roadEng!.entries),
    )
  }
  for (const [k, mine] of nowSeries)
    if (!written.has(k))
      out.push(
        ...entriesFor(primaryOf(mine), mine[0].roadEng!.parameter, mine[0].roadEng!.code, mine[0].roadEng!.entries),
      )
  // Added here: the parameter the base template's side value came from.
  for (const o of now.filter((x) => !x.roadEng)) {
    const base = baseCode ? byCode.get(baseCode) : undefined
    const mapped = base ? roadEngTemplateToPgmaps(base, options.fallback, options) : null
    const src = mapped ? sourceFor(mapped.sources[o.side], o.field) : null
    const param =
      src && base
        ? base.components.find((c) => c.index === src.component)?.parameters.find((p) => p.index === src.parameter)
        : undefined
    if (!src || !param) {
      notWritten.push(
        `${roadName}: the override ${o.name} (${OVERRIDE_FIELDS[o.field].label}), which no RoadEng parameter of the base template holds.`,
      )
      continue
    }
    out.push(...entriesFor(o, param.name, roadEngOverrideCode(o.side), []))
  }
  return out

  function primaryOf(list: TemplateParameterOverride[]) {
    return [...list].sort((a, b) => PRIMARY.indexOf(a.field) - PRIMARY.indexOf(b.field))[0]
  }
  function entriesFor(
    o: TemplateParameterOverride,
    parameter: string,
    code: number,
    kept: readonly string[],
  ): string[] {
    // A station read from the design keeps its text and description (±FLT_MAX at the road's start and
    // end); a new one is written from its chainage, described by the override's name.
    const readScale = readOptions.stationScale ?? 1
    const length = (readOptions.endStation - readOptions.startStation) * readScale
    const read = kept.map((e) => {
      const f = e.split('|')
      const s = Number(f[0])
      return {
        text: f[0],
        description: f[4] ?? '',
        chainage:
          Math.abs(s) >= ROADENG_OVERRIDE_BEYOND
            ? s < 0
              ? 0
              : length
            : (s * unitM - readOptions.startStation) * readScale,
      }
    })
    const lines: string[] = []
    let previous: { station: number; at: string } | null = null
    const used = new Set<number>()
    o.points.forEach((p) => {
      // A point a step past the one before it is RoadEng's second entry at that station.
      const step = previous && Math.abs(p.station - previous.station - ROADENG_OVERRIDE_STEP_M) < 1e-6
      const at0 = step ? previous!.station : p.station
      const k = read.findIndex(
        (r, i) => !used.has(i) && Number.isFinite(r.chainage) && Math.abs(r.chainage - at0) < 1e-5,
      )
      if (k >= 0) used.add(k)
      const same = k >= 0 ? read[k] : undefined
      const at = step ? previous!.at : (same?.text ?? text(station(p.station)))
      previous = { station: p.station, at }
      const description = (same?.description ?? o.name).replace(/[|\r\n]+/g, ' ')
      if (p.value === null) {
        lines.push(`${at}|${code}|${parameter}|**|${description}`)
        return
      }
      const templateCode = roadEngTemplateCodeAt(settings.stationRanges, designStation(p.station), o.side)
      const raw = templateCode ? solveRaw(templateCode, parameter, code, o, p.value) : null
      if (raw === null) {
        notWritten.push(
          `${roadName}: ${o.name} at ${Math.round(p.station * 10) / 10} m, a ${OVERRIDE_FIELDS[o.field].label.toLowerCase()} of ${p.value} that no value of ${parameter} gives in ${templateCode ?? 'the template there'}; RoadEng uses the template's value there.`,
        )
        lines.push(`${at}|${code}|${parameter}|**|${description}`)
        return
      }
      lines.push(`${at}|${code}|${parameter}|${text(raw)}|${description}`)
    })
    return lines
  }
  /** The parameter value whose mapped section has the override's side value: Newton on the mapping. */
  function solveRaw(
    templateCode: string,
    parameter: string,
    code: number,
    o: TemplateParameterOverride,
    target: number,
  ) {
    const t = byCode.get(templateCode)
    const found = t && roadEngOverrideParameter(t, parameter, code)
    if (!t || !found) return null
    const f = (raw: number) => {
      const m = roadEngTemplateToPgmaps(
        roadEngTemplateWithParameter(t, found.component.index, found.parameter.index, raw, unitM),
        options.fallback,
        options,
      ).template
      return m ? overrideFieldValue(m, o.side, o.field) : NaN
    }
    const close = (y: number) => Math.abs(y - target) <= 1e-7 * Math.max(1, Math.abs(target))
    // The shortest decimal that still gives the value to the mapping's micrometre.
    const done = (raw: number) => {
      for (let digits = 0; digits <= 9; digits++) {
        const r = Math.round(raw * 10 ** digits) / 10 ** digits
        if (Math.abs(f(r) - target) <= 1e-6 * Math.max(1, Math.abs(target))) return r
      }
      return Math.round(raw * 1e9) / 1e9
    }
    // On the value's logarithm first, keeping its sign (a slope's H:V is the reciprocal of its grade),
    // then on the value itself (a length that starts at 0, a crossfall that changes sign).
    const start = found.parameter.raw
    if (start !== 0) {
      const sign = Math.sign(start)
      let u = Math.log(Math.abs(start))
      for (let n = 0; n < 40; n++) {
        const y = f(sign * Math.exp(u))
        if (!Number.isFinite(y)) break
        if (close(y)) return done(sign * Math.exp(u))
        const slope = (f(sign * Math.exp(u + 1e-5)) - y) / 1e-5
        if (!Number.isFinite(slope) || Math.abs(slope) < 1e-12) break
        u -= Math.max(-2, Math.min(2, (y - target) / slope))
      }
    }
    let raw = start
    for (let n = 0; n < 40; n++) {
      const y = f(raw)
      if (!Number.isFinite(y)) return null
      if (close(y)) return done(raw)
      const h = Math.max(1e-6, Math.abs(raw) * 1e-4)
      const slope = (f(raw + h) - y) / h
      if (!Number.isFinite(slope) || Math.abs(slope) < 1e-12) return null
      raw -= (y - target) / slope
    }
    return null
  }
}

function sourceFor(
  src: RoadEngSideSources,
  field: OverrideField,
): Extract<RoadEngSource, { kind: 'parameter' }> | null {
  const pick = (s: RoadEngSource | undefined) => (s?.kind === 'parameter' ? s : null)
  switch (field) {
    case 'Width':
      return pick(src.width?.[0])
    case 'CutSlope':
      return pick(src.cutSlope)
    case 'FillSlope':
      return pick(src.fillSlope)
    case 'DitchDepth':
      return pick(src.ditch?.depth)
    case 'DitchBottomWidth':
      return pick(src.ditch?.bottom)
    case 'CrossfallPercent':
      return src.crossfall?.map(pick).find((s) => s !== null) ?? null
    default:
      return null
  }
}
