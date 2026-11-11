import { useState } from 'react'
import { LayoutDashboard, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { roadFieldClass, RoadSelect } from './Controls'
import {
  ROAD_LAYOUT_OPTIONS,
  ROAD_PANEL_OPTIONS,
  panelsEdited,
  roadPanelsKey,
  roadPaneKey,
  type RoadLayout,
  type RoadPaneId,
} from './RoadPaneLayout'

/** A named screen layout: one of the preset arrangements with its own remembered pane sizes. */
export type SavedLayout = { id: string; name: string; base: RoadLayout }
const STORAGE = 'pgmaps-road-saved-layouts'
const MANAGE = '__manage'
/** Shown while a preset's panels are changed, so picking that preset again counts as a change. */
const EDITED = '__edited'
/** Each thumbnail draws its preset's real arrangement on a two-by-two grid. */
const LAYOUT_THUMBNAILS: Record<RoadLayout, string[]> = {
  linked: ['row-span-2', '', ''],
  split: ['row-span-2', 'row-span-2'],
  plan: ['col-span-2 row-span-2'],
  engineering: ['', '', '', ''],
  pegging: ['', '', '', ''],
}

export function readSavedLayouts(): SavedLayout[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '[]')
    return Array.isArray(value)
      ? value.filter(
          (v): v is SavedLayout =>
            !!v &&
            typeof v.id === 'string' &&
            typeof v.name === 'string' &&
            ROAD_LAYOUT_OPTIONS.some((o) => o.value === v.base),
        )
      : []
  } catch {
    return []
  }
}
function writeSavedLayouts(layouts: SavedLayout[]) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(layouts))
  } catch {
    /* Saved layouts are a convenience. */
  }
}

/** A selection is a preset id or `saved:<id>`; sizes live under the preset id or `saved-<id>`. */
export function resolveLayout(
  selection: string,
  saved: SavedLayout[],
): { base: RoadLayout; storageId: string; selection: string } {
  const named = selection.startsWith('saved:') ? saved.find((s) => `saved:${s.id}` === selection) : undefined
  if (named) return { base: named.base, storageId: `saved-${named.id}`, selection }
  // A deleted saved layout falls back here too; report the preset so the picker never shows blank.
  const preset = ROAD_LAYOUT_OPTIONS.find((o) => o.value === selection)?.value ?? 'linked'
  return { base: preset, storageId: preset, selection: preset }
}

export function LayoutPicker({
  selection,
  onSelect,
  saved,
  onSaved,
  portalContainer,
  hiddenPanels,
  onHiddenPanels,
  compact = false,
  showButtonLabel = false,
}: {
  selection: string
  hiddenPanels: RoadPaneId[]
  compact?: boolean
  showButtonLabel?: boolean
  onHiddenPanels: (hidden: RoadPaneId[]) => void
  /** `saved` carries the list when a layout is selected in the same update that creates it. */
  onSelect: (selection: string, saved?: SavedLayout[]) => void
  saved: SavedLayout[]
  onSaved: (layouts: SavedLayout[]) => void
  portalContainer?: HTMLElement | null
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const current = resolveLayout(selection, saved)
  const isPreset = !current.selection.startsWith('saved:')
  const edited = isPreset && panelsEdited(current.base, hiddenPanels)
  const presetLabel = ROAD_LAYOUT_OPTIONS.find((o) => o.value === current.base)?.label
  const save = () => {
    const label = name.trim().slice(0, 60) || `Layout ${saved.length + 1}`
    const layout: SavedLayout = { id: crypto.randomUUID(), name: label, base: current.base }
    // The new layout starts from the current pane sizes, then keeps its own.
    try {
      const prefix = roadPaneKey(current.storageId, '')
      for (const key of Object.keys(localStorage).filter((key) => key.startsWith(prefix))) {
        const value = localStorage.getItem(key)
        if (value !== null) localStorage.setItem(roadPaneKey(`saved-${layout.id}`, key.slice(prefix.length)), value)
      }
      localStorage.setItem(roadPanelsKey(`saved-${layout.id}`), JSON.stringify(hiddenPanels))
    } catch {
      /* Sizes fall back to the defaults. */
    }
    const next = [...saved, layout]
    writeSavedLayouts(next)
    onSaved(next)
    onSelect(`saved:${layout.id}`, next)
    setName('')
    setOpen(false)
  }
  const remove = (layout: SavedLayout) => {
    const next = saved.filter((s) => s.id !== layout.id)
    try {
      const prefix = roadPaneKey(`saved-${layout.id}`, '')
      for (const key of Object.keys(localStorage).filter((key) => key.startsWith(prefix))) localStorage.removeItem(key)
      localStorage.removeItem(roadPanelsKey(`saved-${layout.id}`))
    } catch {
      /* Nothing to clean. */
    }
    writeSavedLayouts(next)
    onSaved(next)
    if (selection === `saved:${layout.id}`) onSelect(layout.base, next)
  }
  return (
    <>
      <span className={compact ? 'hidden' : 'contents'}>
        <RoadSelect
          value={edited ? EDITED : current.selection}
          onValueChange={(value) => {
            if (value === MANAGE) setOpen(true)
            else if (value !== EDITED) onSelect(value)
          }}
          options={[
            ...(edited ? [{ value: EDITED, label: `${presetLabel} · edited` }] : []),
            ...ROAD_LAYOUT_OPTIONS,
            ...saved.map((s) => ({ value: `saved:${s.id}`, label: `★ ${s.name}` })),
            { value: MANAGE, label: 'Save or manage layouts…' },
          ]}
          ariaLabel="Road view layout"
          className="h-8 w-[min(15rem,60vw)]"
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
          'data-testid': 'road-layouts-dialog',
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
            {ROAD_LAYOUT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`rounded-lg border p-3 text-left hover:bg-accent ${!edited && current.selection === option.value ? 'border-primary bg-primary/5' : ''}`}
                aria-pressed={!edited && current.selection === option.value}
                onClick={() => {
                  onSelect(option.value)
                  setOpen(false)
                }}
              >
                <span className="mb-2 grid h-12 grid-cols-2 grid-rows-2 gap-1" aria-hidden="true">
                  {LAYOUT_THUMBNAILS[option.value].map((cell, index) => (
                    <span key={index} className={`rounded-sm bg-muted-foreground/20 ${cell}`} />
                  ))}
                </span>
                <span className="block font-medium">{option.label}</span>
              </button>
            ))}
          </div>
          <fieldset className="space-y-1 border-y py-3">
            <legend className="font-semibold">Visible panels</legend>
            {ROAD_PANEL_OPTIONS.filter(
              (option) => option.id !== 'data' || ['engineering', 'pegging'].includes(current.base),
            ).map((option) => (
              <label key={option.id} className="flex items-center justify-between py-1.5">
                {option.label}
                <input
                  type="checkbox"
                  aria-label={`Show ${option.label.toLowerCase()} panel`}
                  checked={!hiddenPanels.includes(option.id)}
                  disabled={
                    !hiddenPanels.includes(option.id) &&
                    ROAD_PANEL_OPTIONS.filter(
                      (p) => p.id !== 'data' || ['engineering', 'pegging'].includes(current.base),
                    ).filter((p) => !hiddenPanels.includes(p.id)).length <= 1
                  }
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
              className={roadFieldClass}
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
                    {s.name}{' '}
                    <span className="text-muted-foreground">
                      · {ROAD_LAYOUT_OPTIONS.find((o) => o.value === s.base)?.label}
                    </span>
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
