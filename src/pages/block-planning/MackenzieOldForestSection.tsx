import { useState } from 'react'
import { DownloadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CalculationTable } from '@/components/ui/calculation-results'
import {
  CheckboxField,
  FORM_INPUT_CLASS,
  FormField,
  NullableNumberField,
  SelectField,
} from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolDisclosure, ToolSection } from '@/components/ui/tool-section'
import { setCheck, setMackenzieOldForest } from './edits'
import { heldOld, mackenzieShortfallText, type MackenzieRowYear } from './oldForest/mackenzie'
import { mackenzieOldForestCurrent, mackenzieOldForestKey, mackenzieYoungerProblem } from './oldForest/mackenzieRecord'
import {
  MACKENZIE_SOURCES,
  MACKENZIE_UNITS,
  MACKENZIE_YOUNGER_MAX_SHARE,
  mackenzieUnit,
  rowName,
  type MackenzieUnit,
} from './oldForest/mackenzieUnits'
import { calculateMackenzieOldForest, OldForestStopped, stopOldForest } from './oldForest/oldForestClient'
import { EXCLUDED_LABELS } from './oldForest/landBase'
import type { StepProps } from './steps/types'

const ha = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const pct = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

type RunState = { status: 'idle' } | { status: 'running'; progress: string } | { status: 'failed'; error: string }

function Held({ have, need }: { have: number | null; need: number | null }) {
  if (have === null || need === null) return <span className="text-muted-foreground">—</span>
  return (
    <span className={have < need ? 'font-medium text-warning' : undefined}>
      {ha.format(have)} / {ha.format(need)}
    </span>
  )
}

const rowLabel = (unit: MackenzieUnit, id: string) => {
  const row = unit.rows.find((r) => r.id === id)
  return row
    ? `${rowName(row)}: ${row.oldPercent}% old, ${row.interiorPercent === null ? 'interior share open' : `${row.interiorPercent}% interior`}`
    : id
}

/**
 * Objectives 2 and 3 of the Mackenzie order for one unit or group of the 2010 Table 2, read from
 * DataBC on request and kept with the plan. It is evidence beside the Mackenzie pack's questions;
 * the margins stay the reviewer's answers.
 */
