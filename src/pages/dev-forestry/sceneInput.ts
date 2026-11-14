import type { ForestryScene } from './scene'
import type { AnalysisInput, TargetPolygon } from './types'
import { activeLandform, canonicalInput } from './integrity'
import { fieldGreenUpInput } from './greenUp'
import { surveyedEyeElevation } from './viewpointStand'
/** The same builder is used for the worker request and stale-result checks. */
export function buildSceneInput(scene: ForestryScene): AnalysisInput {
  const forms = scene.targets.filter((t) => t.role === 'landscape')
  // A surveyed eye elevation is a run input only while it applies to where the eye stands.
  const eyeElevationMeters = surveyedEyeElevation(scene.viewpoint)
  return {
    viewpoint: {
      mode: scene.viewpoint.mode,
      coordinates: scene.viewpoint.coordinates,
      ...(eyeElevationMeters !== null ? { eyeElevationMeters } : {}),
    },
    targets: scene.targets.map(
      ({
        id,
        name,
        role,
        geometry,
        harvestYear,
        clearcutPercent,
        siteDisturbance,
        recoveryPercent,
        harvestSystem,
        fieldGreenUp,
      }) => {
        // Only a complete field check is a run input, and never its note.
        const field = role === 'harvested' ? fieldGreenUpInput(fieldGreenUp) : undefined
        return {
          id,
          name,
          role,
          geometry,
          harvestYear,
          clearcutPercent,
          siteDisturbance,
          recoveryPercent,
          ...(harvestSystem === 'partial' ? { harvestSystem } : {}),
          ...(field ? { fieldGreenUp: field } : {}),
        }
      },
    ),
    settings: scene.settings,
    assessmentYear: scene.assessmentYear ?? new Date().getFullYear(),
    activeLandformId: scene.activeLandformId ?? (forms.length === 1 ? forms[0].id : null),
    harvestInventory: scene.harvestInventory,
    ...(scene.masks?.length ? { masks: scene.masks } : {}),
    ...(scene.localRasters?.length ? { localRasters: scene.localRasters } : {}),
  }
}
/** This also binds the report labels, objectives and thresholds to the run. */
export function sceneFingerprint(scene: ForestryScene): string | null {
  try {
    // Office metadata and the reviewer's VIA judgements are recorded with the
    // export, not computed by the run: editing them must not stale it.
    const assessed: Partial<ForestryScene> = { ...scene }
    delete assessed.reportMetadata
    delete assessed.viaReview
    // Tree-free areas, the viewpoint clearing among them, only change the drawn timber.
    delete assessed.treeFreeAreas
    delete assessed.viewpointClearing
    // The sheet's fixed frame only changes the picture.
    delete assessed.figureFrame
    // A surveyed eye elevation counts as the run reads it: only while it applies to where the eye
    // stands, so one left behind by a moved viewpoint does not stale the run.
    const viewpoint = { ...scene.viewpoint }
    delete viewpoint.surveyedEye
    const eyeElevationMeters = surveyedEyeElevation(scene.viewpoint)
    const counted: ForestryScene['viewpoint'] & { eyeElevationMeters?: number } =
      eyeElevationMeters === null ? viewpoint : { ...viewpoint, eyeElevationMeters }
    assessed.viewpoint = counted
    // Likewise a block's retention and partial-cut figures (Tables 5 and 6);
    // only whether a block is a partial cut changes what the run clears.
    assessed.targets = scene.targets.map((target) => {
      const kept: TargetPolygon = { ...target }
      delete kept.retentionPercent
      delete kept.volumeRemovedPercent
      delete kept.residualHeightMeters
      delete kept.plannedHarvestYear
      delete kept.displayColor
      if (kept.harvestSystem !== 'partial') delete kept.harvestSystem
      // A field check counts once complete, as the run reads it; its note is a remark, and a
      // draft check without a date or observer leaves the model in charge.
      const field = kept.role === 'harvested' ? fieldGreenUpInput(kept.fieldGreenUp) : undefined
      if (field) kept.fieldGreenUp = field
      else delete kept.fieldGreenUp
      return kept
    })
    return canonicalInput({ ...assessed, assessmentYear: buildSceneInput(scene).assessmentYear })
  } catch {
    return null
  }
}
/** Safe for render-time use. The worker gives the detailed ambiguity error on Run. */
export function findSceneLandform(scene: ForestryScene): TargetPolygon | null {
  try {
    return activeLandform(scene.targets, scene.activeLandformId)
  } catch {
    return null
  }
}
