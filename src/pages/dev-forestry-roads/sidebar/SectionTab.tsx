import { useState } from 'react'
import { ArrowRight, Copy, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, roadFieldClass, RoadSelect } from '../Controls'
import { formatRoadStation } from '../Charts'
import { CURVE_DESIGN_HELP, CurveDesignControls } from '../CurveTools'
import { RoadSettingsDialog } from '../RoadSettingsDialog'
import { TemplateComponents } from '../TemplateComponents'
import { RoadSection } from '../SidebarParts'
import type { SidebarProps, SidebarTab } from '../DesignSidebarBody'
import type { RoadTemplate, WidthOverride } from '../types'
import { appliedTapers, duplicateWideningAt, fullWidthRange, limitedTaper } from '../wideningEntry'

const id = () => crypto.randomUUID()
type NumericTemplateKey = {
  [K in keyof RoadTemplate]-?: RoadTemplate[K] extends number | undefined ? K : never
}[keyof RoadTemplate]
const TEMPLATE_FIELDS: [NumericTemplateKey, string, number, number][] = [
  ['leftWidth', 'Left half-width (m)', 0.1, 50],
  ['rightWidth', 'Right half-width (m)', 0.1, 50],
  ['crossfallPercent', 'Crown crossfall (%)', 0, 20],
  ['cutSlope', 'Cut batter (H:V)', 0.1, 10],
  ['fillSlope', 'Fill batter (H:V)', 0.1, 10],
  ['ditchWidth', 'Ditch width (m)', 0, 10],
  ['ditchDepth', 'Ditch depth (m)', 0, 5],
  ['surfaceDepth', 'Surfacing depth (m)', 0, 2],
]

