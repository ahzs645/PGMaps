import type {
  Inspection,
  Violation,
  ViolationRiskAssessment,
  ViolationRiskBand,
  ViolationRiskCategory,
  ViolationRiskSummary
} from './types'

interface RiskRule {
  band: ViolationRiskBand
  category: ViolationRiskCategory
}

const BAND_ORDER: ViolationRiskBand[] = ['Unknown', 'Administrative', 'Moderate', 'Elevated', 'Severe']
const BAND_BASE_SCORE: Record<ViolationRiskBand, number> = {
  Unknown: 2,
  Administrative: 1,
  Moderate: 4,
  Elevated: 7,
  Severe: 10
}

const CODE_RULES: Record<string, RiskRule> = {
  // Administrative and documentation
  '101': { band: 'Administrative', category: 'Administrative' },
  '102': { band: 'Administrative', category: 'Administrative' },
  '103': { band: 'Administrative', category: 'Administrative' },
  '104': { band: 'Administrative', category: 'Administrative' },
  '105': { band: 'Administrative', category: 'Administrative' },
  '212': { band: 'Administrative', category: 'Administrative' },
  '314': { band: 'Administrative', category: 'Administrative' },
  '501': { band: 'Administrative', category: 'Administrative' },
  '502': { band: 'Administrative', category: 'Administrative' },

  // Acute food safety and contamination risks
  '201': { band: 'Severe', category: 'Contamination' },
  '202': { band: 'Severe', category: 'Contamination' },
  '203': { band: 'Severe', category: 'Temperature Control' },
  '204': { band: 'Severe', category: 'Temperature Control' },
  '205': { band: 'Severe', category: 'Temperature Control' },
  '206': { band: 'Severe', category: 'Temperature Control' },
  '207': { band: 'Severe', category: 'Contamination' },
  '209': { band: 'Severe', category: 'Contamination' },
  '210': { band: 'Severe', category: 'Temperature Control' },
  '211': { band: 'Severe', category: 'Temperature Control' },
  '301': { band: 'Severe', category: 'Sanitization & Hygiene' },
  '302': { band: 'Severe', category: 'Sanitization & Hygiene' },
  '303': { band: 'Severe', category: 'Sanitization & Hygiene' },
  '304': { band: 'Severe', category: 'Pest Control' },
  '401': { band: 'Severe', category: 'Sanitization & Hygiene' },
  '402': { band: 'Severe', category: 'Sanitization & Hygiene' },

  // Indirect but important control risks
  '305': { band: 'Elevated', category: 'Pest Control' },
  '306': { band: 'Elevated', category: 'Sanitization & Hygiene' },
  '307': { band: 'Elevated', category: 'Facility & Equipment' },
  '308': { band: 'Elevated', category: 'Facility & Equipment' },
  '309': { band: 'Elevated', category: 'Chemical Safety' },
  '311': { band: 'Elevated', category: 'Facility & Equipment' },
  '312': { band: 'Moderate', category: 'Facility & Equipment' },
  '313': { band: 'Elevated', category: 'Contamination' },
  '315': { band: 'Moderate', category: 'Facility & Equipment' },
  '403': { band: 'Moderate', category: 'Sanitization & Hygiene' }
}

const ADMIN_KEYWORDS = /\b(permit|posted|conspicuous|plan|approved|approval|foodsafe|training|certificate|remote inspection|written procedures)\b/i
const PEST_KEYWORDS = /\b(pest|mice|mouse|rodent|droppings?|infestation|cockroach|flies?|harbourage)\b/i
const CONTAMINATION_KEYWORDS = /\b(contaminat|cross[\s-]?contamin|foodborne|not protected|unsafe handling)\b/i
const TEMPERATURE_KEYWORDS = /\b(thaw|cool|cooling|reheat|reheating|hot hold|cold hold|danger zone|temperature|thermometer|4\s*°?\s*c|60\s*°?\s*c|-18\s*°?\s*c)\b/i
const HYGIENE_KEYWORDS = /\b(hand\s?wash|paper towel|soap|saniti[sz]er|chlorine|quat|ppm|dishwasher|dish washer|utensil)\b/i
const CHEMICAL_KEYWORDS = /\b(chemical|bleach|cleanser|labelled?|labeling)\b/i
const REPEAT_KEYWORDS = /\brepeat\b/i

const EMPTY_SUMMARY: ViolationRiskSummary = {
  severe: 0,
  elevated: 0,
  moderate: 0,
  administrative: 0,
  unknown: 0,
  score: 0,
  worstBand: 'Unknown'
}

