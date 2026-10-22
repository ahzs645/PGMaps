import { useState } from 'react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { Basemap } from '../basemaps'
import type { AnalysisSummary } from '../types'
import { CompletedVolumeExample } from './CompletedVolumeExample'
import { ForestVolumeWorkspace } from './ForestVolumeWorkspace'
import { VolumeMethods } from './VolumeMethods'
import { VriVolumeWorkspace } from './VriVolumeWorkspace'

export function VolumeWorkspace(props: { summary: AnalysisSummary | null; basemap: Basemap; error: string }) {
  const [view, setView] = useState('vri')
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Forest volume tools">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
        <h1 className="mr-auto text-sm font-semibold">Forest volume</h1>
        <SegmentedControl
          label="Forest volume view"
          fullWidth={false}
          size="sm"
          className="max-w-full overflow-x-auto"
          value={view}
          onChange={setView}
          options={[
            { value: 'vri', label: 'BC VRI' },
            { value: 'example', label: 'Completed example' },
            { value: 'calibrate', label: 'Calibrate BC tile' },
            { value: 'methods', label: 'How volume is measured' },
          ]}
        />
      </div>
      <div
        hidden={view !== 'vri'}
        className={`${view === 'vri' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden`}
      >
        <VriVolumeWorkspace summary={props.summary} basemap={props.basemap} />
      </div>
      <div
        hidden={view !== 'example'}
        className={`${view === 'example' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden`}
      >
        <CompletedVolumeExample basemap={props.basemap} />
      </div>
      <div
        hidden={view !== 'calibrate'}
        className={`${view === 'calibrate' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden`}
      >
        <ForestVolumeWorkspace {...props} />
      </div>
      <div
        hidden={view !== 'methods'}
        className={`${view === 'methods' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden`}
      >
        <VolumeMethods />
      </div>
    </main>
  )
}
