import { useId } from 'react'
import { ColorField } from '@/components/ui/color-field'
import { StyledSelect } from '@/components/ui/styled-select'
import { PatternField } from '@/components/ui/symbol-style-fields'
import { cutblockBufferSymbol } from './cutblockBufferStyle'
import { NumberField } from './Controls'
import {
  CUTBLOCK_BUFFER_COLOR,
  DEFAULT_CUTBLOCK_BUFFER_M,
  MAX_CUTBLOCK_BUFFER_M,
  type CutblockBuffer,
} from './cutblockBuffers'

/** Colours that read against forest, hillshade and imagery alike; the picker offers them first. */
const BUFFER_COLOR_PRESETS = [CUTBLOCK_BUFFER_COLOR, '#2563eb', '#0891b2', '#047857', '#b45309', '#be185d', '#111827']

export function CutblockBufferField({
  layer,
  setting,
  sources,
  onChange,
  disabled,
}: {
  layer: string
  setting?: CutblockBuffer
  sources: readonly { key: string; name: string }[]
  onChange: (setting: CutblockBuffer | undefined) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="space-y-2">
      <div className="grid gap-1">
        <label htmlFor={id} className="text-xs font-medium">
          Cutblock buffer
        </label>
        <StyledSelect
          id={id}
          value={!setting ? 'none' : 'metres' in setting ? 'distance' : `source:${setting.source}`}
          disabled={disabled}
          onChange={(event) => {
            const choice = event.target.value
            const style = { color: setting?.color, pattern: setting?.pattern }
            onChange(
              choice === 'none'
                ? undefined
                : choice === 'distance'
                  ? { layer, ...style, metres: DEFAULT_CUTBLOCK_BUFFER_M }
                  : { layer, ...style, source: choice.slice('source:'.length) },
            )
          }}
        >
          <option value="none">No buffer</option>
          <option value="distance">Generate by distance</option>
          {sources.map(({ key, name }) => (
            <option key={key} value={`source:${key}`}>
              Use {name}
            </option>
          ))}
        </StyledSelect>
      </div>
      {setting && 'metres' in setting && (
        <NumberField
          label="Buffer distance (m)"
          value={setting.metres}
          min={1}
          max={MAX_CUTBLOCK_BUFFER_M}
          step={1}
          updateOn="commit"
          disabled={disabled}
          onChange={(metres) => onChange({ ...setting, metres })}
        />
      )}
      {setting && (
        <div className="grid gap-2">
          <div className="grid gap-1">
            <span className="text-xs font-medium">Buffer colour</span>
            <ColorField
              label="Buffer colour"
              value={setting.color ?? CUTBLOCK_BUFFER_COLOR}
              resettable={setting.color !== undefined}
              resetLabel="Buffer colour: back to the default"
              presets={BUFFER_COLOR_PRESETS}
              presetDisplay="picker"
              disabled={disabled}
              onChange={(color) => onChange({ ...setting, color: color ?? undefined })}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-xs font-medium">Buffer pattern</span>
            <PatternField
              label="Buffer pattern"
              value={setting.pattern ?? 'solid'}
              disabled={disabled}
              symbolFor={(pattern) => cutblockBufferSymbol({ color: setting.color, pattern })}
              onChange={(pattern) => onChange({ ...setting, pattern })}
            />
          </div>
        </div>
      )}
    </div>
  )
}
