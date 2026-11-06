import { ToolPageHeader } from '@/components/ui/tool-page-header'
import { ForestryBackLink } from '@/components/dev/ForestryBackLink'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Calculator, Database, Droplets } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { TabBar } from '@/components/ui/tab-bar'
import { PublishedExplorer } from './forest-drought/PublishedExplorer'
import { CustomCalculator } from './forest-drought/CustomCalculator'

type View = 'published' | 'custom'

export default function DevForestDrought() {
  const { search } = useLocation()
  const [view, setView] = useState<View>('published')
  useDocumentTitle('Forest drought risk · PGMaps')

  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/25">
      <div className="mx-auto max-w-7xl px-4 pb-8 pt-20 sm:px-6 md:pt-6">
        <ToolPageHeader
          back={<ForestryBackLink variant="text" />}
          eyebrow="Forest climate & soil water"
          eyebrowIcon={Droplets}
          eyebrowClassName="text-emerald-700 dark:text-emerald-400"
          title="Forest drought risk"
          description="Explore BC’s published drought-risk estimates, or calculate soil water balance from your own daily climate observations. Each view keeps its source and method attached to the results."
          aside={
            <Badge tone="success" variant="outline" size="sm">
              Runs in your browser
            </Badge>
          }
        />

        <TabBar<View>
          value={view}
          onChange={setView}
          label="Drought risk workflow"
          idPrefix="forest-drought"
          stretch
          options={[
            { value: 'published', label: 'Published estimates', icon: Database },
            { value: 'custom', label: 'Custom calculation', icon: Calculator },
          ]}
          className="mb-4 max-w-xl"
        />
        <div
          role="tabpanel"
          id="forest-drought-panel-published"
          aria-labelledby="forest-drought-tab-published"
          hidden={view !== 'published'}
        >
          {/* A new link is one complete selection. Remount only this workflow so
              no new BGC can inherit a previous link's locally edited soil/period. */}
          <PublishedExplorer key={search} active={view === 'published'} />
        </div>
        <div
          role="tabpanel"
          id="forest-drought-panel-custom"
          aria-labelledby="forest-drought-tab-custom"
          hidden={view !== 'custom'}
        >
          <CustomCalculator active={view === 'custom'} />
        </div>
      </div>
    </div>
  )
}
