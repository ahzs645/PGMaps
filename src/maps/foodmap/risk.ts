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

// Specific, actively-observed hazards (as opposed to the generic "may lead to
// foodborne illness" boilerplate that appears in nearly every NHA write-up).
// Only these escalate a known code's band — boilerplate must not.
const ACTIVE_PEST_SIGNAL = /\b(droppings?|infestation|gnaw\w*|nesting|live\s+(mice|mouse|rodent|cockroach|insect|pest))\b/i

const EMPTY_SUMMARY: ViolationRiskSummary = {
  severe: 0,
  elevated: 0,
  moderate: 0,
  administrative: 0,
  unknown: 0,
  score: 0,
  worstBand: 'Unknown'
}

// Corrective-action text is regulatory boilerplate ("an operator must ensure…
// to prevent foodborne illness") that mentions contamination on almost every
// row. Risk signals are read from the description + observation only; the full
// text is used solely for repeat detection.
function riskSignalText(violation: Violation): string {
  return [violation.description || '', violation.observation || '']
    .join(' ')
    .toLowerCase()
}

function fullText(violation: Violation): string {
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
  const code = String(violation.code || '').trim()
  const codeRule = CODE_RULES[code]
  const signal = riskSignalText(violation)

  let band: ViolationRiskBand
  let category: ViolationRiskCategory

  if (codeRule) {
    // The code is the authoritative classifier. Keep its category, and only let a
    // specific, actively-observed pest hazard raise the band — generic "may lead
    // to foodborne illness" boilerplate (which appears on almost every row) does
    // not escalate, so a chemical-storage or facility issue no longer collapses
    // into "Severe / Contamination".
    band = codeRule.band
    category = codeRule.category
    if (ACTIVE_PEST_SIGNAL.test(signal)) {
      band = maxBand(band, 'Severe')
    }
  } else {
    // Unknown code — keyword inference on description + observation is the best
    // signal available.
    const inferred = inferFallbackRisk(signal)
    band = inferred.band
    category = inferred.category
  }

  const isRepeat = Boolean(violation.is_repeat) || REPEAT_KEYWORDS.test(fullText(violation))
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

export type RiskColorMode = 'light' | 'dark'

const RISK_BAND_COLORS: Record<RiskColorMode, Record<ViolationRiskBand | 'None', string>> = {
  light: {
    Severe: '#e5484d',
    Elevated: '#f76b15',
    Moderate: '#ffe629',
    Administrative: '#0090ff',
    Unknown: '#8b8d98',
    None: '#30a46c'
  },
  dark: {
    Severe: '#ec5d5e',
    Elevated: '#ff801f',
    Moderate: '#ffff57',
    Administrative: '#3b9eff',
    Unknown: '#777b84',
    None: '#33b074'
  }
}

export function getRiskBandColor(
  band: ViolationRiskBand,
  hasViolations = true,
  colorMode: RiskColorMode = 'light'
): string {
  const palette = RISK_BAND_COLORS[colorMode]
  if (!hasViolations) return palette.None
  return palette[band] || palette.Unknown
}

export function getRiskBandLabel(band: ViolationRiskBand, hasViolations = true): string {
  if (!hasViolations) return 'No violations'
  if (band === 'Severe') return 'Severe risk'
  if (band === 'Elevated') return 'Elevated risk'
  if (band === 'Moderate') return 'Moderate risk'
  if (band === 'Administrative') return 'Administrative'
  return 'Unclassified'
}
