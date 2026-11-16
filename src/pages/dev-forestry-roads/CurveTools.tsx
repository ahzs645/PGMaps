import { useRef, useState } from 'react'
import { CURVE_LABELS, type CurveFieldId } from './roadFieldDefinitions'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InlineAlert } from '@/components/ui/map-panels'
import { NumberField, OptionalNumberField, RoadSelect, roadFieldClass } from './Controls'
import { evaluateCurveCriteria, MAX_CURVE_WIDENING_M, parseWideningTableCsv } from './roadCriteria'
import { centrelineSamples, curveDesignAt, horizontalCurveSummary } from './engine'
import { fitHorizontalRadii, type RadiusFitMode } from './horizontalTools'
import {
  describePolylineFit,
  fitPolylineAlignment,
  fittedMinimumRadius,
  MAX_FIT_DEVIATION_M,
  MIN_FIT_DEVIATION_M,
} from './polylineFit'
import { sectionCrossfall, templateAt } from './templates'
import type { RoadWorkspace } from './useRoadWorkspace'
import type { CurveDesign, CurveLookupTable, CurveSettings } from './types'
import {
  curveTableFromFormula,
  curveTableFromText,
  curveTableText,
  sideFrictionFromText,
  sideFrictionText,
} from './superelevationTables'
import { CheckboxField } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'

/** Bulk curve tools for the horizontal points: one default radius, or a best fit within a tolerance. */
/** Field height when the label fits; a narrow pane wraps the label and the button grows rather than clipping. */
const bulkButtonClass = 'h-auto min-h-8 whitespace-normal py-1 leading-tight'

