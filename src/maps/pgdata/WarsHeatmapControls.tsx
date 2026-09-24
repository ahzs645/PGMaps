import { AppSelect } from '@/components/ui/select'
import { MapGradientLegendItem } from '@/components/ui/map-panels'
import { HEATMAP_COLOR_RAMPS } from '@/components/ui/map-styles'

export const WARS_HEATMAP_PALETTES = {
  spectrum: { label: 'Blue → red', stops: HEATMAP_COLOR_RAMPS.crime },
  viridis: {
    label: 'Purple → yellow',
    stops: [[0, 'rgba(68,1,84,0)'], [0.15, '#440154'], [0.35, '#3b528b'], [0.55, '#21918c'], [0.75, '#5ec962'], [1, '#fde725']],
  },
  fire: {
    label: 'Yellow → red',
    stops: [[0, 'rgba(255,255,178,0)'], [0.15, '#ffffb2'], [0.35, '#fecc5c'], [0.55, '#fd8d3c'], [0.75, '#f03b20'], [1, '#bd0026']],
  },
} as const

export interface WarsHeatmapSettings {
  scale: 'relative' | 'fixed'
  palette: keyof typeof WARS_HEATMAP_PALETTES
  weighting: 'records' | 'animals'
  intensity: number
  radius: number
  opacity: number
}

export const DEFAULT_WARS_HEATMAP: WarsHeatmapSettings = {
  scale: 'relative', palette: 'spectrum', weighting: 'records', intensity: 35, radius: 20, opacity: 65,
}

export function parseWarsHeatmapSettings(value: string | null): WarsHeatmapSettings {
  const [palette, weighting, intensity, radius, opacity, scale] = (value ?? '').split(',')
  const bounded = (raw: string | undefined, fallback: number, min: number, max: number) => {
    const n = Number(raw)
    return raw?.trim() && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }
  return {
    // Older shared links retain their manual scale; new maps use relative density.
    scale: scale === 'fixed' || (value && !scale) ? 'fixed' : 'relative',
    palette: palette === 'viridis' || palette === 'fire' ? palette : 'spectrum',
    weighting: weighting === 'animals' ? 'animals' : 'records',
    intensity: bounded(intensity, DEFAULT_WARS_HEATMAP.intensity, 1, 200),
    radius: bounded(radius, DEFAULT_WARS_HEATMAP.radius, 5, 60),
    opacity: bounded(opacity, DEFAULT_WARS_HEATMAP.opacity, 0, 100),
  }
}

export function serializeWarsHeatmapSettings(settings: WarsHeatmapSettings): string {
  return [settings.palette, settings.weighting, settings.intensity, settings.radius, settings.opacity, settings.scale].join(',')
}

export function WarsHeatmapGradient({ palette }: { palette: WarsHeatmapSettings['palette'] }) {
  const stops = WARS_HEATMAP_PALETTES[palette].stops
  return <MapGradientLegendItem colors={stops.map(([density, color]) => `${color} ${density * 100}%`)} minLabel="Lower density" maxLabel="Higher density" />
}

export function WarsHeatmapControls({ settings, onChange }: {
  settings: WarsHeatmapSettings
  onChange: (settings: WarsHeatmapSettings) => void
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">Heatmap options</span>
        <button type="button" className="text-[11px] text-sky-600 hover:underline dark:text-sky-400" onClick={() => onChange({ ...DEFAULT_WARS_HEATMAP })}>
          Reset heatmap
        </button>
      </div>
      <label className="block text-xs font-medium">
        Density scale
        <AppSelect
          value={settings.scale}
          onValueChange={(scale) => onChange({ ...settings, scale: scale === 'fixed' ? 'fixed' : 'relative' })}
          options={[{ value: 'relative', label: 'Relative to current view' }, { value: 'fixed', label: 'Fixed scale (manual)' }]}
          triggerAriaLabel="Heatmap density scale"
          className="mt-1" triggerClassName="h-8 text-xs"
        />
      </label>
      {settings.scale === 'fixed' && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Colors keep the same scale when panning or filtering at the same zoom. Lower intensity if the map becomes too red.
        </p>
      )}
      <label className="block text-xs font-medium">
        Color palette
        <AppSelect
          value={settings.palette}
          onValueChange={(palette) => onChange({ ...settings, palette: palette as WarsHeatmapSettings['palette'] })}
          options={Object.entries(WARS_HEATMAP_PALETTES).map(([value, { label }]) => ({ value, label }))}
          triggerAriaLabel="Heatmap color palette"
          className="mt-1" triggerClassName="h-8 text-xs"
        />
      </label>
      <WarsHeatmapGradient palette={settings.palette} />
      <label className="block text-xs font-medium">
        Count by
        <AppSelect
          value={settings.weighting}
          onValueChange={(weighting) => onChange({ ...settings, weighting: weighting as WarsHeatmapSettings['weighting'] })}
          options={[{ value: 'records', label: 'Accident records' }, { value: 'animals', label: 'Animals involved' }]}
          triggerAriaLabel="Heatmap count by"
          className="mt-1" triggerClassName="h-8 text-xs"
        />
      </label>
      {([
        { key: 'intensity', label: 'Intensity', min: 1, max: 200, unit: '%' },
        { key: 'radius', label: 'Radius', min: 5, max: 60, unit: ' px' },
        { key: 'opacity', label: 'Opacity', min: 0, max: 100, unit: '%' },
      ] as const).map(({ key, label, min, max, unit }) => (
        <label key={key} className="block text-xs">
          <span className="flex justify-between"><span>{label}</span><span className="tabular-nums text-muted-foreground">{settings[key]}{unit}</span></span>
          <input
            type="range" aria-label={`Heatmap ${label.toLowerCase()}`} min={min} max={max} step={1}
            value={settings[key]} onChange={(event) => onChange({ ...settings, [key]: Number(event.target.value) })}
            className="mt-1 h-5 w-full cursor-pointer accent-primary"
          />
        </label>
      ))}
    </div>
  )
}
