import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Field, roadFieldClass, RoadSelect } from './Controls'
import { ROADENG_UNITS } from './roadEngImport'
import { isPLineStratum, pLineApplyOf, pLineSummary, type PLineApply } from './roadEngPLine'
import type { RoadWorkspace } from './useRoadWorkspace'

const APPLY_OPTIONS = [
  { value: 'between', label: 'Nearest surveyed station (Between)' },
  { value: 'ahead', label: 'Ahead to the next station (Ahead)' },
] as const

const metres = (m: number | null) =>
  m === null ? '–' : `${m.toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`

/**
 * The active road's P-line (`roadEngPLine.ts`): the survey traverse its RoadEng design names, whose
 * ground layers give the horizons where the design's ground is `**`. Shows what was read, sets
 * Between or Ahead, and reads a `.tr1` the design was opened without. Each change is one undo step.
 */
export function RoadEngPLinePanel({ workspace: w }: { workspace: RoadWorkspace }) {
  const { alignment } = w
  const source = alignment.roadEngSource
  const pLine = source?.pLine
  const file = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null)
  if (!source || !pLine) return null
  const unitM = ROADENG_UNITS[source.unitCode] ?? 1
  const apply = pLineApplyOf(pLine, source.dsn)
  const horizons = (alignment.engineering?.strata ?? []).filter(isPLineStratum).length
  const summary = pLine.tr1 ? pLineSummary(pLine.tr1, unitM) : null

  const refresh = async (
    options: { apply?: PLineApply; tr1?: { name: string; text: string }; tr2?: { name: string; text: string } | null },
    label: string,
  ) => {
    try {
      const [{ refreshPLineStrata }, { parseNativeTraverse }] = await Promise.all([
        import('./roadEngPLineStrata'),
        import('./softreeNativeTraverse'),
      ])
      const result = refreshPLineStrata(alignment, { ...options, parse: parseNativeTraverse })
      w.updateAlignment((a) => (a.id === alignment.id ? result.alignment : a), label)
      setMessage({
        tone: result.notes.length ? 'warning' : 'info',
        text: [`${result.horizons} horizon${result.horizons === 1 ? '' : 's'} from the P-line.`, ...result.notes].join(
          ' ',
        ),
      })
    } catch (error) {
      setMessage({ tone: 'warning', text: error instanceof Error ? error.message : String(error) })
    }
  }

  const readFiles = async (files: File[]) => {
    const { isNativeTraverse, isNativeTraverseSettings } = await import('./softreeNativeTraverse')
    const read = await Promise.all(
      files.map(async (f) => ({
        name: f.name,
        // RoadEng writes its traverse files in Latin-1; one byte, one character.
        text: Array.from(new Uint8Array(await f.arrayBuffer()), (b) => String.fromCharCode(b)).join(''),
      })),
    )
    const tr1 = read.find((f) => isNativeTraverse(f.text))
    if (!tr1) {
      setMessage({ tone: 'warning', text: `Choose ${pLine.name}: none of the files is a RoadEng traverse (.tr1).` })
      return
    }
    const stem = (n: string) => n.replace(/\.[^.]*$/, '').toLowerCase()
    const tr2 = read.find((f) => f !== tr1 && isNativeTraverseSettings(f.text) && stem(f.name) === stem(tr1.name))
    await refresh({ tr1, tr2: tr2 ?? null }, `Read P-line ${pLine.name}`)
  }

  return (
    <div className={cn(insetBox(), 'mt-2 space-y-2')} data-testid="roadeng-pline">
      <div className="flex items-center gap-1 text-xs font-medium">
        P-line {pLine.name}
        <InfoTip label="About the P-line">
          The RoadEng design names this survey traverse as its P-line. Where a station range gives its ground as the
          default ground type (**), RoadEng takes the ground layers surveyed along the P-line, and so does this road: a
          station with no ground type of its own carries the one before it, and the first is OB. A range that names its
          own layers keeps them. Between applies each surveyed station to the cross sections nearest it; Ahead applies
          it from that station up to the next. The traverse goes back beside the design, as read, in a RoadEng project
          export.
        </InfoTip>
      </div>
      {summary ? (
        <>
          <p className="text-2xs text-muted-foreground" data-testid="roadeng-pline-summary">
            {summary.stations} surveyed station{summary.stations === 1 ? '' : 's'}, {metres(summary.firstM)} to{' '}
            {metres(summary.lastM)}
            {summary.fileUnitM === 0.3048 ? ', surveyed in feet' : ''}. Ground layers:{' '}
            {summary.layers
              .map((l) =>
                l.text
                  ? `${l.text} at ${l.count}`
                  : `none given at ${l.count} (each takes the station before's, OB at the first)`,
              )
              .slice(0, 4)
              .join('; ')}
            {summary.layers.length > 4 ? `; ${summary.layers.length - 4} more` : ''}.
          </p>
          <Field label="Survey applies to">
            <RoadSelect
              ariaLabel="P-line survey applies to"
              className={roadFieldClass}
              value={apply}
              options={APPLY_OPTIONS}
              onValueChange={(value) =>
                value !== apply &&
                void refresh(
                  { apply: value as PLineApply },
                  value === 'ahead' ? 'P-line survey ahead' : 'P-line survey between',
                )
              }
            />
          </Field>
          <p className="text-2xs text-muted-foreground" data-testid="roadeng-pline-horizons">
            {horizons} horizon{horizons === 1 ? '' : 's'} from the P-line under Station ranges &amp; ground horizons.
          </p>
        </>
      ) : (
        <InlineAlert tone="warning">
          {pLine.name} was not opened with the design, so ground the design gives as ** is left unclassified.
        </InlineAlert>
      )}
      <input
        ref={file}
        type="file"
        multiple
        accept=".tr1,.tr2"
        className="hidden"
        aria-label="P-line traverse file"
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])]
          e.target.value = ''
          if (picked.length) void readFiles(picked)
        }}
      />
      <Button size="sm" variant="outline" className="w-full" onClick={() => file.current?.click()}>
        {summary ? `Read ${pLine.name} again` : `Read ${pLine.name}`}
      </Button>
      {message && (
        <InlineAlert tone={message.tone}>
          <span data-testid="roadeng-pline-message">{message.text}</span>
        </InlineAlert>
      )}
    </div>
  )
}
