import { useEffect, useState, type ReactNode } from 'react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import { catalogueIdForUrl, catalogueSource, loadOrder, loadStatute } from '@/lib/legal/lawLibrary'
import { citedSpan, findSection, fold, quoteBlock, type LawSection, type LawSource } from '@/lib/legal/lawText'
import { orderPageUrl, orderProvision, type OrderText } from '@/lib/legal/orderText'
import { loadRuleQuotes, quotesFor } from '@/lib/legal/ruleQuotes'
import { bcLawsSectionUrl, orderRefs, parseProvision, type ProvisionRef } from '@/lib/legal/provisions'
import { cn } from '@/lib/utils'

/** What a citation points at: the pack's source (its document address and title) and the provision. */
export interface Citation {
  sourceUrl: string
  sourceTitle: string
  provision: string
  /** Words the rule quotes, word for word (`catalogue/rule-quotes.json`); marked in the text. */
  quotes?: string[]
  /** The rule cited, when the quotes are to be read from `rule-quotes.json` here. */
  rule?: { pack: string; id: string }
}

type Loaded =
  | { state: 'loading' }
  | { state: 'none' }
  | {
      state: 'ready'
      parts: (
        | {
            kind: 'section'
            key: string
            source: LawSource
            title: string
            section: LawSection
            subs: string[]
            terms: string[]
          }
        | { kind: 'missing'; key: string; label: string; url: string }
        | { kind: 'order'; key: string; order: OrderText; id: string }
      )[]
    }

const isOrderKind = (kind?: string) => kind === 'regional_order' || kind === 'guidance'

