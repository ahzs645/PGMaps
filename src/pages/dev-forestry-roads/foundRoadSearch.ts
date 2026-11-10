/**
 * The settings Find the best route searched with, kept on each road it found, so the road can say
 * months later how it was made: its goal, grade limit, corridor, ground window, switchback rules,
 * placeholder prices and the day. Optional on an alignment; a road without it loads as before.
 *
 * Free of DOM and network access.
 */
import { routePointsKey } from './routeAlternatives'
import { matchingSearchPreset, searchPreset, type SearchPresetId } from './searchPresets'
import { parseSwitchbackRouteOptions, type SwitchbackRouteOptions } from './switchbackOptions'
import { isCalendarDate } from './projectIssue'
import type { Alignment, RoadSettings } from './types'

/** Goal ids, in the order `ROUTE_GOALS` lists them. Kept here so the record has no runtime import cycle. */
export const FOUND_ROAD_GOALS = ['cost', 'shortest', 'gentle', 'drainage'] as const
export type FoundRoadGoal = (typeof FOUND_ROAD_GOALS)[number]

export interface FoundRoadSearchSettings {
  /** The goals the road led when it was found, and their labels as shown then. */
  goals: FoundRoadGoal[]
  label: string
  /** Day of the search, YYYY-MM-DD, local time. */
  foundOn: string
  maxGradePercent: number
  minRadiusM: number
  /** The corridor asked for; the note says when the search widened it or left it for a grid route. */
  corridorHalfWidthM: number
  groundWindowM: number
  crossingCost: number
  crossDrainCost: number
  /** Null when no side-hill limit was set. */
  maxTerrainSlopePercent: number | null
  switchbacks: SwitchbackRouteOptions
  /** The preset the grade limit and tightest curve matched, if any. */
  preset?: SearchPresetId
  /** How the line was found, from the result's first note; absent when the search needed no fallback. */
  how?: string
  /** The road's horizontal points when found (`routePointsKey`), to say when it has been edited since. */
  pointsKey: string
}

/** Longest `how` kept: notes are a sentence or two. */
export const MAX_FOUND_ROAD_NOTE_CHARS = 600

const pad = (n: number) => String(n).padStart(2, '0')
/** A local calendar day, YYYY-MM-DD. */
export const calendarDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export function foundRoadSearchSettings(input: {
  alignment: Pick<Alignment, 'points'>
  goals: readonly FoundRoadGoal[]
  label: string
  settings: Pick<RoadSettings, 'maxGradePercent' | 'minRadius'>
  corridorHalfWidthM: number
  groundWindowM: number
  crossingCost: number
  crossDrainCost: number
  maxTerrainSlopePercent: number | null
  switchbacks: SwitchbackRouteOptions
  note?: string
  date: Date
}): FoundRoadSearchSettings {
  const preset = matchingSearchPreset(input.settings)
  const how = input.note?.trim()
  return {
    goals: [...input.goals],
    label: input.label,
    foundOn: calendarDay(input.date),
    maxGradePercent: input.settings.maxGradePercent,
    minRadiusM: input.settings.minRadius,
    corridorHalfWidthM: input.corridorHalfWidthM,
    groundWindowM: input.groundWindowM,
    crossingCost: input.crossingCost,
    crossDrainCost: input.crossDrainCost,
    maxTerrainSlopePercent: input.maxTerrainSlopePercent,
    switchbacks: { ...input.switchbacks },
    ...(preset ? { preset: preset.id } : {}),
    ...(how ? { how: how.slice(0, MAX_FOUND_ROAD_NOTE_CHARS) } : {}),
    pointsKey: routePointsKey(input.alignment.points),
  }
}

