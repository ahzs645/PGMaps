/**
 * The layers drawn over an own photo, in the shared `LayerList` (`src/components/ui/layer-list.tsx`), grouped as
 * `PHOTO_LAYER_GROUPS` lists them: each row's swatch is the symbol it draws with, its (i) says where its features come
 * from, and hovering it tints its ground in the photo. A layer with nothing read for this photo says so and stays off
 * rather than reading as empty; one still being read, or read for only part of the ground, says so on its row.
 * Layers a caller adds (`PhotoCustomLayer`) are listed after them, under their own headings.
 * Shown in a `ToolbarPopover` beside the docked photo, and inline in the photo window, whose modal focus trap a
 * popover's portal would sit outside.
 */
import { LayerList, type LayerListGroup } from '@/components/ui/layer-list'
import { SheetSymbolSwatch } from '@/components/ui/sheet-symbol-swatch'

import {
  CUSTOM_LAYER_GROUP,
  PHOTO_LAYER_GROUPS,
  PHOTO_LAYERS,
  customLayerKey,
  photoLayerLegend,
  type PhotoCustomLayer,
  type PhotoLayerId,
} from './photoLayers'

export type PhotoLayerAvailability = Partial<Record<PhotoLayerId, string>>

/** The rows' words for the states a layer's reading can be in: the full sentence stays behind the (i). */
const shortNote = (note: string) =>
  /when switched on/i.test(note)
    ? 'Read when shown'
    : /landform only/i.test(note)
      ? 'Scene’s landform only'
      : /^not read/i.test(note)
        ? 'Not read'
        : note

/** The groups the panel lists: the built-in layers, then any a caller added, by heading. */
export function photoLayerGroups({
  unavailable = {},
  notes = {},
  styleId,
  custom = [],
}: {
  unavailable?: PhotoLayerAvailability
  notes?: PhotoLayerAvailability
  styleId?: string | null
  custom?: readonly PhotoCustomLayer[]
}): LayerListGroup[] {
  const builtIn: LayerListGroup[] = PHOTO_LAYER_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    items: PHOTO_LAYERS.filter((layer) => layer.group === group.id).map((layer) => {
      const why = unavailable[layer.id]
      const note = notes[layer.id]
      const [symbol] = photoLayerLegend(layer.id, styleId)
      return {
        id: layer.id,
        label: layer.label,
        swatch: symbol ? <SheetSymbolSwatch symbol={symbol} /> : undefined,
        help: (
          <>
            {layer.source}.{layer.candidate ? ' A candidate: drawn, never adopted.' : ''}
            {why ? ` ${why}` : note ? ` ${note}` : ''}
          </>
        ),
        ...(why ? { unavailable: shortNote(why) } : note ? { status: shortNote(note) } : {}),
      }
    }),
  }))
  const added = new Map<string, LayerListGroup>()
  for (const layer of custom) {
    const title = layer.group ?? CUSTOM_LAYER_GROUP
    const merged = builtIn.find((group) => group.title === title)
    const item = {
      id: customLayerKey(layer.id),
      label: layer.label,
      swatch: <SheetSymbolSwatch symbol={layer.symbol} />,
      help: <>{layer.source}.</>,
      ...(layer.features.length ? {} : { unavailable: 'Nothing to draw' }),
    }
    // Under a built-in heading when it names one, so "The scene" stays one list.
    if (merged) merged.items = [...merged.items, item]
    else {
      const group = added.get(title) ?? { id: `custom:${title}`, title, items: [] }
      group.items = [...group.items, item]
      added.set(title, group)
    }
  }
  return [...builtIn, ...added.values()]
}

export function PhotoLayersPanel({
  visibility,
  onChange,
  onHover,
  onReset,
  unavailable = {},
  notes = {},
  styleId,
  custom = [],
  className,
}: {
  /** By layer id, and by `customLayerKey` for a layer a caller added. */
  visibility: Readonly<Record<string, boolean>>
  onChange: (id: string, on: boolean) => void
  /** A row hovered or focused, to tint its ground in the photo; null when the pointer leaves. */
  onHover?: (id: string | null) => void
  onReset?: () => void
  /** Why a layer cannot be drawn for this photo, by layer; absent is drawable. */
  unavailable?: PhotoLayerAvailability
  /** What a layer's row says while it can still be switched on: reading, not read and why, read for part. */
  notes?: PhotoLayerAvailability
  styleId?: string | null
  /** Layers added beside the built-in ones. */
  custom?: readonly PhotoCustomLayer[]
  className?: string
}) {
  return (
    <div aria-label="Layers on the photo">
      <LayerList
        subject="the photo"
        groups={photoLayerGroups({ unavailable, notes, styleId, custom })}
        visibility={visibility}
        onChange={onChange}
        onHover={onHover}
        onReset={onReset}
        className={className}
      />
    </div>
  )
}
