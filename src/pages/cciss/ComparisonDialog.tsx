import { useState } from 'react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import type { ComparisonSnapshot } from './comparison'
import { comparisonInputSnapshots } from './comparisonAdapters'
import { ComparisonResults } from './ComparisonResults'
import { ComparisonSnapshotSide, ImportReview } from './ComparisonSnapshotSide'
import { FileImportField } from './FileImportField'
import { errorMessage, useLatestRequest } from './useLatestRequest'

const IMPORT_LIMIT = 25_000_000

export interface ComparisonDialogProps {
  snapshots: readonly ComparisonSnapshot[]
  onImportSnapshot: (snapshot: ComparisonSnapshot) => void
  onRemoveSnapshot?: (id: string) => void
  onRenameSnapshot?: (id: string, label: string) => void
  onClose: () => void
}

export function ComparisonDialog({
  snapshots,
  onImportSnapshot,
  onRemoveSnapshot,
  onRenameSnapshot,
  onClose,
}: ComparisonDialogProps) {
  const [leftId, setLeftId] = useState('')
  const [rightId, setRightId] = useState('')
  const left = snapshots.find((snapshot) => snapshot.id === leftId) ?? snapshots[0]
  const right =
    snapshots.find((snapshot) => snapshot.id === rightId) ?? snapshots.find((snapshot) => snapshot.id !== left?.id)
  const [pending, setPending] = useState<{ name: string; snapshots: ComparisonSnapshot[]; revision: number } | null>(
    null,
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useLatestRequest()

  async function importFile(file: File) {
    const revision = request.next()
    setError('')
    setBusy(true)
    try {
      if (file.size > IMPORT_LIMIT) throw new Error('Choose a comparison or analysis JSON file smaller than 25 MB.')
      const candidates = comparisonInputSnapshots(await file.text())
      if (!candidates.length) throw new Error('This file contains no supported comparison results.')
      if (request.isLatest(revision)) setPending({ name: file.name, snapshots: candidates, revision })
    } catch (cause) {
      if (request.isLatest(revision)) setError(errorMessage(cause))
    } finally {
      if (request.isLatest(revision)) setBusy(false)
    }
  }

  const side = (label: 'A' | 'B', selected: ComparisonSnapshot | undefined, onSelect: (id: string) => void) => (
    <ComparisonSnapshotSide
      label={label}
      snapshots={snapshots}
      selected={selected}
      onSelect={onSelect}
      onRemove={onRemoveSnapshot}
      onRename={onRenameSnapshot}
    />
  )

  return (
    <DialogShell
      title="CCISS comparison"
      subtitle="Compare saved sites, models, scenarios and settings"
      size="xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <InlineAlert tone="info">
          Save results from an analysis, change its site or settings, then save another result to compare. Captures
          retain the settings used when they were saved.
        </InlineAlert>
        <p className="text-sm">
          For a direct check against an original Shiny CSV or ZIP, open current data analysis and choose{' '}
          <strong>Compare with Shiny</strong>. That check uses the live assessment and identifies missing or unverified
          reference inputs.
        </p>
        <FileImportField
          label="Import comparison or analysis JSON"
          description="Accepts a validated comparison snapshot or a supported exported analysis. Imported files stay in this browser."
          accept=".json,application/json"
          buttonLabel="Import JSON"
          disabled={busy}
          onFile={(file) => void importFile(file)}
          onError={(cause) => setError(errorMessage(cause))}
        />
        {busy && <InlineAlert loading>Validating comparison data…</InlineAlert>}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        {pending && (
          <ImportReview
            key={pending.revision}
            name={pending.name}
            candidates={pending.snapshots}
            onAdd={(snapshot) => {
              try {
                onImportSnapshot(snapshot)
                if (!left) setLeftId(snapshot.id)
                else setRightId(snapshot.id)
                setPending(null)
                setError('')
              } catch (cause) {
                setError(errorMessage(cause))
              }
            }}
          />
        )}
        {snapshots.length === 0 ? (
          <SidebarSection title="No saved results yet">
            <p className="text-sm">
              Open an analysis and use its save-for-comparison action, or import a previously saved result above. You
              can compare different sites, climate models, scenarios or period weights.
            </p>
          </SidebarSection>
        ) : (
          <div className="grid items-start gap-4 sm:grid-cols-2">
            {side('A', left, setLeftId)}
            {side('B', right, setRightId)}
          </div>
        )}
        {left && !right && <InlineAlert tone="info">Save or import a second result to compare with A.</InlineAlert>}
        {left && right && <ComparisonResults key={`${left.id}:${right.id}`} left={left} right={right} />}
      </div>
    </DialogShell>
  )
}
