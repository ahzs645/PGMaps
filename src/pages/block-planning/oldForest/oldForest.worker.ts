import { periodYears, scheduleHarvests, type Plan } from '../plan'
import type { OldForestRecord } from '../records'
import {
  DEFAULT_OLD_FOREST_SETTINGS,
  joinShapes,
  prepareUnit,
  unitFigures,
  type PreparedUnit,
  type Reset,
} from './oldForest'
import { readExcludedAreas, type ExcludedArea } from './landBase'
import { readCorridors, readCountedAreas, readMap2Unit, readStands, type CountedArea, type Map2Unit } from './reads'
import { oldForestUnit } from './units'

export type OldForestAsk = { plan: Plan; key: string; ranOn: string }
export type OldForestReply = { progress?: string; record?: OldForestRecord; error?: string }

/** Year whose Board figures the baseline is set beside. */
export const CALIBRATION_YEAR = 2019

interface Read {
  map2: Map2Unit
  stands: Awaited<ReturnType<typeof readStands>>
  counted: CountedArea[]
  corridors: Awaited<ReturnType<typeof readCorridors>>
  excluded: ExcludedArea[]
  readOn: string
}

/** This session's reads, by district and unit: a changed setting recalculates without reading again. */
const reads = new Map<string, Read>()
let prepared: { key: string; unit: PreparedUnit } | null = null

const say = (progress: string) => self.postMessage({ progress } satisfies OldForestReply)
const fetchFn = (url: string, init?: RequestInit) => fetch(url, init)

self.onmessage = async ({ data }: MessageEvent<OldForestAsk>) => {
  try {
    const { plan, key, ranOn } = data
    const choices = plan.oldForest
    if (!choices) throw Error('Choose an old forest unit first.')
    const unit = oldForestUnit(choices.district, choices.unit)
    if (!unit) throw Error(`${choices.unit} is not one of the order’s units in ${choices.district}.`)
    const readKey = `${choices.district}|${choices.unit}`
    let read = reads.get(readKey)
    if (!read) {
      say(`Reading ${choices.unit}’s Map 2 polygons…`)
      const map2 = await readMap2Unit({
        district: choices.district,
        unit: choices.unit,
        fetch: fetchFn,
        readOn: ranOn,
        union: joinShapes,
      })
      const stands = await readStands({ unit: map2.geometry, fetch: fetchFn, onProgress: say })
      say('Reading OGMAs and parks…')
      const counted = await readCountedAreas({ unit: map2.geometry, fetch: fetchFn })
      say('Reading forest service roads, railways, transmission lines and pipelines…')
      const corridors = await readCorridors({ unit: map2.geometry, fetch: fetchFn })
      say('Reading private land, woodlots, community forests and tree farm licences…')
      const excluded = await readExcludedAreas({ unit: map2.geometry, fetch: fetchFn })
      read = { map2, stands, counted, corridors, excluded, readOn: ranOn }
      reads.set(readKey, read)
    }
    const retention: CountedArea[] = choices.retentionAreas.map((r) => ({
      kind: 'retention',
      id: r.id,
      name: r.name,
      date: null,
      geometry: r.geometry,
    }))
    const prepKey = `${readKey}|${JSON.stringify(choices.retentionAreas.map((r) => r.id))}|${read.readOn}`
    if (prepared?.key !== prepKey) {
      say(`Clipping ${read.stands.length.toLocaleString()} stands to the unit…`)
      prepared = {
        key: prepKey,
        unit: prepareUnit({
          unit,
          shape: read.map2.geometry,
          stands: read.stands,
          counted: [...read.counted, ...retention],
          corridors: read.corridors,
          excluded: read.excluded,
        }),
      }
    }
    const settings = {
      ...DEFAULT_OLD_FOREST_SETTINGS,
      countNonLegalOgmas: choices.countNonLegalOgmas,
      countParks: choices.countParks,
      interiorMethod: choices.interiorMethod,
      cflbEnteredHa: choices.cflbEnteredHa ?? null,
    }
    const years = periodYears(plan.area.startYear)
    const baseline: Reset[] = plan.baseline.map((d) => ({ year: d.year, geometry: d.geometry }))
    const schedules = plan.schedules.map((schedule, i) => {
      say(`Calculating ${schedule.name} (${i + 1} of ${plan.schedules.length})…`)
      const resets: Reset[] = [
        ...baseline,
        ...scheduleHarvests(plan, schedule.id).map(({ shape, year }) => ({ year, geometry: shape.geometry })),
      ]
      // Interior is the costly overlay: every period for the schedule under review, the first and
      // last for the others.
      const interiorYears = schedule.id === plan.reviewSchedule ? years : [years[0], years.at(-1)!]
      return { schedule: schedule.id, years: unitFigures(prepared!.unit, resets, years, interiorYears, settings) }
    })
    say(`Setting ${CALIBRATION_YEAR} beside the Board’s figures…`)
    const calibration2019 = unit.board2019
      ? unitFigures(prepared.unit, baseline, [CALIBRATION_YEAR], [CALIBRATION_YEAR], settings)[0]
      : null
    const counts = prepared.unit.counts
    const record: OldForestRecord = {
      ranOn,
      readOn: read.readOn,
      key,
      district: choices.district,
      unit: choices.unit,
      source: read.map2.source,
      cflbProxyHa: prepared.unit.cflbProxyHa,
      gisFraction: read.map2.gisFraction,
      projectedYear: prepared.unit.projectedYear,
      counts: {
        stands: counts.stands,
        ogmas: counts.counted['ogma-legal'] + counts.counted['ogma-non-legal'],
        parks: counts.counted.park,
        retention: counts.counted.retention,
        corridors: counts.corridors,
      },
      excluded: prepared.unit.excluded,
      corridorKinds: counts.corridorKinds,
      schedules,
      calibration2019,
    }
    self.postMessage({ record } satisfies OldForestReply)
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'The calculation failed.',
    } satisfies OldForestReply)
  }
}