/** Validates a saved record. Every bound matches what the search itself accepts. */
export function parseFoundRoadSearchSettings(raw: unknown): FoundRoadSearchSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('Found-road search settings must be an object.')
  const r = raw as Record<string, unknown>
  const num = (value: unknown, label: string, min: number, max: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw Error(`Found-road search ${label} must be ${min}–${max.toLocaleString('en-CA')}.`)
    return value
  }
  const text = (value: unknown, label: string, max: number) => {
    if (typeof value !== 'string' || value.length > max) throw Error(`Found-road search ${label} must be text.`)
    return value
  }
  if (!Array.isArray(r.goals) || !r.goals.length || r.goals.length > FOUND_ROAD_GOALS.length)
    throw Error('Found-road search goals must be a list of goals.')
  const goals = r.goals.map((goal) => {
    if (!FOUND_ROAD_GOALS.includes(goal as FoundRoadGoal)) throw Error('Unknown found-road search goal.')
    return goal as FoundRoadGoal
  })
  const foundOn = text(r.foundOn, 'date', 10)
  if (!isCalendarDate(foundOn)) throw Error('Found-road search date must be a real date, written YYYY-MM-DD.')
  if (r.preset !== undefined && !searchPreset(String(r.preset))) throw Error('Unknown found-road search preset.')
  return {
    goals,
    label: text(r.label, 'label', 200),
    foundOn,
    maxGradePercent: num(r.maxGradePercent, 'grade limit', 1, 30),
    minRadiusM: num(r.minRadiusM, 'tightest curve', 0, 1000),
    corridorHalfWidthM: num(r.corridorHalfWidthM, 'corridor', 25, 1000),
    groundWindowM: num(r.groundWindowM, 'ground trend', 0, 100),
    crossingCost: num(r.crossingCost, 'stream crossing price', 0, 1e8),
    crossDrainCost: num(r.crossDrainCost, 'cross-drain price', 0, 1e6),
    maxTerrainSlopePercent:
      r.maxTerrainSlopePercent === null ? null : num(r.maxTerrainSlopePercent, 'side-hill limit', 1, 300),
    switchbacks: parseSwitchbackRouteOptions(r.switchbacks),
    ...(r.preset === undefined ? {} : { preset: r.preset as SearchPresetId }),
    ...(r.how === undefined ? {} : { how: text(r.how, 'note', MAX_FOUND_ROAD_NOTE_CHARS) }),
    pointsKey: text(r.pointsKey, 'fingerprint', 100),
  }
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`

/**
 * The record as label–value rows, for the road's info and the report. Says when the road's line
 * has been edited since, because the settings then describe where it started, not what it is.
 */
export function foundRoadSearchRows(
  alignment: Pick<Alignment, 'points'> & { searchSettings?: FoundRoadSearchSettings },
) {
  const record = alignment.searchSettings
  if (!record) return []
  const preset = record.preset ? searchPreset(record.preset) : undefined
  const sb = record.switchbacks
  const edited = routePointsKey(alignment.points) !== record.pointsKey
  return [
    {
      label: 'Found by',
      value: `Find the best route, ${record.foundOn}: led ${record.label}${edited ? '. The line has been edited since' : ''}`,
    },
    {
      label: 'Search limits',
      value: `Grade ${record.maxGradePercent}%; tightest curve ${record.minRadiusM} m${preset ? `; ${preset.label} preset (Engineering Manual Table 3-5 at ${preset.designSpeedKmh} km/h, speed to confirm)` : ''}`,
    },
    {
      label: 'Search area',
      value: `Corridor ±${record.corridorHalfWidthM} m; ground trend ${record.groundWindowM ? `${record.groundWindowM} m` : 'off (source samples)'}${record.maxTerrainSlopePercent === null ? '' : `; side-hill limit ${record.maxTerrainSlopePercent}%`}`,
    },
    {
      label: 'Switchbacks',
      value: sb.allow
        ? `Allowed: radius ${sb.radiusM === null ? 'road minimum, at least 12 m' : `${sb.radiusM} m`}; ≥ ${sb.spacingFactor} R apart; platform ≤ ${Math.round(sb.platformSteepShare * 100)}% over ${sb.platformSlopePercent}%`
        : 'Not allowed',
    },
    {
      label: 'Search prices',
      value: `Stream crossing ${money(record.crossingCost)}; cross-drain ${money(record.crossDrainCost)} (placeholder allowances)`,
    },
    ...(record.how ? [{ label: 'How it was found', value: record.how }] : []),
  ]
}

/** One line for the sidebar: "Found 2026-11-10 · Lowest cost · 12% · ±180 m". */
export function foundRoadSearchSummary(record: FoundRoadSearchSettings) {
  return `Found ${record.foundOn} · ${record.label} · ${record.maxGradePercent}% · ±${record.corridorHalfWidthM} m`
}
