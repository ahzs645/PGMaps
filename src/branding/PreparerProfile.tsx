import { createContext, useContext, useState, type ReactNode, type Ref } from 'react'
import { IdCard } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FORM_INPUT_CLASS, FormField } from '@/components/ui/form-field'
import { ResultRow } from '@/components/ui/result-list'
import { TextButton } from '@/components/ui/text-button'

import { LogoChooser } from './LogoChooser'
import { EMPTY_PROFILE, PROFILE_FIELD_LIMITS, profileIsEmpty, profileSummary, type PreparerProfile } from './profile'
import { printedLogo, savePreparerProfile } from './store'
import { useBranding } from './useBranding'

const FIELDS: ReadonlyArray<{ key: keyof PreparerProfile; label: string; placeholder: string; hint?: string }> = [
  { key: 'name', label: 'Name', placeholder: 'Your name' },
  { key: 'designation', label: 'Designation', placeholder: 'e.g. RPF, RFT, P.Eng.' },
  {
    key: 'registration',
    label: 'Registration number',
    placeholder: 'Optional',
    hint: 'Printed after the designation.',
  },
  {
    key: 'organisation',
    label: 'Organisation',
    placeholder: 'Your company or office',
    hint: 'Who you work for, not the licensee the work is prepared for.',
  },
  { key: 'contact', label: 'Contact', placeholder: 'Optional: phone or email' },
]

/**
 * Where *Your details* open. A Save & export dialog provides a host and shows the form as its own pane
 * (`PreparerProfilePane`), selected from its first row; everywhere else the row and the links open the modal
 * (`PreparerProfileDialog`). Both are the same form (`usePreparerProfileForm`).
 */
export type PreparerProfileHost = {
  /** Shows the pane. */
  open: () => void
  /** Whether the pane is the one shown, for the row's selection. */
  shown: boolean
}

const PreparerProfileHostContext = createContext<PreparerProfileHost | null>(null)

/** Gives the row and the *Edit your details* links inside it a pane to open instead of the modal. */
export function PreparerProfileHostProvider({ value, children }: { value: PreparerProfileHost; children: ReactNode }) {
  return <PreparerProfileHostContext.Provider value={value}>{children}</PreparerProfileHostContext.Provider>
}

/**
 * The form's state, shared by the modal and the pane. The draft is `null` until a field is edited, so the form
 * shows what is stored (and follows a save made elsewhere) until then.
 */
function usePreparerProfileForm(onSaved?: () => void) {
  const branding = useBranding()
  const [draft, setDraft] = useState<PreparerProfile | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const shown = draft ?? branding.profile ?? EMPTY_PROFILE
  const save = (profile: PreparerProfile | null) => {
    setBusy(true)
    setError('')
    savePreparerProfile(profile)
      .then(() => {
        setDraft(null)
        onSaved?.()
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Your details could not be kept.'))
      .finally(() => setBusy(false))
  }
  return {
    shown,
    dirty: draft !== null,
    error,
    busy,
    stored: !profileIsEmpty(branding.profile),
    edit: (key: keyof PreparerProfile, value: string) => setDraft({ ...shown, [key]: value }),
    reset: () => {
      setDraft(null)
      setError('')
    },
    save: () => save(shown),
    forget: () => save(null),
  }
}

type PreparerProfileForm = ReturnType<typeof usePreparerProfileForm>

function PreparerProfileFields({ form }: { form: PreparerProfileForm }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(({ key, label, placeholder, hint }) => (
          <FormField key={key} label={label} hint={hint} className={key === 'contact' ? 'sm:col-span-2' : undefined}>
            <input
              className={FORM_INPUT_CLASS}
              value={form.shown[key]}
              maxLength={PROFILE_FIELD_LIMITS[key]}
              placeholder={placeholder}
              onChange={(event) => form.edit(key, event.target.value)}
            />
          </FormField>
        ))}
      </div>
      <section className="grid gap-1.5" aria-label="Logo">
        <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Logo</h3>
        <LogoChooser />
      </section>
      <p className="text-xs text-muted-foreground">
        A project prints the name it holds. Use <em>Use my details</em> beside a project’s preparer fields to copy these
        in; a field the project already fills is left as it is. Seal, signature and date are never filled.
      </p>
      {form.error && (
        <p role="alert" className="text-xs text-danger">
          {form.error}
        </p>
      )}
    </div>
  )
}

