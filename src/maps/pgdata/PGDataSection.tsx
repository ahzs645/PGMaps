import { useEffect, useMemo } from 'react'
import type { ElementType } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ShieldAlert, Trees } from 'lucide-react'
import { cn } from '@/lib/utils'
import ParksSection from '@/maps/parks/ParksSection'
import CrimeDataSection from './CrimeDataSection'

type PGDataTab = 'crime' | 'parks'

const TABS: Array<{
  id: PGDataTab
  label: string
  icon: ElementType
}> = [
  { id: 'crime', label: 'Crime', icon: ShieldAlert },
  { id: 'parks', label: 'Parks & Trails', icon: Trees },
]

function normalizeTab(value: string | null): PGDataTab {
  if (value === 'parks' || value === 'crime') return value
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
    return <CrimeDataSection />
  }, [activeTab])

  const setActiveTab = (tab: PGDataTab) => {
    const params = new URLSearchParams(searchParams)
    params.set('tab', tab)
    setSearchParams(params)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-start gap-3 border-b border-border bg-background/95 px-3 py-2 backdrop-blur md:px-4">
        <div className="flex shrink-0 rounded-lg border border-border bg-muted/40 p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors sm:px-3',
                activeTab === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
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
