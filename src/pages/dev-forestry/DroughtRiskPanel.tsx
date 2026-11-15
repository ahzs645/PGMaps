import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { SelectField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolDisclosure } from '@/components/ui/tool-section'
import {
  PUBLISHED_PERIODS,
  PUBLISHED_SOURCE,
  RISK_LEVELS,
  SOIL_MOISTURE_REGIMES,
  TREE_SPECIES,
  type PublishedDataset,
  type PublishedPeriod,
  type RiskCode,
  type SoilMoistureRegime,
} from '@/features/forest-drought/published'
import { loadPublishedDataset } from '@/features/forest-drought/publishedLoader'
import { clampVegetationBounds, fetchVegetationStands } from './bcVegetationInventory'
import {
  DROUGHT_BASELINE_PERIOD,
  droughtReading,
  droughtRiskLink,
  fetchBecPolygons,
  landformStand,
  type LandformStand,
} from './droughtRisk'
import { canonicalInput } from './integrity'
import { formatPct } from './measureFormat'
import { digest } from './runRevision'
import type { TargetPolygon } from './types'
import { polygonBounds } from './visibility'

const RISK_TONES: Record<RiskCode, BadgeTone> = { L: 'success', M: 'warning', H: 'orange', VH: 'danger' }
const riskLabel = (code: RiskCode) => RISK_LEVELS.find((item) => item.code === code)?.label ?? code
const speciesName = (code: string) => TREE_SPECIES.find((s) => s.code === code)?.name ?? code
const periodLabel = (id: PublishedPeriod) => PUBLISHED_PERIODS.find((p) => p.id === id)?.label ?? id
const PROJECTIONS = PUBLISHED_PERIODS.filter((p) => p.kind === 'projection')
/** A share as a whole percent, with a trace shown as "<1%" rather than "0%". */
const share = (fraction: number) => (fraction > 0 && fraction < 0.005 ? '<1%' : formatPct(fraction * 100, 0))
/** The years a period covers, e.g. "2071–2100", for running text. */
const periodYears = (id: PublishedPeriod) => {
  const years = PUBLISHED_PERIODS.find((p) => p.id === id)?.years
  return years ? `${years[0]}–${years[1]}` : id
}

type ReadState =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'error'; key: string; error: string }
  | { status: 'ready'; key: string; stand: LandformStand; truncated: boolean; clipped: boolean }

/**
 * Step 3's drought context for the landform's standing timber: forDRAT's published mortality risk
 * for the treed species under the landform, in the BEC unit and soil moisture regime chosen.
 * Context only: never a run input, a mask or a green-up change (`droughtRisk.ts`).
 */