export function MackenzieOldForestSection({ plan, edit }: Pick<StepProps, 'plan' | 'edit'>) {
  const choices = plan.mackenzieOldForest
  const unit = choices ? mackenzieUnit(choices.unit) : null
  const record = plan.checks?.mackenzieOldForest
  const recordUnit = record ? mackenzieUnit(record.unit) : null
  const current = mackenzieOldForestCurrent(plan)
  const youngerProblem = mackenzieYoungerProblem(choices?.younger)
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const names = Object.fromEntries(plan.schedules.map((s) => [s.id, s.name]))

  function calculate() {
    setRun({ status: 'running', progress: 'Starting…' })
    calculateMackenzieOldForest(
      {
        plan: { ...plan, reviews: {}, landscape: {}, packs: [], zones: undefined, checks: undefined },
        key: mackenzieOldForestKey(plan),
        ranOn: new Date().toISOString().slice(0, 10),
      },
      (progress) => setRun({ status: 'running', progress }),
    )
      .then((result) => {
        edit((p) => setCheck(p, 'mackenzieOldForest', result))
        setRun({ status: 'idle' })
      })
      .catch((e: unknown) => {
        if (e instanceof OldForestStopped && e.message === 'Stopped.') return
        setRun({ status: 'failed', error: e instanceof Error ? e.message : 'The calculation failed.' })
      })
  }
  function cancel() {
    stopOldForest()
    setRun({ status: 'idle' })
  }

  const review = record?.schedules.find((s) => s.schedule === plan.reviewSchedule) ?? record?.schedules[0]
  const tableRows = recordUnit && review ? review.years.flatMap((y) => y.rows.map((r) => ({ year: y.year, r }))) : []
  const summary = !choices
    ? 'Not assessed'
    : !record
      ? `${unit?.asPrinted ?? choices.unit} · not calculated`
      : `${recordUnit?.asPrinted ?? record.unit}${current ? '' : ' · out of date'}`

  return (
    <ToolSection
      title="Mackenzie old forest (2008 order)"
      help="Objectives 2 and 3 of the Mackenzie non-spatial order, Table 2 as replaced in 2010, for one landscape unit or group: old forest against each row's share of the Crown forest land base in its biogeoclimatic groups, and old interior forest against Table 3. Read from DataBC's landscape units, VRI, corridors, ownership and tenures on request. The readings made are listed in the guide."
      summary={summary}
    >
      <InlineAlert tone="info">
        VRI age-based and not field-verified. The figures are evidence beside the Mackenzie pack’s questions; the
        margins you enter there stay yours.
      </InlineAlert>
      <SelectField
        label="Landscape unit or group (Table 2, 2010)"
        value={choices?.unit ?? ''}
        onValueChange={(id) => edit((p) => setMackenzieOldForest(p, { unit: id }))}
      >
        {!choices && <option value="">Choose…</option>}
        {MACKENZIE_UNITS.map((u) => (
          <option key={u.id} value={u.id}>
            {`${u.asPrinted} · ${u.beo}`}
          </option>
        ))}
      </SelectField>
      {choices && unit && (
        <>
          <ul className="space-y-0.5 text-2xs text-muted-foreground" data-testid="block-planning-mackenzie-rows">
            {unit.rows.map((r) => (
              <li key={r.id}>
                {rowLabel(unit, r.id)}
                {r.interiorNote ? ` (${r.interiorNote})` : ''}
              </li>
            ))}
          </ul>
          <ToolDisclosure label="Assumptions you can change">
            <div className="space-y-2">
              {unit.park && (
                <CheckboxField
                  label={`Count ${unit.park.asPrinted} with ${unit.asPrinted} (Objectives 2(d) and 3(b) say it may)`}
                  description="The park joins the unit: its CFLB, old forest and interior count with the unit's."
                  checked={choices.countPark}
                  onCheckedChange={(on) => edit((p) => setMackenzieOldForest(p, { countPark: on }))}
                />
              )}
              <NullableNumberField
                label="Share of the area the epidemic affected (%), for Objective 2(a)"
                description="Caps the Natural Forest Area (dead old forest, by the VRI’s dead stems) counted toward each target. Blank: no cap, and all old forest by age counts."
                value={choices.affectedPercent ?? null}
                min={0}
                max={100}
                step={1}
                updateOn="commit"
                onValueChange={(v) => edit((p) => setMackenzieOldForest(p, { affectedPercent: v ?? undefined }))}
              />
              {choices.affectedPercent !== undefined && (
                <FormField label="Where that share comes from">
                  <input
                    className={FORM_INPUT_CLASS}
                    value={choices.affectedSource ?? ''}
                    onChange={(e) => edit((p) => setMackenzieOldForest(p, { affectedSource: e.target.value }))}
                  />
                </FormField>
              )}
              <CheckboxField
                label={`Count younger stands toward up to ${MACKENZIE_YOUNGER_MAX_SHARE * 100}% of the live old forest part of each target (2(b))`}
                description="Only where equal or better conservation benefits are demonstrated, and never toward interior. Off unless you state the age and the benefit."
                checked={choices.younger !== undefined}
                onCheckedChange={(on) =>
                  edit((p) => setMackenzieOldForest(p, { younger: on ? { benefit: '' } : undefined }))
                }
              />
              {choices.younger && (
                <>
                  <NullableNumberField
                    label="Younger stands count from (years)"
                    description="Stands this age and older, up to their own old age (121, 101 or 141), count. No default: state it."
                    value={choices.younger.fromAge ?? null}
                    min={1}
                    max={140}
                    step={1}
                    updateOn="commit"
                    onValueChange={(v) =>
                      edit((p) =>
                        setMackenzieOldForest(p, {
                          younger: {
                            benefit: p.mackenzieOldForest?.younger?.benefit ?? '',
                            ...(v === null ? {} : { fromAge: Math.round(v) }),
                          },
                        }),
                      )
                    }
                  />
                  <FormField label="Conservation benefit (2(b))">
                    <textarea
                      className={FORM_INPUT_CLASS}
                      rows={3}
                      value={choices.younger.benefit}
                      onChange={(e) =>
                        edit((p) =>
                          setMackenzieOldForest(p, {
                            younger: { ...(p.mackenzieOldForest?.younger ?? {}), benefit: e.target.value },
                          }),
                        )
                      }
                    />
                  </FormField>
                  {youngerProblem && <InlineAlert tone="warning">{youngerProblem}</InlineAlert>}
                </>
              )}
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
            <Button size="sm" onClick={calculate} disabled={youngerProblem !== null}>
              <DownloadCloud className="size-3.5" />
              {record ? 'Calculate again' : 'Read and calculate'}
            </Button>
          )}
          {run.status === 'failed' && <InlineAlert tone="error">{run.error}</InlineAlert>}
        </>
      )}
      {record && recordUnit && (
        <div className="space-y-2" data-testid="block-planning-mackenzie">
          {!current && (
            <InlineAlert tone="warning">
              The plan, these choices or the calculation changed since {record.ranOn}. Calculate again before relying on
              these figures.
            </InlineAlert>
          )}
          <ul className="space-y-0.5 text-xs">
            {record.schedules.map((s) => (
              <li key={s.schedule}>
                <span className="font-medium">{names[s.schedule] ?? s.schedule}:</span>{' '}
                {mackenzieShortfallText(s.years, recordUnit)}
              </li>
            ))}
          </ul>
          {review && (
            <CalculationTable
              caption={`${names[review.schedule] ?? review.schedule}: hectares held / required`}
              rows={tableRows}
              rowKey={(x) => `${x.year}|${x.r.row}`}
              columns={[
                { label: 'Year', render: (x) => x.year },
                {
                  label: 'Row',
                  render: (x) =>
                    rowName(recordUnit.rows.find((r) => r.id === x.r.row) ?? { groups: [], groupsAsPrinted: x.r.row }),
                },
                { label: 'CFLB', render: (x) => ha.format(x.r.cflbHa) },
                { label: 'Old', render: (x) => <Held have={heldOld(x.r)} need={x.r.requiredOldHa} /> },
                { label: 'Of it dead', render: (x) => ha.format(x.r.deadOldHa) },
                { label: 'Old interior', render: (x) => <Held have={x.r.interiorHa} need={x.r.requiredInteriorHa} /> },
              ]}
            />
          )}
          <p className="text-2xs text-muted-foreground">
            Old is live old forest plus the Natural Forest Area counted (the VRI’s dead share of old forest
            {record.affected
              ? `, capped at ${pct.format(record.affected.percent)}% of each target${record.affected.source ? ` (${record.affected.source})` : ''}`
              : ', with no 2(a) cap stated'}
            ){record.younger ? `, plus younger stands from ${record.younger.fromAge} years under 2(b)` : ''}. Interior
            is calculated for every period of the schedule under review and the first and last of the others.
            {record.younger ? ` Conservation benefit stated: “${record.younger.benefit}”` : ''}
          </p>
          <p className="text-2xs text-muted-foreground" data-testid="block-planning-mackenzie-land">
            CFLB by the VRI proxy, {ha.format(record.cflbProxyHa)} ha in the unit
            {record.park ? `, ${record.park} included` : ''}. {landSentence(record)} VRI projected to{' '}
            {record.projectedYear}; {record.counts.stands.toLocaleString()} stands, {record.counts.lakes} lakes and
            reservoirs, {record.counts.corridors} corridor features. {record.source}.
          </p>
          {record.outsideRows.length > 0 && (
            <p className="text-2xs text-muted-foreground">
              CFLB no row of this unit holds, so set against no target:{' '}
              {record.outsideRows
                .filter((o) => o.cflbHa >= 0.5)
                .map((o) => `${o.label}${o.group ? ` (group ${o.group})` : ''} ${ha.format(o.cflbHa)} ha`)
                .join(', ') || 'under a hectare'}
              .
            </p>
          )}
          {record.published && recordUnit.published.length > 0 && (
            <ToolDisclosure label="Check against the published figure">
              <PublishedCheck unit={recordUnit} year={record.published} />
            </ToolDisclosure>
          )}
          <p className="text-2xs text-muted-foreground">
            <a className="underline" href={MACKENZIE_SOURCES.order.url} target="_blank" rel="noreferrer">
              {MACKENZIE_SOURCES.order.label}
            </a>
            ;{' '}
            <a className="underline" href={MACKENZIE_SOURCES.amendment.url} target="_blank" rel="noreferrer">
              {MACKENZIE_SOURCES.amendment.label}
            </a>
            .
          </p>
        </div>
      )}
    </ToolSection>
  )
}

