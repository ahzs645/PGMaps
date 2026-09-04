import { Layers3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  BC_ENVIRO_SCREEN_MAP_OPTION_GROUPS,
  BC_ENVIRO_SCREEN_MAX_COLOR_BINS,
  BC_ENVIRO_SCREEN_MIN_COLOR_BINS,
  type BcEnviroScreenMapVariable,
} from '../lib/bcEnviroScreenMapView'

interface BcEnviroScreenMapControlsProps {
  variable: BcEnviroScreenMapVariable
  onVariableChange: (variable: BcEnviroScreenMapVariable) => void
  colorBins: number
  onColorBinsChange: (bins: number) => void
  isDesktop: boolean
}

/** Shiny-compatible map variable and colour-bin controls for the BC EnviroScreen lens. */
export function BcEnviroScreenMapControls({
  variable,
  onVariableChange,
  colorBins,
  onColorBinsChange,
  isDesktop,
}: BcEnviroScreenMapControlsProps) {
  return (
    <section
      className={cn(
        'absolute z-20 w-[min(18rem,calc(100%-1rem))] rounded-lg border border-violet-200 bg-background/95 p-3 shadow-xl backdrop-blur dark:border-violet-900/70',
        isDesktop ? 'left-3 top-3' : 'left-2 top-[calc(env(safe-area-inset-top)+7.1rem)]',
      )}
      aria-label="BC EnviroScreen map controls"
      data-bc-enviro-screen-map-controls="true"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
        <Layers3 className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" />
        Map variable
      </div>
      <select
        value={variable}
        onChange={(event) => onVariableChange(event.target.value as BcEnviroScreenMapVariable)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
        aria-label="BC EnviroScreen map variable"
      >
        {BC_ENVIRO_SCREEN_MAP_OPTION_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <div className="mt-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <label htmlFor="bc-enviro-screen-color-bins" className="font-semibold text-foreground">
            No. of colour bins
          </label>
          <output
            htmlFor="bc-enviro-screen-color-bins"
            className="min-w-7 rounded bg-violet-100 px-1.5 py-0.5 text-center font-semibold text-violet-900 dark:bg-violet-950 dark:text-violet-100"
          >
            {colorBins}
          </output>
        </div>
        <input
          id="bc-enviro-screen-color-bins"
          type="range"
          min={BC_ENVIRO_SCREEN_MIN_COLOR_BINS}
          max={BC_ENVIRO_SCREEN_MAX_COLOR_BINS}
          step={1}
          value={colorBins}
          onChange={(event) => onColorBinsChange(Number(event.target.value))}
          className="mt-2 h-2 w-full cursor-pointer accent-violet-700"
        />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{BC_ENVIRO_SCREEN_MIN_COLOR_BINS}</span>
          <span>Equal intervals</span>
          <span>{BC_ENVIRO_SCREEN_MAX_COLOR_BINS}</span>
        </div>
      </div>
    </section>
  )
}
