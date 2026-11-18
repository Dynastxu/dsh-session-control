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
  IconStopFillRegular,
  IconTriangleRightFillRegular,
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
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
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
  /** Whether the Host still holds a stopped pause for this Session. */
  confirmPaused: (sessionId: SessionId) => Promise<boolean>
  terminateSession: (sessionId: SessionId) => Promise<boolean>
  openSession: (sessionId: SessionId) => void
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
  /** Observed run span in milliseconds; absent when this page never saw the run start. */
  readonly elapsed: number | null
}

/** One observed run of a conversation. */
interface RunTiming {
  readonly startedAt: number
  /** Set once the run stopped; the span becomes the frozen duration. */
  readonly endedAt: number | null
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
.dsh-session-control-pause{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);line-height:0;cursor:pointer;box-sizing:border-box;transition:background-color 100ms ease,color 100ms ease;transform:translateY(-2px)}
.dsh-session-control-pause > svg{display:block}
.dsh-session-control-pause.is-engaged{background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-on-color)}
.dsh-session-control-pause:disabled{opacity:.4;cursor:default}
@media (hover:hover){
.dsh-session-control-pause:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-session-control-pause.is-engaged:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
}
/* The bar floats over the frame in every deployment and is dragged by its chip.
   Its default anchor is the golden section of the caption row (or just under the
   app header when the deployment has no caption row); a dropped position is
   stored in frame pixels and wins over this anchor. */
