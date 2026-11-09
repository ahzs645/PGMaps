import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import { CollapsibleSection, InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import type { ComparisonSnapshot } from './comparison'

/** Choose which result of an imported file to add, and optionally rename it first. */
export function ImportReview({
  name,
  candidates,
  onAdd,
}: {
  name: string
  candidates: ComparisonSnapshot[]
  onAdd: (snapshot: ComparisonSnapshot) => void
}) {
  const [selected, setSelected] = useState('0')
  const [label, setLabel] = useState('')
  const candidate = candidates[Number(selected)] ?? candidates[0]
  return (
    <SidebarSection title={`Import from ${name}`}>
      <div className="space-y-3">
        <SelectField label="Imported result" value={selected} onChange={(event) => setSelected(event.target.value)}>
          {candidates.map((snapshot, index) => (
            <option key={index} value={index}>
              {snapshot.label}
            </option>
          ))}
        </SelectField>
        <FormField label="Imported result label">
          <input
            className={FORM_INPUT_CLASS}
            value={label}
            maxLength={200}
            placeholder={candidate.label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </FormField>
        <p className="text-xs text-muted-foreground">
          Source: {candidate.provenance.source} · Family: {candidate.family} · {candidate.metrics.length} recorded
          metrics.
        </p>
        {candidate.provenance.synthetic && (
          <InlineAlert tone="warning">This result contains synthetic verification data.</InlineAlert>
        )}
        <Button onClick={() => onAdd({ ...candidate, label: label.trim() || candidate.label })}>
          Add imported result
        </Button>
      </div>
    </SidebarSection>
  )
}

function ManageSnapshot({
  snapshot,
  side,
  onRename,
  onRemove,
}: {
  snapshot: ComparisonSnapshot
  side: string
  onRename?: (id: string, label: string) => void
  onRemove?: (id: string) => void
}) {
  const [name, setName] = useState(snapshot.label)
  return (
    <CollapsibleSection
      label={`Manage result ${side}`}
      collapseOn="always"
      className="rounded-md border"
      contentClassName="space-y-2 px-3 pb-3"
    >
      {onRename && (
        <>
          <FormField label={`Rename result ${side}`}>
            <input
              className={FORM_INPUT_CLASS}
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <Button
            size="sm"
            variant="outline"
            disabled={!name.trim()}
            onClick={() => onRename(snapshot.id, name.trim())}
          >
            Rename {side}
          </Button>
        </>
      )}
      {onRemove && (
        <Button size="sm" variant="outline" onClick={() => onRemove(snapshot.id)}>
          Remove {side}
        </Button>
      )}
    </CollapsibleSection>
  )
}

/** One side (A or B) of the comparison: the chosen saved result, its recorded scope, and its management. */
export function ComparisonSnapshotSide({
  label,
  snapshots,
  selected,
  onSelect,
  onRemove,
  onRename,
}: {
  label: string
  snapshots: readonly ComparisonSnapshot[]
  selected: ComparisonSnapshot | undefined
  onSelect: (id: string) => void
  onRemove?: (id: string) => void
  onRename?: (id: string, label: string) => void
}) {
  return (
    <SidebarSection title={`Result ${label}`}>
      <SelectField
        label={`Comparison ${label}`}
        value={selected?.id ?? ''}
        onChange={(event) => onSelect(event.target.value)}
      >
        {!selected && <option value="">Choose a saved result</option>}
        {snapshots.map((snapshot) => (
          <option key={snapshot.id} value={snapshot.id}>
            {snapshot.label}
          </option>
        ))}
      </SelectField>
      {selected && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            {selected.provenance.source} · {selected.provenance.version ?? 'Version unknown'} · {selected.family}
          </p>
          {selected.provenance.synthetic && <InlineAlert tone="warning">Synthetic verification data</InlineAlert>}
          <CollapsibleSection
            label={`Scope, settings and provenance for ${label}`}
            collapseOn="always"
            className="rounded-md border"
            contentClassName="px-3 pb-3"
          >
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(
                { context: selected.context, provenance: selected.provenance, periods: selected.periods },
                null,
                2,
              )}
            </pre>
          </CollapsibleSection>
          {(onRename || onRemove) && (
            <ManageSnapshot
              key={selected.id}
              snapshot={selected}
              side={label}
              onRename={onRename}
              onRemove={onRemove}
            />
          )}
        </div>
      )}
    </SidebarSection>
  )
}
