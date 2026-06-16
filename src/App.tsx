import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Shell } from '@/components/layout/Shell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SharedMapLayout } from '@/components/layout/SharedMapLayout'
import Home from '@/pages/Home'

const FoodMap = lazy(() => import('@/maps/foodmap').then(m => ({ default: m.FoodMap })))
const AirQualitySection = lazy(() => import('@/maps/airquality').then(m => ({ default: m.AirQualitySection })))
const CensusSection = lazy(() => import('@/maps/census').then(m => ({ default: m.CensusSection })))
const ScoreBuilderSection = lazy(() => import('@/maps/scorebuilder').then(m => ({ default: m.ScoreBuilderSection })))
const ExplorerSection = lazy(() => import('@/maps/explorer').then(m => ({ default: m.ExplorerSection })))
const PGDataSection = lazy(() => import('@/maps/pgdata').then(m => ({ default: m.PGDataSection })))
const MiscDataSection = lazy(() => import('@/maps/pgdata/MiscDataSection'))
const BcAssessmentSection = lazy(() => import('@/maps/bcassessment').then(m => ({ default: m.BcAssessmentSection })))
const DevLibrary = lazy(() => import('@/pages/DevLibrary'))
const DevWatersheds = lazy(() => import('@/pages/DevWatersheds'))
const DevDesign = lazy(() => import('@/pages/DevDesign'))
const DevInteract = lazy(() => import('@/pages/DevInteract'))
const DevInteractSewage = lazy(() => import('@/pages/DevInteractSewage'))
const DevFallout = lazy(() => import('@/pages/DevFallout'))
const DevAcknowledgement = lazy(() => import('@/pages/DevAcknowledgement'))
const AqMapSection = lazy(() => import('@/maps/aqmap').then(m => ({ default: m.AqMapSection })))

function RouteLoadingFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="relative flex h-28 w-28 items-center justify-center">
        <span className="absolute h-24 w-24 rounded-full border border-sky-500/20" />
        <span className="absolute h-20 w-20 animate-ping rounded-full border border-sky-500/25" />
        <span className="absolute h-16 w-16 rounded-full border-2 border-sky-500/45 border-t-transparent animate-spin" />
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background shadow-lg">
          <Loader2 className="h-5 w-5 animate-spin text-sky-600 dark:text-sky-400" aria-hidden="true" />
        </div>
      </div>
      <span className="absolute translate-y-20 rounded-md border border-border bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
        Loading map
      </span>
    </div>
  )
}

function App() {
  return (
    <Shell>
      <ErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explorer" element={<ExplorerSection />} />
          <Route element={<SharedMapLayout />}>
            <Route path="/foodmap" element={<FoodMap />} />
            <Route path="/airquality" element={<AirQualitySection />} />
            <Route path="/pgdata" element={<PGDataSection />} />
          </Route>
          <Route path="/census" element={<CensusSection />} />
          <Route path="/socioeconomic" element={<CensusSection />} />
          <Route path="/parks" element={<Navigate to="/pgdata?tab=parks" replace />} />
          <Route path="/score-builder" element={<ScoreBuilderSection />} />
          <Route path="/misc" element={<MiscDataSection />} />
          <Route path="/bc-assessment" element={<BcAssessmentSection />} />
          <Route path="/dev" element={<DevLibrary />} />
          <Route path="/dev/watersheds" element={<DevWatersheds />} />
          <Route path="/dev/design" element={<DevDesign />} />
          <Route path="/dev/interact" element={<DevInteract />} />
          <Route path="/dev/interact/sewage" element={<DevInteractSewage />} />
          <Route path="/dev/fallout" element={<DevFallout />} />
          <Route path="/dev/acknowledgement" element={<DevAcknowledgement />} />
          <Route path="/dev/aqmap" element={<AqMapSection />} />
          <Route path="/dev/aqmap/main" element={<AqMapSection variant="main" />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </Shell>
  )
}

export default App
