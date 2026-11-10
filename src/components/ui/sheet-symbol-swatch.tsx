import { useMemo } from 'react'
import { PX_PER_PT } from '@/lib/mapSheet/symbolRaster'
import { svgDataUrl, symbolSwatchSvg } from '@/lib/mapSheet/symbolSvg'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import { cn } from '@/lib/utils'

/**
 * A map sheet symbol's legend swatch, drawn by the sheet's own renderer so hatches, dashes and
 * markers match the map and the printed legend. Sizes are points, shown at the map's 96/72 pixels a
 * point unless `scale` says otherwise.
 */
export function SheetSymbolSwatch({
  symbol,
  widthPt = 18,
  heightPt = 9,
  scale = PX_PER_PT,
  background = null,
  className,
}: {
  symbol: SheetSymbol
  widthPt?: number
  heightPt?: number
  /** CSS pixels per point. */
  scale?: number
  /** Swatch background; transparent by default. */
  background?: string | null
  className?: string
}) {
  const src = useMemo(
    () => svgDataUrl(symbolSwatchSvg(symbol, widthPt, heightPt, background)),
    [symbol, widthPt, heightPt, background],
  )
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={Math.round(widthPt * scale)}
      height={Math.round(heightPt * scale)}
      className={cn('shrink-0', className)}
      data-sheet-symbol={symbol.label}
    />
  )
}
