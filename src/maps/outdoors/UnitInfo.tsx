import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'

import { DisclosureCard } from '@/components/ui/disclosure'

import {
  LEH_DRAW_RECORD_URL,
  huntsForUnit,
  loadLehDraws,
  oddsText,
  regulationLinks,
  seasonText,
  type LehHunt,
} from './leh'

type DrawState =
  | { state: 'loading' }
  | { state: 'ready'; drawYear: number | null; hunts: LehHunt[] }
  | { state: 'error'; message: string }

/** The draw report is one file for the province, so every unit panel shares one read. */
function useLehDraws(): DrawState {
  const [draws, setDraws] = useState<DrawState>({ state: 'loading' })
  useEffect(() => {
    let live = true
    loadLehDraws()
      .then((result) => {
        if (live) setDraws({ state: 'ready', ...result })
      })
      .catch((error: unknown) => {
        if (live)
          setDraws({
            state: 'error',
            message: error instanceof Error ? error.message : 'The draw report could not be loaded',
          })
      })
    return () => {
      live = false
    }
  }, [])
  return draws
}

function HuntRow({ hunt }: { hunt: LehHunt }) {
  const tags = [hunt.youth ? 'Youth' : null, hunt.shared ? 'Shared' : null].filter(Boolean).join(' · ')
  return (
    <tr className="border-t border-border align-top">
      <td className="py-1 pr-2">
        <div className="font-medium text-foreground">
          {hunt.zone ? `Zone ${hunt.zone}` : 'Whole unit'}
          {hunt.animalClass ? ` · ${hunt.animalClass}` : ''}
        </div>
        <div className="text-muted-foreground">
          {seasonText(hunt)} · code {hunt.huntCode}
          {tags ? ` · ${tags}` : ''}
        </div>
      </td>
      <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">{hunt.authorizations ?? '–'}</td>
      <td className="whitespace-nowrap py-1 text-right tabular-nums">{oddsText(hunt)}</td>
    </tr>
  )
}

function UnitHunts({ unitId, draws }: { unitId: string; draws: DrawState }) {
  if (draws.state === 'loading') return <p className="text-2xs text-muted-foreground">Loading limited entry hunts…</p>
  if (draws.state === 'error')
    return (
      <p className="text-2xs text-warning">
        Limited entry hunts could not be loaded ({draws.message}). Use the synopsis link below.
      </p>
    )
  const groups = huntsForUnit(draws.hunts, unitId)
  if (groups.length === 0)
    return (
      <p className="text-2xs leading-4 text-muted-foreground">
        No limited entry hunts were drawn for this unit in {draws.drawYear ?? 'the last draw'}. Its hunting, if any, is
        under general open seasons.
      </p>
    )
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.species}>
          <table className="w-full text-2xs leading-4">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-0.5 pr-2 text-xs font-semibold text-foreground">{group.species}</th>
                <th className="pb-0.5 pr-2 text-right font-normal">Tags</th>
                <th className="pb-0.5 text-right font-normal">Odds</th>
              </tr>
            </thead>
            <tbody>
              {group.hunts.map((hunt) => (
                <HuntRow key={hunt.huntCode} hunt={hunt} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

/**
 * What a hunter needs to know about the units in the plan: last draw's limited
 * entry hunts with their odds, and links to the official season tables.
 */
export function UnitInfo({ units }: { units: Array<{ id: string; name?: string }> }) {
  const draws = useLehDraws()
  if (units.length === 0) return null
  const drawYear = draws.state === 'ready' ? draws.drawYear : null
  return (
    <div className="mt-3 space-y-2">
      {units.map((unit) => (
        <DisclosureCard
          key={unit.id}
          title={unit.name ?? `Management Unit ${unit.id}`}
          defaultOpen={units.length === 1}
          contentClassName="space-y-3"
        >
          <section>
            <h4 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Limited entry hunts{drawYear ? `, ${drawYear} draw` : ''}
            </h4>
            <UnitHunts unitId={unit.id} draws={draws} />
          </section>
          <section>
            <h4 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Open seasons and rules
            </h4>
            <ul className="space-y-1 text-2xs leading-4">
              {regulationLinks(unit.id).map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-start gap-1 text-primary underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </DisclosureCard>
      ))}
      <p className="text-2xs leading-4 text-muted-foreground">
        Tags are authorizations drawn; odds are first-choice applicants per tag. These are{' '}
        {drawYear ? `the ${drawYear} draw's` : "the last completed draw's"} results from the{' '}
        <a href={LEH_DRAW_RECORD_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          provincial draw report
        </a>
        , not the coming season's hunts. General open seasons are published only as PDF tables, so they are linked, not
        shown.
      </p>
    </div>
  )
}
