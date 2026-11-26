import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ColorField } from '@/components/ui/color-field'
import { CheckboxField, FORM_INPUT_CLASS, NumberField } from '@/components/ui/form-field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SheetSymbolSwatch } from '@/components/ui/sheet-symbol-swatch'
import { TextButton } from '@/components/ui/text-button'
import { ICONS } from '@/lib/mapSheet/icons'
import { symbolStyleFromQml } from '@/lib/mapSheet/qmlStyle'
import {
  AREA_PATTERNS,
  AREA_PATTERN_LABELS,
  LINE_DASH_LABELS,
  LINE_DASH_PRESETS,
  LINE_DASH_UNITS,
  LINE_MARKERS,
  LINE_MARKER_LABELS,
  ORGANIC_HATCH_SETTINGS,
  ORGANIC_HATCH_SETTING_LABELS,
  ORGANIC_HATCH_SHEET,
  POINT_ICONS,
  SYMBOL_GROUND_WIDTH_LIMITS,
  SYMBOL_SIZE_LIMITS,
  SYMBOL_WIDTH_LIMITS,
  copiedSymbolStyle,
  copySymbolStyle,
  onCopiedSymbolStyle,
  parseDashPattern,
  styledAreaSymbol,
  styledLineSymbol,
  styledPointSymbol,
  symbolStyleForShape,
  symbolStyleIsEmpty,
  withSymbolStyle,
  type AreaPattern,
  type LineDash,
  type LineMarkerKind,
  type PointIcon,
  type SymbolStyle,
  type SymbolStyleDefaults,
} from '@/lib/mapSheet/symbolStyle'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import { cn } from '@/lib/utils'
import { ORGANIC_HATCH_LIMITS } from '@pgmaps/geo-toolkit/patterns'

export type SymbolShape = 'point' | 'line' | 'area'

const POINT_ICON_LABELS = Object.fromEntries(
  POINT_ICONS.map((icon) => [icon, icon === 'dot' ? 'Ringed dot' : ICONS[icon].label]),
) as Record<PointIcon, string>
const MARKER_OPTIONS = ['none', ...LINE_MARKERS] as const
const MARKER_OPTION_LABELS: Record<'none' | LineMarkerKind, string> = { none: 'No marks', ...LINE_MARKER_LABELS }
const WIDTH_UNITS = [
  { value: 'screen', label: 'pt' },
  { value: 'ground', label: 'm' },
] as const
/** The ground width a line starts at when switched to metres: a single-lane road's running surface. */
const DEFAULT_GROUND_WIDTH_M = 5

/** The symbol a style draws for a shape, the one the map and its legend draw too. */
export function styledSymbol(shape: SymbolShape, defaults: SymbolStyleDefaults, style?: SymbolStyle): SheetSymbol {
  if (shape === 'area') return styledAreaSymbol(defaults, style)
  if (shape === 'line') return styledLineSymbol(defaults, style)
  return styledPointSymbol(defaults, style)
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
  dashes = LINE_DASH_PRESETS,
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

const useCopiedLook = () => useSyncExternalStore(onCopiedSymbolStyle, copiedSymbolStyle, () => null)

/** A custom dash typed as lengths. A dash a line cannot draw stays in the box, flagged, until it is fixed. */
function DashPatternInput({
  label,
  value,
  onCommit,
  disabled,
}: {
  label: string
  value: readonly number[]
  onCommit: (pattern: number[]) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const invalid = draft !== null && parseDashPattern(draft) === null
  const commit = () => {
    const parsed = draft === null ? null : parseDashPattern(draft)
    if (!parsed) return
    setDraft(null)
    onCommit(parsed)
  }
  return (
    <label className="grid gap-1 text-2xs text-muted-foreground">
      Dash and gap lengths, in line widths
      <input
        type="text"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={draft ?? value.join(' ')}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        className={cn(FORM_INPUT_CLASS, 'font-mono text-xs', invalid && 'border-danger')}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape' && draft !== null) {
            event.stopPropagation()
            setDraft(null)
          }
        }}
      />
    </label>
  )
}

export interface SymbolStyleEditorProps {
  /** What the layer holds: a point takes a colour, shape and size; a line a style, width and marks; an area a pattern and opacity too. */
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
  /** Offer a width in metres on the ground, for a host whose map draws lines to scale. */
  groundWidth?: boolean
  disabled?: boolean
  className?: string
}

const NO_MARKER = 'none'

/** Steps and units of the organic hatch settings; lengths are points on the printed sheet. */
const ORGANIC_FIELDS: Record<(typeof ORGANIC_HATCH_SETTINGS)[number], { step: number; unit?: string }> = {
  seed: { step: 1 },
  spacing: { step: 0.25, unit: 'pt' },
  bandHeight: { step: 0.5, unit: 'pt' },
  strokeWidth: { step: 0.05, unit: 'pt' },
  curvature: { step: 1 },
}

