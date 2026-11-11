import { Button } from '@/components/ui/button'
import type { RefObject } from 'react'
import { KeyValueRows } from '@/components/ui/map-panels'
import type { HistoricalAccessState } from './accessHistoryTypes'
import type { ContextFeature, Coordinate } from './types'

const when = (window: { earliest: string | null; latest: string | null } | null) =>
  window ? `${window.earliest ?? 'unknown'} – ${window.latest ?? 'unknown'}` : 'unknown'

/** Readable retained records are available after reopening, independently of a live lookup or route trace. */
export function AccessHistoryEvidence({
  history,
  context,
  onLocate,
  detailsRef,
}: {
  history: HistoricalAccessState
  context: ContextFeature[]
  onLocate?: (coordinates: Coordinate[]) => void
  detailsRef?: RefObject<HTMLDetailsElement>
}) {
  const roadName = (id: string | null) => context.find((feature) => feature.id === id)?.name ?? id ?? 'unresolved'
  const references = (ids: string[]) =>
    ids.length
      ? ids.map((id) => history.sources.find((source) => source.id === id)?.dataset ?? id).join('; ')
      : 'none asserted'
  return (
    <details ref={detailsRef} className="space-y-2 text-xs" data-testid="history-saved-evidence">
      <summary className="cursor-pointer font-medium">
        Saved evidence · {history.sources.length} sources · {history.events.length} road events ·{' '}
        {history.structures.length} structures
      </summary>
      <details>
        <summary className="cursor-pointer">Source records and block identities</summary>
        <div className="mt-2 max-h-72 space-y-3 overflow-y-auto overscroll-none">
          {history.sources.length === 0 && <p>No source records saved.</p>}
          {history.sources.map((source) => (
            <div key={source.id} className="space-y-1 border-t pt-2">
              <p className="font-medium">
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer" className="break-words underline">
                    {source.dataset} · {source.recordId}
                  </a>
                ) : (
                  `${source.dataset} · ${source.recordId}`
                )}
                {source.synthetic ? ' · synthetic' : ''}
              </p>
              <p className="break-words text-2xs">{source.description}</p>
              <p className="text-2xs text-muted-foreground">
                Published {source.publishedOn ?? 'unknown'} · retrieved {source.retrievedAt}
              </p>
              {source.blockIdentity && (
                <KeyValueRows
                  variant="grid"
                  rows={[
                    { key: 'opening', label: 'Opening ID', value: source.blockIdentity.openingId },
                    { key: 'file', label: 'Licence', value: source.blockIdentity.forestFileId ?? 'unknown' },
                    {
                      key: 'permit',
                      label: 'Cutting permit',
                      value: source.blockIdentity.cuttingPermitId ?? 'unknown',
                    },
                    { key: 'block', label: 'Block', value: source.blockIdentity.cutBlockId ?? 'unknown' },
                    { key: 'mark', label: 'Timber mark', value: source.blockIdentity.timberMark ?? 'unknown' },
                    {
                      key: 'dates',
                      label: 'Disturbance dates',
                      value: `${source.blockIdentity.disturbanceStartDate ?? 'unknown'} – ${source.blockIdentity.disturbanceEndDate ?? 'unknown'}`,
                    },
                  ]}
                />
              )}
            </div>
          ))}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer">Physical road chronology</summary>
        <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto overscroll-none">
          {history.events.length === 0 && (
            <li>No physical road events saved. Permit dates alone do not establish construction.</li>
          )}
          {history.events.map((event) => (
            <li key={event.id} className="border-t pt-2">
              <p className="font-medium">
                {roadName(event.roadId)} · {event.kind}
              </p>
              <p>
                Event {when(event.when)} · observed {event.observedOn ?? 'unknown'}
              </p>
              <p className="text-2xs text-muted-foreground">Sources: {references(event.sourceIds)}</p>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="cursor-pointer">Structure identities, dates and source reports</summary>
        <div className="mt-2 max-h-96 space-y-3 overflow-y-auto overscroll-none">
          {history.structures.length === 0 && <p>No structure records saved; crossing completeness is unknown.</p>}
          {history.structures.map((structure) => (
            <div key={structure.id} className="space-y-1 border-t pt-2">
              <p className="font-medium">
                {structure.name} · {structure.kind}
              </p>
              <p className="break-words text-2xs">
                Crossing site {structure.crossingSiteId ?? 'unknown'} · physical structure{' '}
                {structure.structureId ?? 'unknown'} · source row {structure.sourceRowId ?? 'unknown'}
              </p>
              <p>
                Road {roadName(structure.roadId)} · {structure.attachment}
              </p>
              {structure.roadKey && (
                <p className="text-2xs">
                  Permit {structure.roadKey.forestFileId} · section {structure.roadKey.roadSectionId}
                </p>
              )}
              <p>
                Construction {when(structure.construction)} · removal {when(structure.removal)}
              </p>
              <p className="text-2xs text-muted-foreground">Sources: {references(structure.sourceIds)}</p>
              {structure.evidence.length > 0 && (
                <ul className="list-disc space-y-2 pl-4">
                  {structure.evidence.map((evidence) => (
                    <li key={evidence.id}>
                      <p>
                        {evidence.kind} · {evidence.description}
                      </p>
                      <p className="text-2xs">
                        Reported rating{' '}
                        {evidence.ratedLoadTonnes === null ? 'unknown' : `${evidence.ratedLoadTonnes} t`} · valid{' '}
                        {evidence.validFrom ?? 'unknown'} – {evidence.validUntil ?? 'open-ended or unknown'}
                      </p>
                      <p className="text-2xs text-muted-foreground">Sources: {references(evidence.sourceIds)}</p>
                    </li>
                  ))}
                </ul>
              )}
              {onLocate && (
                <Button size="sm" variant="ghost" onClick={() => onLocate([structure.coordinate])}>
                  Locate structure
                </Button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-2xs text-muted-foreground">
          All source reports are retained. A reported rating needs its date, asset identity and applicability reviewed
          before any vehicle-capacity decision.
        </p>
      </details>
    </details>
  )
}
