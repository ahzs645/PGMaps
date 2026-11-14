import { useMemo, type ReactNode } from 'react'
import { ColorField } from '@/components/ui/color-field'
import { NumberField } from '@/components/ui/form-field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SheetSymbolSwatch } from '@/components/ui/sheet-symbol-swatch'
import { TextButton } from '@/components/ui/text-button'
import {
  AREA_PATTERNS,
  AREA_PATTERN_LABELS,
  LINE_DASHES,
  LINE_DASH_LABELS,
  SYMBOL_WIDTH_LIMITS,
  styledAreaSymbol,
  styledLineSymbol,
  symbolStyleIsEmpty,
  withSymbolStyle,
  type AreaPattern,
  type LineDash,
  type SymbolStyle,
  type SymbolStyleDefaults,
} from '@/lib/mapSheet/symbolStyle'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import { cn } from '@/lib/utils'

export type SymbolShape = 'point' | 'line' | 'area'

/** The symbol a style draws for a shape, the one the map and its legend draw too. */
export function styledSymbol(shape: SymbolShape, defaults: SymbolStyleDefaults, style?: SymbolStyle): SheetSymbol {
  if (shape === 'area') return styledAreaSymbol(defaults, style)
  if (shape === 'line') return styledLineSymbol(defaults, style)
  return {
    kind: 'point',
    label: defaults.label,
    icon: 'dot',
    size: 9,
    color: style?.color ?? defaults.color,
    halo: { color: '#0f172a', width: 1.5 },
  }
}

/**
 * A choice among drawn options: each one is a button holding a swatch drawn by the sheet's own
 * renderer, so a hatch reads as a hatch and a dash as a dash rather than as a name in a list.
 */
function SwatchChoice<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
  symbolFor,
  disabled,
  widthPt,
  heightPt,
  className,
}: {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  value: T
  onChange: (value: T) => void
  symbolFor: (option: T) => SheetSymbol
  disabled?: boolean
  widthPt: number
  heightPt: number
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-1', className)}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          aria-label={labels[option]}
          title={labels[option]}
          disabled={disabled}
          data-swatch-choice={option}
          className={cn(
            'rounded-sm border border-border bg-background p-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            value === option && 'border-primary ring-1 ring-primary',
          )}
          onClick={() => onChange(option)}
        >
          <SheetSymbolSwatch symbol={symbolFor(option)} widthPt={widthPt} heightPt={heightPt} />
        </button>
      ))}
    </div>
  )
}

/**
 * Pick an area pattern from swatches drawn in the layer's own colour. `symbolFor` returns the
 * symbol the map would draw for a pattern, so the picker cannot show a hatch the map does not.
 */
export function PatternField({
  label,
  value,
  onChange,
  symbolFor,
  patterns = AREA_PATTERNS,
  disabled,
  className,
}: {
  /** Accessible name of the group, e.g. "Buffer pattern". */
  label: string
  value: AreaPattern
  onChange: (pattern: AreaPattern) => void
  symbolFor: (pattern: AreaPattern) => SheetSymbol
  patterns?: readonly AreaPattern[]
  disabled?: boolean
  className?: string
}) {
  return (
    <SwatchChoice
      label={label}
      options={patterns}
      labels={AREA_PATTERN_LABELS}
      value={value}
      onChange={onChange}
      symbolFor={symbolFor}
      disabled={disabled}
      widthPt={20}
      heightPt={13}
      className={className}
    />
  )
}

/** Pick a line style (solid, dashed, dotted…) from lines drawn in the layer's own colour and width. */
export function LineDashField({
  label,
  value,
  onChange,
  symbolFor,
  dashes = LINE_DASHES,
  disabled,
  className,
}: {
  /** Accessible name of the group, e.g. "Line style". */
  label: string
  value: LineDash
  onChange: (dash: LineDash) => void
  symbolFor: (dash: LineDash) => SheetSymbol
  dashes?: readonly LineDash[]
  disabled?: boolean
  className?: string
}) {
  return (
    <SwatchChoice
      label={label}
      options={dashes}
      labels={LINE_DASH_LABELS}
      value={value}
      onChange={onChange}
      symbolFor={symbolFor}
      disabled={disabled}
      widthPt={30}
      heightPt={9}
      className={className}
    />
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </div>
  )
}