function normalizeText(violation: Violation): string {
  return [
    violation.description || '',
    violation.observation || '',
    violation.corrective_action || ''
  ]
    .join(' ')
    .toLowerCase()
}

function maxBand(a: ViolationRiskBand, b: ViolationRiskBand): ViolationRiskBand {
  const ai = BAND_ORDER.indexOf(a)
  const bi = BAND_ORDER.indexOf(b)
  return bi > ai ? b : a
}

function inferFallbackRisk(text: string): RiskRule {
  if (ADMIN_KEYWORDS.test(text)) return { band: 'Administrative', category: 'Administrative' }
  if (PEST_KEYWORDS.test(text)) return { band: 'Elevated', category: 'Pest Control' }
  if (TEMPERATURE_KEYWORDS.test(text)) return { band: 'Severe', category: 'Temperature Control' }
  if (CONTAMINATION_KEYWORDS.test(text)) return { band: 'Severe', category: 'Contamination' }
  if (HYGIENE_KEYWORDS.test(text)) return { band: 'Elevated', category: 'Sanitization & Hygiene' }
  if (CHEMICAL_KEYWORDS.test(text)) return { band: 'Elevated', category: 'Chemical Safety' }
  return { band: 'Unknown', category: 'Other' }
}

export function assessViolationRisk(violation: Violation): ViolationRiskAssessment {
  const text = normalizeText(violation)
  const code = String(violation.code || '').trim()
  const baseRule = CODE_RULES[code] || inferFallbackRisk(text)
  let band = baseRule.band
  let category = baseRule.category

  // Escalate ambiguous records ("Repeat", "Critical") using observation text.
  if (PEST_KEYWORDS.test(text)) {
    band = maxBand(band, text.includes('dropping') || text.includes('infestation') ? 'Severe' : 'Elevated')
    category = 'Pest Control'
  }

  if (CONTAMINATION_KEYWORDS.test(text)) {
    band = maxBand(band, 'Severe')
    category = 'Contamination'
  }

  if (TEMPERATURE_KEYWORDS.test(text)) {
    band = maxBand(band, 'Severe')
    category = 'Temperature Control'
  }

  if (HYGIENE_KEYWORDS.test(text) && band !== 'Administrative') {
    band = maxBand(band, 'Elevated')
    if (category === 'Other') category = 'Sanitization & Hygiene'
  }

  if (CHEMICAL_KEYWORDS.test(text) && band !== 'Administrative') {
    band = maxBand(band, 'Elevated')
    if (category === 'Other') category = 'Chemical Safety'
  }

  // Administrative language should only dominate if there are no stronger risk signals.
  if (ADMIN_KEYWORDS.test(text) && band === 'Unknown') {
    band = 'Administrative'
    category = 'Administrative'
  }

  const isRepeat = REPEAT_KEYWORDS.test(text)
  const isCorrected = Boolean(violation.corrected_during_inspection)
  const score = Math.max(
    1,
    BAND_BASE_SCORE[band] + (isRepeat ? 2 : 0) + (isCorrected ? -1 : 1)
  )

  return { band, category, score }
}

export function createEmptyViolationRiskSummary(): ViolationRiskSummary {
  return { ...EMPTY_SUMMARY }
}

export function summarizeViolationRisk(inspections: Inspection[]): ViolationRiskSummary {
  const summary = createEmptyViolationRiskSummary()

  inspections.forEach((inspection) => {
    ;(inspection.violations || []).forEach((violation) => {
      const risk = assessViolationRisk(violation)

      if (risk.band === 'Severe') summary.severe += 1
      else if (risk.band === 'Elevated') summary.elevated += 1
      else if (risk.band === 'Moderate') summary.moderate += 1
      else if (risk.band === 'Administrative') summary.administrative += 1
      else summary.unknown += 1

      summary.score += risk.score
      summary.worstBand = maxBand(summary.worstBand, risk.band)
    })
  })

  return summary
}

export function getRiskBandColor(band: ViolationRiskBand, hasViolations = true): string {
  if (!hasViolations) return '#22c55e'
  if (band === 'Severe') return '#ef4444'
  if (band === 'Elevated') return '#f97316'
  if (band === 'Moderate') return '#eab308'
  if (band === 'Administrative') return '#3b82f6'
  return '#6b7280'
}

export function getRiskBandLabel(band: ViolationRiskBand, hasViolations = true): string {
  if (!hasViolations) return 'No violations'
  if (band === 'Severe') return 'Severe risk'
  if (band === 'Elevated') return 'Elevated risk'
  if (band === 'Moderate') return 'Moderate risk'
  if (band === 'Administrative') return 'Administrative'
  return 'Unclassified'
}
