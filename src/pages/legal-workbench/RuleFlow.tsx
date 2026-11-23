import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { downloadText } from '@/lib/download'
import { drawFlow, makeFlow, toMermaid, type RuleFinding } from '../../../packages/legal-rules/engine/flow'
import type { FactSet, Pack } from '../../../packages/legal-rules/src/contract'

export default function RuleFlow({
  pack,
  rule,
  finding,
  facts,
  date,
}: {
  pack: Pack
  rule: Pack['rules'][number]
  finding: RuleFinding
  facts: FactSet
  date: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState('when')
  const nodes = useMemo(
    () => (open ? makeFlow(pack, rule, finding, facts, date) : []),
    [open, pack, rule, finding, facts, date],
  )
  useEffect(() => {
    if (open && host.current) drawFlow(host.current, nodes, (n) => setSelected(n.id))
  }, [nodes, open])
  const detail = nodes.find((n) => n.id === selected)
  return (
    <div className="my-2">
      <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide rule flowchart' : 'Show rule flowchart'}
      </Button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="overflow-x-auto">
            <div ref={host} className="min-w-[515px] max-w-4xl text-slate-900 [&_svg]:w-full [&_g]:cursor-pointer" />
          </div>
          {detail && (
            <section aria-live="polite" className="rounded border p-3 text-sm">
              <strong>
                {detail.title} · {detail.active ? 'Active route' : 'Alternative'}
              </strong>
              <p>{detail.detail}</p>
              {detail.lines.map((line, i) => (
                <p key={i} className="mt-1">
                  Alternative {line.group} · {line.label} · {line.actual} · test {line.comparison} · {line.truth}
                  {line.difference === null ? '' : ' · measured minus threshold ' + line.difference}
                  <br />
                  {line.evidence}
                </p>
              ))}
            </section>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadText(toMermaid(nodes), rule.id + '.mmd', 'text/plain')}
          >
            Export Mermaid flowchart
          </Button>
        </div>
      )}
    </div>
  )
}
