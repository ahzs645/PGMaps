import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, SelectField } from '@/components/ui/form-field'
import { acceptedReferenceStation } from './referenceProjection'
import { chosenValues, type ReferenceRow } from './referenceMeasurements'
import type { ProjectAttachment } from './projectArchive'
import { DIAGNOSTIC_LABEL, runFigures, withheldText } from './runFigures'
import type { AnalysisInput, AnalysisWorkerRequest, AnalysisWorkerResponse } from './types'

/** A retained run's archive: its inputs, the terrain and inventory it read, its figures and their checksums. */
export type SightlineArchive = { name: string; rowId: string; blob: Blob }

export type ReferenceRunActions = {
  input: (row: ReferenceRow) => AnalysisInput
  /**
   * Keeps the archive for this session, for Save & export's *Sightline replay archive*. Never a project
   * attachment: the project never holds terrain, an inventory or the run.
   */
  retain: (archive: SightlineArchive) => void
  /** The archive retained this session, if any. */
  retained: SightlineArchive | null
  /** Opens Save & export on the archive's output. */
  onSaveArchive?: () => void
}

const STATION_OPTIONS = [
  { value: 'workspace', label: 'Linked workspace viewpoint' },
  { value: 'registered', label: 'Confirmed sheet camera station' },
]

export function ReferenceRunPanel({
  row,
  attachments,
  actions,
}: {
  row: ReferenceRow
  attachments: ProjectAttachment[]
  actions: ReferenceRunActions
}) {
  const worker = useRef<Worker | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [selected, setSelected] = useState(''),
    [chosen, setChosen] = useState<File | null>(null)
  useEffect(() => () => worker.current?.terminate(), [])
  const values = chosenValues(row)
  const station = acceptedReferenceStation(values)
  const [stationMode, setStationMode] = useState('workspace')
  const [year, setYear] = useState('')
  // What can be replayed: this session's run, an archive chosen from disk, and any an older project attached.
  const archives: Array<{ key: string; label: string; blob: Blob }> = [
    ...(actions.retained
      ? [{ key: 'retained', label: `${actions.retained.name} (this session)`, blob: actions.retained.blob }]
      : []),
    ...(chosen ? [{ key: 'chosen', label: `${chosen.name} (chosen file)`, blob: chosen as Blob }] : []),
    ...attachments
      .filter((f) => f.name.endsWith('.sightline.zip'))
      .map((f, i) => ({ key: `attached:${i}`, label: `${f.name} (attached to an earlier project)`, blob: f.blob })),
  ]
  const replayFrom = archives.find((a) => a.key === selected) ?? null
  const run = (replay: boolean) => {
    setMessage('')
    try {
      const runInput = () => {
        const input = actions.input(row)
        if (stationMode === 'registered') {
          if (!station) throw Error('Confirm the sheet camera before using its station.')
          input.viewpoint = {
            mode: 'spot',
            coordinates: [[station.lng, station.lat]],
            eyeElevationMeters: station.elevationMeters,
          }
        }
        if (year) {
          if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 2200)
            throw Error('Use an assessment year from 1900 to 2200.')
          input.assessmentYear = Number(year)
        }
        return input
      }
      if (replay && !replayFrom) throw Error('Choose an archive to replay.')
      const request: AnalysisWorkerRequest = replay
        ? { type: 'replay', requestId: 1, archive: replayFrom!.blob }
        : {
            type: 'analyze',
            requestId: 1,
            input: runInput(),
            retainFor: {
              rowId: row.id,
              viewId: row.viewId,
              landformId: row.landformId,
              selected: values,
              origins: row.origins,
              stationMode,
            },
          }
      worker.current?.terminate()
      const w = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
      worker.current = w
      setBusy(true)
      const finish = (note: string) => {
        w.terminate()
        worker.current = null
        setBusy(false)
        setMessage(note)
      }
      w.onerror = (e) => finish(e.message || 'Run worker stopped.')
      w.onmessage = (e: MessageEvent<AnalysisWorkerResponse>) => {
        const m = e.data
        if (m.type === 'error') finish(m.message)
        if (m.type === 'progress')
          setMessage(m.progress.phase + ' · ' + m.progress.completed + ' / ' + m.progress.total)
        if (m.type === 'result') {
          const name = 'Run ' + new Date().toISOString().replace(/:/g, '-') + '.sightline.zip'
          if (m.archive) {
            actions.retain({ name, rowId: row.id, blob: new Blob([m.archive], { type: 'application/zip' }) })
            setSelected('retained')
          }
          // A provisional run's figure is a reference diagnostic, and says so (`runFigures`).
          const figures = runFigures(m.result)
          const value = figures.diagnostic.perspective?.cumulativePercent
          const result =
            value == null
              ? 'Perspective result unavailable.'
              : 'Perspective sightline alteration ' +
                Number(value.toFixed(3)) +
                '%' +
                (figures.state === 'ready'
                  ? '.'
                  : ' (' + DIAGNOSTIC_LABEL.toLowerCase() + '). ' + withheldText(figures))
          const evidence = m.archive
            ? 'Retained ' + name + ' for this session. Save it from Save & export → Sightline replay archive.'
            : m.replayMatches
              ? 'Replayed the saved numerical results.'
              : 'Replayed figures differ from the saved run.'
          finish(
            [
              evidence,
              result,
              ...(m.result.quality?.warnings ?? []),
              ...(m.replayRowId && m.replayRowId !== row.id ? ['Archive belongs to ' + m.replayRowId + '.'] : []),
            ].join(' '),
          )
        }
      }
      w.postMessage(request)
    } catch (e) {
      worker.current?.terminate()
      worker.current = null
      setBusy(false)
      setMessage(String(e))
    }
  }
  return (
    <section className="space-y-2" aria-label="Numerical run and offline replay">
      <p className="text-muted-foreground">
        Run this linked viewpoint and landform with the current design and settings. The run is retained for this
        session with its numerical inputs, sampled inventory geometry, terrain cells and checksums; save it from Save
        &amp; export. The project never holds terrain or inventory.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField
          label="Sightline station"
          className={FORM_INPUT_CLASS}
          value={stationMode}
          onValueChange={(value) => setStationMode(value === 'registered' && !station ? 'workspace' : value)}
        >
          {STATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value} disabled={option.value === 'registered' && !station}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <label className="grid gap-1">
          Assessment year override
          <input
            className={FORM_INPUT_CLASS}
            type="number"
            placeholder="Use scene year"
            min={1900}
            max={2200}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy || !row.viewId || !row.landformId} onClick={() => run(false)}>
          Run and retain inputs
        </Button>
        {actions.retained && actions.onSaveArchive && (
          <Button type="button" size="sm" variant="outline" onClick={actions.onSaveArchive}>
            Save the archive…
          </Button>
        )}
      </div>
      <SelectField
        label="Archive to replay"
        className={FORM_INPUT_CLASS}
        value={selected}
        placeholder={archives.length ? 'Choose an archive' : 'None yet: run and retain, or choose a file'}
        disabled={!archives.length}
        onValueChange={setSelected}
      >
        {archives.map((a) => (
          <option key={a.key} value={a.key}>
            {a.label}
          </option>
        ))}
      </SelectField>
      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setChosen(file)
          setSelected('chosen')
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
          Choose an archive file…
        </Button>
        <Button type="button" size="sm" disabled={busy || !replayFrom} onClick={() => run(true)}>
          Replay from retained inputs
        </Button>
        {busy && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              worker.current?.terminate()
              worker.current = null
              setBusy(false)
              setMessage('Run cancelled.')
            }}
          >
            Cancel run
          </Button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
