/**
 * Browser half of `@dynastxu/dsh-session-control`.
 *
 * Two entries share one pause-phase observable and one command vocabulary:
 *
 * - `conversation.input.activity` (the composer seat) arms, cancels, and
 *   continues the pause of the Session in view.
 * - `shell.overlay` (root scope) draws the title-bar monitor: the aggregate
 *   state of every top-level conversation, the running and the
 *   finished-but-unviewed ones, and pause/continue/stop for one or all of them.
 *
 * The monitor is the single writer of the phases because it observes every
 * Session; the composer seat only reads them. The monitor stays mounted
 * everywhere and hides itself through CSS outside the Windows caption row, so
 * those transitions keep running.
 *
 * @module @dynastxu/dsh-session-control/client
 */

import * as React from 'react'
import {
  IconPauseOutlineRegular,
  IconPlayOutlineRegular,
  IconStopFillRegular,
  IconWarningOutlineRegular,
  StateDot,
  Toast,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pull the slot maps and standard props this plugin renders into.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the renderer-owned slots service on the client Context.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

/** Dictionary namespace owned by this plugin. */
const NS = 'sessionControl'

/** Locale keys; the Chinese dictionary is the key-set source of truth. */
const zh = {
  'pause.arm': '安全暂停：下一次请求发出前停止',
  'pause.armed': '已请求暂停，下一次请求发出前停止，点击取消',
  'pause.resume': '已暂停，点击继续',
  'pause.failed': '暂停状态切换失败',
  'monitor.running': '{count} 个正在运行的对话',
  'monitor.unread': '{count} 个未查看的对话',
  'monitor.none': '没有需要关注的对话',
  'monitor.expand': '展开对话状态',
  'monitor.collapse': '收起对话状态',
  'monitor.pauseAll': '暂停所有运行中的对话',
  'monitor.resumeAll': '继续所有已暂停的对话',
  'monitor.terminateAll': '终止所有运行中的对话',
  'monitor.pause': '暂停',
  'monitor.resume': '继续',
  'monitor.terminate': '终止',
  'monitor.failed': '操作失败',
  'monitor.runningHeading': '正在运行',
  'monitor.unreadHeading': '已完成，未查看',
} satisfies Record<string, string>

type SessionControlKey = keyof typeof zh

const en: Record<SessionControlKey, string> = {
  'pause.arm': 'Pause before the next request',
  'pause.armed': 'Pause armed, stops before the next request. Click to cancel.',
  'pause.resume': 'Paused. Click to continue.',
  'pause.failed': 'Could not change the pause state',
  'monitor.running': '{count} running conversations',
  'monitor.unread': '{count} unviewed conversations',
  'monitor.none': 'Nothing needs attention',
  'monitor.expand': 'Show conversation status',
  'monitor.collapse': 'Hide conversation status',
  'monitor.pauseAll': 'Pause every running conversation',
  'monitor.resumeAll': 'Continue every paused conversation',
  'monitor.terminateAll': 'Stop every running conversation',
  'monitor.pause': 'Pause',
  'monitor.resume': 'Continue',
  'monitor.terminate': 'Stop',
  'monitor.failed': 'The action failed',
  'monitor.runningHeading': 'Running',
  'monitor.unreadHeading': 'Finished, unviewed',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The pause control and title-bar monitor copy. */
    sessionControl: SessionControlKey
  }
}

/** Pause command verbs the control issues. */
type PauseVerb = 'arm' | 'off' | 'resume'

/** Outcome of one pause command: accepted, refused by policy, or not delivered. */
type PauseOutcome = 'ok' | 'refused' | 'failed'

/** One member's pause phase. */
type PausePhase = 'armed' | 'paused'

/** Phase map shared by both entries. */
interface PauseState {
  readonly phases: Readonly<Record<string, PausePhase>>
}

/** The shared observable plus its only write. */
interface PausePhases extends HostObservable<PauseState> {
  /**
   * @param sessionId - Session whose phase changes.
   * @param phase - 'armed', 'paused', or 'idle' to forget it.
   */
  setPhase(sessionId: SessionId, phase: PausePhase | 'idle'): void
}

