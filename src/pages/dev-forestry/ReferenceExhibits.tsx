import { useEffect, useState } from 'react'
import { StyledSelect } from '@/components/ui/styled-select'
import type { ProjectAttachment } from './projectArchive'
import { AttachmentPreview } from './ProjectAttachments'
import { FORM_INPUT_CLASS } from '@/components/ui/form-field'
import { type ReferenceRow } from './referenceMeasurements'

type Exhibit = {
  id: string
  kind: string
  source: string
  page: string
  date: string
  caption: string
  viewpoint: string
}
export function ReferenceExhibits({ attachments, rows }: { attachments: ProjectAttachment[]; rows: ReferenceRow[] }) {
  const catalog = attachments.find((f) => f.name === 'Figure catalogue.json')
  // Mounted only once its tab has been shown, so the catalogue is read only when asked for.
  const [list, setList] = useState<Exhibit[]>([]),
    [filter, setFilter] = useState(''),
    [selected, setSelected] = useState(''),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    if (catalog)
      void (async () => {
        if (catalog.blob.size > 8 * 1024 * 1024) throw Error('Figure catalogue exceeds 8 MiB.')
        const raw: unknown = JSON.parse(await catalog.blob.text())
        if (!Array.isArray(raw) || raw.length > 10000) throw Error('Invalid figure catalogue.')
        if (active)
          setList(
            raw.flatMap((e) =>
              e && typeof e.id === 'string'
                ? [
                    {
                      id: e.id,
                      kind: String(e.kind ?? ''),
                      caption: String(e.caption ?? ''),
                      source: String(e.source ?? ''),
                      page: String(e.page ?? ''),
                      date: String(e.date ?? ''),
                      viewpoint: String(e.viewpoint ?? ''),
                    },
                  ]
                : [],
            ),
          )
      })().catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [catalog])
  if (!catalog) return null
  const entries = list
    .map((e) => {
      const matches = rows.filter((r) => r.printed.source === e.source && e.page && r.printed.page === e.page)
      return {
        ...e,
        viewpoint: [
          ...new Set(
            [e.viewpoint, ...matches.map((r) => r.printed.viewpointName || r.printed.viewpoint)].filter(Boolean),
          ),
        ].join(', '),
        studyDate: rows.find((r) => r.printed.source === e.source && r.printed.studyDate)?.printed.studyDate,
      }
    })
    .filter((e) => Object.values(e).join(' ').toLowerCase().includes(filter.toLowerCase()))
  const item = entries.find((e) => e.id === selected)
  const figure = item ? attachments.find((a) => a.name.startsWith('Figure ' + item.id + ' -')) : null
  const original = item ? attachments.find((a) => a.name === item.source) : null
  return (
    <section className="space-y-2" aria-label="Study exhibits">
      <label className="grid gap-1">
        Search viewpoint, page, date or caption
        <input className={FORM_INPUT_CLASS} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      <label className="grid gap-1">
        Exhibit ({entries.length})
        <StyledSelect
          className={FORM_INPUT_CLASS}
          value={item ? selected : ''}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose an exhibit</option>
          {entries.map((e) => (
            <option key={e.id} value={e.id}>
              {[e.viewpoint, e.page ? 'p. ' + e.page : '', e.caption || e.kind].filter(Boolean).join(' · ')}
            </option>
          ))}
        </StyledSelect>
      </label>
      {item && (
        <>
          <p>
            {item.caption} · {item.source}
            {item.page && ' · page ' + item.page}
            {item.date && ' · exhibit date ' + item.date}
            {item.studyDate && ' · study date ' + item.studyDate}
          </p>
          {figure && <AttachmentPreview file={figure} />}{' '}
          {original && original !== figure && <AttachmentPreview file={original} page={item.page} />}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
