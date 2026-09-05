import { normalizeName } from '@/lib/acknowledgement/engine'
import type {
  Confidence,
  DataGap,
  LocalLanguageResource,
  PronunciationInfo,
  PronunciationSource,
  SourceKey,
  SourceLookupState,
  TemplatePrompt,
  WordingMode,
  WordingOptions,
} from './types'

export const sourceMeta: Record<SourceKey, { label: string; type: string; description: string }> = {
  verified: {
    label: 'Documented relationships',
    type: 'Curated wording graph',
    description: 'Reviewed place-to-Nation and people-group relationships used to generate controlled acknowledgement variants.',
  },
  nativeLand: {
    label: 'Native Land Digital',
    type: 'Educational territory layer',
    description: 'Bundled territory, language, and treaty polygons for review-oriented public education.',
  },
  cad: {
    label: 'BC CAD',
    type: 'Report workflow',
    description: 'External CAD/PIP workflow for preliminary First Nations consultation contacts. The public app does not expose consultation-area polygons as downloadable boundary data.',
  },
  treaty: {
    label: 'Treaty lands',
    type: 'Legal/admin layer',
    description: 'Treaty-related geography where official treaty data is available.',
  },
  reserve: {
    label: 'Reserve boundaries',
    type: 'Administrative layer',
    description: 'Reserve and band-name reference geography, not traditional territory.',
  },
  local: {
    label: 'Nearest community',
    type: 'Community reference',
    description: 'Nearest First Nation community office from the B.C. community-locations layer. Proximity context for review, not a territory boundary.',
  },
}

// Treaty, reserve, and community geography are synced to static GeoJSON at build time
// (npm run indigenous:sync) and queried in-browser with point-in-polygon / nearest-point.
// The live BC ArcGIS endpoints return `Access-Control-Allow-Origin: null`, so the browser
// blocks direct cross-origin requests from the deployed site — hence the local copies.
const INDIGENOUS_DATA_BASE = `${import.meta.env.BASE_URL}data/indigenous/`
export const INDIGENOUS_MANIFEST_DATA = `${INDIGENOUS_DATA_BASE}manifest.json`
export const RELATIONSHIP_GRAPH_DATA = `${import.meta.env.BASE_URL}data/acknowledgement/relationship-graph.json`
export const TREATY_LANDS_DATA = `${INDIGENOUS_DATA_BASE}first_nations_treaty_lands.geojson`
export const TREATY_AREAS_DATA = `${INDIGENOUS_DATA_BASE}first_nations_treaty_areas.geojson`
export const RESERVES_DATA = `${INDIGENOUS_DATA_BASE}cad_pip_layer_382_indian_reserves_band_names.geojson`
export const COMMUNITIES_DATA = `${INDIGENOUS_DATA_BASE}first_nation_community_locations.geojson`
export const NATIVE_LAND_DATA_BASE = `${import.meta.env.BASE_URL}data/native-land/`
export const NATIVE_LAND_LAYERS = [
  { category: 'territories', url: `${NATIVE_LAND_DATA_BASE}territories.geojson`, label: 'Native Land territory overlap' },
  { category: 'languages', url: `${NATIVE_LAND_DATA_BASE}languages.geojson`, label: 'Native Land language overlap' },
  { category: 'treaties', url: `${NATIVE_LAND_DATA_BASE}treaties.geojson`, label: 'Native Land treaty overlap' },
] as const
// First Peoples' Cultural Council — First Peoples' Map of B.C. (maps.fpcc.ca).
// language-geo is authoritative Indigenous language-territory polygons (39);
// community-geo is community points (205).
export const FPCC_DATA_BASE = `${import.meta.env.BASE_URL}data/fpcc/`
export const FPCC_LANGUAGES_DATA = `${FPCC_DATA_BASE}language-geo.geojson`
export const LOCAL_COMMUNITY_MAX_KM = 120

