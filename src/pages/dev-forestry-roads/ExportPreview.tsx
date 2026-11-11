import { useEffect, useRef } from 'react'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { fitGeometry, type ExportPreview } from './exportCatalog'
import { previewPick, PREVIEW_PICK_SELECTOR, type PickedElement, type PreviewPick } from './previewPick'

const LAYER_COLORS = ['#0d9488', '#d97706', '#2563eb', '#be123c', '#7c3aed', '#4d7c0f']
const GEOMETRY_WIDTH = 640,
  GEOMETRY_HEIGHT = 400

const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`

/**
 * Scales a document wider than its frame down to the frame's width, as a print preview does, so a
 * fixed-size sheet (the plot book's A3) shows whole rather than cropped. Narrower documents, such as
 * the report, are left at their own size.
 */
export function fitToWidth(doc: Document) {
  const root = doc.documentElement
  root.style.removeProperty('zoom')
  const room = root.clientWidth,
    wide = root.scrollWidth
  if (room > 0 && wide > room + 1) root.style.setProperty('zoom', String(room / wide))
}

/**
 * An HTML preview. With `onPick`, a click on a part that has settings (`previewPick.ts`) hands
 * that part up; the frame runs no script of its own, so the page listens on the frame's document.
 */
function HtmlPreview({ html, title, onPick }: { html: string; title: string; onPick?: (pick: PreviewPick) => void }) {
  const latest = useRef(onPick)
  useEffect(() => {
    latest.current = onPick
  })
  // Refits the loaded document whenever the pane changes width (a dialog resize, a phone turned).
  const resize = useRef<ResizeObserver | null>(null)
  useEffect(() => () => resize.current?.disconnect(), [])
  const picking = !!onPick
  const attach = (frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument
    if (!doc) return
    resize.current?.disconnect()
    fitToWidth(doc)
    if (typeof ResizeObserver !== 'undefined') {
      resize.current = new ResizeObserver(() => fitToWidth(doc))
      resize.current.observe(frame)
    }
    if (!picking) return
    const style = doc.createElement('style')
    style.textContent = `${PREVIEW_PICK_SELECTOR}{cursor:pointer}h2:hover{text-decoration:underline}`
    doc.head.append(style)
    doc.addEventListener('click', (event) => {
      // Selecting text to copy it is not a pick.
      if (doc.getSelection()?.toString()) return
      const chain: PickedElement[] = []
      for (
        let element = event.target as Element | null;
        element && element !== doc.body;
        element = element.parentElement
      )
        chain.push({
          tag: element.tagName,
          classes: [...element.classList],
          role: element.getAttribute('data-role'),
          chapter: element.getAttribute('data-chapter'),
          text: element.tagName.toLowerCase() === 'h2' ? element.textContent : null,
        })
      const pick = previewPick(chain)
      if (pick) latest.current?.(pick)
    })
  }
  // Scripts stay off (no `allow-scripts`). Same-origin only lets the frame read its own navigator:
  // a fully opaque frame throws on `navigator.serviceWorker`, which reaches the page as an error.
  const frame = (
    <iframe
      title={`${title} preview`}
      sandbox="allow-same-origin"
      srcDoc={html}
      className="h-full min-h-80 w-full rounded-md border bg-white"
      onLoad={(event) => attach(event.currentTarget)}
    />
  )
  return picking ? (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="min-h-80 flex-1">{frame}</div>
      <p className="shrink-0 text-2xs text-muted-foreground">
        Click a sheet, a title block or a heading to open its settings.
      </p>
    </div>
  ) : (
    frame
  )
}

/**
 * One output's preview, from the same content the download writes. `onPick` makes the parts of a
 * document preview that have settings open them: a title block, a sheet, a report heading, or the
 * whole of an image preview.
 */
export function ExportPreviewView({
  preview,
  title,
  onPick,
}: {
  preview: ExportPreview
  title: string
  onPick?: (pick: PreviewPick) => void
}) {
  switch (preview.type) {
    case 'html':
      return <HtmlPreview html={preview.html} title={title} onPick={onPick} />
    case 'image': {
      const image = (
        <img
          src={preview.src}
          alt={`${title} preview`}
          width={preview.width}
          height={preview.height}
          className="max-h-full max-w-full object-contain"
        />
      )
      const frame = 'flex h-full min-h-60 w-full items-center justify-center rounded-md border bg-white p-2'
      return onPick ? (
        <button
          type="button"
          className={`${frame} cursor-pointer hover:ring-2 hover:ring-primary/40`}
          title="Open the sheet setup"
          aria-label={`${title} preview: open the sheet setup`}
          onClick={() => onPick({ view: 'setup' })}
        >
          {image}
        </button>
      ) : (
        <div className={frame}>{image}</div>
      )
    }
    case 'table':
      return (
        <div className="flex h-full min-h-0 flex-col gap-1.5">
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-md border bg-background">
            <EngineeringTable variant="text" className="min-w-full whitespace-nowrap text-2xs tabular-nums">
              <thead className="sticky top-0 z-10">
                <tr>
                  {preview.header.map((cell, index) => (
                    <ColumnHeader key={index} label={cell} className="text-left" />
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className="max-w-48 truncate !py-0.5" title={cell}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
          </div>
          <p className="shrink-0 text-2xs text-muted-foreground">
            {preview.rows.length < preview.total
              ? `First ${preview.rows.length} of ${preview.total} rows`
              : `${preview.total} row${preview.total === 1 ? '' : 's'}`}{' '}
            · {preview.header.length} columns
          </p>
        </div>
      )
    case 'geometry': {
      const project = fitGeometry(preview.layers, GEOMETRY_WIDTH, GEOMETRY_HEIGHT)
      const path = (line: [number, number][]) =>
        line
          .map(
            (p, i) =>
              `${i ? 'L' : 'M'}${project!(p)
                .map((v) => v.toFixed(1))
                .join(' ')}`,
          )
          .join('')
      return (
        <div className="flex h-full min-h-0 flex-col gap-1.5">
          <div className="min-h-0 flex-1 rounded-md border bg-background p-1">
            {project ? (
              <svg
                viewBox={`0 0 ${GEOMETRY_WIDTH} ${GEOMETRY_HEIGHT}`}
                className="h-full w-full"
                role="img"
                aria-label={`${title} geometry`}
              >
                {preview.layers.map((layer, index) => {
                  const color = LAYER_COLORS[index % LAYER_COLORS.length]
                  return (
                    <g key={layer.name} stroke={color} fill={color}>
                      {layer.lines.map((line, i) => (
                        <path key={i} d={path(line)} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                      ))}
                      {layer.points.map((point, i) => {
                        const [x, y] = project(point)
                        return <circle key={i} cx={x} cy={y} r={2.5} stroke="none" />
                      })}
                    </g>
                  )
                })}
              </svg>
            ) : (
              <p className="p-3 text-xs text-muted-foreground">No geometry to export.</p>
            )}
          </div>
          <ul className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
            {preview.layers.map((layer, index) => (
              <li key={layer.name} className="inline-flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ background: LAYER_COLORS[index % LAYER_COLORS.length] }}
                />
                {layer.name}
                <span className="tabular-nums">
                  {[
                    layer.lines.length && `${layer.lines.length} line${layer.lines.length === 1 ? '' : 's'}`,
                    layer.points.length && `${layer.points.length} point${layer.points.length === 1 ? '' : 's'}`,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )
    }
    case 'text':
      return (
        <div className="flex h-full min-h-0 flex-col gap-1.5">
          <pre className="min-h-0 flex-1 overflow-auto rounded-md border bg-background p-2 font-mono text-3xs leading-4">
            {preview.text}
          </pre>
          <p className="shrink-0 text-2xs tabular-nums text-muted-foreground">
            {preview.lines > 80 ? `First 80 of ${preview.lines.toLocaleString()} lines` : `${preview.lines} lines`} ·{' '}
            {bytes(preview.bytes)}
          </p>
        </div>
      )
  }
}
