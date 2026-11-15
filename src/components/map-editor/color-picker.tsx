import { ColorField } from '@/components/ui/color-field'

type MapColorPickerProps = {
  value: string
  onChange: (value: string) => void
  title?: string
  /** Quick-pick swatches (e.g. current theme colors) */
  swatches?: string[]
  /** The side of the swatch the picker prefers; it still flips to stay on screen (default below). */
  placement?: 'top' | 'bottom'
  className?: string
}

/**
 * The map editor's round colour swatch. It opens the shared colour picker (`ColorField`): the
 * colour follows a drag live, since a marker or path draft is cheap to redraw.
 */
export function MapColorPicker({
  value,
  onChange,
  title,
  swatches = [],
  placement = 'bottom',
  className,
}: MapColorPickerProps) {
  return (
    <ColorField
      label={title ?? 'Color'}
      value={value}
      resettable={false}
      presets={swatches}
      presetDisplay="picker"
      side={placement}
      onChange={(color) => color && onChange(color)}
      onPreview={onChange}
      swatchClassName="size-7 rounded-full border-0 ring-1 ring-border transition-transform hover:scale-110"
      className={className}
    />
  )
}
