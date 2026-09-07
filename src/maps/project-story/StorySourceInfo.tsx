import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { downloadProjectPackage, type ProjectPackage } from '@/lib/projectPackages'

/** Use the same slot beside search as other maps' dataset information. */
export function StorySourceInfo({ project }: { project: ProjectPackage }) {
  const [open, setOpen] = useState(false)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const findSlot = () => {
      const target = document.getElementById('dataset-info-toolbar-slot')
      if (target) setSlot(target)
      return target
    }
    if (findSlot()) return
    // Also support shells that mount the toolbar after the story.
    const observer = new MutationObserver(() => {
      if (findSlot()) observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  if (!slot) return null
  return createPortal(
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Sources and downloads"
          title="Sources and downloads"
          className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-md border border-white/70 bg-white/90 text-sm font-medium text-zinc-950 shadow-lg backdrop-blur transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-700/70 dark:bg-zinc-950/90 dark:text-zinc-50 dark:shadow-black/50 dark:hover:bg-zinc-900 md:h-10 md:w-10 md:border-transparent md:bg-transparent md:text-muted-foreground md:shadow-none md:backdrop-blur-none md:hover:bg-accent md:hover:text-accent-foreground"
        >
          <Info className="h-5 w-5" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent
        elevated
        className="max-h-[85svh] overflow-y-auto"
        onKeyDown={(event) => {
          // Also handle Escape during the opening frame, before the modal's
          // document-level dismissable-layer listener has settled.
          if (event.key === 'Escape') {
            event.preventDefault()
            setOpen(false)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Sources and interpretation</DialogTitle>
          <DialogDescription>{project.title}</DialogDescription>
        </DialogHeader>
        <p className="text-sm leading-6 text-muted-foreground">{project.sourceNote}</p>
        {project.details?.map((detail, index) => (
          <p key={index} className="text-sm leading-6 text-muted-foreground">
            {detail}
          </p>
        ))}
        <ul className="space-y-2 text-sm">
          {project.links
            ?.filter((link) => /^(https?:\/\/|\/(?!\/))/.test(link.href))
            .map((link) => (
              <li key={link.href}>
                <a className="text-primary underline underline-offset-4" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
        </ul>
        <Button variant="outline" onClick={() => downloadProjectPackage(project)}>
          Download story JSON
        </Button>
      </DialogContent>
    </Dialog>,
    slot,
  )
}
