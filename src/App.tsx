import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import Home from '@/pages/Home'

const FoodMap = lazy(() => import('@/maps/foodmap').then(m => ({ default: m.FoodMap })))
const AirQualitySection = lazy(() => import('@/maps/airquality').then(m => ({ default: m.AirQualitySection })))
const CensusSection = lazy(() => import('@/maps/census').then(m => ({ default: m.CensusSection })))
const ScoreBuilderSection = lazy(() => import('@/maps/scorebuilder').then(m => ({ default: m.ScoreBuilderSection })))
const ExplorerSection = lazy(() => import('@/maps/explorer').then(m => ({ default: m.ExplorerSection })))
const PGDataSection = lazy(() => import('@/maps/pgdata').then(m => ({ default: m.PGDataSection })))
const MiscDataSection = lazy(() => import('@/maps/pgdata/MiscDataSection'))
const BcAssessmentSection = lazy(() => import('@/maps/bcassessment').then(m => ({ default: m.BcAssessmentSection })))
const DevWatersheds = lazy(() => import('@/pages/DevWatersheds'))
const DevDesign = lazy(() => import('@/pages/DevDesign'))
const AqMapSection = lazy(() => import('@/maps/aqmap').then(m => ({ default: m.AqMapSection })))

function App() {
  return (
    <Shell>
      <ErrorBoundary>
      <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explorer" element={<ExplorerSection />} />
          <Route path="/foodmap" element={<FoodMap />} />
          <Route path="/airquality" element={<AirQualitySection />} />
          <Route path="/census" element={<CensusSection />} />
          <Route path="/socioeconomic" element={<CensusSection />} />
          <Route path="/parks" element={<Navigate to="/pgdata?tab=parks" replace />} />
          <Route path="/score-builder" element={<ScoreBuilderSection />} />
          <Route path="/pgdata" element={<PGDataSection />} />
          <Route path="/misc" element={<MiscDataSection />} />
          <Route path="/bc-assessment" element={<BcAssessmentSection />} />
          <Route path="/dev" element={<DevWatersheds />} />
          <Route path="/dev/design" element={<DevDesign />} />
          <Route path="/dev/aqmap" element={<AqMapSection />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </Shell>
  )
}

export default App
