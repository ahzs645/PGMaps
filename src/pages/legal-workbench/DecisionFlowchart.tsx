import { hierarchy, tree as tidyTree } from 'd3'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { downloadText } from '@/lib/download'
import { useElementSize } from '@/hooks/useElementSize'
import { ACTION_KIND, decisionTree, treeToMermaid, type DecisionTree, type TreeNode } from '@/lib/legal/decisionTree'
import { exceptionKey, loadRuleQuotes, quotesFor, type RuleQuotesFile } from '@/lib/legal/ruleQuotes'
import { cn } from '@/lib/utils'
import type { Pack, Scalar } from '../../../packages/legal-rules/src/contract'
import { ProvisionLink, ProvisionText } from './ProvisionPreview'

export interface FlowchartTopic {
  id: string
  label: string
  rules: string[]
}

const NODE_W = 212
const LINE_H = 14
const PAD = 10
const GAP_X = 28
const GAP_Y = 54
const MAX_LINES = 4

/** Words into lines of at most `width` characters, at most `MAX_LINES` of them. */
function wrap(text: string, width = 30) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width && line) {
      lines.push(line)
      line = word
    } else line = (line + ' ' + word).trim()
  }
  if (line) lines.push(line)
  if (lines.length > MAX_LINES) {
    lines.length = MAX_LINES
    lines[MAX_LINES - 1] = lines[MAX_LINES - 1].replace(/\s*\S*$/, '') + '…'
  }
  return lines
}

interface Placed {
  node: TreeNode
  x: number
  y: number
  h: number
  lines: string[]
  /** The branch into this node from its parent. */
  via?: { label: string; taken: boolean | null; parentLit: boolean }
  parent?: Placed
}

function textOf(n: TreeNode) {
  if (n.kind === 'question') return n.fact.label
  if (n.kind === 'rule') return n.rule.title
  return ''
}

function layout(t: DecisionTree) {
  type Datum = { node: TreeNode; via?: Placed['via'] }
  const root = hierarchy<Datum>({ node: t.root }, (d) =>
    d.node.kind === 'rule'
      ? []
      : d.node.edges.map((e) => ({
          node: e.to,
          via: { label: e.label, taken: e.taken, parentLit: t.lit.has(d.node.id) },
        })),
  )
  const heights = new Map<TreeNode, number>()
  root.each((d) => {
    const lines =
      d.data.node.kind === 'fork' ? 0 : wrap(textOf(d.data.node)).length + (d.data.node.kind === 'rule' ? 1 : 0)
    heights.set(d.data.node, d.data.node.kind === 'fork' ? 10 : lines * LINE_H + PAD * 2)
  })
  const rowH = Math.max(...heights.values()) + GAP_Y
  tidyTree<Datum>().nodeSize([NODE_W + GAP_X, rowH])(root)
  const placed: Placed[] = []
  const byNode = new Map<TreeNode, Placed>()
  root.each((d) => {
    const p: Placed = {
      node: d.data.node,
      x: d.x ?? 0,
      y: d.y ?? 0,
      h: heights.get(d.data.node)!,
      lines: d.data.node.kind === 'fork' ? [] : wrap(textOf(d.data.node)),
      via: d.data.via,
      parent: d.parent ? byNode.get(d.parent.data.node) : undefined,
    }
    byNode.set(d.data.node, p)
    placed.push(p)
  })
  const xs = placed.map((p) => p.x)
  const minX = Math.min(...xs) - NODE_W / 2 - 8
  const maxX = Math.max(...xs) + NODE_W / 2 + 8
  const maxY = Math.max(...placed.map((p) => p.y + p.h)) + 8
  return { placed, minX, width: maxX - minX, height: maxY + 8 }
}

/** The SVG with its computed colours written in, so it reads the same outside the page. */
function standaloneSvg(svg: SVGSVGElement) {
  const copy = svg.cloneNode(true) as SVGSVGElement
  const from = svg.querySelectorAll('*')
  const to = copy.querySelectorAll('*')
  const props = [
    'fill',
    'stroke',
    'stroke-width',
    'stroke-dasharray',
    'opacity',
    'font-family',
    'font-size',
    'font-weight',
  ]
  from.forEach((el, i) => {
    const style = getComputedStyle(el)
    ;(to[i] as Element).setAttribute('style', props.map((p) => `${p}:${style.getPropertyValue(p)}`).join(';'))
    ;(to[i] as Element).removeAttribute('class')
  })
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return `<?xml version="1.0" encoding="UTF-8"?>\n${copy.outerHTML}`
}

