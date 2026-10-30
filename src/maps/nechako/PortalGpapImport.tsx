import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadBlob, downloadText } from '@/lib/download'
import { errorText } from '@/lib/nechakoPortal'
import { PortalDraftReview } from './PortalDraftReview'
import { readGpap, gpapLayers, gpapNoteRows, gpapReviewJson, type GpapProject } from './data/geopaparazzi'
import { gpapLocalRecords, gpapConflicts, type GpapImportConflict } from './data/localIngestion'
import { importLocalWorkbench, listLocalWorkbench, type LocalWorkbenchRecord } from './data/localWorkbench'
import type { VectorData } from './data/workspace'

export function PortalGpapImport({ onVectors }: { onVectors: (layers: VectorData[]) => void }) {
  const [file, setFile] = useState<File>()
  const [project, setProject] = useState<GpapProject>()
  const [selected, setSelected] = useState<number[]>([])
  const [group, setGroup] = useState('')
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [plan, setPlan] = useState<{
    records: LocalWorkbenchRecord[]
    conflicts: GpapImportConflict[]
    issues: number
  }>()
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  const groups = useMemo(() => [...new Set(project?.notes.map((note) => note.formName) ?? [])], [project])
  const visible = useMemo(
    () =>
      (project?.notes ?? [])
        .map((note, index) => ({ note, index }))
        .filter(({ note }) => !group || note.formName === group),
    [project, group],
  )
  const pages = Math.max(1, Math.ceil(visible.length / 25)),
    current = Math.min(page, pages - 1)
  const changed = () => {
    setPlan(undefined)
    setAcknowledged(false)
    setNotice('')
  }
  const read = async (next: File) => {
    const token = ++generation.current
    setFile(next)
    setProject(undefined)
    setBusy(true)
    setError('')
    changed()
    try {
      const value = await readGpap(next)
      if (token !== generation.current) return
      setProject(value)
      setSelected(value.notes.map((_, index) => index))
      setPage(0)
      setGroup('')
    } catch (reason) {
      if (token === generation.current) setError(errorText(reason))
    } finally {
      if (token === generation.current) setBusy(false)
    }
  }
  const reviewSave = async () => {
    if (!project || !file) return
    const token = generation.current
    setBusy(true)
    setError('')
    setNotice('')
    setPlan(undefined)
    try {
      const [records, existing] = await Promise.all([gpapLocalRecords(project, file, selected), listLocalWorkbench()])
      if (token !== generation.current) return
      if (existing.some((item) => item.id === `gpap:${project.sha256}`))
        throw new Error(
          'This exact GPAP file is already cached. Open its saved items in the local workbench; it has not been imported twice.',
        )
      setPlan({ records, conflicts: gpapConflicts(records, existing), issues: project.issues.length })
      setAcknowledged(false)
    } catch (reason) {
      if (token === generation.current) setError(errorText(reason))
    } finally {
      if (token === generation.current) setBusy(false)
    }
  }
  const save = async () => {
    if (!plan || ((plan.conflicts.length || plan.issues) && !acknowledged)) return
    setBusy(true)
    setError('')
    try {
      const count = await importLocalWorkbench(plan.records)
      setNotice(
        `Saved ${count} local items, including the unchanged GPAP database, selected note drafts, all extracted media and map layers. No source records were published.`,
      )
      setPlan(undefined)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="gpap-import-title">
      <h3 id="gpap-import-title" className="font-semibold">
        Geopaparazzi / SMASH project import
      </h3>
      <p className="text-sm text-muted-foreground">
        Read a .gpap SQLite project in this browser. Review notes and form fields, extract original image bytes, and
        keep GPS log relationships. Choose local note drafts to save; the original database, all parsed records and
        original/filtered tracks remain available. Nothing is sent to a portal.
      </p>
      <label className="block text-sm">
        GPAP project (up to 50 MiB)
        <input
          aria-label="GPAP project file"
          type="file"
          accept=".gpap"
          disabled={busy}
          className="mt-1 block max-w-full"
          onChange={(event) => {
            const value = event.target.files?.[0]
            if (value) void read(value)
          }}
        />
      </label>
      {busy && <InlineAlert loading>Reading or saving the local project…</InlineAlert>}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && <InlineAlert tone="success">{notice}</InlineAlert>}
      {project && (
        <>
          <p className="text-sm">
            {project.notes.length} notes · {project.images.length} images · {project.tracks.length} GPS logs ·{' '}
            {project.relationships.length} explicit relationships · {project.issues.length} review issues
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => file && downloadBlob(file, file.name)}>
              Download original GPAP
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadText(JSON.stringify(gpapReviewJson(project), null, 2), 'gpap-review.json', 'application/json')
              }
            >
              Download complete GPAP review
            </Button>
            <Button
              size="sm"
              onClick={() =>
                onVectors(
                  gpapLayers(project).map((layer) => ({
                    id: crypto.randomUUID(),
                    name: layer.name,
                    data: layer.data,
                    color: '#0f766e',
                    visible: true,
                    original: { sourcePackage: project.name, sha256: project.sha256 },
                  })),
                )
              }
            >
              Add GPAP layers to map
            </Button>
          </div>
          <label className="block text-sm">
            Note form group
            <NativeSelect
              aria-label="GPAP form group"
              className="ml-2 max-w-full rounded border bg-background p-2"
              value={group}
              onChange={(event) => {
                setGroup(event.target.value)
                setPage(0)
              }}
            >
              <option value="">All note groups</option>
              {groups.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </NativeSelect>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSelected([...new Set([...selected, ...visible.map((item) => item.index)])])
                changed()
              }}
            >
              Select this group
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSelected([])
                changed()
              }}
            >
              Clear selected notes
            </Button>
            <span className="text-sm">{selected.length} selected local note drafts</span>
          </div>
          {visible.slice(current * 25, (current + 1) * 25).map(({ note, index }) => (
            <details key={index} className="rounded border p-3">
              <summary className="cursor-pointer text-sm">
                Note {note.id} · {String(note.row.text ?? 'Untitled')} · {note.fields.length} form fields ·{' '}
                {note.imageIds.length} media links · {note.issues.length} issues
              </summary>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`Select GPAP note ${index + 1}`}
                  disabled={busy}
                  checked={selected.includes(index)}
                  onChange={(event) => {
                    setSelected((old) => (event.target.checked ? [...old, index] : old.filter((id) => id !== index)))
                    changed()
                  }}
                />
                Save this note as a local draft
              </label>
              {note.issues.map((message, index) => (
                <InlineAlert key={index} tone="warning">
                  {message}
                </InlineAlert>
              ))}
              <div className="mt-2 flex flex-wrap gap-2">
                {project.images
                  .filter((image) => note.imageIds.includes(image.id) && image.bytes)
                  .map((image, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        downloadBlob(new Blob([new Uint8Array(image.bytes!)], { type: image.mime }), image.filename)
                      }
                    >
                      Download image {image.id}
                    </Button>
                  ))}
              </div>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(
                  { original: note.row, fields: note.fields, images: note.imageIds, extension: note.extension },
                  null,
                  2,
                )}
              </pre>
            </details>
          ))}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!current} onClick={() => setPage(current - 1)}>
              Previous GPAP notes
            </Button>
            <span className="text-sm">
              Page {current + 1} of {pages}
            </span>
            <Button size="sm" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
              Next GPAP notes
            </Button>
          </div>
          {group && !!visible.length && (
            <details className="rounded border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Match {group} fields to a local or source schema
              </summary>
              <PortalDraftReview
                key={group}
                sourceName={`${project.name}: ${group}`}
                rows={gpapNoteRows(visible.map((item) => item.note))}
                geometry={{ type: 'FeatureCollection', features: visible.map((item) => item.note.feature) }}
              />
            </details>
          )}
          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm">
              Tables, relationships and review issues ({project.issues.length})
            </summary>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(
                {
                  tables: project.tables,
                  metadata: project.metadata,
                  issues: project.issues,
                  orphanTrackPoints: project.orphanTrackPoints,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <Button disabled={busy} onClick={() => void reviewSave()}>
            Review GPAP local save
          </Button>
          {plan && (
            <div className="space-y-3 rounded border p-3">
              <p className="text-sm">
                {plan.records.length} local items ready. {plan.conflicts.length} duplicate/conflict candidates with
                cached note drafts. Existing records will remain unchanged; this import keeps distinct versions.
              </p>
              {!!plan.conflicts.length && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(plan.conflicts, null, 2)}
                </pre>
              )}
              {!!(plan.conflicts.length || plan.issues) && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    aria-label="Acknowledge GPAP import issues"
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  I reviewed the issues and duplicate candidates and want to retain these local versions with their
                  original references.
                </label>
              )}
              <Button
                disabled={busy || (!!(plan.conflicts.length || plan.issues) && !acknowledged)}
                onClick={() => void save()}
              >
                Save GPAP to browser cache
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Unknown tables and unsupported form widgets remain in the original GPAP file. Local draft edits do not
            rewrite that database or imply native SMASH synchronization. Note-to-track relationships are not guessed
            from timestamps or distance.
          </p>
        </>
      )}
    </section>
  )
}
