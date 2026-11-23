import { useEffect, useRef, useState } from 'react'
import { DownloadCloud, Upload } from 'lucide-react'
import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'
import { Button } from '@/components/ui/button'
import { CheckboxField, SelectField } from '@/components/ui/form-field'
import { FileButton } from '@/components/ui/file-button'
import { InlineAlert } from '@/components/ui/map-panels'
import { TextButton } from '@/components/ui/text-button'
import { ToolSection } from '@/components/ui/tool-section'
import {
  BASELINE_MARGIN_METRES,
  BASELINE_SOURCE_LABELS,
  fromSource,
  type BaselineRead,
  type BaselineSource,
} from '../baselineImport'
import { DISTRICT_CODES, ORDER_UNITS_CATALOGUE, type OrderUnit } from '../orderUnits'
import { replaceBaseline, setArea } from '../edits'
import type { StepProps } from './types'

const ha = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
/** The Board's earlier year: reading from it lets the plan be checked against the published figures. */
const BOARD_YEAR = 2015

type ReadState =
  | { status: 'idle' }
  | { status: 'unit'; progress: string }
  | { status: 'unit-read'; unit: OrderUnit }
  | { status: 'reading'; progress: string }
  | { status: 'done'; result: BaselineRead }
  | { status: 'failed'; error: string }

type WorkerReply = { progress?: string; result?: BaselineRead; unit?: OrderUnit; error?: string }

/**
 * The reporting unit's boundary, read from the order's own polygons on DataBC or loaded from a file,
 * and DataBC's past harvests and fires read round it.
 */
