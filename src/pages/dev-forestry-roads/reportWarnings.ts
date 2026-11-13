/**
 * Groups report warnings that repeat per structure, so a road with 28 culverts prints
 * "Culverts 1–28: Enter both … inverts …" once instead of the same sentence 28 times in each of three
 * sections (74 copies in one 46-page report). A figure that differs between structures, written in
 * parentheses, is kept beside each name. Free of DOM access.
 */

const NAMED = /^([A-Z][A-Za-z-]*(?: [A-Za-z-]+)?) (\d+): (.+)$/s
const FIGURE = /\s*\(([^()]*\d[^()]*)\)/g

/** "1, 2, 3, 5, 7, 8" → "1–3, 5, 7–8". */
export function numberRanges(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]))
    i = j + 1
  }
  return parts.join(', ')
}

interface Group {
  kind: string
  message: string
  members: { n: number; figures: string[] }[]
}

/** Repeated "<Kind> <n>: <message>" warnings become one line per message; other warnings pass through in order. */
export function groupNamedWarnings(warnings: readonly string[]): string[] {
  const out: (string | Group)[] = []
  const groups = new Map<string, Group>()
  for (const warning of warnings) {
    const match = NAMED.exec(warning.trim())
    if (!match) {
      out.push(warning)
      continue
    }
    const [, kind, n, body] = match
    const figures = [...body.matchAll(FIGURE)].map((m) => m[1])
    const message = body.replace(FIGURE, '').trim()
    const key = `${kind}\u0000${message}`
    let group = groups.get(key)
    if (!group) {
      group = { kind, message, members: [] }
      groups.set(key, group)
      out.push(group)
    }
    group.members.push({ n: Number(n), figures })
  }
  return out.map((item) => {
    if (typeof item === 'string') return item
    const { kind, message, members } = item
    if (members.length === 1) {
      const [only] = members
      return `${kind} ${only.n}: ${message}${only.figures.length ? ` (${only.figures.join('; ')})` : ''}`
    }
    const head = `${kind}s ${numberRanges(members.map((m) => m.n))}: ${message}`
    const withFigures = members.filter((m) => m.figures.length)
    return withFigures.length
      ? `${head} (${withFigures.map((m) => `${m.n}: ${m.figures.join('; ')}`).join(' · ')})`
      : head
  })
}

/**
 * Numbers the distinct flag messages in a table so each row cites notes rather than repeating the
 * sentences: returns each row's note list (with any per-row figure) and the notes in first-seen order.
 */
export function flagNotes(rows: readonly (readonly string[])[]): { cells: string[]; notes: string[] } {
  const notes: string[] = []
  const cells = rows.map((flags) =>
    flags
      .map((flag) => {
        const figures = [...flag.matchAll(FIGURE)].map((m) => m[1])
        const message = flag.replace(FIGURE, '').trim()
        let index = notes.indexOf(message)
        if (index < 0) index = notes.push(message) - 1
        return `${index + 1}${figures.length ? ` (${figures.join('; ')})` : ''}`
      })
      .join(', '),
  )
  return { cells, notes }
}
