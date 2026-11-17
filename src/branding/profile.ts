import { object, text } from '../lib/jsonGuards'

/**
 * The person who prepares sheets and reports, kept in this browser's branding store (IndexedDB) beside the logo and
 * never in a project or scene file. A tool copies it into its own record (the road issue stamp, the FS1252 office
 * fields) only on the person's click, so a document prints the same whoever's browser opens the project.
 * Free of DOM and network access.
 */
export type PreparerProfile = {
  name: string
  /** Professional designation as printed after the name: "RPF", "RFT", "P.Eng.". */
  designation: string
  /** Registration or member number. Printed only beside a designation. */
  registration: string
  /** The preparer's own company or office, not the client or licensee the work is for. */
  organisation: string
  /** One optional line, such as a phone number or email. */
  contact: string
}

export const PROFILE_FIELD_LIMITS = {
  name: 200,
  designation: 60,
  registration: 40,
  organisation: 200,
  contact: 200,
} as const satisfies Record<keyof PreparerProfile, number>

export const EMPTY_PROFILE: PreparerProfile = {
  name: '',
  designation: '',
  registration: '',
  organisation: '',
  contact: '',
}

const LABELS: Record<keyof PreparerProfile, string> = {
  name: 'Name',
  designation: 'Designation',
  registration: 'Registration number',
  organisation: 'Organisation',
  contact: 'Contact',
}

/** A stored profile, each field trimmed text within its limit; an absent field reads as empty. */
export function parsePreparerProfile(input: unknown): PreparerProfile {
  const value = object(input, 'your details')
  const result = { ...EMPTY_PROFILE }
  for (const key of Object.keys(PROFILE_FIELD_LIMITS) as Array<keyof PreparerProfile>) {
    // An empty field is simply not entered (`text` refuses empty strings).
    if (value[key] === undefined || value[key] === '') continue
    result[key] = text(value[key], LABELS[key], PROFILE_FIELD_LIMITS[key]).trim()
  }
  return result
}

export const profileIsEmpty = (profile: PreparerProfile | null | undefined) =>
  !profile || Object.values(profile).every((value) => !value.trim())

/** "RPF #4521", "RPF", or "" when no designation is given (a registration alone is not printed). */
export function designationText(profile: Pick<PreparerProfile, 'designation' | 'registration'>): string {
  const designation = profile.designation.trim()
  if (!designation) return ''
  const registration = profile.registration.trim().replace(/^#\s*/, '')
  return registration ? `${designation} #${registration}` : designation
}

/** "J. Smith, RPF #4521": the name with its designation, as a sign-off prints it. Empty without a name. */
export function nameWithDesignation(name: string, designation: string): string {
  const who = name.trim()
  if (!who) return ''
  const after = designation.trim()
  return after ? `${who}, ${after}` : who
}

/** One line naming the person: "J. Smith, RPF #4521 · Northwood Forestry". */
export function profileSummary(profile: PreparerProfile | null): string {
  if (profileIsEmpty(profile)) return 'Not set'
  const p = profile!
  return [nameWithDesignation(p.name, designationText(p)) || designationText(p), p.organisation]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The fields a tool's record would take from the profile: only those the record leaves blank and the profile
 * fills. A filled record field is the record's own and is never replaced.
 */
export function blanksFilledFromProfile<K extends string>(
  record: Partial<Record<K, string>>,
  fromProfile: Record<K, string>,
): Partial<Record<K, string>> {
  const patch: Partial<Record<K, string>> = {}
  for (const key of Object.keys(fromProfile) as K[]) {
    const offered = fromProfile[key].trim()
    if (offered && !(record[key] ?? '').trim()) patch[key] = offered
  }
  return patch
}
