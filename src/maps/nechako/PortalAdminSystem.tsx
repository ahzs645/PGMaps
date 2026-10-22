import { useState } from 'react'
import { InlineAlert } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { AdminReadResource } from './PortalAdminResource'
import { SYSTEM_RESOURCES } from './data/adminInspection'

export function PortalAdminSystem() {
  const [view, setView] = useState(SYSTEM_RESOURCES[0].id)
  const resource = SYSTEM_RESOURCES.find((entry) => entry.id === view) ?? SYSTEM_RESOURCES[0]
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">System Manager</h3>
      <TabBar
        label="System manager area"
        value={view}
        onChange={setView}
        options={SYSTEM_RESOURCES.map((entry) => ({ value: entry.id, label: entry.title }))}
      />
      <AdminReadResource key={resource.id} {...resource} />
      <InlineAlert>
        These controls inspect current source configuration. Changing registry entries, status definitions, scheduling
        rules and server variables uses the original System Manager.
      </InlineAlert>
    </section>
  )
}
