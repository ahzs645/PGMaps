import { LessonNavigation } from './LessonNavigation'
import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import { loadWorkspaceLayouts, type WorkspaceLayout } from '../components/interfaces/workspaceLayouts'
import { useRibbonPreferences } from '../components/interfaces/ribbonPreferences'
import { ribbonRoutes } from './ribbonRoutes'
import { resolveSteps, type LessonStep } from './ribbonSteps'
import { buildCapture, exportPlayer, type Capture } from './ribbonCapture'
import './ribbonExcerpt.css'

const params = new URLSearchParams(location.search)
const id = params.get('lesson') ?? 'sketch-road'
const playing = params.get('view') === 'tour'
const layoutId = params.get('interface') || 'ribbon'
const hub = 'index.html?' + new URLSearchParams({ layout: 'ribbon', interface: layoutId })
const link = (view: string, lesson = id) => 'ribbon.html?' + new URLSearchParams({ lesson, view, interface: layoutId })
const fallback = Object.hasOwnProperty.call(ribbonRoutes, id) ? id + '/index.html' : 'index.html'

async function fetchDocument(file: string) {
  const response = await fetch(file)
  if (!response.ok) throw new Error(`Could not load ${file}.`)
  return new DOMParser().parseFromString(await response.text(), 'text/html')
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function loadLesson(): Promise<Capture> {
  const [response, { default: JSZip }] = await Promise.all([fetch(id + '/' + id + '.tourkit'), import('jszip')])
  if (!response.ok) throw new Error('The editable TourKit lesson could not be loaded.')
  const archive = await JSZip.loadAsync(await response.arrayBuffer())
  const json = await archive.file('capture.json')?.async('string')
  if (!json) throw new Error('The TourKit package is missing capture.json.')
  return JSON.parse(json) as Capture
}
let playerTemplate: Promise<Document> | undefined
function portablePlayer(capture: Capture) {
  playerTemplate ??= fetchDocument(id + '/tour.html').catch((error) => {
    playerTemplate = undefined
    throw error
  })
  return playerTemplate.then((template) => {
    const next = template.querySelector<HTMLAnchorElement>('.tour-continue a')?.dataset.nextLesson
    const destination = new URL(next ? link('tour', next) : hub, location.href)
    return exportPlayer(template, capture, destination.href)
  })
}

type Sources = { layout: WorkspaceLayout; guide: Document; capture: Capture }
async function readSources(): Promise<Sources> {
  if (!Object.hasOwnProperty.call(ribbonRoutes, id))
    throw new Error('This workflow is not in the Ribbon lesson catalog.')
  const [{ layouts }, guide, capture] = await Promise.all([
    loadWorkspaceLayouts(new AbortController().signal),
    fetchDocument(id + '/index.html'),
    loadLesson(),
  ])
  const layout = layouts.find((l) => l.id === layoutId && l.toolbar?.dock === 'top')
  if (!layout)
    throw new Error('This Ribbon layout is unavailable. Open workflow help from an available Ribbon workspace.')
  return { layout, guide, capture }
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <main className="intro">
      <h1>Ribbon workflow help</h1>
      <p role="alert">{message}</p>
      <a href={fallback}>Read the Engineering workbench guide</a>
    </main>
  )
}

function sharedGuide(step: LessonStep, guide: Document) {
  if (!step.source) return null
  const section = guide.querySelector(`section[data-tour-steps~="${CSS.escape(step.source.id)}"]`)
  const figure = section?.querySelector('figure')?.cloneNode(true) as HTMLElement | undefined
  for (const el of figure?.querySelectorAll('[src],[srcset]') ?? []) {
    for (const attr of ['src', 'srcset']) {
      const path = el.getAttribute(attr)
      if (path && !path.startsWith('data:')) el.setAttribute(attr, id + '/' + path)
    }
  }
  let visual = figure
  if (!visual && step.source.screenshot) {
    const image = document.createElement('img')
    image.src = step.source.screenshot.dataUrl
    image.alt = step.source.screenshot.alt
    visual = document.createElement('figure')
    visual.append(image)
  }
  const text = section ? Array.from(section.querySelectorAll('p'), (p) => p.textContent).join(' ') : ''
  // The first station paragraph describes launching the Workbench. The common action is in the capture.
  return {
    text: id === 'station-200' && ['station', 'plan'].includes(step.source.id) ? step.instruction : text,
    figure: visual?.outerHTML,
  }
}

