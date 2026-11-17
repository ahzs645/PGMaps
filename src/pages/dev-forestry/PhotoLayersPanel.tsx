/**
 * The layers drawn over an own photo, as rows of `OptionRow`s grouped as `PHOTO_LAYER_GROUPS` lists them: each row's
 * swatch is the symbol it draws with, its (i) says where its features come from, and hovering it tints its ground in
 * the photo. A layer with nothing read for this photo says so and stays off rather than reading as empty; one still
 * being read, or read for only part of the ground, says so beside its switch.
 * Shown in a `ToolbarPopover` beside the docked photo, and inline in the photo window, whose modal focus trap a
 * popover's portal would sit outside.
 */
import { InfoTip } from '@/components/ui/info-tip'
import { SheetSymbolSwatch } from '@/components/ui/sheet-symbol-swatch'
import { cn } from '@/lib/utils'

import { PHOTO_LAYER_GROUPS, PHOTO_LAYERS, photoLayerLegend, type PhotoLayerId } from './photoLayers'
import { OptionRow } from './RoadViewOptions'

export type PhotoLayerAvailability = Partial<Record<PhotoLayerId, string>>

export function PhotoLayersPanel({
  visibility,
  onChange,
  onHover,
  unavailable = {},
  notes = {},
  styleId,
  className,
}: {
  visibility: Record<PhotoLayerId, boolean>
  onChange: (id: PhotoLayerId, on: boolean) => void
  /** A row hovered or focused, to tint its ground in the photo; null when the pointer leaves. */
  onHover?: (id: PhotoLayerId | null) => void
  /** Why a layer cannot be drawn for this photo, by layer; absent is drawable. */
  unavailable?: PhotoLayerAvailability
  /** What a layer's row says while it can still be switched on: reading, not read and why, read for part. */
  notes?: PhotoLayerAvailability
  styleId?: string | null
  className?: string
}) {
  return (
    <div
      className={cn('space-y-3 p-3', className)}
      aria-label="Layers on the photo"
      onMouseLeave={() => onHover?.(null)}
    >
      {PHOTO_LAYER_GROUPS.map((group) => {
        const layers = PHOTO_LAYERS.filter((layer) => layer.group === group.id)
        return (
          <section key={group.id} className="space-y-1.5">
            <h4 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">{group.title}</h4>
            {layers.map((layer) => {
              const why = unavailable[layer.id]
              const note = notes[layer.id]
              const [symbol] = photoLayerLegend(layer.id, styleId)
              return (
                <div
                  key={layer.id}
                  onMouseEnter={() => onHover?.(layer.id)}
                  onFocus={() => onHover?.(layer.id)}
                  onBlur={() => onHover?.(null)}
                >
                  <OptionRow
                    label={layer.label}
                    info={
                      <InfoTip label={`About ${layer.label.toLowerCase()}`}>
                        {layer.source}.{layer.candidate ? ' A candidate: drawn, never adopted.' : ''}
                        {why ? ` ${why}` : note ? ` ${note}` : ''}
                      </InfoTip>
                    }
                  >
                    <label className="flex items-center justify-end gap-2 text-2xs text-muted-foreground">
                      {why ? (
                        <span className="truncate">{why}</span>
                      ) : (
                        <>
                          {note && (
                            <span className="truncate" title={note}>
                              {note}
                            </span>
                          )}
                          {symbol && <SheetSymbolSwatch symbol={symbol} />}
                        </>
                      )}
                      <input
                        type="checkbox"
                        aria-label={`Show ${layer.label.toLowerCase()} on the photo`}
                        checked={!why && visibility[layer.id]}
                        disabled={!!why}
                        onChange={(event) => onChange(layer.id, event.target.checked)}
                      />
                    </label>
                  </OptionRow>
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