export const initialLookupState: Record<SourceKey, SourceLookupState> = {
  verified: { status: 'idle', matches: [] },
  nativeLand: { status: 'idle', matches: [] },
  cad: { status: 'skipped', matches: [], message: 'Use the B.C. CAD map/report manually. The public app exposes contact reports; consultation-area polygons are not available as bundled boundary data.' },
  treaty: { status: 'idle', matches: [] },
  reserve: { status: 'idle', matches: [] },
  local: { status: 'idle', matches: [] },
}

export const unresolvedDataGaps: DataGap[] = [
  {
    name: 'First Nation Profiles in Canada',
    status: 'Reference candidate',
    use: 'Federal profile/contact reference for First Nations and governing organizations.',
    limitation: 'Administrative profile data; it does not establish traditional territory or acknowledgement wording.',
    url: 'https://fnp-ppn.aadnc-aandc.gc.ca/fnp/Main/index.aspx',
  },
  {
    name: 'Sector CAD-derived reports',
    status: 'Workflow candidate',
    use: 'Mineral Title Overlap Reports and PNG tenure guidance can expose sector-specific CAD contact expectations.',
    limitation: 'Project/tenure-specific and not reusable as a general public boundary dataset.',
    url: 'https://www2.gov.bc.ca/gov/content/industry/mineral-exploration-mining/mineral-titles/first-nations-engagement',
  },
]

export const acknowledgementTemplatePrompts: TemplatePrompt[] = [
  {
    label: 'Locate the speaker',
    prompt: 'Name your relationship to this place, including whether you are a host, visitor, resident, settler, immigrant, or guest.',
  },
  {
    label: 'Name the gathering',
    prompt: 'Connect the acknowledgement to why people are meeting, learning, building, or making decisions together today.',
  },
  {
    label: 'Use local names with care',
    prompt: 'Practice pronunciation and leave room for multiple Nations, overlapping relationships, and changed guidance.',
  },
  {
    label: 'People before layers',
    prompt: 'Do not let treaty, reserve, CAD, or other administrative layers substitute for Nation-specific relationships.',
  },
  {
    label: 'Avoid one-size wording',
    prompt: 'Replace rote scripts with context-specific wording that reflects the place, audience, and current relationships.',
  },
  {
    label: 'Connect words to action',
    prompt: 'State one concrete action, responsibility, or follow-up that sits beyond the acknowledgement itself.',
  },
  {
    label: 'Invite correction',
    prompt: 'Make space for feedback without shifting emotional labour or protocol work onto Indigenous attendees.',
  },
  {
    label: 'Keep wording living',
    prompt: 'Record when wording was reviewed and revisit it when local guidance, relationships, or event context changes.',
  },
]

const PRONUNCIATION_GUIDE_URL = 'https://www2.gov.bc.ca/assets/gov/british-columbians-our-governments/indigenous-people/aboriginal-peoples-documents/a_guide_to_pronunciation_of_bc_first_nations_-_oct_29_2018.pdf'
const LHEIDLI_LANGUAGE_URL = 'https://www.lheidli.ca/about/our-language/'
const LHEIDLI_DICTIONARY_URL = 'https://www.billposer.org/LheidliCarrierDictionary/'
const LHEIDLI_SOUND_SYSTEM_URL = 'https://www.billposer.org/LheidliDialect/SoundSystemIntro/LheidliPronunciation.html'
const LHEIDLI_UNBC_ENTRY_URL = 'https://www.billposer.org/LheidliCarrierDictionary/Entries/006439.html'
const LHEIDLI_UNBC_AUDIO_URL = 'https://www.billposer.org/LheidliCarrierDictionary/Audio/edifre_2021-11-29_009.wav'
const LHEIDLI_UNBC_QR_URL = 'https://www.billposer.org/LheidliCarrierDictionary/EntryQRCodes/006439.png'

