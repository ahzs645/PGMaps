import { ReferenceExhibits } from './ReferenceExhibits'
import { EngineeringTable } from '@/components/ui/engineering-table'
import { StyledSelect } from '@/components/ui/styled-select'
import { ReferenceRegistration, type PhotoInputs } from './ReferenceRegistration'
import { ReferenceRunPanel, type ReferenceRunActions } from './ReferenceRunPanel'
import { ReferenceGeometryPanel, type ReferenceGeometryActions } from './ReferenceGeometryPanel'
import { ReferenceComparisonPanel } from './ReferenceComparisonPanel'
import type { ReferenceCapture } from './referenceComparison'
import { useState, type ReactNode } from 'react'
import { FileUp, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { FileButton } from '@/components/ui/file-button'
import { InfoTip } from '@/components/ui/info-tip'
import { EmptyHint } from '@/components/ui/result-list'
import { TabBar } from '@/components/ui/tab-bar'
import { FORM_INPUT_CLASS } from '@/components/ui/form-field'
import { AttachmentPreview } from './ProjectAttachments'
import type { ProjectAttachment } from './projectArchive'
import {
  referenceArithmetic,
  chosenValues,
  amount,
  referenceClass,
  referenceLabels,
  type ReferenceField,
  type ReferenceRow,
  type ReferenceValues,
  type ReferenceContext,
} from './referenceMeasurements'
import { formatPct } from './measureFormat'

const fields = Object.keys(referenceLabels) as ReferenceField[]
const input = FORM_INPUT_CLASS + ' w-full min-w-0'
const format = (value: number | null) => formatPct(value, 3, 'Insufficient area measurements')
const net = (value: number) => Number(value.toFixed(6))

function Arithmetic({ values, printed }: { values: ReferenceValues; printed?: boolean }) {
  const {
    numerator,
    denominator,
    percentage,
    difference,
    netArea,
    netPercentage,
    listedNetPercentage,
    componentArea,
    componentPercentage,
  } = referenceArithmetic(values)
  const band = referenceClass(values.rule, percentage ?? componentPercentage ?? amount(values.percent))
  return (
    <div className="space-y-1">
      <p className="font-medium tabular-nums">{format(percentage)}</p>
      {numerator !== null && denominator !== null && (
        <p>
          {numerator} ÷ {denominator} {values.unit} × 100
        </p>
      )}
      {printed && difference !== null && (
        <p>
          {difference > 0 ? '+' : ''}
          {Number(difference.toFixed(3))} percentage points from the transcribed percentage.
        </p>
      )}
      {componentArea !== null && (
        <p>
          Proposed + existing = {net(componentArea)} {values.unit}.
        </p>
      )}
      {componentPercentage !== null && <p>Proposed + existing = {format(componentPercentage)}.</p>}
      {netArea !== null && (
        <p>
          {values.gross} − {values.deduction} = {net(netArea)} {values.unit}. Alteration on that area is{' '}
          {format(netPercentage)}.
        </p>
      )}
      {listedNetPercentage !== null && (netArea === null || net(netArea) !== Number(values.net)) && (
        <p>
          Alteration on the listed net area of {values.net} {values.unit} is {format(listedNetPercentage)}.
        </p>
      )}
      {band && <p>Source percentage band {band}</p>}
    </div>
  )
}

type Props = {
  photoInputs: PhotoInputs
  runActions: ReferenceRunActions
  geometry: ReferenceGeometryActions
  captures: ReferenceCapture[]
  onAdd: () => string
  rows: ReferenceRow[]
  views: ReferenceContext['views']
  landforms: ReferenceContext['landforms']
  attachments: ProjectAttachment[]
  loaded: boolean
  onImport: (file: Blob) => Promise<string>
  onChange: (row: ReferenceRow) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** A reference row's work, one tab each: what used to be five folds stacked under one another. */
type RowTab = 'measurements' | 'geometry' | 'trace' | 'run' | 'compare' | 'exhibits'
const ROW_TABS: Array<{ value: RowTab; label: string }> = [
  { value: 'measurements', label: 'Measurements' },
  { value: 'geometry', label: 'Geometry' },
  { value: 'trace', label: 'Image trace' },
  { value: 'run', label: 'Run' },
  { value: 'compare', label: 'Compare' },
  { value: 'exhibits', label: 'Exhibits' },
]
const ID_PREFIX = 'reference-row'

function RowReview({
  row,
  captures,
  geometry,
  runActions,
  photoInputs,
  attachments,
  views,
  landforms,
  onChange,
  rows,
  tab,
  visited,
}: Pick<
  Props,
  'photoInputs' | 'runActions' | 'geometry' | 'captures' | 'attachments' | 'views' | 'landforms' | 'onChange' | 'rows'
> & {
  row: ReferenceRow
  tab: RowTab
  /** Tabs shown at least once: each is mounted from then on, hidden while another is chosen, so its work is kept. */
  visited: ReadonlySet<RowTab>
}) {
  const values = chosenValues(row)
  const files = attachments.filter((a) => a.name === values.source)
  const [allFields, setAllFields] = useState(false)
  const edit = (key: ReferenceField, value: string) => {
    const corrections = { ...row.corrections }
    if (value === (row.printed[key] ?? '')) delete corrections[key]
    else corrections[key] = value
    onChange({ ...row, corrections, useSource: row.useSource?.filter((k) => k !== key) })
  }
  const required: ReferenceField[] = [
    'viewpoint',
    'source',
    'page',
    'landform',
    'method',
    'numerator',
    'denominator',
    'percent',
    'unit',
    'rating',
  ]
  const panel = (id: RowTab, content: ReactNode) => (
    <div
      role="tabpanel"
      id={`${ID_PREFIX}-panel-${id}`}
      aria-labelledby={`${ID_PREFIX}-tab-${id}`}
      hidden={tab !== id}
      className="space-y-4"
    >
      {visited.has(id) && content}
    </div>
  )
  return (
    <>
      {panel(
        'measurements',
        <>
          <div className="grid gap-4 rounded-md border p-3 sm:grid-cols-3">
            <div>
              <h3 className="text-xs text-muted-foreground">Printed result</h3>
              <p className="font-medium">
                {row.printed.percent ? row.printed.percent + '%' : 'No percentage recorded'}
              </p>
              <p>{row.printed.finalDetermination ?? row.printed.rating}</p>
            </div>
            <div>
              <h3 className="text-xs text-muted-foreground">Source arithmetic</h3>
              <Arithmetic values={row.printed} printed />
            </div>
            <div>
              <h3 className="text-xs text-muted-foreground">Reviewer arithmetic</h3>
              {Object.keys(row.corrections).length ? <Arithmetic values={values} /> : <p>No corrections entered.</p>}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <h3 className="font-medium">Inputs for this viewpoint</h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              {[
                ['Viewpoint', views.find((view) => view.id === row.viewId)?.name || 'Choose a workspace viewpoint'],
                [
                  'Landform',
                  landforms.find((form) => form.id === row.landformId)?.name || 'Choose or adopt an outline',
                ],
                ['Study-date proposal', values.proposal || 'Choose the boundary for the study date'],
                ['Exclusions', values.exclusions || 'Review denominator deductions'],
                ['Reference image', values.referenceImage || 'Choose an image for registration'],
                [
                  'Saved PGMaps figures',
                  String(captures.filter((c) => c.viewId === row.viewId && c.landformId === row.landformId).length),
                ],
              ].map(([label, status]) => (
                <div className="contents" key={label}>
                  <dt>{label}</dt>
                  <dd className="break-words">{status}</dd>
                </div>
              ))}
            </dl>
          </div>
          {files.length === 1 ? (
            <AttachmentPreview file={files[0]} page={values.page} />
          ) : (
            <p>
              {files.length
                ? 'Several attachments have this source name.'
                : 'Original sheet unavailable in project attachments.'}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['viewId', 'Workspace viewpoint', views],
                ['landformId', 'Mapped landform', landforms],
              ] as const
            ).map(([key, label, options]) => (
              <label key={key}>
                {label}
                <StyledSelect
                  className={input}
                  value={row[key]}
                  onChange={(e) => onChange({ ...row, [key]: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {row[key] && !options.some((o) => o.id === row[key]) && (
                    <option value={row[key]}>Unavailable ({row[key]})</option>
                  )}
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </StyledSelect>
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="flex items-center gap-1 font-medium">
              Calculation choices
              <InfoTip label="About calculation choices">
                What the reviewer arithmetic divides. Use “Show all fields” below the table for camera, proposal,
                treatment, landform, exclusions and reviewer evidence.
              </InfoTip>
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['numeratorMode', ['Entered numerator', 'Proposed only', 'Proposed and existing']],
                  ['denominatorMode', ['Entered denominator', 'Gross area', 'Gross less deduction', 'Listed net area']],
                ] as const
              ).map(([k, opts]) => (
                <label key={k}>
                  {referenceLabels[k]}
                  <StyledSelect
                    className={input}
                    value={values[k] || opts[0]}
                    onChange={(e) => edit(k, e.target.value === opts[0] ? '' : e.target.value)}
                  >
                    {opts.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </StyledSelect>
                </label>
              ))}
            </div>
          </div>
          <EngineeringTable variant="text" rowHeaders className="table-fixed">
            <caption className="sr-only">Reference transcription and reviewer corrections</caption>
            <thead>
              <tr>
                <th className="w-1/4">Measurement</th>
                <th>Transcription</th>
                <th>Reviewer value</th>
              </tr>
            </thead>
            <tbody>
              {fields
                .filter((k) => allFields || required.includes(k) || row.printed[k] || k in row.corrections)
                .map((k) => (
                  <tr key={k} className="border-t align-top">
                    <th scope="row" className="py-2 pr-2 font-normal">
                      {referenceLabels[k]}
                    </th>
                    <td className="whitespace-pre-wrap break-words py-2 pr-2">{row.printed[k] ?? '—'}</td>
                    <td className="py-1">
                      <input
                        key={row.id + '/' + (row.corrections[k] ?? row.printed[k] ?? '')}
                        aria-label={`Reviewer value for ${referenceLabels[k]}`}
                        className={input}
                        list={k === 'source' ? 'reference-source-documents' : undefined}
                        defaultValue={row.corrections[k] ?? row.printed[k] ?? ''}
                        maxLength={12000}
                        onBlur={(e) => {
                          if (e.target.value !== (row.corrections[k] ?? row.printed[k] ?? '')) edit(k, e.target.value)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                        }}
                      />
                      {(k in row.corrections || row.origins?.[k]) && (
                        <input
                          className={input}
                          aria-label={'Evidence for ' + referenceLabels[k]}
                          placeholder="Evidence or reason for override"
                          defaultValue={row.origins?.[k] ?? ''}
                          key={row.id + '/origin/' + k + '/' + (row.origins?.[k] ?? '')}
                          maxLength={12000}
                          onBlur={(e) => {
                            if (e.target.value !== (row.origins?.[k] ?? ''))
                              onChange({ ...row, origins: { ...row.origins, [k]: e.target.value } })
                          }}
                        />
                      )}
                      {k in row.corrections && (
                        <label className="flex gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={!row.useSource?.includes(k)}
                            onChange={(e) =>
                              onChange({
                                ...row,
                                useSource: e.target.checked
                                  ? row.useSource?.filter((f) => f !== k)
                                  : [...(row.useSource ?? []), k],
                              })
                            }
                          />
                          Use reviewer value
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </EngineeringTable>
          <datalist id="reference-source-documents">
            {[...new Set(attachments.map((a) => a.name))].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Button type="button" size="2xs" variant="ghost" onClick={() => setAllFields(!allFields)}>
            {allFields ? 'Hide empty fields' : 'Show all fields'}
          </Button>
        </>,
      )}
      {panel(
        'geometry',
        <ReferenceGeometryPanel
          key={'geometry/' + row.id}
          row={row}
          attachments={attachments}
          actions={geometry}
          onChange={onChange}
        />,
      )}
      {panel(
        'trace',
        <ReferenceRegistration
          row={row}
          attachments={attachments}
          inputs={photoInputs}
          actions={geometry}
          onChange={onChange}
        />,
      )}
      {panel(
        'run',
        <ReferenceRunPanel
          key={['run', row.id, row.viewId, row.landformId].join('/')}
          row={row}
          attachments={attachments}
          actions={runActions}
        />,
      )}
      {panel(
        'compare',
        <ReferenceComparisonPanel
          key={['comparison', row.id, row.viewId, row.landformId].join('/')}
          row={row}
          captures={captures}
          attachments={attachments}
          onChange={onChange}
        />,
      )}
      {panel('exhibits', <ReferenceExhibits attachments={attachments} rows={rows} />)}
    </>
  )
}

/**
 * Reviewing a historical VIA against its own sheets (`referenceMeasurements.ts`, doc section **Reviewing a historical
 * VIA**). Opened from Project attachments, beside the case.json and sheets it reads. The case's actions sit in the
 * dialog's header; each row's work is a tab.
 */
export function ReferenceMeasurements(props: Props) {
  const { rows, open, onOpenChange } = props
  const [selected, setSelected] = useState('')
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<RowTab>('measurements')
  const [visited, setVisited] = useState<ReadonlySet<RowTab>>(() => new Set<RowTab>(['measurements']))
  const row = rows.find((r) => r.id === selected) ?? rows[0]
  const attachedCase = props.attachments.find((a) => /^case\.json$/i.test(a.name))
  const hasExhibits = props.attachments.some((f) => f.name === 'Figure catalogue.json')
  const tabs = ROW_TABS.filter((t) => t.value !== 'exhibits' || hasExhibits)
  const shownTab = tabs.some((t) => t.value === tab) ? tab : 'measurements'
  const chooseTab = (next: RowTab) => {
    setTab(next)
    setVisited((current) => (current.has(next) ? current : new Set(current).add(next)))
  }
  const importCase = async (file: Blob) => {
    try {
      setMessage(await props.onImport(file))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }
  const rowLabel = (r: ReferenceRow) =>
    [
      chosenValues(r).viewpoint || 'Reviewer measurement',
      chosenValues(r).landform,
      chosenValues(r).block,
      chosenValues(r).sheet,
    ]
      .filter(Boolean)
      .join(' · ')
  return (
    <PanelDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Reference measurements"
      subtitle="Review a historical VIA against its own sheets: its transcribed figures, your corrections, and a run of the same view."
      contentProps={{ 'data-testid': 'reference-measurements-dialog' }}
      toolbar={
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {rows.length > 0 && (
              <StyledSelect
                className={input + ' w-auto min-w-[12rem] flex-1'}
                aria-label="Viewpoint and landform"
                value={row?.id ?? ''}
                onChange={(e) => setSelected(e.target.value)}
              >
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {rowLabel(r)}
                  </option>
                ))}
              </StyledSelect>
            )}
            <FileButton
              label="Import reference measurements from case JSON"
              accept=".json,application/json"
              variant="outline"
              onFiles={([file]) => void importCase(file)}
            >
              <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
              Import case.json…
            </FileButton>
            {!row && attachedCase && (
              <Button type="button" variant="outline" size="sm" onClick={() => void importCase(attachedCase.blob)}>
                Read attached case.json
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => setSelected(props.onAdd())}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add measurement
            </Button>
          </div>
          {row && (
            <TabBar<RowTab>
              label="Reference row"
              idPrefix={ID_PREFIX}
              value={shownTab}
              onChange={chooseTab}
              options={tabs.map((t) =>
                t.value === 'compare' && row.comparisons?.length ? { ...t, badge: String(row.comparisons.length) } : t,
              )}
            />
          )}
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        {message && <p role="status">{message}</p>}
        {row ? (
          <RowReview key={row.id} row={row} tab={shownTab} visited={visited} {...props} />
        ) : (
          <>
            <EmptyHint>
              No measurements yet. Import the case.json transcribed from a historical VIA
              {attachedCase ? ', read the one attached to this project,' : ''} or add a measurement by hand.
            </EmptyHint>
            {hasExhibits && (
              <section className="space-y-2">
                <h3 className="font-medium">Study exhibits</h3>
                <ReferenceExhibits attachments={props.attachments} rows={rows} />
              </section>
            )}
          </>
        )}
      </div>
    </PanelDialog>
  )
}
