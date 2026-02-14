import { Routes, Route } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import Home from '@/pages/Home'
import { FoodMap } from '@/maps/foodmap'
import { AirQualitySection } from '@/maps/airquality'
import { CensusSection } from '@/maps/census'

function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/explorer" element={<div className="p-8">Explorer View - Coming Soon</div>} />
        <Route path="/foodmap" element={<FoodMap />} />
        <Route path="/airquality" element={<AirQualitySection />} />
        <Route path="/census" element={<CensusSection />} />
        <Route path="/socioeconomic" element={<CensusSection />} />
        <Route path="/parks" element={<div className="p-8">Parks & Trails - Coming Soon</div>} />
        <Route path="/score-builder" element={<div className="p-8">Score Builder - Coming Soon</div>} />
      </Routes>
    </Shell>
  )
}

export default App
