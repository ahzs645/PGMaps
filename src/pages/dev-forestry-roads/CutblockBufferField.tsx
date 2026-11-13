import { useId } from 'react'
import { StyledSelect } from '@/components/ui/styled-select'
import { NumberField } from './Controls'
import {
  CUTBLOCK_BUFFER_COLOR,
  DEFAULT_CUTBLOCK_BUFFER_M,
  MAX_CUTBLOCK_BUFFER_M,
  type CutblockBuffer,
  type CutblockBufferPattern,
} from './cutblockBuffers'

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
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-2">
          <label className="grid gap-1 text-xs font-medium">
            Buffer colour
            <input
              type="color"
              value={setting.color ?? CUTBLOCK_BUFFER_COLOR}
              disabled={disabled}
              className="h-8 w-12 cursor-pointer rounded-md border border-input bg-background p-0.5"
              onChange={(event) => onChange({ ...setting, color: event.target.value })}
            />
          </label>
          <div className="grid gap-1">
            <label htmlFor={`${id}-pattern`} className="text-xs font-medium">
              Buffer pattern
            </label>
            <StyledSelect
              id={`${id}-pattern`}
              value={setting.pattern ?? 'solid'}
              disabled={disabled}
              onChange={(event) => onChange({ ...setting, pattern: event.target.value as CutblockBufferPattern })}
            >
              <option value="solid">Solid tint</option>
              <option value="diagonal">Diagonal hatch</option>
              <option value="crosshatch">Crosshatch</option>
            </StyledSelect>
          </div>
        </div>
      )}
    </div>
  )
}
