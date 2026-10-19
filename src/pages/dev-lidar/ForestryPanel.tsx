import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SidebarSection, KeyValueRows } from '@/components/ui/map-panels'
import { ResultRow } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { downloadText } from '@/lib/download'
import { featureCentre, type WorkflowFeature, type WorkflowOptions } from './analysisWorkflows'
import {
  compareForestPlots,
  forestShortlist,
  forestValue,
  FOREST_PALETTES,
  profilePercentages,
  type ForestData,
  type ForestMode,
  type ForestProperties,
} from './forestry'

interface Props {
  data: ForestData
  options: WorkflowOptions
  features: WorkflowFeature[]
  selectedId: string | null
  onOptions: (options: Partial<WorkflowOptions>) => void
  onSelect: (id: string) => void
  onPoints: (plot: ForestProperties) => void
}
export function ForestryPanel({ data, options, features, selectedId, onOptions, onSelect, onPoints }: Props) {
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [shortlistOnly, setShortlistOnly] = useState(false)
  const byId = useMemo(() => new Map(data.plots.features.map((f) => [f.properties.id, f])), [data])
  const selected = byId.get(selectedId ?? '') ?? byId.get(features[0]?.properties.id)
  const pinned = pinnedId ? byId.get(pinnedId) : null
  const shortlist = useMemo(() => forestShortlist(data, options), [data, options])
  const rows = shortlistOnly ? shortlist : features
  const mode = options.mode as ForestMode
  const palette = FOREST_PALETTES[mode]
  const value = (p: ForestProperties) => forestValue(p, options)
  const format = (n: number | null) =>
    n === null
      ? 'No data'
      : `${n.toFixed(mode === 'strata' ? 3 : 1)}${mode === 'texture' ? ' m' : mode === 'edges' ? '%' : ''}`
  const profile = selected?.properties.profiles[options.returnMode]
  const currentPercent = profile ? profilePercentages(profile) : []
  const pinnedProfile = pinned?.properties.profiles[options.returnMode]
  const pinnedPercent = pinnedProfile ? profilePercentages(pinnedProfile) : []
  const exportResults = () =>
    downloadText(
      JSON.stringify(
        {
          type: 'FeatureCollection',
          features: rows,
          metadata: {
            source_sha256: data.source_sha256,
            input_sha256: data.input_sha256,
            options,
            method: data.methods[mode],
            selection: shortlistOnly ? 'spatially spread high-value field-check candidates' : 'filtered plots',
            limitations: data.limitations,
          },
        },
        null,
        2,
      ),
      `forestry-${mode}${shortlistOnly ? '-field-checks' : ''}.geojson`,
      'application/geo+json',
    )
  const exportVisits = () => {
    const csv = [
      'id,longitude,latitude,metric,metric_value,eligible_m2,canopy_percent,ground_support_p95_m,return_selection,edge_distance_m,eligible_min_percent,canopy_min_percent,source_sha256',
    ]
    for (const f of shortlist) {
      const p = byId.get(f.properties.id)!.properties,
        [lon, lat] = featureCentre(f)
      csv.push(
        [
          p.id,
          lon.toFixed(7),
          lat.toFixed(7),
          mode,
          value(p),
          p.sampled_m2,
          p.canopy_percent,
          p.ground_support_p95_m,
          options.returnMode,
          options.edgeDistance,
          options.support,
          options.canopyMinimum,
          data.source_sha256,
        ].join(','),
      )
    }
    downloadText(csv.join('\n') + '\n', `forestry-${mode}-field-checks.csv`, 'text/csv')
  }
  return (
    <>
      <SidebarSection title="Explore forest structure" subtitle="50 × 50 m plots · roof patches + 2 m excluded">
        <p className="text-xs leading-5 text-muted-foreground">
          {mode === 'strata'
            ? 'Look beneath the tallest crowns: compare the distribution of original returns across six height bands. Low-layer returns can guide an understory field check.'
            : mode === 'texture'
              ? 'Find smooth versus varied canopy surfaces. The map summarizes 5 m height variability, so individual crowns and opening transitions contribute.'
              : `Find taller canopy near low openings or in a possible interior. The ${options.edgeDistance} m distance is a screening choice; tile boundaries never count as confirmed interior.`}
        </p>
        <div className="mt-3 space-y-3 text-xs">
          {
            <label className="block">
              Return selection
              <select
                aria-label="Forestry return selection"
                className="mt-1 w-full rounded border bg-background p-2"
                value={options.returnMode}
                onChange={(e) => onOptions({ returnMode: e.target.value as 'all' | 'first' })}
              >
                <option value="all">All accepted returns</option>
                <option value="first">First returns only</option>
              </select>
            </label>
          }
          {mode === 'edges' && (
            <label className="block">
              Edge / interior distance
              <select
                aria-label="Canopy edge distance"
                className="mt-1 w-full rounded border bg-background p-2"
                value={options.edgeDistance}
                onChange={(e) => onOptions({ edgeDistance: Number(e.target.value) as 10 | 20 | 30 })}
              >
                <option value={10}>10 m</option>
                <option value={20}>20 m</option>
                <option value={30}>30 m</option>
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label>
              Eligible coverage
              <select
                aria-label="Forestry eligible coverage"
                className="mt-1 w-full rounded border bg-background p-2"
                value={options.support}
                onChange={(e) => onOptions({ support: Number(e.target.value), selectedId: null })}
              >
                <option value={0}>All plots</option>
                <option value={80}>≥80%</option>
                <option value={95}>≥95%</option>
                <option value={100}>100%</option>
              </select>
            </label>
            <label>
              Canopy proxy
              <select
                aria-label="Minimum canopy proxy"
                className="mt-1 w-full rounded border bg-background p-2"
                value={options.canopyMinimum}
                onChange={(e) => onOptions({ canopyMinimum: Number(e.target.value), selectedId: null })}
              >
                <option value={0}>Any cover</option>
                <option value={40}>≥40%</option>
                <option value={70}>≥70%</option>
              </select>
            </label>
          </div>
        </div>
        <div className="mt-3" aria-label="Forestry map legend">
          <div
            className="h-2 rounded"
            style={{ background: `linear-gradient(to right,${palette.colors.join(',')})` }}
          />
          <p className="mt-1 text-[10px]">{palette.label}</p>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          Eligible coverage excludes unsupported terrain and roof buffers. Canopy proxy is the share of eligible surface
          cells above 5 m. It is not an authoritative forest mask.
        </p>
        <p role="status" className="mt-3 text-xs font-medium">
          {features.length} matching plots · ranked by{' '}
          {mode === 'strata' ? 'return-height dispersion' : mode === 'texture' ? 'surface texture' : 'interior proxy'}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={features.length < 2}
            onClick={() => {
              setPinnedId(features[features.length - 1].properties.id)
              onSelect(features[0].properties.id)
            }}
          >
            Compare high vs low
          </Button>
          <Button size="sm" variant="outline" disabled={!rows.length} onClick={exportResults}>
            Download shown GeoJSON
          </Button>
        </div>
      </SidebarSection>
      {selected && profile && (
        <SidebarSection title={selected.properties.id} subtitle="Selected plot A">
          <KeyValueRows
            size="sm"
            rows={[
              {
                label:
                  mode === 'strata'
                    ? 'Return-height entropy'
                    : mode === 'texture'
                      ? 'Mean local surface SD'
                      : 'Interior proxy',
                value: format(value(selected.properties)),
              },
              {
                label: 'Eligible area / coverage',
                value: `${selected.properties.sampled_m2} m² / ${selected.properties.support_percent}%`,
              },
              { label: 'Taller canopy proxy', value: `${selected.properties.canopy_percent}%` },
              {
                label: 'Surface P95 / SD',
                value: `${selected.properties.surface_p95_m} / ${selected.properties.surface_sd_m} m`,
              },
              { label: 'Ground-support P95', value: `${selected.properties.ground_support_p95_m} m` },
              { label: 'Accepted returns', value: profile.returns.toLocaleString() },
              {
                label: '2–5 m share of ≥2 m returns',
                value:
                  profile.low_layer_percent === null
                    ? 'No elevated returns'
                    : `${profile.low_layer_percent.toFixed(1)}%`,
              },
            ]}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onSelect(selected.properties.id)}>
              Focus plot
            </Button>
            <Button size="sm" variant="outline" onClick={() => onPoints(selected.properties)}>
              Inspect 3D points
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPinnedId(selected.properties.id)}>
              Pin as comparison B
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Original 3D points include all source classes and nearby roofs; analytical exclusions apply to metrics only.
          </p>
          <h3 className="mt-4 text-xs font-medium">Vertical return fingerprint</h3>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Share of {options.returnMode === 'all' ? 'all accepted' : 'first'} returns, including ground. A: green
            {pinned ? ' · B: blue' : ''}. Not vegetation volume or stem counts.
          </p>
          <div
            className="mt-2 space-y-2"
            role="img"
            aria-label="Vertical return profile of selected and comparison plots"
          >
            {data.bands.map((label, i) => (
              <div key={label} className="text-[10px]">
                <div className="flex justify-between">
                  <span>{label}</span>
                  <span className="tabular-nums">
                    A {currentPercent[i].toFixed(1)}%{pinned ? ` · B ${pinnedPercent[i].toFixed(1)}%` : ''}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-muted">
                  <div className="h-full rounded bg-emerald-600" style={{ width: `${currentPercent[i]}%` }} />
                </div>
                {pinned && (
                  <div className="mt-0.5 h-1.5 rounded bg-muted">
                    <div className="h-full rounded bg-blue-500" style={{ width: `${pinnedPercent[i]}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            0–2 m mixes terrain and low objects. Multiple returns and canopy occlusion affect the profile. First-return
            mode shows a different sampling view, not another survey or an accuracy check.
          </p>
          {mode === 'edges' && (
            <div className="mt-4">
              <h3 className="text-xs font-medium">Taller-canopy partition</h3>
              <KeyValueRows
                className="mt-2"
                size="sm"
                rows={['Near known opening', 'Interior proxy', 'Censored boundary'].map((label, i) => ({
                  label,
                  value:
                    selected.properties[`edge_${options.edgeDistance}`].percent[i] === null
                      ? 'No taller canopy'
                      : `${selected.properties[`edge_${options.edgeDistance}`].percent[i]!.toFixed(1)}%`,
                }))}
              />
              <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                Censored means the tile, roof buffer or missing terrain prevents an interior claim. Low openings may be
                roads, fields or gaps.
              </p>
            </div>
          )}
          {pinned && (
            <div className="mt-4 rounded border p-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-xs font-medium">B · {pinned.properties.id}</h3>
                <Button size="sm" variant="ghost" onClick={() => setPinnedId(null)}>
                  Clear
                </Button>
              </div>
              <p className="mt-1 text-xs">
                A − B:{' '}
                {mode === 'edges'
                  ? `${compareForestPlots(selected.properties, pinned.properties, mode, options)?.toFixed(1) ?? 'No data'} percentage points`
                  : format(compareForestPlots(selected.properties, pinned.properties, mode, options))}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Comparison B stays pinned if a filter hides it. These are structural differences, not evidence that one
                plot is healthier or older.
              </p>
            </div>
          )}
        </SidebarSection>
      )}
      <SidebarSection title="Plan a field check" subtitle="Explore extremes, then verify on the ground">
        <p className="text-xs leading-5 text-muted-foreground">
          The shortlist takes up to eight high-value plots, spaced by at least 100 m between plot centres. It is an
          exploratory visit list, not a representative inventory sample or a safe access route.
        </p>
        <label className="mt-3 flex gap-2 text-xs">
          <input type="checkbox" checked={shortlistOnly} onChange={(e) => setShortlistOnly(e.target.checked)} />
          Show shortlist in the result list
        </label>
        <Button size="sm" variant="outline" className="mt-2" disabled={!shortlist.length} onClick={exportVisits}>
          Download field-check CSV
        </Button>
        <p className="mt-2 text-[10px] text-muted-foreground">
          The map keeps every matching plot visible; the shortlist changes the list and exports. Site access and hazards
          need separate planning.
        </p>
      </SidebarSection>
      <SidebarSection title="What to look for">
        <p className="text-xs leading-5 text-muted-foreground">
          {mode === 'strata'
            ? 'Compare high and low dispersion, then check whether the lower returns are regeneration, shrubs, branches or other objects. Add field observations before interpreting understory stocking.'
            : mode === 'texture'
              ? 'Compare smooth tall canopy with textured canopy. Check whether the variation comes from crown sizes, mixed layers, openings, retained trees or unrecognized structures. Texture alone does not establish stand age or species.'
              : 'Compare edge-dominated and interior-like plots. Record the opening type and verify missing boundary areas. These distances describe spatial context, not windthrow, microclimate or habitat suitability predictions.'}
        </p>
      </SidebarSection>
      <SidebarSection title="Method & evidence">
        <p className="text-[10px] leading-4 text-muted-foreground">{data.methods[mode]}</p>
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer">Data limits and research</summary>
          <ul className="mt-2 list-disc space-y-2 pl-4 text-[10px] leading-4 text-muted-foreground">
            {data.limitations.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <a
            className="mt-3 block underline"
            href="https://r-lidar.github.io/lidRbook/metrics.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            lidR: point-cloud metrics ↗
          </a>
          <a
            className="mt-2 block underline"
            href="https://lidar.pages-forge.inrae.fr/lidaRtRee/articles/forest.structure.metrics.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            INRAE: structure, gaps and edges ↗
          </a>
        </details>
      </SidebarSection>
      <SidebarSection title={shortlistOnly ? 'Field-check shortlist' : 'Matching plots · highest metric first'}>
        <p className="text-[10px] text-muted-foreground">
          Select on the map or below. Pin one plot, then choose another to compare profiles.
        </p>
      </SidebarSection>
      <VirtualResultList items={rows} getKey={(f) => f.properties.id} estimateSize={56} label="Forestry plot results">
        {(feature) => {
          const p = byId.get(feature.properties.id)!.properties
          return (
            <ResultRow
              title={p.id}
              subtitle={`${format(value(p))} · ${p.canopy_percent}% canopy proxy`}
              selected={selected?.properties.id === p.id}
              onClick={() => onSelect(p.id)}
            />
          )
        }}
      </VirtualResultList>
    </>
  )
}
