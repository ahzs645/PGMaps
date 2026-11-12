import { createMirror, snapshot } from 'rrweb-snapshot'
import type { LessonStep, SourceStep } from './ribbonSteps'
import excerptCss from './ribbonExcerpt.css?inline'

type CaptureEvent = { type: number; timestamp: number; data: Record<string, unknown> }
export type Capture = {
  id: string
  title: string
  viewport: { width: number; height: number }
  events: CaptureEvent[]
  steps: SourceStep[]
}
/** Adapt the existing portable export. Its official TourKit player, captured result screens and assets stay together. */
export function buildCapture(original: Capture, sequence: LessonStep[], stage: Document): Capture {
  const start = original.events[0].timestamp
  const events: CaptureEvent[] = [{ ...original.events[0], timestamp: start }]
  const steps: SourceStep[] = []
  let time = 0
  const viewport = { ...original.viewport, height: Math.max(original.viewport.height, 370) }
  events[0].data = { ...events[0].data, ...viewport }
  stage.head.replaceChildren()
  const style = stage.createElement('style')
  style.textContent =
    'body{margin:0;background:#f8f9f5;color:#20332d;font:15px/1.4 system-ui,sans-serif}main{padding:14px}h2{font-size:18px;margin:0 0 12px}' +
    excerptCss
  stage.head.append(style)
  for (const [index, item] of sequence.entries()) {
    if (item.source) {
      const step = item.source
      const before = start + step.atMs
      let snap = original.events.length - 1
      while (snap >= 0 && (original.events[snap].type !== 2 || original.events[snap].timestamp > before)) snap--
      if (snap < 0) throw new Error('The lesson is missing a recorded screen.')
      const origin = original.events[snap].timestamp
      const through = start + (step.afterMs ?? step.atMs)
      for (const event of original.events.slice(snap)) {
        if (event.timestamp > through) break
        events.push({ ...event, timestamp: start + time + 1 + event.timestamp - origin })
      }
      steps.push({
        ...step,
        id: 's' + index,
        atMs: time + 1 + before - origin,
        ...(step.afterMs !== undefined ? { afterMs: time + 1 + through - origin } : {}),
      })
      time += through - origin + 2000
    } else if (item.ribbon) {
      const { markup, label, answer } = item.ribbon
      const main = stage.createElement('main')
      const title = stage.createElement('h2')
      title.textContent = item.title
      main.innerHTML = markup
      main.prepend(title)
      stage.body.replaceChildren(main)
      const target = main.querySelector('[data-lesson-target]')!
      const mirror = createMirror()
      const node = snapshot(stage, { mirror, inlineStylesheet: true })
      if (!node) throw new Error('The Ribbon training screen could not be captured.')
      // rrweb numbers nodes from one. Keep generated nodes distinct from the recorded form fields.
      const offset = 2_000_000
      function rebase(n: NonNullable<ReturnType<typeof snapshot>>) {
        n.id += offset
        if (n.rootId !== undefined) n.rootId += offset
        if ('childNodes' in n) n.childNodes.forEach(rebase)
      }
      const targetId = mirror.getId(target) + offset
      rebase(node)
      events.push({ type: 2, timestamp: start + time + 1, data: { node, initialOffset: { top: 0, left: 0 } } })
      steps.push({
        id: 's' + index,
        title: item.title,
        instruction: item.instruction,
        action: answer ? 'input' : 'click',
        ...(answer ? { value: answer } : {}),
        atMs: time + 2,
        target: { nodeId: targetId, label },
      })
      time += 2000
    }
  }
  events.push({ ...events[0], timestamp: start + time })
  return { ...original, id: original.id + '-ribbon', title: original.title + ' · Ribbon', viewport, steps, events }
}

export function exportPlayer(template: Document, capture: Capture, continueUrl: string) {
  const copy = template.cloneNode(true) as Document
  copy.body.querySelector('.tour-nav')?.remove()
  copy.getElementById('tour-workspace-context')?.remove()
  const continuation = copy.querySelector<HTMLAnchorElement>('.tour-continue a')
  if (continuation) {
    continuation.href = continueUrl
    continuation.target = '_top'
  }
  copy.title = capture.title + ' · TourKit'
  copy.getElementById('tourkit-capture-data')!.textContent = JSON.stringify(capture).replace(/</g, '\\u003c')
  return '<!doctype html>\n' + copy.documentElement.outerHTML
}
