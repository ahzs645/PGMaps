import { Fragment, useId, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import {
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  GripVertical,
  Layers3,
  LocateFixed,
  Map as MapIcon,
  Mountain,
  Pencil,
  Route,
  Trash2,
} from 'lucide-react'
import { CommandButton } from '@/components/interfaces/CommandButton'
import { RibbonTaskPane } from '@/components/interfaces/RibbonTaskPane'
import type { CommandState, WorkspaceCommand } from '@/pages/dev-forestry-roads/interface/workspaceCommands'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { DisclosureRow } from '@/components/ui/disclosure'
import { FileDropField } from '@/components/ui/file-drop-field'
import type { PickedFile } from '@/components/ui/picked-files'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { cn } from '@/lib/utils'
import {
  compactReferenceFolder,
  designRoadLayerKey,
  folderLayerKeys,
  groupShown,
  importedCutblockFeatures,
  referenceListOrder,
  isImageFrame,
  referenceFolders,
  referenceLayers,
  referenceShape,
  type LayerFeature,
  type ReferenceFolder,
  type ReferenceLayer,
} from './referenceFeatures'
import { SymbolField } from '@/components/ui/symbol-style-fields'
import type { SymbolStyle } from '@/lib/mapSheet/symbolStyle'
import {
  REFERENCE_COLOR_PRESETS,
  referenceLayerColor,
  referenceStyleDefaults,
  referenceStyleFor,
} from './referenceStyles'
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

/** The eye on a row: shows or hides what the row names (a layer, a road, a whole group). */
function VisibilityButton({
  visible,
  label,
  onToggle,
  disabled,
  title,
}: {
  visible: boolean
  /** What it shows or hides, for its name: "all design roads" gives "Hide all design roads". */
  label: string
  onToggle: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      className={rowActionClass}
      aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
      title={title ?? (visible ? 'Hide' : 'Show')}
      disabled={disabled}
      onClick={onToggle}
    >
      {visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
    </Button>
  )
}

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
  lead,
  rowProps,
  dropAt,
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
  /** Before the row's toggle: the grip that moves it. */
  lead?: ReactNode
  /** On the row itself: where a dragged row is dropped. */
  rowProps?: HTMLAttributes<HTMLDivElement>
  /** A dragged row would land here: a line over or under this one. */
  dropAt?: 'above' | 'below' | null
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
      <div className="group/row relative flex min-w-0 items-center rounded-sm hover:bg-accent" {...rowProps}>
        {dropAt && (
          <span
            className={cn(
              'pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary',
              dropAt === 'above' ? 'top-0' : 'bottom-0',
            )}
            aria-hidden="true"
          />
        )}
        {lead}
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

/** A background the plan draws for context, shown and hidden from the Layers list. */
export type BaseMapLayer = {
  key: string
  name: string
  /** What it is, as the row's tooltip. */
  description: string
  visible: boolean
  /** Why it cannot be shown now, when it cannot. */
  unavailable?: string
  onVisibleChange: (visible: boolean) => void
  /**
   * Shown only by its own eye: a group's eye or *Hide all* hides it, but nothing turns it on for it. For layers that
   * read imagery from the network (Sentinel-2, canopy height, the Wayback timeline), which stay the person's choice.
   */
  alone?: boolean
}

/** Hides or shows a list of layers as one switch: showing passes over the layers that are shown only by their own eye. */
function setLayersShown(layers: readonly BaseMapLayer[], visible: boolean) {
  for (const layer of layers) {
    if (layer.unavailable || (visible && layer.alone) || layer.visible === visible) continue
    layer.onVisibleChange(visible)
  }
}

/** A plan display layer as one row: its name, and its eye. */
function DisplayLayerRow({ layer }: { layer: BaseMapLayer }) {
  return (
    <li data-base-layer={layer.key}>
      <Branch
        name={layer.name}
        title={layer.unavailable ?? layer.description}
        icon={null}
        muted={!layer.visible || !!layer.unavailable}
        open={false}
        toggle={() => {}}
        actions={
          <VisibilityButton
            visible={layer.visible}
            label={layer.name}
            title={layer.unavailable ?? (layer.visible ? 'Hide layer' : 'Show layer')}
            disabled={!!layer.unavailable}
            onToggle={() => layer.onVisibleChange(!layer.visible)}
          />
        }
      >
        {null}
      </Branch>
    </li>
  )
}

/**
 * The basemap as the first row of Base map: what the plan is drawn on, and *Change* to pick another from the same
 * pictures the plan's Basemap button shows.
 */
function BasemapRow({ choice, disabled }: { choice: BaseMapChoice; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const current = choice.options.find((option) => option.value === choice.value) ?? choice.options[0]
  const name = (option: (typeof choice.options)[number]) =>
    typeof option.label === 'string' ? option.label : option.value[0].toUpperCase() + option.value.slice(1)
  return (
    <li data-base-layer="basemap" className="group/row flex min-w-0 items-center rounded-sm hover:bg-accent">
      <div
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-1.5 text-left text-xs touch:min-h-11"
        title={choice.unavailable ?? current?.description}
      >
        <span className="size-3.5 shrink-0" aria-hidden="true" />
        <span className={cn('min-w-0 truncate', (choice.unavailable || !choice.shown) && 'text-muted-foreground')}>
          Basemap: {current ? name(current) : choice.value}
          {!choice.shown && ' (hidden)'}
        </span>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="2xs"
            variant="ghost"
            className="mr-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            disabled={disabled || !!choice.unavailable}
            title={choice.unavailable ?? 'Change the basemap'}
            aria-label="Change the basemap"
          >
            Change
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1.5" aria-label="Basemap">
          <ul className="grid gap-1" role="list">
            {choice.options.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  aria-pressed={option.value === choice.value}
                  className="flex w-full items-center gap-2 rounded-md p-1.5 text-left text-xs hover:bg-accent aria-[pressed=true]:bg-primary/10 aria-[pressed=true]:font-medium"
                  onClick={() => {
                    // Choosing a basemap shows it, as choosing it in the plan's Basemap button does.
                    choice.onChange(option.value)
                    choice.onShownChange(true)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0 flex-1">{option.label}</span>
                  {option.description && (
                    <span className="shrink-0 text-2xs text-muted-foreground">{option.description}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <VisibilityButton
        visible={choice.shown}
        label="the basemap"
        title={choice.unavailable ?? (choice.shown ? 'Hide the basemap: a plain background' : 'Show the basemap')}
        disabled={disabled || !!choice.unavailable}
        onToggle={() => choice.onShownChange(!choice.shown)}
      />
    </li>
  )
}

/** The plan's basemap, the same choice as its Basemap button (`usePlanDisplay`), changed from the Base map group. */
export type BaseMapChoice = {
  value: string
  options: ReadonlyArray<{ value: string; label: ReactNode; description?: string }>
  onChange: (value: string) => void
  /** Whether it is drawn; hidden, the plan is drawn on a plain background (*None* in the plan's Basemap button). */
  shown: boolean
  onShownChange: (shown: boolean) => void
  /** Why it cannot be changed now (a project on the flat plane has no basemap). */
  unavailable?: string
}

/** The terrain under the project, listed as its own group with the commands that bring in another. */
export type TerrainEntry = {
  name: string
  /** Its cell size or source, beside the name. */
  detail?: string
  /** Registry commands that load terrain (`detailedDem`, `regional`), drawn through `CommandButton`. */
  commands: readonly WorkspaceCommand[]
  states?: Partial<Record<WorkspaceCommand, CommandState>>
  onCommand: (id: WorkspaceCommand) => void
  /** What the plan draws from the terrain (contours), each with its eye. */
  layers?: readonly BaseMapLayer[]
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
  onLayerStyleChange,
  onFitBuffer,
  onPegAt,
  onRoadEndAt,
  baseLayers = [],
  roadLayers = [],
  basemap,
  terrain,
  onMoveLayers,
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
  /** A reference layer's look changed; an empty style returns the layer to how it arrived. */
  onLayerStyleChange?: (key: string, style: SymbolStyle) => void
  onFitBuffer: (setting: CutblockBuffer) => void
  onPegAt?: (at: Coordinate, name: string) => void
  onRoadEndAt?: (at: Coordinate, name: string, end: 'start' | 'end') => void
  /** The plan's own backgrounds, listed after the project's layers. */
  baseLayers?: readonly BaseMapLayer[]
  /** What the plan draws along the design roads (station labels, earthworks), listed under the roads. */
  roadLayers?: readonly BaseMapLayer[]
  /** The basemap, listed first under Base map with a way to change it. */
  basemap?: BaseMapChoice
  /** The project's terrain, listed with the commands that load another (Load 1 m DEM). */
  terrain?: TerrainEntry
  /**
   * Moves layers in the draw order (`moveReferenceLayers`): a row's grip drags it over or under a sibling, and its
   * arrow keys move it one place. Absent, the list has no grips.
   */
  onMoveLayers?: (moving: readonly string[], target: readonly string[], place: 'above' | 'below') => void
}) {
  const { reference, context, cutblockBuffers, referenceStyles, alignments, designPlaceholderId, activeAlignmentId } =
    w.project
  const layers = useMemo(
    () => referenceLayers([...(reference ?? []), ...importedCutblockFeatures(context)]),
    [reference, context],
  )
  const attached = useMemo(
    () => new Set((cutblockBuffers ?? []).flatMap((setting) => ('source' in setting ? [setting.source] : []))),
    [cutblockBuffers],
  )
  // Listed the last drawn first, so the layer at the top of the list draws on top (`referenceListOrder`).
  const tree = useMemo(
    () => referenceFolders(referenceListOrder(layers.filter(({ key }) => !attached.has(key)))),
    [layers, attached],
  )
  // Only layers in the project's reference list have a draw order to change (an imported cutblock is the context's).
  const orderable = useMemo(() => new Set((reference ?? []).map((feature) => feature.source ?? '')), [reference])
  const [dragging, setDragging] = useState<{ id: string; keys: readonly string[]; group: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; place: 'above' | 'below' } | null>(null)
  const roads = alignments.filter(({ id }) => id !== designPlaceholderId)
  const [disclosures, setDisclosures] = useState<Record<string, boolean>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const toggle = (key: string, isOpen: boolean) => setDisclosures((previous) => ({ ...previous, [key]: !isOpen }))
  const pegging = mode === 'road' || mode === 'extend'
  const fixedRoad = !!w.alignment.mappedRoad
  // One switch per group, and one for everything: a group reads as shown while any member shows.
  const roadKeys = roads.map((road) => designRoadLayerKey(road.id))
  const roadsShown = groupShown(roadKeys, hiddenKeys)
  const layerKeys = layers.map((layer) => layer.key)
  const everyKey = [...roadKeys, ...layerKeys]
  const switchableBase = baseLayers.filter((layer) => !layer.unavailable)
  const basemapSwitchable = !!basemap && !basemap.unavailable
  const baseShown = switchableBase.some((layer) => layer.visible) || (basemapSwitchable && basemap.shown)
  const setBase = (visible: boolean) => {
    setLayersShown(baseLayers, visible)
    if (basemapSwitchable) basemap.onShownChange(visible)
  }
  // What the plan draws over the roads and the terrain: hidden and shown with everything else.
  const overlays = [...(roads.length ? roadLayers : []), ...(terrain?.layers ?? [])]
  const switchableOverlays = overlays.filter((layer) => !layer.unavailable)
  const anyShown = groupShown(everyKey, hiddenKeys) || baseShown || switchableOverlays.some((layer) => layer.visible)
  const setAll = (visible: boolean) => {
    if (everyKey.length) onVisibilityChange(everyKey, visible)
    setLayersShown(overlays, visible)
    setBase(visible)
  }
  /**
   * The grip and drop handling of one row in its sibling list (`group`: its folder, and whether the row is a layer or a
   * folder there, since a folder lists its folders before its layers). A drag drops over or under a sibling; on the
   * grip, ↑ and ↓ (with or without Alt) move the row one place.
   */
  const ordering = (
    id: string,
    label: string,
    keys: readonly string[],
    group: string,
    siblings: readonly (readonly string[])[],
    index: number,
  ): { lead?: ReactNode; rowProps?: HTMLAttributes<HTMLDivElement>; dropAt?: 'above' | 'below' | null } => {
    if (!onMoveLayers) return {}
    const movable = !disabled && keys.some((key) => orderable.has(key)) && siblings.length > 1
    const move = (to: number, place: 'above' | 'below') => {
      const target = siblings[to]
      if (target) onMoveLayers(keys, target, place)
    }
    const lead = (
      <button
        type="button"
        draggable={movable}
        disabled={!movable}
        aria-label={`Move ${label}`}
        title={
          movable
            ? 'Drag to change the draw order (the top of the list draws on top); ↑ and ↓ move it one place'
            : 'Its draw order is fixed'
        }
        className={cn(
          'flex h-6 w-3.5 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-0 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-primary',
          quietActionClass,
        )}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', label)
          setDragging({ id, keys, group })
        }}
        onDragEnd={() => {
          setDragging(null)
          setDropTarget(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' && index > 0) {
            event.preventDefault()
            move(index - 1, 'above')
          } else if (event.key === 'ArrowDown' && index < siblings.length - 1) {
            event.preventDefault()
            move(index + 1, 'below')
          }
        }}
      >
        <GripVertical className="size-3" aria-hidden="true" />
      </button>
    )
    const accepts = !!dragging && dragging.group === group && dragging.id !== id
    const placeOf = (event: React.DragEvent<HTMLDivElement>) => {
      const box = event.currentTarget.getBoundingClientRect()
      return event.clientY < box.top + box.height / 2 ? ('above' as const) : ('below' as const)
    }
    return {
      lead,
      dropAt: accepts && dropTarget?.id === id ? dropTarget.place : null,
      rowProps: accepts
        ? {
            onDragOver: (event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              const place = placeOf(event)
              if (dropTarget?.id !== id || dropTarget.place !== place) setDropTarget({ id, place })
            },
            onDragLeave: (event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
            },
            onDrop: (event) => {
              event.preventDefault()
              onMoveLayers(dragging.keys, keys, placeOf(event))
              setDragging(null)
              setDropTarget(null)
            },
          }
        : undefined,
    }
  }
  if (!open) return null

  /** The folder a layer or folder sits in, for its sibling list. */
  const parentOf = (path: string) => path.split('/').slice(0, -1).join('/')
  const renderLayer = (
    { key, name, features }: ReferenceLayer,
    index = 0,
    siblings: readonly ReferenceLayer[] = [],
    order = ordering(
      `layer:${key}`,
      `layer ${name}`,
      [key],
      `${parentOf(key)}:layer`,
      siblings.map((layer) => [layer.key]),
      index,
    ),
  ) => {
    const branchKey = `layer:${key}`
    const expanded = disclosures[branchKey] ?? false
    const visible = !hiddenKeys?.includes(key)
    const role = features[0].cutblock ? 'planned-block' : (features[0].role ?? 'reference')
    // A layer is styled as its largest shape: an area's look covers its outline, a line's its dash.
    const shapes = new Set(features.map(referenceShape))
    const shape = shapes.has('area') ? 'area' : shapes.has('line') ? 'line' : 'point'
    // Planned blocks keep the block sheet's symbol; scanned sheets and class rasters are images.
    const styleable = !!onLayerStyleChange && role !== 'planned-block' && features.some((f) => !isImageFrame(f))
    const buffer = cutblockBuffers?.find(({ layer }) => layer === key)
    const bufferVisible = !hiddenKeys?.includes(cutblockBufferKey(key))
    const bufferSource = buffer && 'source' in buffer ? layers.find((layer) => layer.key === buffer.source) : undefined
    const bufferName =
      buffer &&
      ('metres' in buffer ? `${buffer.metres.toLocaleString()} m buffer` : (bufferSource?.name ?? 'Imported buffer'))
    return (
      <li key={key} data-layer-source={key}>
        <Branch
          {...order}
          name={name}
          title={key}
          detail={String(features.length)}
          tag={!expanded && role !== 'reference' ? LAYER_IMPORT_LABELS[role] : undefined}
          icon={
            <Layers3
              className="size-3.5 shrink-0"
              style={{ color: referenceLayerColor(key, referenceStyles) }}
              aria-hidden="true"
            />
          }
          open={expanded}
          toggle={() => toggle(branchKey, expanded)}
          muted={!visible}
          actions={
            <>
              {styleable && (
                <SymbolField
                  shape={shape}
                  defaults={referenceStyleDefaults(key, name, shape)}
                  value={referenceStyleFor(referenceStyles, key)}
                  onChange={(style) => onLayerStyleChange(key, style)}
                  label={`Look of layer ${name}`}
                  colorPresets={REFERENCE_COLOR_PRESETS}
                  groundWidth
                  disabled={disabled}
                  className="mr-0.5 self-center"
                />
              )}
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
                      (feature) => !feature.cutblock && !isImageFrame(feature) && feature.geometry.type === 'Polygon',
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
                                  : feature.imageMosaic
                                    ? `Image layer at its own pixels (${feature.imageMosaic.width.toLocaleString('en-CA')} × ${feature.imageMosaic.height.toLocaleString('en-CA')})`
                                    : feature.sheet
                                      ? 'Source sheet'
                                      : 'Recovered drawing'}
                                ; registration fit {feature.pdfSource.registrationErrorM.toFixed(2)} m. This is a
                                control-point fit, not source accuracy.
                              </p>
                              <DisclosureRow
                                title="Source fingerprint"
                                summary={`SHA-256 ${feature.pdfSource.sha256.slice(0, 12)}…`}
                              >
                                <p className="break-all">SHA-256 {feature.pdfSource.sha256}</p>
                              </DisclosureRow>
                            </div>
                          )}
                          {feature.attributes && (
                            <DisclosureRow
                              title="Source attributes"
                              summary={`${Object.keys(feature.attributes).length} fields`}
                              contentClassName="text-2xs"
                            >
                              <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-2 gap-y-0.5 break-words">
                                {Object.entries(feature.attributes).map(([key, value]) => (
                                  <Fragment key={key}>
                                    <dt className="text-muted-foreground">{key}</dt>
                                    <dd>{value === null ? 'Not recorded' : String(value)}</dd>
                                  </Fragment>
                                ))}
                              </dl>
                            </DisclosureRow>
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
  const renderFolder = (listed: ReferenceFolder, index = 0, siblings: readonly ReferenceFolder[] = []) => {
    const { folder, label, onlyLayer } = compactReferenceFolder(listed)
    // A folder moves among its sibling folders, with every layer in it.
    const order = ordering(
      `folder:${listed.path}`,
      `folder ${onlyLayer?.name ?? label}`,
      folderLayerKeys(listed),
      `${parentOf(listed.path)}:folder`,
      siblings.map(folderLayerKeys),
      index,
    )
    // A folder around one file is listed as that file; its path stays in the row's tooltip.
    if (onlyLayer) return renderLayer(onlyLayer, 0, [], order)
    const key = `folder:${folder.path}`
    const expanded = disclosures[key] ?? true
    const Icon = expanded ? FolderOpen : Folder
    return (
      <li key={folder.path} data-layer-folder={folder.path}>
        <Branch
          {...order}
          name={label}
          icon={<Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          open={expanded}
          toggle={() => toggle(key, expanded)}
          muted={!groupShown(folderLayerKeys(folder), hiddenKeys)}
          actions={
            <VisibilityButton
              visible={groupShown(folderLayerKeys(folder), hiddenKeys)}
              label={`every layer in ${label}`}
              title={groupShown(folderLayerKeys(folder), hiddenKeys) ? 'Hide the folder' : 'Show the folder'}
              onToggle={() =>
                onVisibilityChange(folderLayerKeys(folder), !groupShown(folderLayerKeys(folder), hiddenKeys))
              }
            />
          }
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
          dropHint="Drop GIS files, map PDFs or a folder here"
          iconsBelow={320}
          accept={REFERENCE_ACCEPT}
          onFiles={onFiles}
          onError={onReadError}
          disabled={disabled}
          dropProps={{ 'data-testid': 'road-layer-drop' }}
        />
        {(layers.length > 0 || roads.length > 0 || baseLayers.length > 0 || basemap || terrain) && (
          <>
            <div className="flex flex-wrap gap-2">
              {layers.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => onLocate(layers.flatMap((layer) => layer.features))}>
                  <LocateFixed className="mr-1.5 size-3.5" aria-hidden="true" />
                  Fit all layers
                </Button>
              )}
              {everyKey.length + switchableOverlays.length + switchableBase.length + (basemapSwitchable ? 1 : 0) >
                0 && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={anyShown ? 'Hide all layers' : 'Show all layers'}
                  title={
                    anyShown
                      ? 'Hide every layer, design road, overlay and base layer on the plan, the basemap too; the terrain stays'
                      : 'Show every layer, design road, overlay, base layer and the basemap again; imagery you turned on yourself stays off'
                  }
                  onClick={() => setAll(!anyShown)}
                >
                  {anyShown ? (
                    <EyeOff className="mr-1.5 size-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="mr-1.5 size-3.5" aria-hidden="true" />
                  )}
                  {anyShown ? 'Hide all' : 'Show all'}
                </Button>
              )}
            </div>
            <ul aria-label="Project layers" className="rounded-md border p-1">
              {roads.length > 0 && (
                <li>
                  <Branch
                    name="Design roads"
                    detail={String(roads.length)}
                    icon={<Route className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    open={disclosures.roads ?? true}
                    toggle={() => toggle('roads', disclosures.roads ?? true)}
                    muted={!roadsShown}
                    actions={
                      <VisibilityButton
                        visible={roadsShown}
                        label="all design roads"
                        title={roadsShown ? 'Hide every design road on the plan' : 'Show every design road'}
                        onToggle={() => onVisibilityChange(roadKeys, !roadsShown)}
                      />
                    }
                  >
                    <ul>
                      {roads.map((road) => {
                        const roadKey = designRoadLayerKey(road.id)
                        const shown = !hiddenKeys?.includes(roadKey)
                        return (
                          <li key={road.id} className="group/row flex min-w-0 items-center rounded-sm hover:bg-accent">
                            <button
                              type="button"
                              aria-current={road.id === activeAlignmentId ? 'true' : undefined}
                              disabled={disabled}
                              className="flex min-w-0 flex-1 items-center rounded-sm py-1.5 pl-1 text-left text-xs aria-[current=true]:bg-primary/10 aria-[current=true]:font-medium touch:min-h-11"
                              onClick={() => onShowRoad(road)}
                              title="Select and fit road on the plan"
                            >
                              <span className={cn('min-w-0 flex-1 truncate', !shown && 'text-muted-foreground')}>
                                {road.name}
                              </span>
                            </button>
                            {/* The same column as a layer row's actions: the eye, then the fit. */}
                            <div className="flex shrink-0">
                              <VisibilityButton
                                visible={shown}
                                label={`road ${road.name}`}
                                title={shown ? 'Hide road on the plan' : 'Show road on the plan'}
                                onToggle={() => onVisibilityChange([roadKey], !shown)}
                              />
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                className={rowActionClass}
                                aria-label={`Fit road ${road.name}`}
                                title="Select and fit road on the plan"
                                disabled={disabled}
                                onClick={() => onShowRoad(road)}
                              >
                                <LocateFixed aria-hidden="true" />
                              </Button>
                            </div>
                          </li>
                        )
                      })}
                      {roadLayers.length > 0 && <li aria-hidden="true" className="mx-1 my-1 border-t border-border" />}
                      {roadLayers.map((layer) => (
                        <DisplayLayerRow key={layer.key} layer={layer} />
                      ))}
                    </ul>
                  </Branch>
                </li>
              )}
              {[...tree.folders.values()].map(renderFolder)}
              {tree.layers.map(renderLayer)}
              {terrain && (
                <li data-terrain-group="">
                  <Branch
                    name="Terrain"
                    icon={<Mountain className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    open={disclosures.terrain ?? true}
                    toggle={() => toggle('terrain', disclosures.terrain ?? true)}
                  >
                    <div className="space-y-1.5 py-1 pl-1">
                      <p className="flex min-w-0 items-baseline gap-1.5 text-xs" title={terrain.name}>
                        <span className="min-w-0 truncate">{terrain.name}</span>
                        {terrain.detail && (
                          <span className="shrink-0 text-2xs text-muted-foreground">{terrain.detail}</span>
                        )}
                      </p>
                      {/* The terrain commands as the Terrain tab draws them: the same registry entries. */}
                      <div className="flex flex-wrap gap-1.5">
                        {terrain.commands.map((id) => (
                          <CommandButton
                            key={id}
                            id={id}
                            surface="sidebar"
                            state={terrain.states?.[id]}
                            presentation={{ className: 'px-2 text-xs' }}
                            onRun={terrain.onCommand}
                          />
                        ))}
                      </div>
                    </div>
                    {terrain.layers && terrain.layers.length > 0 && (
                      <ul>
                        {terrain.layers.map((layer) => (
                          <DisplayLayerRow key={layer.key} layer={layer} />
                        ))}
                      </ul>
                    )}
                  </Branch>
                </li>
              )}
              {(baseLayers.length > 0 || basemap) && (
                <li>
                  <Branch
                    name="Base map"
                    icon={<MapIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    open={disclosures.baseMap ?? true}
                    toggle={() => toggle('baseMap', disclosures.baseMap ?? true)}
                    muted={!baseShown}
                    actions={
                      (switchableBase.length > 0 || basemapSwitchable) && (
                        <VisibilityButton
                          visible={baseShown}
                          label="the base map"
                          title={baseShown ? 'Hide the basemap and its layers' : 'Show the basemap and its layers'}
                          onToggle={() => setBase(!baseShown)}
                        />
                      )
                    }
                  >
                    <ul>
                      {basemap && <BasemapRow choice={basemap} disabled={disabled} />}
                      {baseLayers.map((layer) => (
                        <DisplayLayerRow key={layer.key} layer={layer} />
                      ))}
                    </ul>
                  </Branch>
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </RibbonTaskPane>
  )
}
