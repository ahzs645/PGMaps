import { Link, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { TabBar, type TabOption } from '@/components/ui/tab-bar'
import { InlineAlert } from '@/components/ui/map-panels'
import { NECHAKO_PORTAL } from '@/lib/nechakoPortal'
import { PortalLayers } from '@/maps/nechako/PortalLayers'
import { PortalFormats, PortalProjects, PortalSearch } from '@/maps/nechako/PortalChecks'
import { PortalResearch } from '@/maps/nechako/PortalResearch'
import { FEATURE_COMPARISON, FORMAT_COMPARISON } from '@/maps/nechako/comparison'
import { PortalFiles } from '@/maps/nechako/PortalFiles'
import { PortalMonitoring } from '@/maps/nechako/PortalMonitoring'
import { EMPTY_WORKSPACE, type Workspace } from '@/maps/nechako/data/workspace'

type View = 'layers' | 'search' | 'research' | 'projects' | 'formats' | 'compare' | 'files' | 'monitoring'
const VIEWS: readonly TabOption<View>[] = [
  { value: 'layers', label: 'Layers' },
  { value: 'search', label: 'Search' },
  { value: 'research', label: 'Research' },
  { value: 'projects', label: 'Projects' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'files', label: 'Files & imports' },
  { value: 'formats', label: 'Formats' },
  { value: 'compare', label: 'Comparison' },
]

function Comparison() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Stewardship Portal ↔ PGMaps</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Reviewed October 11, 2026 UTC. Public services were tested live. Protected workflows were assessed from the
        portal client and the supplied guides; they were not exercised with an account. This dev view adds public
        exploration while the portal remains responsible for publishing and permissions.
      </p>
      <InlineAlert title="What loads today">
        Public WMS maps and identify responses, the format registry, search contexts, and the existing literature
        dataset. Search results and saved projects returned registration errors. Private submissions, attachments,
        monitoring records and administration need authenticated integration.
      </InlineAlert>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <caption className="sr-only">Full feature comparison</caption>
          <thead className="bg-muted">
            <tr>
              {['Capability', 'Portal evidence', 'Existing PGMaps', 'This dev view', 'Remaining work'].map((label) => (
                <th key={label} scope="col" className="p-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURE_COMPARISON.map((row) => (
              <tr key={row.feature} className="border-t align-top">
                <th scope="row" className="p-3 font-medium">
                  {row.feature}
                </th>
                <td className="p-3">{row.portal}</td>
                <td className="p-3">{row.pgmaps}</td>
                <td className="p-3">{row.devView}</td>
                <td className="p-3">{row.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="text-lg font-semibold">Data types and conversion</h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[850px] text-left text-sm">
          <caption className="sr-only">Data format comparison</caption>
          <thead className="bg-muted">
            <tr>
              {['Format / source', 'Portal evidence', 'Existing PGMaps', 'Handling still needed'].map((label) => (
                <th key={label} scope="col" className="p-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FORMAT_COMPARISON.map((row) => (
              <tr key={row.format} className="border-t align-top">
                <th scope="row" className="p-3 font-medium">
                  {row.format}
                </th>
                <td className="p-3">{row.evidence}</td>
                <td className="p-3">{row.pgmaps}</td>
                <td className="p-3">{row.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="text-lg font-semibold">CORS and maintenance</h3>
      <ul className="list-disc space-y-2 pl-5 text-sm">
        <li>
          All 32 WMS capabilities URLs were readable from the deployed PGMaps origin. Representative map images and
          identify responses also passed.
        </li>
        <li>
          A later browser check requested PNG maps for all 135 advertised named layers: 132 passed at their reported
          extents. Canvec contours timed out at their reported extent but returned a PNG at watershed scale. Two
          EchoScreen layers, “Cancer rank - Sensitive Population” and “COPD rank - Sensitive Population”, repeatedly
          returned LayerNotDefined. These are source rendering failures, not CORS failures.
        </li>
        <li>
          Anonymous GET and form POST work for the tested public PHP reads. Credentialed requests, JSON POST and
          X-Requested-With were blocked in browser tests.
        </li>
        <li>
          This view uses anonymous reads and form POST. Protected cross-site access requires a deliberate authentication
          design and corresponding server CORS configuration.
        </li>
        <li>
          Fix the portal registration error before verifying search results, saved projects and conversion. The same
          error occurs within the original portal.
        </li>
        <li>
          Local GIS conversion, CSV monitoring, workspace conversion and submission-resource reads are now available.
          Keep portal publishing and permissions authoritative. Protected payloads and server deployment still need
          verification.
        </li>
      </ul>
    </div>
  )
}

export default function DevNechako() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE)
  const [mapBounds, setMapBounds] = useState<[number, number, number, number]>()
  const [params, setParams] = useSearchParams()
  const requested = params.get('view')
  const view: View = VIEWS.some((item) => item.value === requested) ? (requested as View) : 'layers'
  return (
    <div className="container mx-auto space-y-6 px-4 pb-10 pt-24 sm:px-6 md:pt-10">
      <div className="space-y-3">
        <Link to="/dev" className="text-sm text-primary underline">
          Dev library
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Nechako portal workbench</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Explore public portal content from PGMaps and compare what each site supports.
        </p>
        <a
          href={NECHAKO_PORTAL}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-primary underline"
        >
          Open Stewardship Portal
        </a>
      </div>
      <TabBar
        label="Nechako portal views"
        idPrefix="nechako"
        value={view}
        options={VIEWS}
        onChange={(value) =>
          setParams((current) => {
            const next = new URLSearchParams(current)
            next.set('view', value)
            return next
          })
        }
      />
      {/* Keep the map and its selections alive when switching comparison/search tabs. */}
      <section
        role="tabpanel"
        id="nechako-panel-layers"
        aria-labelledby="nechako-tab-layers"
        hidden={view !== 'layers'}
      >
        <PortalLayers workspace={workspace} setWorkspace={setWorkspace} onBounds={setMapBounds} />
      </section>
      <section
        role="tabpanel"
        id="nechako-panel-monitoring"
        aria-labelledby="nechako-tab-monitoring"
        hidden={view !== 'monitoring'}
      >
        <PortalMonitoring />
      </section>
      <section role="tabpanel" id="nechako-panel-files" aria-labelledby="nechako-tab-files" hidden={view !== 'files'}>
        <PortalFiles
          onVectors={(vectors) => {
            setWorkspace((current) => ({ ...current, vectors: [...current.vectors, ...vectors] }))
            setParams((current) => {
              const next = new URLSearchParams(current)
              next.set('view', 'layers')
              return next
            })
          }}
        />
      </section>
      {view !== 'layers' && view !== 'monitoring' && view !== 'files' && (
        <section role="tabpanel" id={`nechako-panel-${view}`} aria-labelledby={`nechako-tab-${view}`}>
          {view === 'search' && <PortalSearch mapBounds={mapBounds} vectors={workspace.vectors} />}
          {view === 'research' && <PortalResearch />}
          {view === 'projects' && <PortalProjects />}
          {view === 'formats' && <PortalFormats />}
          {view === 'compare' && <Comparison />}
        </section>
      )}
    </div>
  )
}
