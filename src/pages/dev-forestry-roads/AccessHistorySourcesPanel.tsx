import { useEffect, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { FileDropField } from '@/components/ui/file-drop-field'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import {
  ACCESS_HISTORY_SOURCES,
  MAX_STRUCTURE_IMPORT_BYTES,
  blockIdentitySources,
  buildBcBlockIdentityQuery,
  buildBcRoadSegmentsQuery,
  importHistoricalStructures,
  loadBcBlockIdentity,
  loadBcRoadSegments,
  roadSegmentSources,
  type BlockIdentityLookup,
} from './accessHistorySources'
import { createAccessHistoryState, parseAccessHistoryState } from './accessHistory'
import { assessHistoricalCoverage } from './accessHistorySummary'
import {
  BC_ACCESS_PILOT_RECIPE,
  loadBcAccessPilot,
  makeHistoricalSourceQuery,
  type BcAccessPilotResult,
} from './bcAccessPilot'
import type { AccessHistoryQueryStatus, AccessHistoryWorkspace } from './AccessHistorySelection'
import { Field, roadFieldClass, RoadSelect } from './Controls'
import { existingRoadQueryBounds } from './existingRoads'
import { parseProject } from './project'
import type { ContextFeature, Coordinate, RoadProject } from './types'

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

function mergeContext(saved: ContextFeature[], incoming: ContextFeature[]) {
  const context = [...saved]
  for (const feature of incoming) {
    const existing = context.find((record) => record.id === feature.id)
    if (!existing) {
      context.push({
        ...feature,
        ...(feature.roadEvidence ? { roadEvidence: { ...feature.roadEvidence, reuseAllowed: false } } : {}),
      })
      continue
    }
    if (existing.kind !== feature.kind || canonical(existing.geometry) !== canonical(feature.geometry))
      throw Error(`Record ${feature.id} has changed geometry. Review its extent before replacing retained evidence.`)
    if (feature.kind === 'existing-road' && roadSnapshot(existing) !== roadSnapshot(feature))
      throw Error(
        `Road ${feature.id} has changed source fields. Keep the existing evidence and reconcile the new record before importing.`,
      )
    if (feature.kind === 'harvest') {
      const comparable = (record: ContextFeature) => ({ ...record.harvestEvidence, retrievedAt: undefined })
      if (canonical(comparable(existing)) !== canonical(comparable(feature)))
        throw Error(
          `Block ${feature.id} has changed source fields. Reconcile the retained and new harvest evidence before importing.`,
        )
    }
  }
  return context
}

function addPilotRecords(project: RoadProject, result: BcAccessPilotResult): RoadProject {
  const state = project.accessHistory ?? createAccessHistoryState()
  return parseProject({
    ...project,
    context: mergeContext(project.context, [...result.blocks, ...result.roads]),
    accessHistory: {
      ...state,
      sources: mergeRecords(state.sources, result.sources, 'Source'),
      selectedPathId: result.blocks.length ? null : state.selectedPathId,
    },
  })
}

/** Public open queries and locally supplied restricted extracts follow separate, explicit actions. */
export function AccessHistorySourcesPanel({
  workspace: w,
  block,
  disabled,
  detailsRef,
  onStatus,
  onPilotAdded,
}: {
  workspace: AccessHistoryWorkspace
  block?: ContextFeature
  disabled: boolean
  detailsRef?: RefObject<HTMLDetailsElement>
  onStatus?: (status: AccessHistoryQueryStatus) => void
  onPilotAdded?: (blockId: string, coordinates: Coordinate[]) => void
}) {
  const [loading, setLoading] = useState<'pilot' | 'identity' | 'roads' | 'structures' | null>(null)
  const [pilot, setPilot] = useState<{ project: RoadProject; result: BcAccessPilotResult } | null>(null)
  const [pilotOpeningId, setPilotOpeningId] = useState<string>(BC_ACCESS_PILOT_RECIPE.openingId)
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
  const report = (
    kind: AccessHistoryQueryStatus['kind'],
    status: AccessHistoryQueryStatus['status'],
    text: string,
    blockId = block?.id ?? null,
  ) => onStatus?.({ kind, status, blockId, message: text, occurredAt: new Date().toISOString() })
  const loadPilot = async () => {
    const requestedOpeningId = pilotOpeningId.trim()
    try {
      buildBcBlockIdentityQuery(requestedOpeningId, 'results-opening')
    } catch (cause) {
      setError(message(cause))
      report('pilot', 'error', message(cause), null)
      return
    }
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    const project = latest.current.project
    setPilot(null)
    setLoading('pilot')
    setError('')
    setWarnings([])
    report('pilot', 'loading', `Loading actual ministry records for opening ${requestedOpeningId}.`, null)
    try {
      const result = await loadBcAccessPilot(requestedOpeningId, controller.signal)
      if (controller.signal.aborted) return
      if (latest.current.project !== project)
        throw Error('The project changed while the sample records loaded. Load them again in the intended project.')
      addPilotRecords(project, result)
      setPilot({ project, result })
      report(
        'pilot',
        'preview',
        `${result.blocks.length} block polygons and ${result.roads.length} road records are ready to review before adding.`,
        null,
      )
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(message(cause))
        report('pilot', 'error', message(cause), null)
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setLoading(null)
      }
    }
  }
  const load = async (kind: 'identity' | 'roads') => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    const project = latest.current.project
    setLoading(kind)
    setError('')
    setWarnings([])
    report(
      kind,
      'loading',
      kind === 'identity'
        ? 'Checking ministry opening records.'
        : 'Loading mapped road segments in this block’s study area.',
    )
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
              {
                ...state,
                sources: mergeRecords(
                  state.sources,
                  [
                    ...blockIdentitySources(result),
                    ...(['results-opening', 'ften-cutblock'] as const).map((source) =>
                      makeHistoricalSourceQuery(
                        {
                          source,
                          status: 'success',
                          recordCount: result.records.filter((record) => record.source === source).length,
                          openingId,
                          requestUrl: buildBcBlockIdentityQuery(openingId, source),
                        },
                        result.retrievedAt,
                        result.records.filter((record) => record.source === source),
                      ),
                    ),
                  ],
                  'Source',
                ),
              },
              current.context,
            ),
          }
        })
        setLookup(result)
        report(kind, 'success', `${result.records.length} ministry identity records returned for opening ${openingId}.`)
        latest.current.setNotice(`Checked opening ${openingId} against RESULTS and forest tenure records.`)
      } else {
        const coverage = assessHistoricalCoverage({
          context: project.context,
          state: project.accessHistory ?? createAccessHistoryState(),
          blockId: block?.id,
        })
        const coordinates =
          block?.geometry.type === 'Polygon'
            ? [
                ...block.geometry.coordinates[0].map((coordinate) => [coordinate[0], coordinate[1]] as Coordinate),
                ...coverage.anchors.entrances.map((anchor) => anchor.coordinate),
                ...coverage.anchors.outlets.map((anchor) => anchor.coordinate),
              ]
            : project.alignments.flatMap((alignment) => alignment.points.map((point) => point.coordinate))
        const bounds = coverage.scopeBounds ?? existingRoadQueryBounds(coordinates)
        const roads = await loadBcRoadSegments(bounds, controller.signal)
        if (controller.signal.aborted) return
        if (latest.current.project !== project)
          throw Error('The project changed while road segments loaded. Repeat the query in the intended project.')
        latest.current.update((current) => {
          const context = mergeContext(current.context, roads)
          const state = current.accessHistory ?? createAccessHistoryState()
          return parseProject({
            ...current,
            context,
            accessHistory: {
              ...state,
              sources: mergeRecords(
                state.sources,
                [
                  ...roadSegmentSources(roads),
                  makeHistoricalSourceQuery(
                    {
                      source: 'ften-road-segment',
                      status: 'success',
                      recordCount: roads.length,
                      requestUrl: buildBcRoadSegmentsQuery(bounds),
                      bounds,
                      ...(openingId ? { openingId } : {}),
                    },
                    roads[0]?.roadEvidence?.retrievedAt ?? new Date().toISOString(),
                    roads,
                  ),
                ],
                'Source',
              ),
            },
          })
        })
        latest.current.setNotice(
          `Loaded ${roads.length} open FTEN road segments for history review. Reuse remains an explicit separate choice.`,
        )
        report(
          kind,
          'success',
          `${roads.length} FTEN road records returned. A road-to-block connection is not established by this query.`,
        )
        if (!roads.length) setWarnings(['No FTEN road segments were returned for this project corridor.'])
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(message(cause))
        report(kind, 'error', message(cause))
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setLoading(null)
      }
    }
  }
  return (
    <div className="space-y-2 text-xs">
      <Field label="Opening ID to add">
        <input
          className={roadFieldClass}
          value={pilotOpeningId}
          inputMode="numeric"
          maxLength={15}
          disabled={blocked}
          onChange={(event) => {
            if (loading === 'pilot') {
              pending.current?.abort()
              pending.current = null
              setLoading(null)
            }
            if (loading === 'pilot' || pilot)
              report('pilot', 'cancelled', 'Opening ID changed. Load the requested opening again.', null)
            setPilotOpeningId(event.target.value)
            setPilot(null)
            setError('')
          }}
        />
      </Field>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          disabled={blocked || !pilotOpeningId.trim()}
          onClick={() => void loadPilot()}
        >
          {loading === 'pilot' ? 'Loading actual BC records…' : 'Load actual BC records'}
        </Button>
        <InfoTip label="About loading actual BC records">
          Load one opening's FTEN polygons, RESULTS identity and nearby FTEN road segments. Preview the records before
          adding them to this project. Add a neighbouring opening to compare its road candidates; matching source record
          IDs are retained once. Road use, physical construction dates and crossings remain evidence questions.
        </InfoTip>
      </div>
      {error && <InlineAlert tone="warning">{error}</InlineAlert>}
      {pending.current && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            pending.current?.abort()
            pending.current = null
            if (loading) report(loading, 'cancelled', 'Request cancelled. Saved project records were not changed.')
            setLoading(null)
          }}
        >
          Cancel source request
        </Button>
      )}
      {pilot && (
        <div className="space-y-2 rounded-md border p-2" data-testid="history-pilot-preview">
          <p className="font-medium">Opening {pilot.result.openingId} · actual source records</p>
          <p>
            {pilot.result.blocks.length} block polygons · {pilot.result.roads.length} road records ·{' '}
            {pilot.result.identity.records.length} identity records
          </p>
          <p className="text-2xs text-muted-foreground">
            These records will be added to this project. Existing project data is retained. No entrance, road use,
            construction date or bridge record is invented.
          </p>
          <ul className="list-disc space-y-1 pl-4">
            {pilot.result.queries.map((query) => (
              <li key={query.source}>
                {query.source}:{' '}
                {query.status === 'success'
                  ? `${query.recordCount} records`
                  : `not queried · ${query.reason ?? 'prerequisite missing'}`}
              </li>
            ))}
          </ul>
          <details>
            <summary className="cursor-pointer">What the records establish and leave open</summary>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {pilot.result.findings.map((finding) => (
                <li key={finding.id}>{finding.text}</li>
              ))}
            </ul>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={blocked}
              onClick={() => {
                setError('')
                try {
                  if (latest.current.project !== pilot.project)
                    throw Error('The project changed after this preview. Load the sample again before adding it.')
                  const retained = new Set(latest.current.project.context.map((feature) => feature.id))
                  const newBlocks = pilot.result.blocks.filter((feature) => !retained.has(feature.id)).length
                  const newRoads = pilot.result.roads.filter((feature) => !retained.has(feature.id)).length
                  const sharedRoads = pilot.result.roads.length - newRoads
                  latest.current.update((project) => addPilotRecords(project, pilot.result))
                  const selected = pilot.result.blocks[0]
                  const text = `Added ${newBlocks} block polygon${newBlocks === 1 ? '' : 's'} and ${newRoads} new road record${newRoads === 1 ? '' : 's'}.${sharedRoads ? ` ${sharedRoads} road record${sharedRoads === 1 ? '' : 's'} matched retained source IDs and ${sharedRoads === 1 ? 'was' : 'were'} kept once.` : ''} Historical use is not established.`
                  report('pilot', 'success', text, selected?.id ?? null)
                  setLookup(pilot.result.identity)
                  setPilot(null)
                  latest.current.setNotice(text)
                  if (selected?.geometry.type === 'Polygon')
                    onPilotAdded?.(
                      selected.id,
                      selected.geometry.coordinates[0].map(([x, y]) => [x, y] as Coordinate),
                    )
                } catch (cause) {
                  setError(message(cause))
                  report('pilot', 'error', message(cause), null)
                }
              }}
            >
              Add records to this project
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPilot(null)
                report('pilot', 'cancelled', 'Preview dismissed. Saved project records were not changed.', null)
              }}
            >
              Dismiss preview
            </Button>
          </div>
        </div>
      )}
      <details ref={detailsRef} className="space-y-2 text-xs" data-testid="history-source-tools">
        <summary className="cursor-pointer font-medium">Ministry records &amp; structure files</summary>
        <div className="flex items-start gap-1">
          <p className="min-w-0 flex-1 text-2xs text-muted-foreground">
            Check a block's opening identity and load open road segments around the selected block and its access
            anchors.
          </p>
          <InfoTip label="About access-history data sources">
            Road queries cover the selected block and saved entrances and outlets with a 1 km buffer, or the project
            alignments when no block is selected. Broad queries must be split into smaller study areas. RESULTS
            openings, FTEN cutblocks and FTEN road segments have open reuse terms in the source registry. Bridge and
            PSCIS extracts are imported locally by the user; their Access Only terms still apply. Restricted BCTS Block
            Access Roads is a reference, not a live lookup.
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
            report('structures', 'loading', 'Reading the local structure extract.')
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
              report(
                'structures',
                'success',
                `${result.structures.length} structure records imported; review attachment, chronology and reports.`,
              )
              latest.current.setNotice(
                `Imported ${result.structures.length} structure records. Review attachments, dates and conflicting reports.`,
              )
            } catch (cause) {
              setError(message(cause))
              report('structures', 'error', message(cause))
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
    </div>
  )
}
