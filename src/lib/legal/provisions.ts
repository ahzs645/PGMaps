/**
 * Reads the provision strings the packs and the ground catalogue cite ("64(1)(b) and 64(2)–(4)",
 * "s. 1 \"farm use\", s. 20(1)", "ss. 59–63", "29 with the 2006 order Part C.5 and FPPR 44(3)") into
 * the sections they name, so a citation can open its text and jump to its place on BC Laws.
 *
 * It reads numbers only and never interprets a provision. A reference to another instrument inside
 * the string ("with FPPR 44(3)") comes back with that instrument's catalogue id; an order's own
 * provisions ("Part C.5", "D.5(a)", "Table 7") come back as order references, matched against the
 * order's quote file. Free text ("net area to be reforested (f)") is left out. DOM-free.
 */

export interface StatuteRef {
  kind: 'section'
  /** The catalogue id when the string names another instrument ("FPPR 44(3)"); else the citing source's. */
  source?: string
  /** "64", "20.22", "Schedule 2.1". */
  section: string
  /** The subsection and paragraph as printed: "(1)(b)", "(2)–(4)"; empty for the whole section. */
  sub: string
  /** A defined term the citation points at: s. 1 "farm use". */
  term?: string
}
export interface OrderRef {
  kind: 'order'
  /** "Part C.5", "D.5(a)", "Table 7", "Part II", "Objective 3". */
  provision: string
  /** Set when the string names a different order than the citing one ("the 2006 order Part C.5"). */
  other?: string
}
export type ProvisionRef = StatuteRef | OrderRef

/** Names a citation may use for another instrument, with their catalogue ids. */
export const SOURCE_ALIASES: Record<string, string> = {
  FPPR: 'bc.fppr',
  FRPA: 'bc.frpa',
  GAR: 'bc.gar',
  RPPR: 'bc.rppr',
  'Land Act': 'bc.land-act',
  'Range Act': 'bc.range-act',
  'Forest Act': 'bc.forest-act',
}

/** Integer ranges wider than this are kept as their two ends; a wider one is almost always a typo. */
const MAX_EXPANDED_RANGE = 12
const DASH = /\s*[–—-]\s*/
const SECTION = /^(?:schedule\s+(\w+)\.)?(\d+(?:\.\d+)*)((?:\s*\([0-9A-Za-z.]+\))*)/i

function subOf(raw: string) {
  return raw.replace(/\s+/g, '')
}

type Level = 'number' | 'letter' | 'roman' | 'capital'
const levelOf = (label: string, before?: Level): Level =>
  /^\d/.test(label)
    ? 'number'
    : /^[A-Z]+$/.test(label)
      ? 'capital'
      : /^[ivx]+$/.test(label) && (label.length > 1 || before === 'letter' || before === 'roman')
        ? 'roman'
        : 'letter'
const labelsOf = (sub: string) => [...sub.matchAll(/\(([^)]+)\)/g)].map((m) => m[1])

/**
 * A bare paragraph after a citation keeps the citation's outer levels: "(c)" after "(1)(b)" is
 * "(1)(c)", "(3)" after "(1)(a)(ii)" is "(3)". The first label's kind (number, letter, roman,
 * capital) says which level it replaces.
 */
function continueSub(lastSub: string, piece: string) {
  const prior = labelsOf(lastSub.split('–')[0])
  const kinds: Level[] = []
  prior.forEach((l, i) => kinds.push(levelOf(l, kinds[i - 1])))
  const first = labelsOf(piece)[0]
  if (!first) return piece
  const kind = levelOf(first, kinds[kinds.length - 2])
  const at = kinds.lastIndexOf(kind)
  return at <= 0
    ? piece
    : prior
        .slice(0, at)
        .map((l) => `(${l})`)
        .join('') + piece
}

/** One comma- or "and"-separated piece of a statute citation. */
function readPiece(piece: string, last: StatuteRef | undefined, source: string | undefined): StatuteRef[] {
  let text = piece.trim().replace(/^(?:ss?\.|§)\s*/i, '')
  const term = text.match(/^"([^"]+)"$/) ?? text.match(/^“([^”]+)”$/)
  if (term && last) return [{ ...last, sub: '', term: term[1] }]
  // A bare subsection list continues the last section: "66(1), (3)–(4)", "45(1)(b), (c)".
  if (/^\(/.test(text) && last)
    return [{ ...last, sub: continueSub(last.sub, subOf(text.split(/\s/)[0].replace(DASH, '–'))) }]
  const m = text.match(SECTION)
  if (!m) return []
  const schedule = m[1] ? `Schedule ${m[1]}.` : ''
  const section = schedule + m[2]
  let sub = subOf(m[3])
  text = text.slice(m[0].length)
  const out: StatuteRef[] = []
  const range = text.match(/^\s*[–—-]\s*(\d+(?:\.\d+)*)?((?:\([0-9A-Za-z.]+\))*)/)
  const termAfter = text.match(/^\s*"([^"]+)"/)
  if (range && range[1] && !range[2]) {
    // "32–35" or "20.21–20.22": sections, not subsections.
    const a = Number(m[2])
    const b = Number(range[1])
    if (Number.isInteger(a) && Number.isInteger(b) && b > a && b - a <= MAX_EXPANDED_RANGE && !sub) {
      for (let n = a; n <= b; n++) out.push({ kind: 'section', source, section: schedule + n, sub: '' })
      return out
    }
    out.push(
      { kind: 'section', source, section, sub },
      { kind: 'section', source, section: schedule + range[1], sub: '' },
    )
    return out
  }
  if (range && (range[2] || range[1])) {
    // "64(2)–(4)" or "29(0.1)–(3)" or "44(3)(h)–(i)".
    sub = sub + '–' + subOf((range[1] ?? '') + range[2])
  }
  out.push({ kind: 'section', source, section, sub, ...(termAfter ? { term: termAfter[1] } : {}) })
  return out
}

