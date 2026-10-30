import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { NativeSelect } from '@/components/ui/form-field'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { MapSidebarShell, SidebarSection, KeyValueRows } from '@/components/ui/map-panels'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { InventoryDetail, number } from './InventoryDetail'
import { MODEL_SOURCES } from './allometry'
import type { EstimatedTree, summarizeInventory } from './summary'
import type { InventoryData, InventoryRules, TreeReview } from './types'
interface Props {
  data: InventoryData
  name: string
  sideTab: string
  setSideTab: (v: string) => void
  currentIndex: number
  rows: EstimatedTree[]
  choose: (id: string) => void
  active: EstimatedTree | null
  review: (patch: Partial<TreeReview>) => void
  rules: InventoryRules
  patch: (p: Partial<InventoryRules>) => void
  totals: ReturnType<typeof summarizeInventory>
  search: string
  setSearch: (s: string) => void
}
export function InventorySidebar({
  data,
  name,
  sideTab,
  setSideTab,
  currentIndex,
  rows,
  choose,
  active,
  review,
  rules,
  patch,
  totals,
  search,
  setSearch,
}: Props) {
  const filtered = rows.filter(
    (r) =>
      !search ||
      `${r.tree.properties.local_id} ${r.species} ${r.review.status}`.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <aside
      className="h-[35dvh] min-h-0 shrink-0 overflow-hidden border-b md:h-full md:w-[300px] md:border-b-0 md:border-r"
      aria-label="Inventory attributes and controls"
    >
      <MapSidebarShell title={name} subtitle="Run-scoped IDs · original points · explicit estimation methods">
        <SegmentedControl
          label="Inventory panel tab"
          size="sm"
          value={sideTab}
          onChange={setSideTab}
          options={[
            { value: 'tree', label: 'Tree' },
            { value: 'models', label: 'Models' },
            { value: 'list', label: 'Browse' },
            { value: 'help', label: 'Methods' },
          ]}
        />
        {sideTab === 'tree' ? (
          <>
            <div className="flex gap-2 py-2">
              <Button
                size="sm"
                variant="outline"
                disabled={currentIndex <= 0}
                onClick={() => choose(rows[currentIndex - 1].tree.properties.id)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={currentIndex < 0 || currentIndex >= rows.length - 1}
                onClick={() => choose(rows[currentIndex + 1].tree.properties.id)}
              >
                Next
              </Button>
            </div>
            <InventoryDetail row={active} onReview={review} />
          </>
        ) : sideTab === 'models' ? (
          <>
            <SidebarSection title="Exploratory models">
              <p className="mb-2 text-xs">
                Default species are stand-level VRI assumptions, not crown classifications. DBH uses published global
                allometry. These settings recalculate locally.
              </p>
              <label className="block text-xs">
                Species source
                <NativeSelect
                  aria-label="Inventory species scenario"
                  className="mt-1 w-full rounded border bg-background p-1.5"
                  value={rules.speciesMode}
                  onChange={(e) => patch({ speciesMode: e.target.value as InventoryRules['speciesMode'] })}
                >
                  <option value="vri">Assume VRI leading species per stand</option>
                  <option value="reviewed">Unknown unless reviewed</option>
                </NativeSelect>
              </label>
              {(
                [
                  { key: 'minHeight', label: 'Filter: minimum height (m)', min: 5, max: 60, step: 1 },
                  { key: 'minPoints', label: 'Minimum 3D candidate core returns', min: 0, max: 5000, step: 10 },
                  { key: 'minDbh', label: 'Minimum merchantable DBH (cm)', min: 0, max: 100, step: 0.5 },
                  { key: 'dbhFactor', label: 'DBH sensitivity multiplier', min: 0.5, max: 1.5, step: 0.05 },
                  { key: 'retention', label: 'Retained volume (%)', min: 0, max: 100, step: 5 },
                  { key: 'recovery', label: 'Recovery of remaining volume (%)', min: 0, max: 100, step: 5 },
                ] as const
              ).map((c) => (
                <NumericRangeField
                  key={c.key}
                  label={c.label}
                  layout="inline"
                  className="mt-3 space-y-0 text-xs"
                  inputClassName="mt-1 h-auto w-full"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={rules[c.key]}
                  onChange={(value) => patch({ [c.key]: value })}
                />
              ))}
              <p className="mt-2 text-[10px]">
                These controls filter saved runs and recalculate estimates; they do not rerun segmentation. Point-count
                filters apply only where assigned point counts exist. Retention and recovery are planning assumptions.
                Published volume ranges are enforced; unsupported estimates remain unavailable.
              </p>
            </SidebarSection>
            <SidebarSection title="Coverage and estimates">
              <KeyValueRows
                size="sm"
                rows={[
                  { label: 'Requested polygon', value: `${number(totals.requested_ha, 3)} ha` },
                  {
                    label: 'Supported area',
                    value: `${number(totals.covered_ha, 3)} ha (${number(totals.coverage * 100)}%)`,
                  },
                  { label: 'Boundary candidates', value: String(totals.boundary) },
                  { label: 'Excluded by reviewer', value: String(totals.excluded) },
                  { label: 'Mean observed height', value: `${number(totals.mean_height)} m` },
                  { label: 'Modelled QMD', value: `${number(totals.qmd)} cm` },
                  { label: 'Known basal area', value: `${number(totals.basal_m2_ha, 2)} m²/ha` },
                  { label: 'Known merchantable stem', value: `${number(totals.merchant_m3_ha, 2)} m³/ha` },
                ]}
              />
            </SidebarSection>
          </>
        ) : sideTab === 'list' ? (
          <SidebarSection title={`${filtered.length} of ${rows.length} candidates`}>
            <input
              aria-label="Inventory tree search"
              className="mb-2 w-full rounded border bg-background p-2 text-xs"
              placeholder="ID, species or review status"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <VirtualResultList
              items={filtered}
              getKey={(r) => r.tree.properties.id}
              estimateSize={58}
              label="Inventory tree candidates"
            >
              {(r) => (
                <button
                  className={`w-full p-2 text-left text-xs ${r === active ? 'bg-emerald-100 dark:bg-emerald-950' : ''}`}
                  onClick={() => choose(r.tree.properties.id)}
                >
                  <strong>
                    #{r.tree.properties.label} · {r.tree.properties.chunk} · {r.species}
                  </strong>
                  <span className="block">
                    {number(r.tree.properties.height_m)} m · DBH {number(r.dbh)} cm · {r.review.status}
                  </span>
                </button>
              )}
            </VirtualResultList>
          </SidebarSection>
        ) : (
          <SidebarSection title="Methods and provenance">
            <p className="text-xs leading-5">
              Snapshot {new Date(data.snapshot_utc).toLocaleString()}. All ≥5 m candidates from seven non-overlapping 50
              m cores are included. This subset is spatially selected and not representative of the whole tile. Neural
              IDs await final seam merging. Roofs and merged crowns can be candidates.
            </p>
            <p className="mt-2 text-xs leading-5">
              ForestTools {data.foresttools.version}: vwf treetops, mcws crowns and glcm texture on the native 1 m CHM
              with 16 m buffers. Three saved window functions expose parameter sensitivity. Outlines and texture are
              available; stem DBH is not measured.
            </p>
            <p className="mt-2 text-xs leading-5">
              Jucker equation 6 estimates DBH from height and equivalent-area crown diameter. That crown-width proxy and
              segmentation method can affect transfer. Its global validation scatter is not local accuracy. Nigh
              interior Tables 4/6 estimate inside-bark stem volume with no defect/product-grade model. VRI net stand
              values use different definitions.
            </p>
            <p className="mt-2 text-xs leading-5">
              FORA’s pinned runSeg also runs here with a fixed or variable mixed-forest window on all original core
              returns (1 m cell, 5 m minimum, no buffer). FORA informs linked profiles, manual attributes, return
              metrics and exports. Its Turkish-species DBH and Pinus brutia biomass equations are not applied to BC
              trees. Counts and model agreement do not establish detection accuracy or stocking compliance.
            </p>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer">Saved processing parameters</summary>
              <p className="mt-2">ForestTools window radius = slope × height + intercept. Distances in metres.</p>
              {data.methods.map((m) => (
                <div key={m.id} className="mt-2">
                  <strong>{m.name}</strong>
                  <pre className="overflow-x-auto text-[10px]">{JSON.stringify(m.parameters, null, 2)}</pre>
                </div>
              ))}
              <p className="mt-2 break-all">
                Run {data.run_id} · FORA {data.fora.commit}
              </p>
            </details>
            <div className="mt-3 space-y-2 text-xs underline">
              {Object.entries(MODEL_SOURCES).map(([name, url]) => (
                <a className="block" key={name} href={url} target="_blank" rel="noreferrer">
                  {name} · source documentation
                </a>
              ))}
              <Link className="block" to="/dev/lidar/volume/">
                BC VRI stand-volume workspace
              </Link>
              <Link className="block" to="/dev/lidar/transects/">
                Draw original-cloud transects
              </Link>
            </div>
          </SidebarSection>
        )}
      </MapSidebarShell>
    </aside>
  )
}
