import { useEffect, useMemo } from 'react'
import type { ElementType } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bus, ShieldAlert, Trees } from 'lucide-react'
import { cn } from '@/lib/utils'
import { handleHorizontalWheelScroll } from '@/components/ui/horizontal-scroll'
import ParksSection from '@/maps/parks/ParksSection'
import CrimeDataSection from './CrimeDataSection'
import TransitDataSection from './TransitDataSection'

type PGDataTab = 'crime' | 'parks' | 'transit'

const TABS: Array<{
  id: PGDataTab
  label: string
  icon: ElementType
}> = [
  { id: 'crime', label: 'Crime', icon: ShieldAlert },
  { id: 'parks', label: 'Parks & Trails', icon: Trees },
  { id: 'transit', label: 'Transit', icon: Bus },
]

function normalizeTab(value: string | null): PGDataTab {
  if (value === 'parks' || value === 'crime' || value === 'transit') return value
  return 'crime'
}

export default function PGDataSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = normalizeTab(searchParams.get('tab'))

  useEffect(() => {
    if (!searchParams.get('tab')) {
      const params = new URLSearchParams(searchParams)
      params.set('tab', activeTab)
      setSearchParams(params, { replace: true })
    }
  }, [activeTab, searchParams, setSearchParams])

  const activeContent = useMemo(() => {
    if (activeTab === 'parks') return <ParksSection />
    if (activeTab === 'transit') return <TransitDataSection />
    return <CrimeDataSection />
  }, [activeTab])

  const setActiveTab = (tab: PGDataTab) => {
    const params = new URLSearchParams()
    params.set('tab', tab)
    setSearchParams(params)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div
        className="hidden min-w-0 shrink-0 overflow-x-auto border-b border-border bg-background/95 px-2 py-1 backdrop-blur [scrollbar-width:none] md:block md:px-4 md:py-2 [&::-webkit-scrollbar]:hidden"
        onWheel={handleHorizontalWheelScroll}
      >
        <div className="flex w-max rounded-md border border-border bg-muted/40 p-0.5 md:rounded-lg md:p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                'inline-flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors sm:h-7 sm:gap-1.5 sm:px-2.5 sm:text-xs md:h-8 md:rounded-md md:px-3',
                activeTab === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className={id === 'parks' ? 'hidden sm:inline' : ''}>{label}</span>
              {id === 'parks' && <span className="sm:hidden">Parks</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {activeContent}
      </div>
    </div>
  )
}
