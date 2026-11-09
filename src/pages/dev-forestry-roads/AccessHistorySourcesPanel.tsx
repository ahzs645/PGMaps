import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FileDropField } from '@/components/ui/file-drop-field'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import {
  ACCESS_HISTORY_SOURCES,
  MAX_STRUCTURE_IMPORT_BYTES,
  blockIdentitySources,
  importHistoricalStructures,
  loadBcBlockIdentity,
  loadBcRoadSegments,
  roadSegmentSources,
  type BlockIdentityLookup,
} from './accessHistorySources'
import { createAccessHistoryState, parseAccessHistoryState } from './accessHistory'
import { Field, RoadSelect } from './Controls'
import { existingRoadQueryBounds } from './existingRoads'
import { parseProject } from './project'
import type { ContextFeature, Coordinate } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Could not load source records.')
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  )

/** Preserve local reviews while detecting a changed authoritative snapshot. */
const roadSnapshot = (feature: ContextFeature) => {
  const evidence = feature.roadEvidence
  return canonical({
    source: evidence?.source,
    sourceId: evidence?.sourceId,
    forestFileId: evidence?.forestFileId,
    roadSectionId: evidence?.roadSectionId,
    segmentStartStation: evidence?.segmentStartStation,
    segmentEndStation: evidence?.segmentEndStation,
    timberMark: evidence?.timberMark,
    clientNumber: evidence?.clientNumber,
    fileTypeCode: evidence?.fileTypeCode,
    lifecycleStatus: evidence?.lifecycleStatus,
    status: evidence?.status,
    retirementDate: evidence?.retirementDate,
  })
}

function mergeRecords<T extends { id: string }>(saved: T[], incoming: T[], label: string): T[] {
  const result = [...saved]
  for (const record of incoming) {
    const previous = result.find((item) => item.id === record.id)
    if (!previous) {
      result.push(record)
      continue
    }
    const comparable = (item: T) => {
      const copy = { ...item } as T & { retrievedAt?: string }
      delete copy.retrievedAt
      return canonical(copy)
    }
    if (comparable(previous) !== comparable(record))
      throw Error(
        `${label} ${record.id} changed. Keep the existing evidence and reconcile the new record before importing.`,
      )
  }
  return result
}