/** Forget, Cancel and Save. `cancelLabel` is the pane's *Discard changes*, which keeps the pane open. */
function PreparerProfileActions({
  form,
  onCancel,
  cancelLabel = 'Cancel',
  cancelDisabled = false,
}: {
  form: PreparerProfileForm
  onCancel: () => void
  cancelLabel?: string
  cancelDisabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {form.stored && (
        <Button type="button" variant="ghost" disabled={form.busy} onClick={form.forget}>
          Forget my details
        </Button>
      )}
      <Button type="button" variant="outline" disabled={form.busy || cancelDisabled} onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button type="button" disabled={form.busy} onClick={form.save}>
        Save
      </Button>
    </div>
  )
}

const DETAILS_SUBTITLE = 'Kept in this browser for every sheet and report. Never saved in a project or scene file.'

/**
 * *Your details* as a modal: who prepares sheets and reports and the logo they print, kept in this browser's
 * branding store for every tool. A tool's own record (the road issue stamp, the FS1252 office fields) takes these
 * only through *Use my details*; nothing here goes in a project or scene file. Inside a Save & export dialog the
 * same form is its pane (`PreparerProfilePane`) instead.
 */
export function PreparerProfileDialog({
  open,
  onOpenChange,
  portalContainer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  portalContainer?: HTMLElement | null
}) {
  const form = usePreparerProfileForm(() => onOpenChange(false))
  // Each opening starts from what is stored.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) form.reset()
  }
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Your details"
      subtitle={DETAILS_SUBTITLE}
      size="md"
      portalContainer={portalContainer}
      contentProps={{ 'data-testid': 'preparer-profile-dialog' }}
      footer={<PreparerProfileActions form={form} onCancel={() => onOpenChange(false)} />}
    >
      <PreparerProfileFields form={form} />
    </DialogShell>
  )
}

/**
 * *Your details* as a Save & export pane, beside the file list. Keep it mounted while the dialog is open (hide it
 * when another row is shown) so an unsaved edit survives a look at another file; Save stays explicit because the
 * details are shared by every tool in this browser.
 */
export function PreparerProfilePane({
  hidden = false,
  sectionRef,
}: {
  hidden?: boolean
  /** For the dialog to bring the pane up when it sits under the list on a phone. */
  sectionRef?: Ref<HTMLElement>
}) {
  const form = usePreparerProfileForm()
  return (
    <section
      ref={sectionRef}
      aria-label="Your details"
      data-testid="preparer-profile-pane"
      hidden={hidden}
      className={`${hidden ? 'hidden' : 'flex'} min-w-0 flex-col gap-3 p-3 sm:min-h-0 sm:p-5`}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Your details</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{DETAILS_SUBTITLE}</p>
      </div>
      <div className="min-h-0 flex-1 sm:overflow-y-auto overscroll-none">
        <PreparerProfileFields form={form} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground" role="status">
          {form.dirty ? 'Not saved yet.' : ''}
        </span>
        <PreparerProfileActions
          form={form}
          onCancel={form.reset}
          cancelLabel="Discard changes"
          cancelDisabled={!form.dirty}
        />
      </div>
    </section>
  )
}

