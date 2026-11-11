import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FullscreenPanel } from '@/components/ui/fullscreen-panel'
import { PanelCorner } from '@/components/ui/panel-corner'
import { ResizableSplit } from '@/components/ui/resizable-split'
import { cn } from '@/lib/utils'

/** One view in a column: a map, a chart, a summary. */
export interface TilePaneSpec<P extends string = string> {
  id: P
  /** Names the pane in its separator's label, "Resize plan and data". */
  label: string
  size?: number
  min?: number
  stackedHeight?: number | 'auto'
}

/** A column of panes, side by side with the other columns. */
export interface TileColumnSpec<P extends string = string> {
  id: string
  label: string
  /** The name its pane sizes are stored under; the column id when absent. */
  storageName?: string
  size?: number
  min?: number
  panes: TilePaneSpec<P>[]
}

/** A named arrangement. Picking it always restores exactly `hidden`. */
export interface TilePreset<P extends string = string, L extends string = string> {
  id: L
  label: string
  /** The panes this preset has at all; the others are left out of their columns. All when absent. */
  panes?: readonly P[]
  hidden: readonly P[]
  /** The picker's thumbnail: one Tailwind cell class per drawn cell on a two-by-two grid. */
  thumbnail: readonly string[]
}

/** Everything a tool's tiled workspace is made of, kept apart from its contents. */
export interface TiledWorkspaceConfig<P extends string = string, L extends string = string> {
  /** Browser storage names: `pgmaps-<namespace>-panes`, `-panels` and `-saved-layouts`. */
  namespace: string
  /** The panel checklist, in order. */
  panes: readonly { id: P; label: string }[]
  presets: readonly TilePreset<P, L>[]
  defaultPreset: L
}

/** Pane and corner sizes live under the preset id, or a saved layout's own id. */
export const tilePaneKey = (namespace: string, storageId: string, split: string) =>
  `pgmaps-${namespace}-panes:${storageId}:${split}`
export const tilePanelsKey = (namespace: string, storageId: string) => `pgmaps-${namespace}-panels:${storageId}`

export function findPreset<P extends string, L extends string>(config: TiledWorkspaceConfig<P, L>, id: string) {
  return config.presets.find((preset) => preset.id === id) ?? config.presets.find((p) => p.id === config.defaultPreset)!
}
/** The panes a preset has at all. */
export const presetPanes = <P extends string, L extends string>(config: TiledWorkspaceConfig<P, L>, preset: L) =>
  findPreset(config, preset).panes ?? config.panes.map((pane) => pane.id)

/** Whether the visible panels no longer match the preset; panes it does not have are ignored. */
export function tilePanelsEdited<P extends string, L extends string>(
  config: TiledWorkspaceConfig<P, L>,
  preset: L,
  hidden: readonly P[],
) {
  const relevant = presetPanes(config, preset)
  const expected = findPreset(config, preset).hidden
  const current = hidden.filter((id) => relevant.includes(id))
  return current.length !== expected.length || expected.some((id) => !current.includes(id))
}

function readPanels<P extends string, L extends string>(
  config: TiledWorkspaceConfig<P, L>,
  storageId: string,
  preset: L,
): P[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(tilePanelsKey(config.namespace, storageId)) ?? 'null')
    if (Array.isArray(stored)) {
      const hidden = config.panes.filter((option) => stored.includes(option.id)).map((option) => option.id)
      // Retain at least one usable view even if browser storage is edited.
      if (presetPanes(config, preset).some((id) => !hidden.includes(id))) return hidden
    }
  } catch {
    /* Use the preset. */
  }
  return [...findPreset(config, preset).hidden]
}

/**
 * The panels hidden in the current layout, remembered per layout on this device. Returns the hidden
 * list, a setter, and a way to select a preset as defined, dropping panels opened or closed in it.
 */
