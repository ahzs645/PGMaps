import { periodYears, scheduleHarvests, type Plan } from '../plan'
import type { OldForestChoices, OldForestPoolUnit, OldForestRecord } from '../records'
import {
  DEFAULT_OLD_FOREST_SETTINGS,
  joinShapes,
  prepareUnit,
  unitFigures,
  type OldForestSettings,
  type PreparedUnit,
  type Reset,
} from './oldForest'
import { isTooLarge, overlapRefusal, poolFigures, poolOverlaps, tooLargeRefusal } from './pooling'
import { readCorridors, readCountedAreas, readMap2Unit, readStands, type CountedArea, type Map2Unit } from './reads'
import { oldForestUnit, type OldForestUnit } from './units'
import { youngerStandsSettings } from './youngerStands'

export type OldForestAsk = { plan: Plan; key: string; ranOn: string }
export type OldForestReply = { progress?: string; record?: OldForestRecord; error?: string }

/** Year whose Board figures the baseline is set beside. */
export const CALIBRATION_YEAR = 2019

interface Read {
  map2: Map2Unit
  stands: Awaited<ReturnType<typeof readStands>>
  counted: CountedArea[]
  corridors: Awaited<ReturnType<typeof readCorridors>>
  readOn: string
}

/** This session's reads, by district and unit: a changed setting recalculates without reading again. */
const reads = new Map<string, Read>()
/** Prepared units of the last run, by unit, retention areas and read date (one per pooled unit). */
let prepared = new Map<string, PreparedUnit>()

const say = (progress: string) => self.postMessage({ progress } satisfies OldForestReply)
const fetchFn = (url: string, init?: RequestInit) => fetch(url, init)

/** One unit of the run: the chosen unit, or one pooled with it under D.2, with its own stated CFLB. */
interface RunUnit {
  district: string
  unit: OldForestUnit
  cflbEnteredHa: number | null
}

async function readUnit({ district, unit }: RunUnit, ranOn: string, pooled: boolean): Promise<Read> {
  const readKey = `${district}|${unit.unit}`
  const kept = reads.get(readKey)
  if (kept) return kept
  const name = pooled ? `${unit.unit}: ` : ''
  say(`Reading ${unit.unit}’s Map 2 polygons…`)
  const map2 = await readMap2Unit({ district, unit: unit.unit, fetch: fetchFn, readOn: ranOn, union: joinShapes })
  let stands: Read['stands']
  try {
    stands = await readStands({ unit: map2.geometry, fetch: fetchFn, onProgress: (m) => say(name + m) })
  } catch (e) {
    throw isTooLarge(e) ? Error(tooLargeRefusal(unit.unit, pooled)) : e
  }
  say(`${name}Reading OGMAs and parks…`)
  const counted = await readCountedAreas({ unit: map2.geometry, fetch: fetchFn })
  say(`${name}Reading forest service roads, railways and transmission lines…`)
  const corridors = await readCorridors({ unit: map2.geometry, fetch: fetchFn })
  const read = { map2, stands, counted, corridors, readOn: ranOn }
  reads.set(readKey, read)
  return read
}

function runUnits(choices: OldForestChoices): RunUnit[] {
  const resolve = (district: string, code: string) => {
    const unit = oldForestUnit(district, code)
    if (!unit) throw Error(`${code} is not one of the order’s units in ${district}.`)
    return unit
  }
  return [
    {
      district: choices.district,
      unit: resolve(choices.district, choices.unit),
      cflbEnteredHa: choices.cflbEnteredHa ?? null,
    },
    ...(choices.pooledWith ?? []).map((u) => ({
      district: u.district,
      unit: resolve(u.district, u.unit),
      cflbEnteredHa: u.cflbEnteredHa ?? null,
    })),
  ]
}

