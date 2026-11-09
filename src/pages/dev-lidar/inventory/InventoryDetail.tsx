import { FORM_INPUT_CLASS, FormField, NullableNumberField, SelectField } from '@/components/ui/form-field'
import { InlineAlert, SidebarSection, KeyValueRows } from '@/components/ui/map-panels'
import { EmptyHint } from '@/components/ui/result-list'
import { Badge } from '@/components/ui/badge'
import { InfoTip } from '@/components/ui/info-tip'
import { formatNumber } from '@/lib/format'
import { SPECIES_NAMES } from './allometry'
import type { EstimatedTree } from './summary'
import type { TreeReview } from './types'
export const number = (v: number | null | undefined, digits = 1) =>
  formatNumber(v, { maximumFractionDigits: digits, fallback: 'Unavailable' })
export function InventoryDetail({
  row,
  onReview,
}: {
  row: EstimatedTree | null
  onReview: (patch: Partial<TreeReview>) => void
}) {
  if (!row)
    return (
      <div className="p-3">
        <EmptyHint>Select a crown to inspect its attributes.</EmptyHint>
      </div>
    )
  const p = row.tree.properties
  return (
    <>
      <SidebarSection title={`Candidate #${p.label}`} subtitle={<span className="break-all">{p.id}</span>}>
        <Badge tone="warning" className="mb-2">
          Provisional core-local identity
        </Badge>
        <KeyValueRows
          variant="divided"
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
        <p className="mt-2 text-xs text-muted-foreground">
          Outline: {p.geometry_method}. Location is a canopy-apex proxy.
        </p>
        {p.boundary && (
          <InlineAlert tone="warning" className="mt-2" title="Boundary candidate">
            Neural returns may be clipped; surface crown may extend outside the core.
          </InlineAlert>
        )}
      </SidebarSection>
      <SidebarSection
        title="Species, DBH and volume"
        actions={
          <InfoTip label="About these estimates">
            The sensitivity bracket uses published global diameter scatter, not a local confidence interval.
            Merchantable uses a 0.3 m stump and 4 cm inside-bark top, with no defect deductions.
          </InfoTip>
        }
      >
        <KeyValueRows
          variant="divided"
          rows={[
            { label: 'Volume model', value: row.status },
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
        <p className="mt-2 text-xs text-muted-foreground">
          VRI stand {p.vri_id ?? 'unavailable'}: leading species {p.vri_species ?? 'unknown'} (
          {number(p.vri_species_pct, 0)}%); net stand volume {number(p.vri_net_m3_ha)} m³/ha. Stand values are context,
          not individual-tree measurements.
        </p>
      </SidebarSection>
      <SidebarSection title="Review this candidate">
        <div className="space-y-3">
          <SelectField
            label="Decision"
            aria-label="Inventory review status"
            value={row.review.status}
            onChange={(e) => onReview({ status: e.target.value as TreeReview['status'] })}
          >
            <option value="unreviewed">Unreviewed</option>
            <option value="accepted">Accept candidate</option>
            <option value="excluded">Exclude from summaries</option>
            <option value="split">Suspected split</option>
            <option value="merged">Suspected merged crowns</option>
          </SelectField>
          <SelectField
            label="Species assignment"
            aria-label="Inventory reviewed species"
            value={row.review.species}
            onChange={(e) => onReview({ species: e.target.value })}
          >
            <option value="">Use selected scenario</option>
            {Object.entries(SPECIES_NAMES).map(([code, name]) => (
              <option key={code} value={code}>
                {code} · {name}
              </option>
            ))}
          </SelectField>
          <NullableNumberField
            label="User-entered DBH"
            unit="cm"
            aria-label="Inventory entered DBH"
            min={0.1}
            max={500}
            step={0.1}
            clampOn="never"
            value={row.review.dbh_cm ?? null}
            onValueChange={(value) => {
              if (value === null || (value > 0 && value <= 500)) onReview({ dbh_cm: value })
            }}
          />
          <FormField
            label="Review note"
            description="Stored in this browser and scoped to this source/run. Review changes do not edit the original point labels."
          >
            <textarea
              aria-label="Inventory review note"
              maxLength={5000}
              rows={3}
              className={FORM_INPUT_CLASS}
              value={row.review.note}
              onChange={(e) => onReview({ note: e.target.value })}
            />
          </FormField>
        </div>
      </SidebarSection>
    </>
  )
}
