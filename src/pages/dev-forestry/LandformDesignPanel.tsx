import type { AnalysisResult } from './types'

export const BC_DESIGN_HANDBOOK = 'https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/visual-resource-mgmt/visual_impact_assessment_handbook.pdf'

export function LandformDesignPanel({ result, onView }: { result: AnalysisResult | null; onView: (station: number, blockId: string) => void }) {
  const review = result?.landformDesign
  return <details className="rounded-lg border p-3 text-xs">
    <summary className="cursor-pointer font-medium">Landform design review</summary>
    <p className="my-2">Use <a className="underline" href={`${BC_DESIGN_HANDBOOK}#page=61`} target="_blank" rel="noreferrer">BC VIA Handbook, Appendix 5, pp. 55–56</a> to review opening shape, position and edges from representative road views.</p>
    <p className="my-2">Proposed blocks assume full harvest inside their boundaries. Historical openings use recorded harvest and recovery inputs; missing details remain assumptions. This reviews a proposal—it does not optimize harvest area or timber volume.</p>
    {!review && <p className="my-2 text-muted-foreground">Choose a landform and run the analysis to show terrain clues for the proposed blocks.</p>}
    {review && <>
      <p className="my-2 text-muted-foreground">Orange points: convex ridge cues. Blue: hollow cues. Purple: saddles. Local relief uses {review.contextRadiusMeters} m neighbours and a 3 m threshold; these are sampled clues, not traced visual force lines.</p>
      {review.blocks.map(block => <div className="my-2 rounded border p-2" key={block.id}>
        <p className="font-medium">{block.name}</p>
        <p>Visible ground at {block.visibleStations} of {block.stationCount} road stations.{block.unknownStations > 0 ? ` Visibility is incomplete at ${block.unknownStations} stations.` : ''}</p>
        <p>{block.ridgeSamples} ridge · {block.hollowSamples} hollow · {block.upperSlopeSamples} upper-elevation samples (of {block.sampleCount}). Mean sampled slope: {block.meanSlopePercent?.toFixed(0) ?? 'unknown'}%.</p>
        {block.unknownContextCount > 0 && <p>{block.unknownContextCount} samples have incomplete terrain context.</p>}
        {!block.sampleCount && <p>No sampled block ground lies inside the selected landform. Review the boundary or sampling resolution.</p>}
        <p>{block.silhouetteStations.length ? `Near the sampled landform silhouette at ${block.silhouetteStations.length} stations: check for a canopy notch in the before/after view.` : 'No silhouette proximity detected in this sampled run.'}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {block.mostVisibleStation !== null && <button className="rounded border px-2 py-1" onClick={() => onView(block.mostVisibleStation!, block.id)}>View most exposed station</button>}
          {!!block.silhouetteStations.length && <button className="rounded border px-2 py-1" onClick={() => onView(block.silhouetteStations[0], block.id)}>Review silhouette</button>}
        </div>
      </div>)}
      <p className="text-muted-foreground">Upper elevation means the top third of this landform’s sampled elevation range. Silhouette proximity uses 2° bearing bins and 0.5° vertical separation; background terrain and canopy can change the actual skyline. Counts describe samples, not area percentages or driving duration. No detection does not establish absence.</p>
    </>}
    <ul className="my-2 list-disc space-y-1 pl-4">
      <li>Review lower slopes and hollows for early entries; reduce opening scale on steeper ground.</li>
      <li>Follow visual forces up hollows and down ridges; match the landform’s shape rather than applying one boundary style everywhere.</li>
      <li>Check skyline notches, edge feathering, retained clumps, road exposure and future entries in the same view.</li>
    </ul>
    <p className="text-muted-foreground">These prompts do not score design quality or change the assessment denominator, VQO class or FS1252 design judgements.</p>
  </details>
}
