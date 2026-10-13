import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadBlob, downloadText } from '@/lib/download'
import { errorText, portalRead } from '@/lib/nechakoPortal'
import { checkedReviewJson, PortalSubmissionReader } from './PortalSubmissionReader'
import {
  formReportCsv,
  formReportHtml,
  formReportRows,
  formReportStatistics,
  parseReviewForm,
  reviewObject,
  type FormReport,
  type ReviewForm,
} from './data/submissionReview'
import { buildFormReportArchive, exportFormReportPdf } from './data/formReportExport'

export function PortalFormReports() {
  const [formId, setFormId] = useState('')
  const [forms, setForms] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState<ReviewForm>()
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [report, setReport] = useState<FormReport>()
  const [title, setTitle] = useState('Source form report')
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  const request = useRef<AbortController>()
  useEffect(() => () => request.current?.abort(), [])
  const run = async (action: 'forms' | 'fields' | 'report') => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    try {
      if (action === 'forms') {
        const data = await portalRead(
          'rest/portal/getForms.php',
          { page: '1', start: '0', limit: '200' },
          controller.signal,
        )
        if (!Array.isArray(data)) throw new Error('The source returned an invalid form list.')
        if (!controller.signal.aborted)
          setForms(
            data.flatMap((row) =>
              reviewObject(row) && row.form_id !== undefined
                ? [{ id: String(row.form_id), name: String(row.form_name ?? row.name ?? row.form_id) }]
                : [],
            ),
          )
      } else {
        if (!/^[1-9]\d*$/.test(formId)) throw new Error('Choose an existing source form ID.')
        if (action === 'fields') {
          const original = await portalRead('rest/portal/getForm.php', { id: formId }, controller.signal)
          const parsed = { ...parseReviewForm(original), id: formId }
          if (!controller.signal.aborted) {
            setForm(parsed)
            setLabels({})
            setReport(undefined)
          }
        } else {
          const mapping = Object.fromEntries(
            Object.entries(labels)
              .filter(([, label]) => label.trim())
              .map(([id, label]) => [id, label.trim()]),
          )
          if (!Object.keys(mapping).length) throw new Error('Name at least one source field in the report.')
          const names = Object.values(mapping)
          if (
            new Set(names).size !== names.length ||
            names.some((name) =>
              ['Submission ID', 'Submitted Time', 'Submission Title', 'Submission Name'].includes(name),
            )
          )
            throw new Error('Report field labels must be unique and distinct from source metadata columns.')
          const data = await portalRead(
            'rest/portal/GetFormStatistics.php',
            { formId, mapping: JSON.stringify(mapping) },
            controller.signal,
          )
          const rows = formReportRows(data)
          if (!controller.signal.aborted)
            setReport({
              title,
              source: 'Original portal GetFormStatistics (current anonymous access)',
              formId,
              mapping,
              rows,
              original: data,
            })
        }
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorText(reason))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  const performExport = async (format: 'pdf' | 'zip') => {
    if (!report) return
    setLoading(true)
    setError('')
    try {
      if (format === 'pdf') await exportFormReportPdf(report)
      else downloadBlob(await buildFormReportArchive(report), 'source-form-review.zip')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h2 className="text-xl font-semibold">Source form reporting</h2>
      <p className="text-sm text-muted-foreground">
        Select genuine dynamic form fields and display names, then read the original GetFormStatistics response. Source
        permissions determine the rows returned. This is separate from monitoring CSV analysis and does not claim
        complete database coverage or portal publishing.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void run('forms')}>
          Read available report forms
        </Button>
        <label className="text-sm">
          Source form{' '}
          <select
            aria-label="Source report form"
            value={formId}
            onChange={(event) => {
              setFormId(event.target.value)
              setForm(undefined)
              setReport(undefined)
              setLabels({})
            }}
            className="ml-2 max-w-full rounded border bg-background p-2"
          >
            <option value="">Choose a returned form</option>
            {forms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.id})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Known form ID{' '}
          <input
            aria-label="Source report form ID"
            inputMode="numeric"
            value={formId}
            onChange={(event) => {
              setFormId(event.target.value)
              setForm(undefined)
              setReport(undefined)
              setLabels({})
            }}
            className="ml-2 w-24 rounded border bg-background p-2"
          />
        </label>
        <Button size="sm" disabled={loading || !formId} onClick={() => void run('fields')}>
          Load report fields
        </Button>
      </div>
      {!!forms.length && (
        <p className="text-xs text-muted-foreground">
          {forms.length} forms returned by the requested source page (limit 200). A known form ID can be loaded
          independently.
        </p>
      )}
      <label className="block text-sm">
        Report title{' '}
        <input
          aria-label="Form report title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-1 block w-full rounded border bg-background p-2"
        />
      </label>
      {loading && <InlineAlert loading>Working with source report data…</InlineAlert>}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {form && (
        <div className="space-y-3">
          <h3 className="font-medium">
            {form.title} · {form.fields.length} source dynamic fields
          </h3>
          <p className="text-xs text-muted-foreground">
            A blank display name leaves that field out. Field IDs remain native; report labels are your chosen
            presentation.
          </p>
          {form.fields.map((field) => (
            <label key={field.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {field.label} ({field.id})
              </span>
              <input
                aria-label={`Report label ${field.label}`}
                value={labels[field.id] ?? ''}
                placeholder={field.label}
                onChange={(event) => {
                  setLabels((old) => ({ ...old, [field.id]: event.target.value }))
                  setReport(undefined)
                }}
                className="max-w-full rounded border bg-background p-2"
              />
            </label>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLabels(Object.fromEntries(form.fields.map((field) => [field.id, field.label])))
              setReport(undefined)
            }}
          >
            Use original field labels
          </Button>
          <Button
            className="ml-2"
            size="sm"
            disabled={loading || !Object.values(labels).some((value) => value.trim())}
            onClick={() => void run('report')}
          >
            Generate source report
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadText(
                  JSON.stringify(
                    {
                      schema: 'nechako-form-report-preset-v1',
                      formId,
                      title,
                      fieldIds: form.fields.map((field) => field.id),
                      mapping: labels,
                    },
                    null,
                    2,
                  ),
                  'form-report-preset.json',
                  'application/json',
                )
              }
            >
              Export report preset
            </Button>
            <label className="text-sm">
              Import report preset{' '}
              <input
                aria-label="Source report preset"
                type="file"
                accept=".json"
                className="block max-w-full"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  try {
                    const preset = await checkedReviewJson(file)
                    if (
                      !reviewObject(preset) ||
                      preset.schema !== 'nechako-form-report-preset-v1' ||
                      preset.formId !== formId ||
                      !reviewObject(preset.mapping) ||
                      Object.entries(preset.mapping).some(
                        ([id, label]) => !form.fields.some((field) => field.id === id) || typeof label !== 'string',
                      )
                    )
                      throw new Error('Preset does not match the loaded source form fields.')
                    setLabels(preset.mapping as Record<string, string>)
                    setTitle(String(preset.title ?? title))
                    setReport(undefined)
                    setError('')
                  } catch (reason) {
                    setError(errorText(reason))
                  }
                }}
              />
            </label>
          </div>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-medium">Review an exported native report response</summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Import the actual GetFormStatistics envelope or attributes object. Source-keyed rows retain their submission
          IDs; this import is not a regenerated portal report.
        </p>
        <input
          aria-label="Exported native form report JSON"
          type="file"
          accept=".json"
          className="mt-2 block max-w-full"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            try {
              const original = await checkedReviewJson(file)
              const rows = formReportRows(original)
              const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter(
                (key) => !['Submission ID', 'Submitted Time', 'Submission Title', 'Submission Name'].includes(key),
              )
              setReport({
                title,
                source: `Imported ${file.name}`,
                formId: formId || 'not supplied',
                mapping: Object.fromEntries(keys.map((key) => [key, key])),
                rows,
                original,
              })
              setError('')
            } catch (reason) {
              setError(errorText(reason))
            }
          }}
        />
      </details>
      {report && (
        <>
          <h3 className="font-semibold">{report.title}</h3>
          <p className="text-sm">
            {report.rows.length.toLocaleString('en-CA')} returned source records · form {report.formId}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadText(formReportCsv(report), 'source-form-report.csv', 'text/csv')}
            >
              Download form report CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadText(formReportHtml(report), 'source-form-report.html', 'text/html')}
            >
              Download form report HTML
            </Button>
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void performExport('pdf')}>
              Download form report PDF
            </Button>
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void performExport('zip')}>
              Download form review ZIP
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            PDF uses raster pages to preserve source characters and is limited to 1,000 records, one million characters
            and 200 pages. HTML/CSV/ZIP retain all returned rows. The ZIP includes this report, CSV, source attributes
            and mapping; it does not contain external attachments or GIS files.
          </p>
          <PortalSubmissionReader key={`${report.formId}:${JSON.stringify(report.mapping)}`} data={report.rows} />
          {formReportStatistics(report) !== undefined && (
            <details className="rounded border p-3">
              <summary className="cursor-pointer font-medium">Source-returned statistics</summary>
              <p className="my-2 text-xs text-muted-foreground">
                The backend returns these values separately from its rows. Native results/count fields are retained as
                supplied and are not redefined as a submission count.
              </p>
              <PortalSubmissionReader data={formReportStatistics(report)} />
            </details>
          )}
        </>
      )}
    </div>
  )
}
