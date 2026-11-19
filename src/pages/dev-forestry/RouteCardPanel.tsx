/**
 * Step 1's *Route card*: the block's Route Card Tool Assessment read live from public BC layers, the rows no public
 * layer answers entered by the reviewer or measured from their own file, and the Other Considerations paragraphs
 * drafted from it. The same render Save & export writes as the workbook and the Word file (`assembleRouteCard`), so
 * what is shown here is what prints. A screen and a draft: it never changes the run.
 */
import { FileUp, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DisclosureRow } from '@/components/ui/disclosure'
import { FileButton } from '@/components/ui/file-button'
import { FORM_INPUT_CLASS, StyledSelect } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ExternalLink } from '@/components/ui/text-button'
import type { AssembledRouteCard } from '@/lib/forestry/routeCard/assemble'
import type { ConsiderationInputs } from '@/lib/forestry/routeCard/facts'
import type { RouteCardMapFigure } from '@/lib/forestry/routeCard/figures'
import { planarBounds, prepareSubject, type Planar } from '@/lib/forestry/routeCard/geometry'
import { entryFromImport, importedFields, rowsFilledByFields } from '@/lib/forestry/routeCard/imported'
import type { ReadFeature } from '@/lib/forestry/routeCard/query'
import type { RouteCardEntry, RouteCardPrintedRow } from '@/lib/forestry/routeCard/results'
import { withBlockReview, type RouteCardBlockReview, type RouteCardReview } from '@/lib/forestry/routeCard/review'
import {
  ROUTE_CARD_ROWS,
  routeCardRow,
  type ConsiderationId,
  type RouteCardPreset,
} from '@/lib/forestry/routeCard/rows'
import { cn } from '@/lib/utils'

import { readRouteCardLayerFile, type LayerFileRead } from './routeCardLayerFile'
import { toFeatures } from './shapeImport'
import type { TargetPolygon } from './types'
import type { RouteCardRun } from './useRouteCard'

const TEXTAREA_CLASS = `${FORM_INPUT_CLASS} min-h-24 leading-5`

type Show = 'flagged' | 'enter' | 'all'

const VALUE_TONE = (row: RouteCardPrintedRow) =>
  row.value === 'Y'
    ? ('warning' as const)
    : row.value.startsWith('Within')
      ? ('info' as const)
      : row.value === 'Not read'
        ? ('danger' as const)
        : row.value === 'Not public'
          ? ('violet' as const)
          : ('neutral' as const)

/** A picked GIS file as GeoJSON with its attributes: a zipped shapefile through shpjs (which reads its `.prj`), or GeoJSON. */
async function readLayerFile(file: File): Promise<unknown> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.zip')) {
    const shp = (await import('shpjs')).default
    return shp(await file.arrayBuffer())
  }
  if (name.endsWith('.geojson') || name.endsWith('.json')) return JSON.parse(await file.text())
  throw new Error('Choose a zipped shapefile (.zip) or a GeoJSON file.')
}

export type RouteCardPanelProps = {
  blocks: readonly TargetPolygon[]
  block: TargetPolygon | null
  blockShape: Planar | null
  onBlockChange: (id: string) => void
  presets: readonly RouteCardPreset[]
  preset: RouteCardPreset
  onPresetChange: (id: string) => void
  run: RouteCardRun
  assembled: AssembledRouteCard | null
  engineError: string | null
  review: RouteCardReview | undefined
  onReviewChange: (next: RouteCardReview) => void
  onOpenExport: () => void
  /** Layer files read this session (the fisher layer, a RAAD export): kept in memory only, never stored. */
  sessionLayers: readonly SessionLayer[]
  onSessionLayer: (layer: SessionLayer) => void
}

export type SessionLayer = { file: File; read: LayerFileRead; blockId: string | null }

