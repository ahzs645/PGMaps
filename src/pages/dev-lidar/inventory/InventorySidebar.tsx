import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { SelectField } from '@/components/ui/form-field'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import {
  CollapsibleSection,
  KeyValueRows,
  MapSidebarShell,
  SearchInput,
  SidebarSection,
} from '@/components/ui/map-panels'
import { ListHeader, ListState, ResultRow } from '@/components/ui/result-list'
import { TabBar } from '@/components/ui/tab-bar'
import { ExternalLink } from '@/components/ui/text-button'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { InventoryDetail, number } from './InventoryDetail'
import { MODEL_SOURCES } from './allometry'
import { INVENTORY_REVIEW_COLOURS, type EstimatedTree, type summarizeInventory } from './summary'
import type { InventoryData, InventoryRules, TreeReview } from './types'
import { DEFAULT_LOCALE } from '@/lib/format'
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
  onClose: () => void
}
const TABS = [
  { value: 'tree', label: 'Tree' },
  { value: 'models', label: 'Models' },
  { value: 'list', label: 'Browse' },
  { value: 'help', label: 'Methods' },
]
const RULE_CONTROLS = [
  { key: 'minHeight', label: 'Filter: minimum height', min: 5, max: 60, step: 1, unit: ' m' },
  { key: 'minPoints', label: 'Minimum 3D candidate core returns', min: 0, max: 5000, step: 10, unit: '' },
  { key: 'minDbh', label: 'Minimum merchantable DBH', min: 0, max: 100, step: 0.5, unit: ' cm' },
  { key: 'dbhFactor', label: 'DBH sensitivity multiplier', min: 0.5, max: 1.5, step: 0.05, unit: '×' },
  { key: 'retention', label: 'Retained volume', min: 0, max: 100, step: 5, unit: '%' },
  { key: 'recovery', label: 'Recovery of remaining volume', min: 0, max: 100, step: 5, unit: '%' },
] as const
const LINK_CLASS = 'inline-flex text-xs font-medium text-sky-700 hover:underline dark:text-sky-400'

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
  onClose,
}: Props) {
  const filtered = rows.filter(
    (r) =>
      !search ||
      `${r.tree.properties.local_id} ${r.species} ${r.review.status}`.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <aside
      className="h-[35dvh] min-h-0 shrink-0 overflow-hidden border-b md:h-full md:w-[320px] md:border-b-0"
      aria-label="Inventory attributes and controls"
    >
      <MapSidebarShell
        title={name}
        subtitle="Run-scoped IDs · original points · explicit estimation methods"
        density="compact"
        className="shadow-none"
        headerClassName="p-3"
        titleClassName="text-sm"
        scrollClassName="overscroll-contain"
        actions={
          <Button variant="ghost" size="icon" className="size-7" aria-label="Close inventory panel" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        }
        metadata={
          <TabBar
            label="Inventory panel tab"
            idPrefix="inventory-side"
            variant="underline"
            stretch
            className="shrink-0"
            value={sideTab}
            onChange={setSideTab}
            options={TABS}
          />
        }
      >
        <div role="tabpanel" id={`inventory-side-panel-${sideTab}`} aria-labelledby={`inventory-side-tab-${sideTab}`}>
          {sideTab === 'tree' ? (
            <>
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentIndex <= 0}
                  onClick={() => choose(rows[currentIndex - 1].tree.properties.id)}
                >
                  <ChevronLeft aria-hidden="true" />
                  Previous
                </Button>
                <span className="flex-1 text-center text-xs tabular-nums text-muted-foreground">
                  {currentIndex < 0 ? '–' : `${currentIndex + 1} of ${rows.length}`}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentIndex < 0 || currentIndex >= rows.length - 1}
                  onClick={() => choose(rows[currentIndex + 1].tree.properties.id)}
                >
                  Next
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
              <InventoryDetail row={active} onReview={review} />
            </>
          ) : sideTab === 'models' ? (
            <>
              <SidebarSection
                title="Exploratory models"
                subtitle="These settings recalculate locally."
                actions={
                  <InfoTip label="About the exploratory models" tone="warning">
                    Default species are stand-level VRI assumptions, not crown classifications. DBH uses published
                    global allometry. These controls filter saved runs and recalculate estimates; they do not rerun
                    segmentation. Point-count filters apply only where assigned point counts exist. Retention and
                    recovery are planning assumptions. Published volume ranges are enforced; unsupported estimates
                    remain unavailable.
                  </InfoTip>
                }
              >
                <div className="space-y-3">
                  <SelectField
                    label="Species source"
                    aria-label="Inventory species scenario"
                    value={rules.speciesMode}
                    onChange={(e) => patch({ speciesMode: e.target.value as InventoryRules['speciesMode'] })}
                  >
                    <option value="vri">Assume VRI leading species per stand</option>
                    <option value="reviewed">Unknown unless reviewed</option>
                  </SelectField>
                  {RULE_CONTROLS.map((c) => (
                    <NumericRangeField
                      key={c.key}
                      label={c.label}
                      display={c.unit === '×' ? `×${rules[c.key]}` : `${rules[c.key]}${c.unit}`}
                      className="space-y-1 text-xs"
                      labelClassName="text-muted-foreground"
                      min={c.min}
                      max={c.max}
                      step={c.step}
                      value={rules[c.key]}
                      onChange={(value) => patch({ [c.key]: value })}
                    />
                  ))}
                </div>
              </SidebarSection>
              <SidebarSection title="Coverage and estimates">
                <KeyValueRows
                  variant="divided"
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
            <>
              <div className="border-b p-3">
                <SearchInput
                  icon
                  aria-label="Inventory tree search"
                  placeholder="ID, species or review status"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onClear={() => setSearch('')}
                />
              </div>
              <ListHeader
                count={filtered.length}
                noun={['candidate', 'candidates']}
                aside={search ? `of ${rows.length.toLocaleString(DEFAULT_LOCALE)}` : undefined}
              />
              <ListState
                empty={!filtered.length}
                emptyLabel="No candidates match this search."
                onReset={search ? () => setSearch('') : undefined}
                resetLabel="Clear search"
              >
                <VirtualResultList
                  items={filtered}
                  getKey={(r) => r.tree.properties.id}
                  estimateSize={58}
                  label="Inventory tree candidates"
                  revealKey={active?.tree.properties.id ?? null}
                >
                  {(r) => (
                    <ResultRow
                      accent="green"
                      className="py-2"
                      selected={r === active}
                      dotColor={INVENTORY_REVIEW_COLOURS[r.review.status]}
                      title={`#${r.tree.properties.label} · ${r.tree.properties.chunk} · ${r.species}`}
                      subtitle={`${number(r.tree.properties.height_m)} m · DBH ${number(r.dbh)} cm · ${r.review.status}`}
                      onClick={() => choose(r.tree.properties.id)}
                    />
                  )}
                </VirtualResultList>
              </ListState>
            </>
          ) : (
            <>
              <SidebarSection title="Methods and provenance">
                <div className="space-y-2 text-xs leading-5">
                  <p>
                    Snapshot {new Date(data.snapshot_utc).toLocaleString(DEFAULT_LOCALE)}. All ≥5 m candidates from
                    seven non-overlapping 50 m cores are included. This subset is spatially selected and not
                    representative of the whole tile. Neural IDs await final seam merging. Roofs and merged crowns can
                    be candidates.
                  </p>
                  <p>
                    ForestTools {data.foresttools.version}: vwf treetops, mcws crowns and glcm texture on the native 1 m
                    CHM with 16 m buffers. Three saved window functions expose parameter sensitivity. Outlines and
                    texture are available; stem DBH is not measured.
                  </p>
                  <p>
                    Jucker equation 6 estimates DBH from height and equivalent-area crown diameter. That crown-width
                    proxy and segmentation method can affect transfer. Its global validation scatter is not local
                    accuracy. Nigh interior Tables 4/6 estimate inside-bark stem volume with no defect/product-grade
                    model. VRI net stand values use different definitions.
                  </p>
                  <p>
                    FORA’s pinned runSeg also runs here with a fixed or variable mixed-forest window on all original
                    core returns (1 m cell, 5 m minimum, no buffer). FORA informs linked profiles, manual attributes,
                    return metrics and exports. Its Turkish-species DBH and Pinus brutia biomass equations are not
                    applied to BC trees. Counts and model agreement do not establish detection accuracy or stocking
                    compliance.
                  </p>
                </div>
              </SidebarSection>
              <CollapsibleSection label="Saved processing parameters" contentClassName="space-y-3 px-3 pb-3 text-xs">
                <p className="text-muted-foreground">
                  ForestTools window radius = slope × height + intercept. Distances in metres.
                </p>
                {data.methods.map((m) => (
                  <div key={m.id}>
                    <h3 className="mb-1 font-semibold">{m.name}</h3>
                    <KeyValueRows
                      variant="divided"
                      valueClassName="font-mono"
                      rows={Object.entries(m.parameters).map(([key, value]) => ({ key, label: key, value }))}
                    />
                  </div>
                ))}
                <p className="break-all text-muted-foreground">
                  Run {data.run_id} · FORA {data.fora.commit}
                </p>
              </CollapsibleSection>
              <SidebarSection title="Sources and related tools">
                <ul className="space-y-2">
                  {Object.entries(MODEL_SOURCES).map(([source, url]) => (
                    <li key={source}>
                      <ExternalLink href={url}>{source} · source documentation</ExternalLink>
                    </li>
                  ))}
                  <li>
                    <Link className={LINK_CLASS} to="/dev/lidar/volume/">
                      BC VRI stand-volume workspace
                    </Link>
                  </li>
                  <li>
                    <Link className={LINK_CLASS} to="/dev/lidar/transects/">
                      Draw original-cloud transects
                    </Link>
                  </li>
                </ul>
              </SidebarSection>
            </>
          )}
        </div>
      </MapSidebarShell>
    </aside>
  )
}
