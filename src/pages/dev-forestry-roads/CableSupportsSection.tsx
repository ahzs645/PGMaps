import { useState } from 'react'
import { CheckCircle2, CircleDashed, OctagonAlert, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { CableLayoutEditButtons, CableLayoutEditor, LocateRow, SpanColumns } from './CableLayoutEditor'
import { RoadSection } from './SidebarParts'
import { riggingErrors } from './cableMechanics'
import { intermediateSupports, layoutReasonText, type CableLayoutResult } from './cableLayout/cableLayout'
import { cableLayoutCsv } from './cableLayout/exports'
import { useClearStaleSpanFocus } from './cableLayout/editStore'
import { layoutLimitRows, type LayoutLimitState } from './cableLayout/limits'
import {
  DEFAULT_SUPPORT_LAYOUT,
  SUPPORT_LAYOUT_LABELS,
  SUPPORT_LAYOUT_LIMITS,
  layoutRun,
  lineFrame,
  savedLayoutToAnalyse,
  supportLayoutErrors,
  type CableSupportLayout,
} from './cableLayout/settings'
import {
  cancelLayout,
  layoutKey,
  startLayoutCheck,
  startLayoutSearch,
  useCableLayoutEntry,
} from './cableLayout/useCableLayout'
import type { CableLine, TerrainSource } from './types'

type NumericKey = keyof typeof SUPPORT_LAYOUT_LIMITS
const SEARCH: NumericKey[] = [
  'minSupportHeightM',
  'maxSupportHeightM',
  'heightStepM',
  'builtSupportAboveM',
  'candidateSpacingM',
  'minSupportSpacingM',
  'lowestPreTensionKN',
  'anchorDistanceM',
]
const ZONES: NumericKey[] = ['clearanceFromStartM', 'clearanceBeforeEndM']
const GRAVITY: NumericKey[] = ['trafficableFromStartM', 'trafficableBeforeEndM', 'minGravityGradePercent']
const ANGLES: NumericKey[] = ['liftOffDeg', 'holdDownDeg', 'maxLoadedDeg', 'maxLoadedEndDeg']

const n0 = (v: number | null) => (v === null ? '–' : Math.round(v).toLocaleString('en-CA'))
const n1 = (v: number | null) => (v === null ? '–' : v.toFixed(1))

function LimitIcon({ state }: { state: LayoutLimitState }) {
  if (state === 'met') return <CheckCircle2 className="size-3.5 text-emerald-600" role="img" aria-label="Met" />
  if (state === 'not-assessed')
    return <CircleDashed className="size-3.5 text-muted-foreground" role="img" aria-label="Not assessed" />
  return <OctagonAlert className="size-3.5 text-red-600 dark:text-red-400" role="img" aria-label="Not met" />
}

const KIND_TEXT = { yarder: 'Yarder', support: 'Support', 'ground-anchor': 'Ground anchor', anchor: 'Anchor' }
const STATUS_TEXT = { complete: 'Layout found', incomplete: 'Line stops short', 'no-layout': 'No layout' }

function summaryOf(result: CableLayoutResult | undefined, settings: CableSupportLayout) {
  if (settings.edited)
    return `edited · ${settings.edited.supports.length} support${settings.edited.supports.length === 1 ? '' : 's'}`
  if (!result) return settings.saved ? `saved · ${settings.saved.supports.length - 2} supports` : 'not run'
  if (result.status === 'no-layout') return 'no layout'
  const supports = intermediateSupports(result).length
  return `${supports} support${supports === 1 ? '' : 's'} · ${n0(result.preTensionKN)} kN · min ${n1(result.minClearanceM)} m`
}

/**
 * Intermediate supports for one D-line: the search settings, fixed supports and no-support
 * sectors, Find supports / Cancel, and the layout found with its limits and support table. The
 * profile chart draws the same result (`useCableLayoutOverlay`).
 */
export function CableSupportsSection({
  line,
  terrain,
  onEdit,
}: {
  line: CableLine
  terrain: TerrainSource
  /** Applies a change to this D-line as it is when the change lands. */
  onEdit: (change: (line: CableLine) => CableLine) => void
}) {
  const settings = line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT
  const key = layoutKey(line, terrain)
  const entry = useCableLayoutEntry(line.id)
  const current = entry?.key === key ? entry : undefined
  const result = current?.status === 'done' ? current.result : undefined
  useClearStaleSpanFocus(line.id, result?.spans)
  const running = entry?.status === 'running'
  const frame = lineFrame(line)
  const lengthM = frame?.lengthM ?? 0
  const inputErrors = [...riggingErrors(line.rigging!), ...supportLayoutErrors(settings)]
  const set = (patch: Partial<CableSupportLayout>) =>
    onEdit((l) => ({ ...l, supportLayout: { ...(l.supportLayout ?? DEFAULT_SUPPORT_LAYOUT), ...patch } }))

  const [refused, setRefused] = useState<{ key: string; message: string } | null>(null)
  const find = () => {
    const prepared = layoutRun(line, terrain, settings)
    if (!prepared.ok) return setRefused({ key, message: prepared.error })
    setRefused(null)
    startLayoutSearch(line.id, key, prepared.run, (found) => {
      if (found.status === 'no-layout' || found.preTensionKN === null) return
      const supports = found.supports
        .filter((s) => s.kind !== 'anchor')
        .map((s) => ({ stationM: s.stationM, heightM: s.heightM }))
      // Save only onto the line the search was run for.
      onEdit((l) =>
        layoutKey(l, terrain) === key
          ? {
              ...l,
              supportLayout: {
                ...(l.supportLayout ?? DEFAULT_SUPPORT_LAYOUT),
                saved: { preTensionKN: found.preTensionKN!, complete: found.status === 'complete', supports },
              },
            }
          : l,
      )
    })
  }
  const prepared = !running && !result && settings.saved ? layoutRun(line, terrain, settings) : null
  const savedLayout = prepared?.ok ? savedLayoutToAnalyse(prepared.run, settings.saved) : null
  const check = () => prepared?.ok && savedLayout && startLayoutCheck(line.id, key, prepared.run, savedLayout)
  const runError =
    (entry?.key === key && entry.status === 'error' ? entry.error : undefined) ??
    (refused?.key === key ? refused.message : undefined)
  const prepError = inputErrors[0] ?? null

  const field = (k: NumericKey) => (
    <NumberField
      key={k}
      label={SUPPORT_LAYOUT_LABELS[k]}
      value={settings[k]}
      min={SUPPORT_LAYOUT_LIMITS[k][0]}
      max={SUPPORT_LAYOUT_LIMITS[k][1]}
      step={k === 'heightStepM' ? 0.5 : 1}
      onChange={(value) => set({ [k]: value })}
    />
  )
  const download = () => {
    if (!result || inputErrors.length) return
    downloadText(cableLayoutCsv(line.name, result), 'd-line-supports.csv', 'text/csv;charset=utf-8')
  }
  const supportsShown = result?.supports ?? []

  return (
    <RoadSection
      title="Intermediate supports"
      summary={summaryOf(result, settings)}
      data-testid="cable-supports"
      help={
        <>
          Finds where to put intermediate supports and how tall, with one skyline pre-tension for the whole rope, so the
          loaded carriage keeps the rigging&apos;s minimum clearance, the skyline stays within its allowable tension and
          the saddle angles stay within their limits. Fewest supports first, then the lowest. Stations run from the
          yarder. Static only: no dynamic loads, anchors or trees are sized, and WorkSafeBC rigging rules are not
          checked.
        </>
      }
    >
      {/* Start and End side by side; System, the third, on its own row so no label breaks at 257 px. */}
      <div className="grid grid-cols-2 gap-1 [&>*:nth-child(3)]:col-span-2">
        <Field label="Start">
          <RoadSelect
            ariaLabel="Start element"
            className={roadFieldClass}
            value={settings.startKind}
            onValueChange={(v) => set({ startKind: v as CableSupportLayout['startKind'] })}
          >
            <option value="yarder">Yarder tower</option>
            <option value="support">Support + anchor</option>
            <option value="anchor">Ground anchor</option>
          </RoadSelect>
        </Field>
        <Field label="End">
          <RoadSelect
            ariaLabel="End element"
            className={roadFieldClass}
            value={settings.endKind}
            onValueChange={(v) => set({ endKind: v as CableSupportLayout['endKind'] })}
          >
            <option value="support">Support + anchor</option>
            <option value="anchor">Ground anchor</option>
          </RoadSelect>
        </Field>
        <Field
          label="System"
          hint="Two-cable: the carriage runs out by gravity, so the loaded path must fall away from the yarder on every span. Multi-cable: a haulback pulls it out; no gravity check."
        >
          <RoadSelect
            ariaLabel="Cable system"
            className={roadFieldClass}
            value={settings.cableSystem}
            onValueChange={(v) => set({ cableSystem: v as CableSupportLayout['cableSystem'] })}
          >
            <option value="multi-cable">Multi-cable</option>
            <option value="two-cable">Two-cable (gravity)</option>
          </RoadSelect>
        </Field>
      </div>
      <details className="rounded border p-2">
        <summary className="cursor-pointer text-xs">
          Search · {settings.minSupportHeightM}–{settings.maxSupportHeightM} m every {settings.candidateSpacingM} m
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-1">{SEARCH.map(field)}</div>
      </details>
      <details className="rounded border p-2">
        <summary className="cursor-pointer text-xs">
          Limits · clearance zones {settings.clearanceFromStartM}/{settings.clearanceBeforeEndM} m · loaded{' '}
          {settings.maxLoadedDeg}°/{settings.maxLoadedEndDeg}°
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-1">
          {ZONES.map(field)}
          {ANGLES.map(field)}
          {settings.cableSystem === 'two-cable' && GRAVITY.map(field)}
        </div>
      </details>
      <div className="space-y-1" data-testid="cable-fixed-supports">
        <div className="flex items-center justify-between text-xs">
          <span>Fixed supports · {settings.fixedSupports.length}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={lengthM <= 0}
            onClick={() => set({ fixedSupports: [...settings.fixedSupports, { stationM: Math.round(lengthM / 2) }] })}
          >
            <Plus className="size-3" /> Add
          </Button>
        </div>
        {settings.fixedSupports.map((f, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-1">
            <NumberField
              label="Station (m)"
              value={f.stationM}
              min={1}
              max={Math.max(1, Math.floor(lengthM) - 1)}
              step={1}
              onChange={(stationM) =>
                set({ fixedSupports: settings.fixedSupports.map((x, j) => (j === i ? { ...x, stationM } : x)) })
              }
            />
            <OptionalNumberField
              label="Height (m)"
              value={f.heightM ?? null}
              min={1}
              max={50}
              step={1}
              placeholder="search"
              onChange={(heightM) =>
                set({
                  fixedSupports: settings.fixedSupports.map((x, j) =>
                    j === i ? { stationM: x.stationM, ...(heightM === null ? {} : { heightM }) } : x,
                  ),
                })
              }
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={`Remove fixed support at ${f.stationM} m`}
              onClick={() => set({ fixedSupports: settings.fixedSupports.filter((_, j) => j !== i) })}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}
      </div>
      <div className="space-y-1" data-testid="cable-no-support-sectors">
        <div className="flex items-center justify-between text-xs">
          <span>No-support sectors · {settings.noSupportSectors.length}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={lengthM <= 0}
            onClick={() => {
              const mid = Math.round(lengthM / 2)
              set({
                noSupportSectors: [
                  ...settings.noSupportSectors,
                  { fromM: Math.max(0, mid - 20), toM: Math.min(Math.floor(lengthM), mid + 20) },
                ],
              })
            }}
          >
            <Plus className="size-3" /> Add
          </Button>
        </div>
        {settings.noSupportSectors.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-1">
            {(['fromM', 'toM'] as const).map((k) => (
              <NumberField
                key={k}
                label={k === 'fromM' ? 'From (m)' : 'To (m)'}
                value={r[k]}
                min={0}
                max={Math.max(1, Math.floor(lengthM))}
                step={1}
                onChange={(value) =>
                  set({
                    noSupportSectors: settings.noSupportSectors.map((x, j) => (j === i ? { ...x, [k]: value } : x)),
                  })
                }
              />
            ))}
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={`Remove no-support sector ${r.fromM}–${r.toM} m`}
              onClick={() => set({ noSupportSectors: settings.noSupportSectors.filter((_, j) => j !== i) })}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}
      </div>
      {prepError && <InlineAlert tone="error">{prepError}</InlineAlert>}
      <div className="flex flex-wrap items-center gap-1">
        {running ? (
          <>
            <Button size="sm" variant="outline" onClick={() => cancelLayout(line.id)}>
              Cancel
            </Button>
            <span role="status" className="text-2xs text-muted-foreground">
              {entry?.kind === 'check'
                ? 'Checking the saved layout…'
                : `Checking spans… ${Math.round((entry?.progress ?? 0) * 100)}% of ${n0(entry?.spans ?? 0)}`}
            </span>
          </>
        ) : (
          <Button size="sm" disabled={Boolean(prepError)} onClick={find}>
            Find supports
          </Button>
        )}
        {savedLayout && (
          <Button size="sm" variant="outline" onClick={check}>
            Check saved layout
          </Button>
        )}
        {result && !settings.edited && (
          <Button size="sm" variant="outline" disabled={inputErrors.length > 0} onClick={download}>
            Supports CSV
          </Button>
        )}
        {!running && <CableLayoutEditButtons line={line} terrain={terrain} onEdit={onEdit} />}
      </div>
      {!prepError && runError && <InlineAlert tone="error">{runError}</InlineAlert>}
      {!result && entry && entry.key !== key && entry.status === 'done' && (
        <p role="status" className="text-2xs text-amber-700 dark:text-amber-400">
          The D-line, rigging, terrain or settings changed. Find supports again, or check the saved layout.
        </p>
      )}
      {settings.edited && <CableLayoutEditor line={line} terrain={terrain} onEdit={onEdit} found={result} />}
      {result && !settings.edited && (
        <div className="space-y-2" data-testid="cable-supports-result">
          <p role="status" className="text-xs">
            <span className="font-medium">{STATUS_TEXT[result.status]}</span>
            {result.preTensionKN !== null &&
              ` · pre-tension ${n0(result.preTensionKN)} kN at the yarder-side support${
                result.tieCount > 1 ? ` (same layout ${n0(result.tieLowKN)}–${n0(result.tieHighKN)} kN)` : ''
              }`}
            {result.ropeLengthM !== null && ` · rope ${n0(result.ropeLengthM)} m between end supports`}
          </p>
          {result.reason !== 'none' && <InlineAlert tone="warning">{layoutReasonText(result)}</InlineAlert>}
          <EngineeringTable rowHeaders compact data-testid="cable-supports-limits">
            <thead>
              <tr>
                <ColumnHeader label="Check" className="text-left" />
                <ColumnHeader label="Limit" />
                <ColumnHeader label="Layout" />
              </tr>
            </thead>
            <tbody>
              {layoutLimitRows(result, settings, line.rigging!.minClearanceM).map((row) => (
                <tr key={row.id} data-state={row.state}>
                  <th scope="row">
                    <span className="mr-1 inline-block align-middle">
                      <LimitIcon state={row.state} />
                    </span>
                    <LocateRow line={line} rowId={row.id} result={result} settings={settings}>
                      {row.label}
                    </LocateRow>
                  </th>
                  <td className="whitespace-normal">{row.limit}</td>
                  <td className="whitespace-normal">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </EngineeringTable>
          <div className="max-h-56 overflow-auto rounded border">
            <EngineeringTable data-testid="cable-supports-table">
              <thead className="sticky top-0">
                <tr>
                  <ColumnHeader label="" className="text-left" />
                  <ColumnHeader label="Station" unit="m" />
                  <ColumnHeader label="Height" unit="m" />
                  <ColumnHeader label="Break" unit="empty/loaded °" />
                  <ColumnHeader label="Force" unit="kN" />
                  <ColumnHeader label="Pull" unit="°" />
                </tr>
              </thead>
              <tbody>
                {supportsShown.map((s, i) => (
                  <tr key={i}>
                    <td className="text-left">
                      {KIND_TEXT[s.kind]}
                      {s.fixed ? ' (fixed)' : ''}
                    </td>
                    <td>{n0(s.stationM)}</td>
                    <td>{n1(s.heightM)}</td>
                    <td>{s.emptyBreakDeg === null ? '–' : `${n1(s.emptyBreakDeg)} / ${n1(s.loadedBreakDeg)}`}</td>
                    <td title={s.kind === 'anchor' || s.kind === 'ground-anchor' ? 'Rope tension' : 'Saddle force'}>
                      {n1(s.maxForceKN)}
                    </td>
                    <td>{n1(s.pullAngleDeg)}</td>
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
          </div>
          <div className="max-h-40 overflow-auto rounded border">
            <EngineeringTable compact data-testid="cable-spans-table">
              <SpanColumns />
              <tbody>
                {result.spans.map((s, i) => (
                  <tr key={i} aria-selected={!(s.clearanceOk && s.tensionOk && s.gravityOk)}>
                    <td className="text-left">
                      <LocateRow line={line} rowId={`span:${i}`} result={result} settings={settings}>
                        <span className="whitespace-nowrap">
                          {n0(s.fromM)}–{n0(s.toM)}
                        </span>
                      </LocateRow>
                    </td>
                    <td>{n1(s.loadedSagM)}</td>
                    <td>{s.unknownGroundAtM !== null ? 'unknown' : n1(s.minClearanceM)}</td>
                    <td>{n0(s.peakTensionKN)}</td>
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
          </div>
        </div>
      )}
    </RoadSection>
  )
}