self.onmessage = async ({ data }: MessageEvent<OldForestAsk>) => {
  try {
    const { plan, key, ranOn } = data
    const choices = plan.oldForest
    if (!choices) throw Error('Choose an old forest unit first.')
    const units = runUnits(choices)
    const pooled = units.length > 1
    // D.4 is checked before anything is read: an incomplete choice calculates nothing.
    const younger = youngerStandsSettings(
      choices.younger,
      units.map((u) => u.unit),
    )
    const unitReads: Read[] = []
    for (const u of units) unitReads.push(await readUnit(u, ranOn, pooled))
    if (pooled) {
      say('Checking that the pooled units do not overlap…')
      const overlaps = poolOverlaps(units.map((u, i) => ({ label: u.unit.unit, shape: unitReads[i].map2.geometry })))
      if (overlaps.length) throw Error(overlapRefusal(overlaps))
    }
    const retention: CountedArea[] = choices.retentionAreas.map((r) => ({
      kind: 'retention',
      id: r.id,
      name: r.name,
      date: null,
      geometry: r.geometry,
    }))
    const nextPrepared = new Map<string, PreparedUnit>()
    const preparedUnits = units.map((u, i) => {
      const read = unitReads[i]
      const prepKey = `${u.district}|${u.unit.unit}|${JSON.stringify(choices.retentionAreas.map((r) => r.id))}|${read.readOn}`
      let unitPrepared = prepared.get(prepKey)
      if (!unitPrepared) {
        say(`Clipping ${read.stands.length.toLocaleString()} stands to ${pooled ? u.unit.unit : 'the unit'}…`)
        unitPrepared = prepareUnit({
          unit: u.unit,
          shape: read.map2.geometry,
          stands: read.stands,
          counted: [...read.counted, ...retention],
          corridors: read.corridors,
        })
      }
      nextPrepared.set(prepKey, unitPrepared)
      return unitPrepared
    })
    prepared = nextPrepared
    const settingsOf = (u: RunUnit): OldForestSettings => ({
      ...DEFAULT_OLD_FOREST_SETTINGS,
      countNonLegalOgmas: choices.countNonLegalOgmas,
      countParks: choices.countParks,
      interiorMethod: choices.interiorMethod,
      cflbEnteredHa: u.cflbEnteredHa,
      ...(younger ? { younger } : {}),
    })
    const years = periodYears(plan.area.startYear)
    const baseline: Reset[] = plan.baseline.map((d) => ({ year: d.year, geometry: d.geometry }))
    const perUnit = plan.schedules.map((schedule, i) => {
      say(`Calculating ${schedule.name} (${i + 1} of ${plan.schedules.length})…`)
      const resets: Reset[] = [
        ...baseline,
        ...scheduleHarvests(plan, schedule.id).map(({ shape, year }) => ({ year, geometry: shape.geometry })),
      ]
      // Interior is the costly overlay: every period for the schedule under review, the first and
      // last for the others.
      const interiorYears = schedule.id === plan.reviewSchedule ? years : [years[0], years.at(-1)!]
      return units.map((u, j) => ({
        schedule: schedule.id,
        years: unitFigures(preparedUnits[j], resets, years, interiorYears, settingsOf(u)),
      }))
    })
    say(`Setting ${CALIBRATION_YEAR} beside the Board’s figures…`)
    // The Board's table is per unit, so each pooled unit with a Board row is checked on its own, and
    // without D.4: the Board's figures count no younger stands.
    const calibrations = units.map((u, j) =>
      u.unit.board2019
        ? unitFigures(preparedUnits[j], baseline, [CALIBRATION_YEAR], [CALIBRATION_YEAR], {
            ...settingsOf(u),
            younger: null,
          })[0]
        : null,
    )
    const countsOf = (p: PreparedUnit) => ({
      stands: p.counts.stands,
      ogmas: p.counts.counted['ogma-legal'] + p.counts.counted['ogma-non-legal'],
      parks: p.counts.counted.park,
      retention: p.counts.counted.retention,
      corridors: p.counts.corridors,
    })
    const [first] = preparedUnits
    const record: OldForestRecord = {
      ranOn,
      readOn: unitReads[0].readOn,
      key,
      district: choices.district,
      unit: choices.unit,
      source: unitReads[0].map2.source,
      cflbProxyHa: first.cflbProxyHa,
      gisFraction: unitReads[0].map2.gisFraction,
      projectedYear: first.projectedYear,
      counts: countsOf(first),
      schedules: perUnit.map((byUnit) =>
        pooled ? { schedule: byUnit[0].schedule, years: poolFigures(byUnit.map((u) => u.years)) } : byUnit[0],
      ),
      calibration2019: calibrations[0],
    }
    if (younger) record.younger = { fromAge: younger.fromAge, benefit: choices.younger!.benefit.trim() }
    if (pooled)
      record.pool = units.map(
        (u, j): OldForestPoolUnit => ({
          district: u.district,
          unit: u.unit.unit,
          source: unitReads[j].map2.source,
          cflbProxyHa: preparedUnits[j].cflbProxyHa,
          ...(u.cflbEnteredHa === null ? {} : { cflbEnteredHa: u.cflbEnteredHa }),
          gisFraction: unitReads[j].map2.gisFraction,
          projectedYear: preparedUnits[j].projectedYear,
          counts: countsOf(preparedUnits[j]),
          schedules: perUnit.map((byUnit) => byUnit[j]),
          calibration2019: calibrations[j],
        }),
      )
    self.postMessage({ record } satisfies OldForestReply)
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'The calculation failed.',
    } satisfies OldForestReply)
  }
}