export function CurveTools({ workspace }: { workspace: RoadWorkspace }) {
  const { alignment, project, updateAlignment, setNotice } = workspace
  const [radius, setRadius] = useState(35)
  const [tolerance, setTolerance] = useState(2)
  const [spiral, setSpiral] = useState(0)
  const [deviation, setDeviation] = useState(5)
  const corners = Math.max(0, alignment.points.length - 2)
  /** Polyline to alignment: fewer points, a curve at each, within `deviation` of the road as it is. */
  const reduce = () => {
    const limits = { maxDeviationM: deviation, minRadiusM: project.settings.minRadius }
    try {
      // A road that already has curves is followed along them, not along the corners they cut.
      const centre = alignment.points.some((p) => p.radiusM > 0) ? centrelineSamples(alignment, 2) : null
      const line = centre
        ? centre.samples.map((sample) => centre.toCoordinate(sample.x, sample.y))
        : alignment.points.map((p) => p.coordinate)
      const fit = fitPolylineAlignment(line, limits)
      const last = fit.points.length - 1
      updateAlignment((a) => ({
        ...a,
        points: fit.points.map((point, i) => ({
          id: i === 0 ? a.points[0].id : i === last ? a.points[a.points.length - 1].id : crypto.randomUUID(),
          ...point,
        })),
      }))
      setNotice(
        describePolylineFit({ ...fit, sourcePoints: alignment.points.length }, limits) +
          (fit.sharpCorners ? ' “Fit sharp corners” gives them the largest curve their tangents hold.' : '') +
          (alignment.vertical.length || alignment.overrides.length
            ? ' Stations along the road have moved: check the profile and anything set by station.'
            : ''),
      )
    } catch (cause) {
      workspace.setError(cause instanceof Error ? cause.message : 'Could not reduce this line.')
    }
  }
  const apply = (mode: RadiusFitMode, onlySharp: boolean) => {
    const { points, report } = fitHorizontalRadii(alignment.points, mode, {
      minRadiusM: project.settings.minRadius,
      onlySharp,
    })
    updateAlignment((a) => ({ ...a, points }))
    const shrunk = report.filter((r) => r.limitedBy === 'tangents').length
    const below = report.filter((r) => r.belowMinimum).length
    setNotice(
      `Set ${report.length} curve${report.length === 1 ? '' : 's'}` +
        (shrunk ? `; ${shrunk} reduced to fit short tangents` : '') +
        (below ? `; ${below} below the ${project.settings.minRadius} m minimum radius` : '') +
        '.',
    )
  }
  const setSpirals = () => {
    updateAlignment((a) => ({
      ...a,
      points: a.points.map((p) => {
        const { spiralM: _old, ...rest } = p
        void _old
        return spiral > 0 && p.radiusM > 0 ? { ...rest, spiralM: spiral } : rest
      }),
    }))
    setNotice(spiral > 0 ? `Set ${spiral} m spirals on every curve.` : 'Removed the spirals.')
  }
  // Each row is the action and the one value it uses, so the four tools read as a short list.
  return (
    <div className={cn(insetBox(), 'mt-2')} data-testid="road-curve-tools">
      <p className="mb-1 text-xs font-medium">Bulk curve tools</p>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-end gap-x-2 gap-y-1.5">
        <Button
          size="sm"
          variant="outline"
          className={bulkButtonClass}
          disabled={!corners}
          data-testid="road-reduce-points"
          title={`Polyline to alignment: keeps as few points as will hold the line within this distance, with a curve of at least ${
            project.settings.minRadius > 0
              ? `the ${project.settings.minRadius} m minimum radius`
              : `${fittedMinimumRadius(0)} m (no minimum radius is set)`
          } at each`}
          onClick={reduce}
        >
          Reduce points, fit curves
        </Button>
        <NumberField
          label="Max deviation (m)"
          value={deviation}
          min={MIN_FIT_DEVIATION_M}
          max={MAX_FIT_DEVIATION_M}
          onChange={setDeviation}
        />
        <Button
          size="sm"
          variant="outline"
          className={bulkButtonClass}
          disabled={!corners}
          title="Every corner without a radius gets this one, reduced where its tangents are too short"
          onClick={() => apply({ kind: 'radius', radiusM: radius }, true)}
        >
          Fit sharp corners
        </Button>
        <NumberField label="Radius (m)" value={radius} min={1} max={10000} step={1} onChange={setRadius} />
        <Button
          size="sm"
          variant="outline"
          className={bulkButtonClass}
          disabled={!corners}
          title="Every corner gets the largest radius whose arc stays within this distance of the pegged corner"
          onClick={() => apply({ kind: 'tolerance', toleranceM: tolerance }, false)}
        >
          Best fit every corner
        </Button>
        <NumberField label="Tolerance (m)" value={tolerance} min={0.1} max={500} onChange={setTolerance} />
        <Button
          size="sm"
          variant="outline"
          className={bulkButtonClass}
          disabled={!alignment.points.some((p) => p.radiusM > 0)}
          title="Clothoid transitions of this length on both sides of every curve; 0 removes them"
          onClick={setSpirals}
        >
          Set spirals on every curve
        </Button>
        <NumberField label="Spirals (m)" value={spiral} max={2000} step={5} onChange={setSpiral} />
      </div>
    </div>
  )
}

const CURVE_DESIGN_START = {
  designSpeedKmh: 40,
  maxSuperelevationPercent: 8,
  sideFrictionFactor: 0.15,
  runoffLengthM: 30,
  wideningVehicleLengthM: null,
}

export const CURVE_DESIGN_HELP =
  'Required e = V²/(127 R) − f, or the lookup table’s value at the curve’s radius and speed; the rotation target ' +
  'is capped at the maximum. The section retains its template crown, so actual crossfall can differ. Inside ' +
  'widening uses L²/(2R) unless a table is entered. Transitions run in before the circular arc unless a share ' +
  'inside the curve is set; a tangent runout turns the outside lane first. Each curve can have its own speed, ' +
  'maximum, superelevation, runoff and widening on each side. Leave the speed empty for none. The values are entries, not a ' +
  'road-class standard. Name the criteria and record its source. Conflicting speed/radius/e-max is flagged; widening tables are radius, deflection, inside, outside.'

function updateCurveDesign(workspace: RoadWorkspace, patch: Partial<CurveDesign>) {
  workspace.updateAlignment((a) => ({ ...a, curveDesign: { ...(a.curveDesign ?? CURVE_DESIGN_START), ...patch } }))
}

