import type { ForestryScene } from './scene'
import type { AnalysisInput, TargetPolygon } from './types'
import { activeLandform, canonicalInput } from './integrity'
/** The same builder is used for the worker request and stale-result checks. */
export function buildSceneInput(scene: ForestryScene): AnalysisInput {
  const forms=scene.targets.filter(t=>t.role==='landscape')
  return {
    viewpoint:{mode:scene.viewpoint.mode,coordinates:scene.viewpoint.coordinates},
    targets:scene.targets.map(({id,name,role,geometry,harvestYear,clearcutPercent,siteDisturbance,recoveryPercent,harvestSystem})=>({id,name,role,geometry,harvestYear,clearcutPercent,siteDisturbance,recoveryPercent,...(harvestSystem==='partial'?{harvestSystem}:{})})),
    settings:scene.settings,assessmentYear:scene.assessmentYear ?? new Date().getFullYear(),
    activeLandformId:scene.activeLandformId ?? (forms.length===1?forms[0].id:null),
    harvestInventory:scene.harvestInventory,
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
    // Likewise a block's retention and partial-cut figures (Tables 5 and 6);
    // only whether a block is a partial cut changes what the run clears.
    assessed.targets = scene.targets.map((target) => {
      const kept: TargetPolygon = { ...target }
      delete kept.retentionPercent
      delete kept.volumeRemovedPercent
      delete kept.residualHeightMeters
      if (kept.harvestSystem !== 'partial') delete kept.harvestSystem
      return kept
    })
    return canonicalInput({...assessed,assessmentYear:buildSceneInput(scene).assessmentYear})
  } catch { return null }
}
/** Safe for render-time use. The worker gives the detailed ambiguity error on Run. */
export function findSceneLandform(scene: ForestryScene): TargetPolygon | null {
  try { return activeLandform(scene.targets,scene.activeLandformId) } catch { return null }
}
