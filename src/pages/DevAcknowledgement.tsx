import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  Globe2,
  Layers3,
  MapPin,
  Search,
  ShieldCheck,
} from 'lucide-react'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type SourceKey = 'nativeLand' | 'cad' | 'treaty' | 'reserve' | 'local'
type Confidence = 'strong' | 'moderate' | 'review_required'
type WordingMode = 'general' | 'event' | 'research' | 'reflective'
type GeocodeStatus = 'idle' | 'loading' | 'success' | 'error'
type SourceStatus = 'idle' | 'loading' | 'success' | 'error' | 'skipped'

type CandidateNation = {
  id: string
  name: string
  preferredName: string
  confidence: Confidence
  pronunciation?: PronunciationInfo
  reason: string
  sources: Partial<Record<SourceKey, string>>
  notes: string
}

type SourceMatch = {
  source: SourceKey
  name: string
  label: string
  detail?: string
}

type SourceLookupState = {
  status: SourceStatus
  matches: SourceMatch[]
  message?: string
}

type DataGap = {
  name: string
  status: string
  use: string
  limitation: string
  url: string
}

type TemplatePrompt = {
  label: string
  prompt: string
}

type PracticeSource = {
  name: string
  status: string
  use: string
  limitation: string
  path: string
}

type PronunciationInfo = {
  phonetic?: string
  audioUrl?: string
  sourceLabel: string
  sourceUrl: string
  caveat: string
}

type PronunciationSource = {
  name: string
  status: string
  use: string
  caveat: string
  url: string
}

type LocalLanguageResource = {
  name: string
  status: string
  use: string
  caveat: string
  url: string
  audioUrl?: string
  qrUrl?: string
}

type GeocodeResult = {
  fullAddress: string
  latitude: number
  longitude: number
  score: number
  matchPrecision: string
  precisionPoints: number
  faults: string[]
  baseDataDate: string
  searchTimestamp: string
}

type BcGeocoderFeature = {
  geometry?: {
    coordinates?: [number, number]
  }
  properties?: {
    fullAddress?: string
    score?: number
    matchPrecision?: string
    precisionPoints?: number
    faults?: unknown[]
  }
}

type BcGeocoderResponse = {
  baseDataDate?: string
  searchTimestamp?: string
  features?: BcGeocoderFeature[]
}

type NativeLandResponse = {
  features?: Array<{
    properties?: {
      Name?: string
      Slug?: string
      description?: string
    }
  }>
}

