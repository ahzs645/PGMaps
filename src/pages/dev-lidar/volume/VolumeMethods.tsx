import { Link } from 'react-router-dom'
import { SidebarSection } from '@/components/ui/map-panels'

export function VolumeMethods() {
  return (
    <section
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6"
      aria-label="Forest volume measurement practices"
    >
      <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-2">
        <SidebarSection title="1 · Estimate a forest stand with airborne LiDAR">
          <p className="text-sm leading-6">
            Use surveyed field plots to connect LiDAR height and cover metrics to measured stem volume per hectare. Fit
            and validate a local model, map it at comparable plot support, then sum supported area × m³/ha.
          </p>
          <p className="mt-2 text-xs leading-5">
            Field crews record tree species, diameter at breast height, heights and condition. Regional volume or taper
            equations compile those measurements into a consistently defined plot volume. Plot coordinates, footprint
            and survey dates must match the LiDAR.
          </p>
          <a
            className="mt-2 block text-xs underline"
            href="https://publications.gc.ca/site/eng/9.843782/publication.html"
            target="_blank"
            rel="noreferrer"
          >
            NRCan · area-based model development guide
          </a>
          <a
            className="mt-2 block text-xs underline"
            href="https://www2.gov.bc.ca/gov/content/industry/forestry/managing-our-forest-resources/forest-inventory/forest-cover-inventories/light-detection-and-ranging"
            target="_blank"
            rel="noreferrer"
          >
            BC · LEFI Tier 2 uses area-based volume modelling
          </a>
        </SidebarSection>
        <SidebarSection title="2 · Estimate individual trees and logs">
          <p className="text-sm leading-6">
            Reliable tree volume needs diameter, height, species and a suitable taper/volume equation. Merchantable
            volume also depends on stump height, minimum top diameter, defects and product specifications.
          </p>
          <p className="mt-2 text-xs leading-5">
            Airborne crown isolation supplies candidate tree locations and heights. It does not reliably supply
            breast-height diameter or a complete stem. A dense ground or mobile scan can help measure stems; TreeQSM can
            model woody cylinders where the scan supports that geometry.
          </p>
          <a
            className="mt-2 block text-xs underline"
            href="https://www2.gov.bc.ca/gov/content/industry/forestry/competitive-forest-industry/timber-pricing/timber-cruising/cruise-compilation-manual"
            target="_blank"
            rel="noreferrer"
          >
            BC · Cruise Compilation Manual and amendments
          </a>
          <a
            className="mt-2 block text-xs underline"
            href="https://github.com/InverseTampere/TreeQSM"
            target="_blank"
            rel="noreferrer"
          >
            TreeQSM · dense single-tree laser scans
          </a>
        </SidebarSection>
        <SidebarSection title="Keep these volumes separate">
          <dl className="space-y-3 text-sm leading-6">
            <div>
              <dt className="font-semibold">Canopy space</dt>
              <dd>
                Space under a canopy surface or occupied by voxels. It contains air, leaves and branches; it is not
                solid timber.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Gross stem volume</dt>
              <dd>
                Stem wood under the chosen bark and diameter conventions, before merchantability and defect deductions.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Merchantable volume</dt>
              <dd>
                The portion meeting the chosen utilization rules. The completed Québec example predicts this target
                directly.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Recovered volume</dt>
              <dd>
                A planning scenario after explicit retention and extraction assumptions. It is not a log-grade
                prediction.
              </dd>
            </div>
          </dl>
        </SidebarSection>
        <SidebarSection title="What to do with your BC tile">
          <ol className="list-decimal space-y-2 pl-4 text-sm leading-6">
            <li>Download the matching 50 × 50 m reference footprints from the calibration view.</li>
            <li>Compile measured plot volumes using one definition and compatible field/LiDAR dates.</li>
            <li>Fit the local model; inspect bias, error, predictor coverage and stand types.</li>
            <li>Validate with independent areas before using totals for operational decisions.</li>
          </ol>
          <p className="mt-3 text-xs leading-5">
            The Québec example’s return-height percentiles and cover are different predictors from the BC tile’s
            canopy-surface metrics. Its coefficients are never transferred to BC.
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-xs underline">
            <Link to="/dev/lidar/canopy/">See the completed BC canopy map</Link>
            <Link to="/dev/lidar/compare/">Inspect completed tree-model comparisons</Link>
          </div>
        </SidebarSection>
      </div>
    </section>
  )
}
