/**
 * Adjusting a D-line's support layout by hand, under Review → D-line → Intermediate supports: start
 * from the found layout or place supports by hand, edit each support's station, height, name and
 * category, add and delete supports, and set the pre-tension. Each change is re-checked about
 * 300 ms later (`cableLayout/editStore.ts`), and a table puts the found and current values side by
 * side. Picking a row marks where it applies on the D-line chart and moves the plan cursor there.
 *
 * The pure edits live in `cableLayout/layoutEdit.ts` and the comparison in `layoutCompare.ts`.
 */
import type { ReactNode } from 'react'
import { CheckCircle2, CircleDashed, Crosshair, OctagonAlert, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { NumberField, roadFieldClass, RoadSelect } from './Controls'
import type { CableLayoutResult, LayoutSupport } from './cableLayout/cableLayout'
import { drawnEditResult, focusLayoutRow, useEditCheck, useLayoutFocus } from './cableLayout/editStore'
import { cableLayoutCsv } from './cableLayout/exports'
import { compareLayouts, focusMarks } from './cableLayout/layoutCompare'
import {
  EDIT_END_HEIGHT_M,
  EDIT_PRE_TENSION_KN,
  EDIT_SUPPORT_HEIGHT_M,
  MAX_EDITED_SUPPORTS,
  MAX_SUPPORT_NAME_LENGTH,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  addSupportAfter,
  addSupportInLongestSpan,
  defaultPreTension,
  editCheckKey,
  editFromFound,
  editedLayoutErrors,
  emptyEdit,
  matchesFound,
  moveSupport,
  nameSupport,
  placementIssues,
  removeSupport,
  setEndHeight,
  stationBounds,
  type EditedLayout,
  type SupportCategory,
  type SupportIdentity,
} from './cableLayout/layoutEdit'
import type { LayoutLimitState } from './cableLayout/limits'
import {
  DEFAULT_SUPPORT_LAYOUT,
  chartDistance,
  layoutRun,
  lineFrame,
  savedLayoutToAnalyse,
  type CableSupportLayout,
} from './cableLayout/settings'
import { layoutKey } from './cableLayout/useCableLayout'
import { useEditedLayoutCheck, withEdited } from './cableLayout/useLayoutEdit'
import type { CableLine, TerrainSource } from './types'

type OnEdit = (change: (line: CableLine) => CableLine) => void

const n0 = (v: number | null) => (v === null ? '–' : Math.round(v).toLocaleString('en-CA'))
const n1 = (v: number | null) => (v === null ? '–' : v.toFixed(1))

function StateIcon({ state }: { state: LayoutLimitState | null }) {
  if (state === null) return null
  if (state === 'met') return <CheckCircle2 className="size-3 text-emerald-600" role="img" aria-label="Met" />
  if (state === 'not-assessed')
    return <CircleDashed className="size-3 text-muted-foreground" role="img" aria-label="Not assessed" />
  return <OctagonAlert className="size-3 text-red-600 dark:text-red-400" role="img" aria-label="Not met" />
}

/**
 * A row label that locates the row on the D-line chart and plan. Picking it again clears the marks.
 */
export function LocateRow({
  line,
  rowId,
  result,
  settings,
  edited,
  children,
}: {
  line: CableLine
  rowId: string
  result: CableLayoutResult
  settings: CableSupportLayout
  edited?: EditedLayout
  children: ReactNode
}) {
  const focus = useLayoutFocus(line.id)
  const frame = lineFrame(line)
  const pressed = focus?.rowId === rowId
  const locate = () => {
    if (!frame) return
    const marks = focusMarks(rowId, result, settings, edited ? placementIssues(edited, settings) : [])
    const at = marks.points[0]?.stationM ?? marks.range?.[0]
    const x = at === undefined ? null : chartDistance(frame, Math.min(frame.lengthM, Math.max(0, at)))
    focusLayoutRow(line.id, rowId, x)
  }
  return (
    <button
      type="button"
      className="inline-flex items-start gap-1 text-left hover:underline focus-visible:underline focus-visible:outline-none"
      aria-pressed={pressed}
      title={pressed ? 'Clear the marks on the D-line chart' : 'Show where this applies on the D-line chart and plan'}
      onClick={locate}
    >
      <Crosshair className={`mt-0.5 size-3 shrink-0 ${pressed ? 'text-rose-700' : 'text-muted-foreground'}`} />
      <span>{children}</span>
    </button>
  )
}

/** Adjust the found layout, or place supports by hand; nothing while an edit is open. */
export function CableLayoutEditButtons({
  line,
  terrain,
  onEdit,
}: {
  line: CableLine
  terrain: TerrainSource
  onEdit: OnEdit
}) {
  const settings = line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT
  if (settings.edited) return null
  const start = (fromFound: boolean) => {
    const prepared = layoutRun(line, terrain, settings)
    if (!prepared.ok) return
    const edit =
      fromFound && settings.saved
        ? editFromFound(settings.saved, settings, prepared.run.lengthM)
        : emptyEdit(settings, defaultPreTension(prepared.run))
    onEdit((l) => withEdited(l, edit))
  }
  const prepared = layoutRun(line, terrain, settings)
  const foundFits = prepared.ok && Boolean(savedLayoutToAnalyse(prepared.run, settings.saved))
  return (
    <>
      {settings.saved && (
        <Button
          size="sm"
          variant="outline"
          disabled={!foundFits}
          title={foundFits ? undefined : 'The found layout no longer fits the D-line; find supports again.'}
          onClick={() => start(true)}
        >
          Adjust layout
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={!prepared.ok} onClick={() => start(false)}>
        Place supports by hand
      </Button>
    </>
  )
}

function IdentityFields({
  label,
  value,
  onChange,
  allowAnchor,
}: {
  label: string
  value: SupportIdentity
  onChange: (patch: SupportIdentity) => void
  allowAnchor: boolean
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-1">
      <input
        className={roadFieldClass}
        aria-label={`${label} name`}
        placeholder="Name (e.g. spar 3, fir 70 cm)"
        value={value.name ?? ''}
        maxLength={MAX_SUPPORT_NAME_LENGTH}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <RoadSelect
        ariaLabel={`${label} category`}
        className={`${roadFieldClass} w-28`}
        value={value.category ?? 'none'}
        onValueChange={(v) => onChange({ category: v === 'none' ? undefined : (v as SupportCategory) })}
      >
        <option value="none">No category</option>
        {SUPPORT_CATEGORIES.filter((c) => allowAnchor || c !== 'ground-anchor').map((c) => (
          <option key={c} value={c}>
            {SUPPORT_CATEGORY_LABELS[c]}
          </option>
        ))}
      </RoadSelect>
    </div>
  )
}

/** The result for a support at this station, if the check has one there. */
const resultAt = (result: CableLayoutResult | null, stationM: number) =>
  result?.supports.find((s) => s.kind !== 'anchor' && Math.abs(s.stationM - stationM) < 0.05)

function SupportResult({ support }: { support: LayoutSupport | undefined }) {
  if (!support) return <>not checked yet</>
  return (
    <>
      break {support.emptyBreakDeg === null ? '–' : `${n1(support.emptyBreakDeg)}/${n1(support.loadedBreakDeg)}°`} ·{' '}
      {support.kind === 'ground-anchor' || support.kind === 'anchor' ? 'tension' : 'force'} {n1(support.maxForceKN)} kN
    </>
  )
}

/**
 * The edited layout: status, pre-tension, Found vs Current, the supports and the spans. Rendered by
 * the Intermediate supports section in place of the found result while an edit is open.
 */
export function CableLayoutEditor({
  line,
  terrain,
  onEdit,
  found,
}: {
  line: CableLine
  terrain: TerrainSource
  onEdit: OnEdit
  /** The found layout's result on the D-line as it is now, when there is one. */
  found: CableLayoutResult | undefined
}) {
  useEditedLayoutCheck(line, terrain)
  const check = useEditCheck(line.id)
  const settings = line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT
  const edited = settings.edited!
  const frame = lineFrame(line)
  const lengthM = frame?.lengthM ?? 0
  const lineKey = layoutKey(line, terrain)
  const checkKey = editCheckKey(edited)
  const drawn = drawnEditResult(check, lineKey, checkKey)
  const shown = drawn?.result ?? null
  const current = drawn && !drawn.pending ? drawn.result : null
  const checking = !current && check?.lineKey === lineKey && check.checkKey === checkKey && check.status !== 'error'
  const checkError =
    check?.lineKey === lineKey && check.checkKey === checkKey && check.status === 'error' ? check.error : undefined
  const errors = editedLayoutErrors(edited, lengthM)
  const placement = placementIssues(edited, settings)
  const minClearanceM = line.rigging?.minClearanceM ?? 0
  const rows = compareLayouts(found ?? null, shown, settings, minClearanceM, placement)
  const set = (next: EditedLayout) => onEdit((l) => withEdited(l, next))
  const discard = () => onEdit((l) => withEdited(l, undefined))
  const prepared = layoutRun(line, terrain, settings)
  const foundFits = prepared.ok && Boolean(savedLayoutToAnalyse(prepared.run, settings.saved))
  const reset = () =>
    prepared.ok && settings.saved && set(editFromFound(settings.saved, settings, prepared.run.lengthM))
  const add = (index?: number) => {
    const added =
      index === undefined
        ? addSupportInLongestSpan(edited, settings, lengthM)
        : addSupportAfter(edited, index, settings, lengthM)
    if (added) set(added.edited)
  }
  const full = edited.supports.length >= MAX_EDITED_SUPPORTS
  const download = () => {
    if (!current || errors.length) return
    const labels = current.supports
      .filter((s) => s.kind !== 'anchor')
      .map((s, i, list) =>
        i === 0
          ? edited.start
          : i === list.length - 1
            ? edited.end
            : (edited.supports.find((e) => Math.abs(e.stationM - s.stationM) < 0.05) ?? {}),
      )
    downloadText(cableLayoutCsv(line.name, current, labels), 'd-line-supports-edited.csv', 'text/csv;charset=utf-8')
  }
  const startText =
    settings.startKind === 'yarder'
      ? `Yarder tower · ${n1(line.startHeight)} m (the D-line's yarder height)`
      : settings.startKind === 'anchor'
        ? 'Ground anchor'
        : null
  const endText = settings.endKind === 'anchor' ? 'Ground anchor' : null

  return (
    <div className="space-y-2" data-testid="cable-layout-editor">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p role="status" className="text-xs" data-testid="cable-layout-edit-status">
          <span className="font-medium">
            {edited.origin === 'found' ? 'Adjusting the found layout' : 'Supports placed by hand'}
          </span>
          {' · '}
          {checkError
            ? 'cannot check'
            : checking || drawn?.pending
              ? 'checking…'
              : current
                ? 're-checked'
                : 'not checked'}
        </p>
        <InfoTip label="About adjusting the layout">
          Each change is re-checked about 300 ms later with the same static analysis as the search, at the pre-tension
          entered here. Drag a support on the D-line chart to move it or change its height, double-click the profile to
          add one, and Shift-drag along it to draw a no-support sector. Names and categories are labels only: nothing is
          sized from them. Supports do not lean in this model.
        </InfoTip>
      </div>
      <div className="flex flex-wrap gap-1">
        {settings.saved && (
          <Button size="sm" variant="outline" disabled={!foundFits} onClick={reset}>
            Reset to found
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={discard}>
          Discard edits
        </Button>
        <Button size="sm" variant="outline" disabled={!current || errors.length > 0} onClick={download}>
          Supports CSV
        </Button>
      </div>
      {(errors[0] ?? checkError) && <InlineAlert tone="error">{errors[0] ?? checkError}</InlineAlert>}
      {placement.map((p) => (
        <InlineAlert key={`${p.stationM}-${p.text}`} tone="warning">
          {p.text}
        </InlineAlert>
      ))}
      <NumberField
        label="Pre-tension (kN)"
        value={edited.preTensionKN}
        min={EDIT_PRE_TENSION_KN[0]}
        max={EDIT_PRE_TENSION_KN[1]}
        step={1}
        hint="The empty skyline's tension at the yarder-side support top, as the search reports it. The allowable tension is checked in the table below."
        onChange={(preTensionKN) => set({ ...edited, preTensionKN })}
      />
      <EngineeringTable rowHeaders compact data-testid="cable-layout-compare">
        <thead>
          <tr>
            <ColumnHeader label="Check" className="text-left" />
            <ColumnHeader label="Found" />
            <ColumnHeader label="Current" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-row={row.id}
              data-changed={row.changed || undefined}
              aria-selected={row.currentState === 'not-met'}
            >
              <th scope="row">
                {shown ? (
                  <LocateRow line={line} rowId={row.id} result={shown} settings={settings} edited={edited}>
                    {row.label}
                  </LocateRow>
                ) : (
                  row.label
                )}
                <span className="block text-3xs text-muted-foreground">{row.limit}</span>
              </th>
              <td className="whitespace-normal">{row.found}</td>
              <td className="whitespace-normal">
                <span className="inline-flex items-center gap-1">
                  <StateIcon state={row.currentState} />
                  {row.current}
                  {row.changed && (
                    <span
                      className="text-amber-700 dark:text-amber-400"
                      role="img"
                      aria-label="changed"
                      title="Changed from the found layout"
                    >
                      ●
                    </span>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </EngineeringTable>
      <div className="space-y-1" data-testid="cable-edit-supports">
        <div className="space-y-1 rounded border p-1.5" data-testid="cable-edit-start">
          <div className="flex items-center justify-between gap-1 text-xs">
            <span className="font-medium">Start · 0 m</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
              disabled={full}
              aria-label="Add a support after the start"
              onClick={() => add(-1)}
            >
              <Plus className="size-3" /> After
            </Button>
          </div>
          {startText ? (
            <p className="text-2xs text-muted-foreground">{startText}</p>
          ) : (
            <NumberField
              label="Start support height (m)"
              value={edited.start.heightM}
              min={EDIT_END_HEIGHT_M[0]}
              max={EDIT_END_HEIGHT_M[1]}
              step={0.5}
              onChange={(h) => set(setEndHeight(edited, 'start', h))}
            />
          )}
          <IdentityFields
            label="Start support"
            value={edited.start}
            allowAnchor
            onChange={(patch) => set(nameSupport(edited, 'start', patch))}
          />
        </div>
        {edited.supports.map((s, i) => {
          const [low, high] = stationBounds(edited, i, lengthM)
          const asFound = edited.origin === 'found' && matchesFound(settings.saved, s)
          return (
            <div key={i} className="space-y-1 rounded border p-1.5" data-testid="cable-edit-support">
              <div className="flex items-center justify-between gap-1 text-xs">
                <span className="font-medium">
                  Support {i + 1}
                  <span className="ml-1 text-2xs font-normal text-muted-foreground">
                    {edited.origin === 'found' ? (asFound ? 'as found' : 'changed') : 'placed'}
                  </span>
                </span>
                <span className="flex shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={full}
                    aria-label={`Add a support after support ${i + 1}`}
                    onClick={() => add(i)}
                  >
                    <Plus className="size-3" /> After
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={`Delete support ${i + 1}`}
                    onClick={() => set(removeSupport(edited, i))}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <NumberField
                  label="Station (m)"
                  value={s.stationM}
                  min={Math.min(low, high)}
                  max={Math.max(low, high)}
                  step={1}
                  onChange={(stationM) => set(moveSupport(edited, i, { stationM }, lengthM))}
                />
                <NumberField
                  label="Height (m)"
                  value={s.heightM}
                  min={EDIT_SUPPORT_HEIGHT_M[0]}
                  max={EDIT_SUPPORT_HEIGHT_M[1]}
                  step={0.5}
                  onChange={(heightM) => set(moveSupport(edited, i, { heightM }, lengthM))}
                />
              </div>
              <IdentityFields
                label={`Support ${i + 1}`}
                value={s}
                allowAnchor={false}
                onChange={(patch) => set(nameSupport(edited, i, patch))}
              />
              <p className="text-2xs text-muted-foreground">
                <SupportResult support={resultAt(shown, s.stationM)} />
              </p>
            </div>
          )
        })}
        <div className="space-y-1 rounded border p-1.5" data-testid="cable-edit-end">
          <span className="text-xs font-medium">End · {n0(lengthM)} m</span>
          {endText ? (
            <p className="text-2xs text-muted-foreground">{endText}</p>
          ) : (
            <NumberField
              label="End support height (m)"
              value={edited.end.heightM}
              min={EDIT_END_HEIGHT_M[0]}
              max={EDIT_END_HEIGHT_M[1]}
              step={0.5}
              onChange={(h) => set(setEndHeight(edited, 'end', h))}
            />
          )}
          <IdentityFields
            label="End support"
            value={edited.end}
            allowAnchor
            onChange={(patch) => set(nameSupport(edited, 'end', patch))}
          />
        </div>
        <Button size="sm" variant="outline" className="w-full" disabled={full || lengthM <= 0} onClick={() => add()}>
          <Plus className="size-3" /> Add support in the longest span
        </Button>
      </div>
      {shown && (
        <div className="max-h-40 overflow-auto rounded border">
          <EngineeringTable data-testid="cable-edit-spans">
            <thead className="sticky top-0">
              <tr>
                <ColumnHeader label="Span" unit="m" className="text-left" />
                <ColumnHeader label="Loaded sag" unit="m" />
                <ColumnHeader label="Min clearance" unit="m" />
                <ColumnHeader label="Max tension" unit="kN" />
              </tr>
            </thead>
            <tbody>
              {shown.spans.map((s, i) => (
                <tr key={i} aria-selected={!(s.clearanceOk && s.tensionOk && s.gravityOk)}>
                  <td className="text-left">
                    <LocateRow line={line} rowId={`span:${i}`} result={shown} settings={settings} edited={edited}>
                      {n0(s.fromM)}–{n0(s.toM)}
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
      )}
    </div>
  )
}
