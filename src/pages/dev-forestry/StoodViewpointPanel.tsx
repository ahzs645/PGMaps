import { FORM_INPUT_CLASS, NullableNumberField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolSection } from '@/components/ui/tool-section'
import { formatMeasure } from '@/lib/format'
import type { SurveyedEye, Viewpoint } from './types'
import { haversineMeters } from './visibility'
import { standingPoint, surveyedEyeElevation, surveyedEyeFor } from './viewpointStand'

const metres = (value: number) => formatMeasure(value, 'm', { maximumFractionDigits: 0 })

/**
 * Step 2: where the eye stands at a stood-at viewpoint (a spot, or *Stand here*'s pullout), and the
 * reviewer's surveyed eye elevation there. The elevation is a run input: the road view, the run's
 * observer and the captures all stand the eye there, and the figure's camera block says so.
 */
export function StoodViewpointPanel({
  viewpoint,
  terrainGroundMeters,
  observerHeightMeters,
  onSurveyedEyeChange,
}: {
  viewpoint: Viewpoint
  /** The terrain model's ground at the standing point, once the road view's terrain has loaded. */
  terrainGroundMeters: number | null
  observerHeightMeters: number
  onSurveyedEyeChange: (surveyedEye: SurveyedEye | undefined) => void
}) {
  const stand = standingPoint(viewpoint)
  if (!stand) return null
  const surveyed = surveyedEyeElevation(viewpoint)
  // Entered for a point the viewpoint has since moved from: kept, but not used.
  const lapsed = viewpoint.surveyedEye && surveyed === null ? haversineMeters(stand, viewpoint.surveyedEye) : null
  const modelEye =
    terrainGroundMeters !== null && Number.isFinite(terrainGroundMeters)
      ? terrainGroundMeters + observerHeightMeters
      : null
  return (
    <ToolSection
      title="Where you stand"
      summary={surveyed !== null ? `Eye ${metres(surveyed)}, surveyed` : 'Eye on the terrain model'}
      toggleProps={{ 'data-forestry-disclosure': 'stood-viewpoint' }}
      help={
        <>
          The eye stands on the terrain model (a smoothed regional DEM) plus the eye height. At a lookout on a bluff, a
          dam crest or a cut bank the model can read metres off the real ground. A surveyed eye elevation — the
          VIA&rsquo;s printed viewpoint elevation, or a GPS reading plus your eye height — stands the eye there instead,
          for the road view, the run and the figures alike. It is a run input: changing it stales the run. It applies
          within 20 m of this point and lapses if the viewpoint moves.
        </>
      }
    >
      <div className="space-y-1.5" data-testid="stood-viewpoint">
        <p className="text-2xs text-muted-foreground">
          {viewpoint.name || 'Viewpoint'}
          {modelEye !== null
            ? ` · terrain model ground ${metres(terrainGroundMeters!)}, eye ${metres(modelEye)} at ${formatMeasure(observerHeightMeters, 'm', { maximumFractionDigits: 1 })} up`
            : ' · terrain model ground loads with the road view'}
        </p>
        <NullableNumberField
          label="Surveyed eye elevation"
          aria-label="Surveyed eye elevation, metres above sea level"
          value={surveyed}
          min={-500}
          max={9000}
          step={0.1}
          suffix="m"
          placeholder={modelEye !== null ? `${Math.round(modelEye)} (terrain model)` : 'Terrain model'}
          updateOn="commit"
          inputClassName={FORM_INPUT_CLASS}
          contentClassName="block"
          labelClassName="mb-1 block text-2xs font-medium text-muted-foreground"
          unitClassName="text-2xs"
          onValueChange={(value) => onSurveyedEyeChange(surveyedEyeFor(viewpoint, value))}
        />
        {surveyed !== null && terrainGroundMeters !== null && surveyed < terrainGroundMeters && (
          <InlineAlert tone="warning">
            The terrain model&rsquo;s ground here is {metres(terrainGroundMeters - surveyed)} above this eye, so it
            hides the near view. Check the elevation and its datum.
          </InlineAlert>
        )}
        {surveyed !== null && modelEye !== null && surveyed >= (terrainGroundMeters ?? -Infinity) && (
          <p className="text-2xs text-muted-foreground">
            {Math.abs(surveyed - modelEye) < 0.5
              ? 'The same as the terrain model reads.'
              : `${metres(Math.abs(surveyed - modelEye))} ${surveyed > modelEye ? 'above' : 'below'} the terrain model's eye.`}
          </p>
        )}
        {lapsed !== null && (
          <p className="text-2xs text-muted-foreground">
            A surveyed elevation ({metres(viewpoint.surveyedEye!.elevationMeters)}) was entered {metres(lapsed)} from
            here and is not used. Enter one for this point.
          </p>
        )}
      </div>
    </ToolSection>
  )
}
