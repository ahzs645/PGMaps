import { CheckboxField, SelectField } from '@/components/ui/form-field'
import { setEngineBrowserOptions, useEngineBrowserOptions } from './engineBrowserOptions'
import { parseEngineRenderOptions, type EngineRenderOptions } from './engineRenderOptions'
import type { RoadRendererId } from './externalRenderers'

/** Browser-local quality controls for the external road renderer only. */
export function EngineRenderControls({ renderer }: { renderer: Exclude<RoadRendererId, 'pgmaps'> }) {
  const browser = useEngineBrowserOptions()
  const options = browser.render[renderer]
  const update = (patch: Partial<EngineRenderOptions>) =>
    setEngineBrowserOptions({ render: { ...browser.render, [renderer]: parseEngineRenderOptions(patch, options) } })
  return (
    <fieldset className="space-y-2 border-t border-border/60 pt-2" data-testid="engine-render-controls">
      <legend className="text-xs font-medium">External renderer quality</legend>
      <p className="text-2xs text-muted-foreground">
        Applies to this renderer in this browser. Final images use their requested size.
      </p>
      <SelectField
        label="Live resolution"
        value={String(options.resolutionScale)}
        onChange={(event) => update({ resolutionScale: Number(event.target.value) })}
      >
        <option value="1">100%</option>
        <option value="0.75">75%</option>
        <option value="0.5">50%</option>
      </SelectField>
      <SelectField
        label="Live frame limit"
        value={String(options.maxFps)}
        onChange={(event) => update({ maxFps: Number(event.target.value) })}
      >
        <option value="0">Unlimited</option>
        <option value="60">60 fps</option>
        <option value="30">30 fps</option>
        <option value="15">15 fps</option>
      </SelectField>
      <SelectField
        label="Pending GPU frames"
        description="A smaller limit reduces queued work and input delay."
        value={String(options.maxInFlight)}
        onChange={(event) => update({ maxInFlight: Number(event.target.value) })}
      >
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
      </SelectField>
      <SelectField
        label="Distant forest transition"
        value={options.dissolveMode}
        onChange={(event) => update({ dissolveMode: event.target.value === 'pixels' ? 'pixels' : 'relative' })}
      >
        <option value="relative">Relative to image height</option>
        <option value="pixels">Fixed pixel threshold</option>
      </SelectField>
      <SelectField
        label="Dissolve threshold"
        description="Larger values switch to canopy sooner. Relative mode scales this threshold with image height."
        value={String(options.dissolvePixels)}
        onChange={(event) => update({ dissolvePixels: Number(event.target.value) })}
      >
        <option value="0.5">0.5 pixels</option>
        <option value="1">1 pixel</option>
        <option value="2">2 pixels</option>
        <option value="4">4 pixels</option>
        <option value="8">8 pixels</option>
        <option value="16">16 pixels</option>
      </SelectField>
      {options.dissolveMode === 'relative' && (
        <SelectField
          label="Dissolve reference height"
          value={String(options.dissolveReferenceHeight)}
          onChange={(event) => update({ dissolveReferenceHeight: Number(event.target.value) })}
        >
          <option value="720">720 pixels</option>
          <option value="1080">1080 pixels</option>
          <option value="2160">2160 pixels</option>
        </SelectField>
      )}
      <CheckboxField
        label="Cull forest outside the camera"
        checked={options.frustumCulling}
        onCheckedChange={(checked) => update({ frustumCulling: checked })}
      />
    </fieldset>
  )
}
