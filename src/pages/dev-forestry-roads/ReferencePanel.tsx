import { Fragment, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Layers3,
  LocateFixed,
  Pencil,
  Route,
  Trash2,
} from 'lucide-react'
import { RibbonTaskPane } from '@/components/interfaces/RibbonTaskPane'
import { Button } from '@/components/ui/button'
import { FileDropField } from '@/components/ui/file-drop-field'
import type { PickedFile } from '@/components/ui/picked-files'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { cn } from '@/lib/utils'
import {
  compactReferenceFolder,
  importedCutblockFeatures,
  referenceFolders,
  referenceLayers,
  referenceShape,
  type LayerFeature,
  type ReferenceFolder,
  type ReferenceLayer,
} from './referenceFeatures'
import { referenceLayerColor } from './ReferenceLayer'
import { designRoadForProposedLine, LAYER_IMPORT_LABELS, REFERENCE_ACCEPT } from './referenceImport'
import { CutblockBufferField } from './CutblockBufferField'
import { cutblockBufferKey, type CutblockBuffer } from './cutblockBuffers'
import type { DrawMode } from './PlanView'
import type { Alignment, Coordinate } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'
import { PdfRasterDetails } from './PdfRasterDetails'

const SHAPE_LABELS = { point: 'Point', line: 'Line', area: 'Area' } as const

/** A feature's name edited in its own row: Enter or leaving the field keeps it, Escape puts it back. */
function ReferenceName({
  name,
  label,
  onRename,
  onDone,
}: {
  name: string
  label: string
  onRename: (name: string) => void
  /** `byKey` is true when Enter or Escape ended the edit, so focus can go back to the row. */
  onDone: (byKey: boolean) => void
}) {
  const [draft, setDraft] = useState(name)
  const ended = useRef<'Enter' | 'Escape' | null>(null)
  return (
    <input
      autoFocus
      className="min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 py-0.5 text-base md:text-xs"
      aria-label={label}
      maxLength={200}
      value={draft}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim()
        if (ended.current !== 'Escape' && next && next !== name) onRename(next)
        onDone(ended.current !== null)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.stopPropagation()
          ended.current = event.key
          event.currentTarget.blur()
        }
        if (['Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.stopPropagation()
      }}
    />
  )
}

/** Row actions share one quiet look and one column, so the icons line up down the tree. */
const rowActionClass = 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground [&_svg]:size-3.5'

/** Rename and remove wait for the pointer, the keyboard or an open row; a touch screen always shows them. */
const quietActionClass =
  'opacity-0 focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 touch:opacity-100'

const summaryClass = 'cursor-pointer select-none text-muted-foreground hover:text-foreground'

/**
 * A disclosure row with its actions beside the toggle so each action has its own focus target.
 * A row with nothing under it has no chevron, and `editor` stands in for the name while it is edited.
 */
function Branch({
  name,
  detail,
  icon,
  open,
  toggle,
  actions,
  children,
  muted,
  guide = true,
  editor,
  tag,
  title = name,
}: {
  name: string
  detail?: string
  icon: ReactNode
  open: boolean
  toggle: () => void
  actions?: ReactNode
  children: ReactNode
  muted?: boolean
  /** False sets the body under the row's name with no rule: a row's own details, not more rows. */
  guide?: boolean
  editor?: ReactNode
  /** What the row is, at its right end: a layer's role while it is folded. */
  tag?: string
  title?: string
}) {
  const id = useId()
  const expandable = children != null && children !== false
  const chevron = expandable ? (
    <ChevronRight aria-hidden="true" className={cn('size-3.5 shrink-0 text-muted-foreground', open && 'rotate-90')} />
  ) : (
    <span className="size-3.5 shrink-0" aria-hidden="true" />
  )
  const label = (
    <>
      <span className={cn('flex min-w-0 items-center gap-1.5', muted && 'text-muted-foreground')}>
        {icon}
        <span className="truncate">{name}</span>
      </span>
      {detail && <span className="shrink-0 text-2xs text-muted-foreground">{detail}</span>}
      {tag && <span className="ml-auto shrink-0 pl-1 pr-0.5 text-2xs text-muted-foreground">{tag}</span>}
    </>
  )
  const rowClass = 'flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 text-left text-xs touch:min-h-11'
  return (
    <>
      <div className="group/row flex min-w-0 items-center rounded-sm hover:bg-accent">
        {editor ? (
          <div className={cn(rowClass, 'py-0.5')}>
            {chevron}
            {editor}
          </div>
        ) : expandable ? (
          <button
            type="button"
            className={cn(rowClass, 'py-1.5 focus-visible:outline focus-visible:outline-primary')}
            aria-expanded={open}
            aria-controls={id}
            onClick={toggle}
            title={title}
          >
            {chevron}
            {label}
          </button>
        ) : (
          <div className={cn(rowClass, 'py-1.5')} title={title}>
            {chevron}
            {label}
          </div>
        )}
        {actions && <div className="flex shrink-0">{actions}</div>}
      </div>
      {expandable && (
        <div id={id} hidden={!open} className={guide ? 'ml-2.5 border-l border-border pl-2' : 'pl-6'}>
          {open && children}
        </div>
      )}
    </>
  )
}

