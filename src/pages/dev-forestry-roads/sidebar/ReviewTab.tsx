import { CommandButton } from '@/components/interfaces/CommandButton'
import { StationValue } from '../roadStation'
import type { RoadSettings } from '../types'
import { useMemo, useRef, useState } from 'react'
import { ArrowRight, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, roadFieldClass, RoadSelect } from '../Controls'
import { RoadSection, SectionReachAlert } from '../SidebarParts'
import type { SidebarProps, SidebarTab } from '../DesignSidebarBody'
import { RATES, SAMPLING } from '../roadFieldDefinitions'
import { ProjectSettingField } from '../SharedRoadFields'
import { surfacingSupplyCost } from '../gravel'
import { crossingRegisterSummary } from '../crossingRegister'
import { gradeRule, gradeRuleText } from '../designStandards'
import { DesignStandardsFields } from '../DesignStandardsFields'
import { CableRiggingFields } from '../CableRiggingFields'
import { CableSupportsSection } from '../CableSupportsSection'
import { CableFieldProfileSection } from '../CableFieldProfileSection'
import { RiggingSetPicker } from '../RiggingSetPicker'
import { cableGroundSource } from '../dline/fieldProfile'
import { applyRiggingSetToLine, lineLimits } from '../dline/riggingSets'
import { jobStandardsOf, standardVehicleCheck, withJobStandards } from '../jobStandards'
import { isoDate } from '../projectIssue'
import { CrossingRegisterList, ReadinessList } from '../ReadinessPanel'
import { projectReadiness, type ReadinessRow } from '../readiness'
import { HaulPanel } from '../HaulPanel'

/** The settings with the curvature correction applied, or back to report only (the field left out). */
const withCurvatureCorrection = (settings: RoadSettings, apply: boolean): RoadSettings => {
  const next = { ...settings }
  delete next.curvatureCorrection
  return apply ? { ...next, curvatureCorrection: 'apply' } : next
}

