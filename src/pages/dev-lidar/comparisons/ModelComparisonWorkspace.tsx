import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { ExternalLink } from '@/components/ui/text-button'
import { NativeSelect } from '@/components/ui/form-field'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { Basemap } from '../basemaps'
import { LidarToolLayout } from '../LidarToolLayout'
import type { AnalysisSummary } from '../types'
import { COMPARISON_MODELS, STATUS_LABELS, modelById, type ComparisonFamily } from './registry'
import { useComparisonData } from './useComparisonData'
import { LidarComparison } from './LidarComparison'
import { RgbComparison } from './RgbComparison'
import { ShapeComparison } from './ShapeComparison'
import { NeuralComparison } from './NeuralComparison'

const FAMILIES: { value: ComparisonFamily; label: string }[] = [
  { value: 'lidar', label: 'LiDAR segmentation' },
  { value: 'neural', label: 'Neural models' },
  { value: 'rgb', label: 'RGB crowns' },
  { value: 'shapes', label: '3D shape review' },
]

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
    [sheetCollapse, setSheetCollapse] = useState(0)
  const isMobile = useIsMobile(),
    model = selected ? modelById(selected) : undefined
  const blocked = model && model.status !== 'completed' && model.status !== 'partial'
  const switchFamily = (value: string) => {
    setFamily(value as ComparisonFamily)
    setSelected(undefined)
  }
  const familyLabel = FAMILIES.find((item) => item.value === family)?.label
  return (
    <LidarToolLayout
      toolId="compare"
      label="LiDAR model comparison workspace"
      collapseSheetKey={sheetCollapse}
      mobilePeekSubtitle={model ? `${familyLabel} · ${model.name}` : familyLabel}
      sidebar={
        <>
          <SidebarSection
            title="Compare"
            actions={
              <InfoTip label="How to choose a model">
                Compare the same input, inspect splits, merges and missed objects, then save your preference and notes
                below the views. Coverage, confidence and instance counts do not establish accuracy. This page shows
                saved processing results; it does not run GPU models on an uploaded file in the browser.
              </InfoTip>
            }
          >
            <NativeSelect
              aria-label="Comparison dataset family"
              value={family}
              onChange={(event) => switchFamily(event.target.value)}
            >
              {FAMILIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </SidebarSection>
          <SidebarSection title="Models & execution" subtitle="Select a model to inspect its output or run status.">
            <div className="space-y-1" id="model-catalogue" aria-label="Model catalogue">
              {COMPARISON_MODELS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected === item.id}
                  className={`block w-full rounded-md border p-2 text-left text-xs ${selected === item.id ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950' : 'hover:bg-muted'}`}
                  onClick={() => {
                    setFamily(item.family)
                    setSelected(item.id)
                    if (isMobile) setSheetCollapse((n) => n + 1)
                  }}
                >
                  <span className="flex flex-wrap items-center justify-between gap-1">
                    <strong>{item.name}</strong>
                    <Badge tone={item.status === 'completed' ? 'success' : 'warning'}>
                      {STATUS_LABELS[item.status]}
                    </Badge>
                  </span>
                  <span className="mt-1 block text-2xs text-muted-foreground">{item.input}</span>
                </button>
              ))}
            </div>
          </SidebarSection>
          <SidebarSection title="Other model workspaces">
            <div className="flex flex-col gap-2 text-xs underline">
              <Link to="/dev/lidar/volume/">Forest volume and harvest scenarios</Link>
              <Link to="/dev/lidar/species/">Species and inventory comparisons</Link>
              <Link to="/dev/lidar/buildings/">Building and roof reconstruction</Link>
              <Link to="/dev/lidar/trees/">Detailed point editing and review</Link>
            </div>
          </SidebarSection>
        </>
      }
    >
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
              <ExternalLink href={model.url} className="text-sm">
                Model source and documentation
              </ExternalLink>
            )}
            <Button onClick={() => setSelected(undefined)}>
              Compare available {family === 'lidar' ? 'LiDAR' : 'RGB'} outputs
            </Button>
          </section>
        ) : family === 'neural' ? (
          <NeuralComparison basemap={basemap} sourceSha={summary?.source_sha256} />
        ) : !data ? (
          <div className="flex h-full items-center justify-center p-6">
            {loadError || error ? (
              <div className="max-w-md space-y-3">
                <InlineAlert tone="error" title="Could not load the comparison data">
                  {loadError || error}
                </InlineAlert>
                <Button size="sm" onClick={loadError ? retry : onRetry}>
                  Retry comparison data
                </Button>
              </div>
            ) : (
              <InlineAlert loading>Loading and checking saved model outputs…</InlineAlert>
            )}
          </div>
        ) : family === 'lidar' ? (
          <LidarComparison data={data} basemap={basemap} selectedModel={selected} />
        ) : family === 'rgb' ? (
          <RgbComparison data={data} basemap={basemap} selectedModel={selected} />
        ) : (
          <ShapeComparison data={data} basemap={basemap} />
        )}
      </div>
    </LidarToolLayout>
  )
}
