/**
 * Rules for entering a landing or turnout range, so the form can say what a typed value became
 * and why. They restate what `widthExtras` and `validate` in `engine.ts` apply. No DOM.
 */
import type { WidthOverride } from './types'

const metres = (value: number) => Number(value.toFixed(2)).toLocaleString('en-CA')

/** The entry and exit tapers as the engine applies them: an unset one takes the shared taper, at most half the range. */
export function appliedTapers(v: WidthOverride): { entry: number; exit: number } {
  const range = Math.max(0, v.end - v.start)
  const shared = Math.min(Math.max(0, v.taper), range / 2)
  return {
    entry: Math.min(Math.max(0, v.entryTaperM ?? shared), range),
    exit: Math.min(Math.max(0, v.exitTaperM ?? shared), range),
  }
}

/**
 * The stations between which the whole extra width is built. Start and End are the outer ends of
 * the widening, so the tapers lie inside them. Null when the range is empty.
 */
export function fullWidthRange(v: WidthOverride): { from: number; to: number } | null {
  if (!(v.end > v.start)) return null
  const { entry, exit } = appliedTapers(v)
  return { from: Math.min(v.start + entry, v.end - exit), to: Math.max(v.start + entry, v.end - exit) }
}

/**
 * Holds a typed entry or exit taper to what the range can carry beside the other taper, and says
 * so. The two tapers together cannot be longer than Start to End.
 */
export function limitedTaper(
  v: WidthOverride,
  side: 'entry' | 'exit',
  entered: number,
): { taperM: number; note: string | null } {
  const range = Math.max(0, v.end - v.start)
  const other = appliedTapers(v)[side === 'entry' ? 'exit' : 'entry']
  const room = Math.max(0, range - other)
  const taperM = Math.max(0, Math.min(room, entered))
  if (taperM === entered) return { taperM, note: null }
  const name = side === 'entry' ? 'Entry' : 'Exit'
  return {
    taperM,
    note:
      entered < 0
        ? `${name} taper set to 0 m: a taper cannot be negative.`
        : `${name} taper limited to ${metres(taperM)} m, not ${metres(entered)} m: Start to End is ${metres(range)} m and the ${side === 'entry' ? 'exit' : 'entry'} taper takes ${metres(other)} m. Start and End include the tapers, so move them apart or shorten the other taper.`,
  }
}

/**
 * A copy of a widening starting at `start`, the same length. A copy that would not lie on the road
 * is refused with the reason and the stations that would work.
 */
export function duplicateWideningAt(
  v: WidthOverride,
  start: number,
  roadLengthM: number,
  id: string,
): { copy: WidthOverride; error: null } | { copy: null; error: string } {
  const length = v.end - v.start
  const last = roadLengthM - length
  if (!Number.isFinite(start) || start < 0 || start > last + 1e-6)
    return {
      copy: null,
      error:
        last < 0
          ? `This ${metres(length)} m ${v.kind} is longer than the road.`
          : `A ${metres(length)} m copy must start between 0 and ${metres(Math.floor(last * 10) / 10)} m to stay on the road.`,
    }
  const at = Math.min(start, last)
  return { copy: { ...v, id, name: `${v.name} copy`, start: at, end: at + length }, error: null }
}