const sourceMeta: Record<SourceKey, { label: string; type: string; description: string }> = {
  nativeLand: {
    label: 'Native Land Digital',
    type: 'Educational territory layer',
    description: 'Territories, languages, and treaties for review-oriented public education.',
  },
  cad: {
    label: 'BC CAD',
    type: 'Consultative area',
    description: 'External report workflow for preliminary First Nations consultation contacts. Boundaries are not public.',
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

const sourceUrls: Record<SourceKey, string> = {
  nativeLand: 'https://api-docs.native-land.ca/by-names-and-or-position',
  cad: 'https://www2.gov.bc.ca/assets/gov/environment/natural-resource-stewardship/consulting-with-first-nations/first_nations_consultative_areas_database_cad_-_faqs.pdf',
  treaty: 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_legal_admin_boundaries/MapServer',
  reserve: 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/34',
  local: 'https://catalogue.data.gov.bc.ca/dataset/first-nation-community-locations',
}

const BC_GEOCODER_URL = 'https://geocoder.api.gov.bc.ca/addresses.json'
const NATIVE_LAND_URL = 'https://native-land.ca/api/index.php'
const NATIVE_LAND_API_KEY = import.meta.env.VITE_NATIVE_LAND_API_KEY as string | undefined

// Treaty, reserve, and community geography are synced to static GeoJSON at build time
// (npm run indigenous:sync) and queried in-browser with point-in-polygon / nearest-point.
// The live BC ArcGIS endpoints return `Access-Control-Allow-Origin: null`, so the browser
// blocks direct cross-origin requests from the deployed site — hence the local copies.
const INDIGENOUS_DATA_BASE = `${import.meta.env.BASE_URL}data/indigenous/`
const TREATY_LANDS_DATA = `${INDIGENOUS_DATA_BASE}first_nations_treaty_lands.geojson`
const TREATY_AREAS_DATA = `${INDIGENOUS_DATA_BASE}first_nations_treaty_areas.geojson`
const RESERVES_DATA = `${INDIGENOUS_DATA_BASE}indian_reserves_band_names.geojson`
const COMMUNITIES_DATA = `${INDIGENOUS_DATA_BASE}first_nation_community_locations.geojson`
const LOCAL_COMMUNITY_MAX_KM = 120

const initialLookupState: Record<SourceKey, SourceLookupState> = {
  nativeLand: { status: 'idle', matches: [] },
  cad: { status: 'skipped', matches: [], message: 'Use the B.C. CAD map/report manually. Public CAD docs say boundaries are not viewable and outputs are preliminary contact lists.' },
  treaty: { status: 'idle', matches: [] },
  reserve: { status: 'idle', matches: [] },
  local: { status: 'idle', matches: [] },
}

const unincorporatedDataGaps: DataGap[] = [
  {
    name: 'BC CAD / PIP consultation areas',
    status: 'Manual candidate',
    use: 'Generate a preliminary First Nations contact list for a point, line, or polygon in iMapBC.',
    limitation: 'Not a public boundary layer; it should inform outreach and review, not automatic acknowledgement wording.',
    url: 'https://www2.gov.bc.ca/assets/gov/environment/natural-resource-stewardship/consulting-with-first-nations/first_nations_consultative_areas_database_cad_-_faqs.pdf',
  },
  {
    name: 'Contacts for First Nations Consultation Areas map',
    status: 'Manual candidate',
    use: 'Current public entry point for the CAD-style spatial contact query.',
    limitation: 'Interactive map/report workflow, so a proxy or documented API discovery pass is needed before live integration.',
    url: 'https://maps.gov.bc.ca/ess/hm/cadb/',
  },
  {
    name: 'First Nation Community Locations',
    status: 'Service candidate',
    use: 'Approximate community locations and administrative context for Nations in B.C.',
    limitation: 'Point locations are not territory and may be incomplete or approximate.',
    url: 'https://catalogue.data.gov.bc.ca/dataset/first-nation-community-locations',
  },
  {
    name: 'First Peoples Map of B.C.',
    status: 'Research candidate',
    use: 'Community-facing context for Nations, languages, art, heritage, and place-based learning.',
    limitation: 'Best treated as educational context and cross-checking, not an authoritative point-in-polygon source.',
    url: 'https://maps.fpcc.ca/',
  },
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

const acknowledgementTemplatePrompts: TemplatePrompt[] = [
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

const pronunciationSources: PronunciationSource[] = [
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

const localLanguageResources: LocalLanguageResource[] = [
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
  [normalizeName("Lheidli-T'enneh Band")]: {
    phonetic: 'clayt-clay den-ay',
    sourceLabel: 'BC pronunciation guide',
    sourceUrl: PRONUNCIATION_GUIDE_URL,
    caveat: 'Approximation only; verify with Lheidli T’enneh First Nation or local guidance before public use.',
  },
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

const acknowledgementPracticeSources: PracticeSource[] = [
  {
    name: 'LISSA Land Acknowledgement template',
    status: 'Template source',
    use: 'Structured components for personalization, speaker protocol, reflection prompts, and fixed web wording.',
    limitation: 'Created for a library/information-studies context; reuse the pattern, not its institution-specific wording.',
    path: '/Users/ahmadjalil/Downloads/New Folder With Items 4/2018_2019_LISSA_Land_Acknowledgement (1).docx',
  },
  {
    name: 'Khelsilem acknowledgement tips',
    status: 'Practice source',
    use: 'Guidance to elevate Indigenous polity, avoid simplistic ceded/unceded framing, and keep acknowledgement tied to action.',
    limitation: 'Blog guidance from a particular perspective; use as advice to consider, not a universal rulebook.',
    path: '/Users/ahmadjalil/Downloads/New Folder With Items 4/Liberated_Yet_—_Khelsilem\'s_Tips_for_Acknowledging_Territory_1_0.pdf',
  },
  {
    name: 'Rethinking land acknowledgement',
    status: 'Critical source',
    use: 'Scholarly discussion of site-specific, context-specific acknowledgements and the limits of standardized performance.',
    limitation: 'Academic article; adapt ideas into prompts rather than copying performance text.',
    path: '/Users/ahmadjalil/Downloads/New Folder With Items 4/2019_Rethinking_the_Practice_and_Performance_of_Indigenous_Land.pdf',
  },
  {
    name: 'Land-based practice article',
    status: 'Relational source',
    use: 'Frames land as relational, pedagogical, and connected to wellness rather than only physical territory.',
    limitation: 'Health and land-based healing context, not an acknowledgement manual.',
    path: '/Users/ahmadjalil/Downloads/New Folder With Items 4/Redvers (2020) Land based practice.pdf',
  },
]

const confidenceStyles: Record<Confidence, string> = {
  strong: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  moderate: 'border-amber-200 bg-amber-50 text-amber-800',
  review_required: 'border-slate-200 bg-slate-50 text-slate-700',
}

const confidenceLabels: Record<Confidence, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  review_required: 'Review',
}

function buildAcknowledgement(mode: WordingMode, nationNames: string[]) {
  const names = nationNames.length > 0 ? nationNames.join(', ') : '[selected Nation(s)]'

  if (mode === 'event') {
    return `We acknowledge that today's event is taking place on lands connected to ${names}. We are grateful to gather here and recognize the continuing presence, rights, and stewardship of Indigenous Peoples.`
  }

  if (mode === 'research') {
    return `This work takes place in areas connected to ${names}. We recognize the importance of respectful relationship-building, local protocols, and Indigenous rights and title.`
  }

  if (mode === 'reflective') {
    return `I acknowledge that I am speaking from lands connected to ${names}. I am still learning my responsibilities in this place, and I commit to pairing these words with respectful relationship-building, local guidance, and concrete action beyond this acknowledgement.`
  }

  return `We acknowledge that we are on lands connected to ${names}. We recognize their histories, cultures, and ongoing relationships with these lands.`
}

function parseFaults(faults: unknown[] | undefined) {
  if (!faults) return []
  return faults.map((fault) => {
    if (typeof fault === 'string') return fault
    if (fault && typeof fault === 'object' && 'value' in fault) return String(fault.value)
    return String(fault)
  })
}

async function geocodeAddress(address: string, signal?: AbortSignal): Promise<GeocodeResult> {
  const params = new URLSearchParams({
    addressString: address,
    maxResults: '1',
    interpolation: 'adaptive',
    echo: 'true',
    brief: 'false',
    autoComplete: 'false',
    setBack: '0',
    outputSRS: '4326',
  })

  const response = await fetch(`${BC_GEOCODER_URL}?${params.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(`BC Address Geocoder returned ${response.status}`)
  }

  const data = await response.json() as BcGeocoderResponse
  const feature = data.features?.[0]
  const coordinates = feature?.geometry?.coordinates
  if (!feature || !coordinates || coordinates.length < 2) {
    throw new Error('No B.C. address match found')
  }

  return {
    fullAddress: feature.properties?.fullAddress ?? address,
    longitude: coordinates[0],
    latitude: coordinates[1],
    score: feature.properties?.score ?? 0,
    matchPrecision: feature.properties?.matchPrecision ?? 'Unknown',
    precisionPoints: feature.properties?.precisionPoints ?? 0,
    faults: parseFaults(feature.properties?.faults),
    baseDataDate: data.baseDataDate ?? '',
    searchTimestamp: data.searchTimestamp ?? '',
  }
}

function sourceLookupMessage(status: SourceStatus) {
  if (status === 'loading') return 'Checking'
  if (status === 'success') return 'Live'
  if (status === 'error') return 'Issue'
  if (status === 'skipped') return 'Manual'
  return 'Ready'
}

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/first nation|indian band|band|treaty area|treaty lands/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function candidateId(name: string) {
  return normalizeName(name).replace(/\s+/g, '-') || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function findPronunciation(name: string) {
  return pronunciationDatabase[normalizeName(name)]
}

function uniqueMatches(matches: SourceMatch[]) {
  const seen = new Set<string>()
  return matches.filter((match) => {
    const key = `${match.source}:${normalizeName(match.name)}:${match.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

type FeatureProperties = Record<string, unknown>

const geojsonCache = new Map<string, Promise<GeoJSON.FeatureCollection>>()

async function loadIndigenousLayer(url: string): Promise<GeoJSON.FeatureCollection> {
  const cached = geojsonCache.get(url)
  if (cached) return cached
  const request = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load ${url.split('/').pop()} (${response.status})`)
      return response.json() as Promise<GeoJSON.FeatureCollection>
    })
    .catch((error: unknown) => {
      // Drop the failed promise so a later lookup can retry the fetch.
      geojsonCache.delete(url)
      throw error instanceof Error ? error : new Error('Failed to load layer data')
    })
  geojsonCache.set(url, request)
  return request
}

function joinDetail(parts: unknown[]) {
  const detail = parts
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter((part) => part && part.toLowerCase() !== 'blank')
    .join(' / ')
  return detail || undefined
}

async function queryPolygonLayer(
  url: string,
  lat: number,
  lng: number,
  toMatch: (properties: FeatureProperties) => SourceMatch | null,
): Promise<SourceMatch[]> {
  const collection = await loadIndigenousLayer(url)
  const pt = point([lng, lat])
  const matches: SourceMatch[] = []
  for (const feature of collection.features) {
    const geometry = feature.geometry
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) continue
    if (!booleanPointInPolygon(pt, geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon)) continue
    const match = toMatch((feature.properties ?? {}) as FeatureProperties)
    if (match) matches.push(match)
  }
  return uniqueMatches(matches)
}

async function queryTreatySources(lat: number, lng: number) {
  const [lands, areas] = await Promise.all([
    queryPolygonLayer(TREATY_LANDS_DATA, lat, lng, (properties) => {
      const name = String(properties.FIRST_NATION_NAME ?? properties.TREATY ?? '').trim()
      if (!name) return null
      return {
        source: 'treaty',
        name,
        label: 'Treaty land intersection',
        detail: joinDetail([properties.TREATY, properties.LAND_TYPE]),
      }
    }),
    queryPolygonLayer(TREATY_AREAS_DATA, lat, lng, (properties) => {
      const name = String(properties.FIRST_NATION_NAME ?? properties.TREATY ?? '').trim()
      if (!name) return null
      return {
        source: 'treaty',
        name,
        label: 'Treaty area intersection',
        detail: joinDetail([properties.TREATY, properties.AREA_TYPE, properties.GEOGRAPHIC_LOCATION]),
      }
    }),
  ])
  return uniqueMatches([...lands, ...areas])
}

async function queryReserveSource(lat: number, lng: number) {
  return queryPolygonLayer(RESERVES_DATA, lat, lng, (properties) => {
    const name = String(properties.BAND_NAME ?? properties.ENGLISH_NAME ?? '').trim()
    if (!name) return null
    return {
      source: 'reserve',
      name,
      label: 'Reserve boundary intersection',
      detail: joinDetail([properties.ENGLISH_NAME, properties.BAND_NUMBER ? `Band ${properties.BAND_NUMBER}` : null]),
    }
  })
}

async function queryNativeLandSource(lat: number, lng: number, signal?: AbortSignal) {
  if (!NATIVE_LAND_API_KEY) {
    throw new Error('Set VITE_NATIVE_LAND_API_KEY to enable Native Land Digital lookups.')
  }

  const params = new URLSearchParams({
    maps: 'territories,languages,treaties',
    position: `${lat},${lng}`,
    key: NATIVE_LAND_API_KEY,
  })

  const response = await fetch(`${NATIVE_LAND_URL}?${params.toString()}`, { signal })
  if (!response.ok) throw new Error(`Native Land Digital returned ${response.status}`)
  const data = await response.json() as NativeLandResponse
  const matches: SourceMatch[] = (data.features ?? [])
    .map((feature): SourceMatch | null => {
      const name = feature.properties?.Name?.trim()
      if (!name) return null
      return {
        source: 'nativeLand',
        name,
        label: 'Native Land overlap',
        detail: feature.properties?.Slug,
      }
    })
    .filter((match): match is SourceMatch => Boolean(match))
  return uniqueMatches(matches)
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)))
}

async function localVerifiedMatches(result: GeocodeResult): Promise<SourceMatch[]> {
  const collection = await loadIndigenousLayer(COMMUNITIES_DATA)
  let nearest: { name: string; distanceKm: number; office: string } | null = null
  for (const feature of collection.features) {
    const coordinates = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null
    if (!coordinates || coordinates.length < 2) continue
    const properties = (feature.properties ?? {}) as FeatureProperties
    const name = String(properties.FIRST_NATION_BC_NAME ?? properties.FIRST_NATION_FEDERAL_NAME ?? '').trim()
    if (!name) continue
    const distanceKm = haversineKm(result.latitude, result.longitude, coordinates[1], coordinates[0])
    if (!nearest || distanceKm < nearest.distanceKm) {
      nearest = { name, distanceKm, office: String(properties.BC_REGIONAL_OFFICE ?? '').trim() }
    }
  }

  if (!nearest || nearest.distanceKm > LOCAL_COMMUNITY_MAX_KM) return []

  return [{
    source: 'local',
    name: nearest.name,
    label: 'Nearest First Nation community',
    detail: `~${Math.round(nearest.distanceKm)} km away${nearest.office ? ` · ${nearest.office} office` : ''}`,
  }]
}

function buildCandidatesFromLookups(lookups: Record<SourceKey, SourceLookupState>): CandidateNation[] {
  const byName = new Map<string, CandidateNation>()
  const sourceOrder: SourceKey[] = ['local', 'nativeLand', 'treaty', 'reserve', 'cad']

  Object.values(lookups).flatMap((lookup) => lookup.matches).forEach((match) => {
    const key = normalizeName(match.name) || match.name
    const existing = byName.get(key)
    const nextSources = {
      ...(existing?.sources ?? {}),
      [match.source]: match.detail ? `${match.label}: ${match.detail}` : match.label,
    }
    const sourceCount = sourceOrder.filter((source) => nextSources[source]).length
    const confidence: Confidence = sourceCount >= 2
      ? 'strong'
      : nextSources.reserve
        ? 'strong'
        : nextSources.treaty
          ? 'moderate'
          : 'review_required'
    const sourceLabels = sourceOrder
      .filter((source) => nextSources[source])
      .map((source) => sourceMeta[source].label)

    byName.set(key, {
      id: candidateId(match.name),
      name: existing?.name ?? match.name,
      preferredName: existing?.preferredName ?? match.name,
      confidence,
      pronunciation: existing?.pronunciation ?? findPronunciation(match.name),
      reason: `${match.name} appears in ${sourceLabels.join(', ')} for this location.`,
      sources: nextSources,
      notes: confidence === 'strong'
        ? 'Multiple source signals or local verified wording are present. Final wording should still be reviewed.'
        : 'Single-source match. Keep as context and confirm before using in final wording.',
    })
  })

  return Array.from(byName.values()).sort((left, right) => {
    const rank: Record<Confidence, number> = { strong: 0, moderate: 1, review_required: 2 }
    return rank[left.confidence] - rank[right.confidence] || left.name.localeCompare(right.name)
  })
}

export default function DevAcknowledgement() {
  const [address, setAddress] = useState('3333 University Way, Prince George, BC')
  const [geocodeResult, setGeocodeResult] = useState<GeocodeResult | null>(null)
  const [geocodeStatus, setGeocodeStatus] = useState<GeocodeStatus>('idle')
  const [geocodeError, setGeocodeError] = useState<string | null>(null)
  const [enabledSources, setEnabledSources] = useState<Record<SourceKey, boolean>>(() => ({
    nativeLand: true,
    cad: true,
    treaty: true,
    reserve: true,
    local: true,
  }))
  const [selectedIds, setSelectedIds] = useState<string[]>(['lheidli'])
  const [wordingMode, setWordingMode] = useState<WordingMode>('event')
  const [customWording, setCustomWording] = useState('')
  const [sourceLookups, setSourceLookups] = useState<Record<SourceKey, SourceLookupState>>(initialLookupState)

  const candidates = useMemo(() => buildCandidatesFromLookups(sourceLookups), [sourceLookups])

  const visibleCandidates = useMemo(
    () => candidates.filter((candidate) => (
      Object.keys(candidate.sources).some((source) => enabledSources[source as SourceKey])
    )),
    [candidates, enabledSources],
  )

  const selectedNames = useMemo(
    () => candidates
      .filter((candidate) => selectedIds.includes(candidate.id))
      .map((candidate) => candidate.preferredName),
    [candidates, selectedIds],
  )

  const wording = useMemo(() => buildAcknowledgement(wordingMode, selectedNames), [selectedNames, wordingMode])

  useEffect(() => {
    setCustomWording(wording)
  }, [wording])

  useEffect(() => {
    if (candidates.length === 0) return
    setSelectedIds((current) => {
      const available = new Set(candidates.map((candidate) => candidate.id))
      const kept = current.filter((id) => available.has(id))
      if (kept.length > 0) return kept
      const strong = candidates.find((candidate) => candidate.confidence === 'strong')
      return [strong?.id ?? candidates[0].id]
    })
  }, [candidates])

  useEffect(() => {
    const controller = new AbortController()
    setGeocodeStatus('loading')
    setGeocodeError(null)
    geocodeAddress(address, controller.signal)
      .then((result) => {
        setGeocodeResult(result)
        setGeocodeStatus('success')
        void runSourceLookups(result)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setGeocodeResult(null)
        setGeocodeStatus('error')
        setGeocodeError(error instanceof Error ? error.message : 'Unable to geocode this address')
      })
    return () => controller.abort()
    // Run once to populate the default sample address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runSourceLookups = async (result: GeocodeResult) => {
    const controller = new AbortController()
    setSourceLookups({
      nativeLand: { status: NATIVE_LAND_API_KEY ? 'loading' : 'skipped', matches: [], message: NATIVE_LAND_API_KEY ? undefined : 'Set VITE_NATIVE_LAND_API_KEY to enable Native Land Digital.' },
      treaty: { status: 'loading', matches: [] },
      reserve: { status: 'loading', matches: [] },
      local: { status: 'loading', matches: [] },
      cad: initialLookupState.cad,
    })

    const settle = (source: SourceKey, state: SourceLookupState) => {
      setSourceLookups((current) => ({ ...current, [source]: state }))
    }

    if (NATIVE_LAND_API_KEY) {
      queryNativeLandSource(result.latitude, result.longitude, controller.signal)
        .then((matches) => settle('nativeLand', { status: 'success', matches, message: matches.length ? undefined : 'No Native Land Digital overlaps returned.' }))
        .catch((error: unknown) => settle('nativeLand', {
          status: 'error',
          matches: [],
          message: error instanceof Error ? error.message : 'Native Land Digital lookup failed.',
        }))
    }

    queryTreatySources(result.latitude, result.longitude)
      .then((matches) => settle('treaty', { status: 'success', matches, message: matches.length ? undefined : 'No treaty land or treaty area intersection at this point.' }))
      .catch((error: unknown) => settle('treaty', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Treaty layer lookup failed.',
      }))

    queryReserveSource(result.latitude, result.longitude)
      .then((matches) => settle('reserve', { status: 'success', matches, message: matches.length ? undefined : 'No reserve boundary intersection at this point.' }))
      .catch((error: unknown) => settle('reserve', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Reserve layer lookup failed.',
      }))

    localVerifiedMatches(result)
      .then((matches) => settle('local', { status: 'success', matches, message: matches.length ? undefined : 'No First Nation community within range of this point.' }))
      .catch((error: unknown) => settle('local', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Community reference lookup failed.',
      }))
  }

  const handleGeocode = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    const trimmedAddress = address.trim()
    if (!trimmedAddress) {
      setGeocodeStatus('error')
      setGeocodeError('Enter a B.C. address to geocode')
      setGeocodeResult(null)
      return
    }

    setGeocodeStatus('loading')
    setGeocodeError(null)
    try {
      const result = await geocodeAddress(trimmedAddress)
      setGeocodeResult(result)
      setGeocodeStatus('success')
      void runSourceLookups(result)
    } catch (error) {
      setGeocodeResult(null)
      setGeocodeStatus('error')
      setGeocodeError(error instanceof Error ? error.message : 'Unable to geocode this address')
    }
  }

  const toggleSource = (source: SourceKey) => {
    setEnabledSources((current) => ({ ...current, [source]: !current[source] }))
  }

  const toggleCandidate = (candidateId: string) => {
    setSelectedIds((current) => (
      current.includes(candidateId)
        ? current.filter((id) => id !== candidateId)
        : [...current, candidateId]
    ))
  }

  return (
    <div className="min-h-full bg-stone-50 pt-12 text-slate-950 sm:pt-0">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-md border bg-white px-3 py-1 text-sm font-medium text-slate-600">
                <ShieldCheck className="h-4 w-4 text-teal-700" />
                Multi-source acknowledgement engine
              </div>
              <h1 className="text-3xl font-semibold tracking-tight">Acknowledgement Builder</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Prototype flow for geocoding a B.C. address, comparing official and educational spatial sources,
                selecting candidate Nations, and generating editable wording with review guidance.
              </p>
            </div>
            <Button className="w-full bg-teal-700 hover:bg-teal-800 sm:w-auto">
              <FileText className="h-4 w-4" />
              Save verified wording
            </Button>
          </div>

          <form onSubmit={handleGeocode} className="grid gap-3 lg:grid-cols-[1fr_auto]">
            <label className="flex min-h-12 items-center gap-3 rounded-lg border bg-white px-3 shadow-sm">
              <MapPin className="h-5 w-5 flex-none text-teal-700" />
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                aria-label="Address"
              />
            </label>
            <Button type="submit" variant="outline" className="min-h-12 justify-center" disabled={geocodeStatus === 'loading'}>
              <Search className="h-4 w-4 lg:hidden" />
              <span>{geocodeStatus === 'loading' ? 'Geocoding address' : 'Run source comparison'}</span>
              <ChevronRight className="hidden h-4 w-4 lg:block" />
            </Button>
          </form>
          {geocodeStatus === 'error' && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {geocodeError}
            </div>
          )}
        </div>
      </div>

      <main className="mx-auto grid max-w-7xl gap-4 px-3 py-4 sm:px-6 lg:grid-cols-[280px_1fr_360px] lg:gap-5 lg:px-8">
        <aside className="order-3 space-y-4 lg:order-1">
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Layers3 className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Source Layers</h2>
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
              {(Object.keys(sourceMeta) as SourceKey[]).map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => toggleSource(source)}
                  className="flex min-w-48 items-start gap-3 rounded-md border p-3 text-left transition hover:border-teal-300 lg:w-full lg:min-w-0"
                >
                  <span className={cn(
                    'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded border',
                    enabledSources[source] ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white',
                  )}>
                    {enabledSources[source] && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="block text-sm font-medium">{sourceMeta[source].label}</span>
                      <span className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                        sourceLookups[source].status === 'success' && 'bg-emerald-100 text-emerald-800',
                        sourceLookups[source].status === 'loading' && 'bg-sky-100 text-sky-800',
                        sourceLookups[source].status === 'error' && 'bg-red-100 text-red-800',
                        sourceLookups[source].status === 'skipped' && 'bg-slate-100 text-slate-600',
                        sourceLookups[source].status === 'idle' && 'bg-slate-100 text-slate-600',
                      )}>
                        {sourceLookupMessage(sourceLookups[source].status)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">{sourceMeta[source].type}</span>
                    {sourceLookups[source].message && (
                      <span className="mt-1 block text-xs leading-4 text-slate-500">{sourceLookups[source].message}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <Database className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Pipeline</h2>
            </div>
            <div className="space-y-3 text-xs text-slate-600">
              {['BC Address Geocoder', 'Point-in-polygon lookup', 'Source comparison', 'User-selected wording'].map((step, index) => (
                <div key={step} className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-700">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Database className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Data Gaps</h2>
            </div>
            <div className="space-y-3 text-xs leading-5 text-slate-600">
              {unincorporatedDataGaps.map((gap) => (
                <a
                  key={gap.name}
                  href={gap.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md border p-3 transition hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900">{gap.name}</span>
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
                  </span>
                  <span className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                    {gap.status}
                  </span>
                  <span className="mt-2 block">{gap.use}</span>
                  <span className="mt-1 block text-slate-500">{gap.limitation}</span>
                </a>
              ))}
            </div>
          </section>
        </aside>

        <section className="order-1 space-y-4 lg:order-2">
          <div className="grid overflow-hidden rounded-lg border bg-white shadow-sm md:grid-cols-[1fr_240px]">
            <div className="relative min-h-56 bg-[linear-gradient(135deg,#d8eee8_0%,#f4f0df_45%,#dbe7f3_100%)] sm:min-h-72">
              <div className="absolute inset-0 opacity-55 [background-image:radial-gradient(circle_at_20%_20%,rgba(15,118,110,.18),transparent_22%),radial-gradient(circle_at_72%_40%,rgba(180,83,9,.15),transparent_24%),linear-gradient(90deg,rgba(15,23,42,.08)_1px,transparent_1px),linear-gradient(rgba(15,23,42,.08)_1px,transparent_1px)] [background-size:auto,auto,48px_48px,48px_48px]" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-white bg-teal-700 text-white shadow-lg">
                  <MapPin className="h-6 w-6" />
                </span>
                <span className="max-w-56 rounded-md bg-white/95 px-3 py-1 text-center text-xs font-semibold shadow">
                  {geocodeStatus === 'success' ? 'BC geocoded point' : geocodeStatus === 'loading' ? 'Looking up address' : 'Address lookup needed'}
                </span>
              </div>
            </div>
            <div className="border-t p-4 md:border-l md:border-t-0">
              <h2 className="text-sm font-semibold">Location Result</h2>
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="text-xs uppercase text-slate-500">Normalized address</dt>
                  <dd className="mt-1 break-words font-medium">{geocodeResult?.fullAddress ?? address}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-500">Coordinates</dt>
                  <dd className="mt-1 font-mono text-xs">
                    {geocodeResult ? `${geocodeResult.latitude.toFixed(6)}, ${geocodeResult.longitude.toFixed(6)}` : 'Waiting for match'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-500">Geocoder</dt>
                  <dd className="mt-1">BC Address Geocoder</dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs uppercase text-slate-500">Score</dt>
                    <dd className="mt-1">{geocodeResult ? `${geocodeResult.score}/100` : '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">Precision</dt>
                    <dd className="mt-1 break-words">{geocodeResult?.matchPrecision ?? '-'}</dd>
                  </div>
                </div>
              </dl>
            </div>
          </div>

          <section className="rounded-lg border bg-white shadow-sm">
            <div className="border-b p-4">
              <h2 className="text-base font-semibold">Candidate Nations</h2>
              <p className="mt-1 text-sm text-slate-600">Select what should be included in the generated acknowledgement.</p>
            </div>
            <div className="divide-y">
              {visibleCandidates.length === 0 && (
                <div className="p-4 text-sm leading-6 text-slate-600">
                  No candidate Nations have been returned from the enabled live sources yet. Try a B.C. address, enable a source with data, or add local verified wording.
                </div>
              )}
              {visibleCandidates.map((candidate) => (
                <article key={candidate.id} className="grid gap-4 p-4 md:grid-cols-[1fr_220px]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleCandidate(candidate.id)}
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded border',
                          selectedIds.includes(candidate.id) ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300',
                        )}
                        aria-label={`Include ${candidate.name}`}
                      >
                        {selectedIds.includes(candidate.id) && <Check className="h-4 w-4" />}
                      </button>
                      <h3 className="min-w-0 flex-1 text-sm font-semibold sm:text-base">{candidate.name}</h3>
                      <span className={cn('rounded-md border px-2 py-0.5 text-xs font-medium', confidenceStyles[candidate.confidence])}>
                        {confidenceLabels[candidate.confidence]}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{candidate.reason}</p>
                    {candidate.pronunciation && (
                      <div className="mt-3 rounded-md border border-teal-100 bg-teal-50 p-3 text-xs leading-5 text-teal-950">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">Pronunciation</span>
                          {candidate.pronunciation.phonetic && (
                            <span className="rounded bg-white px-2 py-0.5 font-medium text-teal-900">
                              {candidate.pronunciation.phonetic}
                            </span>
                          )}
                          {candidate.pronunciation.audioUrl && (
                            <a
                              href={candidate.pronunciation.audioUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium underline"
                            >
                              Listen
                            </a>
                          )}
                          <a
                            href={candidate.pronunciation.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium underline"
                          >
                            {candidate.pronunciation.sourceLabel}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <p className="mt-1 text-teal-800">{candidate.pronunciation.caveat}</p>
                      </div>
                    )}
                    <p className="mt-2 text-xs leading-5 text-slate-500">{candidate.notes}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    {(Object.keys(sourceMeta) as SourceKey[]).map((source) => (
                      <div
                        key={source}
                        className={cn(
                          'rounded-md border p-2',
                          candidate.sources[source] && enabledSources[source] ? 'border-teal-200 bg-teal-50' : 'border-slate-100 bg-slate-50 text-slate-400',
                        )}
                      >
                        <div className="font-medium">{sourceMeta[source].label}</div>
                        <div className="mt-1 leading-4">{candidate.sources[source] ?? 'No match'}</div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>

        <aside className="order-2 space-y-4 lg:order-3">
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Wording Mode</h2>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {(['general', 'event', 'research', 'reflective'] as WordingMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setWordingMode(mode)}
                  className={cn(
                    'rounded-md border px-2 py-2 text-xs font-medium capitalize',
                    wordingMode === mode ? 'border-teal-700 bg-teal-700 text-white' : 'bg-white hover:border-teal-300',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
            <textarea
              value={customWording}
              onChange={(event) => setCustomWording(event.target.value)}
              className="mt-3 min-h-44 w-full resize-none rounded-md border bg-slate-50 p-3 text-sm leading-6 outline-none"
              aria-label="Generated acknowledgement wording"
            />
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Review needed
              </div>
              Confirm wording with local or Nation-specific guidance where possible. CAD outputs are preliminary contact lists, and reserve or treaty layers should not be treated as automatic acknowledgement text.
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Template Prompts</h2>
            </div>
            <div className="space-y-2 text-xs leading-5 text-slate-600">
              {acknowledgementTemplatePrompts.map((item) => (
                <div key={item.label} className="rounded-md border p-3">
                  <div className="font-semibold text-slate-900">{item.label}</div>
                  <p className="mt-1">{item.prompt}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Pronunciation Sources</h2>
            </div>
            <div className="space-y-3 text-xs leading-5 text-slate-600">
              {pronunciationSources.map((source) => (
                <a
                  key={source.name}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md border p-3 transition hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900">{source.name}</span>
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
                  </span>
                  <span className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                    {source.status}
                  </span>
                  <span className="mt-2 block">{source.use}</span>
                  <span className="mt-1 block text-slate-500">{source.caveat}</span>
                </a>
              ))}
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
                Audio links are only shown when they come from a Nation site, FPCC permission/API access, or another source with clear reuse rights.
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Local Language Resources</h2>
            </div>
            <div className="space-y-3 text-xs leading-5 text-slate-600">
              {localLanguageResources.map((resource) => (
                <div key={resource.name} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">{resource.name}</div>
                      <div className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                        {resource.status}
                      </div>
                    </div>
                    <a href={resource.url} target="_blank" rel="noreferrer" aria-label={`Open ${resource.name}`}>
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
                    </a>
                  </div>
                  <p className="mt-2">{resource.use}</p>
                  <p className="mt-1 text-slate-500">{resource.caveat}</p>
                  {(resource.audioUrl || resource.qrUrl) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {resource.audioUrl && (
                        <a href={resource.audioUrl} target="_blank" rel="noreferrer" className="rounded border bg-white px-2 py-1 font-medium text-teal-800">
                          Audio
                        </a>
                      )}
                      {resource.qrUrl && (
                        <a href={resource.qrUrl} target="_blank" rel="noreferrer" className="rounded border bg-white px-2 py-1 font-medium text-teal-800">
                          QR code
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Source Transparency</h2>
            </div>
            <div className="space-y-3 text-xs leading-5 text-slate-600">
              {(Object.keys(sourceMeta) as SourceKey[]).map((source) => (
                <div key={source} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{sourceMeta[source].label}</span>
                    <a href={sourceUrls[source]} target="_blank" rel="noreferrer" aria-label={`Open ${sourceMeta[source].label} source`}>
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                    </a>
                  </div>
                  <p className="mt-1">{sourceMeta[source].description}</p>
                  <p className="mt-2 font-medium text-slate-700">
                    {sourceLookupMessage(sourceLookups[source].status)}
                    {sourceLookups[source].matches.length > 0 && ` · ${sourceLookups[source].matches.length} match${sourceLookups[source].matches.length === 1 ? '' : 'es'}`}
                  </p>
                  {sourceLookups[source].message && <p className="mt-1">{sourceLookups[source].message}</p>}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Practice Sources</h2>
            </div>
            <div className="space-y-3 text-xs leading-5 text-slate-600">
              {acknowledgementPracticeSources.map((source) => (
                <div key={source.name} className="rounded-md border p-3">
                  <div className="font-semibold text-slate-900">{source.name}</div>
                  <div className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                    {source.status}
                  </div>
                  <p className="mt-2">{source.use}</p>
                  <p className="mt-1 text-slate-500">{source.limitation}</p>
                  <p className="mt-2 break-words font-mono text-[10px] text-slate-400">{source.path}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}
