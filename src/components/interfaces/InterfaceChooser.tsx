import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { layoutIcons, type WorkspaceLayout } from './workspaceLayouts'
import './interfaces.css'

/** The dialog behind "Switch workspace": one card per layout, the open one marked current. */
export function InterfaceChooser({
  layouts,
  onChoose,
  current,
  onCancel,
}: {
  layouts: WorkspaceLayout[]
  onChoose: (layout: WorkspaceLayout) => void
  current: WorkspaceLayout
  onCancel: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const node = dialog.current
    if (!node) return
    node.showModal()
    return () => node.close()
  }, [])

  return (
    <dialog
      className="lp-chooser-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <div className="lp-launcher">
        <div className="lp-launch-head">
          <h2 id={titleId}>Choose your workspace</h2>
          <button className="lp-close" onClick={onCancel} aria-label="Close interface chooser">
            <X size={18} />
          </button>
        </div>
        <div className="lp-cards">
          {layouts.map((layout) => {
            const { id, name, description, preview } = layout
            const Icon = layoutIcons[layout.icon]
            const isCurrent = current.id === id
            return (
              <button
                key={id}
                className="lp-card"
                data-dock={layout.toolbar?.dock ?? 'none'}
                aria-label={`Open ${name}`}
                aria-current={isCurrent || undefined}
                onClick={() => onChoose(layout)}
              >
                <span className="lp-preview" aria-hidden="true">
                  {preview ? (
                    <img src={`${import.meta.env.BASE_URL}interface-previews/${preview}`} alt="" />
                  ) : (
                    <Icon className="lp-preview-icon" aria-hidden="true" />
                  )}
                </span>
                <span className="lp-card-content">
                  <span className="lp-card-name">
                    <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                    {name}
                    {isCurrent && <span className="lp-current">Current</span>}
                  </span>
                  <span className="lp-description">{description}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </dialog>
  )
}
