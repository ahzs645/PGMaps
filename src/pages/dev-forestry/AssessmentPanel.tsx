import { CheckboxField, FORM_INPUT_CLASS, StyledSelect, NumberField } from '@/components/ui/form-field'
import { ToolDisclosure } from '@/components/ui/tool-section'
import { InfoTip } from '@/components/ui/info-tip'
import { cn } from '@/lib/utils'
import type { ForestryScene } from './scene'
import { findSceneLandform } from './sceneInput'
import { resolveThreshold } from './integrity'
import { ExistingOpeningGreenUp, greenUpSummary } from './ExistingOpeningGreenUp'
/**
 * `scope` is handbook 3.3.2 — which landform the run measures against and what
 * counts as its green area. The FS1252 draft (4.0) is in Save & export
 * (`Fs1252Options`). The stale-run notice is the headline's, not this panel's.
 */
type Props = {
  part: 'scope'
  scene: ForestryScene
  onChange: (scene: ForestryScene) => void
}
/** A label beside its field rather than above it, for short numbers. */
const INLINE_FIELD = 'flex-row items-center justify-between gap-3'
export function AssessmentPanel({ scene, onChange }: Props) {
  const landform = findSceneLandform(scene),
    forms = scene.targets.filter((t) => t.role === 'landscape')
  return (
    <section className="space-y-3 text-xs" aria-label="Assessment landform">
      <label className="block">
        <span className="flex items-center gap-1">
          Active landform
          <InfoTip label="About the active landform">
            An inventory sensitivity unit is only a candidate. A landform is what one viewpoint sees as a single
            hillside, and a unit usually holds several; confirm the boundary from the assessment viewpoint. Other
            landforms are not pooled into its denominator.
          </InfoTip>
        </span>
        <StyledSelect
          aria-label="Active assessment landform"
          className="mt-1 w-full rounded-md border bg-background p-2"
          value={landform?.id ?? ''}
          onChange={(e) => onChange({ ...scene, activeLandformId: e.target.value || null })}
        >
          <option value="">{forms.length ? 'Select one landform' : 'Draw or adopt a candidate landform'}</option>
          {forms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </StyledSelect>
      </label>
      {/* A cleared year restores the last one on blur rather than writing year 0. */}
      <NumberField
        label="Assessment year"
        contentClassName={INLINE_FIELD}
        inputClassName={cn(FORM_INPUT_CLASS, 'w-24')}
        min={1900}
        max={2200}
        value={scene.assessmentYear ?? new Date().getFullYear()}
        onValueChange={(assessmentYear) => onChange({ ...scene, assessmentYear })}
      />
      <div className="flex items-start gap-1">
        <CheckboxField
          className="flex-1"
          label="Treat the entire active landform as assessable green area"
          checked={scene.settings.greenAreaConfirmed === true}
          onCheckedChange={(greenAreaConfirmed) =>
            onChange({ ...scene, settings: { ...scene.settings, greenAreaConfirmed } })
          }
        />
        <InfoTip label="About treating the landform as green area">
          An explicit scenario assumption, not a substitute for land-cover review.
        </InfoTip>
      </div>
      <div className="flex items-start gap-1">
        <CheckboxField
          className="flex-1"
          label="The included features represent the existing disturbance for this scenario"
          checked={scene.settings.existingDisturbanceConfirmed === true}
          onCheckedChange={(existingDisturbanceConfirmed) =>
            onChange({ ...scene, settings: { ...scene.settings, existingDisturbanceConfirmed } })
          }
        />
        <InfoTip label="About the existing disturbance">
          Unlisted disturbance is not being inferred from a failed lookup.
        </InfoTip>
      </div>
      {landform && (
        <p className="text-muted-foreground">
          Planimetric planning allowance:{' '}
          {resolveThreshold(landform.objectiveId, 'planimetric', scene.thresholds, landform.vac).value}%.{' '}
          {resolveThreshold(landform.objectiveId, 'planimetric', scene.thresholds, landform.vac).note}
        </p>
      )}
      <ToolDisclosure
        label="Existing-opening green-up"
        summary={greenUpSummary(scene)}
        toggleProps={{ 'data-forestry-disclosure': 'recovery-overrides' }}
      >
        <ExistingOpeningGreenUp scene={scene} onChange={onChange} />
      </ToolDisclosure>
    </section>
  )
}
