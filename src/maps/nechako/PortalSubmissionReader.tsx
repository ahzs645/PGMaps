import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { ExternalLink } from '@/components/ui/text-button'
import { downloadText } from '@/lib/download'
import { errorText, NECHAKO_PORTAL, portalRead } from '@/lib/nechakoPortal'
import { collectionSourceUrl, parseCollectionFiles } from './data/portalCollections'
import {
  fieldLinks,
  parseReviewForm,
  reviewObject,
  reviewText,
  unwrapReview,
  type ReviewForm,
} from './data/submissionReview'

function sourceFieldLink(source: string, allowHttpLinks: boolean) {
  const url = new URL(source, NECHAKO_PORTAL)
  return allowHttpLinks && url.protocol === 'http:' && !url.username && !url.password
    ? url.href
    : collectionSourceUrl(url.href)
}
export function SourceFieldValue({
  label,
  type,
  value,
  showImages = true,
  allowHttpLinks = false,
}: {
  label: string
  type?: string
  value: unknown
  showImages?: boolean
  allowHttpLinks?: boolean
}) {
  const parsed = useMemo(() => {
    if (type !== 'htmleditor' || typeof value !== 'string') return undefined
    const doc = new DOMParser().parseFromString(value, 'text/html')
    doc.querySelectorAll('script,style,iframe,object,embed').forEach((node) => node.remove())
    doc.querySelectorAll('p,li,h1,h2,h3,br').forEach((node) => node.append('\n'))
    const images = (showImages ? Array.from(doc.querySelectorAll('img[src]')) : []).flatMap((image) => {
      const source = image.getAttribute('src') || ''
      let src: string | undefined
      try {
        src =
          /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(source) && source.length <= 20 * 1024 * 1024
            ? source
            : collectionSourceUrl(new URL(source, NECHAKO_PORTAL).href)
      } catch {
        return []
      }
      return src ? [{ src, alt: image.getAttribute('alt') || label }] : []
    })
    const links = Array.from(doc.querySelectorAll('a[href]')).flatMap((anchor) => {
      let href: string | undefined
      try {
        href = sourceFieldLink(anchor.getAttribute('href') || '', allowHttpLinks)
      } catch {
        return []
      }
      return href ? [href] : []
    })
    return { text: doc.body.textContent || '', images, links }
  }, [label, type, value, showImages, allowHttpLinks])
  const plainValue = parsed?.text ?? value
  const httpLinks =
    allowHttpLinks && typeof plainValue === 'string'
      ? (plainValue.match(/http:\/\/[^\s<>"'\\]+/g) ?? []).flatMap((candidate) => {
          try {
            return sourceFieldLink(candidate, allowHttpLinks) ?? []
          } catch {
            return []
          }
        })
      : []
  const links = /download/i.test(label)
    ? []
    : [...new Set([...(parsed?.links ?? []), ...fieldLinks(label, plainValue), ...httpLinks])]
  return (
    <div className="space-y-2">
      <div className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">
        {parsed?.text ?? reviewText(value)}
      </div>
      {parsed?.images.map((image, index) => (
        <img
          key={index}
          src={image.src}
          alt={image.alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="max-h-96 max-w-full rounded border object-contain"
        />
      ))}
      {links.map((url) => (
        <ExternalLink key={url} href={url} className="block break-all">
          {url}
        </ExternalLink>
      ))}
    </div>
  )
}

/** Source-key display supports native resource tables without guessing a schema. */
export function PortalSubmissionReader({
  data,
  onOpenSubmission,
}: {
  data: unknown
  onOpenSubmission?: (id: string) => void
}) {
  const [page, setPage] = useState(0)
  let value: unknown
  try {
    value = unwrapReview(data)
  } catch (reason) {
    return <InlineAlert tone="error">{errorText(reason)}</InlineAlert>
  }
  if (
    reviewObject(value) &&
    value.schema === 'nechako-submission-read-v1' &&
    value.form &&
    reviewObject(value.values)
  ) {
    let form: ReviewForm
    try {
      form = parseReviewForm(value.form)
    } catch (reason) {
      return <InlineAlert tone="error">{errorText(reason)}</InlineAlert>
    }
    const fields = value.values
    return (
      <div className="space-y-3">
        <p className="text-sm">
          Imported source submission {String(value.submissionId ?? 'ID not supplied')} · {form.title}
        </p>
        {form.fields.map((field) => {
          const returned = fields[field.id]
          return (
            <section key={field.id} className="space-y-2 rounded border p-3">
              <h4 className="font-medium">{field.label}</h4>
              {reviewObject(returned) && returned.error ? (
                <InlineAlert tone="error">{String(returned.error)}</InlineAlert>
              ) : (
                <SourceFieldValue
                  label={field.label}
                  type={field.type}
                  value={reviewObject(returned) ? returned.value : undefined}
                />
              )}
            </section>
          )
        })}
      </div>
    )
  }
  const rows = Array.isArray(value) ? value : [value]
  const pages = Math.max(1, Math.ceil(rows.length / 20)),
    current = Math.min(page, pages - 1)
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {rows.length} returned source {rows.length === 1 ? 'record' : 'records'}. Source keys and missing values are
        retained.
      </p>
      {rows.slice(current * 20, (current + 1) * 20).map((row, index) => (
        <div key={index} className="space-y-3 rounded border p-3">
          {reviewObject(row) ? (
            <>
              <KeyValueRows
                variant="grid"
                size="sm"
                rows={Object.entries(row)
                  .filter(([, field]) => field === null || typeof field !== 'object')
                  .map(([label, field]) => ({ label, value: <SourceFieldValue label={label} value={field} /> }))}
                labelClassName="break-words"
              />
              {Object.entries(row)
                .filter(([, field]) => !!field && typeof field === 'object')
                .map(([label, field]) => (
                  <details key={label}>
                    <summary className="cursor-pointer text-sm font-medium">{label}</summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
                      {JSON.stringify(field, null, 2)}
                    </pre>
                  </details>
                ))}
              {onOpenSubmission && /^\d+$/.test(String(row.submission_id ?? row.sub_id ?? '')) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenSubmission(String(row.submission_id ?? row.sub_id))}
                >
                  Open related submission {String(row.submission_id ?? row.sub_id)}
                </Button>
              )}
              {onOpenSubmission && /^[1-9]\d*$/.test(String(row.parent_id ?? '')) && (
                <Button size="sm" variant="outline" onClick={() => onOpenSubmission(String(row.parent_id))}>
                  Open parent submission {String(row.parent_id)}
                </Button>
              )}
              {Boolean(row.download) && (
                <p className="text-xs text-muted-foreground">
                  The source download reference requires its original authorized portal workflow; it is not fetched as
                  an invented GET link.
                </p>
              )}
            </>
          ) : (
            <SourceFieldValue label="Returned value" value={row} />
          )}
        </div>
      ))}
      {!rows.length && <InlineAlert>The source returned an empty collection.</InlineAlert>}
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!current} onClick={() => setPage(current - 1)}>
            Previous resources
          </Button>
          <span className="text-sm">
            Page {current + 1} of {pages}
          </span>
          <Button size="sm" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
            Next resources
          </Button>
        </div>
      )}
    </div>
  )
}

