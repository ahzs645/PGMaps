export function createFieldWorker() {
  return new Worker(new URL('./field.worker.ts', import.meta.url), { type: 'module' })
}
