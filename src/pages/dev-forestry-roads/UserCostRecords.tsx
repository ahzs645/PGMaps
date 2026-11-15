import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { insetBox } from '@/components/ui/inset-box'
import { EmptyHint } from '@/components/ui/result-list'
import { cn } from '@/lib/utils'
import { Field, OptionalNumberField, roadFieldClass } from './Controls'
import { ReferenceHeading, ReferenceSelect } from './CostReferenceControls'
import { PlacePicker } from './CostLocation'
import { EvidenceGroupList } from './CostEvidenceViews'
import { EVIDENCE_KINDS, groupEvidence, type EvidenceKind, type EvidenceSource } from './costEvidence/costEvidence'
import {
  mergeLibrary,
  parseCostPreferences,
  USER_RECORD_KINDS,
  USER_RECORD_UNITS,
  userRecordFrom,
  userRecordProblems,
  type CostPreferences,
  type UserRecordDraft,
} from './costPlaces/costPreferences'
import { placeCurrency, placeLabel } from './costPlaces/packs'
import type { CostPlace } from './costPlaces/places'
import { useCostPreferences } from './costPlaces/useCostPreferences'
import { today } from './RateAdoption'

const blankDraft = (place: CostPlace): UserRecordDraft => ({
  title: '',
  kind: 'supplier-price',
  party: '',
  place,
  placeName: place.locality ?? '',
  currency: placeCurrency(place),
  amount: null,
  unit: '/m³',
  date: today(),
  scope: '',
  tax: '',
  loading: '',
  delivery: '',
  installation: '',
  notes: '',
  url: '',
})

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const TEXT_FIELDS: [keyof UserRecordDraft, string, string][] = [
  ['scope', 'What the price covers', 'Supply and place 75 mm crush, 300 m³ minimum'],
  ['tax', 'Tax', 'Excludes GST'],
  ['loading', 'Loading', 'Loaded at the pit'],
  ['delivery', 'Delivery', 'Delivered to km 12'],
  ['installation', 'Placement or installation', 'Not included'],
  ['notes', 'Notes and cautions', 'Valid to March; winter surcharge'],
]

/**
 * The person's own cost records and preferences, kept in this browser and exported as a file: their
 * home place, the evidence types they read first, and their quotes and finished jobs, which the
 * evidence lists show beside the catalogue's records with an Own record badge.
 */
