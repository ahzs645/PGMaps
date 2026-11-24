import { useEffect, useRef } from 'react'
import { CopyImageButton } from '@/components/ui/copy-image-button'
import { DisclosureRow } from '@/components/ui/disclosure'
import { FramePages } from '@/components/ui/frame-pages'
import { PdfPages } from '@/components/ui/pdf-pages'
import { PicturePreview, ZoomablePreview } from '@/components/ui/picture-preview'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { fitGeometry, type ExportPreview } from './exportCatalog'
import { previewPick, PREVIEW_PICK_SELECTOR, type PickedElement, type PreviewPick } from './previewPick'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'

const LAYER_COLORS = ['#0d9488', '#d97706', '#2563eb', '#be123c', '#7c3aed', '#4d7c0f']
const GEOMETRY_WIDTH = 640,
  GEOMETRY_HEIGHT = 400

const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`

/**
 * Where a document preview stands as it is rebuilt: at the first heading that starts with one of
 * `headings` (the selected contents row's part), at the top for an empty list, or, with null, where
 * the reader last scrolled it, so ticking a box does not jump the page back to its top.
 */
export interface PreviewScroll {
  headings: readonly string[] | null
}

function reveal(doc: Document, scroll: PreviewScroll | undefined, lastTop: number) {
  const view = doc.defaultView
  if (!scroll || !view) return
  if (!scroll.headings) {
    view.scrollTo(0, lastTop)
    return
  }
  const prefixes = scroll.headings
  const heading = prefixes.length
    ? [...doc.querySelectorAll('h2')].find((element) =>
        prefixes.some((prefix) => (element.textContent ?? '').trim().startsWith(prefix)),
      )
    : undefined
  // Scrolls the frame's own document, never the page around it.
  view.scrollTo(0, heading ? Math.max(0, heading.getBoundingClientRect().top + view.scrollY - 8) : 0)
}

/**
 * An HTML preview. With `onPick`, a click on a part that has settings (`previewPick.ts`) hands
 * that part up; the frame runs no script of its own, so the page listens on the frame's document.
 */
function HtmlPreview({
  html,
  title,
  onPick,
  scrollTo,
  page,
}: {
  html: string
  title: string
  onPick?: (pick: PreviewPick) => void
  scrollTo?: PreviewScroll
  page?: 'screen'
}) {
  const latest = useRef(onPick)
  useEffect(() => {
    latest.current = onPick
  })
  // Where the document stands: a contents list's selected part, or where the reader left it.
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const place = useRef(scrollTo)
  const lastTop = useRef(0)
  const scrollKey = scrollTo ? JSON.stringify(scrollTo.headings) : ''
  useEffect(() => {
    place.current = scrollTo
  })
  useEffect(() => {
    const doc = frameRef.current?.contentDocument
    if (doc?.readyState === 'complete') reveal(doc, place.current, lastTop.current)
  }, [scrollKey])
  const picking = !!onPick
  // The viewer zooms the document and fits a wide one (the plot book's A3) to the frame; this finds its place and,
  // where the output has settings, listens for clicks on its parts.
  const attach = (frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument
    if (!doc) return
    if (place.current) {
      reveal(doc, place.current, lastTop.current)
      const view = doc.defaultView
      view?.addEventListener(
        'scroll',
        () => {
          lastTop.current = view.scrollY
        },
        { passive: true },
      )
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
  return (
    <FramePages
      html={html}
      title={title}
      page={page}
      resetKey={title}
      frameRef={(element) => {
        frameRef.current = element
      }}
      onFrameLoad={attach}
      toolbarStart={
        picking ? (
          <span className="truncate text-2xs text-muted-foreground">
            Click a sheet, a title block or a heading to open its settings.
          </span>
        ) : undefined
      }
    />
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
  scrollTo,
}: {
  preview: ExportPreview
  title: string
  onPick?: (pick: PreviewPick) => void
  /** An HTML preview's place as it is rebuilt (`PreviewScroll`); absent opens each document at its top. */
  scrollTo?: PreviewScroll
}) {
  switch (preview.type) {
    case 'html':
      return <HtmlPreview html={preview.html} title={title} onPick={onPick} scrollTo={scrollTo} page={preview.page} />
    case 'pdf':
      return <PdfPages source={preview.blob} title={title} resetKey={title} />
    case 'image':
      // A click on the picture (not a drag) opens the sheet setup; the copy sits on the bar, never on the picture.
      return (
        <PicturePreview
          src={preview.src}
          width={preview.width}
          height={preview.height}
          title={title}
          resetKey={title}
          onPick={onPick ? () => onPick({ view: 'setup' }) : undefined}
          pickLabel={onPick ? `${title} preview: open the sheet setup` : undefined}
          toolbarStart={
            preview.caption ? (
              <span className="truncate text-2xs text-muted-foreground" data-testid="road-export-preview-caption">
                {preview.caption}
              </span>
            ) : undefined
          }
          toolbarEnd={
            preview.copy ? <CopyImageButton png={preview.copy.png}>{preview.copy.label}</CopyImageButton> : undefined
          }
        />
      )
    case 'table':
      return (
        <div className="flex h-full min-h-0 flex-col gap-1.5">
          <div
            className={cn(
              insetBox({ padding: 'none', tone: 'background' }),
              'min-h-0 flex-1 overflow-auto overscroll-none',
            )}
          >
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
          {project ? (
            <ZoomablePreview title={title} resetKey={title} className="min-h-60 flex-1" stageClassName="bg-background">
              <svg
                viewBox={`0 0 ${GEOMETRY_WIDTH} ${GEOMETRY_HEIGHT}`}
                className="h-full w-full"
                role="img"
                aria-label={`${title} geometry`}
              >
                {preview.layers.map((layer, index) => {
                  const color = layer.color ?? LAYER_COLORS[index % LAYER_COLORS.length]
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
            </ZoomablePreview>
          ) : (
            <p className={cn(insetBox({ padding: 'sm', tone: 'background' }), 'p-3 text-xs text-muted-foreground')}>
              No geometry to export.
            </p>
          )}
          <ul className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
            {preview.layers.map((layer, index) => (
              <li key={layer.name} className="inline-flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ background: layer.color ?? LAYER_COLORS[index % LAYER_COLORS.length] }}
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
          {preview.notes?.length ? (
            <DisclosureRow
              title={`${preview.notes.length} note${preview.notes.length === 1 ? '' : 's'}: what the file simplifies or leaves out`}
              className="shrink-0 text-2xs"
            >
              <ul
                className="max-h-32 list-disc overflow-y-auto pl-4 text-2xs text-muted-foreground"
                data-testid="road-export-preview-notes"
              >
                {preview.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </DisclosureRow>
          ) : null}
        </div>
      )
    }
    case 'text':
      return (
        <div className="flex h-full min-h-0 flex-col gap-1.5">
          <pre
            className={cn(
              insetBox({ tone: 'background' }),
              'min-h-0 flex-1 overflow-auto overscroll-none font-mono text-3xs leading-4',
            )}
          >
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
