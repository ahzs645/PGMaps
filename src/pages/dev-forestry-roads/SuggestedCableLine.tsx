import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { CableChart } from './Charts'
import type { CableLineRecord } from './cableCoverage'
import type { CableCoverageRule } from './cableCoverageRule'
import { layoutReasonText, type LayoutToAnalyse } from './cableLayout/cableLayout'
import { layoutRun, savedLayoutToAnalyse, type LayoutRun } from './cableLayout/settings'
import {
  cancelLayout,
  layoutEntryFor,
  layoutKey,
  startLayoutCheck,
  useCableLayoutEntry,
  useCableLayoutOverlay,
} from './cableLayout/useCableLayout'
import { cableLineFromCoverage } from './dline/coverageAdopt'
import { analyzeCable } from './engine'
import type { CableLine, Coordinate, TerrainSource } from './types'

/**
 * One suggested skyline opened as a profile: its supports checked as a multi-span layout in the
 * cable-layout worker, drawn on the D-line chart, and **Use as D-line** to keep it.
 */
export function SuggestedCableLine({
  record,
  rule,
  toLonLat,
  source,
  name,
  onAdopt,
}: {
  record: CableLineRecord
  rule: CableCoverageRule
  toLonLat: (xy: [number, number]) => Coordinate
  source: TerrainSource
  /** The D-line's name when it is kept. */
  name: string
  onAdopt: (line: CableLine) => void
}) {
  const line = useMemo(() => {
    try {
      return cableLineFromCoverage(record, rule, toLonLat, `suggested-${record.id}`, name)
    } catch {
      return null
    }
  }, [record, rule, toLonLat, name])
  const analysis = useMemo(() => {
    try {
      return line ? analyzeCable(line, source) : null
    } catch {
      return null
    }
  }, [line, source])
  const key = line ? layoutKey(line, source) : ''
  const entry = useCableLayoutEntry(line?.id)
  const overlay = useCableLayoutOverlay(line ?? undefined, source)
  const [cursor, setCursor] = useState<number | null>(null)
  const prepared = useMemo((): { error: string } | { run: LayoutRun; saved: LayoutToAnalyse } => {
    if (!line?.supportLayout) return { error: 'This suggested line has no supports to check.' }
    const run = layoutRun(line, source, line.supportLayout)
    if (!run.ok) return { error: run.error }
    const saved = savedLayoutToAnalyse(run.run, line.supportLayout.saved)
    return saved ? { run: run.run, saved } : { error: 'The suggested supports do not fit the line.' }
  }, [line, source])
  useEffect(() => {
    if (!line || !('run' in prepared)) return
    const existing = layoutEntryFor(line.id, layoutKey(line, source))
    if (existing && existing.status !== 'error') return
    startLayoutCheck(line.id, layoutKey(line, source), prepared.run, prepared.saved)
    return () => cancelLayout(line.id)
  }, [line, prepared, source])
  const refused = 'error' in prepared ? prepared.error : ''

  if (!line || !analysis)
    return <InlineAlert tone="error">This suggested line cannot be drawn as a D-line.</InlineAlert>
  const current = entry?.key === key ? entry : undefined
  const result = current?.status === 'done' ? current.result : undefined
  const supports = record.points.length - 2
  const shown = overlay?.loadPath.length ? overlay : undefined
  return (
    <div className="space-y-1.5 rounded border p-2" data-testid="suggested-cable-line">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="text-2xs font-medium">
          Line {record.id} · {Math.round(record.horizontalM)} m · {supports} support{supports === 1 ? '' : 's'} ·
          pre-tension {Math.round(record.preTensionKN)} kN
        </p>
        <Button size="sm" variant="outline" onClick={() => onAdopt({ ...line, id: crypto.randomUUID() })}>
          Use as D-line
        </Button>
      </div>
      {refused ? (
        <InlineAlert tone="warning">{refused}</InlineAlert>
      ) : current?.status === 'running' || !current ? (
        <p role="status" className="text-2xs text-muted-foreground">
          Checking the line&apos;s supports…
        </p>
      ) : current.status === 'error' ? (
        <InlineAlert tone="error">{current.error}</InlineAlert>
      ) : (
        result && result.reason !== 'none' && <InlineAlert tone="warning">{layoutReasonText(result)}</InlineAlert>
      )}
      {shown && (
        <div className="h-56 min-w-0" data-testid="suggested-cable-profile">
          <CableChart
            analysis={analysis}
            layout={shown}
            distance={cursor ?? analysis.length / 2}
            onDistance={setCursor}
          />
        </div>
      )}
      <p className="text-3xs text-muted-foreground">
        The coverage screen&apos;s supports, checked as one static multi-span layout at its pre-tension. A D-line keeps
        them as its saved layout: refine them under Review → D-line → Intermediate supports.
      </p>
    </div>
  )
}
