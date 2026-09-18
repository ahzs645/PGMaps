/**
 * The run, written up on the Ministry's own form.
 *
 * The layout is *Visual Quality Effectiveness Evaluation* (FS1252, 2008/04),
 * the Forest and Range Evaluation Program's monitoring form, section for
 * section and field for field, so every figure can be carried across to the
 * paper version without re-deriving it.
 *
 * Two things about that form are worth stating plainly, and the worksheet
 * states both at the top rather than leaving a reader to discover them:
 *
 * 1. It is a **post-harvest** form. It evaluates whether an alteration that
 *    already exists met its objective. Used before the fact, as here, the
 *    alterations on it are proposed rather than standing, and the ratings it
 *    produces are predictions.
 * 2. **Half of it is field work.** The basic visual quality class, the design
 *    observations, the photography — those need a person at the viewpoint.
 *    Those fields are printed as blanks rather than dropped, so the output is a
 *    form to take into the field, not a report that quietly omits what it
 *    could not do.
 *
 * Markdown on purpose: it is text, so it diffs, pastes into anything, and can
 * be unit-tested line by line.
 */

import type { AnalysisResult, TargetPolygon, TargetVisibility } from './types'
import { bearingDegrees, haversineMeters } from './visibility'
import {
  adjustedAlterationPercent,
  compassPoint,
  designDistanceScore,
  viewpointImportance,
  visibleProposalCentre,
} from './vqe'
import {
  assessObjective,
  classifyAlteration,
  partialCutEquivalentPercent,
  vacDenudationPercent,
  viewingZoneFor,
  visualQualityClass,
  type ObjectiveVerdict,
  type VisualQualityThresholds,
} from './vqo'

/** What the inventory lookup knows about the landform, for the VLI section. */
export type ReportInventoryUnit = {
  polygonNumber: string
  /** Visual sensitivity class: 1–5, or a code such as `W` or `NVS`. */
  vsc: string | null
  scenicArea: boolean
}

export type ReportInput = {
  result: AnalysisResult
  /** The scene's polygons, for the names, objectives and VAC the run does not carry. */
  targets: TargetPolygon[]
  thresholds: VisualQualityThresholds
  viewpointName: string
  /** When the run was made. Passed in rather than read, so a report is reproducible. */
  generatedAt: Date
  /** Where the inventory figures came from, when a lookup supplied them. */
  inventorySource?: string | null
  /** The adopted inventory polygon, when the landform came from one. */
  inventoryUnit?: ReportInventoryUnit | null
}

/** Needs somebody standing at the viewpoint. */
const FIELD = '______ *(field)*'
/** Administrative record this tool does not hold. */
const OFFICE = '______ *(office)*'

const hectares = (squareMetres: number) =>
  `${(squareMetres / 10_000).toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ha`

const percent = (value: number, digits = 1) => `${value.toFixed(digits)}%`

const km = (metres: number) => `${(metres / 1000).toFixed(2)} km`

/** A markdown table from a header row and body rows. */
function table(header: string[], rows: string[][]): string[] {
  if (rows.length === 0) return []
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ]
}

/** Two-column field list, the shape most of the form is in. */
const fields = (rows: string[][]) => table(['Field', 'Value'], rows)

function verdictLine(verdict: ObjectiveVerdict): string {
  const achieved = verdict.achieved ? verdict.achieved.label : 'beyond maximum modification'
  return verdict.met
    ? `**Within** — ${percent(verdict.headroomPercent, 2)} of headroom. Reads as ${achieved}.`
    : `**OVER by ${percent(-verdict.headroomPercent, 2)}** — reads as ${achieved}.`
}

/**
 * The worksheet.
 *
 * Every computed figure is followed by what produced it, because the point of
 * the document is that somebody else can check it rather than take it.
 */
