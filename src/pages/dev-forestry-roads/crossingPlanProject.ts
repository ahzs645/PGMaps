import { CROSSING_STRUCTURES } from './crossingPlan'
import type { CrossingCostItem, CrossingStructure, StreamCrossingRecord } from './crossingPlanTypes'

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Crossing plan entry must be an object.')
  return value as Record<string, unknown>
}
const text = (value: unknown, max: number, required = false): string => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw Error(`Crossing plan text must contain ${required ? '1' : '0'}–${max} characters.`)
  return value
}
const id = (value: unknown): string => {
  const result = text(value, 100, true)
  if (!/^[a-zA-Z0-9_.:-]+$/.test(result)) throw Error('Invalid crossing plan ID.')
  return result
}
const number = (value: unknown, max = 1e9): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max)
    throw Error('Crossing quantities, rates and chainages must be finite and nonnegative.')
  return value
}
const list = (value: unknown, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) throw Error(`Crossing plan supports at most ${max} entries.`)
  return value
}
const unique = <T extends { id: string }>(rows: T[]): T[] => {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw Error('Crossing plan IDs must be unique.')
  return rows
}

export function parseCrossingCostItems(value: unknown): CrossingCostItem[] {
  return unique(
    list(value, 100).map((value) => {
      const r = object(value)
      const sourceUrl = text(r.sourceUrl, 2000)
      if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw Error('Price source links must use http or https.')
      const priceDate = text(r.priceDate, 10)
      if (
        priceDate &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(priceDate) ||
          !Number.isFinite(Date.parse(`${priceDate}T00:00:00Z`)) ||
          new Date(`${priceDate}T00:00:00Z`).toISOString().slice(0, 10) !== priceDate)
      )
        throw Error('Enter a valid price date (YYYY-MM-DD).')
      return {
        id: id(r.id),
        label: text(r.label, 200, true),
        quantity: r.quantity === null ? null : number(r.quantity),
        unit: text(r.unit, 30, true),
        unitRate: r.unitRate === null ? null : number(r.unitRate),
        source: text(r.source, 2000),
        sourceUrl,
        priceDate,
      }
    }),
  )
}

export function parseCrossingRecords(value: unknown): StreamCrossingRecord[] {
  const records = unique(
    list(value, 2000).map((value) => {
      const r = object(value)
      const coordinate = list(r.coordinate, 2)
      if (
        coordinate.length !== 2 ||
        coordinate.some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
        Math.abs(coordinate[0] as number) > 180 ||
        Math.abs(coordinate[1] as number) >= 85
      )
        throw Error('Invalid crossing coordinate.')
      if (!CROSSING_STRUCTURES.some((s) => s.value === r.structure)) throw Error('Invalid crossing structure option.')
      return {
        id: id(r.id),
        featureId: id(r.featureId),
        identity: text(r.identity, 400, true),
        coordinate: coordinate as [number, number],
        chainage: number(r.chainage, 100000),
        basisFingerprint: text(r.basisFingerprint, 100, true),
        structure: r.structure as CrossingStructure,
        evidence: text(r.evidence, 10000),
        items: parseCrossingCostItems(r.items),
        ...(r.replacesCulvertId === undefined ? {} : { replacesCulvertId: id(r.replacesCulvertId) }),
      }
    }),
  )
  if (new Set(records.map((r) => r.identity)).size !== records.length)
    throw Error('Crossing records must have unique physical identities.')
  return records
}
