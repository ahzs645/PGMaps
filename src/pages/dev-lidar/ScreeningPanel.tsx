import { NativeSelect } from '@/components/ui/form-field'
import { Button } from '@/components/ui/button'
import { KeyValueRows, SidebarSection } from '@/components/ui/map-panels'
import { ResultRow } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { downloadText } from '@/lib/download'
import { useEffect, useState } from 'react'
import { ANALYSIS_MODES, readReviewLedger, type ReviewLedger, type WorkflowData } from './analysisWorkflows'
import { isHeatmapMode } from './canopyHeatmaps'
import { isForestMode } from './forestry'
import { isSpeciesMode } from './species'

import type { WorkflowPanelProps } from './WorkflowPanel'
export function ScreeningPanel({ props, choose }: { props: WorkflowPanelProps; choose: (id: string) => void }) {
  const { data, options, features, selected, model } = props
  const [ledger, setLedger] = useState<ReviewLedger>({})
  const [reviewStatus, setReviewStatus] = useState('')
  const models = data?.models.records.slice().sort((a, b) => b.area_m2 - a.area_m2) ?? []
  const sourceHash = data?.models.source_sha256
  const reviewKey = `pgmaps-lidar-review-${sourceHash}-${data?.models.candidate_sha256}`
  useEffect(() => {
    if (!data) return
    try {
      const value = localStorage.getItem(reviewKey)
      setLedger(
        value ? readReviewLedger(value, data.models.source_sha256, new Set(data.models.records.map((r) => r.id))) : {},
      )
    } catch {
      setReviewStatus('Saved review could not be read. Export new notes before leaving.')
      setLedger({})
    }
  }, [data, reviewKey])
  const save = (next: ReviewLedger) => {
    if (!data) return
    setLedger(next)
    try {
      localStorage.setItem(reviewKey, JSON.stringify({ schema_version: 1, source_sha256: sourceHash, records: next }))
      setReviewStatus('Saved on this browser. Export to share or back up.')
    } catch {
      setReviewStatus('Browser storage unavailable. Export your review before leaving.')
    }
  }
  const properties = selected?.properties
  const mode = ANALYSIS_MODES.find((item) => item.id === options.mode)
  const review = model ? (ledger[model.id] ?? { decision: 'unreviewed' as const, note: '' }) : null
  const exportResults = () => {
    if (!data || !options.mode) return
    downloadText(
      JSON.stringify(
        {
          type: 'FeatureCollection',
          features,
          metadata: {
            source_sha256: data.workflows.source_sha256,
            input_sha256: data.workflows.input_sha256,
            options,
            method: data.workflows.methods[options.mode as keyof WorkflowData['methods']],
          },
        },
        null,
        2,
      ),
      `${options.mode}-screening.geojson`,
      'application/geo+json',
    )
  }

  return (
    <>
      {data &&
        options.mode &&
        !isForestMode(options.mode) &&
        !isHeatmapMode(options.mode) &&
        !isSpeciesMode(options.mode) &&
        options.mode !== 'trees' && (
          <>
            <SidebarSection title={mode?.label} subtitle={mode?.note}>
              {(options.mode === 'gaps' || options.mode === 'clearance') && (
                <label className="block text-xs">
                  Height threshold
                  <NativeSelect
                    aria-label="Workflow height threshold"
                    className="mt-1 w-full rounded border bg-background p-2"
                    value={options.threshold}
                    onChange={(e) => props.onOptions({ threshold: Number(e.target.value) as 2 | 5, selectedId: null })}
                  >
                    <option value={2}>2 m · low vegetation / openings</option>
                    <option value={5}>5 m · taller surface threshold</option>
                  </NativeSelect>
                </label>
              )}
              {options.mode === 'gaps' && (
                <div className="mt-3 space-y-3 text-xs">
                  <label className="block">
                    Minimum opening area
                    <NativeSelect
                      className="mt-1 w-full rounded border bg-background p-2"
                      value={options.minGap}
                      onChange={(e) => props.onOptions({ minGap: Number(e.target.value), selectedId: null })}
                    >
                      <option value={25}>25 m²</option>
                      <option value={100}>100 m²</option>
                      <option value={500}>500 m²</option>
                    </NativeSelect>
                  </label>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={options.enclosed}
                      onChange={(e) => props.onOptions({ enclosed: e.target.checked, selectedId: null })}
                    />
                    Enclosed candidates only
                  </label>
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Enclosed: ≥80% of the boundary borders higher cells, with no tile/missing-data or roof contact. This
                    is a geometric screen. Roads, lawns and fields need review; no authoritative forest mask is
                    available. Turning it off includes clipped openings.
                  </p>
                </div>
              )}
              {options.mode === 'plots' && (
                <div className="space-y-3 text-xs">
                  <label className="block">
                    Plot size
                    <NativeSelect
                      className="mt-1 w-full rounded border bg-background p-2"
                      value={options.plotSize}
                      onChange={(e) =>
                        props.onOptions({ plotSize: Number(e.target.value) as 25 | 50, selectedId: null })
                      }
                    >
                      <option value={25}>25 × 25 m</option>
                      <option value={50}>50 × 50 m</option>
                    </NativeSelect>
                  </label>
                  <label className="block">
                    Minimum supported coverage
                    <NativeSelect
                      className="mt-1 w-full rounded border bg-background p-2"
                      value={options.support}
                      onChange={(e) => props.onOptions({ support: Number(e.target.value), selectedId: null })}
                    >
                      <option value={0}>All plots, including partial</option>
                      <option value={80}>80%</option>
                      <option value={95}>95%</option>
                      <option value={100}>100%</option>
                    </NativeSelect>
                  </label>
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Colour: P95 surface height, 0–35 m, pale to dark purple. Percentiles use all supported 1 m surface
                    cells, including structures. These are not return-height percentiles or field inventory estimates.
                  </p>
                </div>
              )}
              {options.mode === 'clearance' && (
                <div className="mt-3 text-xs">
                  <label className="block">
                    Show centre distance up to
                    <NativeSelect
                      className="mt-1 w-full rounded border bg-background p-2"
                      value={options.clearance}
                      onChange={(e) => props.onOptions({ clearance: Number(e.target.value), selectedId: null })}
                    >
                      <option value={5}>5 m</option>
                      <option value={10}>10 m</option>
                      <option value={30}>30 m · entire search radius</option>
                    </NativeSelect>
                  </label>
                  <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                    Pink lines connect roof polygons to nearest elevated cell centres. Roofs plus 2 m are excluded to
                    reduce edge contamination: vegetation within that buffer is not assessed. Distances are horizontal,
                    not branch/wire/3D clearance or fire-code compliance. Other unclassified objects may be included.
                  </p>
                  <p className="mt-2 text-[10px]">
                    {178 -
                      data.workflows.clearance[String(options.threshold)].features.filter(
                        (f) => f.properties.distance_m !== null,
                      ).length}{' '}
                    patches have no elevated-cell match within 30 m. This is not proof of clearance.
                  </p>
                </div>
              )}
              {options.mode === 'models' && (
                <div className="space-y-3 text-xs">
                  <p>
                    {data.models.engine.version} · {data.models.engine.screened_points.toLocaleString()} original
                    cropped points. {data.models.records.filter((r) => r.success).length}/{models.length} engine
                    successes; {models.filter((r) => r.closed_edge_incidence).length} pass closed-edge incidence.
                  </p>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={props.meshVisible}
                      onChange={(e) => props.onMeshVisible(e.target.checked)}
                    />
                    Show selected LoD2.2 mesh
                  </label>
                  <Button size="sm" variant="outline" onClick={props.onPoints}>
                    Compare original 3D points
                  </Button>
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Select a patch below. Its ground is shifted to zero for display; exports retain source elevations.
                    Amber roofs / blue walls. All inputs remain unverified roof patches. A successful model or a
                    retained review label does not establish a building.
                  </p>
                </div>
              )}
              <p className="mt-3 text-xs font-medium" role="status">
                {options.mode === 'models' ? models.length : features.length}{' '}
                {options.mode === 'models' ? 'experimental patch models' : 'matching features'}
              </p>
              {options.mode !== 'models' && (
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  disabled={!features.length}
                  onClick={exportResults}
                >
                  Download shown GeoJSON
                </Button>
              )}
            </SidebarSection>
            {properties && options.mode !== 'models' && (
              <SidebarSection title={properties.id}>
                <KeyValueRows
                  size="sm"
                  rows={
                    options.mode === 'gaps'
                      ? [
                          { label: 'Source-cell area', value: `${properties.area_m2?.toLocaleString()} m²` },
                          { label: 'High-cell boundary', value: `${properties.canopy_edge_percent}%` },
                          { label: 'Clipped boundary', value: properties.boundary_clipped ? 'Yes' : 'No' },
                          { label: 'Roof contact', value: properties.near_roof ? 'Yes' : 'No' },
                        ]
                      : options.mode === 'plots'
                        ? [
                            {
                              label: 'Supported area',
                              value: `${properties.sampled_m2} m² (${properties.support_percent}%)`,
                            },
                            { label: 'Height mean / median', value: `${properties.mean_m} / ${properties.median_m} m` },
                            { label: 'Height P95 / SD', value: `${properties.p95_m} / ${properties.sd_m} m` },
                            { label: 'Surface cells >2 m', value: `${properties.above_2m_percent}%` },
                            {
                              label: 'Crown candidates',
                              value: `${properties.crown_candidates} (${properties.crown_candidates_per_ha}/ha supported)`,
                            },
                            { label: 'Ground-support P95', value: `${properties.ground_support_p95_m} m` },
                          ]
                        : [
                            { label: 'Centre distance', value: `${properties.distance_m} m` },
                            {
                              label: 'Cell-edge range',
                              value: `${properties.cell_distance_min_m}–${properties.cell_distance_max_m} m`,
                            },
                            { label: 'Candidate height', value: `${properties.candidate_height_m} m above terrain` },
                          ]
                  }
                />
                <Button size="sm" className="mt-3" variant="outline" onClick={() => choose(properties.id)}>
                  Focus on map
                </Button>
              </SidebarSection>
            )}
            {options.mode === 'models' && model && review && (
              <SidebarSection title={model.id} subtitle="Experimental reconstruction · candidate input">
                <KeyValueRows
                  size="sm"
                  rows={[
                    { label: 'Input patch area', value: `${model.area_m2} m²` },
                    {
                      label: 'Roofer / topology',
                      value: `${model.success ? 'Success' : 'Failed'} / ${model.closed_edge_incidence ? 'closed-edge check passes' : 'check failed'}`,
                    },
                    {
                      label: 'Model-to-point RMSE',
                      value: model.rmse_m === null ? 'Unavailable' : `${model.rmse_m} m (fit only)`,
                    },
                    { label: 'Roof surfaces', value: String(model.facets.length) },
                    {
                      label: 'Surface pitches',
                      value: model.facets.map((f) => `${f.pitch_deg.toFixed(1)}°`).join(', ') || 'None',
                    },
                    { label: 'Model ground elevation', value: `${model.ground_m.toFixed(2)} m CGVD2013` },
                  ]}
                />
                <Button size="sm" variant="outline" className="mt-2" onClick={() => choose(model.id)}>
                  Focus model
                </Button>
                <label className="mt-3 block text-xs">
                  Review decision
                  <NativeSelect
                    className="mt-1 w-full rounded border bg-background p-2"
                    value={review.decision}
                    onChange={(e) =>
                      save({ ...ledger, [model.id]: { ...review, decision: e.target.value as typeof review.decision } })
                    }
                  >
                    <option value="unreviewed">Unreviewed</option>
                    <option value="retain">Retain for further inspection</option>
                    <option value="reject">Reject candidate</option>
                  </NativeSelect>
                </label>
                <label className="mt-2 block text-xs">
                  Review notes
                  <textarea
                    className="mt-1 min-h-16 w-full rounded border bg-background p-2"
                    maxLength={2000}
                    value={review.note}
                    onChange={(e) => save({ ...ledger, [model.id]: { ...review, note: e.target.value } })}
                  />
                </label>
                {reviewStatus && (
                  <p className="mt-1 text-[10px]" role="status">
                    {reviewStatus}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      downloadText(
                        JSON.stringify(
                          {
                            schema_version: 1,
                            source_sha256: sourceHash,
                            candidate_sha256: data.models.candidate_sha256,
                            records: ledger,
                          },
                          null,
                          2,
                        ),
                        'building-review.json',
                        'application/json',
                      )
                    }
                  >
                    Export review
                  </Button>
                  <label className="cursor-pointer rounded border px-3 py-2 text-xs">
                    Import review
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (!file) return
                        try {
                          if (file.size > 1000000) throw Error('Review file exceeds 1 MB')
                          const next = readReviewLedger(
                            await file.text(),
                            data.models.source_sha256,
                            new Set(models.map((r) => r.id)),
                          )
                          save(next)
                        } catch (error) {
                          setReviewStatus(String(error))
                        }
                      }}
                    />
                  </label>
                </div>
              </SidebarSection>
            )}
            {options.mode !== 'models' && (
              <SidebarSection title="Method">
                <p className="text-[10px] leading-4 text-muted-foreground">{data.workflows.methods[options.mode]}</p>
              </SidebarSection>
            )}
            <SidebarSection
              title={
                options.mode === 'models'
                  ? 'All models · largest patch first'
                  : options.mode === 'gaps'
                    ? 'Openings · largest first'
                    : options.mode === 'plots'
                      ? 'Plots · highest P95 first'
                      : 'Patches · closest first'
              }
            >
              <p className="text-[10px] text-muted-foreground">
                Select on the map or below. Arrow keys move between rows. Downloads include all matching rows.
              </p>
            </SidebarSection>
            <VirtualResultList
              items={
                options.mode === 'models'
                  ? models.map((m) => ({
                      id: m.id,
                      title: m.id,
                      subtitle: `${m.area_m2} m² · ${m.facets.length} roof surfaces · ${ledger[m.id]?.decision ?? 'unreviewed'}`,
                    }))
                  : features.map((f) => ({
                      id: f.properties.id,
                      title: f.properties.id,
                      subtitle:
                        options.mode === 'gaps'
                          ? `${f.properties.area_m2} m² · ${f.properties.enclosed_candidate ? 'enclosed candidate' : 'boundary / context review'}`
                          : options.mode === 'plots'
                            ? `P95 ${f.properties.p95_m} m · ${f.properties.support_percent}% supported`
                            : `${f.properties.distance_m} m horizontal centre distance`,
                    }))
              }
              getKey={(item) => item.id}
              estimateSize={56}
              label="Workflow results"
            >
              {(item) => (
                <ResultRow
                  title={item.title}
                  subtitle={item.subtitle}
                  selected={(options.mode === 'models' ? model?.id : selected?.properties.id) === item.id}
                  onClick={() => choose(item.id)}
                />
              )}
            </VirtualResultList>
          </>
        )}
    </>
  )
}