export function ReviewTab(
  p: SidebarProps & {
    onTab: (tab: SidebarTab) => void
    onEngineeringInputs?: (inputs: 'templates' | 'materials' | 'haul') => void
  },
) {
  const { project, alignment, analysis, update, updateAlignment, setStation } = p.workspace
  const aggregateSource = alignment.engineering?.surfacingSupply
  const aggregate = surfacingSupplyCost(analysis.surfaceVolumeM3, project.settings.surfacingRate, aggregateSource)
  const settings = project.settings
  const { rows, register } = useMemo(
    () => projectReadiness(project, alignment, analysis, { drainageStale: !!p.drainageStale, vehicle: p.vehicleFit }),
    [project, alignment, analysis, p.drainageStale, p.vehicleFit],
  )
  const [ratesOpen, setRatesOpen] = useState(false)
  const [standardsOpen, setStandardsOpen] = useState(false)
  const [haulOpen, setHaulOpen] = useState(false)
  const haul = useRef<HTMLDivElement>(null)
  const rates = useRef<HTMLDivElement>(null)
  const standards = useRef<HTMLDivElement>(null)
  const reveal = (target: { current: HTMLDivElement | null }) =>
    requestAnimationFrame(() => target.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  /** Each check leads to the place it is cleared. */
  const act = (action: NonNullable<ReadinessRow['action']>) => {
    if (action.chainage !== undefined) setStation(action.chainage)
    switch (action.target) {
      case 'standards':
        setStandardsOpen(true)
        return reveal(standards)
      case 'rates':
        setRatesOpen(true)
        return reveal(rates)
      case 'haul-destination':
        setHaulOpen(true)
        return reveal(haul)
      case 'terrain':
      case 'streams':
      case 'constraints':
        return p.onTab('terrain')
      case 'profile':
      case 'curves':
      case 'vertical-standards':
        return p.onTab('design')
      case 'template':
        return p.onTab('template')
      case 'templates':
      case 'materials':
      case 'haul':
        return p.onEngineeringInputs ? p.onEngineeringInputs(action.target) : p.onTab('engineering')
      case 'culverts':
        return p.onShowCulverts?.(action.chainage)
      case 'drainage':
        return p.onShowDrainage?.()
      case 'vehicle': {
        // The standards' design vehicle is run on a road that has no check of its own yet.
        const check = alignment.vehicleCheck ? null : standardVehicleCheck(project.standards)
        if (check) updateAlignment((road) => ({ ...road, vehicleCheck: check }))
        return p.onShowSwept?.()
      }
      case 'station':
        return
    }
  }
  const job = jobStandardsOf(project)
  const confirmedOn = project.standards?.confirmedOn
  return (
    <>
      <ReadinessList
        rows={rows}
        onAction={act}
        help="The checks a designer answers for on the active road. Met means the check was made and nothing is outstanding. Needs attention means a limit is broken or an input is still to do. Not assessed means the workspace could not make the check, which is not a pass. Every limit is this project's own input; none of this certifies a road standard. The same list is printed in the report."
      >
        <SectionReachAlert workspace={p.workspace} />
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full whitespace-normal"
          onClick={p.onCompareCompleteCosts}
        >
          Review connected access & complete route costs
        </Button>
      </ReadinessList>
      <RoadSection
        title="Crossing register"
        summary={crossingRegisterSummary(register)}
        defaultOpen={register.rows.length > 0}
        help={`Every place water crosses the active road, listed once. Mapped crossings are where the road meets a stream line in the project. Modelled crossings are where the drainage check's flow routing over the terrain enters the road. A mapped stream and a modelled flow line within ${register.matchDistanceM} m along the road are one crossing; anything else is listed as unmatched. Route comparison prices crossings from its own coarser flow model, so its stream and drain counts are a pricing allowance, not this register.`}
        data-testid="road-crossing-register-section"
      >
        <StationValue workspace={p.workspace}>
          {(station) => <CrossingRegisterList register={register} station={station} onStation={setStation} />}
        </StationValue>
        {register.drainage !== 'current' && (
          <Button size="sm" variant="outline" className="w-full" onClick={() => p.onShowDrainage?.()}>
            {register.drainage === 'stale' ? 'Run the drainage check again' : 'Run the drainage check'} for modelled
            crossings
          </Button>
        )}
      </RoadSection>
      <div ref={haul} className="scroll-mt-2" />
      <HaulPanel workspace={p.workspace} open={haulOpen} onOpenChange={setHaulOpen} />
      <div ref={standards} className="scroll-mt-2" />
      <RoadSection
        title="Design standards"
        summary={`${gradeRuleText(gradeRule(settings, project.standards))} · R${settings.minRadius} · ${confirmedOn ? 'confirmed' : 'not confirmed'}`}
        open={standardsOpen}
        onOpenChange={setStandardsOpen}
        help="What this job's roads are designed to, entered once for the project. The grade check, the curve check, the swept path and the Review list all read these. They are your inputs, not a claim of compliance with a road standard."
        data-testid="road-design-standards-section"
      >
        <DesignStandardsFields value={job} onChange={(next) => update((x) => withJobStandards(x, next))} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs text-muted-foreground" data-testid="road-standards-confirmed">
            {confirmedOn ? `Confirmed ${confirmedOn}` : 'Not confirmed: these are the starting values'}
          </span>
          <Button
            size="sm"
            variant={confirmedOn ? 'outline' : 'default'}
            className="h-7 shrink-0 text-xs"
            onClick={() =>
              update((x) =>
                withJobStandards(x, {
                  ...jobStandardsOf(x),
                  standards: { ...jobStandardsOf(x).standards, confirmedOn: isoDate(new Date()) },
                }),
              )
            }
          >
            {confirmedOn ? 'Confirm again today' : 'Confirm standards'}
          </Button>
        </div>
      </RoadSection>
      {analysis.warnings.length > 0 && (
        <RoadSection
          title="Model flags"
          summary={`${analysis.warnings.length}`}
          help="What the calculation itself reported about the active road. The checks above judge it against the project's limits."
        >
          {analysis.warnings.map((w, i) => (
            <p key={i} className="mb-1 border-l-2 border-amber-500 pl-2 text-xs">
              {w}
            </p>
          ))}
        </RoadSection>
      )}
      <RoadSection
        title="Sampling"
        summary={`${settings.stationInterval} m · reach ${settings.crossSectionHalfWidth} m`}
        help="How closely the road is sampled and how far out each section looks. Grade and radius limits are under Design standards."
      >
        <div className="grid grid-cols-2 items-end gap-2">
          {SAMPLING.map(([key]) => (
            <ProjectSettingField key={key} field={key} workspace={p.workspace} />
          ))}
        </div>
      </RoadSection>
      <div ref={rates} className="scroll-mt-2" />
      <RoadSection
        title="Unit rates"
        summary={`$${settings.cutRate} cut · $${settings.fillRate} fill${settings.curvatureCorrection === 'apply' ? ' · curve-corrected' : ''}`}
        open={ratesOpen}
        onOpenChange={setRatesOpen}
        help={
          <>
            Base unit rates in CAD. Engineering inputs add material-specific excavation, structures, haul, borrow and
            waste, mobilization and contingency. Unassigned excavation uses this cut rate.
          </>
        }
      >
        <Field
          label="Curvature correction"
          hint={
            <>
              On a curve, earthwork inside the curve sweeps less than the centreline length and earthwork outside it
              more (Pappus: area × the path of its centroid). Report only keeps the average end areas in every total,
              cost, mass and haul figure and shows the corrected volumes beside them. Apply to quantities uses the
              corrected volumes everywhere, and each total says so. An interval whose centroid lies past the centre of
              curvature keeps its average end area.
            </>
          }
        >
          <RoadSelect
            ariaLabel="Curvature correction"
            className={roadFieldClass}
            value={settings.curvatureCorrection ?? 'report'}
            onValueChange={(value) =>
              update((x) => ({ ...x, settings: withCurvatureCorrection(x.settings, value === 'apply') }))
            }
          >
            <option value="report">Report only</option>
            <option value="apply">Apply to quantities</option>
          </RoadSelect>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {RATES.map(([key]) => (
            <ProjectSettingField key={key} field={key} workspace={p.workspace} />
          ))}
        </div>
        <p className="text-2xs text-muted-foreground" data-testid="road-review-aggregate-summary">
          {aggregateSource?.enabled ? (
            <>
              <span className="font-medium">{aggregateSource.name}</span> · {aggregate.suppliedM3.toFixed(1)} m³ at $
              {aggregate.rate.toFixed(2)}/m³ · {aggregate.fallbackM3.toFixed(1)} m³ at the base rate
            </>
          ) : (
            <>No aggregate source: the base surfacing rate applies.</>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-between px-2 text-xs"
          onClick={() => p.onTab('engineering')}
        >
          Materials, drainage, aggregate & haul inputs
          <ArrowRight className="size-3" />
        </Button>
      </RoadSection>
      <CableLines {...p} />
    </>
  )
}

function CableLines(p: SidebarProps) {
  const { project, update } = p.workspace
  const edit = (id: string, change: (line: (typeof project.cables)[number]) => (typeof project.cables)[number]) =>
    update((x) => ({ ...x, cables: x.cables.map((a) => (a.id === id ? change(a) : a)) }))
  return (
    <RoadSection
      title="D-line / cable geometry"
      summary={`${project.cables.length}`}
      help="Positive offsets inset the supports; negative offsets extend the span. Heights follow the selected yarder and tailhold ends. An assumed parabolic sag screens clearance; Rope and load solves one static skyline span for tension and the loaded carriage path."
    >
      <div className="grid">
        <CommandButton
          id="cable"
          surface="sidebar"
          state={p.commandStates?.cable}
          presentation={{ caption: 'Draw landing-to-tailhold line' }}
          onRun={(id) => p.onCommand?.(id)}
        />
      </div>
      {project.cables.map((c) => (
        <div key={c.id} className="mt-2 space-y-2 rounded border p-2">
          <div className="flex items-center justify-between gap-1">
            <input
              className={roadFieldClass}
              aria-label="D-line name"
              value={c.name}
              maxLength={200}
              onChange={(e) => edit(c.id, (a) => ({ ...a, name: e.target.value }))}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label={`Remove ${c.name}`}
              onClick={() => update((x) => ({ ...x, cables: x.cables.filter((a) => a.id !== c.id) }))}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
          <Field label="Yarder position">
            <RoadSelect
              ariaLabel="Yarder position"
              className={roadFieldClass}
              value={c.yarderAt ?? 'start'}
              onValueChange={(value) => edit(c.id, (a) => ({ ...a, yarderAt: value as 'start' | 'end' }))}
            >
              <option value="start">Start endpoint</option>
              <option value="end">End endpoint</option>
            </RoadSelect>
          </Field>
          <CableRiggingFields line={c} onChange={(next) => edit(c.id, () => next)} />
          {c.sagModel === 'mechanics' && c.rigging && (
            <RiggingSetPicker
              sets={project.riggingSets ?? []}
              rigging={c.rigging}
              limits={lineLimits(c)}
              onApply={(set) => edit(c.id, (a) => applyRiggingSetToLine(a, set))}
              onSetsChange={(sets) => update((x) => ({ ...x, riggingSets: sets.length ? sets : undefined }))}
            />
          )}
          {c.sagModel === 'mechanics' && c.rigging && (
            <CableSupportsSection
              line={c}
              terrain={cableGroundSource(c, p.workspace.source)}
              onEdit={(change) => edit(c.id, change)}
            />
          )}
          <CableFieldProfileSection line={c} terrain={p.workspace.source} onEdit={(change) => edit(c.id, change)} />
          <div className="grid grid-cols-3 gap-1">
            {(['startHeight', 'endHeight', 'deflectionPercent'] as const).map((key) => (
              <NumberField
                key={key}
                label={key === 'startHeight' ? 'Yarder m' : key === 'endHeight' ? 'Tailhold m' : 'Sag %'}
                value={c[key]}
                max={key === 'deflectionPercent' ? 25 : 100}
                onChange={(value) => edit(c.id, (a) => ({ ...a, [key]: value }))}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {(['startOffsetM', 'endOffsetM'] as const).map((key) => (
              <NumberField
                key={key}
                label={key === 'startOffsetM' ? 'Start inset (m)' : 'End inset (m)'}
                value={c[key] ?? 0}
                min={-200}
                max={200}
                onChange={(value) => edit(c.id, (a) => ({ ...a, [key]: value }))}
              />
            ))}
          </div>
          <details className="rounded border p-2">
            <summary className="cursor-pointer text-xs">Edit original endpoints</summary>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {(['start', 'end'] as const).flatMap((endpoint) =>
                ([0, 1] as const).map((axis) => (
                  <NumberField
                    key={`${endpoint}-${axis}`}
                    label={`${endpoint} ${axis === 0 ? 'longitude' : 'latitude'}`}
                    value={c[endpoint][axis]}
                    min={axis === 0 ? -180 : -84.999999}
                    max={axis === 0 ? 180 : 84.999999}
                    step={0.00001}
                    onChange={(value) =>
                      edit(c.id, (a) => ({ ...a, [endpoint]: a[endpoint].map((n, i) => (i === axis ? value : n)) }))
                    }
                  />
                )),
              )}
            </div>
          </details>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              edit(c.id, (a) => ({
                ...a,
                start: a.end,
                end: a.start,
                startOffsetM: a.endOffsetM ?? 0,
                endOffsetM: a.startOffsetM ?? 0,
                yarderAt: a.yarderAt === 'end' ? 'start' : 'end',
              }))
            }
          >
            Reverse line direction
          </Button>
        </div>
      ))}
    </RoadSection>
  )
}
