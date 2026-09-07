import { useState } from 'react'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { downloadProjectPackage, type ProjectPackage } from '@/lib/projectPackages'
import { cn } from '@/lib/utils'

/** Source context must remain reachable in map-first layouts without a sidebar. */
export function StorySourceInfo({ project, className }: { project: ProjectPackage; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn(
          'pointer-events-auto absolute left-3 top-16 z-20 h-9 bg-background/95 shadow-sm md:top-14',
          className,
        )}
      >
        <Info className="mr-1.5 size-3.5" /> Sources and downloads
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto">
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
      </Dialog>
    </>
  )
}