export function buildReport({
  result,
  targets,
  thresholds,
  viewpointName,
  generatedAt,
  inventorySource = null,
  inventoryUnit = null,
}: ReportInput): string {
  const byId = new Map(targets.map((target) => [target.id, target]))
  const named = (target: TargetVisibility) => byId.get(target.targetId)?.name ?? target.targetId

  const blocks = result.targets.filter((target) => target.role === 'block')
  const openings = result.targets.filter((target) => target.role === 'harvested')
  const landform = result.targets.find((target) => target.role === 'landscape') ?? null
  const landformTarget = landform ? byId.get(landform.targetId) : null
  const station = result.stations[result.assessmentStationIndex] ?? null

  const lines: string[] = [
    '# Visual Quality Effectiveness Evaluation — desk screening',
    '',
    '*Laid out as FS1252 (2008/04), Forest and Range Evaluation Program, Resource Stewardship Monitoring.*',
    '',
    '> **This is a screening run on FS1252’s layout, not a completed FS1252.** Two differences matter.',
    '>',
    '> FS1252 is a **post-harvest** form: it evaluates an alteration that already exists. Used before the',
    '> fact, as here, the openings assessed are proposed, so every rating below is a prediction rather',
    '> than an evaluation, and section 2.3.6 cannot be completed at all.',
    '>',
    '> **The field half cannot be computed.** The basic visual quality class (2.2.3), four of the five',
    '> design observations (2.2.4) and all of the photography (2.2.2) need somebody at the viewpoint.',
    '> Those are printed as blanks so this can be carried into the field and filled in, not dropped.',
    '',
    '---',
    '',
    '## 2.1.2 Site information (office)',
    '',
    ...fields([
      ['Forest District', OFFICE],
      ['Licensee', OFFICE],
      ['Licence No. / CP No.', OFFICE],
      ['General location', viewpointName],
      ['Block', blocks.length > 0 ? blocks.map(named).join(', ') : '—'],
      ['Results opening ID', OFFICE],
      ['Date of evaluation', `${generatedAt.toISOString().slice(0, 10)} *(desk run, not a field visit)*`],
    ]),
  ]

  lines.push('', '## 2.1.3 VLI information (office)', '')
  if (!landformTarget) {
    lines.push('No landform was supplied, so there is no inventory polygon to record.')
  } else {
    const established = landformTarget.objectiveId ? visualQualityClass(landformTarget.objectiveId) : null
    lines.push(
      ...fields([
        ['Polygon No.', inventoryUnit?.polygonNumber ?? `${named(landform!)} *(drawn, not an inventory polygon)*`],
        ['VAC', landformTarget.vac ? `${landformTarget.vac[0].toUpperCase()}${landformTarget.vac.slice(1)}` : OFFICE],
        ['VSC', inventoryUnit?.vsc ?? OFFICE],
        ['EVC', OFFICE],
        ['Established VQO', established ? `${established.code} — ${established.label}` : OFFICE],
        ['Recommended VQC', OFFICE],
        ['Date of establishment / update', OFFICE],
        ['Source document', inventorySource ?? 'drawn here'],
        ['Scenic area', inventoryUnit ? (inventoryUnit.scenicArea ? 'Yes' : 'No') : OFFICE],
      ]),
      '',
      'The objective above is what this run was assessed against. Where it came from an inventory lookup it is',
      'the polygon’s `REC_EVQO_CODE`; the inventory’s separate *recommended* class is a different field, and a',
      'recommendation is not an established objective.',
    )
  }

  const centre = station ? visibleProposalCentre(result) : null
  const centreDistance = station && centre ? haversineMeters(station, centre) : null

  lines.push('', '## 2.2.1 Viewpoint (field)', '')
  if (!station) {
    lines.push('No corridor was run, so there is no assessment viewpoint.')
  } else {
    const bearing = centre ? bearingDegrees(station, centre) : null
    const distance = centreDistance
    const zone = distance !== null ? viewingZoneFor(distance) : null
    lines.push(
      ...fields([
        ['Viewpoint No.', `station ${result.assessmentStationIndex + 1} of ${result.stations.length}`],
        ['GPS latitude', station.lat.toFixed(5)],
        ['GPS longitude', station.lng.toFixed(5)],
        [
          'Elevation (m)',
          `${station.groundElevationMeters.toFixed(0)} m ground, eye at +${result.settings.observerHeightMeters} m`,
        ],
        [
          'Viewing direction',
          bearing !== null ? `${bearing.toFixed(0)}° ${compassPoint(bearing)}` : 'nothing proposed is in view',
        ],
        [
          'Viewing distance',
          distance !== null ? `${km(distance)}${zone ? ` (${zone.label.toLowerCase()})` : ''}` : '—',
        ],
      ]),
      '',
      'The viewpoint is the station with the worst exposure on the corridor, not an average of it, which is what',
      '"a viewpoint that is representative of significant public viewing opportunities" asks for. Direction and',
      'distance are to the centre of the *visible* parts of the proposal — on a partly screened block that is not',
      'its centroid, and pointing at the centroid would aim at ground nobody can see.',
    )
  }

  const importance = viewpointImportance(result)
  lines.push('', '## 2.2.2 Photography (field)', '')
  lines.push(
    ...fields([
      ['Roll No. / ID Nos.', FIELD],
      ['Digital photo ID Nos.', FIELD],
      ['Field of view, width × height', FIELD],
      ['Viewpoint description', FIELD],
      [
        'Viewpoint importance',
        importance.rating === null
          ? 'not rated — nothing proposed is visible from the corridor'
          : `**at least ${importance.rating}** — ${importance.label.toLowerCase()}`,
      ],
    ]),
  )
  if (importance.rating !== null) {
    lines.push(
      '',
      `Derived, not observed: the proposal is in view over ${km(importance.exposedLengthMeters)} of the corridor, which`,
      `is ${importance.exposedSeconds.toFixed(0)} s at an assumed ${importance.assumedSpeedKmh} km/h, and`,
      `${percent(importance.towardFraction * 100, 0)} of the stations that see it are travelling towards it.`,
      '',
      '**A floor, not the answer.** The form’s levels 4 and 5 are what the viewpoint *is* — a rest stop or campsite,',
      'a community or a tourism operation — which no terrain model knows. A ten-second glimpse from a campground',
      'is still a 4. Raise this by hand where the land use says so.',
    )
  }

  lines.push(
    '',
    '## 2.2.3 Assess basic VQC (field)',
    '',
    `Basic VQC: ${FIELD}`,
    '',
    'Not computable. This is the judgement of whether the alteration meets a class *definition* — difficult to',
    'see, natural in appearance, not angular or geometric — made by eye from the viewpoint against Table 1. The',
    'percentages further down are the other half of the test and do not substitute for it.',
  )

  const nearest = blocks.reduce<number | null>((closest, block) => {
    if (block.nearestVisibleDistanceMeters === null) return closest
    return closest === null ? block.nearestVisibleDistanceMeters : Math.min(closest, block.nearestVisibleDistanceMeters)
  }, null)
  const designDistance = designDistanceScore(nearest)
  lines.push('', '## 2.2.4 Design observations (field)', '')
  lines.push(
    ...table(
      ['Design element', 'Grade', 'Score'],
      [
        ['1. Response to major lines of force', FIELD, FIELD],
        ['2. Borrowing from natural character', FIELD, FIELD],
        ['3. Incorporating edge treatment', FIELD, FIELD],
        [
          '4. Distance between alteration and viewpoint',
          designDistance ? `**${designDistance.grade}** (${designDistance.band})` : '—',
          designDistance ? `**${designDistance.score > 0 ? '+' : ''}${designDistance.score}**` : '—',
        ],
        ['5. Position of opening on the landform', FIELD, FIELD],
        ['**Total design**', '', FIELD],
      ],
    ),
    '',
    designDistance
      ? `Element 4 is the one measurement among five judgements, so it is the only one this can supply. It is` +
          ` measured to the **nearest** visible ground, ${km(nearest!)} away` +
          (centreDistance !== null && Math.abs(centreDistance - nearest!) > 500
            ? `, not to the centre of the proposal at ${km(centreDistance)} as in 2.2.1 above. The two differ because` +
              ' the proposal is spread over a range of distances, and the closest part is what a viewer notices, so' +
              ' it is the conservative one to grade on.'
            : '.')
      : 'Element 4 needs a visible block to measure to; nothing proposed is in view.',
  )

  const partialCuts = blocks.flatMap((block) => {
    const source = byId.get(block.targetId)
    const clearcut = source?.clearcutPercent
    if (typeof clearcut !== 'number' || clearcut >= 100) return []
    const removed = 100 - clearcut
    const height = block.vegHeightMeters
    if (height === null) return []
    const equivalent = partialCutEquivalentPercent(removed, height)
    if (equivalent === null) return []
    return [[named(block), percent(removed, 0), `${height.toFixed(1)} m`, percent(equivalent, 1)]]
  })
  lines.push('', '## 2.3.4 Partial cut alterations', '')
  if (partialCuts.length === 0) {
    lines.push(
      'No partial cuts in this run — every proposed opening is treated as a clearcut, which is the heavier',
      'reading. Where a block is a partial cut, its Table 4 clearcut equivalent belongs on line 2.3.2 (a)',
      'in place of its full area.',
    )
  } else {
    lines.push(
      ...table(['Block', 'Volume removed', 'Residual height', 'Clearcut equivalent'], partialCuts),
      '',
      'FS1252 Table 4, read at the nearest cell. The equivalent is what belongs on line 2.3.2 (a) for that block,',
      'not its full area: a partial cut reads as a smaller alteration than the ground it covers.',
    )
  }

  lines.push('', '## 2.3.2 Assess initial VQC (office)', '')
  if (!landformTarget || !result.perspectiveAlteration) {
    lines.push(
      'Not computed. The 2013 guide requires alteration to be applied to "readily identifiable landforms (not',
      'applied against an entire visible landscape)", and this run has no denominator to divide by.',
    )
  } else {
    const x = result.perspectiveAlteration
    const initial = classifyAlteration(x.cumulativePercent, 'perspective', thresholds)
    lines.push(
      ...fields([
        ['a) % of landform altered by recent openings', `**${percent(x.proposedPercent, 2)}**`],
        ['b) % of landform with site disturbance outside openings', `${OFFICE} — not modelled, see below`],
        ['c) % non-veg contribution of old openings', `**${percent(x.existingPercent, 2)}**`],
        ['**X = (a + b + c)**', `**${percent(x.cumulativePercent, 2)}**`],
        ['**Initial VQC**', initial ? `**${initial.code} — ${initial.label}**` : '**beyond maximum modification**'],
      ]),
      '',
      '**How the run maps onto (a) and (c).** FS1252 is post-harvest, so its (a) is openings already on the ground',
      'and (c) is older ones that have not yet greened up. This run is pre-harvest: (a) carries the blocks under',
      'consideration — what would *become* the recent openings — and (c) the existing openings that have not',
      openings.length === 0
        ? 'reached green-up. No existing openings were supplied, so (c) is zero because none were found, not because none exist.'
        : `reached green-up, ${result.recoveredOpeningCount} of ${openings.length} having been excluded as recovered.`,
      '',
      ...(landform && landform.sampleAreaMeters > 0
        ? [
            '',
            '**How the areas were measured.** The protocol calls for a planimeter or a GIS area computation and warns',
            `off dot-grid estimates. This is a grid, but a dense one: the landform carries ${landform.sampleCount.toLocaleString('en-CA')} samples at`,
            `${hectares(landform.sampleAreaMeters)} of ground each, and a block is counted the same way. A figure is only ever as`,
            'fine as that spacing.',
          ]
        : []),
      '',
      '**(b) is a real gap, not a rounding one.** Roads, landings and side cast outside the openings are not in',
      'this model, and on steep ground a road can read as heavily as the block it serves. X below is therefore a',
      'floor. Page 4 of the form also excludes non-green ground — rock, snow, ice — from the denominator, which',
      landform?.forestedAreaMeters !== null && landform?.forestedAreaMeters !== undefined
        ? 'this run does, from the vegetation inventory.'
        : 'this run does **not**, for want of an inventory, so the figure reads low on a partly bare landform.',
    )

    const verdict = assessObjective(x.cumulativePercent, landformTarget.objectiveId, 'perspective', thresholds)
    lines.push('', `**Against the established objective:** ${verdictLine(verdict)}`)
  }

  lines.push('', '## 2.3.3 Assess adjusted VQC (office)', '')
  lines.push(
    ...fields([
      [
        'd) Impact of roads, side cast etc. (within openings)',
        `${FIELD} — none 0, subordinate 1, significant 2, dominant 3`,
      ],
      ['e) Tree retention', `${FIELD} — good (>22%) −2, moderate (15–22%) −1, poor (<15%) 0`],
      ['f) Design (total from 2.2.4)', `${FIELD} — −5 to +5`],
      ['**Total adjustment Y = (d + e + f)**', FIELD],
      ['**Adjusted % alteration = X × (1 + 0.14 Y)**', FIELD],
    ]),
  )
  if (result.perspectiveAlteration && landformTarget) {
    const x = result.perspectiveAlteration.cumulativePercent
    const verdict = assessObjective(x, landformTarget.objectiveId, 'perspective', thresholds)
    lines.push(
      '',
      `At Y = 0 the adjusted figure is X itself, ${percent(x, 2)}. Each point of Y moves it by`,
      `${percent(0.14 * x, 2)}, and Y can run from −7 to +8, so the adjustment spans`,
      `${percent(adjustedAlterationPercent(x, -7), 2)} to ${percent(adjustedAlterationPercent(x, 8), 2)}.`,
      'The adjustment dominates the measurement, which is why nothing here guesses at it.',
    )
    if (!verdict.met && x > 0) {
      const needed = (verdict.thresholdPercent / x - 1) / 0.14
      lines.push(
        '',
        // Typeset with the same minus sign as the ranges around it.
        `> **X is over, so the adjustment has to carry it.** Y would have to reach ${needed.toFixed(1).replace('-', '−')} or lower to`,
        `> bring the adjusted figure within ${percent(verdict.thresholdPercent, 0)}.`,
      )
    }
    lines.push(
      '',
      '**The adjustment can overwhelm the measurement.** At Y = −7 the multiplier is 0.02, so the most favourable',
      'adjustment the form allows takes almost any X inside almost any objective. Reaching it means no road impact',
      'at all (d = 0), good retention above 22% (e = −2), and all five design elements graded good (f = −5) — a',
      'combination worth being sceptical of. The percentage above is the measurable half; whether the alteration',
      'is *actually* difficult to see is 2.2.3, and it is a field judgement.',
    )
  }

  lines.push(
    '',
    '## 2.3.6 EE rating',
    '',
    `Rating: ${FIELD}`,
    '',
    'Cannot be completed from a desk run. The rating compares **two** methods — the basic VQC judged by eye in',
    'the field against the adjusted VQC computed in the office — and scores 1 to 5 on whether they agree:',
    '',
    ...table(
      ['', 'Rating', 'When'],
      [
        ['1', 'Clearly not met', 'Neither method indicates achievement, both far from the class boundary'],
        ['2', 'Not met', 'Neither indicates achievement, but both close to the boundary'],
        ['3', 'Borderline', 'One method indicates achievement, one does not'],
        ['4', 'Met', 'Both indicate achievement, but one or both near the maximum % limit'],
        ['5', 'Well met', 'Both indicate achievement, at the lower limit or mid-range for the class'],
      ],
    ),
    '',
    'This run supplies the office half only. The field half needs a person at the viewpoint, and until it exists',
    'the rating is undetermined — not provisionally 3.',
  )

  lines.push('', '## 2.3.7 Allowance for over-ride', '', `Over-ride EE: ${OFFICE}`, '', `Rationale: ${OFFICE}`)

  lines.push('', '---', '', '# Supporting figures', '')
  lines.push('These are not fields on FS1252. They are what the run produced that bears on the figures above.', '')

  lines.push('## The run', '')
  lines.push(
    ...fields([
      ['Generated', `${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`],
      ['Corridor', `${viewpointName} — ${km(result.corridorLengthMeters)}, ${result.stations.length} stations`],
      ['Terrain', `AWS Terrarium, ${result.demResolutionMeters.toFixed(0)} m posts, ${result.demTileCount} tiles`],
      ['Maximum view distance', km(result.settings.maxViewDistanceMeters)],
      [
        'Screening',
        result.canopyCoverageFraction === null
          ? 'off — bare earth, so timber that would hide a block does not'
          : `VRI rank-1 stand height over ${percent(result.canopyCoverageFraction * 100, 0)} of the area, ` +
            `${result.canopyStandCount} stands`,
      ],
      ['Run time', `${(result.elapsedMs / 1000).toFixed(1)} s`],
    ]),
  )

  if (result.missingTileCount > 0) {
    lines.push(
      '',
      `> ⚠ ${result.missingTileCount} of ${result.demTileCount} terrain tiles did not load. Ground the mosaic is`,
      '> missing never blocks a sightline, so those parts read as more visible than they are.',
    )
  }

  if (landform && landformTarget) {
    lines.push('', '## The landform divided by', '')
    lines.push(
      ...fields([
        ['Landform', named(landform)],
        ['Area', hectares(landform.areaMeters)],
        [
          'Forested area',
          landform.forestedAreaMeters !== null
            ? `${hectares(landform.forestedAreaMeters)} — ${percent(
                (landform.forestedAreaMeters / Math.max(1, landform.areaMeters)) * 100,
                0,
              )} treed, from VRI rank-1 BCLCS level 2`
            : 'whole landform — no vegetation inventory',
        ],
        [
          'Visible from the viewpoint',
          `${hectares(landform.visibleAreaMeters)} (${percent(landform.visiblePercent, 0)})`,
        ],
      ]),
    )
  }

  if (result.planimetricAlteration && landformTarget) {
    const planimetric = result.planimetricAlteration
    const verdict = assessObjective(
      planimetric.cumulativePercent,
      landformTarget.objectiveId,
      'planimetric',
      thresholds,
    )
    const allowance = landformTarget.vac
      ? `${vacDenudationPercent(landformTarget.objectiveId, landformTarget.vac)}% (1998 procedures, Table 4 — denudation by VAC)`
      : `${verdict.thresholdPercent}%`
    lines.push('', '## Planimetric denudation', '')
    lines.push(
      ...fields([
        ['Existing', percent(planimetric.existingPercent, 2)],
        ['Proposed', percent(planimetric.proposedPercent, 2)],
        ['**Cumulative**', `**${percent(planimetric.cumulativePercent, 2)}**`],
        ['Allowed', allowance],
        ['Verdict', verdictLine(verdict)],
      ]),
      '',
      'Not an FS1252 figure. Flat map area, visible or not — the scale timber supply analyses model against,',
      'from *Procedures for Factoring Visual Resources into Timber Supply Analyses* (1998). Note that document',
      'has its own Table 4, denudation by VAC, which is a different table from the FS1252 Table 4 used above.',
    )

    if (result.perspectiveAlteration) {
      const perspective = assessObjective(
        result.perspectiveAlteration.cumulativePercent,
        landformTarget.objectiveId,
        'perspective',
        thresholds,
      )
      if (perspective.met !== verdict.met) {
        lines.push(
          '',
          `> ⚠ **The two scales disagree.** Perspective view says ${perspective.met ? 'within' : 'over'} and`,
          `> planimetric says ${verdict.met ? 'within' : 'over'}. The objective is defined on the perspective`,
          '> scale, so that is the one that governs; the planimetric figure is a timber-supply proxy.',
        )
      }
    }
  }

  lines.push('', '## Proposed blocks', '')
  lines.push(
    ...table(
      ['Block', 'Area', 'Visible', 'Apparent share', 'Nearest', 'Mean slope', 'Green-up height'],
      blocks.map((block) => [
        named(block),
        hectares(block.areaMeters),
        block.outOfRange
          ? 'out of range'
          : `${hectares(block.visibleAreaMeters)} (${percent(block.visiblePercent, 0)})`,
        percent(block.apparentVisiblePercent, 1),
        block.nearestVisibleDistanceMeters !== null ? km(block.nearestVisibleDistanceMeters) : '—',
        block.meanSlopePercent !== null ? percent(block.meanSlopePercent, 0) : '—',
        block.vegHeightMeters !== null ? `${block.vegHeightMeters.toFixed(1)} m` : '—',
      ]),
    ),
  )
  lines.push(
    '',
    'Green-up height is 1998 Table 6, area-weighted over each block’s own slope classes rather than',
    'read off its mean slope. It is the height regeneration must reach, not a time.',
  )

  if (openings.length > 0) {
    lines.push('', '## Existing openings counted', '')
    lines.push(
      ...table(
        ['Opening', 'Harvested', 'Counts as', 'Visible'],
        openings.map((opening) => {
          const source = byId.get(opening.targetId)
          return [
            named(opening),
            source?.harvestYear ? String(source.harvestYear) : 'unknown',
            opening.recovered
              ? `recovered (past ${result.settings.greenUpAgeYears} yr green-up)`
              : `${percent(opening.alterationWeight * 100, 0)} of its area`,
            opening.visiblePercent > 0 ? percent(opening.visiblePercent, 0) : 'not visible',
          ]
        }),
      ),
      '',
      `Green-up age is **${result.settings.greenUpAgeYears} years**, a stated planning assumption — the references`,
      'give the green-up *height* a slope needs, not how long a site takes to reach it. ' +
        `${result.recoveredOpeningCount} of ${openings.length} openings were excluded as recovered.`,
    )
  }

  lines.push(
    '',
    '## What this run does not model',
    '',
    '- Bare-earth terrain from a 1-arc-second DEM. Roadside cut-and-fill, retention inside a block,',
    '  and understorey are not in it. This is FS1252 line 2.3.2 (b), left blank above.',
    result.canopyCoverageFraction === null
      ? '- Standing timber is **not** modelled in this run, so a block screened in reality by leave trees reads as visible.'
      : '- Screening uses projected stand height only. There is no transmission model, so a thin canopy screens as a solid one.',
    '- Percentages are the numeric half of the test. The Forest Planning and Practices Regulation also',
    '  turns on scale, shape and whether an alteration is natural in appearance, which no number settles —',
    '  that is what FS1252 2.2.3 and 2.2.4 are for, and they need a field visit.',
    '- Sightlines include earth curvature and standard atmospheric refraction; they do not model',
    '  atmospheric haze, lighting, season, or snow.',
    '- One viewpoint. FS1252 says to repeat the calculation for each viewpoint selected for evaluation;',
    '  this reports the worst station on one corridor.',
    '',
  )

  return lines.join('\n')
}
