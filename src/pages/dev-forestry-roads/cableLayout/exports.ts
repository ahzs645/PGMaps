/**
 * The support layout as CSV: one row per support or anchor, one per span and one for the line.
 * Pure.
 */
import type { CableLayoutResult } from './cableLayout'

const COLUMNS = [
  'record',
  'd_line',
  'kind',
  'station_from_yarder_m',
  'to_station_m',
  'ground_m',
  'saddle_height_m',
  'fixed',
  'empty_tension_kN',
  'empty_break_deg',
  'loaded_break_deg',
  'loaded_limit_deg',
  'lift_off_limit_deg',
  'saddle_rope_only_kN',
  'saddle_carriage_on_kN',
  'saddle_carriage_before_kN',
  'saddle_carriage_after_kN',
  'max_force_kN',
  'anchor_pull_angle_deg',
  'chord_m',
  'empty_sag_m',
  'loaded_sag_m',
  'loaded_tension_kN',
  'peak_tension_kN',
  'allowable_kN',
  'min_clearance_m',
  'min_clearance_at_m',
  'clearance_ok',
  'gravity_ok',
  'tension_ok',
  'unknown_ground_at_m',
  'rope_length_m',
  'unstrained_length_m',
] as const
type Column = (typeof COLUMNS)[number]

const num = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? '' : v.toFixed(digits))
const text = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const yes = (v: boolean) => (v ? 'yes' : 'no')
const row = (values: Partial<Record<Column, string>>) => COLUMNS.map((c) => values[c] ?? '').join(',')

export function cableLayoutCsv(lineName: string, result: CableLayoutResult): string {
  const name = text(lineName)
  const rows = [COLUMNS.join(',')]
  for (const s of result.supports)
    rows.push(
      row({
        record: 'support',
        d_line: name,
        kind: s.kind,
        station_from_yarder_m: num(s.stationM),
        ground_m: num(s.groundM),
        saddle_height_m: num(s.heightM),
        fixed: yes(s.fixed),
        empty_tension_kN: num(s.emptyTensionKN),
        empty_break_deg: num(s.emptyBreakDeg),
        loaded_break_deg: num(s.loadedBreakDeg),
        loaded_limit_deg: num(s.loadedLimitDeg),
        lift_off_limit_deg: num(s.liftOffLimitDeg),
        saddle_rope_only_kN: num(s.saddleRopeKN),
        saddle_carriage_on_kN: num(s.saddleCarriageOnKN),
        saddle_carriage_before_kN: num(s.saddleBeforeKN),
        saddle_carriage_after_kN: num(s.saddleAfterKN),
        max_force_kN: num(s.maxForceKN),
        anchor_pull_angle_deg: num(s.pullAngleDeg),
      }),
    )
  for (const s of result.spans)
    rows.push(
      row({
        record: 'span',
        d_line: name,
        kind: 'span',
        station_from_yarder_m: num(s.fromM),
        to_station_m: num(s.toM),
        chord_m: num(s.chordM),
        empty_sag_m: num(s.emptySagM, 3),
        loaded_sag_m: num(s.loadedSagM, 3),
        loaded_tension_kN: num(s.loadedTensionKN),
        peak_tension_kN: num(s.peakTensionKN),
        allowable_kN: num(result.allowableKN),
        min_clearance_m: num(s.minClearanceM),
        min_clearance_at_m: num(s.minClearanceAtM),
        clearance_ok: yes(s.clearanceOk),
        gravity_ok: yes(s.gravityOk),
        tension_ok: yes(s.tensionOk),
        unknown_ground_at_m: num(s.unknownGroundAtM),
      }),
    )
  rows.push(
    row({
      record: 'line',
      d_line: name,
      kind: result.status,
      station_from_yarder_m: '0.00',
      to_station_m: num(result.reachM),
      empty_tension_kN: num(result.preTensionKN),
      peak_tension_kN: num(result.maxTensionKN),
      allowable_kN: num(result.allowableKN),
      min_clearance_m: num(result.minClearanceM),
      min_clearance_at_m: num(result.minClearanceAtM),
      clearance_ok: result.clearanceKnown ? yes(result.spans.every((s) => s.clearanceOk)) : 'unknown',
      gravity_ok: yes(result.spans.every((s) => s.gravityOk)),
      tension_ok: yes(result.tensionOk),
      rope_length_m: num(result.ropeLengthM),
      unstrained_length_m: num(result.unstrainedLengthM),
    }),
  )
  return rows.join('\n') + '\n'
}
