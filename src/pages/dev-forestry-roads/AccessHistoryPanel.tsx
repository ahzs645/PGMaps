import { useMemo, useRef, useState } from 'react'
import { LocateFixed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileDropField } from '@/components/ui/file-drop-field'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import {
  MAX_HISTORY_IMPORT_BYTES,
  assessHistoricalPath,
  createAccessHistoryState,
  historicalInputFingerprint,
  mergeHistoricalTrace,
  parseAccessHistoryState,
  reviewHistoricalPath,
  roadGeometryFingerprint,
  traceHistoricalAccess,
} from './accessHistory'
import type {
  HistoricalAccessPath,
  HistoricalAccessState,
  HistoricalAnchor,
  HistoricalRelationship,
  HistoricalSource,
  HistoricalTraceResult,
} from './accessHistoryTypes'
import {
  accessHistoryBundle,
  accessHistoryReport,
  applyAccessHistoryBundle,
  parseAccessHistoryBundle,
  type AccessHistoryBundle,
} from './AccessHistoryIO'
import { Field, NumberField, RoadSelect, roadFieldClass } from './Controls'
import { RoadSection } from './SidebarParts'
import type { ContextFeature, Coordinate, RoadProject } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'
import { AccessHistorySourcesPanel } from './AccessHistorySourcesPanel'
import { AccessHistoryEvidence } from './AccessHistoryEvidence'

const relationshipLabels: Record<HistoricalRelationship, string> = {
  proximity: 'Nearby only',
  'inferred-access': 'Inferred access',
  'planned-access': 'Documented plan',
  'documented-use': 'Documented use',
  rejected: 'Rejected association',
}
const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : 'Could not update access history.')
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
const dateWindow = (when: { earliest: string | null; latest: string | null } | null) =>
  when ? `${when.earliest ?? 'unknown'} – ${when.latest ?? 'unknown'}` : 'unknown'

function SourceLink({ source }: { source: HistoricalSource }) {
  if (!source.url)
    return (
      <span>
        {source.dataset} · {source.recordId}
        {source.synthetic ? ' · synthetic' : ''}
      </span>
    )
  return (
    <a className="break-words underline" href={source.url} target="_blank" rel="noreferrer">
      {source.dataset} · {source.recordId}
      {source.synthetic ? ' · synthetic' : ''}
    </a>
  )
}

