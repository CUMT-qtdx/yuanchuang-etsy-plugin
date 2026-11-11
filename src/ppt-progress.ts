/** Bounded, display-only progress from host events and upstream editppt records. */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CanvasSkillTask } from './protocol.ts'
import type { SkillAgentSession } from './skill-runner.ts'
import type { CatalogTranslate } from './skills-catalog.ts'

export function pptActivity(task: CanvasSkillTask, label: string, state: 'running' | 'done' | 'warning' = 'running', at = Date.now()): void {
  if (task.canvasId !== 'ppt') return
  const progress = task.progress ??= { lastActivityAt: at, events: [] }
  progress.lastActivityAt = at
  progress.currentOperation = label
  progress.events.push({ time: at, label, state })
  progress.events = progress.events.slice(-40)
}

/** Classify only known upstream CLI verbs; never display command arguments. */
function toolOperation(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 20000) return undefined
  let args: any
  try { args = JSON.parse(raw) } catch { return undefined }
  if (!args || typeof args !== 'object') return undefined
  const command = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : Array.isArray(args.argv) ? args.argv.filter((v: unknown) => typeof v === 'string').join(' ') : ''
  const text = command.replace(/["']/g, '')
  const patterns: Array<[RegExp, string]> = [
    [/(?:editppt(?:\.exe)?\s+prepare|prepare_deck_run\.py)/i, 'ppt.activityPreparing'],
    [/(?:editppt(?:\.exe)?\s+page\s+hints|deck_text_hints\.py)/i, 'ppt.activityTextHints'],
    [/(?:editppt(?:\.exe)?\s+image\s+(?:edit|generate)|image_gen\.py)/i, 'ppt.activityAssets'],
    [/(?:editppt(?:\.exe)?\s+page\s+assemble|build_pptx_from_manifest\.py)/i, 'ppt.activityBuilding'],
    [/(?:editppt(?:\.exe)?\s+(?:page\s+)?validate|validate_pptx\.py)/i, 'ppt.activityValidating'],
    [/(?:editppt(?:\.exe)?\s+finalize|finalize_deck_run\.py)/i, 'ppt.activityFinalizing'],
  ]
  return patterns.flatMap(([pattern, key]) => { const match = pattern.exec(text); return match ? [{ index: match.index, key }] : [] }).sort((a,b) => a.index-b.index)[0]?.key
}

export class PptProgressMonitor {
  private cursor = 0
  private calls = new Map<string, string>()
  private timer?: ReturnType<typeof setInterval>
  private pending?: Promise<void>
  private stopped = false
  private paths: string[] = []
  private searchedAt = 0
  private fileSignature = ''
  constructor(private task: CanvasSkillTask, private session: SkillAgentSession, private runDir: string, private t: CatalogTranslate) {}

  start(): void { void this.refresh(); this.timer = setInterval(() => { void this.refresh() }, 1500); this.timer.unref?.() }
  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.pending) return this.pending
    const work = this.scan().catch(() => { /* Progress observation never controls conversion success. */ })
    this.pending = work
    void work.then(() => { if (this.pending === work) this.pending = undefined })
    return work
  }
  async stop(): Promise<void> { clearInterval(this.timer); await this.refresh(); this.stopped = true }

  private async scan(): Promise<void> {
    const length = this.session.seq
    if (typeof length === 'number' && Number.isSafeInteger(length) && length >= 0 && this.session.eventAt) {
      this.cursor = Math.max(this.cursor, length - 512)
      for (; this.cursor < length; this.cursor++) {
        let event: { type?: string; time?: number; data?: Record<string, any> } | undefined
        try { event = this.session.eventAt(this.cursor) as typeof event } catch { continue }
        const data = event?.data
        if (!data) continue
        // Deliberately never read assistant text, reasoning streams or tool output.
        if (event?.type === 'step/start') pptActivity(this.task, this.t('ppt.activityModel'))
        else if (event?.type === 'tool/call') {
          const name = typeof data.name === 'string' && /^[\w.:/-]{1,80}$/.test(data.name) ? data.name : this.t('ppt.activityUnknownTool')
          if (typeof data.callId === 'string') { if (this.calls.size >= 128) this.calls.delete(this.calls.keys().next().value!); this.calls.set(data.callId, name) }
          const operation = toolOperation(data.arguments)
          pptActivity(this.task, this.t('ppt.activityTool', { name }) + (operation ? ` · ${this.t(operation as Parameters<CatalogTranslate>[0])}` : ''))
        } else if (event?.type === 'tool/result') {
          const message = data.message
          const name = this.calls.get(message?.callId) ?? this.t('ppt.activityUnknownTool')
          if (typeof message?.callId === 'string') this.calls.delete(message.callId)
          pptActivity(this.task, this.t(message?.isError ? 'ppt.activityToolFailed' : 'ppt.activityToolDone', { name }), message?.isError ? 'warning' : 'done')
        } else if (event?.type === 'assistant/message') pptActivity(this.task, this.t('ppt.activityModelDone'), 'done')
      }
    }
    // Find only known upstream state files inside this task, without following symlinks.
    if (Date.now() - this.searchedAt >= 10000 || this.paths.length === 0) {
      this.searchedAt = Date.now()
      const queue = [{ dir: this.runDir, depth: 0 }], found: string[] = []
      let visited = 0
      while (queue.length && visited < 1000) {
        const item = queue.shift()!
        for (const entry of await fs.readdir(item.dir, { withFileTypes: true }).catch(() => [])) {
          if (++visited > 1000) break
          if (entry.isFile() && entry.name === 'page_jobs.json') found.push(path.join(item.dir, entry.name))
          if (entry.isDirectory() && item.depth < 6 && !['input', 'pages', '.venv', 'node_modules', '.git'].includes(entry.name)) queue.push({ dir: path.join(item.dir, entry.name), depth: item.depth + 1 })
        }
      }
      this.paths = found
    }
    let newest: { file: string; time: number; jobs: any } | undefined
    for (const file of this.paths) {
      const stat = await fs.lstat(file).catch(() => undefined)
      if (!stat || stat.isSymbolicLink() || stat.size > 512000) continue
      const jobs = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => undefined)
      if (!Array.isArray(jobs?.pages) || jobs.pages.length !== this.task.pptImages?.length) continue
      if (!newest || stat.mtimeMs > newest.time) newest = { file, time: stat.mtimeMs, jobs }
    }
    if (!newest) return
    const pages = newest.jobs.pages.map((page: any, index: number) => ({ page: index + 1,
      state: ['recorded', 'accepted'].includes(page.status) && page.result?.validation_passed === true ? 'validated' as const
        : page.status === 'dispatched' || page.status === 'recorded' ? 'running' as const : 'pending' as const }))
    const signature = JSON.stringify(pages)
    if (signature !== this.fileSignature) {
      this.fileSignature = signature
      pptActivity(this.task, this.t('ppt.activityPages', { done: pages.filter((p: { state: string }) => p.state === 'validated').length, total: pages.length }))
    }
    this.task.progress!.pages = pages
    const stateFile = path.join(path.dirname(newest.file), 'run_state.json')
    const stateStat = await fs.lstat(stateFile).catch(() => undefined)
    if (!stateStat || stateStat.isSymbolicLink() || stateStat.size > 512000) return
    const state = await fs.readFile(stateFile, 'utf8').then(JSON.parse).catch(() => undefined)
    const stages: Record<string, string> = { inputs_prepared: 'ppt.activityPrepared', pages_dispatched: 'ppt.activityDispatched', pages_recorded: 'ppt.activityRecorded', deck_built: 'ppt.activityBuilt', deck_validated: 'ppt.activityValidated', complete: 'ppt.activityUpstreamDone' }
    const key = stages[state?.status]
    if (key && this.task.progress!.upstreamStage !== state.status) {
      this.task.progress!.upstreamStage = state.status
      pptActivity(this.task, this.t(key as Parameters<CatalogTranslate>[0]), state.status === 'complete' ? 'done' : 'running')
    }
  }
}