/** Opens *Your details*: the host's pane when there is one, otherwise the modal. */
function useOpenPreparerProfile(portalContainer?: HTMLElement | null) {
  const host = useContext(PreparerProfileHostContext)
  const [open, setOpen] = useState(false)
  return {
    host,
    open: () => (host ? host.open() : setOpen(true)),
    dialog: host ? null : (
      <PreparerProfileDialog open={open} onOpenChange={setOpen} portalContainer={portalContainer} />
    ),
  }
}

/** The row at the top of a Save & export file list that shows *Your details* and opens them. */
export function PreparerProfileRow({
  accent = 'teal',
  portalContainer,
}: {
  accent?: 'teal' | 'theme'
  portalContainer?: HTMLElement | null
}) {
  const branding = useBranding()
  const details = useOpenPreparerProfile(portalContainer)
  const logo = printedLogo(branding)
  const summary = [profileSummary(branding.profile), logo ? 'logo' : 'no logo'].join(' · ')
  return (
    <>
      <ResultRow
        accent={accent}
        selected={details.host?.shown}
        title="Your details"
        subtitle={summary}
        leading={<IdCard className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />}
        className="py-2"
        aria-label={`Your details: ${summary}`}
        data-testid="preparer-profile-row"
        onClick={details.open}
      />
      {details.dialog}
    </>
  )
}

/**
 * *Use my details*: copies the profile into a record's blank preparer fields on a click. `patch` is what would be
 * written (`blanksFilledFromProfile`); with nothing to write the button says why instead.
 */
export function UseMyDetailsButton<K extends string>({
  patch,
  onApply,
  children = 'Use my details',
}: {
  patch: Partial<Record<K, string>>
  onApply: (patch: Partial<Record<K, string>>) => void
  children?: ReactNode
}) {
  const branding = useBranding()
  const count = Object.keys(patch).length
  const reason = profileIsEmpty(branding.profile)
    ? 'Enter your details first (Your details, at the top of Save & export).'
    : count === 0
      ? 'Every field your details would fill is already filled here.'
      : undefined
  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <TextButton
        className="text-xs"
        disabled={count === 0}
        title={reason}
        data-testid="use-my-details"
        onClick={() => onApply(patch)}
      >
        {children}
      </TextButton>
      {reason && <span className="text-2xs text-muted-foreground">{reason}</span>}
    </span>
  )
}

/**
 * What a document prints for its preparer and logo, in an output's options: the record's own preparer line (or
 * "not entered") with *Use my details*, and the logo with a link to *Your details*, where it is changed for every
 * sheet and report.
 */
export function PrintedPreparer<K extends string>({
  preparer,
  portalContainer,
}: {
  /** Omit for an output that prints a logo but no preparer. */
  preparer?: {
    /** As the document prints it, or empty. */
    printed: string
    /** Where the record keeps it, e.g. "FS1252 office information". */
    keptIn: string
    patch: Partial<Record<K, string>>
    onApply: (patch: Partial<Record<K, string>>) => void
  }
  portalContainer?: HTMLElement | null
}) {
  const branding = useBranding()
  const details = useOpenPreparerProfile(portalContainer)
  const logo = printedLogo(branding)
  return (
    <div className="grid gap-1 text-xs" data-testid="printed-preparer">
      {preparer && (
        <>
          <p>
            <span className="text-muted-foreground">Prepared by: </span>
            <span className="font-medium text-foreground">{preparer.printed || 'not entered'}</span>
            <span className="text-muted-foreground"> · kept in {preparer.keptIn}</span>
          </p>
          <UseMyDetailsButton patch={preparer.patch} onApply={preparer.onApply} />
        </>
      )}
      <p className="text-muted-foreground">
        Logo:{' '}
        {logo?.source === 'uploaded'
          ? `yours, ${logo.name}`
          : logo?.source === 'brand'
            ? `the ${logo.name} brand’s (Branding)`
            : 'none; the slot stays empty'}
        .{' '}
        <TextButton className="text-xs" onClick={details.open}>
          Edit your details
        </TextButton>
      </p>
      {details.dialog}
    </div>
  )
}
