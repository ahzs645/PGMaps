/** A reproducible vector figure drawn from the invented scenario and the actual historical trace outputs. */
import { historicalSharedUsage, traceHistoricalAccess } from '../../src/pages/dev-forestry-roads/accessHistory'
import type { HistoricalAccessPath } from '../../src/pages/dev-forestry-roads/accessHistoryTypes'
import { ACCESS_HISTORY_TRAINING_IDS as ids } from '../../src/pages/dev-forestry-roads/trainingAccessHistoryScenario'
import type { ContextFeature, Coordinate, RoadProject } from '../../src/pages/dev-forestry-roads/types'

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
const xml = (value: unknown) => String(value).replace(/[&<>"']/g, (character) => entities[character])
const metres = (value: number) => `${Math.round(value).toLocaleString('en-CA')} m`
const number = (value: number) => value.toFixed(2)
const lineCoordinates = (feature: ContextFeature): Coordinate[] =>
  feature.geometry.type === 'LineString' ? feature.geometry.coordinates.map((point) => [point[0], point[1]]) : []

/** This figure is intentionally specific to the synthetic teaching project, never to a live ministry extract. */
export function accessHistoryDiagram(project: RoadProject): string {
  const state = project.accessHistory
  if (!state || !state.sources.length || state.sources.some((source) => !source.synthetic))
    throw Error('The comparison diagram requires the synthetic training project and synthetic evidence sources.')
  const feature = (id: string) => {
    const value = project.context.find((item) => item.id === id)
    if (!value) throw Error(`The synthetic comparison is missing ${id}.`)
    return value
  }
  const outlet = state.anchors.find((anchor) => anchor.id === ids.outlet)
  const bridge = state.structures.find((structure) => structure.id === ids.bridge)
  if (!outlet || !bridge) throw Error('The synthetic comparison needs its named outlet and shared bridge.')
  const origin = outlet.coordinate
  const metresPerDegree = 111195
  const longitudeScale = metresPerDegree * Math.cos((origin[1] * Math.PI) / 180)
  const local = (point: readonly number[]) =>
    [(point[0] - origin[0]) * longitudeScale, (point[1] - origin[1]) * metresPerDegree] as const
  const allCoordinates = project.context.flatMap((item) =>
    item.geometry.type === 'LineString'
      ? item.geometry.coordinates
      : item.geometry.type === 'Polygon'
        ? item.geometry.coordinates.flat()
        : [],
  )
  const localCoordinates = allCoordinates.map(local)
  const bounds = [
    Math.min(...localCoordinates.map(([x]) => x)),
    Math.min(...localCoordinates.map(([, y]) => y)),
    Math.max(...localCoordinates.map(([x]) => x)),
    Math.max(...localCoordinates.map(([, y]) => y)),
  ]
  const panelWidth = 672,
    panelTop = 178,
    plotTop = 288,
    plotWidth = 600,
    plotHeight = 350
  const scale = Math.min(plotWidth / (bounds[2] - bounds[0]), plotHeight / (bounds[3] - bounds[1]))
  const dates = ['2010-06-30', '2022-08-01']
  const panels = dates.map((asOf) => {
    const trace = (blockId: string) =>
      traceHistoricalAccess({ context: project.context, state, blockId, settings: { asOf } })
    const a = trace(ids.blockA),
      b = trace(ids.blockB)
    if (!a.paths.length || !b.paths.length)
      throw Error(`The synthetic example has no complete route for both blocks on ${asOf}.`)
    const pathA = a.paths[0],
      pathB = b.paths[0]
    return {
      asOf,
      pathA,
      pathB,
      bridgeStatus: a.structures.find((item) => item.structureId === ids.bridge)?.status ?? 'unknown',
      shared: historicalSharedUsage([pathA, pathB], state),
    }
  })
  const panelSvg = panels
    .map((panel, index) => {
      const left = 36 + index * (panelWidth + 24),
        plotLeft = left + 36
      const projectPoint = (point: readonly number[]) => {
        const [x, y] = local(point)
        return [plotLeft + (x - bounds[0]) * scale, plotTop + (bounds[3] - y) * scale] as const
      }
      const path = (coordinates: readonly (readonly number[])[]) =>
        coordinates
          .map((point, i) => {
            const [x, y] = projectPoint(point)
            return `${i ? 'L' : 'M'}${number(x)},${number(y)}`
          })
          .join(' ')
      const text = (x: number, y: number, value: string, className = 'label', anchor = 'start') =>
        `<text x="${number(x)}" y="${number(y)}" class="${className}" text-anchor="${anchor}">${xml(value)}</text>`
      const isFuture = (id: string) =>
        state.events.some(
          (event) =>
            event.roadId === id &&
            event.kind === 'constructed' &&
            event.when.earliest &&
            event.when.earliest > panel.asOf,
        )
      const blocks = [ids.blockA, ids.blockB]
        .map((id, i) => {
          const block = feature(id)
          if (block.geometry.type !== 'Polygon') throw Error('Training blocks must retain their polygon coordinates.')
          const points = block.geometry.coordinates[0].map(projectPoint)
          const x = (Math.min(...points.map(([x]) => x)) + Math.max(...points.map(([x]) => x))) / 2
          const y = (Math.min(...points.map(([, y]) => y)) + Math.max(...points.map(([, y]) => y))) / 2
          return `<g data-feature-id="${xml(id)}"><path d="${block.geometry.coordinates.map((ring) => `${path(ring)} Z`).join(' ')}" class="block block-${i ? 'b' : 'a'}" fill-rule="evenodd"/>${text(x, y - 4, `Block ${i ? 'B' : 'A'}`, 'block-label', 'middle')}${text(x, y + 13, `${block.harvestEvidence?.startYear}–${block.harvestEvidence?.endYear}`, 'block-date', 'middle')}</g>`
        })
        .join('\n')
      const roads = project.context
        .filter((item) => item.kind === 'existing-road')
        .map((road) => {
          const unknown = !state.events.some((event) => event.roadId === road.id)
          return `<path data-feature-id="${xml(road.id)}" d="${path(lineCoordinates(road))}" class="road${isFuture(road.id) ? ' future' : unknown ? ' undated' : ''}"><title>${xml(road.name)}</title></path>`
        })
        .join('\n')
      const routes = (
        [
          ['b', panel.pathB],
          ['a', panel.pathA],
        ] as [string, HistoricalAccessPath][]
      )
        .map(
          ([letter, route]) =>
            `<path data-trace-id="${xml(route.id)}" data-length-m="${route.lengthM}" d="${path(route.coordinates)}" class="route route-${letter}"><title>Computed block ${letter.toUpperCase()} candidate: ${xml(metres(route.lengthM))}</title></path>`,
        )
        .join('\n')
      const stream = project.context
        .filter((item) => item.kind === 'stream')
        .map((item) => `<path d="${path(lineCoordinates(item))}" class="stream"/>`)
        .join('')
      const overpass = lineCoordinates(feature(ids.overpass))
      const [overpassX, overpassY] = projectPoint(overpass[overpass.length - 1])
      const [bridgeX, bridgeY] = projectPoint(bridge.coordinate)
      const bridgeUsed = panel.pathA.structureIds.includes(ids.bridge) && panel.pathB.structureIds.includes(ids.bridge)
      const reports = [
        ...new Set(
          bridge.evidence
            .filter(
              (evidence) =>
                evidence.kind === 'load-rating' &&
                evidence.validFrom &&
                evidence.validFrom <= panel.asOf &&
                (!evidence.validUntil || evidence.validUntil >= panel.asOf),
            )
            .flatMap((evidence) => (evidence.ratedLoadTonnes === null ? [] : [evidence.ratedLoadTonnes])),
        ),
      ].sort((a, b) => b - a)
      const closedFrom = bridge.evidence
        .filter((evidence) => evidence.kind === 'closure' && evidence.validFrom && evidence.validFrom <= panel.asOf)
        .map((evidence) => evidence.validFrom!)
        .sort()[0]
      const bridgeSymbol = `<g data-structure-id="${xml(bridge.id)}" class="${bridgeUsed ? 'bridge-used' : 'bridge-unavailable'}"><rect x="${number(bridgeX - 10)}" y="${number(bridgeY - 8)}" width="20" height="16" rx="2"/>${bridgeUsed ? `<path d="M${number(bridgeX - 6)},${number(bridgeY - 4)}H${number(bridgeX + 6)}M${number(bridgeX - 6)},${number(bridgeY + 4)}H${number(bridgeX + 6)}"/>` : `<path d="M${number(bridgeX - 5)},${number(bridgeY - 5)}l10,10m0,-10l-10,10"/>`}</g>`
      const culvert = state.structures.find((structure) => structure.id === ids.culvert)
      let culvertSvg = ''
      if (culvert) {
        const [x, y] = projectPoint(culvert.coordinate)
        culvertSvg = `<circle cx="${number(x)}" cy="${number(y)}" r="6" class="culvert"/>${text(x + 12, y + 20, 'Culvert', 'map-note')}`
      }
      const anchors = state.anchors
        .map((anchor) => {
          const [x, y] = projectPoint(anchor.coordinate)
          return `<circle cx="${number(x)}" cy="${number(y)}" r="5" class="anchor"/>${anchor.role === 'outlet' ? text(x, y + 24, 'Network outlet', 'map-note') : ''}`
        })
        .join('')
      const bypass = lineCoordinates(feature(ids.bypass))
      const bypassMiddle: Coordinate = [(bypass[1][0] + bypass[2][0]) / 2, (bypass[1][1] + bypass[2][1]) / 2]
      const [bypassX, bypassY] = projectPoint(bypassMiddle)
      const bypassYear =
        state.events
          .find((event) => event.roadId === ids.bypass && event.kind === 'constructed')
          ?.when.earliest?.slice(0, 4) ?? 'unknown'
      const track = lineCoordinates(feature(ids.undated)).map(projectPoint)
      const trackX = track[0][0] + (track[1][0] - track[0][0]) * 0.36
      const trackY = track[0][1] + (track[1][1] - track[0][1]) * 0.36
      const trackAngle = (Math.atan2(track[1][1] - track[0][1], track[1][0] - track[0][0]) * 180) / Math.PI
      const summary = bridgeUsed
        ? [
            `Block B candidate: ${metres(panel.pathB.lengthM)}; both routes use this bridge.`,
            `Shared road length: ${metres(panel.shared.sharedRoadLengthM)}; counted once.`,
            `Unique road length in these routes: ${metres(panel.shared.uniqueRoadLengthM)}.`,
            `The ${bypassYear} bypass cannot explain access in ${panel.asOf.slice(0, 4)}.`,
          ]
        : [
            `Bridge closure applies from ${closedFrom ?? 'an unknown date'}.`,
            `Applicable ratings: ${reports.map((rating) => `${rating} t`).join(' / ')}; status: ${panel.bridgeStatus}.`,
            `Block B also uses the bypass: ${metres(panel.pathB.lengthM)}.`,
            'This date is outside both reported harvest intervals.',
          ]
      return `<g aria-label="Access comparison at ${panel.asOf}">
<rect x="${left}" y="${panelTop}" width="${panelWidth}" height="626" rx="14" class="panel"/>
${text(left + 24, 208, `AS OF ${panel.asOf}`, 'date-label')}
${text(left + 24, 240, `Block A → outlet · ${metres(panel.pathA.lengthM)}`, 'route-heading')}
${text(left + 24, 263, bridgeUsed ? 'Date-compatible candidate through the shared bridge.' : 'Date-compatible candidate around the unavailable bridge.', 'subtitle')}
${blocks}${stream}${roads}${routes}
<path d="${path(overpass)}" class="overpass-casing"/><path d="${path(overpass)}" class="overpass"/>
${text(overpassX, overpassY - 12, 'No junction', 'map-note', 'middle')}
${bridgeSymbol}${culvertSvg}${anchors}
${text(bridgeX, bridgeY + 30, bridgeUsed ? 'Shared bridge' : 'Bridge unavailable', bridgeUsed ? 'bridge-label halo' : 'conflict-label halo', 'middle')}
${text(bridgeX, bridgeY + 48, bridgeUsed ? 'Both 2010 routes cross here' : `${reports.map((rating) => `${rating} t`).join(' / ')} · ${panel.bridgeStatus}`, 'map-note', 'middle')}
${text(bypassX, bypassY + 20, isFuture(ids.bypass) ? `Future bypass · built ${bypassYear} · excluded` : `Bypass built ${bypassYear}`, 'map-note', 'middle')}
<text transform="translate(${number(trackX)},${number(trackY - 9)}) rotate(${number(trackAngle)})" class="map-note" text-anchor="middle">Undated track · excluded</text>
<path d="M${plotLeft},326v-22m-5,7l5,-7l5,7" class="north"/>${text(plotLeft, 294, 'N', 'map-note', 'middle')}
<path d="M${plotLeft + 24},314h${number(500 * scale)}m-${number(500 * scale)},-4v8m${number(500 * scale)},-8v8" class="scale"/>${text(plotLeft + 24, 333, '0', 'small')}${text(plotLeft + 24 + 500 * scale, 333, '500 m', 'small', 'end')}
<path d="M${left + 24},681H${left + panelWidth - 24}" class="divider"/>
${summary.map((line, i) => text(left + 24, 706 + i * 24, line, i === 0 ? 'summary-strong' : 'summary')).join('\n')}
</g>`
    })
    .join('\n')
  const metadata = {
    synthetic: true,
    scenario: 'training-access-history',
    projection: { type: 'local equirectangular', origin, metresPerDegree, longitudeScale, pixelsPerMetre: scale },
    panels: panels.map(({ asOf, pathA, pathB, bridgeStatus, shared }) => ({
      asOf,
      blockALengthM: pathA.lengthM,
      blockBLengthM: pathB.lengthM,
      blockARoadIds: pathA.roadIds,
      blockAStructureIds: pathA.structureIds,
      bridgeStatus,
      sharedRoadLengthM: shared.sharedRoadLengthM,
      uniqueRoadLengthM: shared.uniqueRoadLengthM,
    })),
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="948" viewBox="0 0 1440 948" role="img" aria-labelledby="title description">
<title id="title">Synthetic training data: historical block-access comparison, 2010 and 2022</title>
<desc id="description">Computed from the invented PGMaps training project. Block A has a ${xml(metres(panels[0].pathA.lengthM))} candidate through the shared bridge in 2010 and a ${xml(metres(panels[1].pathA.lengthM))} candidate using the later bypass in 2022. Block B shares the bridge in 2010. The 2022 closure and conflicting load reports remain visible. These are geometric candidates, not proof of historical use.</desc>
<metadata>${xml(JSON.stringify(metadata))}</metadata>
<style>
text{font-family:Arial,Helvetica,sans-serif;fill:#1c3342} .kicker{font-size:12px;font-weight:700;letter-spacing:1.7px;fill:#527064}.title{font-size:32px;font-weight:700}.subtitle{font-size:14px;fill:#526674}.panel{fill:#fff;stroke:#d4dfdf;stroke-width:1.2}.date-label{font-size:13px;font-weight:700;letter-spacing:1px;fill:#527064}.route-heading{font-size:24px;font-weight:700}.legend{font-size:13px;fill:#3f5565}.block{stroke-width:1.4}.block-a{fill:#e7f3e9;stroke:#80ab89}.block-b{fill:#e7eff9;stroke:#87a3c9}.block-label{font-size:13px;font-weight:700}.block-date{font-size:10px;fill:#4e636d}.road{fill:none;stroke:#bcc7ce;stroke-width:2.7;stroke-linecap:round;stroke-linejoin:round}.future{stroke:#84909a;stroke-width:3;stroke-dasharray:1 7}.undated{stroke:#bbc2c7;stroke-width:2;stroke-dasharray:5 5}.stream{fill:none;stroke:#9dcadf;stroke-width:3}.route{fill:none;stroke-linecap:round;stroke-linejoin:round}.route-b{stroke:#457dc2;stroke-width:9;stroke-opacity:.75}.route-a{stroke:#087e70;stroke-width:4.5}.overpass-casing{fill:none;stroke:white;stroke-width:7}.overpass{fill:none;stroke:#8c97a2;stroke-width:2.5}.map-note{font-size:11px;fill:#526472;paint-order:stroke;stroke:white;stroke-width:4px;stroke-linejoin:round}.anchor{fill:#213b4d;stroke:white;stroke-width:2}.culvert{fill:white;stroke:#356baa;stroke-width:2.5}.bridge-used rect,.bridge-unavailable rect{fill:white;stroke-width:2}.bridge-used{stroke:#087e70;stroke-width:2}.bridge-unavailable{stroke:#bd443c;stroke-width:2.5}.bridge-label{font-size:13px;font-weight:700;fill:#087263}.conflict-label{font-size:13px;font-weight:700;fill:#a93832}.halo{paint-order:stroke;stroke:white;stroke-width:4;stroke-linejoin:round}.north,.scale{fill:none;stroke:#667a85;stroke-width:1.2}.small{font-size:10px;fill:#667a85}.divider{stroke:#dce5e6;stroke-width:1}.summary{font-size:13px;fill:#526674}.summary-strong{font-size:13px;font-weight:700}.footer-heading{font-size:12px;font-weight:700;letter-spacing:1.5px;fill:#527064}.footer{font-size:14px;fill:#405967}.footnote{font-size:12px;fill:#697c86}
</style>
<rect width="1440" height="948" fill="#f3f7f5"/>
<text x="36" y="35" class="kicker">PGMAPS · HISTORICAL ACCESS</text>
<text x="36" y="76" class="title">Synthetic training data</text>
<text x="36" y="105" class="subtitle">The same coordinates and evidence, traced at two dates. Candidate distances come from the routing engine.</text>
<path d="M36,143h42" class="route route-a"/><text x="90" y="148" class="legend">Block A candidate</text>
<path d="M270,143h42" class="route route-b"/><text x="324" y="148" class="legend">Block B candidate</text>
<path d="M510,143h42" class="route route-b"/><path d="M510,143h42" class="route route-a"/><text x="564" y="148" class="legend">Shared road portion</text>
<path d="M780,143h42" class="road future"/><text x="834" y="148" class="legend">Not built at the selected date</text>
${panelSvg}
<text x="36" y="842" class="footer-heading">WHAT THE COMPARISON ESTABLISHES</text>
<text x="36" y="869" class="footer">Geometry and dated evidence change which route is plausible. A candidate does not prove actual use or construction purpose.</text>
<text x="36" y="894" class="footer">The geography, harvest dates, road history and bridge reports are invented. Historical ratings do not authorize present-day road use.</text>
<text x="36" y="925" class="footnote">Generated from training-access-history · identical scale and local projection in both panels · no ministry source extracts</text>
</svg>\n`
}