export const pronunciationSources: PronunciationSource[] = [
  {
    name: 'Lheidli T’enneh language page',
    status: 'Local authority',
    use: 'Local language portal for Carrier/Dakelh resources, including links to dictionary and learning materials.',
    caveat: 'Use as a local verification and learning source; it is not a structured pronunciation API.',
    url: LHEIDLI_LANGUAGE_URL,
  },
  {
    name: 'Lheidli Dakelh Dictionary',
    status: 'Audio link-out',
    use: 'Lheidli-specific dictionary entries with syllabics, IPA hover notes, playable speaker recordings, and QR codes.',
    caveat: 'Audio reuse rights are not clearly permissive. Link out rather than bundling or mirroring audio unless permission is obtained.',
    url: LHEIDLI_DICTIONARY_URL,
  },
  {
    name: 'Meaning and pronunciation of Lheidli T’enneh',
    status: 'Local guide',
    use: 'Explains pronunciation issues such as lh, dl, and ejective t’ and links to Lheidli pronunciation resources.',
    caveat: 'Use for learning context and source linking; verify public wording with Lheidli T’enneh guidance.',
    url: 'https://www.ydli.org/ParkName.pdf',
  },
  {
    name: 'BC pronunciation guide',
    status: 'Text phonetics',
    use: 'Seed English-style pronunciation approximations for many B.C. Indigenous communities and organizations.',
    caveat: 'Introductory only. The guide says final authority rests with each community and many sounds cannot be expressed in English.',
    url: PRONUNCIATION_GUIDE_URL,
  },
  {
    name: 'First Peoples Map of B.C.',
    status: 'Audio candidate',
    use: 'Indigenous-led map with pronounce buttons and audio where available, plus language and greeting context.',
    caveat: 'Do not scrape. Request API/data permission from FPCC before automating audio or pronunciation pulls.',
    url: 'https://maps.fpcc.ca/',
  },
  {
    name: 'Nation websites',
    status: 'Preferred audio',
    use: 'Use Nation-published phonetics, audio, or video where the Nation provides clear public guidance.',
    caveat: 'Reuse depends on each site. Link out unless the Nation provides permission or clear reusable media terms.',
    url: 'https://www.sfu.ca/main/about/truth-reconciliation/ways-to-learn/terminology-language/host-nations-pronunciation-guide.html',
  },
  {
    name: 'BC Geographical Names',
    status: 'Place-name audio',
    use: 'Some official place-name records include pronunciation keys and sometimes audio.',
    caveat: 'Mostly place names, not Nation names. Use as supporting context only.',
    url: 'https://www2.gov.bc.ca/gov/content/governments/celebrating-british-columbia/historic-places/geographical-names?keyword=2021',
  },
]

export const localLanguageResources: LocalLanguageResource[] = [
  {
    name: 'Lheidli T’enneh: Our Language',
    status: 'Nation source',
    use: 'Nation-maintained language page with Dakelh learning context, videos, and recommended language links.',
    caveat: 'Use as the preferred public starting point for local language learning resources.',
    url: LHEIDLI_LANGUAGE_URL,
  },
  {
    name: 'Lheidli Dakelh Dictionary',
    status: 'Dictionary',
    use: 'Searchable Dakelh dictionary compiled by Bill Poser and linked from Lheidli T’enneh’s language page.',
    caveat: 'Treat as a learning/reference source; avoid bulk copying entries or audio into PGMaps.',
    url: LHEIDLI_DICTIONARY_URL,
  },
  {
    name: 'Lheidli sound system',
    status: 'Pronunciation guide',
    use: 'Explains the Lheidli dialect sound system and writing system with audio examples.',
    caveat: 'Better for learning pronunciation patterns than for auto-generating phonetics.',
    url: LHEIDLI_SOUND_SYSTEM_URL,
  },
  {
    name: 'UNBC in Dakelh',
    status: 'Local term',
    use: 'Dictionary entry for “University of Northern British Columbia,” with audio spoken by Edith Frederick and a QR code for sharing.',
    caveat: 'Keep this as a linked pronunciation aid for local UNBC contexts; verify before embedding in formal acknowledgement wording.',
    url: LHEIDLI_UNBC_ENTRY_URL,
    audioUrl: LHEIDLI_UNBC_AUDIO_URL,
    qrUrl: LHEIDLI_UNBC_QR_URL,
  },
]