function TreeSvg({
  t,
  highlight,
  selected,
  onSelect,
  svgRef,
  laid,
  fitWidth,
}: {
  t: DecisionTree
  highlight: boolean
  selected: string | null
  onSelect: (n: TreeNode) => void
  svgRef: React.RefObject<SVGSVGElement>
  laid: ReturnType<typeof layout>
  /** Draw the whole tree at this width when it is wider. */
  fitWidth: number | null
}) {
  const { placed, minX, width, height } = laid
  const scale = fitWidth && width > fitWidth ? fitWidth / width : 1
  const on = (id: string) => highlight && t.lit.has(id)
  const dim = (id: string) => highlight && !t.lit.has(id)
  return (
    <svg
      ref={svgRef}
      viewBox={`${minX} 0 ${width} ${height}`}
      width={width * scale}
      height={height * scale}
      role="img"
      aria-label="Decision flowchart"
      className="block max-w-none font-sans"
    >
      <defs>
        <marker
          id="flow-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
        </marker>
        <marker
          id="flow-arrow-on"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="fill-primary" />
        </marker>
      </defs>
      {placed
        .filter((p) => p.parent)
        .map((p) => {
          const a = p.parent!
          const x1 = a.x
          const y1 = a.y + a.h
          const x2 = p.x
          const y2 = p.y
          const mid = (y1 + y2) / 2
          const lit = highlight && !!p.via?.parentLit && p.via.taken === true
          const unanswered = highlight && !!p.via?.parentLit && p.via.taken === null
          return (
            <g key={`e-${p.node.id}`}>
              <path
                d={`M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2 - 2}`}
                className={cn(
                  'fill-none',
                  lit ? 'stroke-primary' : 'stroke-border',
                  dim(p.node.id) && !lit && 'opacity-50',
                )}
                strokeWidth={lit ? 2.6 : 1.4}
                strokeDasharray={unanswered ? '4 3' : undefined}
                markerEnd={`url(#${lit ? 'flow-arrow-on' : 'flow-arrow'})`}
              />
              {p.via?.label && (
                <text
                  x={x2}
                  y={y2 - 8}
                  textAnchor="middle"
                  className={cn('text-[10.5px] font-semibold', lit ? 'fill-primary' : 'fill-muted-foreground')}
                >
                  {p.via.label.length > 34 ? p.via.label.slice(0, 33) + '…' : p.via.label}
                </text>
              )}
            </g>
          )
        })}
      {placed.map((p) => {
        const n = p.node
        if (n.kind === 'fork')
          return <circle key={n.id} cx={p.x} cy={p.y + 5} r={4} className={on(n.id) ? 'fill-primary' : 'fill-border'} />
        const x = p.x - NODE_W / 2
        const isRule = n.kind === 'rule'
        const reached = isRule && t.lit.has(n.id)
        return (
          <g
            key={n.id}
            role="button"
            tabIndex={0}
            aria-label={`${isRule ? 'Rule' : 'Question'}: ${textOf(n)}`}
            className={cn('cursor-pointer outline-none', dim(n.id) && 'opacity-45')}
            onClick={() => onSelect(n)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(n)
              }
            }}
          >
            <rect
              x={x}
              y={p.y}
              width={NODE_W}
              height={p.h}
              rx={isRule ? 6 : p.h / 2 > 22 ? 18 : p.h / 2}
              className={cn(
                isRule
                  ? highlight && reached
                    ? 'fill-warning-surface stroke-warning-border'
                    : 'fill-card stroke-border'
                  : 'fill-muted stroke-border',
                on(n.id) && !isRule && 'stroke-primary',
                selected === n.id && 'stroke-foreground',
              )}
              strokeWidth={selected === n.id ? 2.4 : on(n.id) ? 2.2 : 1.2}
            />
            {p.lines.map((line, i) => (
              <text
                key={i}
                x={p.x}
                y={p.y + PAD + 11 + i * LINE_H}
                textAnchor="middle"
                className="fill-foreground text-[11.5px]"
              >
                {line}
              </text>
            ))}
            {isRule && (
              <text
                x={p.x}
                y={p.y + PAD + 11 + p.lines.length * LINE_H}
                textAnchor="middle"
                className="fill-primary font-mono text-[10.5px] font-semibold"
              >
                {n.rule.provision.length > 34 ? n.rule.provision.slice(0, 33) + '…' : n.rule.provision}
              </text>
            )}
            {n.kind === 'question' && n.measured && (
              <text x={x + NODE_W - 8} y={p.y + 11} textAnchor="end" className="fill-muted-foreground text-[9px]">
                measured
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function Detail({
  pack,
  node,
  quotes,
  answers,
}: {
  pack: Pack
  node: TreeNode | null
  quotes: RuleQuotesFile | null
  answers: Record<string, Scalar | null>
}) {
  if (!node || node.kind === 'fork')
    return (
      <p className="text-xs text-muted-foreground">
        Select a question to see who asks it, or a rule to read its finding and the provision it rests on.
      </p>
    )
  if (node.kind === 'question') {
    const askedBy = pack.rules.filter((r) =>
      [...(r.scope ?? []), ...r.when].flat().some((p) => p.fact === node.fact.id),
    )
    const value = answers[node.fact.id]
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium">{node.fact.label}</p>
        <p className="text-xs">
          <span className="text-muted-foreground">Answer: </span>
          {value === null || value === undefined
            ? 'Not answered'
            : typeof value === 'boolean'
              ? value
                ? 'Yes'
                : 'No'
              : String(value)}
          {node.measured && <span className="text-muted-foreground"> · measured by the planner</span>}
        </p>
        <p className="text-xs text-muted-foreground">Asked by {askedBy.map((r) => r.title).join(', ')}.</p>
      </div>
    )
  }
  const rule = node.rule
  const source = pack.sources.find((s) => s.id === rule.source)!
  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <p className="font-medium">{rule.title}</p>
        <p className="text-xs">{rule.finding}</p>
        {rule.actions.map((a, i) => (
          <p key={i} className="text-xs">
            <span className="font-medium">{ACTION_KIND[a.kind]}:</span> {a.description}
          </p>
        ))}
      </div>
      {rule.exceptions?.length ? (
        <div className="space-y-1 text-xs" data-testid="rule-exceptions">
          <p className="font-medium">Exceptions the law makes</p>
          <ul className="space-y-1">
            {rule.exceptions.map((x) => {
              const from = pack.sources.find((s) => s.id === x.source)!
              return (
                <li key={x.id}>
                  {x.label}{' '}
                  <span className="text-muted-foreground">
                    · {x.kind === 'decision' ? `decided by ${x.decidedBy}` : 'holds by law'} ·{' '}
                  </span>
                  <ProvisionLink
                    citation={{
                      sourceUrl: from.url,
                      sourceTitle: from.title,
                      provision: x.provision,
                      rule: { pack: pack.id, id: exceptionKey(rule.id, x.id) },
                    }}
                  />
                </li>
              )
            })}
          </ul>
          <p className="text-muted-foreground">
            A reviewer claims one on the finding, with a rationale and evidence; the finding stays raised.
          </p>
        </div>
      ) : null}
      <ProvisionText
        citation={{
          sourceUrl: source.url,
          sourceTitle: source.title,
          provision: rule.provision,
          quotes: quotesFor(quotes, pack.id, rule.id).map((q) => q.quote),
        }}
      />
    </div>
  )
}

/**
 * The instrument's rules as one decision flowchart in a dialog, a topic at a time, with the route
 * the case's answers take highlighted, and each rule opening the provision it rests on beside it.
 */
export function DecisionFlowchart({
  pack,
  answers,
  topics,
  initialTopic,
  triggerLabel = 'Flowchart',
}: {
  pack: Pack
  answers: Record<string, Scalar | null>
  topics: FlowchartTopic[]
  initialTopic?: string
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState(initialTopic ?? topics[0]?.id ?? '')
  const [highlight, setHighlight] = useState(true)
  const [selected, setSelected] = useState<TreeNode | null>(null)
  const [quotes, setQuotes] = useState<RuleQuotesFile | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const { width: boxWidth } = useElementSize(boxRef, { box: 'content' })
  // Unset: fit a tree up to twice the box's width, and open a wider one at full size on its root.
  const [fitChoice, setFit] = useState<boolean | null>(null)
  useEffect(() => {
    if (open)
      void loadRuleQuotes()
        .then(setQuotes)
        .catch(() => undefined)
  }, [open])
  const rules = topics.find((t) => t.id === topic)?.rules
  const t = useMemo(() => (open ? decisionTree(pack, answers, rules) : null), [open, pack, answers, rules])
  const label = topics.find((x) => x.id === topic)?.label ?? pack.title
  const laid = useMemo(() => (t ? layout(t) : null), [t])
  const fit = fitChoice ?? (!!laid && boxWidth > 0 && laid.width <= boxWidth * 2)
  // At full size a wide tree opens on its first question, which sits in the middle of the drawing.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || !laid || fit || boxWidth <= 0) return
    box.scrollLeft = Math.max(0, -laid.minX - box.clientWidth / 2)
  }, [laid, fit, boxWidth])
  return (
    <DialogShell
      open={open}
      onOpenChange={setOpen}
      title={`${pack.title} ${pack.version}`}
      eyebrow="Decision flowchart"
      size="xl"
      expandable
      closeLabel="Close flowchart"
      trigger={
        <Button size="sm" variant="outline">
          {triggerLabel}
        </Button>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          {topics.length > 1 && (
            <div role="group" aria-label="Topic" className="flex flex-wrap gap-1">
              {topics.map((x) => (
                <Button
                  key={x.id}
                  size="sm"
                  variant={x.id === topic ? 'default' : 'outline'}
                  aria-pressed={x.id === topic}
                  onClick={() => {
                    setTopic(x.id)
                    setSelected(null)
                  }}
                >
                  {x.label}
                </Button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
            Highlight this case’s route
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} />
            Fit to width
          </label>
          {t && (
            <>
              <CopyButton className={buttonVariants({ size: 'sm', variant: 'outline' })} text={() => treeToMermaid(t)}>
                Copy Mermaid
              </CopyButton>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  svgRef.current &&
                  downloadText(standaloneSvg(svgRef.current), `${pack.id}-${topic}-flowchart.svg`, 'image/svg+xml')
                }
              >
                SVG
              </Button>
            </>
          )}
        </div>
      }
    >
      {t && (
        <div className="grid gap-3 workspace-sm:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)]">
          <div className="min-w-0 space-y-2">
            <p className="text-xs text-muted-foreground">
              {label}. Each question leads to the answers the rules test; a rule at the end of a route is what those
              answers raise for review.{' '}
              {highlight &&
                (t.reached.length
                  ? `This case reaches ${t.reached.length} rule${t.reached.length === 1 ? '' : 's'}.`
                  : t.waiting.length
                    ? `The route stops at ${t.waiting.length} unanswered question${t.waiting.length === 1 ? '' : 's'} (dashed).`
                    : 'This case reaches no rule here.')}
            </p>
            <div
              ref={boxRef}
              className="overflow-auto rounded border border-border bg-background p-2"
              data-testid="decision-flowchart"
            >
              <TreeSvg
                laid={laid!}
                fitWidth={fit && boxWidth > 0 ? boxWidth : null}
                t={t}
                highlight={highlight}
                selected={selected?.id ?? null}
                onSelect={setSelected}
                svgRef={svgRef}
              />
            </div>
            <div className="flex flex-wrap gap-2 text-2xs text-muted-foreground">
              <Badge size="sm" tone="warning">
                Raised for review
              </Badge>
              <span>Bold line: the answers given take this branch. Dashed: not answered yet.</span>
            </div>
          </div>
          <aside className="min-w-0 rounded border border-border bg-card p-3" aria-label="Selected step">
            <Detail pack={pack} node={selected} quotes={quotes} answers={answers} />
          </aside>
        </div>
      )}
    </DialogShell>
  )
}
