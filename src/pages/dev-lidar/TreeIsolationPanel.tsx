import { Button } from '@/components/ui/button'
import { SidebarSection, KeyValueRows } from '@/components/ui/map-panels'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { ResultRow } from '@/components/ui/result-list'
import { downloadText } from '@/lib/download'
import type { WorkflowFeature, WorkflowOptions } from './analysisWorkflows'
import { treeCropCSV, type CrownFeature, type TreeCrop, type TreeIsolation } from './treeIsolation'
import { TreeProfilePanel } from './TreeProfilePanel'
export interface TreePanelData {
  data: TreeIsolation | null
  error: string
  retry: () => void
  crop: TreeCrop | null
  cropError: string
  cropStatus: string
  retryCrop: () => void
}
export function TreeIsolationPanel({
  product,
  options,
  features,
  selected,
  onOptions,
  onSelect,
  onIsolate,
  onAll,
}: {
  product: TreePanelData
  options: WorkflowOptions
  features: WorkflowFeature[]
  selected: CrownFeature | null
  onOptions: (o: Partial<WorkflowOptions>) => void
  onSelect: (id: string) => void
  onIsolate: () => void
  onAll: () => void
}) {
  const p = selected?.properties,
    crop = product.crop
  return (
    <>
      <SidebarSection title="Tree crowns & isolation" subtitle="Detected crown candidates · original-return inspection">
        {!product.data ? (
          <>
            <p className="text-xs" role="status">
              {product.error || 'Loading and checking crown footprints…'}
            </p>
            {product.error && (
              <Button size="sm" onClick={product.retry}>
                Retry
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="text-xs leading-5">
              {product.data.crowns.features.length.toLocaleString()} candidate crowns were separated from the 1 m LiDAR
              height surface. Colours help distinguish candidates; they do not indicate species. Click a footprint or
              treetop to select it.
            </p>
            <label className="mt-3 block text-xs">
              Minimum candidate height · {options.treeMinimum} m
              <input
                aria-label="Minimum tree candidate height"
                className="mt-1 w-full"
                type="range"
                min={5}
                max={50}
                step={1}
                value={options.treeMinimum}
                onChange={(e) => onOptions({ treeMinimum: Number(e.target.value), selectedId: null })}
              />
            </label>
            <label className="mt-3 block text-xs">
              Minimum crown area
              <select
                aria-label="Minimum crown area"
                className="mt-1 w-full rounded border bg-background p-2"
                value={options.treeAreaMinimum}
                onChange={(e) => onOptions({ treeAreaMinimum: Number(e.target.value), selectedId: null })}
              >
                {[4, 10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} m²
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 flex gap-2 text-xs">
              <input
                type="checkbox"
                checked={options.treeHideEdge}
                onChange={(e) => onOptions({ treeHideEdge: e.target.checked, selectedId: null })}
              />
              Hide tile-edge candidates
            </label>
            <p className="mt-3 text-xs font-medium" role="status">
              {features.length.toLocaleString()} matching crown candidates
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onAll}>
                Show all crowns
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!features.length}
                onClick={() =>
                  downloadText(
                    JSON.stringify({
                      type: 'FeatureCollection',
                      features,
                      metadata: {
                        source_sha256: product.data!.source_sha256,
                        input_sha256: product.data!.input_sha256,
                        options,
                        status:
                          'Unvalidated dominant crown candidates; display footprints simplified 0.7 m; metric areas use exact source cells',
                      },
                    }),
                    'tree-crown-candidates.geojson',
                    'application/geo+json',
                  )
                }
              >
                Download shown crowns
              </Button>
            </div>
          </>
        )}
      </SidebarSection>
      <TreeProfilePanel
        crop={crop}
        sourceHash={product.data?.source_sha256 ?? ''}
        selectedId={p?.id}
        loading={options.treeShowPoints && !crop && !product.cropError}
        onLoad={onIsolate}
      />
      {p && (
        <SidebarSection title={p.id} subtitle="Selected crown · unvalidated tree candidate">
          <KeyValueRows
            size="sm"
            rows={[
              { label: 'Height at detected top', value: `${p.height_m.toFixed(2)} m above terrain` },
              { label: 'Crown source-cell area', value: `${p.crown_area_m2.toFixed(0)} m²` },
              { label: 'Ground support at top', value: `${p.ground_support_m.toFixed(1)} m` },
              { label: 'Tile-edge flag', value: p.edge ? 'Yes · potentially truncated' : 'No' },
              { label: 'Treetop longitude', value: p.centre[0].toFixed(7) },
              { label: 'Treetop latitude', value: p.centre[1].toFixed(7) },
            ]}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={onIsolate}>
              Isolate original returns in 3D
            </Button>
            <Button size="sm" variant="outline" onClick={() => onSelect(p.id)}>
              Focus crown on map
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            This loads a bounded subset from the original EPT cloud, then keeps returns 2–80 m above terrain in this
            crown’s exact 1 m columns. Ground/noise classes are excluded. A crown column can contain neighbouring
            branches or understory.
          </p>
          {options.treeShowPoints && (
            <>
              <p className="mt-3 text-xs" role="status">
                {product.cropError || product.cropStatus || 'Preparing original-return crop…'}
              </p>
              {product.cropError && (
                <Button size="sm" variant="outline" onClick={product.retryCrop}>
                  Retry point isolation
                </Button>
              )}
            </>
          )}
          {crop && (
            <>
              <p className="mt-2 text-xs">
                {crop.points.length.toLocaleString()} isolated returns · {crop.loaded_nodes}/{crop.available_nodes}{' '}
                intersecting EPT nodes loaded.
              </p>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {crop.budget_limited
                  ? 'Point budget or hierarchy limits apply; this is a partial crop.'
                  : 'All selected intersecting nodes loaded; segmentation validity remains unverified.'}{' '}
                {crop.withheld_filtered
                  ? 'Withheld flags were screened.'
                  : 'Withheld flags were unavailable in the decoded stream; class screening still applies.'}
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => {
                  downloadText(treeCropCSV(crop), `${crop.id}-original-returns.csv`, 'text/csv')
                  downloadText(
                    JSON.stringify(
                      {
                        ...crop,
                        points: undefined,
                        method:
                          'Original EPT returns cropped by exact watershed crown-cell columns; normalized using source 1 m DTM; classes 2/7/12/18 excluded; available withheld/overlap flags screened',
                      },
                      null,
                      2,
                    ),
                    `${crop.id}-crop-provenance.json`,
                    'application/json',
                  )
                }}
              >
                Download isolated returns CSV
              </Button>
            </>
          )}
        </SidebarSection>
      )}
      <SidebarSection title="Candidate crowns" subtitle="Select from the map or list · highest candidates first">
        {!features.length && product.data && <p className="text-xs">No matches. Broaden the height or area filters.</p>}
        <VirtualResultList
          items={features}
          getKey={(f) => f.properties.id}
          label="Tree crown candidates"
          estimateSize={60}
        >
          {(f) => (
            <ResultRow
              title={f.properties.id}
              subtitle={`${f.properties.map_value?.toFixed(1)} m above terrain`}
              selected={p?.id === f.properties.id}
              onClick={() => onSelect(f.properties.id)}
            />
          )}
        </VirtualResultList>
      </SidebarSection>
      <SidebarSection title="What a crown candidate means">
        <p className="text-xs leading-5">
          Local maxima seed a watershed over the height surface. One crown may split into several candidates,
          neighbouring crowns may merge, and small or suppressed trees may be missed. These are not confirmed stems,
          complete trees, species labels, DBH or a validated tree count.
        </p>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Footprints are simplified for display; point selection uses exact source-cell membership. The source points
          retain their original orthometric elevations; the 3D view shifts the selected treetop’s ground to zero for
          display.
        </p>
      </SidebarSection>
    </>
  )
}
