/**
 * The run, written up.
 *
 * **This is a screening worksheet, not a visual impact assessment.** Neither
 * reference this page is built from defines a report format: the 2013 guide is a
 * poster of class definitions and the two alteration guides, and the 1998
 * document is procedures for feeding timber supply models. What a submission has
 * to look like lives in the Forest Practices Code *Visual Impact Assessment
 * Guidebook* and in whatever template a district asks for, and this file does
 * not pretend to know either.
 *
 * What it does is lay out, in one page, exactly what the references say an
 * assessment turns on — the landform, the established objective, VAC, percent
 * alteration on both scales against their own thresholds, the assessment
 * viewpoint, green-up, cumulative alteration — each with where the number came
 * from and what it assumes. Somebody writing the real assessment can check every
 * figure; nobody can mistake it for the assessment itself.
 *
 * Markdown on purpose: it is text, so it diffs, pastes into anything, and can be
 * unit-tested line by line.
 */

import type { AlterationBreakdown, AnalysisResult, TargetPolygon, TargetVisibility } from './types'
import {
  assessObjective,
  vacDenudationPercent,
  visualQualityClass,
  type AlterationBasis,
  type ObjectiveVerdict,
  type VisualQualityThresholds,
} from './vqo'

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
}

const hectares = (squareMetres: number) =>
  `${(squareMetres / 10_000).toLocaleString('en-CA', { maximumFractionDigits: 1 })} ha`

const percent = (value: number, digits = 1) => `${value.toFixed(digits)}%`

const km = (metres: number) => `${(metres / 1000).toFixed(2)} km`

/** A markdown table from a header row and body rows, padded for readability. */
function table(header: string[], rows: string[][]): string[] {
  if (rows.length === 0) return []
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ]
}

function verdictLine(verdict: ObjectiveVerdict): string {
  const achieved = verdict.achieved ? verdict.achieved.label : 'beyond maximum modification'
  return verdict.met
    ? `**Within** — ${percent(verdict.headroomPercent, 2)} of headroom. Reads as ${achieved}.`
    : `**OVER by ${percent(-verdict.headroomPercent, 2)}** — reads as ${achieved}.`
}

/**
 * The worksheet.
 *
 * Every figure is followed by what produced it, because the point of the
 * document is that somebody else can check it rather than take it.
 */