export function useTilePanels<P extends string, L extends string>(
  config: TiledWorkspaceConfig<P, L>,
  storageId: string,
  preset: L,
) {
  const [state, setState] = useState(() => ({ key: storageId, hidden: readPanels(config, storageId, preset) }))
  if (state.key !== storageId) setState({ key: storageId, hidden: readPanels(config, storageId, preset) })
  useEffect(() => {
    try {
      localStorage.setItem(tilePanelsKey(config.namespace, state.key), JSON.stringify(state.hidden))
    } catch {
      /* Optional device preference. */
    }
  }, [config.namespace, state])
  return [
    state.hidden,
    (hidden: P[]) => setState({ key: storageId, hidden }),
    (next: L) => setState({ key: next, hidden: [...findPreset(config, next).hidden] }),
  ] as const
}

/**
 * Columns of panes, every boundary draggable and keyboard-operable, each layout remembering its own
 * sizes. The tree has the same shape in every layout, so switching layouts, hiding a pane or focusing
 * one keeps a map in another pane mounted: hidden panes stay mounted while their neighbours take the
 * space. A column whose panes are all hidden gives its space to the others. `focusedPane` shows one
 * pane at a time, for phones. Pass the panes a preset leaves out by omitting them from `columns`.
 */
export function TiledWorkspace<P extends string>({
  columns,
  contents,
  hidden = [],
  focusedPane,
  storageKey,
  className,
  ...props
}: {
  columns: TileColumnSpec<P>[]
  contents: Partial<Record<P, ReactNode>>
  hidden?: readonly P[]
  focusedPane?: P
  /** The browser key for one split's sizes: the columns (`'columns'`) or a column's `storageName`. */
  storageKey: (split: string) => string
} & Omit<HTMLAttributes<HTMLDivElement>, 'hidden'>) {
  const isHidden = (id: P) => hidden.includes(id) || (!!focusedPane && focusedPane !== id)
  return (
    <ResizableSplit
      {...props}
      direction="row"
      splitQuery="(min-width: 0px)"
      storageKey={storageKey('columns')}
      className={cn('min-h-0 flex-1', className)}
      data-focused-pane={focusedPane}
      panes={columns.map((column) => ({
        id: column.id,
        hidden: column.panes.every((pane) => isHidden(pane.id)),
        label: column.label,
        size: column.size,
        min: column.min,
        stackedHeight: 'auto' as const,
        content: (
          <ResizableSplit
            direction="column"
            splitQuery="(min-width: 0px)"
            storageKey={storageKey(column.storageName ?? column.id)}
            className="h-full"
            panes={column.panes.map((pane) => ({
              id: pane.id,
              hidden: isHidden(pane.id),
              label: pane.label,
              content: contents[pane.id],
              size: pane.size,
              min: pane.min,
              stackedHeight: pane.stackedHeight,
            }))}
          />
        ),
      }))}
    />
  )
}

/** A pane's close button; the pane comes back from the layout picker's panel list. */
export function TilePaneClose({
  label,
  disabled,
  onClose,
}: {
  /** "plan", "detail view": read as "Close plan panel". */
  label: string
  disabled?: boolean
  onClose: () => void
}) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-8"
      aria-label={`Close ${label} panel`}
      disabled={disabled}
      title="Close panel · restore in Screen presets & panels"
      onClick={onClose}
    >
      <X className="size-3.5" />
    </Button>
  )
}

/**
 * A pane's frame: the shared `FullscreenPanel` title bar with its actions and full-screen toggle, and
 * the dotted corner grip when `cornerKey` is set. `children` gets whether the pane is full screen.
 */
export function TilePane({
  title,
  actions,
  cornerKey,
  cornerLabel,
  className,
  children,
}: {
  title: string
  actions?: ReactNode
  cornerKey?: string
  cornerLabel?: string
  className?: string
  children: (fullscreen: boolean) => ReactNode
}) {
  return (
    <FullscreenPanel
      resizeHandle={cornerKey ? <PanelCorner storageKey={cornerKey} label={cornerLabel ?? title} /> : undefined}
      title={title}
      compact
      className={cn('flex min-h-0 flex-1 flex-col', className)}
      actions={actions}
    >
      {children}
    </FullscreenPanel>
  )
}
