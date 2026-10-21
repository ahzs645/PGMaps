import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

export function ComparisonPreference({
  scope,
  left,
  right,
  onExport,
}: {
  scope: string
  left: { id: string; name: string }
  right: { id: string; name: string }
  onExport: (review: unknown) => void
}) {
  const [note, setNote] = useState(''),
    [preferred, setPreferred] = useState(''),
    [message, setMessage] = useState('')
  const key = `pgmaps-model-choice-v1-${scope}`
  useEffect(() => {
    setPreferred('')
    setNote('')
    setMessage('')
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (saved) {
        setPreferred(String(saved.preferred ?? ''))
        setNote(String(saved.note ?? ''))
      }
    } catch {
      setMessage('Local review storage unavailable; export a comparison to retain your choice.')
    }
  }, [key])
  const review = (id: string) => ({
    schema_version: 1,
    scope,
    preferred: id,
    note,
    reviewed_at: new Date().toISOString(),
    status: 'User preference; not field validation',
  })
  const save = (id: string) => {
    setPreferred(id)
    try {
      localStorage.setItem(key, JSON.stringify(review(id)))
      setMessage('Preference and note saved in this browser.')
    } catch {
      setMessage('Browser storage unavailable. Download the comparison to retain your choice.')
    }
  }
  return (
    <div className="space-y-2">
      <label className="block text-xs">
        Review note
        <textarea
          aria-label="Comparison review note"
          className="mt-1 block w-full rounded border bg-background p-2"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Splits, merges, missed crowns or structures…"
        />
      </label>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant={preferred === left.id ? 'default' : 'outline'} onClick={() => save(left.id)}>
          Prefer A
        </Button>
        <Button size="sm" variant={preferred === right.id ? 'default' : 'outline'} onClick={() => save(right.id)}>
          Prefer B
        </Button>
        <Button size="sm" variant="outline" onClick={() => onExport(review(preferred))}>
          Download comparison
        </Button>
      </div>
      {preferred && (
        <p className="text-xs">
          Saved choice: {preferred === left.id ? left.name : preferred === right.id ? right.name : preferred}. Click a
          preference again to save an edited note.
        </p>
      )}
      {message && (
        <p className="text-[11px] text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
