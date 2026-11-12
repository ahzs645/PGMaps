import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { findPreset, LIVE_ROLES, type ViaRole } from '@/lib/forestry/viaFigure/presets'
import { areaSymbolPaint } from '@/lib/mapSheet/mapSymbols'

type Collection = GeoJSON.FeatureCollection

/** The scene's data for each role a figure style can drape. */
export type FigureStyleData = Partial<Record<ViaRole, Collection>>

/**
 * Road-view strokes are drawn this much wider than print: a stroke draped at a grazing angle reads
 * thinner than the same stroke printed flat over a photograph.
 */
export const LIVE_STROKE_SCALE = 1.6
/** Thinnest live stroke, CSS pixels. */
const MIN_LIVE_STROKE_PX = 1.5

/**
 * A VIA figure style draped on the road view: each role the preset defines and the scene has data
 * for, painted from the preset's own symbols through `areaSymbolPaint`, so the live view and the
 * exported figure cannot drift apart. Draped layers sit in the terrain texture, so nearer terrain
 * hides them exactly as it hides the blocks. Display only: nothing here reaches the run.
 *
 * Hatches and marker fills need a `fill-pattern`, which the toolkit's fill layer does not take yet,
 * so a hatched area is drawn here by its outline and its fill colour; the exported figure hatches it.
 */
export function FigureStyleLayers({ styleId, data }: { styleId: string | null; data: FigureStyleData }) {
  const preset = findPreset(styleId)
  if (!preset) return null
  return (
    <>
      {LIVE_ROLES.flatMap((role) => {
        const entry = preset.symbols[role]
        const collection = data[role]
        if (!entry || entry.symbol.kind !== 'area' || !collection?.features.length) return []
        const paint = areaSymbolPaint(entry.symbol)
        const fill = entry.symbol.fill
        return [
          fill ? (
            <MapFillLayer
              key={`${role}-fill`}
              data={collection}
              interactive={false}
              fillColor={fill}
              fillOpacity={entry.symbol.fillOpacity ?? 1}
              lineWidth={0}
            />
          ) : null,
          ...paint.outline.map((outline, i) => {
            const width = Math.max(MIN_LIVE_STROKE_PX, (outline['line-width'] as number) * LIVE_STROKE_SCALE)
            const stroke = entry.symbol.kind === 'area' ? entry.symbol.outline[i] : null
            return (
              <MapLineLayer
                key={`${role}-outline-${i}`}
                data={collection}
                interactive={false}
                color={outline['line-color'] as string}
                width={width}
                opacity={(outline['line-opacity'] as number | undefined) ?? 1}
                dashArray={outline['line-dasharray'] as number[] | undefined}
                lineCap={stroke?.cap ?? 'round'}
                lineJoin={stroke?.join ?? 'round'}
              />
            )
          }),
        ]
      })}
    </>
  )
}
