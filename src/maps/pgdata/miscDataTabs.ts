import { Database, Droplets, Flame, Footprints, PawPrint, RadioTower, ShieldAlert, Trash2, Trees, Waves, Zap } from 'lucide-react'
import type { SectionTab } from '@/components/layout/SectionTabsBar'

export type MiscDataTab =
  | 'heatShade'
  | 'canue'
  | 'network'
  | 'ev'
  | 'icbc'
  | 'wars'
  | 'openLitterMap'
  | 'walkability'
  | 'water'
  | 'flood'
  | 'drought'
  | 'bcer'

export const MISC_TABS: Array<SectionTab<MiscDataTab>> = [
  { id: 'heatShade', label: 'Heat & Shade', icon: Trees, shortLabel: 'Shade' },
  { id: 'canue', label: 'CANUE', icon: Database },
  { id: 'network', label: 'Network', icon: RadioTower },
  { id: 'ev', label: 'EV Chargers', icon: Zap },
  { id: 'icbc', label: 'ICBC', icon: ShieldAlert },
  { id: 'wars', label: 'WARS', icon: PawPrint },
  { id: 'openLitterMap', label: 'Litter', icon: Trash2 },
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
  openLitterMap: 'OpenLitterMap',
  walkability: 'Walkability Layer',
  water: 'Water Layer',
  flood: 'Flood Layer',
  drought: 'Drought Layer',
  bcer: 'BCER Wells',
}

export function parseMiscDataTab(tab: string | null): MiscDataTab {
  return MISC_TABS.some((entry) => entry.id === tab) ? (tab as MiscDataTab) : 'canue'
}
