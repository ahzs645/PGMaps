import { Bus, ShieldAlert, Trees } from 'lucide-react'
import type { SectionTab } from '@/components/layout/SectionTabsBar'

export type PGDataTab = 'crime' | 'parks' | 'transit'

export const PG_DATA_TABS: Array<SectionTab<PGDataTab>> = [
  { id: 'crime', label: 'Crime', icon: ShieldAlert },
  { id: 'parks', label: 'Parks & Trails', icon: Trees, shortLabel: 'Parks' },
  { id: 'transit', label: 'Transit', icon: Bus },
]

export function parsePgDataTab(value: string | null): PGDataTab {
  return PG_DATA_TABS.some((entry) => entry.id === value) ? (value as PGDataTab) : 'crime'
}