export function buildReport({
  result,
  targets,
  thresholds,
  viewpointName,
  generatedAt,
  inventorySource = null,
}: ReportInput): string {
  const byId = new Map(targets.map((target) => [target.id, target]))
  const named = (target: TargetVisibility) => byId.get(target.targetId)?.name ?? target.targetId

  const blocks = result.targets.filter((target) => target.role === 'block')
  const openings = result.targets.filter((target) => target.role === 'harvested')
  const landform = result.targets.find((target) => target.role === 'landscape') ?? null
  const landformTarget = landform ? byId.get(landform.targetId) : null

  const lines: string[] = [
    '# Visual quality screening worksheet',
    '',
    '> **Not a visual impact assessment.** This is a bare-earth (or inventory-screened)',
    '> line-of-sight screening run. It supplies the figures an assessment is built on and',
    '> says where each came from; it does not replace the field review, the design',
    '> rationale, or the visual simulation a submission requires.',
    '',
    ...table(
      ['', ''],
      [
        ['Generated', generatedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
        ['Viewpoint', `${viewpointName} — ${km(result.corridorLengthMeters)}, ${result.stations.length} stations`],
        [
          'Assessment viewpoint',
          `station ${result.assessmentStationIndex + 1} of ${result.stations.length}, at ${km(
            result.stations[result.assessmentStationIndex]?.distanceAlongMeters ?? 0,
          )}`,
        ],
        ['Terrain', `AWS Terrarium, ${result.demResolutionMeters.toFixed(0)} m posts, ${result.demTileCount} tiles`],
        ['Eye height', `${result.settings.observerHeightMeters} m above the road`],
        ['Maximum view distance', km(result.settings.maxViewDistanceMeters)],
        [
          'Screening',
          result.canopyCoverageFraction === null
            ? 'off — bare earth, so timber that would hide a block does not'
            : `VRI rank-1 stand height over ${percent(result.canopyCoverageFraction * 100, 0)} of the area, ` +
              `${result.canopyStandCount} stands`,
        ],
        ['Run time', `${(result.elapsedMs / 1000).toFixed(1)} s`],
      ],
    ),
  ]

  if (result.missingTileCount > 0) {
    lines.push(
      '',
      `> ⚠ ${result.missingTileCount} of ${result.demTileCount} terrain tiles did not load. Ground the mosaic is`,
      '> missing never blocks a sightline, so those parts read as more visible than they are.',
    )
  }

  lines.push('', '## The landform assessed against', '')
  if (!landform || !landformTarget) {
    lines.push(
      'No landform was supplied, so no percent alteration was computed. The 2013 guide requires',
      'alteration to be applied to "readily identifiable landforms (not applied against an entire',
      'visible landscape)", and this run has no denominator to divide by.',
    )
  } else {
    const objective = visualQualityClass(landformTarget.objectiveId)
    lines.push(
      ...table(
        ['', ''],
        [
          ['Landform', named(landform)],
          ['Established objective', `${objective.code} — ${objective.label}`],
          [
            'Visual absorption capability',
            landformTarget.vac
              ? `${landformTarget.vac[0].toUpperCase()}${landformTarget.vac.slice(1)}`
              : 'Not rated (class maximum used)',
          ],
          ['Area', hectares(landform.areaMeters)],
          [
            'Forested area (denudation base)',
            landform.forestedAreaMeters !== null
              ? `${hectares(landform.forestedAreaMeters)} — ${percent(
                  (landform.forestedAreaMeters / Math.max(1, landform.areaMeters)) * 100,
                  0,
                )} treed, from VRI rank-1 BCLCS level 2`
              : 'whole landform — no vegetation inventory, so the planimetric figure below reads low',
          ],
          [
            'Visible from the viewpoint',
            `${hectares(landform.visibleAreaMeters)} (${percent(landform.visiblePercent, 0)})`,
          ],
          ['Source', inventorySource ?? 'drawn here'],
        ],
      ),
    )
  }

  lines.push('', '## Percent alteration', '')
  if (!landformTarget) {
    lines.push('Not computed — see above.')
  } else {
    const scales: Array<[AlterationBasis, string, AlterationBreakdown | null, string]> = [
      [
        'perspective',
        'Perspective view',
        result.perspectiveAlteration,
        'The scale the objective is defined on: the share of the landform’s visible face that reads as ' +
          'altered, measured from the assessment viewpoint.',
      ],
      [
        'planimetric',
        'Planimetric denudation',
        result.planimetricAlteration,
        'Flat map area, visible or not — the scale timber supply analyses model against. ' +
          (landform?.forestedAreaMeters !== null && landform?.forestedAreaMeters !== undefined
            ? 'Divided by the landform’s treed area, per the 1998 procedure.'
            : 'Divided by the whole landform: no inventory, so this reads low.'),
      ],
    ]

    for (const [basis, title, breakdown, note] of scales) {
      lines.push(`### ${title}`, '')
      if (!breakdown) {
        lines.push('Not computed.', '')
        continue
      }
      const verdict = assessObjective(breakdown.cumulativePercent, landformTarget.objectiveId, basis, thresholds)
      const allowance =
        basis === 'planimetric' && landformTarget.vac
          ? `${vacDenudationPercent(landformTarget.objectiveId, landformTarget.vac)}% (1998 Table 4, VAC ${
              landformTarget.vac
            })`
          : `${verdict.thresholdPercent}%`

      lines.push(
        ...table(
          ['', ''],
          [
            ['Existing', percent(breakdown.existingPercent, 2)],
            ['Proposed', percent(breakdown.proposedPercent, 2)],
            ['**Cumulative**', `**${percent(breakdown.cumulativePercent, 2)}**`],
            ['Allowed', allowance],
            ['Verdict', verdictLine(verdict)],
          ],
        ),
        '',
        note,
        '',
      )
    }

    if (result.perspectiveAlteration && result.planimetricAlteration) {
      const perspective = assessObjective(
        result.perspectiveAlteration.cumulativePercent,
        landformTarget.objectiveId,
        'perspective',
        thresholds,
      )
      const planimetric = assessObjective(
        result.planimetricAlteration.cumulativePercent,
        landformTarget.objectiveId,
        'planimetric',
        thresholds,
      )
      if (perspective.met !== planimetric.met) {
        lines.push(
          `> ⚠ **The two scales disagree.** Perspective view says ${perspective.met ? 'within' : 'over'} and`,
          `> planimetric says ${planimetric.met ? 'within' : 'over'}. The objective is defined on the perspective`,
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
    '  and understorey are not in it.',
    result.canopyCoverageFraction === null
      ? '- Standing timber is **not** modelled in this run, so a block screened in reality by leave trees reads as visible.'
      : '- Screening uses projected stand height only. There is no transmission model, so a thin canopy screens as a solid one.',
    '- Percentages are the numeric half of the test. The Forest Planning and Practices Regulation also',
    '  turns on scale, shape and whether an alteration is natural in appearance, which no number settles.',
    '- Sightlines include earth curvature and standard atmospheric refraction; they do not model',
    '  atmospheric haze, lighting, season, or snow.',
    '',
  )

  return lines.join('\n')
}
