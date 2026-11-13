import { useId, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Eye, EyeOff, Folder, FolderOpen, Layers3, LocateFixed, Route, Trash2 } from 'lucide-react'
import { RibbonTaskPane } from '@/components/interfaces/RibbonTaskPane'
import { Button } from '@/components/ui/button'
import { FileDropField } from '@/components/ui/file-drop-field'
import type { PickedFile } from '@/components/ui/picked-files'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { cn } from '@/lib/utils'
import { roadFieldClass } from './Controls'
import {
  importedCutblockFeatures,
  referenceFolders,
  referenceLayers,
  referenceShape,
  type LayerFeature,
  type ReferenceFolder,
  type ReferenceLayer,
} from './referenceFeatures'
import { referenceLayerColor } from './ReferenceLayer'
import { LAYER_IMPORT_LABELS, REFERENCE_ACCEPT } from './referenceImport'
import { CutblockBufferField } from './CutblockBufferField'
import { cutblockBufferKey, type CutblockBuffer } from './cutblockBuffers'
import type { DrawMode } from './PlanView'
import type { Alignment, Coordinate } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'
import { PdfRasterDetails } from './PdfRasterDetails'

const SHAPE_LABELS = { point: 'Point', line: 'Line', area: 'Area' } as const

function ReferenceName({
  name,
  label,
  disabled,
  onRename,
}: {
  name: string
  label: string
  disabled: boolean
  onRename: (name: string) => void
}) {
  const [draft, setDraft] = useState(name)
  return (
    <input
      className={`${roadFieldClass} min-w-0 flex-1`}
      aria-label={label}
      disabled={disabled}
      maxLength={200}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim()
        if (next && next !== name) onRename(next)
        else setDraft(name)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (['Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.stopPropagation()
      }}
    />
  )
}

/** A disclosure row with its actions beside the toggle so each action has its own focus target. */
function Branch({
  name,
  detail,
  icon,
  open,
  toggle,
  actions,
  children,
  muted,
}: {
  name: string
  detail?: string
  icon: ReactNode
  open: boolean
  toggle: () => void
  actions?: ReactNode
  children: ReactNode
  muted?: boolean
}) {
  const id = useId()
  return (
    <>
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline focus-visible:outline-primary touch:min-h-11"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
          title={name}
        >
          <ChevronRight
            aria-hidden="true"
            className={cn('size-3.5 shrink-0 text-muted-foreground', open && 'rotate-90')}
          />
          <span className={cn('flex min-w-0 items-center gap-1.5', muted && 'text-muted-foreground')}>
            {icon}
            <span className="truncate">{name}</span>
          </span>
          {detail && <span className="shrink-0 text-2xs text-muted-foreground">{detail}</span>}
        </button>
        {actions && <div className="flex shrink-0">{actions}</div>}
      </div>
      <div id={id} hidden={!open} className="ml-2.5 border-l border-border pl-2">
        {open && children}
      </div>
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
          detail={String(features.length)}
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
                aria-label={`${visible ? 'Hide' : 'Show'} layer ${name}`}
                title={visible ? 'Hide layer' : 'Show layer'}
                onClick={() => onVisibilityChange([key], !visible)}
              >
                {visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Fit layer ${name}`}
                title="Fit layer on plan"
                onClick={() => onLocate(features)}
              >
                <LocateFixed aria-hidden="true" />
              </Button>
            </>
          }
        >
          <p className="px-1 py-1 text-2xs text-muted-foreground">{LAYER_IMPORT_LABELS[role]}</p>
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
                    aria-label={`Fit buffer for ${name}`}
                    onClick={() => onFitBuffer(buffer)}
                  >
                    <LocateFixed aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
          )}
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() => onRemoveLayer(key, name)}
            className="mb-1"
          >
            <Trash2 className="mr-1" aria-hidden="true" /> Delete layer
          </Button>
          <VirtualResultList
            items={features}
            getKey={(feature) => feature.id}
            estimateSize={30}
            label={`Features in ${name}`}
          >
            {(feature) => {
              const detailKey = `feature:${feature.id}`
              const detailsOpen = disclosures[detailKey] ?? false
              const shape = referenceShape(feature)
              const at = shape === 'point' ? (feature.geometry.coordinates as Coordinate) : null
              return (
                <div
                  className={cn('min-w-0', feature.id === focusedId && 'bg-primary/5')}
                  data-reference-row={feature.id}
                >
                  <Branch
                    name={feature.name}
                    detail={SHAPE_LABELS[shape]}
                    icon={null}
                    open={detailsOpen}
                    toggle={() => toggle(detailKey, detailsOpen)}
                    actions={
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Show ${feature.name} on the plan`}
                        title="Show on plan"
                        onClick={() => onLocate([feature], feature.id)}
                      >
                        <LocateFixed aria-hidden="true" />
                      </Button>
                    }
                  >
                    <div className="space-y-2 pb-2 pr-1">
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
                            <summary>Source fingerprint</summary>
                            <p className="break-all">SHA-256 {feature.pdfSource.sha256}</p>
                          </details>
                        </div>
                      )}
                      {feature.attributes && (
                        <details className="text-2xs">
                          <summary>Source attributes</summary>
                          <dl className="mt-1 space-y-1">
                            {Object.entries(feature.attributes).map(([key, value]) => (
                              <div key={key} className="break-words">
                                <dt className="font-medium">{key}</dt>
                                <dd>{value === null ? 'Not recorded' : String(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                      <div className="flex items-center gap-1">
                        <ReferenceName
                          key={feature.name}
                          name={feature.name}
                          disabled={disabled}
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
                        />
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Remove ${feature.name}`}
                          title="Remove feature"
                          disabled={disabled}
                          onClick={() =>
                            w.update(
                              (project) =>
                                feature.cutblock
                                  ? { ...project, context: project.context.filter((item) => item.id !== feature.id) }
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
                      </div>
                      {feature.role === 'proposed-road' && (
                        <Button size="xs" variant="outline" disabled={disabled} onClick={() => onCopyRoad(feature)}>
                          Copy as design road
                        </Button>
                      )}
                      {at && (onPegAt || onRoadEndAt) && (
                        <div className="flex flex-wrap gap-1">
                          {onPegAt && (
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={disabled}
                              onClick={() => onPegAt(at, feature.name)}
                            >
                              {pegging ? 'Peg here' : 'Peg from'}
                            </Button>
                          )}
                          {onRoadEndAt &&
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
                    </div>
                  </Branch>
                </div>
              )
            }}
          </VirtualResultList>
        </Branch>
      </li>
    )
  }
  const renderFolder = (folder: ReferenceFolder) => {
    const key = `folder:${folder.path}`
    const expanded = disclosures[key] ?? true
    const Icon = expanded ? FolderOpen : Folder
    return (
      <li key={folder.path} data-layer-folder={folder.path}>
        <Branch
          name={folder.name}
          icon={<Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
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
                            className="flex w-full items-center justify-between gap-1 rounded-sm px-1 py-1.5 text-left text-xs hover:bg-accent aria-[current=true]:bg-primary/10"
                            onClick={() => onShowRoad(road)}
                            title="Select and fit road on the plan"
                          >
                            <span className="min-w-0 truncate">{road.name}</span>
                            <LocateFixed className="size-3.5 shrink-0" aria-hidden="true" />
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
