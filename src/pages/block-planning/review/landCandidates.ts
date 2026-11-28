/**
 * What the block's ground read (*On this ground*, `ground/groundRead.ts`) offers the land status
 * review (`bc.land-status`): a candidate answer for what land the block is on and which area-based
 * licence holds it, and to the mining review (`bc.mineral-tenure`) whether a mineral title lies over
 * it, each with the mapped shares it rests on. A candidate is never an answer: the
 * reviewer's **Use** sets the fact. A layer that was not read offers nothing and says so; nothing
 * mapped is offered only as "nothing mapped", because ParcelMap BC's fabric and the licence layers
 * are records, not the title.
 *
 * DOM- and network-free.
 */
import type { GroundContextRead, GroundInstrumentRead, GroundRead } from '../ground/record'

export const LAND_STATUS_INSTRUMENT = 'bc.land-status'
export const MINERAL_TENURE_INSTRUMENT = 'bc.mineral-tenure'

/** The land choices, as the pack words them. */
export const LAND = {
  crown: 'Crown land',
  private: 'Private land',
  both: 'Both Crown and private land',
  federal: 'Federal land, including an Indian reserve',
  treaty: 'Treaty settlement land',
} as const

/** The licence area choices, by the ground catalogue instrument that maps each. */
export const LICENCE_AREAS = [
  { instrument: 'tree-farm-licence', choice: 'A tree farm licence' },
  { instrument: 'community-forest', choice: 'A community forest agreement' },
  { instrument: 'woodlot-licence', choice: 'A woodlot licence' },
  { instrument: 'first-nations-woodland-licence', choice: 'A First Nations woodland licence' },
] as const
export const NO_LICENCE_AREA = 'None of these'

/**
 * A mapped share at or above this percentage of the footprint is read as the whole block. The
 * overlay clips in BC Albers, and a parcel or licence drawn to the block's own boundary measures a
 * few hundredths short of it; below this, the rest of the block is offered as other land.
 */
export const WHOLE_SHARE_PERCENT = 99.5

/**
 * A mapped overlap smaller than this, in hectares (100 m²), is read as two drawn boundaries meeting,
 * not as land of that kind in the block: the back-test of 27 November 2026 found private parcels
 * touching harvested blocks by 1–6 m² and candidate old forest areas by 10–30 m². It is a screen,
 * not a survey: the sliver is named, and the offer says so.
 */
export const SLIVER_HA = 0.01

export interface LandOffer {
  fact: 'land' | 'licence-area' | 'mineral-title'
  value: string | boolean
  /** What the offer rests on, as the read holds it. */
  basis: string
}

export interface LandCandidates {
  readOn: string
  offers: LandOffer[]
  /** What the read could not settle, for the hint beside the question. */
  notes: string[]
}

const pct = (share: number) => `${share >= 10 ? share.toFixed(0) : share.toFixed(1)}%`
const shareOf = (read: { coveredHa: number }, footprintHa: number) =>
  footprintHa > 0 && read.coveredHa >= SLIVER_HA ? Math.min(100, (read.coveredHa / footprintHa) * 100) : 0
const sliverM2 = (read: { coveredHa: number }) =>
  read.coveredHa > 0 && read.coveredHa < SLIVER_HA ? Math.round(read.coveredHa * 10_000) : 0
const named = (r: { features: { id: string; name: string }[] }) =>
  r.features
    .slice(0, 3)
    .map((f) => f.id)
    .join(', ') + (r.features.length > 3 ? ` and ${r.features.length - 3} more` : '')

