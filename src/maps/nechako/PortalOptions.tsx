import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { Badge } from '@/components/ui/badge'
import { NECHAKO_PORTAL } from '@/lib/nechakoPortal'
import type { InventoryPanel } from './data/portalInventory'
import type { PortalAdministrationView } from './PortalAdministration'
import { PORTAL_CAPABILITIES, PORTAL_SUPPORT_LABELS, type PortalCapabilitySupport } from './data/portalCapabilities'

export function PortalOptions({
  onOpen,
  onMapPane,
  onAdministration,
}: {
  onOpen: (panel: InventoryPanel) => void
  onMapPane?: (pane: 'tools' | 'layers') => void
  onAdministration?: (view: PortalAdministrationView) => void
}) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('All options')
  const [support, setSupport] = useState<PortalCapabilitySupport | 'all'>('all')
  const groups = ['All options', ...new Set(PORTAL_CAPABILITIES.map((item) => item.group))]
  const options = useMemo(
    () =>
      PORTAL_CAPABILITIES.filter(
        (item) =>
          (group === 'All options' || group === item.group) &&
          (support === 'all' || support === item.support) &&
          `${item.name} ${item.description} ${item.group} ${item.sourcePath}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [query, group, support],
  )
  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-muted-foreground">
        Explore the source portal’s menus and their PGMaps equivalents. “Source connection” uses the original account’s
        access. “Partial support” describes the available part of a workflow. “Original portal” opens that site; it does
        not perform the action here.
      </p>
      <div className="flex flex-wrap gap-3">
        <SearchInput
          aria-label="Find a portal option"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Search tools, source menus or workflows"
          className="min-w-0 flex-1"
        />
        <select
          aria-label="Option category"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
          className="max-w-full rounded-md border bg-background p-2 text-base"
        >
          {groups.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Option availability"
          value={support}
          onChange={(event) => setSupport(event.target.value as typeof support)}
          className="max-w-full rounded-md border bg-background p-2 text-base"
        >
          <option value="all">All availability</option>
          {Object.entries(PORTAL_SUPPORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm" aria-live="polite">
        {options.length} of {PORTAL_CAPABILITIES.length} options
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((item) => (
          <article
            key={item.id}
            className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
            data-portal-option={item.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold">{item.name}</h3>
              <Badge tone={item.support === 'partial' ? 'warning' : 'neutral'}>
                {PORTAL_SUPPORT_LABELS[item.support]}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{item.group}</p>
            <p className="flex-1 text-sm leading-6">{item.description}</p>
            <p className="break-words text-xs text-muted-foreground">
              <span className="font-medium">Source menu:</span> {item.sourcePath}
            </p>
            {item.panel && (
              <Button variant="outline" onClick={() => onOpen(item.panel!)}>
                Open {item.name.toLowerCase()}
              </Button>
            )}
            {item.administrationView && (
              <Button
                variant="outline"
                onClick={() =>
                  onAdministration ? onAdministration(item.administrationView!) : onOpen('administration')
                }
              >
                Open {item.name.toLowerCase()}
              </Button>
            )}
            {item.mapPane &&
              (onMapPane ? (
                <Button variant="outline" onClick={() => onMapPane(item.mapPane!)}>
                  Open {item.mapPane === 'tools' ? 'Map Tools' : 'map layers'}
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <a href="/dev/nechako?view=layers">Open map tools</a>
                </Button>
              ))}
            {item.support === 'original' && (
              <Button asChild variant="outline">
                <a href={NECHAKO_PORTAL} target="_blank" rel="noreferrer">
                  Open original portal
                </a>
              </Button>
            )}
          </article>
        ))}
      </div>
      {!options.length && <InlineAlert>No options match. Clear the search or choose another category.</InlineAlert>}
    </div>
  )
}
