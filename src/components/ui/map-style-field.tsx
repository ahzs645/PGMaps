import { useMemo } from 'react'

import { StyledSelect, type StyledSelectOption } from '@/components/ui/styled-select'
import { insetBox } from '@/components/ui/inset-box'
import { SheetSymbolSwatch } from '@/components/ui/sheet-symbol-swatch'
import {
  STYLE_SAMPLE_SIZE,
  styleSampleKey,
  styleSampleSvg,
  type MapStyleChoice,
  type StyleSampleSymbols,
} from '@/lib/mapSheet/styleSample'
import { PX_PER_PT } from '@/lib/mapSheet/symbolRaster'
import { svgDataUrl } from '@/lib/mapSheet/symbolSvg'
import { cn } from '@/lib/utils'

export type { MapStyleChoice }

const ASPECT = STYLE_SAMPLE_SIZE.width / STYLE_SAMPLE_SIZE.height

/**
 * A style's sample map: the same small hillside for every style, drawn with that style's symbols by the sheet's own
 * renderer (`styleSampleSvg`). An SVG data URL in an `<img>`: no map and no capture, so a list of them costs nothing.
 */
export function MapStyleSample({
  symbols,
  width,
  weight = 1,
  className,
}: {
  symbols: StyleSampleSymbols
  /** CSS pixels across; the height follows the sample's shape. */
  width: number
  /** Line weight against the printed map's (1: as a legend swatch draws it). A small sample reads better lighter. */
  weight?: number
  className?: string
}) {
  const src = useMemo(() => svgDataUrl(styleSampleSvg(symbols, width / (PX_PER_PT * weight))), [symbols, width, weight])
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={width}
      height={Math.round(width / ASPECT)}
      // Paper white in every theme: it is a picture of a printed map.
      className={cn('shrink-0 rounded-sm border border-border bg-white', className)}
      data-map-style-sample=""
    />
  )
}

/**
 * A map style dropdown that shows what each style looks like: every option carries its sample map, so the styles are
 * compared in the open list without choosing one, and the chosen style's sample sits under the field beside a key of
 * the symbols it draws. Choices without a `sample` list as plain names. Use it wherever a reader picks how a printed
 * map draws its features (`docs/shared-ui.md`, **Map style previews**).
 */
export function MapStyleField({
  label = 'Map style',
  styles,
  value,
  onChange,
  hint,
  selectClassName,
  className,
}: {
  label?: string
  styles: readonly MapStyleChoice[]
  value: string
  onChange: (value: string) => void
  /** One line under the sample: what the chosen style changes. */
  hint?: string
  /** The dropdown's classes, as `StyledSelect` takes them; the shared form input's look when left out. */
  selectClassName?: string
  className?: string
}) {
  const options = useMemo<StyledSelectOption[]>(
    () =>
      styles.map((style) => ({
        value: style.value,
        label: style.sample ? (
          <span className="flex min-w-0 items-center gap-2">
            <MapStyleSample symbols={style.sample} width={72} weight={0.7} />
            <span className="min-w-0 whitespace-normal">{style.label}</span>
          </span>
        ) : (
          style.label
        ),
        // The closed field shows the name alone; the sample under it is the chosen style's.
        selectedLabel: style.label,
        searchText: style.label,
      })),
    [styles],
  )
  const chosen = styles.find((style) => style.value === value) ?? styles[0]
  const key = chosen?.sample ? styleSampleKey(chosen.sample) : []
  return (
    <div className={cn('grid min-w-0 gap-1 text-xs', className)} data-map-style-field="">
      <span className="text-muted-foreground">{label}</span>
      <StyledSelect
        aria-label={label}
        className={selectClassName}
        value={chosen?.value ?? ''}
        onValueChange={onChange}
        options={options}
        searchable={false}
      />
      {chosen?.sample && (
        <div
          className={cn(insetBox({ padding: 'sm' }), 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2')}
          data-map-style-preview={chosen.value}
        >
          <MapStyleSample symbols={chosen.sample} width={176} />
          <ul className="grid min-w-0 flex-1 basis-40 gap-1" aria-label={`${chosen.label}: symbols`}>
            {key.map(({ role, symbol }) => (
              <li key={role} className="flex min-w-0 items-center gap-1.5 text-2xs">
                <SheetSymbolSwatch symbol={symbol} background="#ffffff" />
                <span className="min-w-0 truncate text-foreground">{symbol.label}</span>
              </li>
            ))}
            <li className="text-2xs text-muted-foreground">A sample map, not this site.</li>
          </ul>
        </div>
      )}
      {hint && <span className="text-muted-foreground">{hint}</span>}
    </div>
  )
}