/** The candidates a current ground read offers; `null` when there is no read to offer from. */
export function landCandidates(read: GroundRead | undefined): LandCandidates | null {
  if (!read) return null
  const instrument = (id: string): GroundInstrumentRead | undefined => read.instruments.find((r) => r.instrument === id)
  const context = (id: string): GroundContextRead | undefined => read.context?.find((r) => r.layer === id)
  const offers: LandOffer[] = []
  const notes: string[] = []

  // What land: private parcels, reserves and treaty land, each a share of the footprint.
  const parcels = instrument('private-land')
  const reserves = context('indian-reserves')
  const treaty = context('treaty-lands')
  const unread = [
    !parcels || parcels.status === 'failed' ? 'private parcels' : null,
    !reserves || reserves.status === 'failed' ? 'Indian reserves' : null,
    !treaty || treaty.status === 'failed' ? 'treaty lands' : null,
  ].filter((x): x is string => Boolean(x))
  if (unread.length) {
    notes.push(
      `Not read: ${unread.join(', ')}${read.context ? '' : ' (this read was made before reserves and treaty lands were read; read the ground again)'}. No land is offered until they are.`,
    )
  } else {
    const privateShare = shareOf(parcels!, read.footprintHa)
    const reserveShare = shareOf(reserves!, read.footprintHa)
    const treatyShare = shareOf(treaty!, read.footprintHa)
    const slivers = [
      [parcels!, 'Private parcels'],
      [reserves!, 'Indian reserve land'],
      [treaty!, 'Treaty land'],
    ] as const
    for (const [r, what] of slivers)
      if (sliverM2(r))
        notes.push(
          `${what} touches the block by only ${sliverM2(r)} m², read as the two boundaries meeting rather than land of that kind in the block; check the survey plan.`,
        )
    const truncated = [parcels!, reserves!, treaty!].some((r) => r.status === 'truncated')
    if (truncated) notes.push('A layer holds more records here than were kept, so its share may be low.')
    if (reserveShare >= WHOLE_SHARE_PERCENT)
      offers.push({ fact: 'land', value: LAND.federal, basis: `Indian reserve ${named(reserves!)} covers the block` })
    else if (treatyShare >= WHOLE_SHARE_PERCENT)
      offers.push({ fact: 'land', value: LAND.treaty, basis: `Treaty land ${named(treaty!)} covers the block` })
    else if (reserveShare > 0 || treatyShare > 0)
      notes.push(
        `${reserveShare > 0 ? `Indian reserve land covers ${pct(reserveShare)}` : `Treaty land covers ${pct(treatyShare)}`} of the block: these packs do not assess it, so review the rest as its own block or answer for the part assessed.`,
      )
    else if (privateShare >= WHOLE_SHARE_PERCENT)
      offers.push({
        fact: 'land',
        value: LAND.private,
        basis: `Private parcels cover the block (ParcelMap BC: ${named(parcels!)})`,
      })
    else if (privateShare > 0)
      offers.push({
        fact: 'land',
        value: LAND.both,
        basis: `Private parcels cover ${pct(privateShare)} of the block (ParcelMap BC: ${named(parcels!)}); the rest holds no private parcel`,
      })
    else
      offers.push({
        fact: 'land',
        value: LAND.crown,
        basis:
          'No private parcel, Indian reserve or treaty land is mapped on the block. ParcelMap BC is a record, not the title: a parcel missing from it is still private land',
      })
  }

  // Which area-based licence: the one covering most of the block.
  const licences = LICENCE_AREAS.map((l) => ({ ...l, read: instrument(l.instrument) }))
  const licenceUnread = licences.filter((l) => !l.read || l.read.status === 'failed')
  if (licenceUnread.length) {
    notes.push(
      `Not read: ${licenceUnread.map((l) => l.choice.replace(/^An? /, '')).join(', ')}. No licence area is offered.`,
    )
  } else {
    const mapped = licences
      .map((l) => ({ ...l, share: shareOf(l.read!, read.footprintHa) }))
      .filter((l) => l.share > 0)
      .sort((a, b) => b.share - a.share)
    for (const l of licences)
      if (sliverM2(l.read!))
        notes.push(
          `${l.choice.replace(/^An? /, '')} touches the block by only ${sliverM2(l.read!)} m², read as the licence boundary meeting the block's.`,
        )
    if (!mapped.length)
      offers.push({
        fact: 'licence-area',
        value: NO_LICENCE_AREA,
        basis:
          'No tree farm licence, community forest, woodlot or First Nations woodland licence is mapped on the block',
      })
    else {
      const top = mapped[0]
      offers.push({
        fact: 'licence-area',
        value: top.choice,
        basis: `${top.read!.features[0]?.id ?? top.choice} covers ${pct(top.share)} of the block`,
      })
      if (top.share < WHOLE_SHARE_PERCENT || mapped.length > 1)
        notes.push(
          `Licence areas cover only part of the block (${mapped.map((m) => `${m.choice.replace(/^An? /, '')} ${pct(m.share)}`).join(', ')}): answer for the part harvested under it.`,
        )
    }
  }
  // A mineral or placer title over the block (the block only: its roads are not in the footprint).
  const tenure = instrument('mineral-placer-tenure')
  if (!tenure || tenure.status === 'failed')
    notes.push('Not read: mineral and placer tenures. No mineral title is offered.')
  else if (shareOf(tenure, read.footprintHa) > 0)
    offers.push({
      fact: 'mineral-title',
      value: true,
      basis: `${named(tenure)} ${tenure.features.length === 1 ? 'lies' : 'lie'} over ${pct(shareOf(tenure, read.footprintHa))} of the block`,
    })
  else {
    if (sliverM2(tenure))
      notes.push(
        `A mineral tenure touches the block by only ${sliverM2(tenure)} m², read as the two boundaries meeting.`,
      )
    offers.push({
      fact: 'mineral-title',
      value: false,
      basis: 'No mineral or placer tenure is mapped on the block; its roads were not read',
    })
  }
  return { readOn: read.readOn, offers, notes }
}
