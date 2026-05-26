import { ChevronDown, Layers, MoreHorizontal, Ruler, Search, Table2 } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { layerLabel } from './geo'
import type { LayerId } from './types'

const menuLayers: LayerId[] = ['parks', 'routes', 'neighbourhoods']

export function MobileMapToolbar({
  visibleLayers,
  onToggleLayer,
  onStartMeasurement,
  onOpenTable,
}: {
  visibleLayers: Record<LayerId, boolean>
  onToggleLayer: (layer: LayerId) => void
  onStartMeasurement: () => void
  onOpenTable: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-40 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] md:hidden">
      <header role="toolbar" aria-label="Map toolbar" className="flex items-start justify-between gap-3">
        <div className="relative pointer-events-auto">
          <button
            type="button"
            aria-label="Main menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={cn(
              'flex h-11 items-center gap-1.5 rounded-md border border-white/70 bg-white/90 px-3 text-foreground shadow-lg backdrop-blur transition-colors',
              menuOpen && 'bg-white',
            )}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <span className="text-[24px] font-bold leading-none tracking-[-0.02em]" aria-hidden="true">Felt</span>
            <ChevronDown className={cn('size-3.5 transition-transform', menuOpen && 'rotate-180')} />
          </button>

          {menuOpen && (
            <div role="menu" className="absolute left-0 top-[calc(100%+0.5rem)] w-64 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl">
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onStartMeasurement()
                  setMenuOpen(false)
                }}
              >
                <Ruler className="size-4" />
                <span className="font-medium">Measure areas</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onOpenTable()
                  setMenuOpen(false)
                }}
              >
                <Table2 className="size-4" />
                <span className="font-medium">Open table</span>
              </button>

              <div className="border-t border-border py-1">
                <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Layers className="size-3.5" />
                  <span>Layers</span>
                </div>
                {menuLayers.map((layer) => (
                  <button
                    key={layer}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={visibleLayers[layer]}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => onToggleLayer(layer)}
                  >
                    <span className={cn('size-4 rounded border border-border', visibleLayers[layer] && 'border-primary bg-primary')} />
                    <span>{layerLabel(layer)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button type="button" aria-label="Online users" className="grid size-8 place-items-center rounded-full bg-orange-500 text-white shadow-lg">
            <span className="text-[11px] font-bold">PG</span>
          </button>
          <button type="button" aria-label="Search tool" className="grid size-11 place-items-center rounded-md border border-white/70 bg-white/90 text-foreground shadow-lg backdrop-blur hover:bg-white">
            <Search className="size-5" />
          </button>
          <button type="button" aria-label="More" className="grid size-11 place-items-center rounded-md border border-white/70 bg-white/90 text-foreground shadow-lg backdrop-blur hover:bg-white">
            <MoreHorizontal className="size-5" />
          </button>
        </div>
      </header>
    </div>
  )
}
