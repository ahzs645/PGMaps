import { Button } from '@/components/ui/button'
import { ToolSection } from '@/components/ui/tool-section'
import { ExternalLink } from '@/components/ui/text-button'
import { formatPct } from './measureFormat'
import type { AnalysisResult } from './types'

export const BC_DESIGN_HANDBOOK =
  'https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/visual-resource-mgmt/visual_impact_assessment_handbook.pdf'

export function LandformDesignPanel({
  result,
  onView,
}: {
  result: AnalysisResult | null
  onView: (station: number, blockId: string) => void
}) {
  const review = result?.landformDesign
  return (
    <ToolSection
      title="Landform design review"
      className="text-xs"
      summary={
        review ? `${review.blocks.length} block${review.blocks.length === 1 ? '' : 's'} · Appendix 5` : 'Needs a run'
      }
      toggleProps={{ 'data-forestry-disclosure': 'landform-design-review' }}
      help={
        <>
          Review opening shape, position and edges from representative road views, as the VIA Handbook&apos;s Appendix 5
          (pp. 55–56) sets out. Proposed blocks assume full harvest inside their boundaries. Historical openings use
          recorded harvest and recovery inputs; missing details remain assumptions. This reviews a proposal—it does not
          optimize harvest area or timber volume.
        </>
      }
    >
      <p>
        <ExternalLink href={`${BC_DESIGN_HANDBOOK}#page=61`}>BC VIA Handbook, Appendix 5, pp. 55–56</ExternalLink>
      </p>
      {!review && (
        <p className="text-muted-foreground">
          Choose a landform and run the analysis to show terrain clues for the proposed blocks.
        </p>
      )}
      {review && (
        <>
          <p className="text-muted-foreground">
            Orange points: convex ridge cues. Blue: hollow cues. Purple: saddles. Local relief uses{' '}
            {review.contextRadiusMeters} m neighbours and a 3 m threshold; these are sampled clues, not traced visual
            force lines.
          </p>
          {review.blocks.map((block) => (
            <div className="space-y-1 rounded-md border p-2" key={block.id}>
              <p className="font-medium">{block.name}</p>
              <p>
                Visible ground at {block.visibleStations} of {block.stationCount} road stations.
                {block.unknownStations > 0 ? ` Visibility is incomplete at ${block.unknownStations} stations.` : ''}
              </p>
              <p>
                {block.ridgeSamples} ridge · {block.hollowSamples} hollow · {block.upperSlopeSamples} upper-elevation
                samples (of {block.sampleCount}). Mean sampled slope: {formatPct(block.meanSlopePercent, 0, 'unknown')}.
              </p>
              {block.unknownContextCount > 0 && (
                <p>{block.unknownContextCount} samples have incomplete terrain context.</p>
              )}
              {!block.sampleCount && (
                <p>
                  No sampled block ground lies inside the selected landform. Review the boundary or sampling resolution.
                </p>
              )}
              <p>
                {block.silhouetteStations.length
                  ? `Near the sampled landform silhouette at ${block.silhouetteStations.length} stations: check for a canopy notch in the before/after view.`
                  : 'No silhouette proximity detected in this sampled run.'}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {block.mostVisibleStation !== null && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="touch:h-10"
                    onClick={() => onView(block.mostVisibleStation!, block.id)}
                  >
                    View most exposed station
                  </Button>
                )}
                {!!block.silhouetteStations.length && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="touch:h-10"
                    onClick={() => onView(block.silhouetteStations[0], block.id)}
                  >
                    Review silhouette
                  </Button>
                )}
              </div>
            </div>
          ))}
          <p className="text-muted-foreground">
            Upper elevation means the top third of this landform’s sampled elevation range. Silhouette proximity uses 2°
            bearing bins and 0.5° vertical separation; background terrain and canopy can change the actual skyline.
            Counts describe samples, not area percentages or driving duration. No detection does not establish absence.
          </p>
        </>
      )}
      <ul className="list-disc space-y-1 pl-4">
        <li>Review lower slopes and hollows for early entries; reduce opening scale on steeper ground.</li>
        <li>
          Follow visual forces up hollows and down ridges; match the landform’s shape rather than applying one boundary
          style everywhere.
        </li>
        <li>
          Check skyline notches, edge feathering, retained clumps, road exposure and future entries in the same view.
        </li>
      </ul>
      <p className="text-muted-foreground">
        These prompts do not score design quality or change the assessment denominator, VQO class or FS1252 design
        judgements.
      </p>
    </ToolSection>
  )
}
