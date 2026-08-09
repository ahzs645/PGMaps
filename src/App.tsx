import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { MapPinned } from 'lucide-react'
import { Shell } from '@/components/layout/Shell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SharedMapLayout } from '@/components/layout/SharedMapLayout'
import { Button } from '@/components/ui/button'
import { MapLoader } from '@/components/ui/map-loader'
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
const DevBoundaries = lazy(() => import('@/pages/DevBoundaries'))
const DevBcerBoundaries = lazy(() => import('@/pages/DevBcerBoundaries'))
const DevDesign = lazy(() => import('@/pages/DevDesign'))
const DevLoad = lazy(() => import('@/pages/DevLoad'))
const DevData = lazy(() => import('@/pages/DevData'))
const DevInteract = lazy(() => import('@/pages/DevInteract'))
const DevInteractSewage = lazy(() => import('@/pages/DevInteractSewage'))
const DevWait = lazy(() => import('@/pages/DevWait'))
const DevWaitSpecialist = lazy(() => import('@/pages/DevWaitSpecialist'))
const DevFallout = lazy(() => import('@/pages/DevFallout'))
const DevAcknowledgement = lazy(() => import('@/pages/DevAcknowledgement'))
const DevHealthMsp = lazy(() => import('@/pages/DevHealthMsp'))
const DevNetworks = lazy(() => import('@/pages/DevNetworks'))
const DevProjects = lazy(() => import('@/pages/DevProjects'))
const AqMapSection = lazy(() => import('@/maps/aqmap').then(m => ({ default: m.AqMapSection })))

function RouteLoadingFallback() {
  return (
    <div className="relative h-full min-h-64 bg-background">
      <MapLoader label="Loading map" />
    </div>
  )
}

function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-b from-background to-muted/30 px-6 py-16 text-center">
      <div className="max-w-md">
        <MapPinned className="mx-auto mb-5 h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Map not found</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This page may have moved, or the address may be incomplete.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">Return to PGMaps</Link>
        </Button>
      </div>
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
          <Route path="/dev/boundaries" element={<DevBoundaries />} />
          <Route path="/dev/boundaries/bcer" element={<DevBcerBoundaries />} />
          <Route path="/dev/design" element={<DevDesign />} />
          <Route path="/dev/load" element={<DevLoad />} />
          <Route path="/dev/data" element={<DevData />} />
          <Route path="/dev/interact" element={<DevInteract />} />
          <Route path="/dev/interact/sewage" element={<DevInteractSewage />} />
          <Route path="/dev/wait" element={<Navigate to="/dev/health/wait" replace />} />
          <Route path="/dev/wait/specialist" element={<Navigate to="/dev/health/wait/specialist" replace />} />
          <Route path="/dev/health/wait" element={<DevWait />} />
          <Route path="/dev/health/wait/specialist" element={<DevWaitSpecialist />} />
          <Route path="/dev/fallout" element={<DevFallout />} />
          <Route path="/dev/acknowledgement" element={<DevAcknowledgement />} />
          <Route path="/dev/health/msp" element={<DevHealthMsp />} />
          <Route path="/dev/networks" element={<DevNetworks />} />
          <Route path="/dev/projects" element={<DevProjects />} />
          <Route path="/dev/projects/:projectSlug" element={<DevProjects />} />
          <Route path="/dev/aqmap" element={<AqMapSection />} />
          <Route path="/dev/aqmap/main" element={<AqMapSection variant="main" />} />
          <Route path="/dev/aqmap/ring" element={<AqMapSection variant="ring" />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </Shell>
  )
}

export default App