function Player({ html, title }: { html: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const observer = useRef<ResizeObserver>()
  useEffect(() => () => observer.current?.disconnect(), [])
  return (
    <iframe
      className="ribbon-player"
      title={title}
      ref={frame}
      srcDoc={html}
      onLoad={() => {
        observer.current?.disconnect()
        const el = frame.current
        const body = el?.contentDocument?.body
        if (!el || !body) return
        const resize = () => {
          el.style.height = Math.ceil(body.getBoundingClientRect().height + 2) + 'px'
        }
        observer.current = new ResizeObserver(resize)
        observer.current.observe(body)
        resize()
      }}
    />
  )
}

function Help({ layout, guide, capture }: Sources) {
  const { toolbar } = useRibbonPreferences(layout)
  const [error, setError] = useState('')
  const [steps, setSteps] = useState<LessonStep[]>([])
  const stage = useRef<HTMLIFrameElement>(null)
  const [lesson, setLesson] = useState<Capture>()
  const [html, setHtml] = useState('')
  useEffect(() => {
    let active = true
    // Render the real Ribbon components outside the main React render, then capture their DOM.
    const timer = setTimeout(async () => {
      try {
        if (!stage.current?.contentDocument || !toolbar) return
        const sequence = resolveSteps(id, capture.steps, toolbar)
        const data = buildCapture(capture, sequence, stage.current.contentDocument)
        const player = playing ? await portablePlayer(data) : ''
        if (active) {
          setError('')
          setSteps(sequence)
          setLesson(data)
          setHtml(player)
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e))
      }
    }, 0)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [capture, toolbar])
  const nextGuide = guide.querySelector<HTMLAnchorElement>('footer a[data-next-lesson]')
  const sample = guide.querySelector<HTMLAnchorElement>('nav a[download]')
  const firstTab = steps.find((step) => step.ribbon)?.ribbon?.tab
  const start = new URLSearchParams({ example: 'training', interface: layoutId })
  if (firstTab) start.set('ribbonTab', firstTab)
  if (id === 'sketch-road') start.set('lesson', id)
  const training = '../dev/forestry/road-design?' + start
  const setup = guide
    .querySelector('main header h1 + p')
    ?.textContent?.replace(/(?:the )?Engineering workbench/gi, 'the Ribbon')
  const title = capture.title
  document.title = title + ' · Ribbon · DDC Access Help'
  async function editable() {
    if (!lesson) return
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      zip.file('capture.json', JSON.stringify(lesson))
      zip.file('README.txt', 'Open this Ribbon lesson in TourKit Capture Studio.')
      download(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), id + '-ribbon.tourkit')
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <>
      <iframe hidden title="Lesson capture stage" ref={stage} />
      {error ? (
        <ErrorMessage message={error} />
      ) : (
        <>
          <LessonNavigation lesson={id} view={playing ? 'tour' : 'guide'} ribbon={layout} />
          <main>
            <header className="intro">
              <p className="ribbon-context">{layout.name} · Hillside access training project</p>
              <h1>{title}</h1>
              {!playing && setup && <p>{setup}</p>}
              <nav className="actions" aria-label="Lesson options">
                <a className="primary" href={link(playing ? 'guide' : 'tour')}>
                  {playing ? 'Read the Ribbon guide' : 'Play the Ribbon lesson'}
                </a>
                <a href={training} target="_blank" rel="noopener">
                  Try in the live Ribbon
                </a>
                {sample && (
                  <a download href={id + '/' + sample.getAttribute('href')}>
                    {sample.textContent}
                  </a>
                )}
              </nav>
            </header>
            {playing ? (
              html ? (
                <Player html={html} title={title + ' · TourKit'} />
              ) : (
                <p role="status">Preparing the lesson…</p>
              )
            ) : (
              steps.map((s, i) => {
                const shared = sharedGuide(s, guide)
                return (
                  <section className="guide-step" key={i}>
                    <div>
                      <h2>
                        {i + 1}. {s.title}
                      </h2>
                      <p>{shared?.text || s.instruction}</p>
                    </div>
                    {s.ribbon ? (
                      <div role="img" aria-label={s.instruction}>
                        <div
                          ref={(el) => {
                            if (el) el.inert = true
                          }}
                          dangerouslySetInnerHTML={{ __html: s.ribbon.markup }}
                        />
                      </div>
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: shared?.figure ?? '' }} />
                    )}
                  </section>
                )
              })
            )}
            <footer className="guide-end">
              <a href={hub}>All Ribbon workflows</a>
              {lesson && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      portablePlayer(lesson)
                        .then((player) => download(new Blob([player], { type: 'text/html' }), id + '-ribbon.html'))
                        .catch((e) => setError(String(e)))
                    }
                  >
                    Download offline lesson
                  </button>
                  <button type="button" onClick={editable}>
                    Download editable TourKit lesson
                  </button>
                </>
              )}
              <a href={id + '/index.html?' + new URLSearchParams({ interface: layoutId })}>
                Engineering workbench guide
              </a>
              {!playing && nextGuide && (
                <a rel="next" href={link('guide', nextGuide.dataset.nextLesson)}>
                  {nextGuide.textContent}
                </a>
              )}
            </footer>
          </main>
        </>
      )}
    </>
  )
}

const root = createRoot(document.getElementById('ribbon-help')!)
readSources()
  .then((s) => root.render(<Help {...s} />))
  .catch((e) => root.render(<ErrorMessage message={String(e)} />))
