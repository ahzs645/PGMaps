import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SectionTabsBar } from '@/components/layout/SectionTabsBar'
import ParksSection from '@/maps/parks/ParksSection'
import CrimeDataSection from './CrimeDataSection'
import TransitDataSection from './TransitDataSection'
import { PG_DATA_TABS, parsePgDataTab, type PGDataTab } from './pgDataTabs'

export default function PGDataSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = parsePgDataTab(searchParams.get('tab'))

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
      <SectionTabsBar tabs={PG_DATA_TABS} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="min-h-0 flex-1">
        {activeContent}
      </div>
    </div>
  )
}