export function SectionTab(p: SidebarProps & { onTab: (tab: SidebarTab) => void }) {
  const { alignment, updateAlignment } = p.workspace
  return (
    <>
      <RoadSection
        title="Road cross-section"
        help="Formation geometry is a crown, a cut-side ditch and batters that run out to meet the ground. Flatter batters (a larger H:V) reach further, so a high fill or deep cut needs more section reach. The surfacing layer is a separate quantity. Batters and costs are editable planning assumptions."
      >
        <div className="grid grid-cols-2 items-end gap-x-2 gap-y-1.5">
          {TEMPLATE_FIELDS.map(([key, label, min, max]) => (
            <NumberField
              key={key}
              label={label}
              value={alignment.template[key] ?? 0}
              min={min}
              max={max}
              onChange={(value) => updateAlignment((a) => ({ ...a, template: { ...a.template, [key]: value } }))}
            />
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 w-full justify-between px-2 text-xs"
          onClick={() => p.onTab('engineering')}
        >
          Template library & station assignments
          <ArrowRight className="size-3" />
        </Button>
      </RoadSection>
      <RoadSection title="Template components" summary={`${alignment.template.components?.length ?? 0} added`}>
        <TemplateComponents
          template={alignment.template}
          materials={alignment.engineering?.materials}
          features={p.workspace.project.context}
          surfaces={p.workspace.project.terrain.referenceSurfaces}
          onChange={(template) => updateAlignment((a) => ({ ...a, template }))}
        />
      </RoadSection>
      <RoadSection
        title="Superelevation & widening"
        summary={alignment.curveDesign ? `${alignment.curveDesign.designSpeedKmh} km/h` : 'Off'}
        help={CURVE_DESIGN_HELP}
      >
        <CurveDesignControls workspace={p.workspace} />
      </RoadSection>
      <Widenings {...p} />
    </>
  )
}

function Widenings(p: SidebarProps) {
  const { alignment, analysis, updateAlignment } = p.workspace
  const [open, setOpen] = useState(false)
  // A taper the range could not carry: what it was held to, shown until that value changes.
  const [limited, setLimited] = useState<{ id: string; side: 'entry' | 'exit'; taperM: number; note: string } | null>(
    null,
  )
  // The widening being copied and the start typed for its copy.
  const [copying, setCopying] = useState<{ id: string; start: number } | null>(null)
  const tweak = (key: string, changes: Partial<WidthOverride>) =>
    updateAlignment((a) => ({ ...a, overrides: a.overrides.map((x) => (x.id === key ? { ...x, ...changes } : x)) }))
  const add = (kind: WidthOverride['kind']) =>
    updateAlignment((a) => {
      const start = Math.min(p.workspace.station, Math.max(0, analysis.length - 60))
      return {
        ...a,
        overrides: [
          ...a.overrides,
          {
            id: id(),
            name: kind === 'landing' ? 'New landing' : 'New turnout',
            kind,
            side: 'left',
            start,
            end: Math.min(analysis.length, start + 60),
            taper: 10,
            extraWidth: kind === 'landing' ? 9 : 4,
          },
        ],
      }
    })
  const locate = (v: WidthOverride) => {
    p.workspace.setFeatureSelection({ alignmentId: alignment.id, kind: 'widening', id: v.id })
    p.workspace.setStation((v.start + v.end) / 2)
  }
  return (
    <RoadSection
      title="Landings & turnouts"
      help="Extra width over a station range, tapered at each end. Landings are unsurfaced; turnouts are surfaced."
      actions={
        // Manage edits what exists; with nothing yet, the section offers the add buttons instead.
        alignment.overrides.length ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            aria-label="Manage landings & turnouts"
            onClick={() => setOpen(true)}
          >
            Manage
          </Button>
        ) : undefined
      }
    >
      {alignment.overrides.length ? (
        <div className="space-y-0.5">
          {alignment.overrides.map((v) => (
            <Button
              key={v.id}
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start text-xs"
              aria-pressed={
                p.workspace.featureSelection?.alignmentId === alignment.id && p.workspace.featureSelection?.id === v.id
              }
              onClick={() => locate(v)}
            >
              {v.name} · {formatRoadStation(v.start)}–{formatRoadStation(v.end)}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">None yet.</span>
          {(['landing', 'turnout'] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={!!p.workspace.busy}
              onClick={() => {
                add(kind)
                setOpen(true)
              }}
            >
              + {kind === 'landing' ? 'Landing' : 'Turnout'}
            </Button>
          ))}
        </div>
      )}
      <RoadSettingsDialog title="Landings & turnouts" open={open} onOpenChange={setOpen} busy={!!p.workspace.busy}>
        <div className="mb-2 flex gap-1">
          <Button size="sm" variant="outline" onClick={() => add('landing')}>
            + Landing
          </Button>
          <Button size="sm" variant="outline" onClick={() => add('turnout')}>
            + Turnout
          </Button>
        </div>
        {alignment.overrides.map((v) => (
          <div key={v.id} className="mb-3 space-y-2 rounded border p-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                locate(v)
                setOpen(false)
              }}
            >
              Locate {v.name}
            </Button>
            <div className="flex gap-1">
              <input
                aria-label="Widening name"
                className={roadFieldClass}
                value={v.name}
                maxLength={200}
                onChange={(e) => tweak(v.id, { name: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={`Duplicate ${v.name}`}
                aria-expanded={copying?.id === v.id}
                title="Copy this widening to another station"
                onClick={() => setCopying(copying?.id === v.id ? null : { id: v.id, start: v.end })}
              >
                <Copy className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={`Remove ${v.name}`}
                onClick={() => updateAlignment((a) => ({ ...a, overrides: a.overrides.filter((x) => x.id !== v.id) }))}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
            {copying?.id === v.id &&
              (() => {
                const result = duplicateWideningAt(v, copying.start, analysis.length, v.id)
                return (
                  <div className="space-y-1.5 rounded border border-dashed p-2" data-testid="road-widening-copy">
                    <div className="flex items-end gap-1.5">
                      <div className="min-w-0 flex-1">
                        <NumberField
                          label="Start of the copy (m)"
                          value={copying.start}
                          max={100000}
                          onChange={(start) => setCopying({ id: v.id, start })}
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={!result.copy}
                        onClick={() => {
                          if (!result.copy) return
                          const copy = { ...result.copy, id: id() }
                          updateAlignment((a) => ({ ...a, overrides: [...a.overrides, copy] }))
                          setCopying(null)
                        }}
                      >
                        Add copy
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCopying(null)}>
                        Cancel
                      </Button>
                    </div>
                    <p className={`text-xs ${result.error ? 'text-red-600' : 'text-muted-foreground'}`} role="status">
                      {result.error ??
                        `Copy at ${formatRoadStation(result.copy.start)}–${formatRoadStation(result.copy.end)}`}
                    </p>
                  </div>
                )
              })()}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Widening type">
                <RoadSelect
                  ariaLabel="Widening type"
                  className={roadFieldClass}
                  value={v.kind}
                  onValueChange={(value) => tweak(v.id, { kind: value as WidthOverride['kind'] })}
                >
                  <option value="landing">Landing · unsurfaced</option>
                  <option value="turnout">Turnout · surfaced</option>
                </RoadSelect>
              </Field>
              <Field label="Widening side">
                <RoadSelect
                  ariaLabel="Widening side"
                  className={roadFieldClass}
                  value={v.side}
                  onValueChange={(value) => tweak(v.id, { side: value as WidthOverride['side'] })}
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="both">Both</option>
                </RoadSelect>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['start', 'end', 'taper', 'extraWidth'] as const).map((key) => (
                <NumberField
                  key={key}
                  label={`${key === 'extraWidth' ? 'Extra width' : key[0].toUpperCase() + key.slice(1)} (m)`}
                  value={v[key]}
                  max={key === 'extraWidth' ? 50 : key === 'taper' ? 1000 : 100000}
                  onChange={(value) => tweak(v.id, { [key]: value })}
                />
              ))}
              {/* The field's own limit would change a typed taper without a word; `limitedTaper` says so. */}
              {(['entry', 'exit'] as const).map((side) => (
                <NumberField
                  key={side}
                  label={`${side === 'entry' ? 'Entry' : 'Exit'} taper (m)`}
                  value={v[`${side}TaperM`] ?? appliedTapers(v)[side]}
                  min={-1e9}
                  max={1e9}
                  onChange={(entered) => {
                    const { taperM, note } = limitedTaper(v, side, entered)
                    // Leaving the field repeats the value now shown; that must not withdraw the note.
                    setLimited((shown) =>
                      note
                        ? { id: v.id, side, taperM, note }
                        : shown?.id === v.id && shown.side === side && shown.taperM === taperM
                          ? shown
                          : null,
                    )
                    tweak(v.id, { [`${side}TaperM`]: taperM })
                  }}
                />
              ))}
            </div>
            {v.end > v.start && (
              <p className="text-xs text-muted-foreground" data-testid="road-widening-full-width">
                Start and End include the tapers · full width {formatRoadStation(fullWidthRange(v)!.from)}–
                {formatRoadStation(fullWidthRange(v)!.to)}
              </p>
            )}
            {limited?.id === v.id && v[`${limited.side}TaperM`] === limited.taperM && (
              <p role="status" className="text-xs text-amber-800 dark:text-amber-300" data-testid="road-taper-note">
                {limited.note}
              </p>
            )}
            {v.end <= v.start && (
              <p role="alert" className="text-xs text-red-600">
                End station must be after start.
              </p>
            )}
          </div>
        ))}
      </RoadSettingsDialog>
    </RoadSection>
  )
}