const pronunciationDatabase: Record<string, PronunciationInfo> = {
  // "Lheidli-T'enneh Band" and "Lheidli T'enneh First Nation" normalize to the
  // same key, so one entry covers both (the Nation-local source wins).
  [normalizeName("Lheidli T'enneh First Nation")]: {
    phonetic: 'clayt-clay den-ay',
    sourceLabel: 'Lheidli language resources',
    sourceUrl: LHEIDLI_LANGUAGE_URL,
    caveat: 'Approximation only. Use Lheidli language resources and Nation guidance for local pronunciation practice.',
  },
  [normalizeName('Lhoosk’uz Dené Nation')]: {
    phonetic: "looze-k' U z den-ay",
    sourceLabel: 'BC pronunciation guide',
    sourceUrl: PRONUNCIATION_GUIDE_URL,
    caveat: 'Approximation only; verify with the Nation or local guidance before public use.',
  },
  [normalizeName('Lhtako Dene Nation')]: {
    phonetic: 'lah-ta-ko den-ay',
    sourceLabel: 'BC pronunciation guide',
    sourceUrl: PRONUNCIATION_GUIDE_URL,
    caveat: 'Approximation only; verify with the Nation or local guidance before public use.',
  },
  [normalizeName("Nadleh Whut'en Band")]: {
    phonetic: 'nad-lee woo-ten',
    sourceLabel: 'BC pronunciation guide',
    sourceUrl: PRONUNCIATION_GUIDE_URL,
    caveat: 'Approximation only; verify with the Nation or local guidance before public use.',
  },
  [normalizeName("Nak'azdli Band")]: {
    phonetic: 'na-caused-lee',
    sourceLabel: 'BC pronunciation guide',
    sourceUrl: PRONUNCIATION_GUIDE_URL,
    caveat: 'Approximation only; verify with the Nation or local guidance before public use.',
  },
  [normalizeName('Tsay Keh Dene Band')]: {
    phonetic: 'say-kay-denay',
    sourceLabel: 'BC pronunciation guide',
    sourceUrl: PRONUNCIATION_GUIDE_URL,
    caveat: 'Approximation only; verify with the Nation or local guidance before public use.',
  },
  [normalizeName("TseK'hene First Nation")]: {
    phonetic: 'tse-kan-ay',
    sourceLabel: 'BC pronunciation guide',
    sourceUrl: PRONUNCIATION_GUIDE_URL,
    caveat: 'Approximation only; verify with the Nation or local guidance before public use.',
  },
}

export function findPronunciation(name: string) {
  return pronunciationDatabase[normalizeName(name)]
}

export const confidenceStyles: Record<Confidence, string> = {
  strong: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  moderate: 'border-amber-200 bg-amber-50 text-amber-800',
  review_required: 'border-slate-200 bg-slate-50 text-slate-700',
}

export const confidenceLabels: Record<Confidence, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  review_required: 'Review',
}

const verificationMeta: Record<string, { label: string; className: string }> = {
  verified_institutional: { label: 'Institutional', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  verified_local_context: { label: 'Local context', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  verified_institutional_context: { label: 'Institutional context', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  boundary_context: { label: 'Boundary context', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  template_context: { label: 'Template', className: 'border-slate-200 bg-slate-50 text-slate-700' },
}

export function verificationLabel(status: string) {
  return verificationMeta[status] ?? {
    label: status.replace(/_/g, ' '),
    className: 'border-slate-200 bg-slate-50 text-slate-700',
  }
}

export const wordingModeLabels: Record<WordingMode, string> = {
  short: 'Short',
  formal: 'Formal',
  event: 'Event',
  institutional: 'Institution',
}

export const defaultWordingOptions: WordingOptions = {
  includeTreatyContext: true,
  includePeopleGroupContext: true,
}
