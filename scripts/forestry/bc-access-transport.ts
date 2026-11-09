/** Explicit CLI-only transport for managed networks whose Node fetch ignores configured proxies. */
import { spawn } from 'node:child_process'

export function installBcSourcePythonTransport(): void {
  const program =
    'import sys,urllib.request\nwith urllib.request.urlopen(sys.argv[1],timeout=25) as r:\n b=r.read(10485761)\n if len(b)>10485760:raise ValueError("Source response exceeds 10 MiB")\n sys.stdout.buffer.write(b)'
  globalThis.fetch = (input, options = {}) =>
    new Promise<Response>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason ?? new DOMException('Source request cancelled.', 'AbortError'))
        return
      }
      if ((typeof input !== 'string' && !(input instanceof URL)) || (options.method && options.method !== 'GET')) {
        reject(new Error('The source-review transport supports only the generated GET source URLs.'))
        return
      }
      const child = spawn(process.env.CODEX_PRIMARY_RUNTIME_PYTHON ?? 'python3', ['-c', program, String(input)])
      const chunks: Buffer[] = [],
        errors: Buffer[] = []
      const abort = () => {
        child.kill('SIGTERM')
        reject(options.signal?.reason ?? new DOMException('Source request cancelled.', 'AbortError'))
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
      child.on('error', reject)
      child.on('close', (code) => {
        options.signal?.removeEventListener('abort', abort)
        if (code === 0) resolve(new Response(Uint8Array.from(Buffer.concat(chunks))))
        else reject(new Error(Buffer.concat(errors).toString().trim() || `Source transport exited with code ${code}.`))
      })
      if (options.signal?.aborted) abort()
    })
}