export function UserCostRecords({ projectPlace, sources }: { projectPlace?: CostPlace; sources: EvidenceSource[] }) {
  const [preferences, setPreferences] = useCostPreferences()
  const [draft, setDraft] = useState<UserRecordDraft | null>(null)
  const [editingHome, setEditingHome] = useState<CostPlace | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const update = (next: CostPreferences) => setPreferences(next)
  const startPlace = projectPlace ?? preferences.homePlace ?? { country: 'CA', subdivision: 'CA-BC' }
  const problems = draft ? userRecordProblems(draft) : []
  return (
    <div className="space-y-4" data-testid="road-user-cost-records">
      <p className="text-2xs leading-4 text-muted-foreground">
        Kept in this browser only, never in the catalogue or another person&apos;s view. Export them to keep a copy or
        move them to another computer.
      </p>

      <section className="space-y-1.5" aria-label="Home place">
        <ReferenceHeading info="Offered as a new project's cost location when its road lies outside every region boundary PGMaps knows. It never sets a location by itself.">
          Home place
        </ReferenceHeading>
        {editingHome ? (
          <div className={cn(insetBox({ padding: 'lg' }), 'space-y-2')}>
            <PlacePicker value={editingHome} onChange={setEditingHome} idPrefix="road-home-place" />
            <div className="flex gap-2">
              <Button
                type="button"
                size="xs"
                onClick={() => {
                  update({ ...preferences, homePlace: editingHome })
                  setEditingHome(null)
                }}
              >
                Save home place
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setEditingHome(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span data-testid="road-home-place">
              {preferences.homePlace ? placeLabel(preferences.homePlace) : 'Not set'}
            </span>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setEditingHome(preferences.homePlace ?? startPlace)}
            >
              {preferences.homePlace ? 'Change' : 'Choose'}
            </Button>
            {projectPlace && (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => update({ ...preferences, homePlace: projectPlace })}
              >
                Use this project&apos;s location
              </Button>
            )}
            {preferences.homePlace && (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  const { homePlace: _drop, ...rest } = preferences
                  void _drop
                  update(rest)
                }}
              >
                Clear
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="space-y-1.5" aria-label="Evidence read first">
        <ReferenceHeading info="Within each distance from the project (same region, province, country), these evidence types are listed first. Nothing is hidden.">
          Evidence read first
        </ReferenceHeading>
        <div className="flex flex-wrap gap-x-3 gap-y-1" data-testid="road-preferred-kinds">
          {(Object.keys(EVIDENCE_KINDS) as EvidenceKind[])
            .filter((kind) => kind !== 'funding')
            .map((kind) => (
              <label key={kind} className="flex items-center gap-1 text-2xs">
                <input
                  type="checkbox"
                  checked={preferences.preferredKinds.includes(kind)}
                  onChange={(event) =>
                    update({
                      ...preferences,
                      preferredKinds: event.target.checked
                        ? [...preferences.preferredKinds, kind]
                        : preferences.preferredKinds.filter((item) => item !== kind),
                    })
                  }
                />
                {EVIDENCE_KINDS[kind].label}
              </label>
            ))}
        </div>
      </section>

      <section className="space-y-1.5" aria-label="Own records">
        <ReferenceHeading info="Your quotes and finished jobs, in the catalogue's shape: each keeps its own currency, unit, date, place and terms, and reaches a rate only through Use for a project rate.">
          Own records
        </ReferenceHeading>
        {preferences.library.length ? (
          <EvidenceGroupList groups={groupEvidence(preferences.library)} sources={sources} defaultOpen />
        ) : (
          <EmptyHint>No own records yet.</EmptyHint>
        )}
        {preferences.library.length > 0 && (
          <ReferenceSelect
            label="Delete a record"
            value=""
            options={[
              { value: '', label: 'Choose a record to delete' },
              ...preferences.library.map((record) => ({
                value: record.id,
                label: `${record.title} · ${record.place}`,
              })),
            ]}
            onChange={(id) => id && update({ ...preferences, library: preferences.library.filter((r) => r.id !== id) })}
          />
        )}
        {draft ? (
          <div className={cn(insetBox({ padding: 'lg' }), 'space-y-2')} data-testid="road-user-record-form">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Work or product">
                <input
                  className={roadFieldClass}
                  aria-label="Work or product"
                  value={draft.title}
                  maxLength={300}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </Field>
              <ReferenceSelect
                label="Kind of record"
                value={draft.kind}
                options={USER_RECORD_KINDS.map((kind) => ({ value: kind, label: EVIDENCE_KINDS[kind].label }))}
                onChange={(kind) => setDraft({ ...draft, kind: kind as EvidenceKind })}
              />
              <Field label="Supplier or contractor">
                <input
                  className={roadFieldClass}
                  aria-label="Supplier or contractor"
                  value={draft.party}
                  maxLength={200}
                  onChange={(event) => setDraft({ ...draft, party: event.target.value })}
                />
              </Field>
              <Field label="Where (site or town)">
                <input
                  className={roadFieldClass}
                  aria-label="Where"
                  value={draft.placeName}
                  maxLength={300}
                  onChange={(event) => setDraft({ ...draft, placeName: event.target.value })}
                />
              </Field>
            </div>
            <PlacePicker
              value={draft.place}
              onChange={(place) => setDraft({ ...draft, place, currency: placeCurrency(place) })}
              idPrefix="road-user-record"
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <OptionalNumberField
                label={`Amount (${draft.currency})`}
                value={draft.amount}
                min={0}
                max={1e12}
                step={0.01}
                placeholder="Enter"
                updateOn="change"
                onChange={(amount) => setDraft({ ...draft, amount })}
              />
              <ReferenceSelect
                label="Unit"
                value={draft.unit}
                options={[
                  { value: '', label: 'Whole job' },
                  ...USER_RECORD_UNITS.map((unit) => ({ value: unit, label: unit.trim() })),
                ]}
                onChange={(unit) => setDraft({ ...draft, unit })}
              />
              <Field label="Price date">
                <input
                  className={roadFieldClass}
                  aria-label="Price date"
                  value={draft.date}
                  maxLength={10}
                  placeholder="YYYY-MM-DD"
                  onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                />
              </Field>
              <Field label="Link (optional)">
                <input
                  className={roadFieldClass}
                  aria-label="Link"
                  value={draft.url}
                  maxLength={2000}
                  placeholder="https://"
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {TEXT_FIELDS.map(([key, label, placeholder]) => (
                <Field key={key} label={label}>
                  <input
                    className={roadFieldClass}
                    aria-label={label}
                    value={draft[key] as string}
                    maxLength={1000}
                    placeholder={placeholder}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                  />
                </Field>
              ))}
            </div>
            {draft.kind === 'completed-project' && (
              <fieldset className="space-y-1">
                <legend className="text-2xs font-medium text-muted-foreground">
                  Finished job breakdown (as the Interior Logging Cost Report&apos;s road schedule separates it)
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {(
                    [
                      ['lengthKm', 'Road length (km)'],
                      ['subgrade', 'Subgrade'],
                      ['stabilization', 'Stabilization'],
                      ['structures', 'Structures'],
                      ['other', 'Other'],
                    ] as const
                  ).map(([key, label]) => (
                    <OptionalNumberField
                      key={key}
                      label={label}
                      value={draft.actual?.[key] ?? null}
                      min={0}
                      max={1e12}
                      step={0.01}
                      placeholder="—"
                      updateOn="change"
                      onChange={(value) =>
                        setDraft({ ...draft, actual: { ...draft.actual, [key]: value ?? undefined } })
                      }
                    />
                  ))}
                </div>
              </fieldset>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="xs"
                disabled={problems.length > 0}
                data-testid="road-user-record-save"
                onClick={() => {
                  const record = userRecordFrom(draft, `user-${Date.now().toString(36)}`, today())
                  update({ ...preferences, library: [...preferences.library, record] })
                  setDraft(null)
                  setMessage({ tone: 'success', text: `Saved ${record.title}.` })
                }}
              >
                Save record
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              {problems.length > 0 && <span className="text-2xs text-muted-foreground">{problems[0]}</span>}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              data-testid="road-user-record-add"
              onClick={() => setDraft(blankDraft(startPlace))}
            >
              Add a quote or finished job
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={!preferences.library.length && !preferences.homePlace}
              onClick={() =>
                download(`pgmaps-cost-preferences-${today()}.json`, JSON.stringify(preferences, null, 1) + '\n')
              }
            >
              Export
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => fileInput.current?.click()}>
              Import
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="Import cost preferences"
              data-testid="road-user-records-import"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                try {
                  const imported = parseCostPreferences(JSON.parse(await file.text()))
                  update(mergeLibrary(preferences, imported))
                  setMessage({ tone: 'success', text: `Imported ${imported.library.length} records.` })
                } catch (cause) {
                  setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) })
                }
              }}
            />
          </div>
        )}
        {message && (
          <InlineAlert tone={message.tone} title={message.tone === 'error' ? 'Nothing was imported' : message.text}>
            {message.tone === 'error' ? message.text : null}
          </InlineAlert>
        )}
      </section>
    </div>
  )
}