export function DroughtRiskPanel({ landform }: { landform: TargetPolygon | null }) {
  // Keyed to the landform's shape, so a rename or recolour never reads again, and a reshaped one asks to.
  const key = useMemo(() => (landform ? digest(canonicalInput(landform.geometry)) : null), [landform])
  const [state, setState] = useState<ReadState>({ status: 'idle' })
  const [dataset, setDataset] = useState<PublishedDataset | null>(null)
  const [chosenUnit, setUnit] = useState('')
  const [smr, setSmr] = useState<SoilMoistureRegime | ''>('')
  const [period, setPeriod] = useState<PublishedPeriod>('2050')
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const read = () => {
    if (!landform || !key) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setState({ status: 'loading', key })
    const bounds = polygonBounds(landform.geometry)
    const vegetationBounds = clampVegetationBounds(bounds)
    Promise.all([
      fetchVegetationStands(vegetationBounds, { signal: controller.signal }),
      fetchBecPolygons(bounds, fetch, controller.signal),
      dataset ?? loadPublishedDataset(controller.signal),
    ])
      .then(([vegetation, bec, table]) => {
        if (controller.signal.aborted) return
        setDataset(table)
        if (!bec.length) throw new Error('The BEC map returned no unit under this landform.')
        const stand = landformStand(landform.geometry, vegetation.stands, bec)
        setState({
          status: 'ready',
          key,
          stand,
          truncated: vegetation.truncated,
          clipped: vegetationBounds !== bounds,
        })
        setUnit('')
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', key, error: cause instanceof Error ? cause.message : String(cause) })
      })
  }

  const current = state.status !== 'idle' && state.key === key ? state : null
  const stand = current?.status === 'ready' ? current.stand : null
  const inTable = (label: string) => !!dataset?.bgcUnits.includes(label)
  const unit =
    chosenUnit && stand?.becUnits.some((u) => u.label === chosenUnit)
      ? chosenUnit
      : (stand?.becUnits.find((u) => inTable(u.label))?.label ?? stand?.becUnits[0]?.label ?? '')
  const reading =
    dataset && stand && unit && smr !== '' && inTable(unit)
      ? droughtReading(dataset, unit, smr, period, stand.species)
      : null
  const summary = stand
    ? `${unit || 'No BEC unit'}${reading ? ` · ${reading.rows.filter((r) => r.projected === 'H' || r.projected === 'VH').length} species high or very high` : ''}`
    : 'Not read'

  return (
    <ToolDisclosure
      toggleProps={{ 'data-forestry-disclosure': 'drought-risk' }}
      label="Drought risk to the standing timber"
      summary={summary}
      help={
        <>
          <span className="block">
            The landform&apos;s BEC unit (DataBC&apos;s BEC map) and the treed species mix under it (VRI rank 1), read
            against BC&apos;s published forDRAT table. forDRAT rates drought-related mortality in mature stands: context
            for the green landform and the timber that screens the view. It is never a run input and never changes
            green-up.
          </span>
          <span className="mt-1.5 block">
            Soil moisture regime is a site assessment, so you choose it. forDRAT uses BEC v11; a matching label on
            today&apos;s map does not prove the boundaries agree. A rating is not a planting recommendation.
          </span>
        </>
      }
    >
      <div className="space-y-2 text-xs" data-drought-risk>
        {!landform && <p>Draw or adopt a landform first.</p>}
        {landform && (
          <Button size="sm" variant="outline" disabled={current?.status === 'loading'} onClick={read} data-drought-read>
            {current?.status === 'loading'
              ? 'Reading BEC and inventory…'
              : stand
                ? 'Read again'
                : "Read the landform's BEC unit and species"}
          </Button>
        )}
        {current?.status === 'error' && <InlineAlert tone="error">{current.error}</InlineAlert>}
        {state.status !== 'idle' && state.key !== key && landform && (
          <p className="text-muted-foreground">The landform changed since the last read.</p>
        )}
        {stand && current?.status === 'ready' && (
          <>
            <p data-drought-bec>
              BEC units under the landform: {stand.becUnits.map((u) => `${u.label} ${share(u.share)}`).join(' · ')}.
              Treed ground {share(stand.treedShare)} of {stand.samples} points sampled.
            </p>
            {(current.truncated || current.clipped) && (
              <InlineAlert tone="warning">
                {current.clipped ? 'The landform is wider than one inventory read, so only its centre was read. ' : ''}
                {current.truncated ? 'The inventory read hit its feature limit; some stands may be missing.' : ''}
              </InlineAlert>
            )}
            {stand.becUnits.length > 1 && (
              <SelectField label="BEC unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
                {stand.becUnits.map((u) => (
                  <option key={u.label} value={u.label}>
                    {u.label} · {share(u.share)}
                    {inTable(u.label) ? '' : ' · not in forDRAT'}
                  </option>
                ))}
              </SelectField>
            )}
            {unit && !inTable(unit) && (
              <InlineAlert tone="warning">
                {unit} is not a unit in the published BEC v11 table, so it has no rating. Its BEC v11 equivalent needs a
                reviewer&apos;s check.
              </InlineAlert>
            )}
            <SelectField
              label="Soil moisture regime (site assessment)"
              value={smr === '' ? '' : String(smr)}
              placeholder="Choose the site's regime"
              onChange={(e) => setSmr(e.target.value ? (Number(e.target.value) as SoilMoistureRegime) : '')}
            >
              {SOIL_MOISTURE_REGIMES.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.id} · {r.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Climate period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as PublishedPeriod)}
            >
              {PROJECTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </SelectField>
            {smr === '' && <p className="text-muted-foreground">Choose a soil moisture regime to read the ratings.</p>}
            {reading && (
              <>
                <EngineeringTable variant="text" compact aria-label="Drought risk by species">
                  <thead>
                    <tr>
                      <ColumnHeader label="Species" />
                      <ColumnHeader label="Share" unit="of treed" />
                      <ColumnHeader label={periodLabel(DROUGHT_BASELINE_PERIOD)} />
                      <ColumnHeader label={periodLabel(period)} />
                    </tr>
                  </thead>
                  <tbody>
                    {reading.rows.map((row) => (
                      <tr key={row.code} data-drought-species={row.code}>
                        <td>
                          {speciesName(row.code)}
                          <span className="block text-2xs text-muted-foreground">VRI {row.vriCodes.join(', ')}</span>
                        </td>
                        <td className="tabular-nums">{share(row.share)}</td>
                        <td>
                          <Badge tone={RISK_TONES[row.baseline]} size="sm">
                            {riskLabel(row.baseline)}
                          </Badge>
                        </td>
                        <td>
                          <Badge tone={RISK_TONES[row.projected]} size="sm">
                            {riskLabel(row.projected)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </EngineeringTable>
                {!reading.rows.length && <p>No species under this landform is one forDRAT rates.</p>}
                <p className="tabular-nums">
                  AET/PET {reading.baselineAetPet.toFixed(3)} in {periodYears(DROUGHT_BASELINE_PERIOD)} →{' '}
                  {reading.projectedAetPet.toFixed(3)} in {periodYears(period)}; lower is drier.
                </p>
                {!!reading.unrated.length && (
                  <p className="text-muted-foreground">
                    Not rated by forDRAT: {reading.unrated.map((s) => `${s.vriCode} ${share(s.share)}`).join(', ')}.
                  </p>
                )}
              </>
            )}
            {unit && inTable(unit) && (
              <Link className="underline underline-offset-2" to={droughtRiskLink(unit, smr, period)}>
                Open {unit} in Drought risk
              </Link>
            )}
            <p className="text-2xs text-muted-foreground">{PUBLISHED_SOURCE.attribution}</p>
          </>
        )}
      </div>
    </ToolDisclosure>
  )
}
