export type SubmissionLiveKind = 'permissions' | 'history' | 'children'
export type SubmissionLiveRead = (
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) => Promise<unknown>
export type NativeRecord = Record<string, unknown>
export type PermissionEntry = { group: NativeRecord; source: NativeRecord }
export type SubmissionLiveData =
  | { kind: 'permissions'; groups: NativeRecord[]; entries: PermissionEntry[] }
  | { kind: 'history' | 'children'; rows: NativeRecord[] }
export type SubmissionLiveState =
  | { status: 'idle'; message?: string }
  | { status: 'loading' }
  | { status: 'loaded'; data: SubmissionLiveData }
  | { status: 'error'; message: string }

const ROUTES = {
  permissions: ['getSubmissionPermissions.php', 'submissionId'],
  history: ['getHistory.php', 'sub_id'],
  children: ['getChildren.php', 'parentId'],
} as const
const record = (value: unknown): value is NativeRecord => !!value && typeof value === 'object' && !Array.isArray(value)
export function submissionLiveRequest(kind: SubmissionLiveKind, submissionId: string) {
  if (!/^[1-9]\d*$/.test(submissionId) || Number(submissionId) > 2147483647)
    throw new Error('Enter a positive source submission ID.')
  const [endpoint, parameter] = ROUTES[kind]
  return { path: `rest/portal/${endpoint}`, params: { [parameter]: submissionId } }
}

/** Attributes only: native transport must reject denied/error envelopes before parsing. */
export function checkedSubmissionLive(kind: SubmissionLiveKind, value: unknown): SubmissionLiveData {
  if (!Array.isArray(value) || value.length > 10000 || !value.every(record))
    throw new Error('The source did not return a valid resource list. An unavailable response is not an empty list.')
  if (kind !== 'permissions') return { kind, rows: value }
  const entries: PermissionEntry[] = []
  for (const group of value) {
    if (!Array.isArray(group.attributes) || !group.attributes.every(record))
      throw new Error('The source permission group has no valid user list.')
    for (const source of group.attributes) entries.push({ group, source })
    if (entries.length > 10000) throw new Error('The returned source permission list exceeds 10,000 entries.')
  }
  return { kind, groups: value, entries }
}

/** Native checkbox flags are booleans; strings and missing flags retain their uncertainty. */
export function nativeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
export function childSubmissionId(row: NativeRecord): string | undefined {
  const value = String(row.form_submission_id ?? '')
  return /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647 ? value : undefined
}

/** Abort and generation checks also reject transports which ignore AbortSignal. No payload storage/export. */
export class SubmissionLiveLoader {
  private generation = 0
  private controller?: AbortController
  constructor(
    private readonly read: SubmissionLiveRead,
    private readonly update: (state: SubmissionLiveState) => void,
  ) {}
  cancel(message?: string, emit = true) {
    this.generation += 1
    this.controller?.abort()
    this.controller = undefined
    if (emit) this.update({ status: 'idle', message })
  }
  async load(kind: SubmissionLiveKind, submissionId: string) {
    this.cancel(undefined, false)
    const generation = this.generation
    const controller = new AbortController()
    this.controller = controller
    const current = () => generation === this.generation && !controller.signal.aborted
    this.update({ status: 'loading' })
    try {
      const request = submissionLiveRequest(kind, submissionId)
      const value = await this.read(request.path, request.params, controller.signal)
      if (current()) this.update({ status: 'loaded', data: checkedSubmissionLive(kind, value) })
    } catch (reason) {
      if (current())
        this.update({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      if (current()) this.controller = undefined
    }
  }
}
