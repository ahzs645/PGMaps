/**
 * Documents to request for "On this ground": for each instrument found on the block whose terms are
 * not public, a drafted request naming who holds the terms, what to ask for (the catalogue's
 * `terms`), the identifiers read from each feature and the channel. Text only: nothing is sent, and
 * no holder's name is read, asked for or written.
 *
 * DOM- and network-free.
 */
import { groundInstrument, groundLayer, type GroundInstrument } from '@/lib/legal/groundInstruments'
import type { GroundRead } from './record'

export interface DocumentRequest {
  instrument: string
  label: string
  holder: string
  channel: string
  where: string
  /** Each feature's identifiers, as one line. */
  identifiers: string[]
  /** The request as a reviewer would send it, to copy. */
  text: string
}

const listed = (items: string[]) => items.map((s) => `- ${s}`).join('\n')

/** One request, drafted. Exported for the tests. */
export function draftRequest(
  instrument: GroundInstrument,
  features: GroundRead['instruments'][number]['features'],
  context: { block: string; readOn: string },
): DocumentRequest {
  const identifiers = features.map((f) => {
    const ids = f.identifiers.map((i) => `${i.label} ${i.value}`)
    return ids.length ? ids.join(', ') : f.id
  })
  const text = [
    `Subject: ${instrument.label}: request for its terms (${identifiers[0] ?? instrument.label})`,
    '',
    `To: ${instrument.terms.holder}, through ${instrument.terms.channel}`,
    '',
    `A proposed cutblock (${context.block}) overlaps the ${instrument.label} below, as DataBC's layer "${groundLayer(instrument.layer)?.title ?? instrument.layer}" showed on ${context.readOn}:`,
    listed(identifiers),
    '',
    `Please provide: ${instrument.terms.ask}.`,
    '',
    `The terms are in: ${instrument.terms.where}. They are needed to say whether the instrument restricts harvesting, site preparation and planting, roads or grazing on the block; the mapped record alone does not say.`,
  ].join('\n')
  return {
    instrument: instrument.id,
    label: instrument.label,
    holder: instrument.terms.holder,
    channel: instrument.terms.channel,
    where: instrument.terms.where,
    identifiers,
    text,
  }
}

/** A request for every instrument found on the footprint whose terms are not public. */
export function documentRequests(read: GroundRead, blockName: string): DocumentRequest[] {
  return read.instruments.flatMap((r) => {
    const instrument = groundInstrument(r.instrument)
    if (!instrument || instrument.terms.public || !r.features.length) return []
    return [draftRequest(instrument, r.features, { block: blockName, readOn: read.readOn })]
  })
}