/** Switching a road's curve speed off also switches off its associated criteria. */
export function CurveDesignField({
  workspace,
  field,
  compact,
}: {
  workspace: RoadWorkspace
  field: CurveFieldId
  compact?: boolean
}) {
  const { alignment, updateAlignment } = workspace
  const design = alignment.curveDesign
  const set = (patch: Partial<CurveDesign>) => updateCurveDesign(workspace, patch)
  if (field === 'curveDesignSpeedKmh') {
    return (
      <OptionalNumberField
        label={compact ? CURVE_LABELS[field] : 'Design speed (km/h)'}
        hint={
          compact
            ? 'Enter a speed to apply curve rotation and widening. Clearing it removes the active road’s curve criteria.'
            : undefined
        }
        value={design?.designSpeedKmh ?? null}
        updateOn="commit"
        min={1}
        max={150}
        step={5}
        onChange={(designSpeedKmh) =>
          designSpeedKmh === null
            ? updateAlignment((a) => {
                const { curveDesign: _off, ...rest } = a
                void _off
                return rest
              })
            : set({ designSpeedKmh })
        }
      />
    )
  }
  if (!design) return null
  if (field === 'maxSuperelevationPercent') {
    return (
      <NumberField
        label={CURVE_LABELS[field]}
        value={design.maxSuperelevationPercent}
        max={20}
        onChange={(maxSuperelevationPercent) => set({ maxSuperelevationPercent })}
      />
    )
  }
  return (
    <NumberField
      label={CURVE_LABELS[field]}
      value={design.runoffLengthM}
      max={1000}
      step={5}
      onChange={(runoffLengthM) => set({ runoffLengthM })}
    />
  )
}

/** A lookup table edited as RoadEng `.tbl` text: apply it, load the current one or a file, or drop it. */
function CurveTableEditor({
  title,
  testId,
  current,
  help,
  parse,
  onApply,
  onClear,
  clearLabel,
}: {
  title: string
  testId: string
  /** The table as text now, or null when there is none. */
  current: string | null
  help: string
  parse: (text: string) => unknown
  onApply: (text: string) => void
  onClear?: () => void
  clearLabel?: string
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const apply = (value: string) => {
    try {
      parse(value)
      onApply(value)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The table could not be read.')
    }
  }
  return (
    <details className="text-xs" data-testid={testId}>
      <summary className="cursor-pointer">{title}</summary>
      <p className="my-1 text-muted-foreground">{help}</p>
      <textarea
        className={`${roadFieldClass} min-h-24 w-full font-mono`}
        aria-label={`${title} text`}
        value={text}
        placeholder={'# comments\n,40,60\n200,0.03,0.05'}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-1 flex flex-wrap gap-1">
        <Button size="sm" variant="outline" onClick={() => apply(text)}>
          Apply table
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={current === null}
          onClick={() => {
            setText(current ?? '')
            setError('')
          }}
        >
          Load current table
        </Button>
        <Button size="sm" variant="ghost" onClick={() => file.current?.click()}>
          Open .tbl file
        </Button>
        <input
          ref={file}
          type="file"
          className="hidden"
          accept=".tbl,.txt,.csv,text/plain"
          aria-label={`Open ${title.split(' · ')[0]} file`}
          onChange={async (e) => {
            const chosen = e.target.files?.[0]
            e.target.value = ''
            if (!chosen) return
            const value = await chosen.text()
            setText(value)
            apply(value)
          }}
        />
        {onClear && (
          <Button size="sm" variant="ghost" disabled={current === null} onClick={onClear}>
            {clearLabel ?? 'Remove table'}
          </Button>
        )}
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </details>
  )
}

const SUPERELEVATION_FROM: Record<'formula' | 'table' | 'sideFriction' | 'minimumRadius' | 'stated', string> = {
  formula: 'formula',
  table: 'table',
  sideFriction: 'side friction',
  minimumRadius: 'minimum radius: e max',
  stated: 'stated',
}
const pct = (value: number) => `${value.toFixed(2)}%`
const WIDENING_FROM: Record<'rule' | 'stated', string> = {
  rule: "from the road's rule",
  stated: "this curve's own",
}
/** A side's widening in the curve table; a curve's own value carries a star. */
const wideningText = (value: number, from: 'rule' | 'stated') => `${value.toFixed(2)}${from === 'stated' ? '*' : ''}`

/** One curve's own settings with `patch` over them; a null value goes back to the road's. */
/** A change to a curve's own values: null takes the road's value back. */
type CurvePatch = { [K in keyof CurveSettings]?: CurveSettings[K] | null }

function withCurveSettings(settings: CurveSettings | undefined, patch: CurvePatch) {
  const next: Record<string, unknown> = { ...settings }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key]
    else next[key] = value
  }
  return Object.keys(next).length ? (next as CurveSettings) : undefined
}