export function RouteCardPanel({
  blocks,
  block,
  blockShape,
  onBlockChange,
  presets,
  preset,
  onPresetChange,
  run,
  assembled,
  engineError,
  review,
  onReviewChange,
  onOpenExport,
  sessionLayers,
  onSessionLayer,
}: RouteCardPanelProps) {
  const [show, setShow] = useState<Show>('flagged')
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState<{
    rowId: string
    file: string
    features: ReadFeature[]
    fields: string[]
    realFields: ReadonlySet<string>
  } | null>(null)
  const blockReview: RouteCardBlockReview = (block && review?.blocks?.[block.id]) || {}
  const changeBlock = (change: (current: RouteCardBlockReview) => RouteCardBlockReview) => {
    if (block) onReviewChange(withBlockReview(review, block.id, change))
  }
  const setEntry = (rowId: string, entry: RouteCardEntry | null) =>
    changeBlock((current) => {
      const entries = { ...current.entries }
      if (entry) entries[rowId] = entry
      else delete entries[rowId]
      return { ...current, entries }
    })
  const setOwn = (id: ConsiderationId, text: string | null) =>
    changeBlock((current) => {
      const own = { ...current.own }
      if (text) own[id] = text
      else delete own[id]
      return { ...current, own }
    })
  const setInput = (key: keyof ConsiderationInputs, value: string) =>
    changeBlock((current) => ({ ...current, inputs: { ...current.inputs, [key]: value } }))

  const subject = useMemo(() => (blockShape ? prepareSubject(blockShape) : null), [blockShape])
  const today = new Date().toISOString().slice(0, 10)

  /** Measures one block with a read layer: every row the file names a field of, or the row it was picked for. */
  const measureWith = (layer: SessionLayer, rowId: string | null) => {
    if (!subject || !block) return
    const fields = importedFields(layer.read.features)
    const filled = rowsFilledByFields(ROUTE_CARD_ROWS, fields)
    const source = `${layer.read.label}${layer.read.version ? ` (version ${layer.read.version})` : ''}`
    if (filled.length) {
      changeBlock((current) => {
        const entries = { ...current.entries }
        for (const row of filled)
          entries[row.id] = entryFromImport(
            row,
            subject,
            layer.read.features,
            row.source.kind === 'notPublic' ? row.source.importField! : '',
            source,
            today,
            layer.read.realFields,
          )
        return { ...current, entries }
      })
      setMessage(
        `${layer.read.label} filled ${filled.length} row${filled.length === 1 ? '' : 's'} for ${block.name}: ${filled.map((row) => row.label).join(', ')}.`,
      )
      return
    }
    if (rowId)
      setPending({ rowId, file: source, features: layer.read.features, fields, realFields: layer.read.realFields })
  }

  const importInto = async (rowId: string, file: File) => {
    setMessage(null)
    if (!blockShape) return
    try {
      setMessage(
        `Reading ${file.name} round ${block?.name ?? 'the block'}… A regional geodatabase can take a few minutes; the page stays usable.`,
      )
      const read = await readRouteCardLayerFile(file, planarBounds(blockShape))
      if (!read.features.length) throw new Error('The file holds no shapes near the block.')
      const layer = { file, read, blockId: block?.id ?? null }
      onSessionLayer(layer)
      setMessage(null)
      measureWith(layer, rowId)
    } catch (error) {
      setMessage(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  /** A layer read for another block this session: read again round this one, one click. */
  const remeasure = async (layer: SessionLayer) => {
    if (!blockShape) return
    try {
      setMessage(`Reading ${layer.file.name} round ${block?.name ?? 'the block'}…`)
      const read = await readRouteCardLayerFile(layer.file, planarBounds(blockShape))
      const next = { ...layer, read, blockId: block?.id ?? null }
      onSessionLayer(next)
      setMessage(null)
      measureWith(next, null)
    } catch (error) {
      setMessage(`Could not read ${layer.file.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const access = blockReview.access ?? null
  const importAccess = async (file: File) => {
    setMessage(null)
    try {
      const lines = toFeatures(await readLayerFile(file)).flatMap((feature) => {
        const geometry = feature.geometry
        if (geometry?.type === 'LineString') return [geometry.coordinates as Array<[number, number]>]
        if (geometry?.type === 'MultiLineString') return geometry.coordinates as Array<Array<[number, number]>>
        return []
      })
      if (!lines.length) throw new Error('The file holds no lines.')
      changeBlock((current) => ({
        ...current,
        access: {
          name: file.name.replace(/\.(zip|geojson|json)$/i, ''),
          lines: lines.map((line) => line.map(([lng, lat]) => [lng, lat])),
        },
      }))
    } catch (error) {
      setMessage(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (!blocks.length) return <p className="text-2xs text-muted-foreground">Add a cutblock to read its route card.</p>

  const counts = assembled?.counts
  const reading = !run.readAt
  const sections = assembled?.sheet.sections ?? []
  const visible = (row: RouteCardPrintedRow) =>
    show === 'all' ||
    (show === 'flagged' && (row.flagged || row.value.startsWith('Within') || row.value === 'Not read')) ||
    (show === 'enter' && (row.value === 'Not public' || row.by === 'entered' || row.by === 'estimated'))

  return (
    <div className="space-y-2" data-testid="route-card-panel">
      <div className="grid grid-cols-2 gap-2">
        <StyledSelect aria-label="Block" value={block?.id ?? ''} onValueChange={onBlockChange}>
          {blocks.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </StyledSelect>
        <StyledSelect aria-label="Route card preset" value={preset.id} onValueChange={onPresetChange}>
          {presets.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </StyledSelect>
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground"
        data-testid="route-card-status"
      >
        {reading ? (
          <span>Reading the layers…</span>
        ) : counts ? (
          <>
            <Badge tone="warning">{counts.flagged} Y</Badge>
            <Badge tone="info">{counts.within} within</Badge>
            {counts.notRead > 0 && <Badge tone="danger">{counts.notRead} not read</Badge>}
            <Badge tone="violet">{counts.notPublic} to enter</Badge>
            {counts.entered > 0 && <Badge tone="neutral">{counts.entered} entered</Badge>}
            {counts.estimated > 0 && <Badge tone="neutral">{counts.estimated} estimated</Badge>}
          </>
        ) : null}
        <span className="ml-auto flex gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={run.reread} title="Read every layer again">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onOpenExport}>
            Save & export…
          </Button>
        </span>
      </div>

      {engineError && <InlineAlert tone="error">{engineError}</InlineAlert>}
      {message && <InlineAlert tone={message.startsWith('Could not') ? 'error' : 'info'}>{message}</InlineAlert>}

      <div className={cn(insetBox(), 'flex flex-wrap items-center gap-2 text-2xs')}>
        <span className="font-medium text-foreground">Access road</span>
        {access ? (
          <>
            <span className="min-w-0 flex-1 truncate">{access.name}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              title="Remove the access road"
              onClick={() => changeBlock((current) => ({ ...current, access: null }))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <span className="min-w-0 flex-1 text-muted-foreground">None: crossings are not checked.</span>
        )}
        <FileButton
          label="Access road file"
          accept=".zip,.geojson,.json"
          variant="outline"
          title="The block's access road as a zipped shapefile or GeoJSON, for TAP and winter range crossings"
          onFiles={([file]) => void importAccess(file)}
        >
          <FileUp className="h-3.5 w-3.5" />
          {access ? 'Replace' : 'Add'}
        </FileButton>
      </div>

      {sessionLayers
        .filter((layer) => layer.blockId !== block?.id)
        .map((layer) => (
          <div key={layer.file.name} className={cn(insetBox(), 'flex items-center gap-2 text-2xs')}>
            <span className="min-w-0 flex-1">{layer.read.label} was read this session for another block.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void remeasure(layer)}>
              Measure {block?.name ?? 'this block'}
            </Button>
          </div>
        ))}

      <SegmentedControl
        label="Rows shown"
        size="sm"
        value={show}
        onChange={setShow}
        options={[
          { value: 'flagged', label: 'Found' },
          { value: 'enter', label: 'To enter' },
          { value: 'all', label: 'All rows' },
        ]}
      />

      <div className="space-y-1">
        {sections.map((section) => {
          const rows = section.rows.filter(visible)
          if (!rows.length) return null
          return (
            <DisclosureRow
              key={section.title}
              title={section.title}
              summary={`${rows.length} row${rows.length === 1 ? '' : 's'}`}
              defaultOpen
            >
              <ul className="space-y-1">
                {rows.map((row) => (
                  <RouteCardRowItem
                    key={row.id}
                    row={row}
                    entry={blockReview.entries?.[row.id]}
                    onEntry={(entry) => setEntry(row.id, entry)}
                    onImport={(file) => void importInto(row.id, file)}
                  />
                ))}
              </ul>
            </DisclosureRow>
          )
        })}
      </div>

      {pending && subject && (
        <ImportFieldChooser
          pending={pending}
          onCancel={() => setPending(null)}
          onMeasure={(field) => {
            const row = routeCardRow(pending.rowId)!
            setEntry(
              row.id,
              entryFromImport(row, subject, pending.features, field, pending.file, today, pending.realFields),
            )
            setMessage(`${pending.file} measured against ${block?.name ?? 'the block'} for ${row.label}.`)
            setPending(null)
          }}
        />
      )}

      <DisclosureRow
        title="Other Considerations"
        summary={assembled ? `${assembled.report.considerations.length} paragraphs` : 'Loading…'}
        help="Each paragraph is drafted from the rows above by the preset's wording and rules (the Visuals paragraph only when an EVQO polygon overlaps the block). Bracketed text is still yours to complete. Write your own to keep it: the draft then stays beside it."
        defaultOpen
      >
        <div className="space-y-2">
          {assembled?.report.considerations.map((item) => (
            <ConsiderationItem
              key={item.id}
              id={item.id}
              title={item.title}
              text={item.text}
              own={item.own}
              toComplete={item.toComplete}
              maps={assembled.maps.filter((map) => map.consideration === item.id)}
              onOwn={(text) => setOwn(item.id, text)}
            />
          ))}
          {assembled && assembled.report.notCalledFor.length > 0 && (
            <p className="text-3xs leading-4 text-muted-foreground">
              Not called for: {assembled.report.notCalledFor.map((item) => item.title).join(', ')}.
            </p>
          )}
          <DisclosureRow title="What the paragraphs ask you for" summary="Unit, patch analysis, notes">
            <div className="space-y-1.5">
              {(
                [
                  [
                    'oldForestStatement',
                    'How the unit meets its old forest objective',
                    'The licence area is currently meeting this old forest objective through spatially identified draft Old Growth Management Areas (d-OGMAs).',
                  ],
                  ['patchCurrentPercent', 'Patch class: current percentage', '33.6%'],
                  ['patchFutureTarget', 'Patch class: future target', '23.6%'],
                  [
                    'patchDecision',
                    'Patch size decision and initials',
                    'Patch is not a constraint at the time of planning. AB 2026/01/01',
                  ],
                  ['tapNote', 'TAP note', 'Now being developed as part of an adjacent block.'],
                ] as const
              ).map(([key, label, placeholder]) => (
                <label key={key} className="block">
                  <span className="mb-0.5 block text-2xs font-medium text-muted-foreground">{label}</span>
                  <input
                    className={FORM_INPUT_CLASS}
                    value={blockReview.inputs?.[key] ?? ''}
                    placeholder={placeholder}
                    onChange={(event) => setInput(key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </DisclosureRow>
        </div>
      </DisclosureRow>
    </div>
  )
}

function RouteCardRowItem({
  row,
  entry,
  onEntry,
  onImport,
}: {
  row: RouteCardPrintedRow
  entry: RouteCardEntry | undefined
  onEntry: (entry: RouteCardEntry | null) => void
  onImport: (file: File) => void
}) {
  const definition = routeCardRow(row.id)
  const source = definition?.source
  // A row no public layer holds, or one PGMaps only estimates, takes the reviewer's answer.
  const enterable = source?.kind === 'notPublic' || !!definition?.estimate
  const [open, setOpen] = useState(false)
  return (
    <li className={cn(insetBox(), 'space-y-1 text-2xs')} data-route-card-row={row.id}>
      <div className="flex items-start gap-2">
        <span className={cn('min-w-0 flex-1', row.flagged && 'font-medium text-foreground')}>{row.label}</span>
        <Badge tone={VALUE_TONE(row)}>{row.value}</Badge>
        {row.by === 'estimated' && <Badge variant="outline">Estimate</Badge>}
        {enterable && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
            {open ? 'Done' : entry ? 'Edit' : 'Enter'}
          </Button>
        )}
      </div>
      {row.names && <p className="break-words text-muted-foreground">{row.names}</p>}
      {row.note && <p className="text-3xs leading-4 text-muted-foreground">{row.note}</p>}
      {enterable && open && source && (
        <div className="space-y-1.5 pt-1">
          {source.kind === 'notPublic' && source.fill && (
            <p className="text-3xs leading-4 text-muted-foreground">{source.fill}</p>
          )}
          <SegmentedControl
            label={`${row.label}: answer`}
            size="sm"
            value={entry?.answer ?? 'none'}
            onChange={(value) =>
              onEntry(value === 'none' ? null : { answer: value, names: entry?.names ?? '', source: entry?.source })
            }
            options={[
              { value: 'yes', label: 'Y' },
              { value: 'near', label: 'Within' },
              { value: 'no', label: 'N' },
              { value: 'none', label: 'Not entered' },
            ]}
          />
          {entry?.answer === 'yes' && (
            <input
              className={FORM_INPUT_CLASS}
              aria-label={`${row.label}: what it names`}
              placeholder="What it names, as the route card prints it"
              value={entry.names}
              onChange={(event) => onEntry({ ...entry, names: event.target.value })}
            />
          )}
          {entry && (
            <input
              className={FORM_INPUT_CLASS}
              aria-label={`${row.label}: source`}
              placeholder="Where it came from (RAAD export, BCTS records…)"
              value={entry.source ?? ''}
              onChange={(event) => onEntry({ ...entry, source: event.target.value })}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <FileButton
              label={`${row.label}: import a file`}
              accept=".zip,.geojson,.json,.gpkg"
              variant="outline"
              title="Measure your own layer (a zipped shapefile or File Geodatabase, a GeoPackage or GeoJSON) against the block by this row's rule"
              onFiles={([file]) => onImport(file)}
            >
              <FileUp className="h-3.5 w-3.5" />
              Import a file
            </FileButton>
            {source.kind === 'notPublic' && source.link && (
              <ExternalLink href={source.link.url}>{source.link.label}</ExternalLink>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function ImportFieldChooser({
  pending,
  onCancel,
  onMeasure,
}: {
  pending: { rowId: string; file: string; fields: string[] }
  onCancel: () => void
  onMeasure: (field: string) => void
}) {
  const [field, setField] = useState(pending.fields[0] ?? '')
  const row = routeCardRow(pending.rowId)
  return (
    <div className={cn(insetBox(), 'space-y-1.5 text-2xs')} data-testid="route-card-import-field">
      <p>
        Which field of <span className="font-medium">{pending.file}</span> does {row?.label ?? 'this row'} print?
      </p>
      <StyledSelect aria-label="Field to print" value={field} onValueChange={setField}>
        {pending.fields.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </StyledSelect>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!field} onClick={() => onMeasure(field)}>
          Measure
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function ConsiderationItem({
  id,
  title,
  text,
  own,
  toComplete,
  maps,
  onOwn,
}: {
  id: ConsiderationId
  title: string
  text: string
  own: boolean
  toComplete: string[]
  /** The maps the paragraph carries in the files. */
  maps: readonly RouteCardMapFigure[]
  onOwn: (text: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  return (
    <div className={cn(insetBox(), 'space-y-1 text-2xs')} data-consideration={id}>
      <div className="flex items-center gap-2">
        <span className="font-medium text-foreground">{title}</span>
        <Badge tone={own ? 'success' : 'neutral'}>{own ? 'Yours' : 'Draft'}</Badge>
        {toComplete.length > 0 && (
          <InfoTip label={`${title}: to complete`} tone="warning">
            Still to complete: {toComplete.join('; ')}.
          </InfoTip>
        )}
        <span className="ml-auto flex gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing((value) => !value)}>
            {editing ? 'Done' : 'Edit'}
          </Button>
          {own && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onOwn(null)} title="Go back to the draft">
              Use the draft
            </Button>
          )}
        </span>
      </div>
      {editing ? (
        <textarea
          className={TEXTAREA_CLASS}
          aria-label={`${title} paragraph`}
          defaultValue={text}
          onBlur={(event) => {
            const value = event.target.value.trim()
            // An untouched draft stays the draft; an emptied paragraph goes back to it.
            if (!value) onOwn(null)
            else if (own || value !== text) onOwn(value)
          }}
        />
      ) : (
        <p className="whitespace-pre-wrap leading-5 text-foreground">{text}</p>
      )}
      {maps.map((map) => (
        <figure key={map.caption} className="space-y-0.5">
          <img
            className="w-full rounded-sm border border-border"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(map.svg)}`}
            alt={map.caption}
          />
          <figcaption className="text-3xs leading-4 text-muted-foreground">{map.caption}</figcaption>
        </figure>
      ))}
    </div>
  )
}