export function DataBcBaseline({ plan, edit, importFiles }: Pick<StepProps, 'plan' | 'edit' | 'importFiles'>) {
  const unit = plan.area.unit
  const [sources, setSources] = useState<BaselineSource[]>(['cutblocks', 'fires'])
  const [read, setRead] = useState<ReadState>({ status: 'idle' })
  const worker = useRef<Worker | null>(null)
  useEffect(() => () => worker.current?.terminate(), [])
  const earliestYear = Math.min(plan.area.startYear, BOARD_YEAR)

  const whole = plan.area.patchExtent !== 'clipped'
  const orderHasUnit = Boolean(DISTRICT_CODES[plan.area.district] && plan.area.ndu)

  function run(ask: object, onReply: (data: WorkerReply) => void) {
    worker.current?.terminate()
    const w = new Worker(new URL('../baseline.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (!data.progress) {
        w.terminate()
        worker.current = null
      }
      onReply(data)
    }
    w.onerror = (e) => {
      w.terminate()
      worker.current = null
      setRead({ status: 'failed', error: e.message || 'The read could not start.' })
    }
    w.postMessage(ask)
  }

  function readUnit() {
    const readOn = new Date().toISOString().slice(0, 10)
    setRead({ status: 'unit', progress: 'Asking DataBC for the order’s units…' })
    run({ kind: 'unit', district: plan.area.district, ndu: plan.area.ndu, readOn }, (data) => {
      if (data.progress) return setRead({ status: 'unit', progress: data.progress })
      if (data.error || !data.unit) return setRead({ status: 'failed', error: data.error ?? 'Nothing came back.' })
      const read = data.unit
      edit((p) => setArea(p, { unit: { source: read.source, geometry: read.geometry } }))
      setRead({ status: 'unit-read', unit: read })
    })
  }

  function start() {
    if (!unit) return
    const readOn = new Date().toISOString().slice(0, 10)
    const marginMetres = whole ? BASELINE_MARGIN_METRES : 0
    setRead({ status: 'reading', progress: 'Asking DataBC…' })
    run({ kind: 'baseline', unit: unit.geometry, sources, earliestYear, readOn, marginMetres }, (data) => {
      if (data.progress) return setRead({ status: 'reading', progress: data.progress })
      if (data.error || !data.result) return setRead({ status: 'failed', error: data.error ?? 'Nothing came back.' })
      const result = data.result
      edit((p) => {
        const next = replaceBaseline(p, (d) => sources.some((s) => fromSource(d, s)), result.disturbances)
        const stated = p.area.source.trim() && !p.area.source.startsWith('Inventory and disturbance history not yet')
        return setArea(next, {
          snapshotDate: result.readOn,
          baselineRead: { fromYear: result.fromYear, marginMetres: result.marginMetres, readOn: result.readOn },
          source: stated
            ? p.area.source
            : `${sources.map((s) => BASELINE_SOURCE_LABELS[s]).join(' and ')}, read ${result.readOn}${
                result.marginMetres ? ` to ${result.marginMetres / 1000} km past` : ', clipped to'
              } ${p.area.unit?.source}.`,
        })
      })
      setRead({ status: 'done', result })
    })
  }
  function cancel() {
    worker.current?.terminate()
    worker.current = null
    setRead({ status: 'idle' })
  }

  const fromDataBc = plan.baseline.filter((d) => fromSource(d, 'cutblocks') || fromSource(d, 'fires')).length
  return (
    <ToolSection
      title="Unit boundary and DataBC"
      help="Objective C is measured over the order's sub-unit within a historic district. DataBC's legal planning objectives layer holds the order's own polygons; read them, or load the boundary your analysis uses. Past harvests (consolidated cutblocks) and fires are then read from DataBC round it. Reading again replaces what an earlier read added; disturbances you drew or imported stay."
      summary={unit ? `${unit.source} · ${fromDataBc.toLocaleString()} from DataBC` : 'No boundary'}
      defaultOpen
    >
      {unit ? (
        <div className="flex items-center justify-between gap-2 text-xs" data-testid="block-planning-unit">
          <span className="min-w-0">
            <span className="font-medium">{unit.source}</span> · {ha.format(blockAreaHa(unit.geometry))} ha
          </span>
          <TextButton onClick={() => edit((p) => setArea(p, { unit: undefined }))}>Remove</TextButton>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!orderHasUnit || read.status === 'unit' || read.status === 'reading'}
            title={orderHasUnit ? undefined : 'Choose the historic forest district and sub-unit first.'}
            onClick={readUnit}
          >
            <DownloadCloud className="size-3.5" />
            Read the order’s unit
          </Button>
          <FileButton
            size="sm"
            variant="outline"
            label="Load a unit boundary"
            accept=".geojson,.json,application/json"
            onFiles={(files) => importFiles('unit', files)}
          >
            <Upload className="size-3.5" />
            Load a boundary
          </FileButton>
        </div>
      )}
      {read.status === 'unit' && <InlineAlert loading>{read.progress}</InlineAlert>}
      {read.status === 'unit-read' && (
        <p className="text-2xs text-muted-foreground" data-testid="block-planning-order-unit">
          {read.unit.polygons.toLocaleString()} polygons of the{' '}
          <a className="underline" href={ORDER_UNITS_CATALOGUE} target="_blank" rel="noreferrer">
            order’s legal layer
          </a>
          {read.unit.unitIdents.length ? `, landscape units ${read.unit.unitIdents.join(', ')}` : ''}.
        </p>
      )}
      {unit && (
        <SelectField
          label="Patches at the boundary"
          value={whole ? 'whole' : 'clipped'}
          onValueChange={(v) => edit((p) => setArea(p, { patchExtent: v === 'clipped' ? 'clipped' : undefined }))}
          hint={
            whole
              ? `A patch is classed by its whole size, read ${BASELINE_MARGIN_METRES / 1000} km past the unit; only its young forest inside is counted.`
              : 'Every patch is cut at the boundary before it is classed.'
          }
        >
          <option value="whole">Whole patches, counted inside</option>
          <option value="clipped">Clipped at the boundary</option>
        </SelectField>
      )}
      <div className="space-y-1">
        {(['cutblocks', 'fires'] as const).map((s) => (
          <CheckboxField
            key={s}
            label={BASELINE_SOURCE_LABELS[s]}
            checked={sources.includes(s)}
            onCheckedChange={(on) => setSources((current) => (on ? [...current, s] : current.filter((x) => x !== s)))}
          />
        ))}
      </div>
      {read.status === 'reading' ? (
        <div className="flex items-center gap-2">
          <InlineAlert loading>{read.progress}</InlineAlert>
          <Button size="sm" variant="outline" onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" disabled={!unit || !sources.length || read.status === 'unit'} onClick={start}>
          <DownloadCloud className="size-3.5" />
          Read past disturbances
        </Button>
      )}
      <p className="text-2xs text-muted-foreground">
        Reads disturbances from {earliestYear - 20} on
        {whole ? `, ${BASELINE_MARGIN_METRES / 1000} km past the unit` : ''}: anything older cannot be young forest in{' '}
        {earliestYear} or later
        {earliestYear === BOARD_YEAR ? ', and 2015 lets the plan be checked against the Board’s figures' : ''}. RESULTS
        openings are not read separately; consolidated cutblocks are built from them.
      </p>
      {read.status === 'failed' && <InlineAlert tone="error">{read.error}</InlineAlert>}
      {read.status === 'done' && (
        <ul className="space-y-0.5 text-xs" data-testid="block-planning-databc-read">
          {(Object.keys(read.result.counts) as BaselineSource[])
            .filter((s) => read.result.counts[s].read > 0 || sources.includes(s))
            .map((s) => {
              const c = read.result.counts[s]
              return (
                <li key={s}>
                  <span className="font-medium">{BASELINE_SOURCE_LABELS[s]}:</span> {c.kept.toLocaleString()} kept of{' '}
                  {c.read.toLocaleString()} read
                  {c.outside ? ` · ${c.outside.toLocaleString()} outside the unit` : ''}
                  {c.noYear ? ` · ${c.noYear.toLocaleString()} without a year, left out` : ''}
                </li>
              )
            })}
          <li className="text-muted-foreground">
            Read {read.result.readOn}, years from {read.result.fromYear}
            {read.result.marginMetres ? `, ${read.result.marginMetres / 1000} km past the unit` : ''}.
          </li>
        </ul>
      )}
    </ToolSection>
  )
}
