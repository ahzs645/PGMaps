import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadBlob } from '@/lib/download'
import { errorText } from '@/lib/nechakoPortal'
import { attachmentRecord, type LocalAttachmentData } from './data/localIngestion'
import {
  deleteLocalWorkbench,
  importLocalWorkbench,
  saveLocalWorkbench,
  type LocalWorkbenchRecord,
} from './data/localWorkbench'
import { useLocalWorkbenchRecords } from './data/useLocalWorkbench'

export function PortalLocalAttachments() {
  const cache = useLocalWorkbenchRecords('attachment')
  const submissions = useLocalWorkbenchRecords('submission')
  const [file, setFile] = useState<File>()
  const [selected, setSelected] = useState<LocalWorkbenchRecord<LocalAttachmentData>>()
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [linkedDraft, setLinkedDraft] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  const [page, setPage] = useState(0)
  const blob = selected?.blob ?? file
  const filename = selected?.filename ?? file?.name ?? ''
  const mime = selected?.mime ?? file?.type ?? ''
  useEffect(() => {
    if (!blob) {
      setUrl('')
      return
    }
    const value = URL.createObjectURL(blob)
    setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [blob])
  const reset = () => {
    setSelected(undefined)
    setFile(undefined)
    setDescription('')
    setTags('')
    setLinkedDraft('')
    setNotice('')
    setError('')
  }
  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const labels = [
        ...new Set(
          tags
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ]
      if (description.length > 10000 || labels.length > 30 || labels.some((value) => value.length > 100))
        throw new Error('Use a description up to 10,000 characters and up to 30 short tags.')
      const relationships = [
        ...(selected?.data.relationships ?? []).filter((relation) => relation.role !== 'user-linked-draft'),
        ...(linkedDraft ? [{ kind: 'submission', id: linkedDraft, role: 'user-linked-draft' }] : []),
      ]
      if (selected) {
        const record = await saveLocalWorkbench({
          id: selected.id,
          kind: 'attachment',
          name: selected.name,
          data: { ...selected.data, description, tags: labels, relationships },
        })
        setSelected(record)
        setNotice('Attachment metadata saved in this browser. Original file bytes are unchanged.')
      } else if (file) {
        const record = await attachmentRecord(file, { description, tags: labels, relationships })
        if (cache.records.some((item) => item.id === record.id))
          throw new Error('This exact file is already staged. Select its cached item to edit metadata.')
        await importLocalWorkbench([record])
        setSelected(record)
        setFile(undefined)
        setNotice('Attachment staged in this browser with its SHA-256 and original bytes.')
      }
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (record: LocalWorkbenchRecord) => {
    setBusy(true)
    setError('')
    try {
      await deleteLocalWorkbench(record.id)
      if (selected?.id === record.id) reset()
      setNotice(`Removed ${record.name} from this browser. Existing draft references are retained for review.`)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const pages = Math.max(1, Math.ceil(cache.records.length / 25)),
    current = Math.min(page, pages - 1)
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="local-attachments-title">
      <h3 id="local-attachments-title" className="font-semibold">
        Local attachments and media
      </h3>
      <p className="text-sm text-muted-foreground">
        Stage documents, images, audio, video and archives in this browser. Add descriptions, tags and draft links;
        originals remain downloadable after a reload. Removing an attachment leaves any existing draft references
        visible for review.
      </p>
      <label className="block text-sm">
        Choose an attachment (up to 100 MiB)
        <input
          aria-label="Attachment preview file"
          type="file"
          disabled={busy}
          className="mt-1 block max-w-full"
          onChange={(event) => {
            const value = event.target.files?.[0]
            reset()
            if (value) {
              if (value.size > 100 * 1024 * 1024) setError('Stage attachments up to 100 MiB each.')
              else setFile(value)
            }
          }}
        />
      </label>
      {(error || cache.error) && <InlineAlert tone="error">{error || cache.error}</InlineAlert>}
      {notice && <InlineAlert tone="success">{notice}</InlineAlert>}
      {blob && (
        <div className="space-y-3 rounded border p-3">
          <p className="text-sm">
            {filename} · {blob.size.toLocaleString()} bytes · {mime || 'Type not supplied'}
          </p>
          <label className="block text-sm">
            Attachment description
            <textarea
              aria-label="Attachment description"
              className="mt-1 block min-h-20 w-full rounded border bg-background p-2"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Tags, separated by commas
            <input
              aria-label="Attachment tags"
              className="mt-1 block w-full rounded border bg-background p-2"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Link to local draft
            <NativeSelect
              aria-label="Attachment local draft"
              className="ml-2 max-w-full rounded border bg-background p-2"
              value={linkedDraft}
              onChange={(event) => setLinkedDraft(event.target.value)}
            >
              <option value="">No draft link</option>
              {submissions.records.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void save()}>
              {selected ? 'Save attachment metadata' : 'Stage attachment locally'}
            </Button>
            <Button variant="outline" onClick={() => downloadBlob(blob, filename)}>
              Download original attachment
            </Button>
          </div>
          {/^image\/(png|jpeg|gif|webp)$/.test(mime) && (
            <img src={url} alt={filename} className="max-h-[500px] max-w-full" />
          )}
          {mime === 'application/pdf' && (
            <iframe title={`Preview ${filename}`} src={url} sandbox="" className="h-[500px] w-full" />
          )}
          {mime.startsWith('audio/') && <audio src={url} controls className="max-w-full" />}
          {mime.startsWith('video/') && <video src={url} controls className="max-h-[500px] max-w-full" />}
          {selected && (
            <details>
              <summary className="cursor-pointer text-sm">Source fingerprint and relationships</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(selected.data, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
      <h4 className="text-sm font-semibold">Cached attachments ({cache.records.length})</h4>
      {cache.records.slice(current * 25, (current + 1) * 25).map((record) => (
        <div key={record.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
          <span className="min-w-0 break-words text-sm">
            {record.name} · {(record.blob?.size ?? 0).toLocaleString()} bytes
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!record.blob || busy}
              onClick={() => {
                const data = record.data as LocalAttachmentData
                setSelected(record as LocalWorkbenchRecord<LocalAttachmentData>)
                setFile(undefined)
                setDescription(data.description ?? '')
                setTags(data.tags?.join(', ') ?? '')
                setLinkedDraft(data.relationships?.find((relation) => relation.role === 'user-linked-draft')?.id ?? '')
                setNotice('')
                setError('')
              }}
            >
              Review attachment
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!record.blob}
              onClick={() => record.blob && downloadBlob(record.blob, record.filename || record.name)}
            >
              Download file
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void remove(record)}>
              Remove local attachment
            </Button>
          </div>
        </div>
      ))}
      {cache.records.length > 25 && (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!current} onClick={() => setPage(current - 1)}>
            Previous attachments
          </Button>
          <span className="text-sm">
            Page {current + 1} of {pages}
          </span>
          <Button size="sm" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
            Next attachments
          </Button>
        </div>
      )}
    </section>
  )
}
