import { useEffect, useMemo, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { SheetSymbolSwatch } from '@/components/ui/sheet-symbol-swatch'
import { gallerySymbolGroups } from '@/lib/forestry/blockSheet/gallerySheets'
import { UNSPECIFIED_FEATURES, type CatalogueEntry } from '@/lib/forestry/blockSheet/symbolCatalogue'
import { areaPatternTile } from '@/lib/mapSheet/symbolRaster'
import { svgDataUrl, symbolSampleSvg } from '@/lib/mapSheet/symbolSvg'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'

/** `symbol` on a sample shape at `zoom` times print size, as an image `width` × `height` CSS pixels. */
export function SymbolSample({
  symbol,
  width = 132,
  height = 66,
  zoom = 2,
  background = '#ffffff',
}: {
  symbol: SheetSymbol
  width?: number
  height?: number
  zoom?: number
  background?: string
}) {
  const src = useMemo(
    () => svgDataUrl(symbolSampleSvg(symbol, width, height, zoom, background)),
    [symbol, width, height, zoom, background],
  )
  return (
    <img
      src={src}
      alt={`${symbol.label}, drawn by PGMaps`}
      width={width}
      height={height}
      className="shrink-0 rounded border"
      data-testid="symbol-sample"
    />
  )
}

/** The MapLibre pattern tile of a hatched or marker-filled area, repeated as the map repeats it. */
function PatternTilePreview({ symbol }: { symbol: SheetSymbol }) {
  const ref = useRef<HTMLDivElement>(null)
  const tile = useMemo(() => {
    if (symbol.kind !== 'area') return null
    const ratio = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)))
    return areaPatternTile(symbol, ratio)
  }, [symbol])
  useEffect(() => {
    const element = ref.current
    if (!element || !tile) return
    const canvas = document.createElement('canvas')
    canvas.width = tile.width
    canvas.height = tile.height
    canvas
      .getContext('2d')
      ?.putImageData(new ImageData(new Uint8ClampedArray(tile.data), tile.width, tile.height), 0, 0)
    element.style.backgroundImage = `url(${canvas.toDataURL('image/png')})`
    element.style.backgroundSize = `${tile.width / tile.pixelRatio}px ${tile.height / tile.pixelRatio}px`
  }, [tile])
  if (!tile) return null
  return (
    <div className="grid gap-0.5">
      <div
        ref={ref}
        className="h-12 w-20 rounded border bg-white bg-repeat"
        role="img"
        aria-label={`${symbol.label}: map pattern tile`}
        data-testid="symbol-map-tile"
      />
      <span className="text-3xs text-muted-foreground">
        Map tile{' '}
        {tile.hatches.map((h) => `${Math.round(h.angleDeg * 10) / 10}° / ${h.spacing.toFixed(2)} pt`).join(', ')}
      </span>
    </div>
  )
}

function SymbolRow({ entry }: { entry: CatalogueEntry }) {
  return (
    <li
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-b py-3 last:border-b-0 sm:grid-cols-[auto_11rem_minmax(0,1fr)]"
      data-testid="symbol-row"
      data-symbol-id={entry.id}
    >
      <SymbolSample symbol={entry.symbol} background={entry.background} />
      <div className="hidden flex-col items-start gap-2 sm:flex">
        <div className="grid gap-0.5">
          <SheetSymbolSwatch
            symbol={entry.symbol}
            scale={2.5}
            background={entry.background ?? '#ffffff'}
            className="rounded border"
          />
          <span className="text-3xs text-muted-foreground">Legend swatch</span>
        </div>
        <PatternTilePreview symbol={entry.symbol} />
      </div>
      <div className="col-span-2 min-w-0 space-y-1 text-xs sm:col-span-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{entry.symbol.label}</span>
          <code className="text-3xs text-muted-foreground">{entry.id}</code>
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
        <p className="font-mono text-2xs leading-5 text-muted-foreground" data-testid="symbol-spec">
          {entry.spec}
        </p>
        <p className="text-2xs leading-5">{'source' in entry.data ? entry.data.source : entry.data.missing}</p>
      </div>
    </li>
  )
}

/** Every catalogue symbol, grouped as the source catalogue groups them, beside its source values. */
export function SymbolSheet() {
  const groups = useMemo(() => gallerySymbolGroups(), [])
  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Each symbol drawn by PGMaps on a sample shape at twice print size, its legend swatch, and for patterned areas
        the tile the live map repeats, beside the values read from the reference sheets (ArcGIS Pro block-map sheets
        supplied by a BC licensee, November 2026). Widths are points. Point icons are PGMaps' own drawings.
      </p>
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`symbol-group-${group.id}`} data-testid="symbol-group">
          <h2 id={`symbol-group-${group.id}`} className="text-base font-semibold">
            {group.title} <span className="text-xs font-normal text-muted-foreground">({group.entries.length})</span>
          </h2>
          <ul className="mt-2 rounded-lg border bg-card px-3">
            {group.entries.map((entry) => (
              <SymbolRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      ))}
      <section aria-labelledby="symbol-group-unspecified">
        <h2 id="symbol-group-unspecified" className="text-base font-semibold">
          Listed without a symbol
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The reference legends named these with no colour or glyph to read, so PGMaps has no symbol for them yet:{' '}
          {UNSPECIFIED_FEATURES.join(', ')}.
        </p>
      </section>
    </div>
  )
}
