import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { releaseKey, type Pack } from '../../../../packages/legal-rules/src/contract'
import type { Plan, ReviewCase } from '../plan'
import { groundReadCurrent, groundReadOf } from '../ground/record'
import { setFact } from './caseEdits'
import { landCandidates, LAND_STATUS_INSTRUMENT, MINERAL_TENURE_INSTRUMENT, type LandOffer } from './landCandidates'

const READ_FIRST =
  'Read On this ground, below, for mapped private parcels, reserves, treaty land, licence areas and mineral tenures.'

/**
 * The land status and mineral title questions' hints: what the block's current ground read offers,
 * each with **Use**, which answers the question and records what the answer rests on. Nothing is
 * answered without it.
 */
export function landOfferHints({
  plan,
  block,
  schedule,
  review,
  library,
  onChange,
}: {
  plan: Plan
  block: string
  schedule: string
  review: ReviewCase
  library: Pack[]
  onChange: (review: ReviewCase) => void
}): Partial<Record<string, ReactNode>> {
  const selected = (id: string) => library.find((p) => p.id === id && review.selected.includes(releaseKey(p)))
  const pack = selected(LAND_STATUS_INSTRUMENT)
  const mining = selected(MINERAL_TENURE_INSTRUMENT)
  if (!pack && !mining) return {}
  const read = groundReadOf(plan, block, schedule)
  const current = read && groundReadCurrent(plan, read) ? read : undefined
  const candidates = landCandidates(current)
  if (!candidates) {
    const stale = read ? 'The block shape changed since the ground was read. ' : ''
    return { land: stale + READ_FIRST, 'licence-area': stale + READ_FIRST, 'mineral-title': stale + READ_FIRST }
  }
  const hint = (fact: LandOffer['fact'], target: Pack) => {
    const answered = review.sets[releaseKey(target)]?.facts.find((f) => f.id === fact)?.value
    const offer = candidates.offers.find((o) => o.fact === fact)
    const notes = candidates.notes.filter((n) =>
      fact === 'mineral-title'
        ? /mineral/i.test(n)
        : fact === 'land'
          ? !/licence|mineral/i.test(n)
          : /licence/i.test(n),
    )
    const shown = typeof offer?.value === 'boolean' ? (offer.value ? 'Yes' : 'No') : offer?.value
    return (
      <span className="block space-y-1" data-testid={`land-offer-${fact}`}>
        {offer && (
          <span className="flex flex-wrap items-center gap-2">
            <span>
              Mapped ({candidates.readOn}): <strong>{shown}</strong>. {offer.basis}.
            </span>
            {answered === offer.value ? (
              <span className="text-muted-foreground">Answered</span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onChange(setFact(review, target, fact, offer.value, `Mapped on ${candidates.readOn}: ${offer.basis}`))
                }
              >
                Use
              </Button>
            )}
          </span>
        )}
        {notes.map((n) => (
          <span key={n} className="block text-muted-foreground">
            {n}
          </span>
        ))}
      </span>
    )
  }
  return {
    ...(mining
      ? {
          'mineral-title': hint('mineral-title', mining),
          'in-production': 'Mineral Titles Online shows the title, its holder’s work and any Mines Act permit.',
          pit: 'A pit inside the road’s clearing is still a place dug for gravel or rock.',
        }
      : {}),
    ...(pack ? landHints(pack) : {}),
  }
  function landHints(pack: Pack): Partial<Record<string, ReactNode>> {
    return {
      land: hint('land', pack),
      'licence-area': hint('licence-area', pack),
      'managed-forest':
        'Not mapped publicly: the classification is BC Assessment’s, and the commitment the Private Managed Forest Land Council’s. Ask the owner or the council.',
      'timber-reserved': 'In the Crown grant and the title. ParcelMap BC holds no reservation.',
      'adjacent-crown': 'Read the parcels round the block on the map, or the survey plan.',
    }
  }
}
