import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { Basemap } from '../basemaps'
import type { AnalysisSummary } from '../types'
import { COMPARISON_MODELS, STATUS_LABELS, modelById, type ComparisonFamily } from './registry'
import { useComparisonData } from './useComparisonData'
import { LidarComparison } from './LidarComparison'
import { RgbComparison } from './RgbComparison'
import { ShapeComparison } from './ShapeComparison'
import { NeuralComparison } from './NeuralComparison'

export function ModelComparisonWorkspace({
  summary,
  error,
  basemap,
  onRetry,
}: {
  summary: AnalysisSummary | null
  error: string
  basemap: Basemap
  onRetry?: () => void
}) {
  const { data, error: loadError, retry } = useComparisonData(summary?.source_sha256)
  const [params, setParams] = useSearchParams()
  const family: ComparisonFamily = ['lidar', 'neural', 'rgb', 'shapes'].includes(params.get('family') ?? '')
    ? (params.get('family') as ComparisonFamily)
    : 'lidar'
  const setFamily = (value: ComparisonFamily) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.set('family', value)
        return next
      },
      { replace: true },
    )
  const [selected, setSelected] = useState<string | undefined>(),
    [catalogue, setCatalogue] = useState<boolean | null>(null)
  const isMobile = useIsMobile(),
    showCatalogue = catalogue ?? !isMobile,
    model = selected ? modelById(selected) : undefined
  const blocked = model && model.status !== 'completed' && model.status !== 'partial'
  const switchFamily = (value: string) => {
    setFamily(value as ComparisonFamily)
    setSelected(undefined)
  }
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="LiDAR model comparison workspace">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <h1 className="mr-auto text-sm font-semibold">Compare model outputs</h1>
        <SegmentedControl
          label="Comparison dataset family"
          fullWidth={false}
          size="sm"
          value={family}
          onChange={switchFamily}
          options={[
            { value: 'lidar', label: 'LiDAR segmentation' },
            { value: 'neural', label: 'Neural models' },
            { value: 'rgb', label: 'RGB crowns' },
            { value: 'shapes', label: '3D shape review' },
          ]}
        />
        <Button
          size="sm"
          variant="outline"
          aria-expanded={showCatalogue}
          aria-controls="model-catalogue"
          onClick={() => setCatalogue(!showCatalogue)}
        >
          {showCatalogue ? 'Hide' : 'Show'} models
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <aside
          id="model-catalogue"
          hidden={!showCatalogue}
          aria-label="Model catalogue"
          className={`${showCatalogue ? 'flex' : 'hidden'} h-[30dvh] min-h-0 shrink-0 flex-col overflow-hidden border-b md:h-full md:w-[270px] md:border-b-0 md:border-r`}
        >
          <MapSidebarShell
            title="Models & execution"
            subtitle="Select any model to inspect its actual output or run status."
          >
            <SidebarSection title="Available variants">
              <div className="space-y-1">
                {COMPARISON_MODELS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected === item.id}
                    className={`block w-full rounded-md border p-2 text-left text-xs ${selected === item.id ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950' : 'hover:bg-muted'}`}
                    onClick={() => {
                      setFamily(item.family)
                      setSelected(item.id)
                      if (isMobile) setCatalogue(false)
                    }}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-1">
                      <strong>{item.name}</strong>
                      <Badge tone={item.status === 'completed' ? 'success' : 'warning'}>
                        {STATUS_LABELS[item.status]}
                      </Badge>
                    </span>
                    <span className="mt-1 block text-[10px] text-muted-foreground">{item.input}</span>
                  </button>
                ))}
              </div>
            </SidebarSection>
            <SidebarSection title="How to choose">
              <p className="text-xs leading-5">
                Compare the same input, inspect splits, merges and missed objects, then save your preference and notes
                below the views. Coverage, confidence and instance counts do not establish accuracy.
              </p>
              <p className="mt-2 text-xs leading-5">
                This page displays saved processing results. It does not run GPU models on an uploaded file in the
                browser.
              </p>
            </SidebarSection>
            <SidebarSection title="Other model workspaces">
              <div className="flex flex-col gap-2 text-xs underline">
                <Link to="/dev/lidar/volume/">Forest volume and harvest scenarios</Link>
                <Link to="/dev/lidar/species/">Species and inventory comparisons</Link>
                <Link to="/dev/lidar/buildings/">Building and roof reconstruction</Link>
                <Link to="/dev/lidar/trees/">Detailed point editing and review</Link>
              </div>
            </SidebarSection>
          </MapSidebarShell>
        </aside>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {blocked ? (
            <section
              className="flex h-full flex-col items-start justify-center gap-3 overflow-y-auto p-6"
              aria-label="Model run status"
            >
              <Badge tone="warning">{STATUS_LABELS[model.status]}</Badge>
              <h2 className="text-xl font-semibold">{model.name}</h2>
              <p className="max-w-xl text-sm leading-6">{model.note}</p>
              <p className="text-xs text-muted-foreground">
                Required input: {model.input}
                <br />
                Intended output: {model.output}
              </p>
              <p className="max-w-xl text-xs text-muted-foreground">
                There are no executed predictions or performance metrics to display for this model. Existing outputs are
                cleared when you select it.
              </p>
              {model.url && (
                <a href={model.url} target="_blank" rel="noreferrer" className="text-sm underline">
                  Model source and documentation
                </a>
              )}
              <Button onClick={() => setSelected(undefined)}>
                Compare available {family === 'lidar' ? 'LiDAR' : 'RGB'} outputs
              </Button>
            </section>
          ) : family === 'neural' ? (
            <NeuralComparison basemap={basemap} sourceSha={summary?.source_sha256} />
          ) : !data ? (
            <div className="flex h-full items-center justify-center p-6 text-sm" role="status">
              <div>
                {loadError || error || 'Loading and checking saved model outputs…'}
                {(loadError || error) && (
                  <Button size="sm" onClick={loadError ? retry : onRetry} className="ml-2">
                    Retry comparison data
                  </Button>
                )}
              </div>
            </div>
          ) : family === 'lidar' ? (
            <LidarComparison data={data} basemap={basemap} selectedModel={selected} />
          ) : family === 'rgb' ? (
            <RgbComparison data={data} basemap={basemap} selectedModel={selected} />
          ) : (
            <ShapeComparison data={data} basemap={basemap} />
          )}
        </div>
      </div>
    </main>
  )
}
