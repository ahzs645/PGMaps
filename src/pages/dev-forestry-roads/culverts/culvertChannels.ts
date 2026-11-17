/**
 * Each stream culvert's channel for the culvert checks (`culvertChecks`' `channel`): the width
 * recorded on its crossing's stream (`streamAssessment.channelWidthM`, entered by hand or adopted
 * from a terrain reading by the reviewer's click). Only stream culverts with a crossing are listed;
 * a culvert not listed gets no channel checks. Free of DOM and network access.
 */
import type { Culvert } from '../engineeringTypes'
import type { ContextFeature, Crossing } from '../types'
import { culvertPurposeOf } from './culvertShape'
import { crossingForCulvert, type BankfullReading } from './naturalChannel'

export type CulvertChannels = ReadonlyMap<string, { recordedWidthM: number | null; reading: BankfullReading | null }>

export function culvertChannels({
  culverts,
  crossings,
  context,
}: {
  culverts: readonly Culvert[]
  crossings: readonly Crossing[] | undefined
  context: readonly Pick<ContextFeature, 'id' | 'streamAssessment'>[] | undefined
}): CulvertChannels {
  const out = new Map<string, { recordedWidthM: number | null; reading: BankfullReading | null }>()
  if (!crossings?.length) return out
  for (const culvert of culverts) {
    if (culvertPurposeOf(culvert) !== 'stream') continue
    const crossing = crossingForCulvert(culvert, crossings)
    if (!crossing) continue
    const width = context?.find((feature) => feature.id === crossing.featureId)?.streamAssessment?.channelWidthM
    out.set(culvert.id, { recordedWidthM: typeof width === 'number' ? width : null, reading: null })
  }
  return out
}