/**
 * Each fitted curve's design speed, superelevation (and where it comes from), runoff, widening on
 * each side (a star marks the curve's own) and actual crossfall; choosing a curve opens its own values, each blank where it takes the road's.
 */
function CurveRows({ workspace, design }: { workspace: RoadWorkspace; design: CurveDesign }) {
  const { alignment, updateAlignment } = workspace
  const [selected, setSelected] = useState<string | null>(null)
  const rows = (() => {
    try {
      return horizontalCurveSummary(alignment)
    } catch {
      return []
    }
  })()
  if (!rows.length) return null
  const pointOf = (id: string) => alignment.points.find((p) => p.id === id)
  const chosen = rows.find((r) => r.pointId === selected) ?? null
  const setOwn = (pointId: string, patch: CurvePatch) =>
    updateAlignment((a) => ({
      ...a,
      points: a.points.map((p) => {
        if (p.id !== pointId) return p
        const { curve: _old, ...rest } = p
        void _old
        const curve = withCurveSettings(p.curve, patch)
        return curve ? { ...rest, curve } : rest
      }),
    }))
  return (
    <div className="overflow-x-auto overscroll-none text-2xs" data-testid="road-speed-criteria-review">
      <EngineeringTable>
        <thead>
          <tr>
            <ColumnHeader label="Curve" />
            <ColumnHeader label="Radius" />
            <ColumnHeader label="Speed" />
            <ColumnHeader label="e" />
            <ColumnHeader label="Runoff" />
            <ColumnHeader label="Widening I / O" />
            <ColumnHeader label="Actual I / O" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const own = pointOf(r.pointId)?.curve
            const c = evaluateCurveCriteria(design, r.radius, r.deflectionDegrees, own)
            const midpoint = (r.start + r.end) / 2
            const resolved = templateAt(alignment, midpoint).template
            const fitted = curveDesignAt(alignment, midpoint)
            const inside = sectionCrossfall(resolved, r.direction, fitted)
            const outside = sectionCrossfall(resolved, r.direction === 'left' ? 'right' : 'left', fitted)
            const isSelected = r.pointId === selected
            // The table radius a RoadEng curve carries is where its tables are read, not a value set here.
            const hasOwn = !!own && Object.keys(own).some((key) => key !== 'tableRadiusScale')
            return (
              <tr
                key={r.pointId || i}
                className={cn(c.warnings.length && 'text-warning', isSelected && 'bg-muted')}
                data-testid="road-curve-row"
                title={c.warnings.join(' ') || undefined}
              >
                <td>
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    aria-pressed={isSelected}
                    aria-label={`Curve H${i + 1}${hasOwn ? ', own values' : ''}`}
                    onClick={() => setSelected(isSelected ? null : r.pointId)}
                  >
                    H{i + 1}
                    {hasOwn ? '*' : ''}
                  </button>
                </td>
                <td title={`Full deflection ${r.deflectionDegrees.toFixed(1)}° including spirals`}>
                  {r.radius.toFixed(1)} m
                </td>
                <td>{c.designSpeedKmh.toFixed(0)}</td>
                <td title={`Required ${pct(c.requiredSuperelevationPercent)}`}>
                  {pct(c.appliedSuperelevationPercent)} {SUPERELEVATION_FROM[c.superelevationSource]}
                </td>
                <td>
                  {c.runoffInM === c.runoffOutM
                    ? `${c.runoffInM.toFixed(0)} m`
                    : `${c.runoffInM.toFixed(0)} / ${c.runoffOutM.toFixed(0)} m`}
                </td>
                <td
                  data-testid="road-curve-widening"
                  title={`Inside ${WIDENING_FROM[c.wideningSource.inside]}, outside ${WIDENING_FROM[c.wideningSource.outside]}`}
                >
                  {wideningText(c.insideWideningM, c.wideningSource.inside)} /{' '}
                  {wideningText(c.outsideWideningM, c.wideningSource.outside)}
                </td>
                <td>
                  {inside.toFixed(2)} / {outside.toFixed(2)}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </EngineeringTable>
      {chosen && (
        <CurveOwnValues
          key={chosen.pointId}
          name={`H${rows.indexOf(chosen) + 1}`}
          design={design}
          radiusM={chosen.radius}
          deflectionDegrees={chosen.deflectionDegrees}
          own={pointOf(chosen.pointId)?.curve}
          onChange={(patch) => setOwn(chosen.pointId, patch)}
        />
      )}
    </div>
  )
}

/** One curve's own values: each blank takes the road's rule, shown as its placeholder. */
function CurveOwnValues({
  name,
  design,
  radiusM,
  deflectionDegrees,
  own,
  onChange,
}: {
  name: string
  design: CurveDesign
  radiusM: number
  deflectionDegrees: number
  own: CurveSettings | undefined
  onChange: (patch: CurvePatch) => void
}) {
  // What the curve would take from the road with that one value left blank.
  const without = (key: keyof CurveSettings) =>
    evaluateCurveCriteria(design, radiusM, deflectionDegrees, withCurveSettings(own, { [key]: null }))
  const value = (key: Exclude<keyof CurveSettings, 'useMinimumRadius'>) => own?.[key] ?? null
  const fraction = own?.transitionFraction
  return (
    <div className={cn(insetBox(), 'mt-2 space-y-2')} data-testid="road-curve-own-values">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">
          {name} · R {radiusM.toFixed(1)} m
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={!own || Object.keys(own).every((key) => key === 'tableRadiusScale')}
          onClick={() => onChange(CLEAR_CURVE_SETTINGS)}
        >
          Use the road’s values
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <OptionalNumberField
          label="Design speed (km/h)"
          value={value('designSpeedKmh')}
          placeholder={String(design.designSpeedKmh)}
          updateOn="commit"
          min={1}
          max={150}
          step={5}
          onChange={(v) => onChange({ designSpeedKmh: v })}
        />
        <OptionalNumberField
          label="Max superelevation (%)"
          value={value('maxSuperelevationPercent')}
          placeholder={String(design.maxSuperelevationPercent)}
          updateOn="commit"
          min={0}
          max={20}
          onChange={(v) => onChange({ maxSuperelevationPercent: v })}
        />
        <OptionalNumberField
          label="Superelevation (%)"
          value={value('superelevationPercent')}
          placeholder={without('superelevationPercent').appliedSuperelevationPercent.toFixed(2)}
          hint="Blank takes the road's rule (the formula, the table or the side friction method). A value here is this curve's own, kept whatever the rule gives."
          updateOn="commit"
          min={0}
          max={20}
          onChange={(v) => onChange({ superelevationPercent: v })}
        />
        <div className="col-span-2">
          <CheckboxField
            label="Use minimum radius: e max"
            description="RoadEng's Use Minimum Radius: the curve's superelevation is its e max, unless a superelevation is typed above."
            checked={own?.useMinimumRadius === true}
            onCheckedChange={(on) => onChange({ useMinimumRadius: on ? true : null })}
          />
        </div>
        {design.superelevationMode === 'sideFriction' && (
          <OptionalNumberField
            label="Side friction f max"
            value={value('maxSideFriction')}
            placeholder={String(Math.round((without('maxSideFriction').sideFrictionLimit ?? 0) * 1e4) / 1e4)}
            hint="Blank takes the road's f max (its side friction table at this curve's speed, or its side friction f)."
            updateOn="commit"
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ maxSideFriction: v })}
          />
        )}
        <OptionalNumberField
          label="Runoff outside curve (%)"
          value={fraction === undefined ? null : Math.round(fraction * 1e6) / 1e4}
          placeholder={String(Math.round((design.transitionFraction ?? 1) * 1e4) / 100)}
          updateOn="commit"
          min={0}
          max={100}
          onChange={(v) => onChange({ transitionFraction: v === null ? null : v / 100 })}
        />
        <OptionalNumberField
          label="Runoff in (m)"
          value={value('runoffInM')}
          placeholder={without('runoffInM').runoffInM.toFixed(1)}
          updateOn="commit"
          min={0}
          max={1000}
          step={5}
          onChange={(v) => onChange({ runoffInM: v })}
        />
        <OptionalNumberField
          label="Runoff out (m)"
          value={value('runoffOutM')}
          placeholder={without('runoffOutM').runoffOutM.toFixed(1)}
          updateOn="commit"
          min={0}
          max={1000}
          step={5}
          onChange={(v) => onChange({ runoffOutM: v })}
        />
        <OptionalNumberField
          label="Widening inside (m)"
          value={value('insideWideningM')}
          placeholder={without('insideWideningM').insideWideningM.toFixed(2)}
          hint="Blank takes the road's widening (its table or vehicle length). A value here is this curve's own on the side toward its centre, kept whatever its radius becomes."
          updateOn="commit"
          min={0}
          max={MAX_CURVE_WIDENING_M}
          step={0.1}
          onChange={(v) => onChange({ insideWideningM: v })}
        />
        <OptionalNumberField
          label="Widening outside (m)"
          value={value('outsideWideningM')}
          placeholder={without('outsideWideningM').outsideWideningM.toFixed(2)}
          updateOn="commit"
          min={0}
          max={MAX_CURVE_WIDENING_M}
          step={0.1}
          onChange={(v) => onChange({ outsideWideningM: v })}
        />
      </div>
      {own?.tableRadiusScale !== undefined && (
        <p className="text-muted-foreground">
          {design.superelevationMode === 'sideFriction' ? 'Superelevation' : 'Tables'} read at R{' '}
          {(radiusM * own.tableRadiusScale).toFixed(2)} m, this curve’s radius in the RoadEng design.
        </p>
      )}
    </div>
  )
}