/** Injected face of the composer seat. */
interface PauseInjected {
  hooks: { pausePhases: HostObservable<PauseState> }
  setPhase: (sessionId: SessionId, phase: PausePhase | 'idle') => void
  requestPause: (verb: PauseVerb) => Promise<PauseOutcome>
}

/** Injected face of the title-bar monitor. */
interface MonitorInjected {
  hooks: { pausePhases: HostObservable<PauseState> }
  setPhase: (sessionId: SessionId, phase: PausePhase | 'idle') => void
  requestPause: (sessionId: SessionId, verb: PauseVerb) => Promise<PauseOutcome>
  terminateSession: (sessionId: SessionId) => Promise<boolean>
}

type PauseControlProps = PropsRuntime<'conversation.input.activity'> &
  InjectFace<PauseInjected> &
  PropsLocale<'sessionControl'>

type MonitorProps = PropsRuntime<'shell.overlay'> & InjectFace<MonitorInjected> & PropsLocale<'sessionControl'>

/** One monitor row, already resolved for display. */
interface MonitorRowModel {
  readonly id: SessionId
  readonly title: string
  readonly running: boolean
  readonly phase: PausePhase | 'idle'
  readonly elapsed: number
}

/** One listed conversation with its catalog row. */
interface Entry {
  readonly id: SessionId
  readonly title: string
  readonly phase: PausePhase | 'idle'
}

const COMPOSER_CLASS = 'dsh-session-control-pause'
const MONITOR_CLASS = 'dsh-session-control-monitor'

const STYLES = `
.dsh-session-control-pause{display:grid;place-items:center;flex:none;width:34px;height:34px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);cursor:pointer;transition:background-color 100ms ease,color 100ms ease;transform:translateY(-2px)}
.dsh-session-control-pause.is-engaged{background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-on-color)}
.dsh-session-control-pause:disabled{opacity:.4;cursor:default}
@media (hover:hover){
.dsh-session-control-pause:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-session-control-pause.is-engaged:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
}
.dsh-session-control-monitor{position:absolute;z-index:21;display:none;align-items:center;gap:4px;height:28px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;-webkit-app-region:no-drag}
html[data-windows-titlebar] .dsh-session-control-monitor{display:flex;top:calc((var(--dsh-windows-titlebar-height, 40px) - 28px) / 2);left:75%;transform:translateX(-50%)}
.dsh-session-control-chip{display:flex;align-items:center;gap:8px;height:28px;max-width:320px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;white-space:nowrap;cursor:pointer}
.dsh-session-control-chip > span:last-child{overflow:hidden;text-overflow:ellipsis}
.dsh-session-control-chip:hover,.dsh-session-control-chip[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-session-control-dot{flex:none;display:grid;place-items:center;width:14px;height:14px}
.dsh-session-control-action{display:grid;place-items:center;flex:none;width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-session-control-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
.dsh-session-control-action:disabled{opacity:.4;cursor:default}
.dsh-session-control-panel{position:absolute;top:calc(100% + 6px);right:0;width:min(420px, calc(75vw - 24px));max-height:min(60vh, 420px);overflow-y:auto;padding:6px;border-radius:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 10px 30px var(--dsw-alias-shadow, rgba(0,0,0,.18))}
.dsh-session-control-heading{padding:8px 10px 4px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-session-control-row{display:flex;align-items:center;gap:8px;height:34px;padding:0 8px;border-radius:8px}
.dsh-session-control-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-session-control-row-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-session-control-row-duration{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
.dsh-session-control-empty{padding:10px}
`

/**
 * Attach the control's stylesheet for the plugin fiber's lifetime.
 * @returns the disposer removing it.
 */
function installStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.sessionControl = ''
  style.textContent = STYLES
  document.head.append(style)
  return () => {
    style.remove()
  }
}

/**
 * Create the pause phases shared by both entries. The slot renderer binds this
 * registrant-private observable to a `usePausePhases` hook, so the composer seat
 * and the monitor read one source no matter which scope they render in
 * (registered stores are per-scope and could not be shared here).
 * @returns the source and its only write operation.
 */
