import type { ElementType } from 'react'
import { Database, Droplets, Flame, Footprints, PawPrint, RadioTower, ShieldAlert, Trees, Waves, Zap } from 'lucide-react'

export type MiscDataTab =
  | 'heatShade'
  | 'canue'
  | 'network'
  | 'ev'
  | 'icbc'
  | 'wars'
  | 'walkability'
  | 'water'
  | 'flood'
  | 'drought'
  | 'bcer'

export const MISC_TABS: Array<{ id: MiscDataTab; label: string; icon: ElementType }> = [
  { id: 'heatShade', label: 'Heat & Shade', icon: Trees },
  { id: 'canue', label: 'CANUE', icon: Database },
  { id: 'network', label: 'Network', icon: RadioTower },
  { id: 'ev', label: 'EV Chargers', icon: Zap },
  { id: 'icbc', label: 'ICBC', icon: ShieldAlert },
  { id: 'wars', label: 'WARS', icon: PawPrint },
  { id: 'walkability', label: 'Walkability', icon: Footprints },
  { id: 'water', label: 'Water', icon: Droplets },
  { id: 'flood', label: 'Flood', icon: Waves },
  { id: 'drought', label: 'Drought', icon: Droplets },
  { id: 'bcer', label: 'BCER', icon: Flame },
]

export const MISC_LEGEND_TITLES: Record<MiscDataTab, string> = {
  heatShade: 'Heat & Shade Layers',
  canue: 'CANUE Layer',
  network: 'Network Sources',
  ev: 'EV Chargers',
  icbc: 'ICBC Layer',
  wars: 'WARS Layer',
  walkability: 'Walkability Layer',
  water: 'Water Layer',
  flood: 'Flood Layer',
  drought: 'Drought Layer',
  bcer: 'BCER Wells',
}

export function parseMiscDataTab(tab: string | null): MiscDataTab {
  return MISC_TABS.some((entry) => entry.id === tab) ? (tab as MiscDataTab) : 'canue'
}