/** Every value set here back to the road's; the table radius of a RoadEng curve stays. */
const CLEAR_CURVE_SETTINGS: Partial<Record<keyof CurveSettings, null>> = {
  designSpeedKmh: null,
  maxSuperelevationPercent: null,
  superelevationPercent: null,
  useMinimumRadius: null,
  runoffInM: null,
  runoffOutM: null,
  transitionFraction: null,
  maxSideFriction: null,
  insideWideningM: null,
  outsideWideningM: null,
}

const tableSize = (table: CurveLookupTable | undefined) =>
  table ? `${table.rows.length} radii × ${table.speedsKmh.length} speeds` : 'none'

/** Design-speed superelevation and curve widening for the active road; an empty speed turns it off. */
export function CurveDesignControls({ workspace }: { workspace: RoadWorkspace }) {
  const { alignment } = workspace
  const design = alignment.curveDesign
  const [tableText, setTableText] = useState('')
  const [tableError, setTableError] = useState('')
  const set = (patch: Partial<CurveDesign>) => updateCurveDesign(workspace, patch)
  const drop = (key: 'runoffTable' | 'sideFrictionTable' | 'superelevationTable') =>
    workspace.updateAlignment((a) => {
      if (!a.curveDesign) return a
      const { [key]: _gone, ...rest } = a.curveDesign
      void _gone
      return {
        ...a,
        curveDesign:
          key === 'superelevationTable' && rest.superelevationMode === 'table'
            ? { ...rest, superelevationMode: 'formula' }
            : rest,
      }
    })
  const mode = design?.superelevationMode ?? 'formula'
  return (
    <div className="space-y-2" data-testid="road-curve-design">
      <div className="grid grid-cols-2 gap-2">
        <CurveDesignField field="curveDesignSpeedKmh" workspace={workspace} />
        {design && (
          <>
            <label className="col-span-2 text-xs">
              Criteria name
              <input
                className={roadFieldClass}
                aria-label="Road criteria name"
                maxLength={200}
                value={design.criteriaName ?? ''}
                onChange={(e) => set({ criteriaName: e.target.value })}
              />
            </label>
            <label className="col-span-2 text-xs">
              Criteria source / edition
              <input
                className={roadFieldClass}
                aria-label="Road criteria source"
                maxLength={2000}
                value={design.criteriaSource ?? ''}
                onChange={(e) => set({ criteriaSource: e.target.value })}
              />
            </label>
            <div className="col-span-2 text-xs">
              <span className="mb-0.5 flex items-center gap-1">
                Superelevation from
                <InfoTip label="About superelevation from">
                  The formula is e = V²/(127 R) − f, capped at the maximum. The lookup table gives e by radius and
                  design speed, linear between its entries as RoadEng reads it; a blank cell is an unsafe combination,
                  which takes the column’s largest value and is flagged, and a curve outside the table gets none. The
                  side friction method is RoadEng’s other Auto method: e / e max = f / f max with e + f = V²/(g R), g =
                  9.81 m/s², f max from the side friction table at the curve’s speed or else the side friction below. A
                  curve’s own values (choose it below) take the place of the road’s.
                </InfoTip>
              </span>
              <RoadSelect
                ariaLabel="Superelevation from"
                className="w-full"
                value={mode}
                options={[
                  { value: 'formula', label: 'Formula e = V²/127R − f' },
                  { value: 'table', label: 'Lookup table' },
                  { value: 'sideFriction', label: 'Side friction e/e max = f/f max' },
                ]}
                onValueChange={(value) =>
                  workspace.updateAlignment((a) =>
                    a.curveDesign
                      ? {
                          ...a,
                          curveDesign: {
                            ...a.curveDesign,
                            superelevationMode:
                              value === 'table' ? 'table' : value === 'sideFriction' ? 'sideFriction' : 'formula',
                            ...(value === 'table' && !a.curveDesign.superelevationTable
                              ? { superelevationTable: curveTableFromFormula(a.curveDesign) }
                              : {}),
                          },
                        }
                      : a,
                  )
                }
              />
            </div>
            <CurveDesignField field="maxSuperelevationPercent" workspace={workspace} />
            <NumberField
              label={mode === 'sideFriction' ? 'Side friction f max' : 'Side friction f'}
              value={design.sideFrictionFactor}
              max={1}
              step={0.01}
              onChange={(sideFrictionFactor) => set({ sideFrictionFactor })}
            />
            <CurveDesignField field="runoffLengthM" workspace={workspace} />
            <OptionalNumberField
              label="Runoff outside curve (%)"
              placeholder="100"
              value={design.transitionFraction === undefined ? null : Math.round(design.transitionFraction * 1e6) / 1e4}
              hint="The share of each runoff on the tangent, before the BC and after the EC. Blank: all of it, full superelevation at the curve."
              updateOn="commit"
              min={0}
              max={100}
              onChange={(v) =>
                workspace.updateAlignment((a) => {
                  if (!a.curveDesign) return a
                  const { transitionFraction: _old, ...rest } = a.curveDesign
                  void _old
                  return { ...a, curveDesign: v === null ? rest : { ...rest, transitionFraction: v / 100 } }
                })
              }
            />
            <div className="col-span-2">
              <CheckboxField
                label="Tangent runout at the runoff's rate"
                description="The outside lane turns from normal crown to level before the runoff."
                checked={design.tangentRunout === true}
                onCheckedChange={(on) =>
                  workspace.updateAlignment((a) => {
                    if (!a.curveDesign) return a
                    const { tangentRunout: _old, ...rest } = a.curveDesign
                    void _old
                    return { ...a, curveDesign: on ? { ...rest, tangentRunout: true } : rest }
                  })
                }
              />
            </div>
            <OptionalNumberField
              label="Widening vehicle (m)"
              placeholder="none"
              value={design.wideningVehicleLengthM}
              min={0}
              max={50}
              onChange={(wideningVehicleLengthM) => set({ wideningVehicleLengthM })}
            />
            <NumberField
              label="Extra inside widening (m)"
              value={design.insideWideningM ?? 0}
              max={50}
              onChange={(insideWideningM) => set({ insideWideningM })}
            />
            <NumberField
              label="Extra outside widening (m)"
              value={design.outsideWideningM ?? 0}
              max={50}
              onChange={(outsideWideningM) => set({ outsideWideningM })}
            />
          </>
        )}
      </div>
      {design && (
        <>
          <CurveTableEditor
            title={`Superelevation table · ${tableSize(design.superelevationTable)}`}
            testId="road-superelevation-table"
            current={design.superelevationTable ? curveTableText(design.superelevationTable, 'superelevation') : null}
            help="RoadEng's .tbl layout: # comments, a first line of design speeds (km/h), then a radius (m) and one superelevation per speed as rise over run (0.054 is 5.4 %); a blank cell is an unsafe combination. Applying it reads superelevation from the table."
            parse={(text) => curveTableFromText(text, 'superelevation')}
            onApply={(text) =>
              set({ superelevationTable: curveTableFromText(text, 'superelevation'), superelevationMode: 'table' })
            }
            onClear={() => drop('superelevationTable')}
            clearLabel={mode === 'table' ? 'Use the formula' : undefined}
          />
          <CurveTableEditor
            title={`Runoff table · ${tableSize(design.runoffTable)}`}
            testId="road-runoff-table"
            current={design.runoffTable ? curveTableText(design.runoffTable, 'runoff') : null}
            help="Runoff length (m) by radius and design speed, in the same layout. Used in table mode; where it is blank, the road's runoff applies."
            parse={(text) => curveTableFromText(text, 'runoff')}
            onApply={(text) => set({ runoffTable: curveTableFromText(text, 'runoff') })}
            onClear={() => drop('runoffTable')}
          />
          <CurveTableEditor
            title={`Side friction table · ${design.sideFrictionTable ? `${design.sideFrictionTable.speedsKmh.length} speeds` : 'none'}`}
            testId="road-side-friction-table"
            current={design.sideFrictionTable ? sideFrictionText(design.sideFrictionTable) : null}
            help="The largest side friction by design speed: a first line of speeds (km/h) and one row of values, its first cell unused. Review flags a curve that needs more."
            parse={(text) => sideFrictionFromText(text)}
            onApply={(text) => set({ sideFrictionTable: sideFrictionFromText(text) })}
            onClear={() => drop('sideFrictionTable')}
          />
          <details className="text-xs">
            <summary className="cursor-pointer">Widening table · {design.wideningTable?.length ?? 0} entries</summary>
            <p className="my-1 text-muted-foreground">
              CSV rows: radius m, deflection degrees, inside m, outside m. Include every combination. The table replaces
              vehicle-formula widening; extra widths are added.
            </p>
            <textarea
              className={`${roadFieldClass} min-h-24 w-full`}
              aria-label="Curve widening table CSV"
              value={tableText}
              placeholder="50,90,2,0"
              onChange={(e) => setTableText(e.target.value)}
            />
            <div className="mt-1 flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  try {
                    set({ wideningTable: parseWideningTableCsv(tableText) })
                    setTableError('')
                  } catch (e) {
                    setTableError(e instanceof Error ? e.message : 'Invalid table')
                  }
                }}
              >
                Apply widening table
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTableText(
                    (design.wideningTable ?? [])
                      .map((r) => [r.radiusM, r.deflectionDegrees, r.insideM, r.outsideM].join(','))
                      .join('\n'),
                  )
                  setTableError('')
                }}
              >
                Load current table
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  set({ wideningTable: undefined })
                  setTableError('')
                }}
              >
                Use vehicle formula
              </Button>
            </div>
            {tableError && <InlineAlert tone="error">{tableError}</InlineAlert>}
          </details>
          <CurveRows workspace={workspace} design={design} />
          <p className="mt-1 text-2xs text-muted-foreground">
            Speed requires radius ≥ {evaluateCurveCriteria(design, 100).minimumSpeedRadiusM.toFixed(1)} m. Criteria are
            entered values until supported by the recorded source. Choose a curve for its own speed, superelevation and
            runoff; * marks a curve with its own values.
          </p>
          <p className="mt-1 text-2xs text-muted-foreground">
            Actual I/O is inside/outside crossfall at the circular-arc midpoint; positive falls away from the
            centreline. Template crown and runoff determine the actual section. Widening is evaluated per fitted curve,
            using full deflection including spirals; a compound switchback still needs a complete vehicle maneuver and
            swept-path review. Data → Horizontal curves shows the full station review.
          </p>
        </>
      )}
    </div>
  )
}