function createPausePhases(): PausePhases {
  let snapshot: PauseState = { phases: {} }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setPhase: (sessionId, phase) => {
      const phases: Record<string, PausePhase> = { ...snapshot.phases }
      if (phase === 'idle') delete phases[sessionId]
      else phases[sessionId] = phase
      snapshot = { phases }
      for (const listener of [...listeners]) listener()
    },
  }
}

/**
 * Elapsed time as m:ss or h:mm:ss.
 * @param ms - duration in milliseconds.
 * @returns the display text.
 */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}` : `${String(minutes)}:${pad(seconds)}`
}

/**
 * The composer pause seat for the Session in view.
 * @param props - slot props, injected command face, and dictionary.
 * @returns the control, or nothing while there is neither a run nor a pause.
 */
function PauseControl({
  useSession,
  sessionId,
  requestPause,
  usePausePhases,
  setPhase,
  locked,
  t,
}: PauseControlProps): React.ReactElement | null {
  const running = useSession(snapshot => snapshot.running) ?? false
  const phase = usePausePhases(state => state.phases[sessionId] ?? 'idle')
  const [failure, setFailure] = React.useState<{ seq: number; text: string } | null>(null)
  const pending = React.useRef(false)
  const sequence = React.useRef(0)
  const anchor = React.useRef<HTMLButtonElement | null>(null)

  if (!running && phase !== 'paused') return null

  const engaged = phase !== 'idle'
  const label = phase === 'paused' ? t('pause.resume') : phase === 'armed' ? t('pause.armed') : t('pause.arm')
  const verb: PauseVerb = phase === 'paused' ? 'resume' : phase === 'armed' ? 'off' : 'arm'

  const act = (): void => {
    if (pending.current) return
    pending.current = true
    void requestPause(verb).then(outcome => {
      pending.current = false
      if (outcome === 'ok') {
        setPhase(sessionId, verb === 'arm' ? 'armed' : 'idle')
        return
      }
      // A refused verb means the Host holds no pause in that state, so the
      // mirror was stale: drop it instead of reporting a failure.
      if (outcome === 'refused') {
        setPhase(sessionId, 'idle')
        return
      }
      sequence.current += 1
      setFailure({ seq: sequence.current, text: t('pause.failed') })
    })
  }

  return (
    <>
      <Tooltip label={label} side="top" delayMs={500} portal disabled={locked}>
        <button
          ref={anchor}
          type="button"
          className={engaged ? `${COMPOSER_CLASS} is-engaged` : COMPOSER_CLASS}
          aria-label={label}
          aria-pressed={engaged}
          disabled={locked}
          onClick={act}
        >
          {phase === 'paused' ? <IconPlayOutlineRegular size={16} /> : <IconPauseOutlineRegular size={16} />}
        </button>
      </Tooltip>
      {failure === null ? null : (
        <Toast
          key={failure.seq}
          text={failure.text}
          icon={<IconWarningOutlineRegular />}
          anchor={anchor.current}
          onDone={() => {
            setFailure(null)
          }}
        />
      )}
    </>
  )
}

/**
 * One conversation row in the monitor panel.
 * @param props - row model, busy flag, handlers, and dictionary.
 * @returns the row.
 */
function MonitorRow({
  row,
  pending,
  onPause,
  onTerminate,
  t,
}: {
  row: MonitorRowModel
  pending: boolean
  onPause: (row: MonitorRowModel) => void
  onTerminate: (row: MonitorRowModel) => void
  t: PauseControlProps['t']
}): React.ReactElement {
  const pauseLabel = row.phase === 'idle' ? t('monitor.pause') : t('monitor.resume')
  const canPause = row.running || row.phase !== 'idle'
  return (
    <div className="dsh-session-control-row">
      <span className="dsh-session-control-dot">
        <StateDot state={row.running ? 'ongoing' : 'done'} />
      </span>
      <span className="dsh-session-control-row-title" title={row.title}>
        {row.title}
      </span>
      <span className="dsh-session-control-row-duration">{formatElapsed(row.elapsed)}</span>
      <Tooltip label={pauseLabel} side="top" delayMs={400} portal>
        <button
          type="button"
          className="dsh-session-control-action"
          aria-label={pauseLabel}
          disabled={pending || !canPause}
          onClick={() => {
            onPause(row)
          }}
        >
          {row.phase === 'idle' ? <IconPauseOutlineRegular size={16} /> : <IconPlayOutlineRegular size={16} />}
        </button>
      </Tooltip>
      <Tooltip label={t('monitor.terminate')} side="top" delayMs={400} portal>
        <button
          type="button"
          className="dsh-session-control-action"
          aria-label={t('monitor.terminate')}
          disabled={pending || !row.running}
          onClick={() => {
            onTerminate(row)
          }}
        >
          <IconStopFillRegular size={12} />
        </button>
      </Tooltip>
    </div>
  )
}

/**
 * The title-bar monitor: aggregate state, the running and unviewed
 * conversations, and pause/continue/stop for one row or all of them.
 * @param props - root slot props, injected command face, and dictionary.
 * @returns the monitor.
 */
function SessionMonitor({
  useSessions,
  useSessionStatus,
  usePausePhases,
  setPhase,
  requestPause,
  terminateSession,
  t,
}: MonitorProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())
  const [failure, setFailure] = React.useState<{ seq: number; text: string } | null>(null)
  const [pending, setPending] = React.useState(false)
  const root = React.useRef<HTMLDivElement | null>(null)
  const sequence = React.useRef(0)
  const timing = React.useRef(new Map<string, { startedAt: number | null; completedAt: number | null }>())

  const list = useSessions(state => state.byId)
  const statuses = useSessionStatus(state => state)
  const phases = usePausePhases(state => state.phases)

  // Top-level conversations only: a subagent Session is not a conversation the
  // user started, and a blank New Session carries no work.
  const entries = React.useMemo(() => {
    const running: Entry[] = []
    const unread: Entry[] = []
    for (const id of Object.keys(list) as SessionId[]) {
      const row = list[id]
      if (row === undefined || row.blank || row.origin === 'subagent') continue
      const status = statuses.get(id)
      const isRunning = status?.running ?? row.running
      const phase = phases[id] ?? 'idle'
      if (isRunning) running.push({ id, title: row.displayTitle, phase })
      else if (status?.completionUnread === true) unread.push({ id, title: row.displayTitle, phase })
    }
    return { running, unread }
  }, [list, statuses, phases])

  // The monitor owns every phase transition: an armed pause whose run ended
  // stopped at its boundary, and a paused run that started again is live.
  React.useEffect(() => {
    for (const [id, phase] of Object.entries(phases)) {
      const sessionId = id as SessionId
      const row = list[sessionId]
      if (row === undefined) {
        setPhase(sessionId, 'idle')
        continue
      }
      const isRunning = statuses.get(sessionId)?.running ?? row.running
      if (phase === 'armed' && !isRunning) setPhase(sessionId, 'paused')
      else if (phase === 'paused' && isRunning) setPhase(sessionId, 'idle')
    }
  }, [list, statuses, phases, setPhase])

  // Elapsed readings: a run observed from its start is timed from that start;
  // one already running when this page loaded counts from zero. A finished
  // conversation is timed from the moment it stopped.
  React.useEffect(() => {
    const seen = timing.current
    const live = new Set<string>(entries.running.map(entry => entry.id))
    for (const id of live) {
      if (!seen.has(id)) seen.set(id, { startedAt: Date.now(), completedAt: null })
    }
    for (const [id, record] of seen) {
      if (live.has(id)) continue
      if (record.startedAt !== null) {
        record.completedAt = Date.now()
        record.startedAt = null
      }
      if (list[id as SessionId] === undefined) seen.delete(id)
    }
  }, [entries, list])

  React.useEffect(() => {
    if (!open) return
    const tick = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(tick)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const fail = (): void => {
    sequence.current += 1
    setFailure({ seq: sequence.current, text: t('monitor.failed') })
  }

  /** Run one bulk action over the given ids and settle once. */
  const bulk = async (
    ids: readonly SessionId[],
    run: (id: SessionId) => Promise<PauseOutcome | boolean>,
  ): Promise<void> => {
    if (pending || ids.length === 0) return
    setPending(true)
    const outcomes = await Promise.all(ids.map(async id => run(id)))
    setPending(false)
    if (outcomes.some(outcome => outcome === 'failed' || outcome === false)) fail()
  }

  const pauseRow = async (row: MonitorRowModel): Promise<void> => {
    if (pending) return
    setPending(true)
    const verb: PauseVerb = row.phase === 'idle' ? 'arm' : 'resume'
    const outcome = await requestPause(row.id, verb)
    setPending(false)
    if (outcome === 'ok') setPhase(row.id, verb === 'arm' ? 'armed' : 'idle')
    else if (outcome === 'refused') setPhase(row.id, 'idle')
    else fail()
  }

  const terminateRow = async (row: MonitorRowModel): Promise<void> => {
    if (pending) return
    setPending(true)
    const stopped = await terminateSession(row.id)
    setPending(false)
    if (!stopped) fail()
  }

  const rowsOf = (items: readonly Entry[], running: boolean): MonitorRowModel[] =>
    items.map(entry => {
      const record = timing.current.get(entry.id)
      const elapsed = running
        ? record === undefined || record.startedAt === null
          ? 0
          : now - record.startedAt
        : record === undefined || record.completedAt === null
          ? 0
          : now - record.completedAt
      return { id: entry.id, title: entry.title, running, phase: entry.phase, elapsed }
    })

  const runningRows = rowsOf(entries.running, true)
  const unreadRows = rowsOf(entries.unread, false)
  const runningIds = runningRows.map(row => row.id)
  const pausableIds = runningRows.filter(row => row.phase === 'idle').map(row => row.id)
  const resumableIds = runningRows.filter(row => row.phase !== 'idle').map(row => row.id)
  const bulkPauseIds = pausableIds.length > 0 ? pausableIds : resumableIds
  const bulkPauseVerb: PauseVerb = pausableIds.length > 0 ? 'arm' : 'resume'
  const bulkPauseLabel = bulkPauseVerb === 'arm' ? t('monitor.pauseAll') : t('monitor.resumeAll')

  const counters =
    runningRows.length > 0
      ? { icon: <StateDot state="ongoing" />, text: t('monitor.running', { count: runningRows.length }) }
      : unreadRows.length > 0
        ? { icon: <StateDot state="done" />, text: t('monitor.unread', { count: unreadRows.length }) }
        : { icon: null, text: t('monitor.none') }

  const rowNode = (row: MonitorRowModel): React.ReactElement => (
    <MonitorRow
      key={row.id}
      row={row}
      pending={pending}
      t={t}
      onPause={target => {
        void pauseRow(target)
      }}
      onTerminate={target => {
        void terminateRow(target)
      }}
    />
  )

  return (
    <div ref={root} className={MONITOR_CLASS}>
      <Tooltip label={open ? t('monitor.collapse') : t('monitor.expand')} side="bottom" delayMs={500} portal>
        <button
          type="button"
          className="dsh-session-control-chip"
          aria-expanded={open}
          aria-label={open ? t('monitor.collapse') : t('monitor.expand')}
          onClick={() => {
            setOpen(value => !value)
          }}
        >
          {counters.icon}
          <span>{counters.text}</span>
        </button>
      </Tooltip>
      <Tooltip label={bulkPauseLabel} side="bottom" delayMs={500} portal>
        <button
          type="button"
          className="dsh-session-control-action"
          aria-label={bulkPauseLabel}
          disabled={bulkPauseIds.length === 0 || pending}
          onClick={() => {
            void bulk(bulkPauseIds, async id => {
              const outcome = await requestPause(id, bulkPauseVerb)
              if (outcome === 'ok') setPhase(id, bulkPauseVerb === 'arm' ? 'armed' : 'idle')
              return outcome
            })
          }}
        >
          {bulkPauseVerb === 'arm' ? <IconPauseOutlineRegular size={16} /> : <IconPlayOutlineRegular size={16} />}
        </button>
      </Tooltip>
      <Tooltip label={t('monitor.terminateAll')} side="bottom" delayMs={500} portal>
        <button
          type="button"
          className="dsh-session-control-action"
          aria-label={t('monitor.terminateAll')}
          disabled={runningIds.length === 0 || pending}
          onClick={() => {
            void bulk(runningIds, id => terminateSession(id))
          }}
        >
          <IconStopFillRegular size={12} />
        </button>
      </Tooltip>
      {open ? (
        <div className="dsh-session-control-panel" role="dialog" aria-label={t('monitor.expand')}>
          {runningRows.length === 0 && unreadRows.length === 0 ? (
            <div className="dsh-session-control-empty">{t('monitor.none')}</div>
          ) : (
            <>
              {runningRows.length === 0 ? null : (
                <>
                  <div className="dsh-session-control-heading">{t('monitor.runningHeading')}</div>
                  {runningRows.map(rowNode)}
                </>
              )}
              {unreadRows.length === 0 ? null : (
                <>
                  <div className="dsh-session-control-heading">{t('monitor.unreadHeading')}</div>
                  {unreadRows.map(rowNode)}
                </>
              )}
            </>
          )}
        </div>
      ) : null}
      {failure === null ? null : (
        <Toast
          key={failure.seq}
          text={failure.text}
          icon={<IconWarningOutlineRegular />}
          onDone={() => {
            setFailure(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Run one pause command verb for one Session.
 * @param ctx - client root context.
 * @param sessionId - target Session.
 * @param verb - 'arm', 'off', or 'resume'.
 * @returns 'ok', 'refused' for a business refusal, or 'failed'.
 */
async function runPause(ctx: Context, sessionId: SessionId, verb: PauseVerb): Promise<PauseOutcome> {
  const line = verb === 'arm' ? `/${'pause'}` : `/${'pause'} ${verb}`
  try {
    const response = await ctx.remote.commands.execute(sessionId, line, [])
    if (!response.ok) {
      console.warn('[session-control] pause request failed', response.error.code, response.error.message)
      return 'failed'
    }
    const execution = response.value
    if (execution === undefined) {
      console.warn('[session-control] the pause command is not registered')
      return 'failed'
    }
    if (execution.result.kind !== 'success') {
      console.warn('[session-control] pause refused:', execution.result.text)
      return 'refused'
    }
    return 'ok'
  } catch (error: unknown) {
    console.warn('[session-control] pause request failed', error)
    return 'failed'
  }
}

/**
 * Stop one Session's active turn.
 * @param ctx - client root context.
 * @param sessionId - target Session.
 * @returns whether the Host accepted the cancellation.
 */
async function runTerminate(ctx: Context, sessionId: SessionId): Promise<boolean> {
  try {
    const response = await ctx.remote.session.cancel({ sessionId })
    if (!response.ok) {
      console.warn('[session-control] stop request failed', response.error.code, response.error.message)
      return false
    }
    return true
  } catch (error: unknown) {
    console.warn('[session-control] stop request failed', error)
    return false
  }
}

export const inject = ['slots', 'remote', 'remote.commands', 'locale'] as const

/**
 * Register the composer pause seat and the title-bar monitor.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const pausePhases = createPausePhases()
  ctx.effect(installStyles)
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'session-control: dictionaries')

  ctx.slots.inject('conversation.input.activity', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.activity',
        locale: NS,
        inject: (sessionId: SessionId): PauseInjected => ({
          hooks: { pausePhases },
          setPhase: (id, phase) => {
            pausePhases.setPhase(id, phase)
          },
          requestPause: verb => runPause(ctx, sessionId, verb),
        }),
      },
      PauseControl,
    ),
  )

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'session-control.monitor',
        order: 40,
        locale: NS,
        inject: (): MonitorInjected => ({
          hooks: { pausePhases },
          setPhase: (id, phase) => {
            pausePhases.setPhase(id, phase)
          },
          requestPause: (sessionId, verb) => runPause(ctx, sessionId, verb),
          terminateSession: sessionId => runTerminate(ctx, sessionId),
        }),
      },
      SessionMonitor,
    ),
  )
}
