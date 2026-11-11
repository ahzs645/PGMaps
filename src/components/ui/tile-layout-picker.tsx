import { useState } from 'react'
import { LayoutDashboard, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { AppSelect, compactSelectTriggerClass, workspaceSelectContentClass } from '@/components/ui/select'
import { SEARCHABLE_FROM } from '@/components/ui/styled-select'
import { cn } from '@/lib/utils'
import {
  findPreset,
  presetPanes,
  tilePaneKey,
  tilePanelsKey,
  tilePanelsEdited,
  type TiledWorkspaceConfig,
} from './tiled-workspace'

/** A named screen layout: one of the presets with its own remembered panels and pane sizes. */
export type SavedTileLayout<L extends string = string> = { id: string; name: string; base: L }
const MANAGE = '__manage'
/** Shown while a preset's panels are changed, so picking that preset again counts as a change. */
const EDITED = '__edited'
const savedKey = (namespace: string) => `pgmaps-${namespace}-saved-layouts`
const nameFieldClass =
  'w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-base md:text-xs md:[&:not(textarea)]:h-8'

export function readSavedTileLayouts<P extends string, L extends string>(
  config: TiledWorkspaceConfig<P, L>,
): SavedTileLayout<L>[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(savedKey(config.namespace)) ?? '[]')
    return Array.isArray(value)
      ? value.filter(
          (v): v is SavedTileLayout<L> =>
            !!v &&
            typeof v.id === 'string' &&
            typeof v.name === 'string' &&
            config.presets.some((preset) => preset.id === v.base),
        )
      : []
  } catch {
    return []
  }
}
function writeSavedTileLayouts(namespace: string, layouts: SavedTileLayout[]) {
  try {
    localStorage.setItem(savedKey(namespace), JSON.stringify(layouts))
  } catch {
    /* Saved layouts are a convenience. */
  }
}

/** A selection is a preset id or `saved:<id>`; sizes live under the preset id or `saved-<id>`. */
export function resolveTileLayout<P extends string, L extends string>(
  config: TiledWorkspaceConfig<P, L>,
  selection: string,
  saved: SavedTileLayout<L>[],
): { base: L; storageId: string; selection: string } {
  const named = selection.startsWith('saved:') ? saved.find((s) => `saved:${s.id}` === selection) : undefined
  if (named) return { base: named.base, storageId: `saved-${named.id}`, selection }
  // A deleted saved layout falls back here too; report the preset so the picker never shows blank.
  const preset = config.presets.find((o) => o.id === selection)?.id ?? config.defaultPreset
  return { base: preset, storageId: preset, selection: preset }
}

/**
 * The preset dropdown and the "Screen presets & panels" dialog: preset thumbnails, the visible-panel
 * checklist (at least one stays on), and saving or deleting named layouts. A preset always opens as
 * drawn; a saved layout starts from the current panels and sizes, then keeps its own.
 */
