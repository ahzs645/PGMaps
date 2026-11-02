import { PUBLISHED_PERIODS, type PublishedPeriod, type SoilMoistureRegime } from '@/features/forest-drought/published'

export interface PublishedQuerySelection {
  bgc: string
  smr: SoilMoistureRegime | ''
  period: PublishedPeriod | ''
  issues: Partial<Record<'bgc' | 'smr' | 'period', string>>
}

/** Query values are explicit inputs. An invalid supplied value never becomes an assumed soil or period. */
export function parsePublishedSelection(search: string): PublishedQuerySelection {
  const query = new URLSearchParams(search)
  const issues: PublishedQuerySelection['issues'] = {}
  let bgc = query.get('bgc')?.trim() ?? ''
  let smr: SoilMoistureRegime | '' = ''
  let period: PublishedPeriod | '' = '2050'

  if (query.getAll('bgc').length > 1) {
    bgc = ''
    issues.bgc = 'The link supplies more than one BGC identifier. Choose the intended published unit.'
  }
  if (query.has('smr')) {
    const value = query.get('smr') ?? ''
    if (query.getAll('smr').length === 1 && /^[1-5]$/.test(value)) smr = Number(value) as SoilMoistureRegime
    else issues.smr = 'The linked soil moisture regime is not one of the published codes 1–5. Choose a regime.'
  }
  if (query.has('period')) {
    const match = PUBLISHED_PERIODS.find((entry) => entry.id === query.get('period'))
    if (query.getAll('period').length === 1 && match) period = match.id
    else {
      period = ''
      issues.period = 'The linked climate period is not one of the six published periods. Choose a period.'
    }
  }
  return { bgc, smr, period, issues }
}