/**
 * The controls for a layer's look, laid out for a sidebar or a popover. A point takes a colour,
 * a shape and a size; a line a colour, a style (or a typed dash), a width and marks along it; an
 * area adds a pattern in its own colour, a fill opacity and outline-only. Each value is optional
 * over `defaults`, so *Reset look* returns the layer to how it arrived. A look can be copied to
 * another layer, or read from a QGIS style file. Every swatch is the symbol the map draws.
 */
export function SymbolStyleEditor({
  shape,
  defaults,
  value,
  onChange,
  label,
  colorPresets,
  groundWidth = false,
  disabled,
  className,
}: SymbolStyleEditorProps) {
  const copied = useCopiedLook()
  const [notes, setNotes] = useState<{ title: string; lines: string[] } | null>(null)
  const set = <K extends keyof SymbolStyle>(key: K, next: SymbolStyle[K]) => onChange(withSymbolStyle(value, key, next))
  const width = value?.width ?? defaults.width
  const dash = value?.dash ?? defaults.dash
  const pattern = value?.pattern ?? defaults.pattern
  const color = value?.color ?? defaults.color
  const onGround = groundWidth && value?.widthM !== undefined

  const loadQml = () => {
    // The picker is not kept in the page: a popover may close under the file dialog.
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.qml,text/xml,application/xml'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return
      void file.text().then((text) => {
        try {
          const look = symbolStyleFromQml(text)
          const style = symbolStyleForShape(groundWidth ? look.style : { ...look.style, widthM: undefined }, shape)
          const mismatch =
            look.shape === shape ? [] : [`The file styles ${look.shape}s; what applies to this layer was used.`]
          onChange(style)
          setNotes({ title: `Read ${file.name}`, lines: [...mismatch, ...look.notes] })
        } catch (error) {
          setNotes({
            title: `${file.name} was not read`,
            lines: [error instanceof Error ? error.message : String(error)],
          })
        }
      })
    })
    input.click()
  }

  return (
    <div className={cn('grid gap-2.5', className)} data-symbol-style-editor={shape}>
      <Row label="Colour">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ColorField
            label={`${label}: colour`}
            value={color}
            resettable={value?.color !== undefined}
            resetLabel={`${label}: back to the default colour`}
            onChange={(next) => set('color', next ?? undefined)}
            presets={colorPresets}
            presetDisplay="picker"
            disabled={disabled}
            {...(shape === 'area' && !value?.noFill
              ? {
                  opacity: value?.opacity ?? defaults.opacity,
                  onOpacityChange: (opacity: number) => set('opacity', opacity),
                }
              : {})}
          />
          {shape === 'area' && (
            <CheckboxField
              label="Outline only"
              checked={value?.noFill === true}
              disabled={disabled}
              onCheckedChange={(checked) => set('noFill', checked ? true : undefined)}
              labelClassName="text-xs"
            />
          )}
        </div>
      </Row>
      {shape === 'point' && (
        <>
          <Row label="Shape">
            <SwatchChoice
              label={`${label}: shape`}
              options={POINT_ICONS}
              labels={POINT_ICON_LABELS}
              value={value?.icon ?? 'dot'}
              onChange={(icon) => set('icon', icon === 'dot' ? undefined : icon)}
              symbolFor={(icon) => styledPointSymbol(defaults, { ...value, icon, size: 9 })}
              disabled={disabled}
              widthPt={11}
              heightPt={11}
            />
          </Row>
          <NumberField
            label="Size"
            unit="pt"
            value={value?.size ?? 9}
            min={SYMBOL_SIZE_LIMITS.min}
            max={SYMBOL_SIZE_LIMITS.max}
            step={SYMBOL_SIZE_LIMITS.step}
            updateOn="commit"
            disabled={disabled}
            onValueChange={(next) => set('size', next === 9 ? undefined : next)}
            fieldClassName="w-28"
          />
        </>
      )}
      {shape === 'area' && (
        <Row label="Pattern">
          <PatternField
            label={`${label}: pattern`}
            value={pattern}
            onChange={(next) => set('pattern', next === defaults.pattern ? undefined : next)}
            symbolFor={(next) => styledAreaSymbol(defaults, { ...value, pattern: next })}
            disabled={disabled}
          />
          {pattern !== 'solid' && (
            <span className="flex items-center gap-2 text-2xs text-muted-foreground">
              <ColorField
                size="sm"
                label={`${label}: pattern colour`}
                value={value?.patternColor ?? color}
                resettable={value?.patternColor !== undefined}
                resetLabel={`${label}: pattern in the layer's colour`}
                onChange={(next) => set('patternColor', next ?? undefined)}
                presets={colorPresets}
                presetDisplay="picker"
                disabled={disabled}
              />
              Pattern colour
            </span>
          )}
          {pattern === 'organic' && (
            <div className="grid grid-cols-2 gap-x-2 gap-y-1" data-organic-hatch-settings="">
              {ORGANIC_HATCH_SETTINGS.map((key) => (
                <NumberField
                  key={key}
                  label={ORGANIC_HATCH_SETTING_LABELS[key]}
                  unit={ORGANIC_FIELDS[key].unit}
                  value={value?.organic?.[key] ?? ORGANIC_HATCH_SHEET[key]}
                  min={ORGANIC_HATCH_LIMITS[key].min}
                  max={ORGANIC_HATCH_LIMITS[key].max}
                  step={ORGANIC_FIELDS[key].step}
                  updateOn="commit"
                  disabled={disabled}
                  onValueChange={(next) => {
                    const organic = { ...value?.organic, [key]: next === ORGANIC_HATCH_SHEET[key] ? undefined : next }
                    for (const name of ORGANIC_HATCH_SETTINGS) if (organic[name] === undefined) delete organic[name]
                    set('organic', Object.keys(organic).length ? organic : undefined)
                  }}
                  fieldClassName="w-full"
                />
              ))}
            </div>
          )}
        </Row>
      )}
      {shape !== 'point' && (
        <>
          <Row label={shape === 'area' ? 'Outline' : 'Line'}>
            <div className="flex flex-wrap items-center gap-1">
              <LineDashField
                label={`${label}: line style`}
                value={dash}
                onChange={(next) => set('dash', next === defaults.dash ? undefined : next)}
                symbolFor={(next) =>
                  styledLineSymbol({ ...defaults, casing: undefined }, { ...value, marker: undefined, dash: next })
                }
                disabled={disabled}
              />
              <button
                type="button"
                role="radio"
                aria-checked={dash === 'custom'}
                aria-label={`${label}: custom dash`}
                title="A dash of your own"
                disabled={disabled}
                className={cn(
                  'h-[21px] rounded-sm border border-border bg-background px-1.5 text-2xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                  dash === 'custom' && 'border-primary ring-1 ring-primary',
                )}
                onClick={() =>
                  onChange({
                    ...value,
                    dash: 'custom',
                    dashPattern: value?.dashPattern ?? [...(LINE_DASH_UNITS[dash] ?? [4, 2])],
                  })
                }
              >
                Custom
              </button>
            </div>
            {dash === 'custom' && (
              <DashPatternInput
                label={`${label}: dash lengths`}
                value={value?.dashPattern ?? []}
                onCommit={(dashPattern) => onChange({ ...value, dash: 'custom', dashPattern })}
                disabled={disabled}
              />
            )}
          </Row>
          <div className="flex items-end gap-2">
            {onGround ? (
              <NumberField
                label="Width"
                unit="m"
                value={value.widthM!}
                min={SYMBOL_GROUND_WIDTH_LIMITS.min}
                max={SYMBOL_GROUND_WIDTH_LIMITS.max}
                step={SYMBOL_GROUND_WIDTH_LIMITS.step}
                updateOn="commit"
                disabled={disabled}
                onValueChange={(next) => set('widthM', next)}
                fieldClassName="w-28"
              />
            ) : (
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
            )}
            {groundWidth && (
              <SegmentedControl
                label={`${label}: width unit`}
                size="sm"
                fullWidth={false}
                value={onGround ? 'ground' : 'screen'}
                options={WIDTH_UNITS}
                onChange={(unit) => set('widthM', unit === 'ground' ? DEFAULT_GROUND_WIDTH_M : undefined)}
              />
            )}
          </div>
          {shape === 'line' && (
            <Row label="Along the line">
              <SwatchChoice
                label={`${label}: marks along the line`}
                options={MARKER_OPTIONS}
                labels={MARKER_OPTION_LABELS}
                value={value?.marker ?? NO_MARKER}
                onChange={(marker) => set('marker', marker === NO_MARKER ? undefined : marker)}
                symbolFor={(marker) =>
                  styledLineSymbol(
                    { ...defaults, casing: undefined },
                    { ...value, dash: 'solid', marker: marker === NO_MARKER ? undefined : marker },
                  )
                }
                disabled={disabled}
                widthPt={34}
                heightPt={9}
              />
            </Row>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-xs">
        <TextButton
          tone="muted"
          disabled={disabled || symbolStyleIsEmpty(value)}
          onClick={() => copySymbolStyle(value ?? null)}
        >
          Copy look
        </TextButton>
        <TextButton
          tone="muted"
          disabled={disabled || !copied}
          onClick={() => copied && onChange(symbolStyleForShape(copied, shape))}
        >
          Paste look
        </TextButton>
        <TextButton tone="muted" disabled={disabled} onClick={loadQml} title="Read a QGIS layer style file (.qml)">
          Load QGIS style…
        </TextButton>
        <TextButton tone="muted" disabled={disabled || symbolStyleIsEmpty(value)} onClick={() => onChange({})}>
          Reset look
        </TextButton>
      </div>
      {notes && (
        <div role="status" className="grid gap-0.5 text-2xs text-muted-foreground" data-symbol-style-notes="">
          <span className="font-medium text-foreground">{notes.title}</span>
          {notes.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
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
  groundWidth,
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
      <PopoverContent
        className="max-h-[min(34rem,var(--radix-popover-content-available-height))] w-64 overflow-y-auto p-3"
        align="end"
        aria-label={label}
      >
        <SymbolStyleEditor
          shape={shape}
          defaults={defaults}
          value={value}
          onChange={onChange}
          label={label}
          colorPresets={colorPresets}
          groundWidth={groundWidth}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}
