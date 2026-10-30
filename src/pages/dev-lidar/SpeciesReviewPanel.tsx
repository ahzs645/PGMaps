import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SidebarSection } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { EMPTY_SPECIES_REVIEW, readSpeciesReviews, speciesReviewFile, type SpeciesReviews } from './speciesReview'
import type { SpeciesData } from './species'
export function SpeciesReviewPanel({ data, standId }: { data: SpeciesData; standId: string | null }) {
  const [records, setRecords] = useState<SpeciesReviews>({})
  const [message, setMessage] = useState('')
  const [loaded, setLoaded] = useState(false)
  const key = `pgmaps-species-review-${data.source_sha256}-${data.inventory_sha256}`
  useEffect(() => {
    setLoaded(false)
    try {
      const saved = localStorage.getItem(key)
      setRecords(saved ? readSpeciesReviews(saved, data) : {})
      setMessage('Saved only in this browser. Export to back up or share.')
    } catch {
      setRecords({})
      setMessage('Saved review unavailable. Export new notes before leaving.')
    }
    setLoaded(true)
  }, [key, data])
  const save = (next: SpeciesReviews) => {
    setRecords(next)
    try {
      localStorage.setItem(key, speciesReviewFile(next, data))
      setMessage('Saved only in this browser. Export to back up or share.')
    } catch {
      setMessage('Browser storage unavailable. Export your notes before leaving.')
    }
  }
  const review = standId ? (records[standId] ?? EMPTY_SPECIES_REVIEW) : null
  return (
    <SidebarSection title="Field review" subtitle="Your observations stay separate from inventory and model labels">
      {review && standId && (
        <fieldset disabled={!loaded} className="space-y-2 text-xs">
          <label className="block">
            Visit status
            <NativeSelect
              aria-label="Species visit status"
              className="mt-1 w-full rounded border bg-background p-2"
              value={review.status}
              onChange={(e) =>
                save({ ...records, [standId]: { ...review, status: e.target.value as typeof review.status } })
              }
            >
              <option value="unvisited">Unvisited</option>
              <option value="needs-check">Needs checking</option>
              <option value="checked">Checked by reviewer</option>
            </NativeSelect>
          </label>
          <label className="block">
            Observed leading species
            <NativeSelect
              aria-label="Observed leading species"
              className="mt-1 w-full rounded border bg-background p-2"
              value={review.observedLeading}
              onChange={(e) => save({ ...records, [standId]: { ...review, observedLeading: e.target.value } })}
            >
              <option value="">Unknown / not recorded</option>
              {Object.entries(data.species).map(([code, name]) => (
                <option key={code} value={code}>
                  {code} · {name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="block">
            Observation date
            <input
              aria-label="Species observation date"
              type="date"
              className="mt-1 w-full rounded border bg-background p-2"
              value={review.date}
              onChange={(e) => save({ ...records, [standId]: { ...review, date: e.target.value } })}
            />
          </label>
          <label className="block">
            Notes
            <textarea
              aria-label="Species field notes"
              maxLength={2000}
              className="mt-1 min-h-16 w-full rounded border bg-background p-2"
              value={review.note}
              onChange={(e) => save({ ...records, [standId]: { ...review, note: e.target.value } })}
            />
          </label>
        </fieldset>
      )}
      <p className="mt-2 text-[10px]" role="status">
        {message || 'Loading browser-local review…'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!loaded}
          onClick={() =>
            downloadText(speciesReviewFile(records, data), 'species-field-review.json', 'application/json')
          }
        >
          Export field review
        </Button>
        <label className="cursor-pointer rounded border px-3 py-2 text-xs">
          Import review
          <input
            aria-label="Import species field review"
            className="sr-only"
            type="file"
            accept=".json,application/json"
            disabled={!loaded}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              try {
                if (file.size > 1000000) throw Error('Review file exceeds 1 MB')
                save(readSpeciesReviews(await file.text(), data))
              } catch (error) {
                setMessage(String(error))
              }
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        A checked review is a user observation, not verified training data. Import replaces this browser’s current
        notes; export first to retain them.
      </p>
    </SidebarSection>
  )
}
