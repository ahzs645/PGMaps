import { useKeyedState } from '../useKeyedState'
import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, FormField } from '@/components/ui/form-field'

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
  const key = `pgmaps-model-choice-v1-${scope}`
  const [preference, setPreference] = useKeyedState(key, () => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      return { preferred: String(saved?.preferred ?? ''), note: String(saved?.note ?? ''), message: '' }
    } catch {
      return {
        preferred: '',
        note: '',
        message: 'Local review storage unavailable; export a comparison to retain your choice.',
      }
    }
  })
  const { note, preferred, message } = preference
  const setNote = (note: string) => setPreference((current) => ({ ...current, note }))
  const setPreferred = (preferred: string) => setPreference((current) => ({ ...current, preferred }))
  const setMessage = (message: string) => setPreference((current) => ({ ...current, message }))
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
      <FormField label="Review note">
        <textarea
          aria-label="Comparison review note"
          className={FORM_INPUT_CLASS}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Splits, merges, missed crowns or structures…"
        />
      </FormField>
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
        <p className="text-2xs text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