export function ReferencePanel({
  open,
  onClose,
  workspace: w,
  mode,
  disabled,
  onFiles,
  onReadError,
  onLocate,
  focusedId,
  hiddenKeys,
  onVisibilityChange,
  onCopyRoad,
  onShowRoad,
  onRemoveLayer,
  onBufferChange,
  onFitBuffer,
  onPegAt,
  onRoadEndAt,
}: {
  open: boolean
  onClose: () => void
  workspace: RoadWorkspace
  mode: DrawMode
  disabled: boolean
  onFiles: (files: PickedFile[]) => Promise<void>
  onReadError: (error: unknown) => void
  onLocate: (features: readonly LayerFeature[], id?: string) => void
  focusedId?: string | null
  hiddenKeys?: readonly string[]
  onVisibilityChange: (keys: readonly string[], visible: boolean) => void
  onCopyRoad: (feature: LayerFeature) => void
  onShowRoad: (road: Alignment) => void
  onRemoveLayer: (key: string, name: string) => void
  onBufferChange: (key: string, setting?: CutblockBuffer) => void
  onFitBuffer: (setting: CutblockBuffer) => void
  onPegAt?: (at: Coordinate, name: string) => void
  onRoadEndAt?: (at: Coordinate, name: string, end: 'start' | 'end') => void
}) {
  const { reference, context, cutblockBuffers, alignments, designPlaceholderId, activeAlignmentId } = w.project
  const layers = useMemo(
    () => referenceLayers([...(reference ?? []), ...importedCutblockFeatures(context)]),
    [reference, context],
  )
  const attached = useMemo(
    () => new Set((cutblockBuffers ?? []).flatMap((setting) => ('source' in setting ? [setting.source] : []))),
    [cutblockBuffers],
  )
  const tree = useMemo(() => referenceFolders(layers.filter(({ key }) => !attached.has(key))), [layers, attached])
  const roads = alignments.filter(({ id }) => id !== designPlaceholderId)
  const [disclosures, setDisclosures] = useState<Record<string, boolean>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const toggle = (key: string, isOpen: boolean) => setDisclosures((previous) => ({ ...previous, [key]: !isOpen }))
  const pegging = mode === 'road' || mode === 'extend'
  const fixedRoad = !!w.alignment.mappedRoad
  if (!open) return null

  const renderLayer = ({ key, name, features }: ReferenceLayer) => {
    const branchKey = `layer:${key}`
    const expanded = disclosures[branchKey] ?? false
    const visible = !hiddenKeys?.includes(key)
    const role = features[0].cutblock ? 'planned-block' : (features[0].role ?? 'reference')
    const buffer = cutblockBuffers?.find(({ layer }) => layer === key)
    const bufferVisible = !hiddenKeys?.includes(cutblockBufferKey(key))
    const bufferSource = buffer && 'source' in buffer ? layers.find((layer) => layer.key === buffer.source) : undefined
    const bufferName =
      buffer &&
      ('metres' in buffer ? `${buffer.metres.toLocaleString()} m buffer` : (bufferSource?.name ?? 'Imported buffer'))
    return (
      <li key={key} data-layer-source={key}>
        <Branch
          name={name}
          title={key}
          detail={String(features.length)}
          tag={!expanded && role !== 'reference' ? LAYER_IMPORT_LABELS[role] : undefined}
          icon={
            <Layers3 className="size-3.5 shrink-0" style={{ color: referenceLayerColor(key) }} aria-hidden="true" />
          }
          open={expanded}
          toggle={() => toggle(branchKey, expanded)}
          muted={!visible}
          actions={
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                className={rowActionClass}
                aria-label={`${visible ? 'Hide' : 'Show'} layer ${name}`}
                title={visible ? 'Hide layer' : 'Show layer'}
                onClick={() => onVisibilityChange([key], !visible)}
              >
                {visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                className={rowActionClass}
                aria-label={`Fit layer ${name}`}
                title="Fit layer on plan"
                onClick={() => onLocate(features)}
              >
                <LocateFixed aria-hidden="true" />
              </Button>
            </>
          }
        >
          <div className="flex min-w-0 items-center gap-1 pl-1">
            <p className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{LAYER_IMPORT_LABELS[role]}</p>
            <Button
              size="2xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => onRemoveLayer(key, name)}
              className="gap-1 text-muted-foreground hover:bg-foreground/10 hover:text-danger [&_svg]:size-3"
            >
              <Trash2 aria-hidden="true" /> Delete layer
            </Button>
          </div>
          {role === 'planned-block' && (
            <div className="space-y-2 border-b px-1 pb-2">
              <CutblockBufferField
                layer={key}
                setting={buffer}
                sources={layers.filter(
                  (layer) =>
                    layer.key &&
                    layer.key !== key &&
                    (!attached.has(layer.key) || layer.key === bufferSource?.key) &&
                    layer.features.every(
                      (feature) =>
                        !feature.cutblock &&
                        !feature.sheet &&
                        !feature.classGrid &&
                        feature.geometry.type === 'Polygon',
                    ),
                )}
                onChange={(setting) => onBufferChange(key, setting)}
                disabled={disabled}
              />
              {buffer && (
                <div className="flex min-w-0 items-center gap-1" data-cutblock-buffer={key}>
                  <span className="min-w-0 flex-1 truncate text-xs" title={bufferName}>
                    {bufferName}
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className={rowActionClass}
                    aria-label={`${bufferVisible ? 'Hide' : 'Show'} buffer for ${name}`}
                    onClick={() =>
                      onVisibilityChange(
                        bufferVisible ? [cutblockBufferKey(key)] : [cutblockBufferKey(key), key],
                        !bufferVisible,
                      )
                    }
                  >
                    {bufferVisible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className={rowActionClass}
                    aria-label={`Fit buffer for ${name}`}
                    onClick={() => onFitBuffer(buffer)}
                  >
                    <LocateFixed aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
          )}
          {/* A tree row carries no rule under it; the shared list draws one for result lists. */}
          <div className="[&_[data-index]]:border-b-0">
            <VirtualResultList
              items={features}
              getKey={(feature) => feature.id}
              estimateSize={28}
              label={`Features in ${name}`}
            >
              {(feature) => {
                const detailKey = `feature:${feature.id}`
                const detailsOpen = disclosures[detailKey] ?? false
                const shape = referenceShape(feature)
                const at = shape === 'point' ? (feature.geometry.coordinates as Coordinate) : null
                const renaming = renamingId === feature.id
                // A proposed line loaded as a design road is that road's copy as imported, not a second road.
                const designRoad = feature.role === 'proposed-road' ? designRoadForProposedLine(feature, roads) : null
                const hasActions = feature.role === 'proposed-road' || !!(at && (onPegAt || onRoadEndAt))
                const hasDetails = hasActions || !!(feature.classGrid || feature.pdfSource || feature.attributes)
                const quiet = detailsOpen ? undefined : quietActionClass
                return (
                  <div
                    className={cn('min-w-0', feature.id === focusedId && 'bg-primary/5')}
                    data-reference-row={feature.id}
                  >
                    <Branch
                      name={feature.name}
                      detail={
                        designRoad
                          ? `${SHAPE_LABELS[shape]} · ${designRoad.edited ? 'edited design road' : 'design road'}`
                          : SHAPE_LABELS[shape]
                      }
                      icon={null}
                      guide={false}
                      open={detailsOpen}
                      toggle={() => toggle(detailKey, detailsOpen)}
                      editor={
                        renaming && (
                          <ReferenceName
                            name={feature.name}
                            label={`Name of ${feature.name}`}
                            onRename={(name) =>
                              w.update((project) =>
                                feature.cutblock
                                  ? {
                                      ...project,
                                      context: project.context.map((item) =>
                                        item.id === feature.id ? { ...item, name } : item,
                                      ),
                                    }
                                  : {
                                      ...project,
                                      reference: project.reference?.map((item) =>
                                        item.id === feature.id ? { ...item, name } : item,
                                      ),
                                    },
                              )
                            }
                            onDone={(byKey) => {
                              setRenamingId(null)
                              // The field is gone on the next frame; the keyboard goes back to its row.
                              if (byKey)
                                requestAnimationFrame(() =>
                                  document
                                    .querySelector<HTMLElement>(
                                      `[data-reference-row="${CSS.escape(feature.id)}"] button`,
                                    )
                                    ?.focus(),
                                )
                            }}
                          />
                        )
                      }
                      actions={
                        <>
                          {!renaming && (
                            <>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                className={cn(rowActionClass, quiet)}
                                aria-label={`Rename ${feature.name}`}
                                title="Rename"
                                disabled={disabled}
                                onClick={() => setRenamingId(feature.id)}
                              >
                                <Pencil aria-hidden="true" />
                              </Button>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                className={cn(rowActionClass, 'hover:text-danger', quiet)}
                                aria-label={`Remove ${feature.name}`}
                                title="Remove feature"
                                disabled={disabled}
                                onClick={() =>
                                  w.update(
                                    (project) =>
                                      feature.cutblock
                                        ? {
                                            ...project,
                                            context: project.context.filter((item) => item.id !== feature.id),
                                          }
                                        : {
                                            ...project,
                                            reference: project.reference?.filter((item) => item.id !== feature.id),
                                          },
                                    undefined,
                                    { ownStep: true },
                                  )
                                }
                              >
                                <Trash2 aria-hidden="true" />
                              </Button>
                            </>
                          )}
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className={rowActionClass}
                            aria-label={`Show ${feature.name} on the plan`}
                            title="Show on plan"
                            onClick={() => onLocate([feature], feature.id)}
                          >
                            <LocateFixed aria-hidden="true" />
                          </Button>
                        </>
                      }
                    >
                      {hasDetails && (
                        <div className="space-y-2 pb-2 pr-1 pt-0.5">
                          {designRoad && (
                            <p className="text-2xs text-muted-foreground">
                              {designRoad.edited
                                ? `Design road ${designRoad.road.name} has changed since this line was imported. This line is the road as imported.`
                                : designRoad.road.name === feature.name
                                  ? 'Loaded as a design road. This line is the road as imported.'
                                  : `Loaded as design road ${designRoad.road.name}. This line is the road as imported.`}
                            </p>
                          )}
                          {hasActions && (
                            <div className="flex flex-wrap gap-1">
                              {designRoad && (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  disabled={disabled}
                                  onClick={() => onShowRoad(designRoad.road)}
                                >
                                  Show design road
                                </Button>
                              )}
                              {/* A second copy of a road that has not moved would only be a duplicate. */}
                              {feature.role === 'proposed-road' && (!designRoad || designRoad.edited) && (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  disabled={disabled}
                                  onClick={() => onCopyRoad(feature)}
                                >
                                  Copy as design road
                                </Button>
                              )}
                              {at && onPegAt && (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  disabled={disabled}
                                  onClick={() => onPegAt(at, feature.name)}
                                >
                                  {pegging ? 'Peg here' : 'Peg from'}
                                </Button>
                              )}
                              {at &&
                                onRoadEndAt &&
                                (['start', 'end'] as const).map((end) => (
                                  <Button
                                    key={end}
                                    size="xs"
                                    variant="outline"
                                    disabled={disabled || fixedRoad || pegging}
                                    aria-label={`Move road ${end} to ${feature.name}`}
                                    onClick={() => onRoadEndAt(at, feature.name, end)}
                                  >
                                    Road {end}
                                  </Button>
                                ))}
                            </div>
                          )}
                          {feature.classGrid && (
                            <PdfRasterDetails grid={feature.classGrid} project={w.project} id={feature.id} />
                          )}
                          {feature.pdfSource && (
                            <div className="space-y-1 text-2xs text-muted-foreground">
                              <p>
                                {feature.pdfSource.profile} · page {feature.pdfSource.page}
                              </p>
                              <p className="break-words">
                                {feature.pdfSource.file} · {feature.pdfSource.layer}
                              </p>
                              <p>
                                {feature.classGrid
                                  ? 'Published class grid'
                                  : feature.sheet
                                    ? 'Source sheet'
                                    : 'Recovered drawing'}
                                ; registration fit {feature.pdfSource.registrationErrorM.toFixed(2)} m. This is a
                                control-point fit, not source accuracy.
                              </p>
                              <details>
                                <summary className={summaryClass}>Source fingerprint</summary>
                                <p className="break-all">SHA-256 {feature.pdfSource.sha256}</p>
                              </details>
                            </div>
                          )}
                          {feature.attributes && (
                            <details className="text-2xs">
                              <summary className={summaryClass}>Source attributes</summary>
                              <dl className="mt-1 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-2 gap-y-0.5 break-words">
                                {Object.entries(feature.attributes).map(([key, value]) => (
                                  <Fragment key={key}>
                                    <dt className="text-muted-foreground">{key}</dt>
                                    <dd>{value === null ? 'Not recorded' : String(value)}</dd>
                                  </Fragment>
                                ))}
                              </dl>
                            </details>
                          )}
                        </div>
                      )}
                    </Branch>
                  </div>
                )
              }}
            </VirtualResultList>
          </div>
        </Branch>
      </li>
    )
  }
  const renderFolder = (listed: ReferenceFolder) => {
    const { folder, label, onlyLayer } = compactReferenceFolder(listed)
    // A folder around one file is listed as that file; its path stays in the row's tooltip.
    if (onlyLayer) return renderLayer(onlyLayer)
    const key = `folder:${folder.path}`
    const expanded = disclosures[key] ?? true
    const Icon = expanded ? FolderOpen : Folder
    return (
      <li key={folder.path} data-layer-folder={folder.path}>
        <Branch
          name={label}
          icon={<Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          open={expanded}
          toggle={() => toggle(key, expanded)}
        >
          <ul>
            {[...folder.folders.values()].map(renderFolder)}
            {folder.layers.map(renderLayer)}
          </ul>
        </Branch>
      </li>
    )
  }
  return (
    <RibbonTaskPane title="Layers" onClose={onClose}>
      <div className="space-y-3 p-3" data-testid="road-reference-layers">
        <FileDropField
          label="Map layers"
          filesLabel="Add files"
          folderLabel="Add folder"
          dropHint="Drop GIS files, Canfor map PDFs or a folder here"
          accept={REFERENCE_ACCEPT}
          onFiles={onFiles}
          onError={onReadError}
          disabled={disabled}
          dropProps={{ 'data-testid': 'road-layer-drop' }}
        />
        {(layers.length > 0 || roads.length > 0) && (
          <>
            {layers.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => onLocate(layers.flatMap((layer) => layer.features))}>
                <LocateFixed className="mr-1.5 size-3.5" aria-hidden="true" />
                Fit all layers
              </Button>
            )}
            <ul aria-label="Project layers" className="rounded-md border p-1">
              {roads.length > 0 && (
                <li>
                  <Branch
                    name="Design roads"
                    detail={String(roads.length)}
                    icon={<Route className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    open={disclosures.roads ?? true}
                    toggle={() => toggle('roads', disclosures.roads ?? true)}
                  >
                    <ul>
                      {roads.map((road) => (
                        <li key={road.id}>
                          <button
                            type="button"
                            aria-current={road.id === activeAlignmentId ? 'true' : undefined}
                            disabled={disabled}
                            className="flex w-full items-center rounded-sm pl-1 text-left text-xs hover:bg-accent aria-[current=true]:bg-primary/10 aria-[current=true]:font-medium touch:min-h-11"
                            onClick={() => onShowRoad(road)}
                            title="Select and fit road on the plan"
                          >
                            <span className="min-w-0 flex-1 truncate">{road.name}</span>
                            {/* The same box as a layer row's last action, so the targets share a column. */}
                            <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
                              <LocateFixed className="size-3.5" aria-hidden="true" />
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Branch>
                </li>
              )}
              {[...tree.folders.values()].map(renderFolder)}
              {tree.layers.map(renderLayer)}
            </ul>
          </>
        )}
      </div>
    </RibbonTaskPane>
  )
}
