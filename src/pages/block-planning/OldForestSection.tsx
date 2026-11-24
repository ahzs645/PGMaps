import { useEffect, useRef, useState } from 'react'
import { DownloadCloud, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CalculationTable } from '@/components/ui/calculation-results'
import { FileButton } from '@/components/ui/file-button'
import {
  CheckboxField,
  FORM_INPUT_CLASS,
  FormField,
  NullableNumberField,
  SelectField,
} from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { TextButton } from '@/components/ui/text-button'
import { ToolDisclosure, ToolSection } from '@/components/ui/tool-section'
import { setCheck, setOldForest } from './edits'
import { importRetentionAreas } from './imports'
import type { OldForestAsk, OldForestReply } from './oldForest/oldForest.worker'
import { BOARD_2019_SOURCE, gisDisagrees, oldForestUnit, unitsOf } from './oldForest/units'
import { nduParts } from './orderUnits'
import { firstShortfall, oldForestCurrent, oldForestKey, type OldForestYear } from './records'
import type { StepProps } from './steps/types'

const ha = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const pct = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const signedPct = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0, signDisplay: 'exceptZero' })

type RunState = { status: 'idle' } | { status: 'running'; progress: string } | { status: 'failed'; error: string }

/** The unit most likely meant: the first of the district whose NDU names the plan's sub-unit. */
function suggestedUnit(district: string, ndu: string) {
  const units = unitsOf(district)
  const { name, sub } = nduParts(ndu)
  const want = `${name}${sub ? ` - ${sub}` : ''}`.toLowerCase()
  return units.find((u) => u.ndu.toLowerCase().includes(want)) ?? units[0]
}

function Shortfall({ have, need }: { have: number | null; need: number | null }) {
  if (have === null || need === null) return <span className="text-muted-foreground">—</span>
  const short = have < need
  return (
    <span className={short ? 'font-medium text-warning' : undefined}>
      {ha.format(have)} / {ha.format(need)}
    </span>
  )
}

/**
 * Objectives A and B for one of the order's old forest units: read from DataBC on request, kept with
 * the plan as a record of the inputs it was calculated from. The figures are VRI age-based and not
 * field-verified, and nothing here decides D.5(a): the determination stays the reviewer's.
 */