/** History has its own evidence ledger; no action here enables an existing road for reuse. */
export function AccessHistoryPanel({
  workspace: w,
  onLocate,
}: {
  workspace: RoadWorkspace
  onLocate?: (coordinates: Coordinate[]) => void
}) {
  const fallback = useMemo(() => createAccessHistoryState(), [])
  const history = w.project.accessHistory ?? fallback
  const [selectedBlock, setSelectedBlock] = useState('')
  const [error, setError] = useState('')
  const [lastTrace, setLastTrace] = useState<{ result: HistoricalTraceResult; blockId: string; scope: string } | null>(
    null,
  )
  const [pending, setPending] = useState<{ bundle: AccessHistoryBundle; project: RoadProject; name: string } | null>(
    null,
  )
  const [importing, setImporting] = useState(false)
  const latest = useRef(w)
  latest.current = w
  const blocks = w.project.context.filter(
    (feature) => feature.kind === 'harvest' && feature.geometry.type === 'Polygon',
  )
  const roads = w.project.context.filter(
    (feature) => feature.kind === 'existing-road' && feature.geometry.type === 'LineString',
  )
  const savedSelection = history.paths.find((path) => path.id === history.selectedPathId)
  const block =
    blocks.find((feature) => feature.id === selectedBlock) ??
    blocks.find((feature) => feature.id === savedSelection?.blockId) ??
    blocks[0]
  const scope = `${w.projectId ?? 'unsaved'}:${w.project.activeAlignmentId}`
  const paths = history.paths.filter((path) => path.blockId === block?.id)
  const selectedPath = paths.find((path) => path.id === history.selectedPathId) ?? paths[0]
  const traversedRoadIds =
    selectedPath?.segments.reduce<string[]>((ids, segment) => {
      if (segment.kind === 'road' && segment.roadId && ids.at(-1) !== segment.roadId) ids.push(segment.roadId)
      return ids
    }, []) ?? []
  const inputFingerprint = useMemo(
    () => historicalInputFingerprint(w.project.context, history),
    [w.project.context, history],
  )
  const previousTrace = lastTrace?.scope === scope && lastTrace.blockId === block?.id ? lastTrace.result : null
  const trace = previousTrace?.inputFingerprint === inputFingerprint ? previousTrace : null
  const assessment = selectedPath ? assessHistoricalPath(selectedPath, history, w.project.context) : null
  const disabled = !!w.busy || importing
  const change = (edit: (state: HistoricalAccessState) => HistoricalAccessState) => {
    setError('')
    try {
      latest.current.update((project) => ({
        ...project,
        accessHistory: parseAccessHistoryState(edit(project.accessHistory ?? fallback), project.context),
      }))
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    }
  }
  const guarded = (action: () => void) => {
    setError('')
    try {
      action()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }
  const traceRoutes = () =>
    guarded(() => {
      if (!block) throw Error('Select a cutblock before tracing access.')
      const result = traceHistoricalAccess({ context: w.project.context, state: history, blockId: block.id })
      if (change((state) => mergeHistoricalTrace(state, result))) {
        setLastTrace({ result, blockId: block.id, scope })
        w.setNotice(
          `${result.paths.length} historical access candidate${result.paths.length === 1 ? '' : 's'} saved for review.`,
        )
      }
    })

  return (
    <RoadSection
      title="Access history"
      summary={`${blocks.length} blocks · ${history.paths.length} route assertions`}
      toggleTestId="road-access-history-toggle"
      help={
        <>
          Trace explicit block entrances through the mapped road network to explicit outlets. Date evidence can exclude
          roads that did not yet exist or were closed. Unknown timing and unverified endpoint connections require
          separate assumptions. A connected candidate does not establish who built the road or why it was built.
          Reviewed source references remain separate from inference and current road reuse.
        </>
      }
    >
      <div className="space-y-3" data-testid="road-access-history">
        {error && <InlineAlert tone="warning">{error}</InlineAlert>}
        {history.sources.length > 0 && history.sources.every((source) => source.synthetic) && (
          <InlineAlert tone="info">
            Synthetic worked example. Its roads, dates and structure reports are teaching records.
          </InlineAlert>
        )}
        {blocks.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Add a cutblock in Cutblocks &amp; harvest history, or import an access-history bundle.
          </p>
        ) : (
          <Field label="Access-history cutblock">
            <RoadSelect
              ariaLabel="Access-history cutblock"
              value={block?.id ?? ''}
              disabled={disabled}
              onValueChange={(id) => {
                setSelectedBlock(id)
                setError('')
                change((state) => ({
                  ...state,
                  selectedPathId: state.paths.find((path) => path.blockId === id)?.id ?? null,
                }))
              }}
              options={blocks.map((feature) => ({ value: feature.id, label: feature.name }))}
            />
          </Field>
        )}
        <AccessHistorySourcesPanel workspace={w} block={block} disabled={disabled} />
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Historical date"
            hint={`Date for the next access trace. Saved routes keep their own dates. Cutblock age colours use the separate harvest-age reference year (${w.project.harvestHistoryYear ?? new Date().getFullYear()}).`}
          >
            <input
              type="date"
              className={roadFieldClass}
              value={history.settings.asOf}
              disabled={disabled}
              onChange={(event) =>
                change((state) => ({ ...state, settings: { ...state.settings, asOf: event.target.value } }))
              }
            />
          </Field>
          <div className="self-end text-2xs text-muted-foreground">
            {roads.length} mapped roads · {history.structures.length} structures
          </div>
        </div>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={history.settings.allowUnknownTime}
            disabled={disabled}
            onChange={(event) =>
              change((state) => ({ ...state, settings: { ...state.settings, allowUnknownTime: event.target.checked } }))
            }
          />
          <span>Include roads and structures with unknown historical timing</span>
        </label>
        <details className="space-y-2 text-xs">
          <summary className="cursor-pointer font-medium">Connection assumptions</summary>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={history.settings.allowUnverifiedEndpointSnaps}
              disabled={disabled}
              onChange={(event) =>
                change((state) => ({
                  ...state,
                  settings: { ...state.settings, allowUnverifiedEndpointSnaps: event.target.checked },
                }))
              }
            />
            <span>Allow unverified connections between nearby road endpoints</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Endpoint tolerance (m)"
              value={history.settings.snapToleranceM}
              min={0}
              max={50}
              disabled={disabled}
              onChange={(value) =>
                change((state) => ({ ...state, settings: { ...state.settings, snapToleranceM: value } }))
              }
            />
            <NumberField
              label="Anchor tolerance (m)"
              value={history.settings.attachmentToleranceM}
              min={0}
              max={50}
              disabled={disabled}
              onChange={(value) =>
                change((state) => ({ ...state, settings: { ...state.settings, attachmentToleranceM: value } }))
              }
            />
          </div>
          <p className="text-2xs text-muted-foreground">
            A crossing of two lines is not automatically a junction. Review gaps and road levels before accepting a
            connection.
          </p>
        </details>
        <AnchorEditor
          key={`anchors:${scope}:${block?.id ?? ''}`}
          block={block}
          history={history}
          roads={roads}
          alignmentPoints={w.alignment?.points.map((point) => point.coordinate) ?? []}
          disabled={disabled}
          onChange={change}
          onError={setError}
          onLocate={onLocate}
        />
        <Button size="sm" variant="outline" className="w-full" disabled={disabled || !block} onClick={traceRoutes}>
          Trace historical access
        </Button>
        {previousTrace && !trace && (
          <p className="text-xs text-muted-foreground" data-testid="history-trace-changed">
            Trace inputs changed. Trace again to update candidates and exclusion reasons; saved assertions retain their
            original date and evidence.
          </p>
        )}
        {trace && (
          <div className="space-y-2 rounded-md border p-2 text-xs" data-testid="history-trace-results">
            <p className="font-medium">
              {trace.paths.length} candidates · {trace.excludedRoads.length} excluded roads
            </p>
            {trace.unresolved.length > 0 && (
              <InlineAlert tone="warning">
                <ul className="list-disc space-y-1 pl-4">
                  {trace.unresolved.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </InlineAlert>
            )}
            {trace.excludedRoads.length > 0 && (
              <details>
                <summary className="cursor-pointer">Why roads were excluded</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {trace.excludedRoads.map((road) => (
                    <li key={road.roadId}>
                      {road.name}: {road.reasons.join(' ')}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {trace.structures.length > 0 && (
              <details>
                <summary className="cursor-pointer">Structure evidence and conflicts</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {trace.structures.map((item) => (
                    <li key={item.structureId}>
                      {history.structures.find((structure) => structure.id === item.structureId)?.name ??
                        item.structureId}
                      : {item.status}. {item.reasons.join(' ')}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {selectedPath && assessment && (
          <div className="space-y-2 rounded-md border bg-muted/20 p-2.5" data-testid="history-selected-path">
            <Field label="Historical route">
              <RoadSelect
                ariaLabel="Historical route"
                value={selectedPath.id}
                disabled={disabled}
                onValueChange={(id) => change((state) => ({ ...state, selectedPathId: id }))}
                options={paths.map((path, index) => ({
                  value: path.id,
                  label: `${index + 1}. ${relationshipLabels[path.relationship]} · ${(path.lengthM / 1000).toFixed(2)} km · ${path.period.latest ?? path.period.earliest ?? 'date unknown'}`,
                }))}
              />
            </Field>
            <div className="flex items-center gap-1">
              <p className="min-w-0 flex-1 text-xs font-medium">{relationshipLabels[selectedPath.relationship]}</p>
              {onLocate && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label="Locate historical route"
                  disabled={disabled}
                  onClick={() => {
                    if (
                      history.selectedPathId !== selectedPath.id &&
                      !change((state) => ({ ...state, selectedPathId: selectedPath.id }))
                    )
                      return
                    onLocate(selectedPath.coordinates)
                  }}
                >
                  <LocateFixed className="size-4" />
                </Button>
              )}
              <InfoTip label="About historical route assertions">
                The route is a connection hypothesis unless a reviewed source documents its use. A review does not grant
                current access or enable a road in the reuse cost scenario.
              </InfoTip>
            </div>
            <KeyValueRows
              variant="grid"
              rows={[
                { key: 'date', label: 'Period', value: dateWindow(selectedPath.period) },
                { key: 'length', label: 'Mapped length', value: `${selectedPath.lengthM.toFixed(0)} m` },
                {
                  key: 'roads',
                  label: 'Roads',
                  value:
                    traversedRoadIds.map((id) => roads.find((road) => road.id === id)?.name ?? id).join(' → ') ||
                    'No physical road sequence retained',
                },
                {
                  key: 'structures',
                  label: 'Structures',
                  value: selectedPath.structureIds.length
                    ? selectedPath.structureIds
                        .map((id) => history.structures.find((structure) => structure.id === id)?.name ?? id)
                        .join(', ')
                    : 'None recorded; completeness unknown',
                },
              ]}
            />
            {assessment.stale && (
              <InlineAlert tone="warning">
                This assertion was created with different inputs. Trace again and review the changed evidence.
              </InlineAlert>
            )}
            {assessment.reasons.length > 0 && (
              <InlineAlert tone="warning">
                <ul className="list-disc space-y-1 pl-4">
                  {assessment.reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </InlineAlert>
            )}
            {selectedPath.assumptions.length > 0 && (
              <ul className="list-disc space-y-1 pl-4 text-2xs">
                {selectedPath.assumptions.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            )}
            {selectedPath.sourceIds.map((id) => {
              const source = history.sources.find((item) => item.id === id)
              return source ? (
                <p key={id} className="text-2xs">
                  <SourceLink source={source} />
                </p>
              ) : null
            })}
            {selectedPath.review && (
              <p className="text-2xs">
                Reviewed by {selectedPath.review.reviewer} · {selectedPath.review.reviewedOn} ·{' '}
                {selectedPath.review.reference}
              </p>
            )}
            <PathReviewEditor
              key={`${scope}:${selectedPath.id}`}
              path={selectedPath}
              history={history}
              disabled={disabled}
              onReview={(relationship, review, sourceIds) =>
                change((state) =>
                  reviewHistoricalPath(state, selectedPath.id, relationship, review, sourceIds, w.project.context),
                )
              }
            />
          </div>
        )}
        <AccessHistoryEvidence history={history} context={w.project.context} onLocate={onLocate} />
        <SourceEditor key={`source:${scope}`} disabled={disabled} onChange={change} />
        <HistoryJsonEditor
          key={`json:${scope}`}
          history={history}
          context={w.project.context}
          disabled={disabled}
          onSave={(next, baseline) =>
            change((current) => {
              if (JSON.stringify(current) !== baseline)
                throw Error(
                  'Saved history changed while you were editing. Download your draft, then load the saved history and reconcile your edits.',
                )
              return next
            })
          }
        />
        <details className="space-y-2 text-xs">
          <summary className="cursor-pointer font-medium">Import, export and restore</summary>
          <FileDropField
            label="Access history bundle"
            filesLabel="Import history bundle"
            accept=".json,application/json"
            disabled={disabled}
            dropHint="one JSON bundle, up to 10 MB"
            onError={(cause) => setError(errorMessage(cause))}
            inputProps={{ 'data-testid': 'history-bundle-input' }}
            onFiles={async (files) => {
              setError('')
              setPending(null)
              setImporting(true)
              const project = latest.current.project
              try {
                if (files.length !== 1) throw Error('Choose one access-history bundle at a time.')
                const file = files[0].file
                if (file.size > MAX_HISTORY_IMPORT_BYTES) throw Error('Import at most 10 MB of access history.')
                const bundle = parseAccessHistoryBundle(await file.text())
                if (latest.current.project !== project)
                  throw Error('The project changed during import. Import again in the intended project.')
                applyAccessHistoryBundle(project, bundle)
                setPending({ bundle, project, name: file.name })
              } catch (cause) {
                setError(errorMessage(cause))
              } finally {
                setImporting(false)
              }
            }}
          />
          {pending && (
            <div className="space-y-2 rounded border p-2" data-testid="history-import-preview">
              <p>
                {pending.name}: {pending.bundle.context.length} map features ·{' '}
                {pending.bundle.accessHistory.paths.length} assertions.
              </p>
              <p className="text-2xs text-muted-foreground">
                Apply replaces the saved access-history ledger and adds its map features. Other project settings stay in
                this project.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    guarded(() => {
                      if (latest.current.project !== pending.project)
                        throw Error(
                          'The project changed after this import preview. Import the bundle again before applying it.',
                        )
                      latest.current.update((project) => applyAccessHistoryBundle(project, pending.bundle))
                      setSelectedBlock('')
                      setPending(null)
                      setLastTrace(null)
                      w.setNotice('Imported access history. New roads remain disabled for reuse.')
                    })
                  }
                >
                  Apply imported history
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                  Cancel import
                </Button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                guarded(() =>
                  downloadText(
                    accessHistoryBundle(w.project.context, history),
                    'forestry-access-history.json',
                    'application/json',
                  ),
                )
              }
            >
              Export history bundle
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                guarded(() =>
                  downloadText(
                    accessHistoryReport(w.project.name, w.project.context, history),
                    'forestry-access-history-report.md',
                    'text/markdown',
                  ),
                )
              }
            >
              Export review report
            </Button>
          </div>
          <Button size="sm" variant="ghost" disabled={disabled || !w.canUndo} onClick={() => w.undo()}>
            Undo last project change
          </Button>
          <p className="text-2xs text-muted-foreground">
            Saved history travels with the road project. Export a bundle to retain its roads, blocks and source
            references outside this browser.
          </p>
        </details>
      </div>
    </RoadSection>
  )
}

function AnchorEditor({
  block,
  history,
  roads,
  alignmentPoints,
  disabled,
  onChange,
  onError,
  onLocate,
}: {
  block?: ContextFeature
  history: HistoricalAccessState
  roads: ContextFeature[]
  alignmentPoints: Coordinate[]
  disabled: boolean
  onChange: (edit: (state: HistoricalAccessState) => HistoricalAccessState) => boolean
  onError: (message: string) => void
  onLocate?: (coordinates: Coordinate[]) => void
}) {
  const [editing, setEditing] = useState('new')
  const [role, setRole] = useState<HistoricalAnchor['role']>('entrance')
  const [name, setName] = useState('')
  const [longitude, setLongitude] = useState('')
  const [latitude, setLatitude] = useState('')
  const [roadId, setRoadId] = useState('none')
  const [sourceId, setSourceId] = useState('none')
  const anchors = history.anchors.filter((anchor) => anchor.role === 'outlet' || anchor.blockId === block?.id)
  const pickCoordinate = (coordinate?: Coordinate) => {
    if (!coordinate) return
    setLongitude(String(coordinate[0]))
    setLatitude(String(coordinate[1]))
  }
  const select = (id: string) => {
    setEditing(id)
    const anchor = history.anchors.find((item) => item.id === id)
    if (!anchor) {
      setName('')
      setLongitude('')
      setLatitude('')
      setRoadId('none')
      setSourceId('none')
      return
    }
    setRole(anchor.role)
    setName(anchor.name)
    pickCoordinate(anchor.coordinate)
    setRoadId(anchor.roadId ?? 'none')
    setSourceId(anchor.sourceIds[0] ?? 'none')
  }
  return (
    <details className="space-y-2 text-xs">
      <summary className="cursor-pointer font-medium">
        Entrances &amp; outlets · {anchors.filter((anchor) => anchor.role === 'entrance').length} /{' '}
        {anchors.filter((anchor) => anchor.role === 'outlet').length}
      </summary>
      <p className="text-2xs text-muted-foreground">
        Choose the block boundary or landing used for access, and the road-network outlet. No block centre is
        substituted.
      </p>
      <Field label="Edit access anchor">
        <RoadSelect
          ariaLabel="Edit access anchor"
          value={editing}
          disabled={disabled}
          onValueChange={select}
          options={[
            { value: 'new', label: 'Add an entrance or outlet' },
            ...anchors.map((anchor) => ({ value: anchor.id, label: `${anchor.name} · ${anchor.role}` })),
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Anchor role">
          <RoadSelect
            ariaLabel="Anchor role"
            value={role}
            disabled={disabled}
            onValueChange={(value) => setRole(value as HistoricalAnchor['role'])}
          >
            <option value="entrance">Block entrance</option>
            <option value="outlet">Network outlet</option>
          </RoadSelect>
        </Field>
        <Field label="Anchor name">
          <input
            className={roadFieldClass}
            value={name}
            disabled={disabled}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Anchor longitude">
          <input
            className={roadFieldClass}
            inputMode="decimal"
            value={longitude}
            disabled={disabled}
            placeholder="-122.7"
            onChange={(event) => setLongitude(event.target.value)}
          />
        </Field>
        <Field label="Anchor latitude">
          <input
            className={roadFieldClass}
            inputMode="decimal"
            value={latitude}
            disabled={disabled}
            placeholder="53.9"
            onChange={(event) => setLatitude(event.target.value)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || !alignmentPoints.length}
          onClick={() => pickCoordinate(alignmentPoints[0])}
        >
          Use alignment start
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || !alignmentPoints.length}
          onClick={() => pickCoordinate(alignmentPoints.at(-1))}
        >
          Use alignment end
        </Button>
      </div>
      <Field label="Anchor road">
        <RoadSelect
          ariaLabel="Anchor road"
          value={roadId}
          disabled={disabled}
          onValueChange={setRoadId}
          options={[
            { value: 'none', label: 'Find nearby road within tolerance' },
            ...roads.map((road) => ({ value: road.id, label: road.name })),
          ]}
        />
      </Field>
      <Field label="Anchor source">
        <RoadSelect
          ariaLabel="Anchor source"
          value={sourceId}
          disabled={disabled}
          onValueChange={setSourceId}
          options={[
            { value: 'none', label: 'User placement; no source asserted' },
            ...history.sources.map((source) => ({ value: source.id, label: `${source.dataset} · ${source.recordId}` })),
          ]}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || (role === 'entrance' && !block)}
          onClick={() => {
            if (
              !longitude.trim() ||
              !latitude.trim() ||
              !Number.isFinite(Number(longitude)) ||
              !Number.isFinite(Number(latitude))
            ) {
              onError('Enter both longitude and latitude for the anchor.')
              return
            }
            const existing = history.anchors.find((anchor) => anchor.id === editing)
            const anchor: HistoricalAnchor = {
              id: existing?.id ?? newId('anchor'),
              name: name.trim(),
              role,
              coordinate: [Number(longitude), Number(latitude)],
              roadId: roadId === 'none' ? null : roadId,
              blockId: role === 'entrance' ? block!.id : null,
              sourceIds: [
                ...new Set([...(sourceId === 'none' ? [] : [sourceId]), ...(existing?.sourceIds.slice(1) ?? [])]),
              ],
            }
            if (
              onChange((state) => ({
                ...state,
                anchors: existing
                  ? state.anchors.map((item) => (item.id === existing.id ? anchor : item))
                  : [...state.anchors, anchor],
              }))
            )
              setEditing(anchor.id)
          }}
        >
          {editing === 'new' ? 'Add anchor' : 'Save anchor'}
        </Button>
        {(history.anchors.find((anchor) => anchor.id === editing)?.sourceIds.length ?? 0) > 1 && (
          <p className="text-2xs text-muted-foreground">
            Additional source references are retained. Edit the saved ledger to change them.
          </p>
        )}
        {editing !== 'new' && onLocate && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const anchor = history.anchors.find((item) => item.id === editing)
              if (anchor) onLocate([anchor.coordinate])
            }}
          >
            Locate saved anchor
          </Button>
        )}
      </div>
    </details>
  )
}

function PathReviewEditor({
  path,
  history,
  disabled,
  onReview,
}: {
  path: HistoricalAccessPath
  history: HistoricalAccessState
  disabled: boolean
  onReview: (
    relationship: HistoricalRelationship,
    review: NonNullable<HistoricalAccessPath['review']>,
    sourceIds: string[],
  ) => boolean
}) {
  const [relationship, setRelationship] = useState<HistoricalRelationship>(path.relationship)
  const [reviewer, setReviewer] = useState(path.review?.reviewer ?? '')
  const [reference, setReference] = useState(path.review?.reference ?? '')
  const [reviewedOn, setReviewedOn] = useState(today())
  const [sourceId, setSourceId] = useState(path.sourceIds[0] ?? '')
  return (
    <details className="space-y-2 text-xs">
      <summary className="cursor-pointer font-medium">Review this association</summary>
      <Field label="Reviewed relationship">
        <RoadSelect
          ariaLabel="Reviewed relationship"
          value={relationship}
          disabled={disabled}
          onValueChange={(value) => setRelationship(value as HistoricalRelationship)}
          options={Object.entries(relationshipLabels).map(([value, label]) => ({ value, label }))}
        />
      </Field>
      <Field label="Review source">
        <RoadSelect
          ariaLabel="Review source"
          value={sourceId}
          disabled={disabled}
          onValueChange={setSourceId}
          placeholder="Select a source reference"
          options={history.sources.map((source) => ({
            value: source.id,
            label: `${source.dataset} · ${source.recordId}`,
          }))}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Reviewer">
          <input
            className={roadFieldClass}
            value={reviewer}
            disabled={disabled}
            maxLength={200}
            onChange={(event) => setReviewer(event.target.value)}
          />
        </Field>
        <Field label="Review date">
          <input
            type="date"
            className={roadFieldClass}
            value={reviewedOn}
            disabled={disabled}
            onChange={(event) => setReviewedOn(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Evidence reference and reasoning">
        <textarea
          className={roadFieldClass}
          rows={3}
          value={reference}
          disabled={disabled}
          maxLength={2000}
          placeholder="Document page, map label or observation that supports this relationship"
          onChange={(event) => setReference(event.target.value)}
        />
      </Field>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || !sourceId || !reviewer.trim() || !reference.trim()}
        onClick={() => onReview(relationship, { reviewer, reviewedOn, reference }, [sourceId])}
      >
        Save reviewed assertion
      </Button>
    </details>
  )
}

function SourceEditor({
  disabled,
  onChange,
}: {
  disabled: boolean
  onChange: (edit: (state: HistoricalAccessState) => HistoricalAccessState) => boolean
}) {
  const [dataset, setDataset] = useState('')
  const [recordId, setRecordId] = useState('')
  const [url, setUrl] = useState('')
  const [publishedOn, setPublishedOn] = useState('')
  const [description, setDescription] = useState('')
  return (
    <details className="space-y-2 text-xs">
      <summary className="cursor-pointer font-medium">Add a source reference</summary>
      <Field label="Source title">
        <input
          className={roadFieldClass}
          value={dataset}
          disabled={disabled}
          maxLength={200}
          onChange={(event) => setDataset(event.target.value)}
        />
      </Field>
      <Field label="Source record ID">
        <input
          className={roadFieldClass}
          value={recordId}
          disabled={disabled}
          maxLength={200}
          onChange={(event) => setRecordId(event.target.value)}
        />
      </Field>
      <Field label="Source URL (if available)">
        <input
          className={roadFieldClass}
          type="url"
          value={url}
          disabled={disabled}
          placeholder="https://…"
          maxLength={2000}
          onChange={(event) => setUrl(event.target.value)}
        />
      </Field>
      <Field label="Source publication date (if known)">
        <input
          className={roadFieldClass}
          type="date"
          value={publishedOn}
          disabled={disabled}
          onChange={(event) => setPublishedOn(event.target.value)}
        />
      </Field>
      <Field label="Source notes">
        <textarea
          className={roadFieldClass}
          value={description}
          disabled={disabled}
          rows={2}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || !dataset.trim() || !recordId.trim() || !description.trim()}
        onClick={() => {
          const source: HistoricalSource = {
            id: newId('source'),
            dataset,
            recordId,
            url,
            publishedOn: publishedOn || null,
            retrievedAt: new Date().toISOString(),
            description,
            synthetic: false,
          }
          if (onChange((state) => ({ ...state, sources: [...state.sources, source] }))) {
            setDataset('')
            setRecordId('')
            setUrl('')
            setPublishedOn('')
            setDescription('')
          }
        }}
      >
        Add source reference
      </Button>
    </details>
  )
}

function HistoryJsonEditor({
  history,
  context,
  disabled,
  onSave,
}: {
  history: HistoricalAccessState
  context: ContextFeature[]
  disabled: boolean
  onSave: (state: HistoricalAccessState, baseline: string) => boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [baseline, setBaseline] = useState('')
  const [error, setError] = useState('')
  const current = JSON.stringify(history)
  const load = () => {
    setDraft(JSON.stringify(history, null, 2))
    setBaseline(current)
    setError('')
  }
  const insert = (kind: 'event' | 'structure') => {
    setError('')
    try {
      const next = JSON.parse(draft ?? JSON.stringify(history)) as HistoricalAccessState
      const road = context.find((feature) => feature.kind === 'existing-road' && feature.geometry.type === 'LineString')
      if (!road || road.geometry.type !== 'LineString')
        throw Error('Add an existing road before making an evidence template.')
      const sourceIds = next.sources[0] ? [next.sources[0].id] : ['add-a-source-reference']
      if (kind === 'event')
        next.events.push({
          id: newId('event'),
          roadId: road.id,
          kind: 'present-observed',
          when: { earliest: null, latest: null },
          observedOn: null,
          sourceIds,
          geometryFingerprint: roadGeometryFingerprint(road),
        })
      else
        next.structures.push({
          id: newId('structure'),
          name: 'Enter crossing name',
          kind: 'unknown',
          coordinate: road.geometry.coordinates[0].slice(0, 2) as Coordinate,
          sourceIds,
          crossingSiteId: null,
          structureId: null,
          sourceRowId: null,
          roadId: road.id,
          roadKey: null,
          attachment: 'unresolved',
          attachmentToleranceM: 30,
          construction: null,
          removal: null,
          evidence: [],
        })
      if (draft === null) setBaseline(current)
      setDraft(JSON.stringify(next, null, 2))
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }
  return (
    <details className="space-y-2 text-xs">
      <summary className="cursor-pointer font-medium">Edit events and structure evidence</summary>
      <p className="text-2xs text-muted-foreground">
        Edit the saved ledger as JSON. Add a source reference first. Physical event dates, observed dates and
        conflicting structure reports stay separate.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={disabled} onClick={load}>
          {draft === null ? 'Edit saved ledger' : 'Replace draft with saved ledger'}
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => insert('event')}>
          Add event template
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => insert('structure')}>
          Add structure template
        </Button>
      </div>
      {draft !== null && (
        <>
          {baseline !== current && (
            <InlineAlert tone="warning">
              Saved history changed while this draft was open. Download the draft before loading the saved ledger to
              reconcile changes.
            </InlineAlert>
          )}
          <Field label="Access history JSON draft">
            <textarea
              className={`${roadFieldClass} font-mono`}
              rows={14}
              value={draft}
              spellCheck={false}
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          {error && <InlineAlert tone="warning">{error}</InlineAlert>}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={disabled || baseline !== current}
              onClick={() => {
                setError('')
                try {
                  if (new TextEncoder().encode(draft).byteLength > MAX_HISTORY_IMPORT_BYTES)
                    throw Error('Keep the history ledger below 10 MB.')
                  const next = parseAccessHistoryState(JSON.parse(draft), context)
                  if (onSave(next, baseline)) {
                    setDraft(null)
                    setBaseline('')
                  }
                } catch (cause) {
                  setError(errorMessage(cause))
                }
              }}
            >
              Validate and save ledger
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => downloadText(draft, 'forestry-access-history-draft.txt', 'text/plain')}
            >
              Download draft
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setDraft(null)
                setError('')
              }}
            >
              Discard draft
            </Button>
          </div>
        </>
      )}
    </details>
  )
}