export function TileLayoutPicker<P extends string, L extends string>({
  config,
  selection,
  onSelect,
  saved,
  onSaved,
  portalContainer,
  hiddenPanels,
  onHiddenPanels,
  compact = false,
  showButtonLabel = false,
  selectLabel,
  dialogTestId,
}: {
  config: TiledWorkspaceConfig<P, L>
  selection: string
  hiddenPanels: P[]
  compact?: boolean
  showButtonLabel?: boolean
  onHiddenPanels: (hidden: P[]) => void
  /** `saved` carries the list when a layout is selected in the same update that creates it. */
  onSelect: (selection: string, saved?: SavedTileLayout<L>[]) => void
  saved: SavedTileLayout<L>[]
  onSaved: (layouts: SavedTileLayout<L>[]) => void
  portalContainer?: HTMLElement | null
  /** The dropdown's accessible name, e.g. "Road view layout". */
  selectLabel: string
  dialogTestId?: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const current = resolveTileLayout(config, selection, saved)
  const isPreset = !current.selection.startsWith('saved:')
  const edited = isPreset && tilePanelsEdited(config, current.base, hiddenPanels)
  const presetLabel = findPreset(config, current.base).label
  const available = presetPanes(config, current.base)
  const panelOptions = config.panes.filter((option) => available.includes(option.id))
  const shownCount = panelOptions.filter((p) => !hiddenPanels.includes(p.id)).length
  const save = () => {
    const label = name.trim().slice(0, 60) || `Layout ${saved.length + 1}`
    const layout: SavedTileLayout<L> = { id: crypto.randomUUID(), name: label, base: current.base }
    // The new layout starts from the current pane sizes, then keeps its own.
    try {
      const prefix = tilePaneKey(config.namespace, current.storageId, '')
      for (const key of Object.keys(localStorage).filter((key) => key.startsWith(prefix))) {
        const value = localStorage.getItem(key)
        if (value !== null)
          localStorage.setItem(tilePaneKey(config.namespace, `saved-${layout.id}`, key.slice(prefix.length)), value)
      }
      localStorage.setItem(tilePanelsKey(config.namespace, `saved-${layout.id}`), JSON.stringify(hiddenPanels))
    } catch {
      /* Sizes fall back to the defaults. */
    }
    const next = [...saved, layout]
    writeSavedTileLayouts(config.namespace, next)
    onSaved(next)
    onSelect(`saved:${layout.id}`, next)
    setName('')
    setOpen(false)
  }
  const remove = (layout: SavedTileLayout<L>) => {
    const next = saved.filter((s) => s.id !== layout.id)
    try {
      const prefix = tilePaneKey(config.namespace, `saved-${layout.id}`, '')
      for (const key of Object.keys(localStorage).filter((key) => key.startsWith(prefix))) localStorage.removeItem(key)
      localStorage.removeItem(tilePanelsKey(config.namespace, `saved-${layout.id}`))
    } catch {
      /* Nothing to clean. */
    }
    writeSavedTileLayouts(config.namespace, next)
    onSaved(next)
    if (selection === `saved:${layout.id}`) onSelect(layout.base, next)
  }
  const options = [
    ...(edited ? [{ value: EDITED, label: `${presetLabel} · edited` }] : []),
    ...config.presets.map((preset) => ({ value: preset.id as string, label: preset.label })),
    ...saved.map((s) => ({ value: `saved:${s.id}`, label: `★ ${s.name}` })),
    { value: MANAGE, label: 'Save or manage layouts…' },
  ]
  return (
    <>
      <span className={compact ? 'hidden' : 'contents'}>
        <AppSelect
          className="w-[min(15rem,60vw)] min-w-0"
          triggerClassName={cn(compactSelectTriggerClass, 'h-8')}
          contentClassName={workspaceSelectContentClass}
          triggerAriaLabel={selectLabel}
          value={edited ? EDITED : current.selection}
          onValueChange={(value) => {
            if (value === MANAGE) setOpen(true)
            else if (value !== EDITED) onSelect(value)
          }}
          options={options}
          searchable={options.length > SEARCHABLE_FROM}
        />
      </span>
      <Button
        size={showButtonLabel ? 'sm' : 'icon'}
        variant="outline"
        className={showButtonLabel ? 'gap-1' : 'size-8'}
        aria-label="Screen presets & panels"
        title="Screen presets & panels"
        onClick={() => setOpen(true)}
      >
        <LayoutDashboard className="size-4" />
        {showButtonLabel && 'Panels'}
      </Button>
      <PanelDialog
        open={open}
        onOpenChange={setOpen}
        portalContainer={portalContainer}
        size="md"
        title="Screen presets & panels"
        subtitle="A preset always opens as drawn. A saved layout keeps its own panels and pane sizes on this device."
        contentProps={{
          'data-testid': dialogTestId,
          onKeyDown: (event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.stopPropagation()
              setOpen(false)
            }
          },
        }}
      >
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {config.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`rounded-lg border p-3 text-left hover:bg-accent ${!edited && current.selection === preset.id ? 'border-primary bg-primary/5' : ''}`}
                aria-pressed={!edited && current.selection === preset.id}
                onClick={() => {
                  onSelect(preset.id)
                  setOpen(false)
                }}
              >
                <span className="mb-2 grid h-12 grid-cols-2 grid-rows-2 gap-1" aria-hidden="true">
                  {preset.thumbnail.map((cell, index) => (
                    <span key={index} className={`rounded-sm bg-muted-foreground/20 ${cell}`} />
                  ))}
                </span>
                <span className="block font-medium">{preset.label}</span>
              </button>
            ))}
          </div>
          <fieldset className="space-y-1 border-y py-3">
            <legend className="font-semibold">Visible panels</legend>
            {panelOptions.map((option) => (
              <label key={option.id} className="flex items-center justify-between py-1.5">
                {option.label}
                <input
                  type="checkbox"
                  aria-label={`Show ${option.label.toLowerCase()} panel`}
                  checked={!hiddenPanels.includes(option.id)}
                  disabled={!hiddenPanels.includes(option.id) && shownCount <= 1}
                  onChange={(event) =>
                    onHiddenPanels(
                      event.target.checked
                        ? hiddenPanels.filter((id) => id !== option.id)
                        : [...hiddenPanels, option.id],
                    )
                  }
                />
              </label>
            ))}
          </fieldset>

          <label className="flex flex-col gap-1">
            Name for the current layout
            <input
              className={nameFieldClass}
              value={name}
              maxLength={60}
              placeholder={`Layout ${saved.length + 1}`}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
              }}
            />
          </label>
          <Button size="sm" onClick={save}>
            Save current layout
          </Button>
          {saved.length > 0 && (
            <ul className="space-y-1">
              {saved.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                  <button className="text-left" onClick={() => (onSelect(`saved:${s.id}`), setOpen(false))}>
                    {s.name} <span className="text-muted-foreground">· {findPreset(config, s.base).label}</span>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    aria-label={`Delete layout ${s.name}`}
                    onClick={() => remove(s)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PanelDialog>
    </>
  )
}