export function OldForestSection({ plan, edit, shown }: Pick<StepProps, 'plan' | 'edit' | 'shown'>) {
  const choices = plan.oldForest
  const units = unitsOf(choices?.district ?? plan.area.district)
  const unit = choices ? oldForestUnit(choices.district, choices.unit) : null
  const record = plan.checks?.oldForest
  const current = oldForestCurrent(plan)
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const worker = useRef<Worker | null>(null)
  useEffect(() => () => worker.current?.terminate(), [])

  function calculate() {
    worker.current ??= new Worker(new URL('./oldForest/oldForest.worker.ts', import.meta.url), { type: 'module' })
    const w = worker.current
    setRun({ status: 'running', progress: 'Starting…' })
    w.onmessage = ({ data }: MessageEvent<OldForestReply>) => {
      if (data.progress) return setRun({ status: 'running', progress: data.progress })
      if (data.error || !data.record) return setRun({ status: 'failed', error: data.error ?? 'Nothing came back.' })
      const result = data.record
      edit((p) => setCheck(p, 'oldForest', result))
      setRun({ status: 'idle' })
    }
    w.onerror = (e) => {
      w.terminate()
      worker.current = null
      setRun({ status: 'failed', error: e.message || 'The calculation could not start.' })
    }
    const ask: OldForestAsk = {
      plan: { ...plan, reviews: {}, landscape: {}, packs: [], zones: undefined, checks: undefined },
      key: oldForestKey(plan),
      ranOn: new Date().toISOString().slice(0, 10),
    }
    w.postMessage(ask)
  }
  function cancel() {
    // The worker keeps this session's reads; only a running read or calculation is stopped.
    worker.current?.terminate()
    worker.current = null
    setRun({ status: 'idle' })
  }

  const shownRun = record?.schedules.find((s) => s.schedule === shown.schedule) ?? record?.schedules[0]
  const names = Object.fromEntries(plan.schedules.map((s) => [s.id, s.name]))
  const board = unit?.board2019
  const calibration = record?.calibration2019
  const summary = !choices
    ? 'Not assessed'
    : !record
      ? `${choices.unit} · not calculated`
      : `${record.unit}${current ? '' : ' · out of date'}`

  return (
    <ToolSection
      title="Old and old interior forest"
      help="Objectives A and B of the 2004 order for one of its Map 2 units: old forest against its share of the Crown forest land base, old non-pine-leading forest, and old interior forest. Read from DataBC's VRI, OGMAs, parks and corridors on request. The assumptions are listed in the guide."
      summary={summary}
    >
      <InlineAlert tone="info">
        VRI age-based and not field-verified. Nothing here decides whether D.5(a) applies; that determination stays
        yours.
      </InlineAlert>
      {!plan.area.district ? (
        <p className="text-xs text-muted-foreground">Choose the historic forest district in step 1.</p>
      ) : (
        <>
          <SelectField
            label="Old forest unit (Map 2)"
            value={choices?.unit ?? ''}
            onValueChange={(code) =>
              edit((p) => setOldForest(p, { district: p.oldForest?.district ?? p.area.district, unit: code }))
            }
          >
            {!choices && <option value="">Choose…</option>}
            {units.map((u) => (
              <option key={u.unit} value={u.unit}>
                {`${u.unit} · ${u.ndu} · ${u.becAsPrinted.replace(/,\s*$/, '')}`}
              </option>
            ))}
          </SelectField>
          {!choices && (
            <TextButton
              onClick={() => {
                const u = suggestedUnit(plan.area.district, plan.area.ndu)
                if (u) edit((p) => setOldForest(p, { district: p.area.district, unit: u.unit }))
              }}
            >
              Use the unit that matches the sub-unit
            </TextButton>
          )}
        </>
      )}
      {choices && unit && (
        <>
          <p className="text-2xs text-muted-foreground" data-testid="block-planning-old-unit">
            {unit.oldPercent}% of the CFLB old (Table{' '}
            {unit.district === 'Vanderhoof' ? 1 : unit.district === 'Fort St. James' ? 2 : 3}), {unit.interiorPercent}%
            of that interior
            {unit.nonPinePercent !== null ? `, ${unit.nonPinePercent}% of the CFLB old non-pine-leading` : ''}.{' '}
            {unit.ageBasis}
          </p>
          <ToolDisclosure label="Assumptions you can change">
            <div className="space-y-2">
              <CheckboxField
                label="Count non-legal OGMAs whole (D.1)"
                checked={choices.countNonLegalOgmas}
                onCheckedChange={(on) => edit((p) => setOldForest(p, { countNonLegalOgmas: on }))}
              />
              <CheckboxField
                label="Count parks and protected areas (D.1 says they may)"
                checked={choices.countParks}
                onCheckedChange={(on) => edit((p) => setOldForest(p, { countParks: on }))}
              />
              <SelectField
                label="Interior method"
                value={choices.interiorMethod}
                onValueChange={(v) => edit((p) => setOldForest(p, { interiorMethod: v === '2004' ? '2004' : '2005' }))}
              >
                <option value="2005">2005 revision: 200 m from young stands and primary corridors</option>
                <option value="2004">2004 original: 200 m from anything younger than old</option>
              </SelectField>
              <NullableNumberField
                label="CFLB you state (ha)"
                description="Leave blank to use the VRI proxy: treed and on the forest management land base. A stated CFLB takes the proxy’s shares of old and interior forest."
                value={choices.cflbEnteredHa ?? null}
                min={1}
                step={1}
                updateOn="commit"
                onValueChange={(v) => edit((p) => setOldForest(p, { cflbEnteredHa: v ?? undefined }))}
              />
              {choices.cflbEnteredHa !== undefined && (
                <FormField label="Where that CFLB comes from">
                  <input
                    className={FORM_INPUT_CLASS}
                    value={choices.cflbSource ?? ''}
                    placeholder="e.g. LLOWG 2025 analysis"
                    onChange={(e) => edit((p) => setOldForest(p, { cflbSource: e.target.value }))}
                  />
                </FormField>
              )}
              <div className="space-y-1">
                <p className="text-xs font-medium">Retention and recruitment areas</p>
                {choices.retentionAreas.length ? (
                  <ul className="space-y-0.5 text-xs">
                    {choices.retentionAreas.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          {r.name}
                          <span className="text-muted-foreground"> · {r.reference || 'no approval reference'}</span>
                        </span>
                        <TextButton
                          onClick={() =>
                            edit((p) =>
                              setOldForest(p, {
                                retentionAreas: (p.oldForest?.retentionAreas ?? []).filter((x) => x.id !== r.id),
                              }),
                            )
                          }
                        >
                          Remove
                        </TextButton>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-2xs text-muted-foreground">
                    None. Spatial areas established after the order count whole (D.1); give each its approval reference.
                  </p>
                )}
                <FileButton
                  size="sm"
                  variant="outline"
                  label="Add retention or recruitment areas"
                  accept=".geojson,.json,application/json"
                  onFiles={(files) => onImport(files)}
                >
                  <Upload className="size-3.5" />
                  Add areas
                </FileButton>
              </div>
            </div>
          </ToolDisclosure>
          {run.status === 'running' ? (
            <div className="flex items-center gap-2">
              <InlineAlert loading>{run.progress}</InlineAlert>
              <Button size="sm" variant="outline" onClick={cancel}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={calculate}>
              <DownloadCloud className="size-3.5" />
              {record ? 'Calculate again' : 'Read and calculate'}
            </Button>
          )}
          {run.status === 'failed' && <InlineAlert tone="error">{run.error}</InlineAlert>}
        </>
      )}
      {record && (
        <div className="space-y-2" data-testid="block-planning-old-forest">
          {!current && (
            <InlineAlert tone="warning">
              The plan or these choices changed since {record.ranOn}. Calculate again before relying on these figures.
            </InlineAlert>
          )}
          {unit && gisDisagrees(unit, record.gisFraction) && (
            <InlineAlert tone="info">{gisDisagrees(unit, record.gisFraction)}</InlineAlert>
          )}
          <ul className="space-y-0.5 text-xs">
            {record.schedules.map((s) => {
              const f = firstShortfall(s.years)
              return (
                <li key={s.schedule}>
                  <span className="font-medium">{names[s.schedule] ?? s.schedule}:</span>{' '}
                  {f ? `short of ${f.what.join(', ')} from ${f.year}` : 'no shortfall over the projection'}
                </li>
              )
            })}
          </ul>
          {shownRun && (
            <CalculationTable
              caption={`${names[shownRun.schedule] ?? shownRun.schedule}: hectares held / required`}
              rows={shownRun.years}
              rowKey={(y: OldForestYear) => String(y.year)}
              columns={[
                { label: 'Year', render: (y: OldForestYear) => y.year },
                { label: 'Old', render: (y: OldForestYear) => <Shortfall have={y.oldHa} need={y.requiredOldHa} /> },
                {
                  label: 'Old non-pine',
                  render: (y: OldForestYear) => <Shortfall have={y.nonPineOldHa} need={y.requiredNonPineHa} />,
                },
                {
                  label: 'Old interior',
                  render: (y: OldForestYear) => <Shortfall have={y.interiorHa} need={y.requiredInteriorHa} />,
                },
              ]}
            />
          )}
          <p className="text-2xs text-muted-foreground">
            CFLB {ha.format(shownRun?.years[0].cflbHa ?? record.cflbProxyHa)} ha
            {choices?.cflbEnteredHa !== undefined
              ? ` as you stated${choices.cflbSource ? ` (${choices.cflbSource})` : ''}; every area is the VRI proxy’s share of its ${ha.format(record.cflbProxyHa)} ha applied to it`
              : ' by the VRI proxy'}
            . {ha.format(shownRun?.years[0].countedNotOldHa ?? 0)} ha counted whole under D.1 is not old by age.
            Interior is calculated for every period of the schedule under review and the first and last of the others.
            VRI projected to {record.projectedYear}; {record.counts.stands.toLocaleString()} stands,{' '}
            {record.counts.ogmas} OGMAs, {record.counts.parks} parks, {record.counts.corridors} corridor lines.{' '}
            {record.source}.
          </p>
          {calibration && board && (
            <ToolDisclosure label="Check against the Board’s 2019 figures">
              <CalculationTable
                caption="2019, baseline only: modelled / Board (difference)"
                rows={[
                  { label: 'CFLB', mine: calibration.cflbHa, theirs: board.cflbHa },
                  { label: 'Old forest', mine: calibration.oldHa, theirs: board.oldHa },
                  { label: 'Old interior', mine: calibration.interiorHa, theirs: board.interiorHa },
                ]}
                rowKey={(r) => r.label}
                columns={[
                  { label: '', render: (r) => r.label },
                  {
                    label: 'Hectares',
                    render: (r) =>
                      r.mine === null
                        ? '—'
                        : `${ha.format(r.mine)} / ${ha.format(r.theirs)} (${signedPct.format(((r.mine - r.theirs) / r.theirs) * 100)}%)`,
                  },
                ]}
              />
              <p className="text-2xs text-muted-foreground">
                {calibration.unknownAgeHa > 0
                  ? `${ha.format(calibration.unknownAgeHa)} ha of CFLB was harvested between 2019 and the VRI projection; its 2019 age is not kept, and it is not counted as old. `
                  : ''}
                The Board’s figures are the 2019 LLOWG analysis, from licensees’ own records and the inventory of the
                day.{' '}
                <a className="underline" href={BOARD_2019_SOURCE.url} target="_blank" rel="noreferrer">
                  {BOARD_2019_SOURCE.label}
                </a>
                . {pct.format(((calibration.oldHa - board.oldHa) / board.oldHa) * 100)}% on old forest.
              </p>
            </ToolDisclosure>
          )}
        </div>
      )}
    </ToolSection>
  )

  function onImport(files: File[]) {
    void importRetention(files)
  }
  async function importRetention(files: File[]) {
    const file = files[0]
    if (!file) return
    try {
      const data: unknown = JSON.parse(await file.text())
      edit((p) => {
        const existing = p.oldForest?.retentionAreas ?? []
        return setOldForest(p, { retentionAreas: [...existing, ...importRetentionAreas(existing, data, file.name)] })
      })
    } catch (e) {
      setRun({ status: 'failed', error: e instanceof Error ? e.message : 'The file could not be read.' })
    }
  }
}
