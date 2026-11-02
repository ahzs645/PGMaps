import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, Calculator, Database, Droplets } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { TabBar } from '@/components/ui/tab-bar'
import { PublishedExplorer } from './forest-drought/PublishedExplorer'
import { CustomCalculator } from './forest-drought/CustomCalculator'

type View = 'published' | 'custom'

export default function DevForestDrought() {
  const { search } = useLocation()
  const [view, setView] = useState<View>('published')
  useEffect(() => {
    const previous = document.title
    document.title = 'Forest drought risk · PGMaps'
    return () => {
      document.title = previous
    }
  }, [])

  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/25">
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-24 sm:px-6 sm:pt-28 md:pt-12">
        <Link
          to="/dev/forestry"
          className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Forestry tools
        </Link>
        <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <Droplets className="size-5" aria-hidden="true" />
              Forest climate &amp; soil water
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Forest drought risk</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Explore BC’s published drought-risk estimates, or calculate soil water balance from your own daily climate
              observations. Each view keeps its source and method attached to the results.
            </p>
          </div>
          <Badge tone="success" variant="outline" size="sm" className="self-start">
            Runs in your browser
          </Badge>
        </header>

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
          className="mb-6 max-w-xl"
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