/** Public open queries and locally supplied restricted extracts follow separate, explicit actions. */
export function AccessHistorySourcesPanel({
  workspace: w,
  block,
  disabled,
}: {
  workspace: RoadWorkspace
  block?: ContextFeature
  disabled: boolean
}) {
  const [loading, setLoading] = useState<'identity' | 'roads' | 'structures' | null>(null)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [lookup, setLookup] = useState<BlockIdentityLookup | null>(null)
  const [structureSource, setStructureSource] = useState<'mof-structures' | 'pscis'>('mof-structures')
  const latest = useRef(w)
  latest.current = w
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const openingId = block?.harvestEvidence?.openingId
  const identity = lookup?.openingId === openingId ? lookup : null
  const blocked = disabled || loading !== null
  const load = async (kind: 'identity' | 'roads') => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    const project = latest.current.project
    setLoading(kind)
    setError('')
    setWarnings([])
    try {
      if (kind === 'identity') {
        if (!openingId) throw Error('This block needs an opening ID before checking its ministry records.')
        const result = await loadBcBlockIdentity(openingId, controller.signal)
        if (controller.signal.aborted) return
        if (latest.current.project !== project)
          throw Error('The project changed while ministry records loaded. Repeat the query in the intended project.')
        latest.current.update((current) => {
          const state = current.accessHistory ?? createAccessHistoryState()
          return {
            ...current,
            accessHistory: parseAccessHistoryState(
              { ...state, sources: mergeRecords(state.sources, blockIdentitySources(result), 'Source') },
              current.context,
            ),
          }
        })
        setLookup(result)
        latest.current.setNotice(`Checked opening ${openingId} against RESULTS and forest tenure records.`)
      } else {
        const coordinates =
          block?.geometry.type === 'Polygon'
            ? [
                ...block.geometry.coordinates[0].map((coordinate) => [coordinate[0], coordinate[1]] as Coordinate),
                ...(project.accessHistory?.anchors
                  .filter((anchor) => anchor.role === 'outlet' || anchor.blockId === block.id)
                  .map((anchor) => anchor.coordinate) ?? []),
              ]
            : project.alignments.flatMap((alignment) => alignment.points.map((point) => point.coordinate))
        const roads = await loadBcRoadSegments(existingRoadQueryBounds(coordinates), controller.signal)
        if (controller.signal.aborted) return
        if (latest.current.project !== project)
          throw Error('The project changed while road segments loaded. Repeat the query in the intended project.')
        latest.current.update((current) => {
          const context = [...current.context]
          for (const road of roads) {
            const existing = context.find((feature) => feature.id === road.id)
            if (!existing) context.push(road)
            else if (
              existing.kind !== 'existing-road' ||
              JSON.stringify(existing.geometry) !== JSON.stringify(road.geometry)
            )
              throw Error(`Road ${road.id} has changed geometry. Review its extent before replacing retained evidence.`)
            else if (roadSnapshot(existing) !== roadSnapshot(road))
              throw Error(
                `Road ${road.id} has changed source fields. Keep the existing evidence and reconcile the new record before importing.`,
              )
          }
          const state = current.accessHistory ?? createAccessHistoryState()
          return parseProject({
            ...current,
            context,
            accessHistory: { ...state, sources: mergeRecords(state.sources, roadSegmentSources(roads), 'Source') },
          })
        })
        latest.current.setNotice(
          `Loaded ${roads.length} open FTEN road segments for history review. Reuse remains an explicit separate choice.`,
        )
        if (!roads.length) setWarnings(['No FTEN road segments were returned for this project corridor.'])
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(message(cause))
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setLoading(null)
      }
    }
  }
  return (
    <details className="space-y-2 text-xs" data-testid="history-source-tools">
      <summary className="cursor-pointer font-medium">Ministry records &amp; structure files</summary>
      <div className="flex items-start gap-1">
        <p className="min-w-0 flex-1 text-2xs text-muted-foreground">
          Check a block's opening identity and load open road segments around the selected block and its access anchors.
        </p>
        <InfoTip label="About access-history data sources">
          Road queries cover the selected block and saved entrances and outlets with a 1 km buffer, or the project
          alignments when no block is selected. Broad queries must be split into smaller study areas. RESULTS openings,
          FTEN cutblocks and FTEN road segments have open reuse terms in the source registry. Bridge and PSCIS extracts
          are imported locally by the user; their Access Only terms still apply. Restricted BCTS Block Access Roads is a
          reference, not a live lookup.
        </InfoTip>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-auto min-h-8 whitespace-normal"
          disabled={blocked || !openingId}
          onClick={() => void load('identity')}
        >
          {loading === 'identity' ? 'Checking identity…' : 'Check block identity'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-auto min-h-8 whitespace-normal"
          disabled={blocked}
          onClick={() => void load('roads')}
        >
          {loading === 'roads' ? 'Loading road segments…' : 'Load open road segments'}
        </Button>
      </div>
      {!openingId && (
        <p className="text-2xs text-muted-foreground">
          Choose a block with a ministry opening ID to check its identity.
        </p>
      )}
      {pending.current && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            pending.current?.abort()
            pending.current = null
            setLoading(null)
          }}
        >
          Cancel source request
        </Button>
      )}
      {error && <InlineAlert tone="warning">{error}</InlineAlert>}
      {warnings.length > 0 && (
        <InlineAlert tone="warning">
          <ul className="list-disc space-y-1 pl-4">
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </InlineAlert>
      )}
      {identity && (
        <div className="space-y-2 rounded border p-2" data-testid="history-block-identity">
          <p className="font-medium">
            Opening {identity.openingId} · {identity.records.length} records · {identity.matches.length} identity
            matches
          </p>
          {identity.missingSources.length > 0 && (
            <p>No record returned from: {identity.missingSources.join(', ')}. This is not evidence of absence.</p>
          )}
          {identity.matches
            .flatMap((match) => match.conflicts)
            .map((conflict, i) => (
              <InlineAlert key={i} tone="warning">
                {conflict.field} differs: RESULTS {conflict.resultsValue}; tenure {conflict.ftenValue}.
              </InlineAlert>
            ))}
          <details>
            <summary className="cursor-pointer">Reported identity fields</summary>
            {identity.records.map((record) => (
              <div key={record.id} className="my-2 border-t pt-2">
                <a href={record.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                  {record.source} · {record.id}
                </a>
                <KeyValueRows
                  variant="grid"
                  rows={[
                    { key: 'file', label: 'Licence', value: record.forestFileId ?? 'unknown' },
                    { key: 'cp', label: 'Cutting permit', value: record.cuttingPermitId ?? 'unknown' },
                    { key: 'block', label: 'Block', value: record.cutBlockId ?? 'unknown' },
                    { key: 'mark', label: 'Timber mark', value: record.timberMark ?? 'unknown' },
                    {
                      key: 'dates',
                      label: 'Disturbance dates',
                      value: `${record.disturbanceStartDate ?? 'unknown'} – ${record.disturbanceEndDate ?? 'unknown'}`,
                    },
                  ]}
                />
              </div>
            ))}
          </details>
          <p className="text-2xs text-muted-foreground">
            Identity matches do not establish the roads used or the purpose of their construction.
          </p>
        </div>
      )}
      <Field label="Structure file source">
        <RoadSelect
          ariaLabel="Structure file source"
          value={structureSource}
          disabled={blocked}
          onValueChange={(value) => setStructureSource(value as 'mof-structures' | 'pscis')}
        >
          <option value="mof-structures">MOF bridges and major culverts</option>
          <option value="pscis">PSCIS assessments</option>
        </RoadSelect>
      </Field>
      <FileDropField
        label="Historical structure records"
        filesLabel="Import structure records"
        accept=".json,.geojson,application/json,application/geo+json"
        disabled={blocked}
        dropHint="authorized JSON or GeoJSON extract, up to 5 MB"
        onError={(cause) => setError(message(cause))}
        inputProps={{ 'data-testid': 'history-structures-input' }}
        onFiles={async (files) => {
          const project = latest.current.project
          setLoading('structures')
          setError('')
          setWarnings([])
          try {
            if (files.length !== 1) throw Error('Choose one structure extract at a time.')
            const file = files[0].file
            if (file.size > MAX_STRUCTURE_IMPORT_BYTES) throw Error('Import at most 5 MB of structure records.')
            const result = importHistoricalStructures(JSON.parse(await file.text()), structureSource, {
              context: project.context,
            })
            if (latest.current.project !== project)
              throw Error(
                'The project changed while reading the structure file. Import it again in the intended project.',
              )
            latest.current.update((current) => {
              const state = current.accessHistory ?? createAccessHistoryState()
              return {
                ...current,
                accessHistory: parseAccessHistoryState(
                  {
                    ...state,
                    sources: mergeRecords(state.sources, result.sources, 'Source'),
                    structures: mergeRecords(state.structures, result.structures, 'Structure'),
                  },
                  current.context,
                ),
              }
            })
            setWarnings(result.warnings)
            latest.current.setNotice(
              `Imported ${result.structures.length} structure records. Review attachments, dates and conflicting reports.`,
            )
          } catch (cause) {
            setError(message(cause))
          } finally {
            setLoading(null)
          }
        }}
      />
      <details>
        <summary className="cursor-pointer">Source catalogue and access terms</summary>
        <ul className="mt-2 list-disc space-y-2 pl-4">
          {ACCESS_HISTORY_SOURCES.map((source) => (
            <li key={source.id}>
              <a href={source.catalogueUrl} target="_blank" rel="noreferrer" className="underline">
                {source.name}
              </a>{' '}
              · {source.licence}
              {source.access === 'restricted' ? ' · restricted' : ''}. {source.description}
            </li>
          ))}
        </ul>
      </details>
    </details>
  )
}
