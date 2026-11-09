/** Road names built from other road names, and the short forms shown where several sit side by side. */
const SEPARATOR = ' · '
/**
 * Parts this app appends. A road derived from a derived road replaces them rather than stacking them.
 * The last form is what route searches wrote before 2026-11: a rank and the search's score in dollars.
 */
const GENERATED =
  /^(optimized profile|lowest cost|shortest|gentlest|fewest drainage issues|terrain-cost route|terrain-cost(?: #\d+)? \(\$[\d,]+\))( \d+)?$/i
const MAX_NAME = 200

const parts = (name: string) => name.split(SEPARATOR).map((part) => part.trim())
const stem = (name: string) => {
  const kept = parts(name)
  while (kept.length > 1 && GENERATED.test(kept[kept.length - 1])) kept.pop()
  return kept.join(SEPARATOR)
}

/** `suffix` on the road this one came from, numbered when another road already has that name. */
export function derivedRoadName(name: string, suffix: string, taken: readonly string[] = []) {
  const base = `${stem(name)}${SEPARATOR}${suffix}`.slice(0, MAX_NAME - 3)
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/**
 * The part of each name that tells these roads apart. Saved projects hold names such as
 * `Hillside · training · optimized profile · optimized profile · gentlest`, so a repeat or a part
 * every road shares is dropped, and so is a generated step with a later one after it.
 */
export function shortRoadNames(names: readonly string[]): string[] {
  if (names.length < 2) return [...names]
  const split = names.map((name) => {
    const unique = parts(name).filter((part, i, all) => all.indexOf(part) === i)
    return unique.filter((part, i) => i === unique.length - 1 || !GENERATED.test(part))
  })
  const shared = split[0].filter((part) => split.every((list) => list.includes(part)))
  const rest = split.map((list) => list.filter((part) => !shared.includes(part)))
  const identical = rest.every((list) => !list.length)
  const seen = new Map<string, number>()
  return rest.map((list, i) => {
    const label = list.join(SEPARATOR) || (identical ? names[i] : 'Original')
    const count = (seen.get(label) ?? 0) + 1
    seen.set(label, count)
    return count === 1 ? label : `${label} ${count}`
  })
}
