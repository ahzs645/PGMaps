import { BookOpen, ChevronDown, Play } from 'lucide-react'
import { AccessLockup } from '../components/interfaces/AccessLockup'

type Props = {
  lesson: string
  view: 'tour' | 'guide'
  ribbon?: { id: string; name: string }
}

export function LessonNavigation({ lesson, view, ribbon }: Props) {
  const prefix = ribbon ? '' : '../'
  const ribbonId = ribbon?.id ?? 'ribbon'
  const ribbonUrl = (mode: string) =>
    prefix + 'ribbon.html?' + new URLSearchParams({ lesson, view: mode, interface: ribbonId })
  const workbenchUrl = (mode: string) =>
    (ribbon ? lesson + '/' : '') +
    (mode === 'tour' ? 'tour.html' : 'index.html') +
    (ribbon && ribbonId !== 'ribbon' ? '?' + new URLSearchParams({ interface: ribbonId }) : '')
  const hub =
    prefix + 'index.html' + (ribbon ? '?' + new URLSearchParams({ layout: 'ribbon', interface: ribbonId }) : '')
  const otherView = view === 'tour' ? 'guide' : 'tour'
  const label = view === 'tour' ? 'Open written guide' : 'Play interactive lesson'
  const Icon = view === 'tour' ? BookOpen : Play
  return (
    <nav className="tour-nav" aria-label="Help navigation" data-lesson={lesson} data-view={view}>
      <a className="tour-home" href={hub} aria-label="DDC Access Help">
        <AccessLockup />
      </a>
      <details className="tour-workspace">
        <summary aria-label={'Tutorial workspace, ' + (ribbon?.name ?? 'Engineering workbench')}>
          {ribbon?.name ?? 'Workbench'} <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div>
          <a href={workbenchUrl(view)} aria-current={ribbon ? undefined : 'page'}>
            Engineering workbench
          </a>
          <a href={ribbonUrl(view)} aria-current={ribbon ? 'page' : undefined}>
            {ribbon?.name ?? 'Ribbon'}
          </a>
        </div>
      </details>
      <a href={hub}>All workflows</a>
      <a
        className="tour-guide"
        href={ribbon ? ribbonUrl(otherView) : workbenchUrl(otherView)}
        aria-label={label}
        title={label}
      >
        <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
        <span>{view === 'tour' ? 'Guide' : 'Lesson'}</span>
      </a>
    </nav>
  )
}
