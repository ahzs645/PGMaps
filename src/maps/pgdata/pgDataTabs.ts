import type { ElementType } from 'react'
import { Bus, ShieldAlert, Trees } from 'lucide-react'

export type PGDataTab = 'crime' | 'parks' | 'transit'

export const PG_DATA_TABS: Array<{ id: PGDataTab; label: string; icon: ElementType }> = [
  { id: 'crime', label: 'Crime', icon: ShieldAlert },
  { id: 'parks', label: 'Parks & Trails', icon: Trees },
  { id: 'transit', label: 'Transit', icon: Bus },
]

export function parsePgDataTab(value: string | null): PGDataTab {
  return PG_DATA_TABS.some((entry) => entry.id === value) ? (value as PGDataTab) : 'crime'
}
