import { useState, type ReactNode } from 'react'
import { TabBar } from '@/components/ui/tab-bar'
import type { Basemap } from '../basemaps'
import { LidarToolLayout } from '../LidarToolLayout'
import type { AnalysisSummary } from '../types'
import { CompletedVolumeExample } from './CompletedVolumeExample'
import { ForestVolumeWorkspace } from './ForestVolumeWorkspace'
import { VolumeMethods } from './VolumeMethods'
import { VriVolumeWorkspace } from './VriVolumeWorkspace'

const VIEWS = [
  { value: 'vri', label: 'BC VRI', ariaLabel: 'BC VRI' },
  { value: 'example', label: 'Example', ariaLabel: 'Completed example' },
  { value: 'calibrate', label: 'Calibrate', ariaLabel: 'Calibrate BC tile' },
  { value: 'methods', label: 'Methods', ariaLabel: 'How volume is measured' },
]

/**
 * Four views of forest volume, each its own map and sidebar in the shared LiDAR layout. All four
 * stay mounted, hidden when not chosen, so a view keeps its selection and scenario while you
 * look at another.
 */
export function VolumeWorkspace(props: { summary: AnalysisSummary | null; basemap: Basemap; error: string }) {
  const [view, setView] = useState('vri')
  // Each view has its own copy, so each copy needs its own tab ids.
  const switcher = (owner: string) => (
    <TabBar
      label="Forest volume view"
      idPrefix={`volume-${owner}-view`}
      variant="underline"
      stretch
      className="shrink-0 border-b border-border"
      value={view}
      onChange={setView}
      options={VIEWS}
    />
  )
  const pane = (id: string, content: ReactNode) => (
    <div hidden={view !== id} className={view === id ? 'h-full' : 'hidden'}>
      {content}
    </div>
  )
  return (
    <>
      {pane(
        'vri',
        <VriVolumeWorkspace summary={props.summary} basemap={props.basemap} viewSwitcher={switcher('vri')} />,
      )}
      {pane('example', <CompletedVolumeExample basemap={props.basemap} viewSwitcher={switcher('example')} />)}
      {pane('calibrate', <ForestVolumeWorkspace {...props} viewSwitcher={switcher('calibrate')} />)}
      {pane(
        'methods',
        <LidarToolLayout
          toolId="volume"
          title="Forest volume"
          subtitle="How forest volume is measured"
          metadata={switcher('methods')}
          mobilePeekSubtitle="How volume is measured"
          sidebar={
            <p className="p-4 text-sm leading-6 text-muted-foreground">
              How stands and trees are estimated from airborne LiDAR, which volumes stay separate, and how this BC tile
              could be estimated without new fieldwork.
            </p>
          }
        >
          <VolumeMethods />
        </LidarToolLayout>,
      )}
    </>
  )
}