const ORDER_TOKEN =
  /\b(?:Parts?\s+)?(?:Part\s+)?((?:[IV]+|[A-E](?:\.\d+)?(?:\([a-z]\))?(?:\s*[–-]\s*[A-E]?\.?\d+)?)|Table\s+\d+|Objective\s+\d+|Strategy\s+[\d.]+)(?!\w)/g

/** Reads an order's own provision string: "I, Part C.2–C.4", "D.5(a)", "C / Table 7", "II". */
export function parseOrderProvision(provision: string, other?: string): OrderRef[] {
  const out: OrderRef[] = []
  const text = provision.replace(/\band\b/g, ',')
  for (const m of text.matchAll(ORDER_TOKEN)) {
    const token = m[1].replace(/\s+/g, ' ')
    // "I" before a Part letter is the order's Part I heading, not a provision of its own.
    if (token === 'I' && /\bPart/.test(text.slice((m.index ?? 0) + 1))) continue
    const range = token.match(/^([A-E])\.(\d+)\s*[–-]\s*(?:[A-E]\.)?(\d+)$/)
    if (range) {
      for (let n = Number(range[2]); n <= Number(range[3]); n++)
        out.push({ kind: 'order', provision: `${range[1]}.${n}`, other })
      continue
    }
    out.push({ kind: 'order', provision: /^[IV]+$/.test(token) ? `Part ${token}` : token, other })
  }
  return out
}

/**
 * The sections a statute citation names. `source` is the citing source's catalogue id, kept on each
 * reference unless the string names another instrument.
 */
export function parseProvision(provision: string, source?: string): ProvisionRef[] {
  const out: ProvisionRef[] = []
  // "29 with the 2006 order Part C.5 and FPPR 44(3)": the part before "with" is this source's.
  const [own, ...withs] = provision.split(/\bwith\b/)
  const pieces = (text: string, src: string | undefined) => {
    let last: StatuteRef | undefined
    for (const raw of text.split(/,|\band\b/)) {
      const read = readPiece(raw, last, src)
      if (read.length) last = read[read.length - 1]
      out.push(...read)
    }
  }
  pieces(own, source)
  for (const w of withs) {
    for (const part of w.split(/\band\b/)) {
      const alias = Object.keys(SOURCE_ALIASES).find((a) => new RegExp(`\\b${a}\\b`).test(part))
      if (alias) {
        pieces(part.slice(part.indexOf(alias) + alias.length), SOURCE_ALIASES[alias])
        continue
      }
      const order = part.match(/\b(\d{4})\s+order\b(.*)$/)
      if (order) out.push(...parseOrderProvision(order[2], order[1]))
    }
  }
  return out
}

/**
 * A list under one label, as orders that number their strategies or paragraphs are cited:
 * "Strategy 1.02, 2.02", "Strategy 1.01–1.02", "Para 1–2". Ranges run within one objective.
 * Null when the citation does not start with such a label.
 */
function labelledRefs(provision: string): OrderRef[] | null {
  const item = String.raw`\d+(?:\.\d+)?(?:\([a-z]\))?(?:\s*[–-]\s*\d+(?:\.\d+)?)?`
  const m = provision
    .trim()
    .match(new RegExp(String.raw`^(Strategy|Objective|Para|Guidance)\s+(${item}(?:\s*(?:,|\band\b)\s*${item})*)$`))
  if (!m) return null
  const out: OrderRef[] = []
  for (const raw of m[2].split(/,|\band\b/)) {
    const piece = raw.trim()
    if (!piece) continue
    const range = piece.match(/^(\d+)(?:\.(\d+))?\s*[–-]\s*(\d+)(?:\.(\d+))?$/)
    if (!range) {
      out.push({ kind: 'order', provision: `${m[1]} ${piece}` })
      continue
    }
    const [, a, aMinor, b, bMinor] = range
    if (aMinor !== undefined && bMinor !== undefined && a === b)
      for (let n = Number(aMinor); n <= Number(bMinor); n++)
        out.push({ kind: 'order', provision: `${m[1]} ${a}.${String(n).padStart(aMinor.length, '0')}` })
    else if (aMinor === undefined && bMinor === undefined)
      for (let n = Number(a); n <= Number(b); n++) out.push({ kind: 'order', provision: `${m[1]} ${n}` })
    else out.push({ kind: 'order', provision: `${m[1]} ${a}${aMinor ? '.' + aMinor : ''}` })
  }
  return out
}

/**
 * The provisions an order or policy citation names. Orders number their own way ("Part C.5",
 * "D.5(a)"); a policy or a numbered order uses plain numbers ("11.2", "3"), read as its provisions.
 */
export function orderRefs(provision: string): OrderRef[] {
  const labelled = labelledRefs(provision)
  if (labelled) return labelled
  const named = parseOrderProvision(provision)
  if (named.length) return named
  return parseProvision(provision).flatMap((r) =>
    r.kind === 'section' ? [{ kind: 'order' as const, provision: r.section + (r.sub.includes('–') ? '' : r.sub) }] : [],
  )
}

/** The address of a section on BC Laws: the document URL with its `#section` anchor. */
export function bcLawsSectionUrl(documentUrl: string, section: string) {
  if (!/bclaws\.gov\.bc\.ca\/civix\/document/.test(documentUrl) || /^Schedule/i.test(section)) return documentUrl
  return documentUrl.replace(/#.*$/, '') + '#section' + section
}