export function NativeSubmissionForm({
  submissionId,
  onMonitoring,
}: {
  submissionId: string
  onMonitoring?: (context: { submissionId: string; formId: string }) => void
}) {
  const [form, setForm] = useState<ReviewForm>()
  const [values, setValues] = useState<Record<string, { value?: unknown; error?: string }>>({})
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  const request = useRef<AbortController>()
  useEffect(() => () => request.current?.abort(), [submissionId])
  const load = async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    setForm(undefined)
    setValues({})
    try {
      const id = await portalRead('rest/portal/getSubmissionForm.php', { submissionId }, controller.signal)
      if (!/^\d+$/.test(String(id))) throw new Error('The source returned an invalid form ID.')
      const original = await portalRead('rest/portal/getForm.php', { id: String(id) }, controller.signal)
      const parsed = { ...parseReviewForm(original), id: String(id) }
      if (controller.signal.aborted) return
      setForm(parsed)
      const returned: typeof values = {}
      for (let start = 0; start < parsed.fields.length; start += 4) {
        await Promise.all(
          parsed.fields.slice(start, start + 4).map(async (field, offset) => {
            try {
              returned[field.id] = {
                value: await portalRead(
                  'rest/portal/getFieldValue.php',
                  { submissionId, fieldId: field.id, fieldIndex: String(start + offset) },
                  controller.signal,
                ),
              }
            } catch (reason) {
              if (!controller.signal.aborted) returned[field.id] = { error: errorText(reason) }
            }
          }),
        )
        if (controller.signal.aborted) return
        setValues({ ...returned })
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorText(reason))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  return (
    <div className="space-y-3 rounded border p-3">
      <h4 className="font-semibold">Source form content</h4>
      <p className="text-xs text-muted-foreground">
        Reads the existing submission’s form and each dynamic value. This does not open a new submission, create a draft
        or save changes. Static workflow nodes remain in the original portal.
      </p>
      <Button size="sm" disabled={loading} onClick={() => void load()}>
        {loading ? 'Reading source form…' : 'Load source form preview'}
      </Button>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {form && (
        <>
          <p className="text-sm">
            Form {form.id}: {form.title} · {form.fields.length} dynamic fields
          </p>
          {form.fields.map((field) => (
            <section key={field.id} className="space-y-1 rounded border p-3">
              <h5 className="font-medium">{field.label}</h5>
              <p className="text-xs text-muted-foreground">
                Source field {field.id} · {field.type}
              </p>
              {values[field.id]?.error ? (
                <InlineAlert tone="error">{values[field.id].error}</InlineAlert>
              ) : values[field.id] ? (
                <SourceFieldValue label={field.label} type={field.type} value={values[field.id].value} />
              ) : (
                <InlineAlert loading>Waiting for source value…</InlineAlert>
              )}
            </section>
          ))}
          {!!form.staticNodes.length && (
            <p className="text-xs text-muted-foreground">
              Original workflow nodes: {form.staticNodes.join(', ')}. Their resources are available through the
              independent sections below; editing remains in the source portal.
            </p>
          )}
          {onMonitoring && form.staticNodes.some((node) => /monitoring|shapefile/i.test(node)) && (
            <Button size="sm" variant="outline" onClick={() => onMonitoring({ submissionId, formId: form.id })}>
              Check related source monitoring
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadText(
                JSON.stringify(
                  { schema: 'nechako-submission-read-v1', submissionId, form: form.original, values },
                  null,
                  2,
                ),
                `submission-${submissionId}-read.json`,
                'application/json',
              )
            }
          >
            Export source form and returned values
          </Button>
        </>
      )}
    </div>
  )
}

export async function checkedReviewJson(file: File): Promise<unknown> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Review at most 20 MiB of JSON.')
  const text = await file.text()
  parseCollectionFiles(text, file.name)
  return JSON.parse(text)
}