.dsh-session-control-monitor{position:absolute;z-index:21;display:flex;align-items:center;gap:4px;height:28px;left:61.8%;top:calc(var(--dsh-frame-top-clearance, 48px) + 10px);transform:translateX(-50%);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;-webkit-app-region:no-drag}
.dsh-session-control-monitor[data-placed]{left:0;transform:none}
.dsh-session-control-monitor[data-flip] .dsh-session-control-panel{top:auto;bottom:calc(100% + 6px)}
html[data-windows-titlebar] .dsh-session-control-monitor{top:calc((var(--dsh-windows-titlebar-height, 40px) - 28px) / 2)}
.dsh-session-control-chip{display:flex;align-items:center;gap:8px;height:28px;max-width:320px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;white-space:nowrap;cursor:grab;box-sizing:border-box;touch-action:none}
.dsh-session-control-chip:active{cursor:grabbing}
.dsh-session-control-chip > span:last-child{overflow:hidden;text-overflow:ellipsis}
.dsh-session-control-chip:hover,.dsh-session-control-chip[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-session-control-chip:focus-visible{outline-offset:-2px}
.dsh-session-control-dot{flex:none;display:grid;place-items:center;width:14px;height:14px}
.dsh-session-control-action{display:grid;place-items:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;line-height:0;cursor:pointer;box-sizing:border-box}
.dsh-session-control-action > svg,.dsh-session-control-dot > svg{display:block}
.dsh-session-control-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
.dsh-session-control-action:disabled{opacity:.4;cursor:default}
.dsh-session-control-action.is-danger{color:var(--dsw-alias-state-error-primary)}
.dsh-session-control-action.is-danger:hover:not(:disabled){background:var(--dsw-alias-hovercard-state-error);color:var(--dsw-alias-label-on-color)}
.dsh-session-control-play{transform:scale(1.35)}
.dsh-session-control-panel{position:absolute;top:calc(100% + 6px);right:0;width:min(420px, calc(75vw - 24px));max-height:min(60vh, 420px);overflow-y:auto;padding:6px;border-radius:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 10px 30px var(--dsw-alias-shadow, rgba(0,0,0,.18))}
.dsh-session-control-heading{padding:8px 10px 4px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-session-control-row{display:flex;align-items:center;gap:8px;height:34px;padding:0 4px 0 0;border-radius:8px}
.dsh-session-control-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-session-control-row-main{display:flex;align-items:center;gap:8px;flex:1;min-width:0;height:100%;padding:0 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
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

/** Where the paused phases survive a page reload. */
const PHASE_STORAGE_KEY = 'dsh.session-control.pauses'

/**
 * Read the persisted stopped phases. Only `paused` is stored: an armed pause
 * belongs to a run in flight and is re-armed by the user after a reload.
 * @returns one phase per Session that was left stopped.
 */
function readStoredPhases(): Record<string, PausePhase> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(PHASE_STORAGE_KEY)
    if (raw === null) return {}
    const stored: unknown = JSON.parse(raw)
    if (typeof stored !== 'object' || stored === null) return {}
    const phases: Record<string, PausePhase> = {}
    for (const [id, phase] of Object.entries(stored)) {
      if (phase === 'paused' || phase === 'armed') phases[id] = 'paused'
    }
    return phases
  } catch (_error: unknown) {
    // Unreadable or malformed storage has no usable phase and is rewritten on
    // the next change.
    return {}
  }
}

/**
 * @param phases - the phases to persist.
 */
function writeStoredPhases(phases: Readonly<Record<string, PausePhase>>): void {
  if (typeof localStorage === 'undefined') return
  try {
    const stored: Record<string, PausePhase> = {}
    for (const [id, phase] of Object.entries(phases)) {
      if (phase === 'paused') stored[id] = phase
    }
    localStorage.setItem(PHASE_STORAGE_KEY, JSON.stringify(stored))
  } catch (_error: unknown) {
    // A full or unavailable store keeps the in-memory phases; the next write
    // retries.
  }
}

/**
 * Create the pause phases shared by both entries. The slot renderer binds this
 * registrant-private observable to a `usePausePhases` hook, so the composer seat
 * and the monitor read one source no matter which scope they render in
 * (registered stores are per-scope and could not be shared here). Stopped phases
 * are persisted so a reload keeps offering the continue action.
 * @returns the source and its only write operation.
 */
function createPausePhases(): PausePhases {
  let snapshot: PauseState = { phases: readStoredPhases() }
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
      writeStoredPhases(phases)
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Where the observed run spans survive a page or plugin reload. */
const TIMING_STORAGE_KEY = 'dsh.session-control.timings'

/**
 * Read the stored run spans.
 * @returns one span per Session this browser has observed.
 */
function readStoredTimings(): Map<string, RunTiming> {
  const timings = new Map<string, RunTiming>()
  if (typeof localStorage === 'undefined') return timings
  try {
    const raw = localStorage.getItem(TIMING_STORAGE_KEY)
    if (raw === null) return timings
    const stored: unknown = JSON.parse(raw)
    if (typeof stored !== 'object' || stored === null) return timings
    for (const [id, value] of Object.entries(stored)) {
      if (typeof value !== 'object' || value === null) continue
      const candidate = value as { startedAt?: unknown; endedAt?: unknown }
      const startedAt = candidate.startedAt
      const endedAt = candidate.endedAt
      if (typeof startedAt !== 'number' || !Number.isSafeInteger(startedAt)) continue
      if (endedAt !== null && (typeof endedAt !== 'number' || !Number.isSafeInteger(endedAt))) continue
      timings.set(id, { startedAt, endedAt })
    }
    return timings
  } catch (_error: unknown) {
    // Unreadable or malformed storage starts from no observations.
    return timings
  }
}

/**
 * @param timings - the spans to persist.
 */
function writeStoredTimings(timings: ReadonlyMap<string, RunTiming>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(TIMING_STORAGE_KEY, JSON.stringify(Object.fromEntries(timings)))
  } catch (_error: unknown) {
    // A full or unavailable store keeps the in-memory spans; the next write
    // retries.
  }
}

/**
 * Elapsed time as m:ss or h:mm:ss.
 * @param ms - duration in milliseconds, or null when this page never observed
 *   the run start.
 * @returns the display text, or an em dash for an unknown span.
 */
function formatElapsed(ms: number | null): string {
  if (ms === null) return '—'
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}` : `${String(minutes)}:${pad(seconds)}`
}

/** Where the floating bar sits, in frame pixels. */
interface BarPosition {
  readonly x: number
  readonly y: number
}

/** Where a dragged bar position survives a reload. */
const POSITION_STORAGE_KEY = 'dsh.session-control.position'

/**
 * Read the stored bar position.
 * @returns the stored frame coordinates, or null to use the default anchor.
 */
function readStoredPosition(): BarPosition | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY)
    if (raw === null) return null
    const stored: unknown = JSON.parse(raw)
    if (typeof stored !== 'object' || stored === null) return null
    const candidate = stored as { x?: unknown; y?: unknown }
    if (typeof candidate.x !== 'number' || !Number.isFinite(candidate.x)) return null
    if (typeof candidate.y !== 'number' || !Number.isFinite(candidate.y)) return null
    return { x: candidate.x, y: candidate.y }
  } catch (_error: unknown) {
    // Unreadable storage falls back to the default anchor.
    return null
  }
}

/**
 * @param position - the frame coordinates to keep, or null to forget them.
 */
function writeStoredPosition(position: BarPosition | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (position === null) localStorage.removeItem(POSITION_STORAGE_KEY)
    else localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position))
  } catch (_error: unknown) {
    // A full or unavailable store leaves the bar where the user dropped it for
    // this page's lifetime.
  }
}

/**
 * Bare pause glyph: the two rounded bars at the weight the composer's send and
 * stop circles use. The shared pause artwork draws a ring around the bars,
 * which reads as a different control beside them.
 * @param props.size - rendered edge in pixels.
 * @returns the glyph.
 */
function PauseGlyph({ size }: { size: number }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      <rect x="4" y="3" width="3" height="10" rx="1.2" fill="currentColor" />
      <rect x="9" y="3" width="3" height="10" rx="1.2" fill="currentColor" />
    </svg>
  )
}

/**
 * Bare continue glyph: the shared filled triangle, scaled to the pause bars'
 * optical weight.
 * @returns the glyph.
 */
function PlayGlyph(): React.ReactElement {
  return <IconTriangleRightFillRegular size={16} className="dsh-session-control-play" />
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
          {phase === 'paused' ? <PlayGlyph /> : <PauseGlyph size={16} />}
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
  onOpen,
  onPause,
  onTerminate,
  t,
}: {
  row: MonitorRowModel
  pending: boolean
  onOpen: (row: MonitorRowModel) => void
  onPause: (row: MonitorRowModel) => void
  onTerminate: (row: MonitorRowModel) => void
  t: PauseControlProps['t']
}): React.ReactElement {
  const pauseLabel = row.phase === 'idle' ? t('monitor.pause') : t('monitor.resume')
  const canPause = row.running || row.phase !== 'idle'
  return (
    <div className="dsh-session-control-row">
      <button
        type="button"
        className="dsh-session-control-row-main"
        aria-label={row.title}
        title={row.title}
        onClick={() => {
          onOpen(row)
        }}
      >
        <span className="dsh-session-control-dot">
          <StateDot state={row.running ? 'ongoing' : 'done'} />
        </span>
        <span className="dsh-session-control-row-title">{row.title}</span>
      </button>
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
          {row.phase === 'idle' ? <PauseGlyph size={16} /> : <PlayGlyph />}
        </button>
      </Tooltip>
      <Tooltip label={t('monitor.terminate')} side="top" delayMs={400} portal>
        <button
          type="button"
          className="dsh-session-control-action is-danger"
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
  confirmPaused,
  terminateSession,
  openSession,
  t,
}: MonitorProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())
  const [failure, setFailure] = React.useState<{ seq: number; text: string } | null>(null)
  const [pending, setPending] = React.useState(false)
  const root = React.useRef<HTMLDivElement | null>(null)
  const sequence = React.useRef(0)
  const timing = React.useRef(readStoredTimings())
  /** Sessions this mount has actually seen running; only those spans can be closed. */
  const watched = React.useRef(new Set<string>())
  const [position, setPosition] = React.useState<BarPosition | null>(() => readStoredPosition())
  const latestPosition = React.useRef<BarPosition | null>(null)
  const drag = React.useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)
  /** Set when a gesture moved the bar, so its release does not also open the panel. */
  const dragged = React.useRef(false)

  const list = useSessions(state => state.byId)
  const statuses = useSessionStatus(state => state)
  const phases = usePausePhases(state => state.phases)
  /** Sessions whose armed pause is being confirmed with the Host. */
  const confirming = React.useRef(new Set<SessionId>())

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

  // The monitor owns every phase transition. An armed pause whose run ended
  // either stopped at its boundary or lost the race to the model's last step, so
  // the Host is asked which of the two happened — the client cannot tell from
  // the run ending alone. A paused run that started again is live.
  React.useEffect(() => {
    for (const [id, phase] of Object.entries(phases)) {
      const sessionId = id as SessionId
      const row = list[sessionId]
      if (row === undefined) {
        setPhase(sessionId, 'idle')
        continue
      }
      const isRunning = statuses.get(sessionId)?.running ?? row.running
      if (phase === 'paused' && isRunning) {
        setPhase(sessionId, 'idle')
        continue
      }
      if (phase !== 'armed' || isRunning || confirming.current.has(sessionId)) continue
      confirming.current.add(sessionId)
      void confirmPaused(sessionId).then(held => {
        confirming.current.delete(sessionId)
        setPhase(sessionId, held ? 'paused' : 'idle')
      })
    }
  }, [list, statuses, phases, setPhase, confirmPaused])

  // Elapsed readings. A run is timed from the moment this page first saw it
  // start, and the span is persisted, so a page or plugin reload keeps counting
  // the same run. When a run stops while being watched, its span is frozen: a
  // finished conversation shows how long that run took, not how long ago it
  // stopped. A run that started and stopped unobserved has no span and renders
  // an em dash instead of a guess.
  React.useEffect(() => {
    const seen = timing.current
    const live = new Set<string>(entries.running.map(entry => entry.id))
    let changed = false
    const stamp = Date.now()
    for (const id of live) {
      watched.current.add(id)
      const record = seen.get(id)
      if (record === undefined || record.endedAt !== null) {
        seen.set(id, { startedAt: stamp, endedAt: null })
        changed = true
      }
    }
    for (const [id, record] of seen) {
      if (live.has(id)) continue
      if (record.endedAt === null) {
        if (watched.current.has(id)) seen.set(id, { startedAt: record.startedAt, endedAt: stamp })
        else seen.delete(id)
        watched.current.delete(id)
        changed = true
      }
      if (list[id as SessionId] === undefined) {
        seen.delete(id)
        watched.current.delete(id)
        changed = true
      }
    }
    if (changed) writeStoredTimings(seen)
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

  // The bar floats over the frame in every deployment (a browser tab has no
  // caption row to sit in), so it is dragged by its chip and remembers where it
  // was dropped. Coordinates are frame-relative and clamped to the frame.
  const frameBox = (): { width: number; height: number; left: number; top: number } => {
    const host = root.current?.offsetParent
    if (!(host instanceof HTMLElement)) {
      return { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 }
    }
    const rect = host.getBoundingClientRect()
    return { width: rect.width, height: rect.height, left: rect.left, top: rect.top }
  }

  const clampInto = (x: number, y: number): BarPosition => {
    const element = root.current
    const frame = frameBox()
    const width = element?.offsetWidth ?? 0
    const height = element?.offsetHeight ?? 0
    return {
      x: Math.min(Math.max(x, 0), Math.max(0, frame.width - width)),
      y: Math.min(Math.max(y, 0), Math.max(0, frame.height - height)),
    }
  }

  const onDragStart = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || root.current === null) return
    const rect = root.current.getBoundingClientRect()
    const frame = frameBox()
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left - frame.left,
      originY: rect.top - frame.top,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onDragMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const active = drag.current
    if (active === null || active.pointerId !== event.pointerId) return
    const dx = event.clientX - active.startX
    const dy = event.clientY - active.startY
    // A press that never leaves the click slop stays a click.
    if (!active.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
    active.moved = true
    const next = clampInto(active.originX + dx, active.originY + dy)
    latestPosition.current = next
    setPosition(next)
  }

  const onDragEnd = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const active = drag.current
    if (active === null || active.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!active.moved) return
    dragged.current = true
    writeStoredPosition(latestPosition.current)
  }

  React.useEffect(() => {
    if (position === null) return
    const keepInside = (): void => {
      const next = clampInto(position.x, position.y)
      if (next.x === position.x && next.y === position.y) return
      latestPosition.current = next
      setPosition(next)
      writeStoredPosition(next)
    }
    window.addEventListener('resize', keepInside)
    return () => {
      window.removeEventListener('resize', keepInside)
    }
    // clampInto reads the live element each call; only the anchor changes.
  }, [position])

  /** A bar dropped in the lower half opens its panel upward. */
  const flip = position !== null && typeof window !== 'undefined' && position.y > window.innerHeight / 2

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
      const elapsed =
        record === undefined
          ? null
          : running
            ? now - record.startedAt
            : record.endedAt === null
              ? null
              : record.endedAt - record.startedAt
      return { id: entry.id, title: entry.title, running, phase: entry.phase, elapsed }
    })

  const runningRows = rowsOf(entries.running, true)
  const unreadRows = rowsOf(entries.unread, false)
  const runningIds = runningRows.map(row => row.id)
  // The bulk pause/continue covers every Session that holds a phase, not only
  // the running ones: a pause that already fired leaves the Session stopped, and
  // that is exactly the state the continue action must still see.
  const pausedIds = (Object.keys(phases) as SessionId[]).filter(id => phases[id] !== undefined)
  const pausableIds = runningRows.filter(row => row.phase === 'idle').map(row => row.id)
  const bulkPauseIds = pausableIds.length > 0 ? pausableIds : pausedIds
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
      onOpen={target => {
        setOpen(false)
        openSession(target.id)
      }}
      onPause={target => {
        void pauseRow(target)
      }}
      onTerminate={target => {
        void terminateRow(target)
      }}
    />
  )

  return (
    <div
      ref={root}
      className={MONITOR_CLASS}
      data-flip={flip || undefined}
      data-placed={position === null || undefined}
      style={position === null ? undefined : { left: position.x, top: position.y }}
    >
      <Tooltip label={open ? t('monitor.collapse') : t('monitor.expand')} side="bottom" delayMs={500} portal>
        <button
          type="button"
          className="dsh-session-control-chip"
          aria-expanded={open}
          aria-label={open ? t('monitor.collapse') : t('monitor.expand')}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onClick={() => {
            // A drag that moved the bar must not also toggle the panel.
            if (dragged.current) {
              dragged.current = false
              return
            }
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
              // A refused resume means the Host no longer holds that pause: the
              // mirror is stale, so drop it instead of leaving a dead action.
              else if (outcome === 'refused') setPhase(id, 'idle')
              return outcome
            })
          }}
        >
          {bulkPauseVerb === 'arm' ? <PauseGlyph size={16} /> : <PlayGlyph />}
        </button>
      </Tooltip>
      <Tooltip label={t('monitor.terminateAll')} side="bottom" delayMs={500} portal>
        <button
          type="button"
          className="dsh-session-control-action is-danger"
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
 * Ask the Host whether one Session still holds a pause that fired.
 * @param ctx - client root context.
 * @param sessionId - target Session.
 * @returns whether the Host holds a stopped pause for it.
 */
async function runStatus(ctx: Context, sessionId: SessionId): Promise<boolean> {
  try {
    const response = await ctx.remote.commands.execute(sessionId, `/${'pause'} status`, [])
    if (!response.ok) return false
    return response.value?.result.kind === 'success'
  } catch (_error: unknown) {
    // An unreachable Host answers nothing; the phase is dropped rather than
    // offering a continue that cannot work.
    return false
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

export const inject = ['slots', 'remote', 'remote.commands', 'locale', 'uiWorkspace'] as const

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
          confirmPaused: sessionId => runStatus(ctx, sessionId),
          terminateSession: sessionId => runTerminate(ctx, sessionId),
          openSession: sessionId => {
            ctx.uiWorkspace.openSession(sessionId)
          },
        }),
      },
      SessionMonitor,
    ),
  )
}