/** Reads the citation's sources and sections; nothing loads until a preview opens. */
function useCitation(citation: Citation | null): Loaded {
  // Kept with the citation it answers, so a new citation reads as loading without a reset.
  const [result, setResult] = useState<{ for: Citation | null; loaded: Loaded }>({
    for: null,
    loaded: { state: 'loading' },
  })
  const setLoaded = (loaded: Loaded) => setResult({ for: citation, loaded })
  useEffect(() => {
    if (!citation) return
    let live = true
    const own = catalogueIdForUrl(citation.sourceUrl)
    const kind = own ? catalogueSource(own)?.kind : undefined
    void (async () => {
      // An order's provision cited by its own id ("Objective 2(b)") is that provision alone.
      const ownOrder = own && isOrderKind(kind) ? await loadOrder(own) : null
      const exact = ownOrder?.provisions.some((p) => p.id === citation.provision)
      const refs: ProvisionRef[] = exact
        ? [{ kind: 'order', provision: citation.provision }]
        : isOrderKind(kind)
          ? orderRefs(citation.provision)
          : parseProvision(citation.provision, own)
      const parts: Extract<Loaded, { state: 'ready' }>['parts'] = []
      const seen = new Set<string>()
      for (const ref of refs) {
        if (ref.kind === 'order') {
          const orderId = ref.other ? undefined : own
          const order = orderId ? await loadOrder(orderId) : null
          const key = `order:${orderId}:${ref.provision}`
          if (order && orderProvision(order, ref.provision) && !seen.has(key)) {
            seen.add(key)
            parts.push({ kind: 'order', key, order, id: ref.provision })
          }
          continue
        }
        const id = ref.source ?? own
        if (!id) continue
        const key = `${id}:${ref.section}`
        // Two references into one section ("64(1)(b) and 64(2)–(4)") mark both places in one copy of it.
        const same = parts.find((p) => p.key === key)
        if (same?.kind === 'section') {
          if (ref.sub && !same.subs.includes(ref.sub)) same.subs.push(ref.sub)
          if (ref.term && !same.terms.includes(ref.term)) same.terms.push(ref.term)
          continue
        }
        if (seen.has(key)) continue
        seen.add(key)
        const source = await loadStatute(id)
        const section = source ? findSection(source, ref.section) : undefined
        const entry = catalogueSource(id)
        if (source && section)
          parts.push({
            kind: 'section',
            key,
            source,
            title: entry?.title ?? id,
            section,
            subs: ref.sub ? [ref.sub] : [],
            terms: ref.term ? [ref.term] : [],
          })
        else
          parts.push({
            kind: 'missing',
            key,
            label: `${entry?.title ?? id}, s. ${ref.section}${ref.sub}`,
            url: entry ? bcLawsSectionUrl(entry.url, ref.section) : citation.sourceUrl,
          })
      }
      if (live) setLoaded(parts.length ? { state: 'ready', parts } : { state: 'none' })
    })().catch(() => live && setLoaded({ state: 'none' }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setLoaded only tags the result with this citation
  }, [citation])
  return result.for === citation ? result.loaded : { state: 'loading' }
}

/** The text of a block with each quote it holds marked. */
function Marked({ text, quotes }: { text: string; quotes: string[] }) {
  const folded = fold(text)
  const hit = quotes.map((q) => fold(q)).find((q) => q.length > 3 && folded.includes(q))
  if (!hit || folded !== text.replace(/\s+/g, ' ').trim()) return <>{text}</>
  const at = folded.indexOf(hit)
  return (
    <>
      {folded.slice(0, at)}
      <mark className="rounded-sm bg-warning-surface px-0.5 text-foreground">{folded.slice(at, at + hit.length)}</mark>
      {folded.slice(at + hit.length)}
    </>
  )
}

function SectionText({
  section,
  subs,
  terms,
  quotes,
}: {
  section: LawSection
  subs: string[]
  terms: string[]
  quotes: string[]
}) {
  const spans = subs.map((sub) => citedSpan(section, sub)).filter((x): x is [number, number] => !!x)
  const termBlocks = terms
    .map((term) =>
      section.blocks.findIndex(
        (b) =>
          b.kind === 'definition' &&
          fold(b.text)
            .replace(/"/g, '')
            .startsWith(term + ' '),
      ),
    )
    .filter((i) => i >= 0)
  const focus = termBlocks[0] ?? spans[0]?.[0] ?? (quotes.length ? quoteBlock(section, quotes[0]) : -1)
  return (
    <div className="space-y-1 font-serif text-sm leading-relaxed">
      {section.blocks.map((block, i) => {
        const cited = spans.some(([a, b]) => i >= a && i <= b) || termBlocks.includes(i)
        return (
          <div
            key={i}
            ref={i === focus ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
            className={cn('rounded px-1.5 py-0.5', cited && 'bg-warning-surface/60 ring-1 ring-warning-border')}
            style={{ marginLeft: `${Math.max(0, block.depth - 1) * 1.1}rem` }}
          >
            {block.kind === 'table' && block.rows ? (
              <div className="overflow-x-auto">
                <table className="my-1 w-full border-collapse font-sans text-xs">
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className={r === 0 ? 'font-medium' : undefined}>
                        {row.map((cell, c) => (
                          <td key={c} className="border border-border px-1.5 py-0.5 align-top">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                {block.ref && i === section.blocks.findIndex((b) => b.ref === block.ref) && (
                  <span className="mr-1 font-mono text-2xs text-muted-foreground">
                    {block.ref.replace(/^.*(\([^)]+\))$/, '$1')}
                  </span>
                )}
                <Marked text={block.text} quotes={quotes} />
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The cited provisions' text, with the cited part and the rule's quotes marked and a link to each. */
export function ProvisionText({ citation }: { citation: Citation }) {
  const loaded = useCitation(citation)
  const [ruleQuotes, setRuleQuotes] = useState<string[]>([])
  const rulePack = citation.rule?.pack
  const ruleId = citation.rule?.id
  useEffect(() => {
    if (!rulePack || !ruleId) return
    let live = true
    loadRuleQuotes()
      .then((file) => live && setRuleQuotes(quotesFor(file, rulePack, ruleId).map((q) => q.quote)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [rulePack, ruleId])
  const quotes = citation.quotes ?? ruleQuotes
  if (loaded.state === 'loading') return <p className="text-xs text-muted-foreground">Reading the provision…</p>
  if (loaded.state === 'none')
    return (
      <div className="space-y-2">
        {quotes.map((q) => (
          <blockquote key={q} className="border-l-2 border-primary pl-3 font-serif text-sm italic">
            “{q}”
          </blockquote>
        ))}
        <InlineAlert tone="info">
          PGMaps keeps no text for this provision.{' '}
          <a className="underline" href={citation.sourceUrl} target="_blank" rel="noreferrer">
            Open {citation.sourceTitle}
          </a>
          .
        </InlineAlert>
      </div>
    )
  const licence = loaded.parts.find((p) => p.kind === 'section')
  return (
    <div className="space-y-4">
      {quotes.length > 0 && (
        <div className="space-y-1">
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {citation.rule?.id.includes('#') ? 'Quoted for this exception' : 'Quoted by this rule'}
          </p>
          {quotes.map((q) => (
            <blockquote key={q} className="border-l-2 border-primary pl-3 font-serif text-sm italic">
              “{q}”
            </blockquote>
          ))}
        </div>
      )}
      {loaded.parts.map((part) => {
        if (part.kind === 'missing')
          return (
            <InlineAlert key={part.key} tone="info">
              {part.label} is not in PGMaps’ copy.{' '}
              <a className="underline" href={part.url} target="_blank" rel="noreferrer">
                Open it on BC Laws
              </a>
              .
            </InlineAlert>
          )
        if (part.kind === 'order') {
          const p = orderProvision(part.order, part.id)!
          return (
            <section key={part.key} className="space-y-2" aria-label={`${part.order.title}, ${p.id}`}>
              <Heading
                number={p.id}
                title={p.heading}
                place={`${part.order.title} · page ${p.page}`}
                href={orderPageUrl(part.order, p.page)}
                linkLabel="Open the signed order at this page"
              />
              {p.quotes.map((q) => (
                <blockquote key={q} className="border-l-2 border-primary pl-3 font-serif text-sm">
                  <Marked text={q} quotes={quotes} />
                </blockquote>
              ))}
              <p className="text-2xs text-muted-foreground">
                Transcribed word for word from the signed order ({part.order.transcribedFrom}). The order’s PDF is the
                authority.
              </p>
            </section>
          )
        }
        const place = part.section.hierarchy.map((h) => h.name || h.number).join(' · ')
        return (
          <section key={part.key} className="space-y-2" aria-label={`${part.title}, section ${part.section.number}`}>
            <Heading
              number={`s. ${part.section.number}${part.subs.join(', ')}${part.terms.map((t) => ` “${t}”`).join(',')}`}
              title={part.section.title}
              place={`${part.title}${place ? ' · ' + place : ''}`}
              href={bcLawsSectionUrl(part.source.officialUrl, part.section.number)}
              linkLabel="Open this section on BC Laws"
            />
            {part.section.repealed && (
              <InlineAlert tone="warning">This section is repealed in the stored consolidation.</InlineAlert>
            )}
            <SectionText section={part.section} subs={part.subs} terms={part.terms} quotes={quotes} />
          </section>
        )
      })}
      {licence?.kind === 'section' && (
        <p className="text-2xs text-muted-foreground">
          Text retrieved from BC Laws on {licence.source.retrievedAt.slice(0, 10)}.{' '}
          <a className="underline" href={licence.source.licence.url} target="_blank" rel="noreferrer">
            {licence.source.licence.name}
          </a>
          : not an official version and not endorsed by the Province.
        </p>
      )}
    </div>
  )
}

function Heading({
  number,
  title,
  place,
  href,
  linkLabel,
}: {
  number: string
  title: string
  place: string
  href: string
  linkLabel: string
}) {
  return (
    <div className="space-y-0.5">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-sm font-semibold text-primary">{number}</span>
        <span className="text-sm font-medium">{title}</span>
      </p>
      <p className="text-2xs text-muted-foreground">{place}</p>
      <a className="text-xs underline" href={href} target="_blank" rel="noreferrer">
        {linkLabel} ↗
      </a>
    </div>
  )
}

/** A citation that opens its provision in a dialog: the section, the cited part marked, and the link out. */
export function ProvisionLink({
  citation,
  children,
  className,
}: {
  citation: Citation
  children?: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <DialogShell
      open={open}
      onOpenChange={setOpen}
      title={`${citation.sourceTitle}, ${citation.provision}`}
      eyebrow="Provision"
      size="lg"
      expandable
      closeLabel="Close provision"
      trigger={
        <button type="button" className={cn('text-left underline decoration-dotted underline-offset-2', className)}>
          {children ?? `${citation.sourceTitle}, ${citation.provision}`}
        </button>
      }
    >
      {open && <ProvisionText citation={citation} />}
    </DialogShell>
  )
}