export interface SymbolStyleEditorProps {
  /** What the layer holds: a point takes a colour; a line adds style and width; an area adds a pattern and opacity. */
  shape: SymbolShape
  /** The layer's look until the person changes it. */
  defaults: SymbolStyleDefaults
  /** Only what the person set. */
  value: SymbolStyle | undefined
  /** The style with one value changed, or `{}` once everything is back to the default. */
  onChange: (style: SymbolStyle) => void
  /** Names the controls, e.g. "Look of Property lines". */
  label: string
  /** Colours offered first in the colour picker. */
  colorPresets?: readonly string[]
  disabled?: boolean
  className?: string
}

/**
 * The controls for a layer's look, laid out for a sidebar or a popover: colour (with opacity for
 * an area), pattern, line style and width. Each value is optional over `defaults`, so *Reset look*
 * returns the layer to how it arrived. Every swatch is the symbol the map draws.
 */
export function SymbolStyleEditor({
  shape,
  defaults,
  value,
  onChange,
  label,
  colorPresets,
  disabled,
  className,
}: SymbolStyleEditorProps) {
  const set = <K extends keyof SymbolStyle>(key: K, next: SymbolStyle[K]) => onChange(withSymbolStyle(value, key, next))
  const width = value?.width ?? defaults.width
  return (
    <div className={cn('grid gap-2.5', className)} data-symbol-style-editor={shape}>
      <Row label="Colour">
        <ColorField
          label={`${label}: colour`}
          value={value?.color ?? defaults.color}
          resettable={value?.color !== undefined}
          resetLabel={`${label}: back to the default colour`}
          onChange={(color) => set('color', color ?? undefined)}
          presets={colorPresets}
          presetDisplay="picker"
          disabled={disabled}
          {...(shape === 'area'
            ? {
                opacity: value?.opacity ?? defaults.opacity,
                onOpacityChange: (opacity: number) => set('opacity', opacity),
              }
            : {})}
        />
      </Row>
      {shape === 'area' && (
        <Row label="Pattern">
          <PatternField
            label={`${label}: pattern`}
            value={value?.pattern ?? defaults.pattern}
            onChange={(pattern) => set('pattern', pattern === defaults.pattern ? undefined : pattern)}
            symbolFor={(pattern) => styledAreaSymbol(defaults, { ...value, pattern })}
            disabled={disabled}
          />
        </Row>
      )}
      {shape !== 'point' && (
        <>
          <Row label={shape === 'area' ? 'Outline' : 'Line'}>
            <LineDashField
              label={`${label}: line style`}
              value={value?.dash ?? defaults.dash}
              onChange={(dash) => set('dash', dash === defaults.dash ? undefined : dash)}
              symbolFor={(dash) => styledLineSymbol({ ...defaults, casing: undefined }, { ...value, dash })}
              disabled={disabled}
            />
          </Row>
          <NumberField
            label="Width"
            unit="pt"
            value={Math.round(width * 100) / 100}
            min={SYMBOL_WIDTH_LIMITS.min}
            max={SYMBOL_WIDTH_LIMITS.max}
            step={SYMBOL_WIDTH_LIMITS.step}
            updateOn="commit"
            disabled={disabled}
            onValueChange={(next) => set('width', next === defaults.width ? undefined : next)}
            fieldClassName="w-28"
          />
        </>
      )}
      {!symbolStyleIsEmpty(value) && (
        <TextButton
          tone="muted"
          className="justify-self-start text-xs"
          disabled={disabled}
          onClick={() => onChange({})}
        >
          Reset look
        </TextButton>
      )}
    </div>
  )
}

/**
 * A layer's look in a list row: the button is the layer's own symbol (a dashed line reads as a
 * dashed line, a hatch as a hatch) and opens `SymbolStyleEditor` in a popover.
 */
export function SymbolField({
  shape,
  defaults,
  value,
  onChange,
  label,
  colorPresets,
  disabled,
  className,
}: SymbolStyleEditorProps) {
  const symbol = useMemo(() => styledSymbol(shape, defaults, value), [shape, defaults, value])
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={disabled}
          data-symbol-field={shape}
          data-styled={!symbolStyleIsEmpty(value) || undefined}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-sm border border-border bg-background p-0.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <SheetSymbolSwatch symbol={symbol} widthPt={20} heightPt={10} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-3" align="end" aria-label={label}>
        <SymbolStyleEditor
          shape={shape}
          defaults={defaults}
          value={value}
          onChange={onChange}
          label={label}
          colorPresets={colorPresets}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}
