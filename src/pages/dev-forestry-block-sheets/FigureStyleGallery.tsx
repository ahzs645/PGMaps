import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { InlineAlert } from '@/components/ui/map-panels'
import { SheetSymbolSwatch } from '@/components/ui/sheet-symbol-swatch'
import { composeFigure } from '@/lib/forestry/viaFigure/composeFigure'
import { galleryFigureInput } from '@/lib/forestry/viaFigure/galleryFigure'
import { ROLE_NAMES, VIA_STYLE_PRESETS, type ViaRole, type ViaStylePreset } from '@/lib/forestry/viaFigure/presets'
import { encodeSheetImages } from '@/lib/mapSheet/png'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { svgDataUrl } from '@/lib/mapSheet/symbolSvg'
import { enqueueRender, useSeen } from './renderQueue'

/** The preset composed over the synthetic view, as the visual-quality page would export it. */
function FigurePreview({ preset }: { preset: ViaStylePreset }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useSeen(ref)
  const [src, setSrc] = useState<{ url: string; ratio: number } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!seen) return
    let live = true
    enqueueRender(async () => {
      const figure = composeFigure(galleryFigureInput(preset))
      const ops = await encodeSheetImages(figure.ops)
      return { url: svgDataUrl(sheetSvg(ops, figure.width, figure.height)), ratio: figure.width / figure.height }
    }).then(
      (value) => live && setSrc(value),
      (cause: unknown) => live && setError(cause instanceof Error ? cause.message : 'The figure could not be drawn.'),
    )
    return () => {
      live = false
    }
  }, [seen, preset])
  return (
    <div ref={ref} className="min-w-0">
      {error ? (
        <InlineAlert tone="error">{error}</InlineAlert>
      ) : src ? (
        <img
          src={src.url}
          alt={`${preset.name}, composed over a synthetic view`}
          className="w-full rounded border bg-white"
          style={{ aspectRatio: String(src.ratio) }}
          data-testid="figure-style-preview"
        />
      ) : (
        <div className="flex aspect-[17/11] items-center justify-center rounded border bg-muted/40 text-xs text-muted-foreground">
          {seen ? 'Drawing…' : 'Waiting to draw'}
        </div>
      )}
    </div>
  )
}

function PresetLegend({ preset }: { preset: ViaStylePreset }) {
  const roles = Object.keys(preset.symbols) as ViaRole[]
  return (
    <ul className="divide-y rounded border">
      {roles.map((role) => {
        const entry = preset.symbols[role]!
        const label = preset.legend.order.find((o) => o.role === role)?.label ?? entry.symbol.label
        return (
          <li key={role} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 p-2" data-testid="figure-style-symbol">
            <SheetSymbolSwatch
              symbol={entry.symbol}
              widthPt={32}
              heightPt={15}
              scale={2}
              background="#ffffff"
              className="rounded border"
            />
            <div className="min-w-0 space-y-0.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{label}</span>
                <span className="text-3xs text-muted-foreground">{ROLE_NAMES[role]}</span>
                {'source' in entry.data ? (
                  <Badge tone="success" size="xs">
                    Drawn
                  </Badge>
                ) : (
                  <Badge tone="neutral" variant="outline" size="xs">
                    No data yet
                  </Badge>
                )}
              </div>
              <p className="font-mono text-2xs leading-5 text-muted-foreground">{entry.spec}</p>
              <p className="text-2xs leading-5">{'source' in entry.data ? entry.data.source : entry.data.missing}</p>
            </div>
          </li>
        )
      })}
      {preset.ramps?.map((ramp) => (
        <li key={ramp.id} className="space-y-1 p-2 text-xs">
          <p className="font-medium">{ramp.title}</p>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {ramp.classes.map((entry) => (
              <li key={entry.label} className="flex items-center gap-2 text-2xs">
                <span className="h-3 w-5 shrink-0 rounded-sm border" style={{ backgroundColor: entry.color }} />
                {entry.label}
              </li>
            ))}
          </ul>
          <p className="font-mono text-2xs text-muted-foreground">{ramp.spec}</p>
        </li>
      ))}
    </ul>
  )
}

/**
 * Every VIA figure style: its legend drawn from its own symbols beside the source values, and the
 * style composed over a synthetic view through the same composer the visual-quality page exports with.
 */
export function FigureStyleGallery() {
  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Annotation styles measured from BC Visual Impact Assessment figures supplied for review in November 2026, cited
        by document number. The road view of <code>/dev/forestry/visual-quality</code> drapes them over the terrain, and
        its analysis sheet export composes them as shown here. Each preview is a synthetic view, not a real block.
      </p>
      {VIA_STYLE_PRESETS.map((preset) => (
        <section
          key={preset.id}
          aria-labelledby={`figure-style-${preset.id}`}
          className="space-y-3"
          data-testid="figure-style"
          data-preset-id={preset.id}
        >
          <div>
            <h2 id={`figure-style-${preset.id}`} className="text-base font-semibold">
              {preset.name}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                family {preset.family} · {preset.tone}
              </span>
            </h2>
            <p className="text-2xs text-muted-foreground">Sources: {preset.sources.join('; ')}</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <FigurePreview preset={preset} />
            <div className="space-y-2">
              <PresetLegend preset={preset} />
              {preset.gaps.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-2xs text-muted-foreground">
                  {preset.gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      ))}
    </div>
  )
}
