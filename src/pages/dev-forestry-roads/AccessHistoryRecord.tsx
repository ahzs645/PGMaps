import { Button } from '@/components/ui/button'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { formatNumber } from '@/lib/format'
import { assessHistoricalRoad, assessHistoricalStructures, roadGeometryFingerprint } from './accessHistory'
import type { HistoricalAccessState, HistoricalSource } from './accessHistoryTypes'
import type { AccessHistorySelection } from './AccessHistorySelection'
import type { ContextFeature, Coordinate } from './types'

const when = (value: { earliest: string | null; latest: string | null } | null) =>
  value ? `${value.earliest ?? 'unknown'} – ${value.latest ?? 'unknown'}` : 'not recorded'
const station = (value: number | undefined) => formatNumber(value, { maximumFractionDigits: 6, fallback: 'unknown' })

function Sources({ sources }: { sources: HistoricalSource[] }) {
  if (!sources.length)
    return <p className="text-2xs text-muted-foreground">No retained source reference accompanies this record.</p>
  return (
    <details>
      <summary className="cursor-pointer">
        Source reference{sources.length === 1 ? '' : 's'} · {sources.length}
      </summary>
      <ul className="mt-1 space-y-2">
        {sources.map((source) => (
          <li key={source.id}>
            <p>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer" className="break-words underline">
                  {source.dataset} · {source.recordId}
                </a>
              ) : (
                `${source.dataset} · ${source.recordId}`
              )}
              {source.synthetic ? ' · synthetic' : ''}
            </p>
            <p className="text-2xs text-muted-foreground">{source.description}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** A readable selection card works before a route exists and when a record is clicked on the map. */
export function AccessHistoryRecord({
  selection,
  context,
  history,
  asOf,
  onLocate,
  onLoadAsRoad,
}: {
  selection: Pick<AccessHistorySelection, 'kind' | 'id'>
  context: ContextFeature[]
  history: HistoricalAccessState
  asOf: string
  onLocate?: (coordinates: Coordinate[]) => void
  /** Loads the road, held as mapped, to read its profile and grades on the project terrain. */
  onLoadAsRoad?: (featureId: string) => void
}) {
  if (selection.kind === 'road') {
    const road = context.find((feature) => feature.id === selection.id && feature.kind === 'existing-road')
    if (!road || road.geometry.type !== 'LineString')
      return <InlineAlert tone="warning">This road record is no longer loaded.</InlineAlert>
    const evidence = road.roadEvidence
    const events = history.events.filter((event) => event.roadId === road.id)
    const assessment = assessHistoricalRoad(road, history.events, asOf)
    const sourceIds = new Set(events.flatMap((event) => event.sourceIds))
    const sources = history.sources.filter((source) => sourceIds.has(source.id) || source.id === evidence?.sourceId)
    const structures = history.structures.filter((structure) => structure.roadId === road.id)
    return (
      <div className="space-y-2 rounded-md border p-2.5 text-xs" data-testid="history-selected-road-record">
        <p className="break-words font-medium">{road.name}</p>
        <p className="text-2xs text-muted-foreground">
          {evidence?.source === 'scenario'
            ? 'Synthetic road record'
            : evidence?.source === 'bc-ften'
              ? 'Ministry mapped road record'
              : 'User-supplied road record'}{' '}
          · historical timing {assessment.status} at {asOf}
        </p>
        <KeyValueRows
          variant="grid"
          rows={[
            { key: 'file', label: 'Forest file / permit', value: evidence?.forestFileId ?? 'not recorded' },
            { key: 'section', label: 'Road section', value: evidence?.roadSectionId ?? 'not recorded' },
            {
              key: 'station',
              label: 'Source stations',
              value: `${station(evidence?.segmentStartStation)} – ${station(evidence?.segmentEndStation)}`,
            },
            { key: 'mark', label: 'Timber mark', value: evidence?.timberMark ?? 'not recorded' },
            { key: 'client', label: 'Client', value: evidence?.clientNumber ?? 'not recorded' },
            {
              key: 'administrative',
              label: 'Administrative status',
              value: evidence?.status ?? evidence?.lifecycleStatus ?? 'not recorded',
            },
            { key: 'award', label: 'Permit award date', value: evidence?.awardDate ?? 'not recorded' },
            { key: 'retired', label: 'Permit retirement date', value: evidence?.retirementDate ?? 'not recorded' },
          ]}
        />
        {events.length ? (
          <ul className="space-y-1">
            {events.map((event) => (
              <li key={event.id}>
                {event.kind} · {when(event.when)}
                {event.geometryFingerprint !== roadGeometryFingerprint(road)
                  ? ' · reviewed road extent has changed'
                  : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No construction, deactivation or observed-presence date is attached to this road. Permit and retrieval dates
            do not fill that gap.
          </p>
        )}
        <p className="text-2xs text-muted-foreground">
          {structures.length} structure record{structures.length === 1 ? ' names' : 's name'} this road;{' '}
          {structures.length === 1 ? 'its' : 'their'} attachment and dates need their own review.
        </p>
        {assessment.status !== 'compatible' && (
          <p className="text-2xs text-amber-800 dark:text-amber-300">{assessment.reasons.join(' ')}</p>
        )}
        {evidence?.sourceUrl && (
          <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="inline-block underline">
            Open road data source
          </a>
        )}
        <Sources sources={sources} />
        {onLocate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onLocate(
                road.geometry.type === 'LineString'
                  ? road.geometry.coordinates.map(([x, y]) => [x, y] as Coordinate)
                  : [],
              )
            }
          >
            Locate road record
          </Button>
        )}
        {onLoadAsRoad && (
          <Button size="sm" onClick={() => onLoadAsRoad(road.id)}>
            Load as road · read its profile
          </Button>
        )}
      </div>
    )
  }
  if (selection.kind === 'structure') {
    const structure = history.structures.find((record) => record.id === selection.id)
    if (!structure) return <InlineAlert tone="warning">This structure record is no longer loaded.</InlineAlert>
    const assessment = assessHistoricalStructures(history, context, asOf).find(
      (item) => item.structureId === structure.id,
    )!
    const sourceIds = new Set([...structure.sourceIds, ...structure.evidence.flatMap((item) => item.sourceIds)])
    const sources = history.sources.filter((source) => sourceIds.has(source.id))
    return (
      <div className="space-y-2 rounded-md border p-2.5 text-xs" data-testid="history-selected-structure-record">
        <p className="break-words font-medium">{structure.name}</p>
        <p className="text-2xs text-muted-foreground">
          {sources.length && sources.every((source) => source.synthetic)
            ? 'Synthetic structure record'
            : 'Retained structure record'}{' '}
          · {structure.kind} · {assessment.binding === 'unresolved' ? 'road attachment unresolved' : assessment.status}{' '}
          at {asOf}
        </p>
        <KeyValueRows
          variant="grid"
          rows={[
            { key: 'site', label: 'Crossing site', value: structure.crossingSiteId ?? 'not recorded' },
            { key: 'asset', label: 'Physical asset', value: structure.structureId ?? 'not recorded' },
            { key: 'row', label: 'Source row', value: structure.sourceRowId ?? 'not recorded' },
            {
              key: 'road',
              label: 'Named road',
              value:
                context.find((feature) => feature.id === structure.roadId)?.name ?? structure.roadId ?? 'unresolved',
            },
            {
              key: 'key',
              label: 'Forest file / section',
              value: structure.roadKey
                ? `${structure.roadKey.forestFileId} / ${structure.roadKey.roadSectionId}`
                : 'not recorded',
            },
            { key: 'built', label: 'Construction', value: when(structure.construction) },
            { key: 'removed', label: 'Removal', value: when(structure.removal) },
          ]}
        />
        {structure.evidence.length ? (
          <ul className="list-disc space-y-2 pl-4">
            {structure.evidence.map((item) => (
              <li key={item.id}>
                <p>{item.description}</p>
                <p className="text-2xs text-muted-foreground">
                  {item.kind}
                  {item.ratedLoadTonnes === null ? '' : ` · reported ${item.ratedLoadTonnes} t`} ·{' '}
                  {item.validFrom ?? 'start unknown'} – {item.validUntil ?? 'end not recorded'}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No dated closure, restriction or load-rating report is attached.</p>
        )}
        <p className="text-2xs text-amber-800 dark:text-amber-300">{assessment.reasons.join(' ')}</p>
        <Sources sources={sources} />
        {onLocate && (
          <Button size="sm" variant="outline" onClick={() => onLocate([structure.coordinate])}>
            Locate structure record
          </Button>
        )}
      </div>
    )
  }
  return null
}
