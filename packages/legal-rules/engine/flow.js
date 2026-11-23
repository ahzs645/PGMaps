// The evaluator owns every decision. This adapter uses its trace to mark the route.
import { hierarchy, linkVertical } from 'd3'
import { operand } from '../src/contract'
export const statusText = {
  outside_source_window: 'Outside source window',
  outside_scope: 'Scope excludes this rule',
  missing_evidence: 'Evidence needed',
  condition_not_triggered: 'Condition not triggered',
  review_required: 'Review required',
}
const symbols = { eq: '=', ne: '≠', in: 'in', gt: '>', gte: '≥', lt: '<', lte: '≤' }
const show = (value) => (value == null ? 'Unknown' : Array.isArray(value) ? value.join(', ') : String(value))
export function traceLines(pack, rule, field, finding, facts) {
  const groups = rule[field] || []
  const evaluated = finding[field === 'scope' ? 'scope' : 'condition']?.trace
  return groups.flatMap((group, i) =>
    group.map((c, j) => {
      const def = pack.facts.find((d) => d.id === c.fact)
      const input = facts.facts.find((d) => d.id === c.fact)
      const step = evaluated?.[i]?.[j]
      const value = step ? step.actual : input?.value
      const expected = operand(pack, c)
      const unit = def.unit ? ' ' + def.unit : ''
      const difference = step && typeof value === 'number' && typeof expected === 'number' ? value - expected : null
      const comparison = symbols[c.op] + ' ' + show(expected) + unit
      return {
        group: i + 1,
        label: def.label,
        actual: show(value) + (value == null ? '' : unit),
        comparison,
        truth: !step ? 'Unreached' : step.result == null ? 'Unknown' : step.result ? 'True' : 'False',
        difference: difference == null ? null : (difference > 0 ? '+' : '') + Number(difference.toFixed(6)) + unit,
        evidence: input?.evidence || 'No evidence reference entered.',
      }
    }),
  )
}
export function makeFlow(pack, rule, finding, facts, date) {
  const inWindow = finding.status !== 'outside_source_window'
  const scope = finding.scope?.result
  const condition = finding.condition?.result
  const nodes = []
  const node = (id, parent, row, col, title, via, active, detail, lines = []) => {
    nodes.push({ id, parent, row, col, title, via, active, detail, lines })
  }
  node(
    'date',
    null,
    0,
    0,
    'Assessment date',
    '',
    true,
    date + ' · release covers ' + pack.coverage.from + ' through ' + pack.coverage.through,
  )
  node(
    'scope',
    'date',
    1,
    0,
    'Applicability',
    'In range',
    inWindow,
    'At least one alternative must hold. All checks within that alternative must hold.',
    traceLines(pack, rule, 'scope', finding, facts),
  )
  node(
    'outside',
    'date',
    1,
    1,
    'Outside source window',
    'Outside',
    !inWindow,
    'Select a release documenting this date.',
  )
  node(
    'when',
    'scope',
    2,
    0,
    'Rule condition',
    'True',
    inWindow && scope === true,
    'These checks determine whether the pack raises a review finding.',
    traceLines(pack, rule, 'when', finding, facts),
  )
  node(
    'excluded',
    'scope',
    2,
    1,
    'Outside scope',
    'False',
    inWindow && scope === false,
    'The entered facts exclude this rule for this case.',
  )
  node(
    'needScope',
    'scope',
    2,
    2,
    'Scope evidence needed',
    'Unknown',
    inWindow && scope === null,
    'Resolve unknown scope checks in the evidence fields.',
  )
  node(
    'review',
    'when',
    3,
    0,
    'Review required',
    'True',
    scope === true && condition === true,
    (condition === true ? '' : 'If the condition is triggered: ') +
      rule.finding +
      ' ' +
      rule.actions.map((a) => a.kind + ' — ' + a.description).join(' '),
  )
  node(
    'clear',
    'when',
    3,
    1,
    'Condition not triggered',
    'False',
    scope === true && condition === false,
    'The entered facts do not trigger this particular review condition.',
  )
  node(
    'needFacts',
    'when',
    3,
    2,
    'Condition evidence needed',
    'Unknown',
    scope === true && condition === null,
    'Enter the missing evidence or preserve the uncertainty in the assessment.',
  )
  const sample = nodes.find((n) => n.id === 'when')
  const groups = [...new Set(sample.lines.map((line) => line.group))].map((id) =>
    sample.lines.filter((line) => line.group === id),
  )
  const relevant =
    groups.find((group) => group.every((line) => line.truth === 'True')) ||
    groups.find((group) => group.every((line) => line.truth !== 'False')) ||
    groups.find((group) => group[0]?.truth === 'True') ||
    groups[0] ||
    []
  const decisive =
    relevant.find((line) => line.truth === 'Unknown') ||
    relevant.find((line) => line.difference !== null) ||
    relevant[0]
  sample.caption = decisive ? decisive.actual + ' · test ' + decisive.comparison : rule.title
  nodes[0].caption = date
  nodes[1].caption = finding.scope?.trace?.length ? 'Applicability checks · ' + nodes[1].lines.length : 'Scope gate'
  for (const n of nodes) n.provision = rule.provision
  return nodes
}
export function toMermaid(nodes) {
  // Encode punctuation in quoted labels. Pack strings never become Mermaid directives or markup.
  const safe = (s) =>
    Array.from(String(s), (ch) => (/[a-zA-Z0-9 .,+-]/.test(ch) ? ch : '#' + ch.codePointAt(0) + ';')).join('')
  const lines = ['flowchart TD']
  for (const n of nodes) {
    const heading = n.title + (n.id === 'when' ? ' · ' + n.provision : '') + (n.caption ? ' · ' + n.caption : '')
    lines.push('  ' + n.id + '["' + safe(heading) + '"]')
    if (n.parent) lines.push('  ' + n.parent + ' -->|' + n.via + '| ' + n.id)
    for (const [i, step] of n.lines.entries()) {
      const stepId = n.id + 'Check' + i
      const text =
        'Alternative ' +
        step.group +
        ' · ' +
        step.label +
        ' · ' +
        step.actual +
        ' · test ' +
        step.comparison +
        ' · ' +
        step.truth
      lines.push('  ' + n.id + ' -.-> ' + stepId + '["' + safe(text) + '"]')
    }
    if (n.id === 'review') lines.push('  review -.-> actions["' + safe(n.detail) + '"]')
  }
  lines.push('  classDef taken fill:#d8ecdb,stroke:#175047,stroke-width:3px,color:#10332c')
  lines.push(
    '  class ' +
      nodes
        .filter((n) => n.active)
        .map((n) => n.id)
        .join(',') +
      ' taken',
  )
  return lines.join('\n') + '\n'
}
const ns = 'http://www.w3.org/2000/svg'
// The host's own document, so the drawing works in any window and needs no global.
function svgEl(doc, tag, attrs = {}) {
  const e = doc.createElementNS(ns, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}
export function drawFlow(host, nodes, onSelect) {
  const svg = svgEl(host.ownerDocument, 'svg', {
    viewBox: '0 0 675 355',
    role: 'group',
    'aria-label': 'Rule flowchart. Active route is outlined and labelled.',
  })
  const root = hierarchy(nodes[0], (n) => nodes.filter((x) => x.parent === n.id))
  const x = (d) => 116 + d.col * 221,
    y = (d) => 31 + d.row * 96
  const curve = linkVertical()
    .x((d) => d[0])
    .y((d) => d[1])
  for (const { source, target } of root.links()) {
    const a = source.data,
      b = target.data
    const path = svgEl(host.ownerDocument, 'path', {
      d: curve({ source: [x(a), y(a) + 23], target: [x(b), y(b) - 23] }),
      fill: 'none',
      stroke: b.active ? '#176958' : '#b6c5c1',
      'stroke-width': b.active ? 3 : 1.3,
    })
    svg.append(path)
  }
  for (const n of nodes) {
    const g = svgEl(host.ownerDocument, 'g', {
      transform: 'translate(' + x(n) + ' ' + y(n) + ')',
      tabindex: 0,
      role: 'button',
      'aria-label': n.title + (n.active ? ' · active' : ' · alternative'),
      'data-node': n.id,
      class: 'chartnode',
    })
    g.append(
      svgEl(host.ownerDocument, 'rect', {
        x: -105,
        y: -23,
        width: 210,
        height: 46,
        rx: 7,
        fill: n.active ? '#dceddf' : '#f6f8f5',
        stroke: n.active ? '#24725f' : '#ccd5ce',
        'stroke-width': n.active ? 2.5 : 1,
      }),
    )
    const title = svgEl(host.ownerDocument, 'text', {
      y: -2,
      'text-anchor': 'middle',
      'font-size': 13,
      'font-weight': 650,
    })
    title.textContent = n.title
    g.append(title)
    const label = svgEl(host.ownerDocument, 'text', { y: 14, 'text-anchor': 'middle', 'font-size': 10 })
    const tag = n.active ? 'Active' : 'Alternative'
    const summary = n.caption && n.caption.length < 27 ? n.caption : n.via
    label.textContent = [summary, tag].filter(Boolean).join(' · ')
    g.append(label)
    g.onclick = () => onSelect(n)
    g.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(n)
      }
    }
    svg.append(g)
  }
  host.replaceChildren(svg)
}
