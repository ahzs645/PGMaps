import type { Violation } from './types'
import { assessViolationRisk } from './risk'

/**
 * Canonical rule text for NHA HealthSpace violation codes.
 *
 * HealthSpace omits the rule text for a large share of rows, leaving only a
 * "Critical"/"Repeat" status badge in the description column (~55% of records).
 * This map is recovered from the dataset itself — the most common descriptive
 * text seen for each code — so junk rows can be backfilled with the real rule
 * text whenever the same code carries it elsewhere.
 *
 * Generated from public/data/restaurants.json. Codes that NEVER appear with
 * descriptive text in the source (e.g. 201-207, 301-303, 401-402) are absent
 * here on purpose — we do not invent official regulatory wording for them; they
 * fall back to a category-derived label (see normalizeViolation).
 */
export const VIOLATION_CODE_DESCRIPTIONS: Record<string, string> = {
  '101': 'Plans/construction/alterations not in accordance with the Regulation [s. 3; s. 4]',
  '102': 'Operation of an unapproved food premises [s. 6(1)]',
  '103': 'Failure to hold a valid permit while operating a food service establishment [s. 8(1)]',
  '104': 'Permit not posted in a conspicuous location [s. 8(7)]',
  '105': 'Remote Inspection',
  '209': 'Food not protected from contamination [s. 12(a)]',
  '210': 'Food not thawed in an acceptable manner [s. 14(2)]',
  '211': 'Frozen potentially hazardous food stored/displayed above -18 °C. [s. 14(3)]',
  '212': 'Operator has not provided acceptable written food handling procedures [s. 23]',
  '304': 'Premises not free of pests [s. 26(a)]',
  '305': 'Conditions observed that may allow entrance/harbouring/breeding of pests [s. 26(b),(c)]',
  '306': 'Food premises not maintained in a sanitary condition [s. 17(1)]',
  '307': 'Equipment/utensils/food contact surfaces are not of suitable design/material [s. 16; s. 19]',
  '308': 'Equipment/utensils/food contact surfaces are not in good working order [s. 16(b)]',
  '309': 'Chemicals, cleansers, & similar agents stored or labeled improperly [s. 27]',
  '311': 'Premises not maintained as per approved plans [s. 6(1)(b)]',
  '312': 'Items not required for food premises operation being stored on the premises [s. 18]',
  '313': 'Live animal on the premises, excluding guide animal in approved areas [s. 25(1)]',
  '314': 'Operator has not provided acceptable written sanitation procedures [s. 24]',
  '315': 'Refrigeration units and hot holding equipment lack accurate thermometers [s. 19(2)]',
  '403': 'Employee lacks good personal hygiene, clean clothing and hair control [s. 21(1)]',
  '501': 'Operator does not have FOODSAFE Level 1 or Equivalent [s. 10(1)]',
  '502': 'In operator’s absence, no staff on duty has FOODSAFE Level 1 or equivalent [s. 10(2)]'
}

// Status badges HealthSpace stuffs into the description column instead of the
// actual rule text. These are flags, not descriptions.
const NON_DESCRIPTIVE = /^(critical|non-?critical|repeat|corrected|critical[\s-]+repeat|non-?critical[\s-]+repeat)$/i

const REPEAT_FLAG = /\brepeat\b/i

export const VIOLATION_DETAILS_UNAVAILABLE = 'Violation details not provided by HealthSpace'

/** True when `text` looks like a real rule description rather than a status badge. */
export function isDescriptiveViolationText(text?: string): boolean {
  const t = (text || '').trim()
  return t.length > 0 && !NON_DESCRIPTIVE.test(t)
}

/**
 * Replace junk "Critical"/"Repeat" titles with real rule text.
 *
 * Resolution order: keep the description if it is already descriptive; otherwise
 * use the canonical text for the code; otherwise fall back to a category-derived
 * label (our own classification, clearly marked as details-unavailable) rather
 * than fabricating official wording.
 *
 * `is_repeat` preserves the repeat signal that the raw "Repeat" badge carried so
 * the risk score keeps its repeat weighting after the badge is overwritten.
 */
export function normalizeViolation(violation: Violation): Violation {
  const raw = (violation.description || '').trim()
  const code = String(violation.code || '').trim()
  const is_repeat = REPEAT_FLAG.test(raw) || Boolean(violation.is_repeat)

  if (isDescriptiveViolationText(raw)) {
    return is_repeat === Boolean(violation.is_repeat) ? violation : { ...violation, is_repeat }
  }

  const canonical = VIOLATION_CODE_DESCRIPTIONS[code]
  let description = canonical
  if (!description) {
    const category = assessViolationRisk(violation).category
    description = category === 'Other'
      ? VIOLATION_DETAILS_UNAVAILABLE
      : `${category} concern (details not provided by HealthSpace)`
  }

  return { ...violation, description, is_repeat, details_unavailable: !canonical }
}
