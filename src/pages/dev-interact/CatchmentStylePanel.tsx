import { ChevronDown, Eye, EyeOff, Waves } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { STYLE_ATTRIBUTES } from './catchments'
import { GRADUATED_RAMPS } from './styling'
import type { GraduatedRampName, LegendItem, StyleAttributeId } from './types'

// Felt-style floating legend / style card. Lets the user color the catchment
// dataset by an attribute (graduated or categorical) and shows the resulting
// legend with live feature counts.
export function CatchmentStylePanel({
  visible,
  onToggleVisible,
  attribute,
  onAttributeChange,
  ramp,
  onRampChange,
  legend,
  totalCount,
}: {
  visible: boolean
  onToggleVisible: () => void
  attribute: StyleAttributeId
  onAttributeChange: (attribute: StyleAttributeId) => void
  ramp: GraduatedRampName
  onRampChange: (ramp: GraduatedRampName) => void
  legend: LegendItem[]
  totalCount: number
}) {
  const [collapsed, setCollapsed] = useState(false)
  const activeAttribute = STYLE_ATTRIBUTES.find((item) => item.id === attribute) ?? STYLE_ATTRIBUTES[0]
  const isGraduated = activeAttribute.kind === 'graduated'

  return (
    <div className="pointer-events-auto absolute left-3 top-16 z-30 w-[16.5rem] max-w-[calc(100%-1.5rem)] overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur md:top-3">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-600">
          <Waves className="size-4" />
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={!collapsed}
        >
          <span className="block truncate text-sm font-semibold leading-tight">Sewage spill cells</span>
          <span className="block truncate text-[11px] text-muted-foreground">{totalCount} cells · styled by attribute</span>
        </button>
        <button
          type="button"
          onClick={onToggleVisible}
          className="rounded-md p-1.5 hover:bg-muted"
          aria-label={visible ? 'Hide layer' : 'Show layer'}
          aria-pressed={visible}
        >
          {visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          className="rounded-md p-1.5 hover:bg-muted"
          aria-label={collapsed ? 'Expand styling panel' : 'Collapse styling panel'}
        >
          <ChevronDown className={cn('size-4 transition-transform', collapsed && '-rotate-90')} />
        </button>
      </div>

      {!collapsed && (
        <div className={cn('space-y-3 p-3', !visible && 'opacity-50')}>
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Style by</div>
            <div className="grid grid-cols-3 gap-1">
              {STYLE_ATTRIBUTES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onAttributeChange(item.id)}
                  aria-pressed={item.id === attribute}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-[11px] font-medium leading-tight transition-colors',
                    item.id === attribute
                      ? 'border-sky-500 bg-sky-500/10 text-sky-700'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {isGraduated && (
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Color ramp</div>
              <div className="flex gap-1.5">
                {GRADUATED_RAMPS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onRampChange(option.id)}
                    aria-label={`${option.label} ramp`}
                    aria-pressed={option.id === ramp}
                    className={cn(
                      'h-6 flex-1 overflow-hidden rounded-md border transition-all',
                      option.id === ramp ? 'border-foreground ring-2 ring-foreground/15' : 'border-border',
                    )}
                  >
                    <span className="flex h-full w-full">
                      {option.colors.map((color) => (
                        <span key={color} className="h-full flex-1" style={{ backgroundColor: color }} />
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Legend</span>
              <span className="text-[11px] text-muted-foreground">{activeAttribute.label}</span>
            </div>
            <ul className="space-y-1">
              {legend.map((item) => (
                <li key={item.key} className="flex items-center gap-2">
                  <span
                    className="size-3.5 shrink-0 rounded-sm border border-black/10"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">{item.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
