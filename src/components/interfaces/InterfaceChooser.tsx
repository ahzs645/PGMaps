import { ArrowRight, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { layoutIcons, type WorkspaceLayout } from './workspaceLayouts'
import './interfaces.css'

export function InterfaceChooser({
  layouts,
  fallback,
  onChoose,
  current,
  onCancel,
}: {
  layouts: WorkspaceLayout[]
  fallback?: boolean
  onChoose: (layout: WorkspaceLayout) => void
  current?: WorkspaceLayout
  onCancel?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (!node) return
    node.showModal()
    return () => node.close()
  }, [])

  const content = (
    <div className="lp-launcher">
      <div className="lp-mast">
        <p className="lp-mast-title">Road design workspaces</p>
        {onCancel && (
          <button className="lp-close" onClick={onCancel} aria-label="Close interface chooser">
            <X size={18} />
          </button>
        )}
      </div>
      <div className="lp-launch-body">
        <h1>Choose your workspace</h1>
        <p className="lp-intro">Choose how to view your road project. Switch anytime.</p>
        {fallback && (
          <p role="status">The layout settings could not be loaded. You can use the built-in engineering workbench.</p>
        )}
        <div className="lp-cards">
          {layouts.map((layout) => {
            const { id, name, description, preview } = layout
            const Icon = layoutIcons[layout.icon]
            return (
              <button
                key={id}
                className="lp-card"
                data-dock={layout.toolbar?.dock ?? 'none'}
                aria-label={`Open ${name}`}
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
                  <Icon size={23} strokeWidth={1.6} />
                  <span className="lp-card-name">{name}</span>
                  <span className="lp-description">{description}</span>
                  <span className="lp-enter">
                    {current?.id === id ? 'Resume workspace' : 'Open workspace'}
                    <ArrowRight size={17} />
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
  if (!current) return content
  return (
    <dialog
      className="lp-chooser-dialog"
      ref={dialog}
      aria-label="Choose your workspace"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault()
        onCancel?.()
      }}
    >
      {content}
    </dialog>
  )
}
