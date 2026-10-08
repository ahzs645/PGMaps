import React from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceProvider, MapSectionLayout, useIsMobile } from '../dist/workspace/index.js'
import { MapSidebarShell } from '../dist/ui/map-panels.js'
import { PanelDialog } from '../dist/ui/dialog-shell.js'
import { EditorialDocumentRenderer, SceneStoryRenderer, type NativeEditorialDocument } from '../dist/stories/index.js'
import '../dist/styles.css'
import '../dist/stories/styles.css'

function ReadingExamples({ id }: { id: string }) {
  const document: NativeEditorialDocument = {
    schema: 'pgmaps-editorial-v1',
    title: 'Embedded narrative',
    categories: [],
    maps: { map: { layers: [], attribution: 'Layout fixture' } },
    views: { view: { mapId: 'map', visibleLayerIds: [], camera: { center: [0, 0], zoom: 2 } } },
    diagrams: {},
    actions: {},
    chapters: [
      {
        id: `${id}-chapter`,
        title: 'Read within this workspace',
        blocks: [
          {
            id: `${id}-sidecar`,
            type: 'sidecar',
            presentation: 'docked',
            steps: [
              {
                id: `${id}-step`,
                content: [{ id: `${id}-copy`, type: 'paragraph', text: ['A reusable narrative and map.'] }],
                media: { type: 'map', mapId: 'map', viewId: 'view' },
              },
            ],
          },
        ],
      },
    ],
  }
  return (
    <div data-reading-examples={id}>
      <div style={{ height: 540 }}>
        <EditorialDocumentRenderer
          document={document}
          sectionUrl={false}
          renderMap={() => <div style={{ height: '100%', background: '#69b7ca' }}>Editorial map surface</div>}
        />
      </div>
      <div style={{ height: 500 }}>
        <SceneStoryRenderer
          title="Embedded scene story"
          layers={[]}
          scenes={[{ label: 'Scene', title: 'Scene title', text: 'Scene narrative.', focus: '', visibleLayerIds: [] }]}
          options={{ layout: 'sidecar', storyCover: false, chapterNavigation: false }}
          renderMap={() => <div style={{ height: '100%', background: '#69b7ca' }}>Scene map surface</div>}
        />
      </div>
    </div>
  )
}

function Probe({ id }: { id: string }) {
  const mobile = useIsMobile()
  return (
    <div data-presentation-probe={id} className="bg-slate-100 dark:bg-slate-950">
      {mobile ? 'mobile' : 'desktop'}
    </div>
  )
}
function NestedScopes() {
  const [open, setOpen] = React.useState(false)
  return (
    <div data-scope-fixture="true" style={{ width: 1000, height: 560 }}>
      <WorkspaceProvider theme="dark" responsive="viewport">
        <Probe id="outer" />
        <div data-desktop-marker="outer" className="hidden workspace-desktop:flex">
          Desktop scope active
        </div>
        <div data-compact-fixture="true" style={{ width: 420, height: 480 }}>
          <WorkspaceProvider theme="light" breakpoint={500}>
            <MapSectionLayout
              mobilePeekTitle="Nested light workspace"
              sidebar={
                <MapSidebarShell title="Fixture controls">
                  <p>Embedded controls</p>
                </MapSidebarShell>
              }
            >
              <Probe id="inner" />
              <div data-desktop-marker="inner" className="hidden workspace-desktop:flex">
                Inner desktop scope
              </div>
              <button onClick={() => setOpen(true)}>Open scoped dialog</button>
              {open && (
                <PanelDialog title="Scoped dialog" onClose={() => setOpen(false)}>
                  <p>Bounded nested content</p>
                </PanelDialog>
              )}
            </MapSectionLayout>
          </WorkspaceProvider>
        </div>
        <div style={{ width: 420, height: 20 }}>
          <WorkspaceProvider responsive="viewport">
            <Probe id="inherited" />
          </WorkspaceProvider>
        </div>
      </WorkspaceProvider>
    </div>
  )
}
const mount = document.createElement('div')
mount.id = 'nested-workspace-fixture'
document.body.replaceChildren(mount)
createRoot(mount).render(
  <>
    <NestedScopes />
    <div style={{ width: 1000, height: 2200 }}>
      <WorkspaceProvider theme="dark" responsive="viewport">
        <div data-reading-frame="true" style={{ width: 400, height: 2200 }}>
          <WorkspaceProvider theme="light">
            <ReadingExamples id="container" />
            <div style={{ width: 400, height: 1100 }}>
              <WorkspaceProvider responsive="viewport">
                <ReadingExamples id="viewport" />
              </WorkspaceProvider>
            </div>
          </WorkspaceProvider>
        </div>
      </WorkspaceProvider>
    </div>
  </>,
)