function landSentence(record: NonNullable<NonNullable<StepProps['plan']['checks']>['mackenzieOldForest']>) {
  const left = record.excluded
    .filter((e) => e.grossHa >= 0.5)
    .map((e) => `${EXCLUDED_LABELS[e.kind].toLowerCase()} ${ha.format(e.grossHa)} ha (${ha.format(e.cflbHa)} ha CFLB)`)
  const kept = record.keptCommunityForests.map((k) => `${k.file} (${ha.format(k.areaHa)} ha)`)
  return [
    left.length ? `Left out: ${left.join('; ')}.` : 'No ground the order does not apply to was found.',
    kept.length ? `Community forests larger than 600 ha stay, as the order applies to them: ${kept.join(', ')}.` : '',
    'Tree farm licences stay: the order does not name them.',
  ]
    .filter(Boolean)
    .join(' ')
}

/** The baseline alone in 2019 beside the 2020 timber supply review's published row. */
function PublishedCheck({ unit, year }: { unit: MackenzieUnit; year: { year: number; rows: MackenzieRowYear[] } }) {
  return (
    <div className="space-y-1">
      {unit.published.map((p) => {
        const row = unit.rows.find((r) =>
          r.groups.includes(p.becGroup as MackenzieUnit['rows'][number]['groups'][number]),
        )
        const mine = row ? year.rows.find((r) => r.row === row.id) : undefined
        if (!row || !mine) return null
        return (
          <p key={p.label} className="text-xs">
            {rowName(row)}, {year.year}, baseline only: CFLB {ha.format(mine.cflbHa)} ha (published Crown forest{' '}
            {ha.format(p.crownForestHa)} ha), old {ha.format(mine.oldHa)} ha,{' '}
            {pct.format((mine.oldHa / mine.cflbHa) * 100)}% (published {ha.format(p.oldHa)} ha,{' '}
            {pct.format(p.oldPercent)}%), against {row.oldPercent}%.
            {mine.unknownAgeHa > 0
              ? ` ${ha.format(mine.unknownAgeHa)} ha was harvested between ${year.year} and the VRI projection; its age then is not kept, and it is not counted as old.`
              : ''}
          </p>
        )
      })}
      <p className="text-2xs text-muted-foreground">
        The published figure is the timber supply review’s, on its own Crown forest land base and the VRI updated to
        2019; it lists only the units then short.{' '}
        <a className="underline" href={MACKENZIE_SOURCES.tsr2020.url} target="_blank" rel="noreferrer">
          {MACKENZIE_SOURCES.tsr2020.label}
        </a>
        .
      </p>
    </div>
  )
}
