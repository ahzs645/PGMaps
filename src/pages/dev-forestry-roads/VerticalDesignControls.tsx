import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { NumberField, OptionalNumberField } from './Controls'
import { formatRoadStation } from './Charts'
import { RoadSection } from './SidebarParts'
import { nearestStation } from './engine'
import { EMPTY_VERTICAL_STANDARDS, type VerticalControl, type VerticalStandards } from './verticalStandards'
import { curveLengthsForK } from './verticalTools'
import { DEFAULT_VERTICAL_OPTIMIZATION, optimizeVerticalProfile } from './verticalOptimizer'
import { safeAnalyzeRoad } from './analysisResult'
import { parseProject } from './project'
import type { RoadWorkspace } from './useRoadWorkspace'

const uid = () => crypto.randomUUID()

/** Vertical standards, control points and the bulk curve tool, after the PVI list. */
export function VerticalDesignControls({ workspace }: { workspace: RoadWorkspace }) {
  const { alignment, analysis, station, setStation, updateAlignment } = workspace
  const standards = alignment.verticalStandards ?? EMPTY_VERTICAL_STANDARDS
  const controls = alignment.verticalControls ?? []
  const [k, setK] = useState(4)
  const [search, setSearch] = useState({
    pviSpacingM: DEFAULT_VERTICAL_OPTIMIZATION.pviSpacingM,
    maxDepthM: DEFAULT_VERTICAL_OPTIMIZATION.maxDepthM,
    levelStepM: DEFAULT_VERTICAL_OPTIMIZATION.levelStepM,
    tieEndsToGround: true,
    objective: 'earthwork' as 'earthwork' | 'total',
  })
  const optimize = async () => {
    if (workspace.busy) return
    const { project, source } = workspace
    workspace.setError('')
    workspace.setBusy('Optimizing the vertical profile…')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    try {
      if (project.alignments.length >= 20) throw Error('The project already has 20 road alternatives.')
      const result = optimizeVerticalProfile(alignment, analysis.length, source, project.settings, { ...search, k })
      const candidate = structuredClone(alignment)
      candidate.id = uid()
      candidate.name = `${alignment.name} · optimized profile`.slice(0, 200)
      candidate.points = candidate.points.map((point) => ({ ...point, id: uid() }))
      candidate.overrides = candidate.overrides.map((override) => ({ ...override, id: uid() }))
      candidate.vertical = result.vertical.map((point) => ({ ...point, id: uid() }))
      const after = safeAnalyzeRoad(candidate, source, project.settings, project.context)
      workspace.commit(
        parseProject({ ...project, alignments: [...project.alignments, candidate], activeAlignmentId: candidate.id }),
      )
      const money = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`
      workspace.setNotice(
        `${result.message} Covered estimate ${money(analysis.estimatedCost)} → ${money(after.estimatedCost)}; the original road is kept as an alternative.`,
      )
    } catch (cause) {
      workspace.setError(cause instanceof Error ? cause.message : 'Could not optimize the profile.')
    } finally {
      workspace.setBusy('')
    }
  }
  const setStandards = (patch: Partial<VerticalStandards>) =>
    updateAlignment((a) => ({
      ...a,
      verticalStandards: { ...(a.verticalStandards ?? EMPTY_VERTICAL_STANDARDS), ...patch },
    }))
  const setControl = (id: string, patch: Partial<VerticalControl>) =>
    updateAlignment((a) => ({
      ...a,
      verticalControls: (a.verticalControls ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))
  const fromAlignment = (chainage: number) => {
    const at = nearestStation(analysis.stations, chainage)
    return { elevation: at?.designElevation ?? null, gradePercent: at?.gradePercent ?? null }
  }
  const checks = analysis.verticalChecks ?? []
  const designed = alignment.vertical.length > 1
  const standardCount =
    standards.gradeRanges.length +
    [standards.minSagK, standards.minCrestK, standards.minCurveLengthM, standards.minTangentLengthM].filter(
      (v) => v !== null,
    ).length
  return (
    <>
      <CollapsibleSection
        label="Vertical standards"
        summary={standardCount ? `${standardCount} set` : 'None set'}
        defaultOpen={standardCount > 0}
        toggleProps={{ 'data-testid': 'road-vertical-standards' }}
        contentClassName="px-3 pb-3"
        actions={
          <InfoTip label="About vertical standards">
            Signed grade limits by station range, minimum K and curve and tangent lengths. Empty fields are not checked;
            the road-wide maximum grade still applies.
          </InfoTip>
        }
      >
        <div className="space-y-2">
          {standards.gradeRanges.map((range, index) => (
            <div
              key={range.id}
              className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] items-end gap-1"
              data-grade-range
            >
              <OptionalNumberField
                label={`Range ${index + 1} from`}
                placeholder="start"
                value={range.start}
                min={0}
                onChange={(start) =>
                  setStandards({
                    gradeRanges: standards.gradeRanges.map((r) => (r.id === range.id ? { ...r, start } : r)),
                  })
                }
              />
              <OptionalNumberField
                label="to"
                placeholder="end"
                value={range.end}
                min={0}
                onChange={(end) =>
                  setStandards({
                    gradeRanges: standards.gradeRanges.map((r) => (r.id === range.id ? { ...r, end } : r)),
                  })
                }
              />
              <OptionalNumberField
                label="min %"
                value={range.minGradePercent}
                min={-100}
                max={100}
                onChange={(minGradePercent) =>
                  setStandards({
                    gradeRanges: standards.gradeRanges.map((r) => (r.id === range.id ? { ...r, minGradePercent } : r)),
                  })
                }
              />
              <OptionalNumberField
                label="max %"
                value={range.maxGradePercent}
                min={-100}
                max={100}
                onChange={(maxGradePercent) =>
                  setStandards({
                    gradeRanges: standards.gradeRanges.map((r) => (r.id === range.id ? { ...r, maxGradePercent } : r)),
                  })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Remove grade range ${index + 1}`}
                onClick={() => setStandards({ gradeRanges: standards.gradeRanges.filter((r) => r.id !== range.id) })}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const limit = workspace.project.settings.maxGradePercent
              setStandards({
                gradeRanges: [
                  ...standards.gradeRanges,
                  { id: uid(), start: null, end: null, minGradePercent: -limit, maxGradePercent: limit },
                ],
              })
            }}
          >
            <Plus className="mr-1 size-3" />
            Grade range
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <OptionalNumberField
              label="Min sag K"
              value={standards.minSagK}
              min={0}
              max={1000}
              onChange={(minSagK) => setStandards({ minSagK })}
            />
            <OptionalNumberField
              label="Min crest K"
              value={standards.minCrestK}
              min={0}
              max={1000}
              onChange={(minCrestK) => setStandards({ minCrestK })}
            />
            <OptionalNumberField
              label="Min curve (m)"
              value={standards.minCurveLengthM}
              min={0}
              max={10000}
              onChange={(minCurveLengthM) => setStandards({ minCurveLengthM })}
            />
            <OptionalNumberField
              label="Min tangent (m)"
              value={standards.minTangentLengthM}
              min={0}
              max={10000}
              onChange={(minTangentLengthM) => setStandards({ minTangentLengthM })}
            />
          </div>
        </div>
      </CollapsibleSection>
      <RoadSection
        title="Optimize vertical profile"
        help={
          <>
            Searches PVI levels around the ground for the cheapest cut and fill at the entered rates, inside the grade
            ranges, the road-wide maximum grade, curve K and every control point. The result is a new alternative.
            “Total cost” also prices each interval's cut/fill imbalance and keeps the line the full analysis prices
            lowest, with haul, borrow and waste.
            <br />
            Curve K also sets every curve length at once: K × the grade change, at least the minimum curve length.
          </>
        }
      >
        <div className="mb-2 flex items-end gap-2">
          <div className="w-24">
            <NumberField label="Curve K" value={k} min={0.1} max={1000} onChange={setK} />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={alignment.vertical.length < 3}
            title="Sets each interior PVI's curve length to K × its grade change, at least the minimum curve length"
            onClick={() =>
              updateAlignment((a) => ({
                ...a,
                vertical: curveLengthsForK(a.vertical, k, a.verticalStandards?.minCurveLengthM ?? 0),
              }))
            }
          >
            Set every curve from K
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <NumberField
            label="PVI spacing (m)"
            value={search.pviSpacingM}
            min={10}
            max={1000}
            step={5}
            onChange={(pviSpacingM) => setSearch((x) => ({ ...x, pviSpacingM }))}
          />
          <NumberField
            label="Search ± (m)"
            value={search.maxDepthM}
            min={0.5}
            max={30}
            onChange={(maxDepthM) => setSearch((x) => ({ ...x, maxDepthM }))}
          />
          <NumberField
            label="Level step (m)"
            value={search.levelStepM}
            min={0.1}
            max={5}
            onChange={(levelStepM) => setSearch((x) => ({ ...x, levelStepM }))}
          />
        </div>
        <label className="mt-2 flex items-center justify-between gap-2 text-xs">
          Objective
          <select
            aria-label="Profile optimization objective"
            className="rounded border bg-background px-1 text-base md:text-xs"
            value={search.objective}
            onChange={(e) => setSearch((x) => ({ ...x, objective: e.target.value as 'earthwork' | 'total' }))}
          >
            <option value="earthwork">Cut and fill</option>
            <option value="total">Total cost incl. haul, borrow, waste</option>
          </select>
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={search.tieEndsToGround}
            onChange={(e) => setSearch((x) => ({ ...x, tieEndsToGround: e.target.checked }))}
          />
          Tie both ends to ground
        </label>
        <Button
          className="mt-2 w-full"
          size="sm"
          disabled={!!workspace.busy || analysis.length < 10 || !analysis.stations.length}
          onClick={() => void optimize()}
        >
          Optimize profile (K {k})
        </Button>
      </RoadSection>
      <RoadSection
        title="Control points"
        help="Elevations and grades the profile must hold, each with a tolerance. Leave a target empty to check only the other."
      >
        <div className="space-y-2">
          {controls.map((c, index) => (
            <div key={c.id} className="rounded border p-2" data-vertical-control>
              <div className="mb-1 flex items-center justify-between gap-1">
                <button className="text-xs font-medium" onClick={() => setStation(c.chainage)}>
                  Control {index + 1} · {formatRoadStation(c.chainage)}
                </button>
                <div className="flex items-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1 text-[11px]"
                    disabled={!designed}
                    onClick={() => setControl(c.id, fromAlignment(c.chainage))}
                  >
                    Get from alignment
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={`Remove control ${index + 1}`}
                    onClick={() =>
                      updateAlignment((a) => ({
                        ...a,
                        verticalControls: (a.verticalControls ?? []).filter((x) => x.id !== c.id),
                      }))
                    }
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <NumberField
                  label="Station"
                  value={c.chainage}
                  min={0}
                  max={Math.max(analysis.length, c.chainage)}
                  step={1}
                  onChange={(chainage) => setControl(c.id, { chainage })}
                />
                <OptionalNumberField
                  label="Elevation"
                  value={c.elevation}
                  min={-12000}
                  max={12000}
                  onChange={(elevation) => setControl(c.id, { elevation })}
                />
                <OptionalNumberField
                  label="Grade %"
                  value={c.gradePercent}
                  min={-100}
                  max={100}
                  onChange={(gradePercent) => setControl(c.id, { gradePercent })}
                />
                <NumberField
                  label="Tol. above"
                  value={c.toleranceAboveM}
                  max={1000}
                  onChange={(toleranceAboveM) => setControl(c.id, { toleranceAboveM })}
                />
                <NumberField
                  label="Tol. below"
                  value={c.toleranceBelowM}
                  max={1000}
                  onChange={(toleranceBelowM) => setControl(c.id, { toleranceBelowM })}
                />
                <NumberField
                  label="Grade tol."
                  value={c.gradeTolerancePercent}
                  max={100}
                  onChange={(gradeTolerancePercent) => setControl(c.id, { gradeTolerancePercent })}
                />
              </div>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={!designed && !nearestStation(analysis.stations, station)?.groundElevation}
            onClick={() => {
              const at = nearestStation(analysis.stations, station)
              const target = fromAlignment(at?.chainage ?? station)
              updateAlignment((a) => ({
                ...a,
                verticalControls: [
                  ...(a.verticalControls ?? []),
                  {
                    id: uid(),
                    chainage: Math.round((at?.chainage ?? station) * 100) / 100,
                    elevation: target.elevation ?? at?.groundElevation ?? null,
                    toleranceAboveM: 0,
                    toleranceBelowM: 0,
                    gradePercent: null,
                    gradeTolerancePercent: 0,
                  },
                ].sort((x, y) => x.chainage - y.chainage),
              }))
            }}
          >
            <Plus className="mr-1 size-3" />
            Control at selected station
          </Button>
        </div>
        {!designed && (standards.gradeRanges.length > 0 || controls.length > 0) && (
          <InlineAlert tone="warning">
            Checks run once the road has a vertical alignment (two or more PVIs).
          </InlineAlert>
        )}
        {checks.length > 0 && (
          <div className="mt-2 space-y-1" data-testid="road-vertical-checks">
            {checks.map((check, index) => (
              <button
                key={`${check.kind}-${index}`}
                className="block w-full border-l-2 border-rose-500 pl-2 text-left text-[11px] leading-4"
                onClick={() => setStation(check.chainage)}
              >
                {check.message}
              </button>
            ))}
          </div>
        )}
        {designed && checks.length === 0 && (standards !== EMPTY_VERTICAL_STANDARDS || controls.length > 0) && (
          <p
            className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-400"
            data-testid="road-vertical-checks-pass"
          >
            The profile meets every set standard and control.
          </p>
        )}
      </RoadSection>
    </>
  )
}
