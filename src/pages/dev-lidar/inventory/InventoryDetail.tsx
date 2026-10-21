import { SidebarSection, KeyValueRows } from '@/components/ui/map-panels'
import { Badge } from '@/components/ui/badge'
import { SPECIES_NAMES } from './allometry'
import type { EstimatedTree } from './summary'
import type { TreeReview } from './types'
export const number = (v: number | null | undefined, digits = 1) =>
  v == null ? 'Unavailable' : v.toLocaleString(undefined, { maximumFractionDigits: digits })
export function InventoryDetail({
  row,
  onReview,
}: {
  row: EstimatedTree | null
  onReview: (patch: Partial<TreeReview>) => void
}) {
  if (!row) return <p className="p-3 text-xs">Select a crown to inspect its attributes.</p>
  const p = row.tree.properties
  return (
    <>
      <SidebarSection title={`Candidate #${p.label}`}>
        <p className="break-all text-[10px] text-muted-foreground">{p.id}</p>
        <Badge tone="warning">Provisional core-local identity</Badge>
        <KeyValueRows
          size="sm"
          rows={[
            { label: 'Observed maximum height', value: `${number(p.height_m)} m` },
            { label: 'Point-height p95', value: p.p95_m === null ? 'Not calculated' : `${number(p.p95_m)} m` },
            { label: 'Crown / point-envelope area', value: `${number(p.crown_area_m2)} m²` },
            { label: 'Equivalent-area diameter', value: `${number(p.crown_diameter_m)} m` },
            {
              label: 'Original assigned core returns',
              value: p.point_count === null ? '2D crown segmentation' : number(p.point_count, 0),
            },
            { label: 'Terrain elevation at apex', value: `${number(p.ground_m)} m` },
            { label: 'Terrain slope / aspect', value: `${number(p.slope_deg)}° / ${number(p.aspect_deg, 0)}°` },
            { label: 'GLCM entropy', value: number(p.texture_entropy, 2) },
            {
              label: 'Search-window radius (not crown)',
              value:
                p.detection_window_radius_m === null ? 'Not applicable' : `${number(p.detection_window_radius_m)} m`,
            },
            { label: 'Returns at 0.8–1.8 m', value: number(p.breast_height_returns, 0) },
            { label: 'Predicted stem returns in band', value: number(p.stem_band_returns, 0) },
          ]}
        />
        <p className="mt-2 text-[10px]">
          Outline: {p.geometry_method}. Location is a canopy-apex proxy.{' '}
          {p.boundary && (
            <strong>
              Boundary candidate: neural returns may be clipped; surface crown may extend outside the core.
            </strong>
          )}
        </p>
      </SidebarSection>
      <SidebarSection title="Species, DBH and volume">
        <KeyValueRows
          size="sm"
          rows={[
            { label: 'Species', value: SPECIES_NAMES[row.species] ?? row.species },
            { label: 'Species source', value: row.speciesSource },
            { label: 'DBH', value: `${number(row.dbh)} cm` },
            { label: 'DBH source', value: row.dbhSource },
            {
              label: 'DBH sensitivity bracket',
              value:
                row.review.dbh_cm !== null
                  ? 'User value; measurement error unspecified'
                  : `${number(row.dbhRange[0])}–${number(row.dbhRange[1])} cm`,
            },
            { label: 'Basal area', value: `${number(row.basal, 3)} m²` },
            { label: 'Modelled total stem, inside bark', value: `${number(row.total, 3)} m³` },
            { label: 'Modelled merchantable stem', value: `${number(row.merchant, 3)} m³` },
          ]}
        />
        <p className="mt-2 text-[10px] leading-4">
          {row.status}. The sensitivity bracket uses published global diameter scatter, not a local confidence interval.
          Merchantable uses a 0.3 m stump and 4 cm inside-bark top, with no defect deductions.
        </p>
        <p className="mt-2 text-[10px]">
          VRI stand {p.vri_id ?? 'unavailable'}: leading species {p.vri_species ?? 'unknown'} (
          {number(p.vri_species_pct, 0)}%); net stand volume {number(p.vri_net_m3_ha)} m³/ha. Stand values are context,
          not individual-tree measurements.
        </p>
      </SidebarSection>
      <SidebarSection title="Review this candidate">
        <div className="space-y-2 text-xs">
          <label className="block">
            Decision
            <select
              aria-label="Inventory review status"
              className="mt-1 w-full rounded border bg-background p-1.5"
              value={row.review.status}
              onChange={(e) => onReview({ status: e.target.value as TreeReview['status'] })}
            >
              <option value="unreviewed">Unreviewed</option>
              <option value="accepted">Accept candidate</option>
              <option value="excluded">Exclude from summaries</option>
              <option value="split">Suspected split</option>
              <option value="merged">Suspected merged crowns</option>
            </select>
          </label>
          <label className="block">
            Species assignment
            <select
              aria-label="Inventory reviewed species"
              className="mt-1 w-full rounded border bg-background p-1.5"
              value={row.review.species}
              onChange={(e) => onReview({ species: e.target.value })}
            >
              <option value="">Use selected scenario</option>
              {Object.entries(SPECIES_NAMES).map(([code, name]) => (
                <option key={code} value={code}>
                  {code} · {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            User-entered DBH (cm)
            <input
              aria-label="Inventory entered DBH"
              className="mt-1 w-full rounded border bg-background p-1.5"
              type="number"
              min="0.1"
              max="500"
              step="0.1"
              value={row.review.dbh_cm ?? ''}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!e.target.value) onReview({ dbh_cm: null })
                else if (Number.isFinite(n) && n > 0 && n <= 500) onReview({ dbh_cm: n })
              }}
            />
          </label>
          <label className="block">
            Review note
            <textarea
              aria-label="Inventory review note"
              maxLength={5000}
              className="mt-1 w-full rounded border bg-background p-1.5"
              value={row.review.note}
              onChange={(e) => onReview({ note: e.target.value })}
            />
          </label>
          <p className="text-[10px]">
            Stored in this browser and scoped to this source/run. Review changes do not edit the original point labels.
          </p>
        </div>
      </SidebarSection>
    </>
  )
}
