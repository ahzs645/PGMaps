import { Button } from '@/components/ui/button'
import { OptionalNumberField } from './Controls'
import { inputMessage, type InvalidInput } from './inputErrors'
import { ROCK_CUT_DEFAULTS, ROCK_CUT_KEYS, ROCK_CUT_LABELS, ROCK_CUT_LIMITS } from './rockExcavation'
import type { RockCutTemplate, RoadTemplate } from './types'

const FIELD_LABELS: Record<keyof RockCutTemplate, string> = {
  cutSlope: 'Rock batter (H:V)',
  ledgeWidthM: 'Rock ledge (m)',
  blastDepthM: 'Blasting depth (m)',
  blastCrossfallPercent: 'Blasting fall (%)',
  drainageCrossfallPercent: 'Drainage fall (%)',
  shallowDepthM: 'Shallow rock (m)',
}
const PLACEHOLDERS: Partial<Record<keyof RockCutTemplate, string>> = {
  cutSlope: 'cut batter',
  blastCrossfallPercent: '10',
  drainageCrossfallPercent: '−25',
}

/** One line for a folded section: what the template does in rock. */
export function rockCutSummary(template: RoadTemplate): string {
  const rock = template.rockCut
  if (!rock && !template.leftRockCut && !template.rightRockCut) return 'Off'
  if (!rock) return 'Side values'
  const parts = [
    rock.ledgeWidthM ? `ledge ${rock.ledgeWidthM} m` : null,
    rock.blastDepthM !== undefined ? `blast ${rock.blastDepthM} m` : null,
    rock.shallowDepthM !== undefined ? `shallow ≤ ${rock.shallowDepthM} m` : null,
  ].filter(Boolean)
  return parts.join(' · ') || 'On'
}

/**
 * The template's rock cut: batter, ledge, blasting level and shallow-rock depth, each blank for off.
 * It acts only where a ground horizon's material is marked rock (Engineering → Ground).
 */
export function RockCutFields({
  template,
  onChange,
  problem,
  list = 'template',
  id,
}: {
  template: RoadTemplate
  onChange: (rockCut: RockCutTemplate | undefined) => void
  problem?: InvalidInput
  list?: 'template' | 'templates'
  id?: string
}) {
  const rock = template.rockCut
  const sided = !!(template.leftRockCut || template.rightRockCut)
  if (!rock)
    return (
      <div className="space-y-1.5">
        <p className="text-2xs text-muted-foreground">
          {sided
            ? 'This template has side-specific rock values from a project file; they apply as saved.'
            : 'Rock horizons are cut at the material’s or the template’s batter, with no ledge or blasting level.'}
        </p>
        <Button size="sm" variant="outline" onClick={() => onChange({ ...ROCK_CUT_DEFAULTS })}>
          Cut rock with this template
        </Button>
      </div>
    )
  return (
    <div className="space-y-1.5" data-testid="road-rock-cut">
      <div className="grid grid-cols-2 items-end gap-x-2 gap-y-1.5">
        {ROCK_CUT_KEYS.map((key) => {
          const [min, max] = ROCK_CUT_LIMITS[key]
          return (
            <OptionalNumberField
              key={key}
              label={FIELD_LABELS[key]}
              value={rock[key] ?? null}
              min={min}
              max={max}
              placeholder={PLACEHOLDERS[key] ?? 'off'}
              hint={`${ROCK_CUT_LABELS[key][0].toUpperCase()}${ROCK_CUT_LABELS[key].slice(1)}, ${min} to ${max}. Blank is ${PLACEHOLDERS[key] ? `the default (${PLACEHOLDERS[key]})` : 'off'}.`}
              error={inputMessage(problem, list, id, `rockCut.${key}`)}
              onChange={(value) => {
                const next = { ...rock }
                if (value === null) delete next[key]
                else next[key] = value
                onChange(next)
              }}
            />
          )
        })}
      </div>
      <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
        Stop cutting rock with this template
      </Button>
    </div>
  )
}
