import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { AppSelect } from '@/components/ui/select'
import { roadFieldClass } from './Controls'
import { ROAD_LAYOUT_OPTIONS, ROAD_PANE_SPLITS, roadPaneKey, type RoadLayout } from './RoadPaneLayout'

/** A named screen layout: one of the preset arrangements with its own remembered pane sizes. */
export type SavedLayout = { id: string; name: string; base: RoadLayout }
const STORAGE = 'pgmaps-road-saved-layouts'
const MANAGE = '__manage'

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
export function resolveLayout(selection: string, saved: SavedLayout[]): { base: RoadLayout; storageId: string } {
  const named = selection.startsWith('saved:') ? saved.find((s) => `saved:${s.id}` === selection) : undefined
  if (named) return { base: named.base, storageId: `saved-${named.id}` }
  const preset = ROAD_LAYOUT_OPTIONS.find((o) => o.value === selection)?.value ?? 'linked'
  return { base: preset, storageId: preset }
}

export function LayoutPicker({
  selection,
  onSelect,
  saved,
  onSaved,
  portalContainer,
}: {
  selection: string
  onSelect: (selection: string) => void
  saved: SavedLayout[]
  onSaved: (layouts: SavedLayout[]) => void
  portalContainer?: HTMLElement | null
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const current = resolveLayout(selection, saved)
  const save = () => {
    const label = name.trim().slice(0, 60) || `Layout ${saved.length + 1}`
    const layout: SavedLayout = { id: crypto.randomUUID(), name: label, base: current.base }
    // The new layout starts from the current pane sizes, then keeps its own.
    try {
      for (const split of ROAD_PANE_SPLITS)
        for (const suffix of ['', ':stacked']) {
          const value = localStorage.getItem(roadPaneKey(current.storageId, split) + suffix)
          if (value !== null) localStorage.setItem(roadPaneKey(`saved-${layout.id}`, split) + suffix, value)
        }
    } catch {
      /* Sizes fall back to the defaults. */
    }
    const next = [...saved, layout]
    writeSavedLayouts(next)
    onSaved(next)
    onSelect(`saved:${layout.id}`)
    setName('')
    setOpen(false)
  }
  const remove = (layout: SavedLayout) => {
    const next = saved.filter((s) => s.id !== layout.id)
    try {
      for (const split of ROAD_PANE_SPLITS)
        for (const suffix of ['', ':stacked'])
          localStorage.removeItem(roadPaneKey(`saved-${layout.id}`, split) + suffix)
    } catch {
      /* Nothing to clean. */
    }
    writeSavedLayouts(next)
    onSaved(next)
    if (selection === `saved:${layout.id}`) onSelect(layout.base)
  }
  return (
    <>
      <AppSelect
        value={selection}
        onValueChange={(value) => (value === MANAGE ? setOpen(true) : onSelect(value))}
        options={[
          ...ROAD_LAYOUT_OPTIONS,
          ...saved.map((s) => ({ value: `saved:${s.id}`, label: `★ ${s.name}` })),
          { value: MANAGE, label: 'Save or manage layouts…' },
        ]}
        triggerAriaLabel="Road view layout"
        triggerClassName="h-8 w-[min(15rem,60vw)] text-xs"
        contentClassName="text-xs"
      />
      <PanelDialog
        open={open}
        onOpenChange={setOpen}
        portalContainer={portalContainer}
        size="md"
        title="Screen layouts"
        subtitle="A saved layout keeps its own pane sizes on this device."
        contentProps={{ 'data-testid': 'road-layouts-dialog' }}
      >
        <div className="space-y-3 text-xs">
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
