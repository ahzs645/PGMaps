/**
 * Gives every shipped rule a starting quote in packages/legal-rules/catalogue/rule-quotes.json:
 * the words of the paragraph its provision cites, from the stored law text or the order's
 * transcription. A rule that already has quotes keeps them, so a reviewer's choice is never
 * replaced; `--check` fails when a rule has none.
 *
 *   npx tsx scripts/legal-rules/rule-quotes.ts          # add quotes for rules without one
 *   npx tsx scripts/legal-rules/rule-quotes.ts --check  # fail on a rule without one
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { citedSpan, findSection, type LawSource } from '../../src/lib/legal/lawText'
import { orderProvision, type OrderText } from '../../src/lib/legal/orderText'
import { orderRefs, parseProvision } from '../../src/lib/legal/provisions'
import { exceptionKey, MAX_RULE_QUOTE_CHARS, type RuleQuote, type RuleQuotesFile } from '../../src/lib/legal/ruleQuotes'
import { parsePack } from '../../packages/legal-rules/src/contract'

const root = new URL('../../packages/legal-rules/', import.meta.url)
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const catalogue = read('catalogue/sources.json').sources as { id: string; url: string; kind: string }[]
const byUrl = new Map<string, string>()
for (const s of catalogue) if (!byUrl.has(s.url)) byUrl.set(s.url, s.id)
const kindOf = (id: string) => catalogue.find((s) => s.id === id)?.kind
const statute = (id: string): LawSource | null => {
  try {
    return read(`catalogue/generated/${id}.sections.json`)
  } catch {
    return null
  }
}
const order = (id: string): OrderText | null => {
  try {
    return read(`catalogue/orders/${id}.json`)
  } catch {
    return null
  }
}

const definesTerm = (text: string, term: string) => text.replace(/[“”"]/g, '').startsWith(term + ' ')

/** A paragraph cut to the quote length at a clause, else a word, so it stays word for word. */
function trim(text: string) {
  if (text.length <= MAX_RULE_QUOTE_CHARS) return text
  const cut = text.slice(0, MAX_RULE_QUOTE_CHARS + 1)
  const clause = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '))
  return (clause > 160 ? cut.slice(0, clause) : cut.slice(0, cut.lastIndexOf(' '))).replace(/[\s,;:(]+$/, '')
}

export function startingQuotes(sourceUrl: string, provision: string): RuleQuote[] {
  const own = byUrl.get(sourceUrl)
  if (!own) return []
  const isOrder = ['regional_order', 'guidance'].includes(kindOf(own) ?? '')
  // An order's provision may be cited by its own id ("Strategy 1b", "PG DM ¶2") before any reading of it.
  const refs = isOrder
    ? [{ kind: 'order' as const, provision }, ...orderRefs(provision)]
    : parseProvision(provision, own)
  const out: RuleQuote[] = []
  for (const ref of refs) {
    if (out.length >= 2) break
    if (ref.kind === 'order') {
      const o = ref.other ? null : order(own)
      const p = o && orderProvision(o, ref.provision)
      if (p && !out.some((q) => q.provision === p.id)) out.push({ source: own, provision: p.id, quote: p.quotes[0] })
      continue
    }
    const id = ref.source ?? own
    const law = statute(id)
    const section = law && findSection(law, ref.section)
    if (!section || section.repealed) continue
    const prose = section.blocks
      .map((b, i) => [b, i] as const)
      .filter(([b]) => b.kind !== 'table' && b.text.length > 20)
    let at: number | undefined
    if (ref.term) at = section.blocks.findIndex((b) => b.kind === 'definition' && definesTerm(b.text, ref.term!))
    else {
      const span = citedSpan(section, ref.sub)
      at = span ? prose.find(([, i]) => i >= span[0] && i <= span[1])?.[1] : undefined
      // A bare definitions section ("1") quotes nothing in particular: leave it to the other references.
      if (at === undefined && !ref.sub && section.blocks.every((b) => b.kind === 'definition' || b.text.length < 60))
        continue
      at ??= prose.find(([b]) => b.kind !== 'definition')?.[1]
    }
    if (at === undefined || at < 0) continue
    // A lead-in ("The minister may, under subsection (1),") reads only with what follows it.
    let text = section.blocks[at].text
    for (
      let k = at + 1;
      k < section.blocks.length &&
      (/[,:—-]$/.test(text) || section.blocks[k].depth > section.blocks[at].depth) &&
      text.length < 140;
      k++
    )
      text += ' ' + section.blocks[k].text
    out.push({ source: id, provision: ref.section, quote: trim(text) })
  }
  return out
}

function main() {
  const file: RuleQuotesFile = read('catalogue/rule-quotes.json')
  const missing: string[] = []
  for (const name of readdirSync(new URL('packs/', root))
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    const pack = parsePack(read('packs/' + name))
    const rules = (file.rules[pack.id] ??= {})
    // A rule's exceptions are quoted under "<rule>#<exception>", from their own provisions.
    const cited = pack.rules.flatMap((rule) => [
      { key: rule.id, source: rule.source, provision: rule.provision },
      ...(rule.exceptions ?? []).map((x) => ({ key: exceptionKey(rule.id, x.id), ...x })),
    ])
    for (const c of cited) {
      if (rules[c.key]?.length) continue
      const source = pack.sources.find((s) => s.id === c.source)!
      const quotes = startingQuotes(source.url, c.provision)
      if (quotes.length) rules[c.key] = quotes
      else missing.push(`${pack.id}:${c.key} (${c.provision})`)
    }
  }
  if (process.argv.includes('--check')) {
    if (missing.length) throw Error('Rules without a quote:\n' + missing.join('\n'))
    return
  }
  for (const id of Object.keys(file.rules)) file.rules[id] = Object.fromEntries(Object.entries(file.rules[id]).sort())
  writeFileSync(new URL('catalogue/rule-quotes.json', root), JSON.stringify(file, null, 2) + '\n')
  if (missing.length) console.log('No quote found for:\n' + missing.join('\n'))
}
main()
