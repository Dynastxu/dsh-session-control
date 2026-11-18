/* Generated from src/client.tsx by scripts/build.mjs — do not edit. */
window.__ModuleLoader__.load({
  id: "@dynastxu/dsh-session-control",
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = void 0;
exports.apply = apply;
const jsx_runtime_1 = require("react/jsx-runtime");
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
const React = __importStar(require("react"));
const dsh_client_ui_primitives_1 = require("@deepseek-ai/dsh-client-ui-primitives");
/** Dictionary namespace owned by this plugin. */
const NS = 'sessionControl';
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
    'monitor.settings': '显示设置',
    'monitor.glass': '毛玻璃效果',
};
const en = {
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
    'monitor.settings': 'Display settings',
    'monitor.glass': 'Frosted glass',
};
const COMPOSER_CLASS = 'dsh-session-control-pause';
const MONITOR_CLASS = 'dsh-session-control-monitor';
const STYLES = `
.dsh-session-control-pause{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);line-height:0;cursor:pointer;box-sizing:border-box;transition:background-color 100ms ease,color 100ms ease;transform:translateY(-2px)}
.dsh-session-control-pause > svg{display:block}
.dsh-session-control-pause.is-engaged{background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-on-color)}
.dsh-session-control-pause:disabled{opacity:.4;cursor:default}
@media (hover:hover){
.dsh-session-control-pause:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-session-control-pause.is-engaged:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
}
/* Opaque rounded bar. In the desktop app it is anchored under the caption row at
   the golden section of the window; a deployment without a caption row (a browser
   tab) floats it at the top golden section instead, dragged by its grip, and a
   dropped position is stored in frame pixels and wins over that anchor. */
.dsh-session-control-monitor-root{position:absolute;z-index:21;left:61.8%;top:8px;transform:translateX(-50%);-webkit-app-region:no-drag}
.dsh-session-control-monitor-root[data-placed]{left:0;transform:none}
html[data-platform='darwin'] .dsh-session-control-monitor-root{top:calc(var(--dsh-frame-top-clearance, 48px) + 6px)}
html[data-windows-titlebar] .dsh-session-control-monitor-root{top:calc((var(--dsh-windows-titlebar-height, 40px) - 30px) / 2)}
.dsh-session-control-monitor{display:flex;align-items:center;gap:2px;height:30px;padding:1px 5px 1px 3px;border-radius:10px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
/* A floating bar needs its own surface to sit above the page; the desktop bar sits
   in the caption row, where a fill would read as a second window chrome. */
.dsh-session-control-monitor[data-floating]{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l3);box-shadow:0 6px 18px rgba(0,0,0,.16)}
.dsh-session-control-monitor[data-floating][data-glass]{background:color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent);backdrop-filter:blur(18px) saturate(1.8);-webkit-backdrop-filter:blur(18px) saturate(1.8)}
/* The popovers are siblings of the blurred bar, not descendants: a child's
   backdrop-filter samples inside its ancestor's backdrop root, which ends at the
   bar's own box. */
.dsh-session-control-settings{position:absolute;top:calc(100% + 6px);right:0;display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l3);box-shadow:0 10px 30px var(--dsw-alias-shadow, rgba(0,0,0,.18));color:var(--dsw-alias-label-primary);font-size:13px;white-space:nowrap}
.dsh-session-control-monitor-root[data-glass] .dsh-session-control-settings,.dsh-session-control-monitor-root[data-glass] .dsh-session-control-panel{background:color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);backdrop-filter:blur(18px) saturate(1.8);-webkit-backdrop-filter:blur(18px) saturate(1.8)}
.dsh-session-control-monitor-root[data-flip] .dsh-session-control-settings,.dsh-session-control-monitor-root[data-flip] .dsh-session-control-panel{top:auto;bottom:calc(100% + 6px)}
.dsh-session-control-grip{display:grid;place-items:center;flex:none;width:18px;height:100%;color:var(--dsw-alias-label-secondary);cursor:grab;touch-action:none}
.dsh-session-control-grip:active{cursor:grabbing}
.dsh-session-control-grip > svg{display:block}
.dsh-session-control-chip{display:flex;align-items:center;gap:8px;height:28px;max-width:320px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;white-space:nowrap;cursor:pointer;box-sizing:border-box}
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
.dsh-session-control-panel{position:absolute;top:calc(100% + 6px);right:0;width:min(420px, calc(75vw - 24px));max-height:min(60vh, 420px);overflow-y:auto;padding:6px;border-radius:12px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l3);box-shadow:0 10px 30px var(--dsw-alias-shadow, rgba(0,0,0,.18))}
.dsh-session-control-heading{padding:8px 10px 4px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-session-control-row{display:flex;align-items:center;gap:8px;height:34px;padding:0 4px 0 0;border-radius:8px}
.dsh-session-control-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-session-control-row-main{display:flex;align-items:center;gap:8px;flex:1;min-width:0;height:100%;padding:0 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsh-session-control-row-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-session-control-row-duration{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
.dsh-session-control-empty{padding:10px}
`;
/**
 * Attach the control's stylesheet for the plugin fiber's lifetime.
 * @returns the disposer removing it.
 */
function installStyles() {
    const style = document.createElement('style');
    style.dataset.sessionControl = '';
    style.textContent = STYLES;
    document.head.append(style);
    return () => {
        style.remove();
    };
}
/** Where the paused phases survive a page reload. */
const PHASE_STORAGE_KEY = 'dsh.session-control.pauses';
/**
 * Read the persisted stopped phases. Only `paused` is stored: an armed pause
 * belongs to a run in flight and is re-armed by the user after a reload.
 * @returns one phase per Session that was left stopped.
 */
function readStoredPhases() {
    if (typeof localStorage === 'undefined')
        return {};
    try {
        const raw = localStorage.getItem(PHASE_STORAGE_KEY);
        if (raw === null)
            return {};
        const stored = JSON.parse(raw);
        if (typeof stored !== 'object' || stored === null)
            return {};
        const phases = {};
        for (const [id, phase] of Object.entries(stored)) {
            if (phase === 'paused' || phase === 'armed')
                phases[id] = 'paused';
        }
        return phases;
    }
    catch (_error) {
        // Unreadable or malformed storage has no usable phase and is rewritten on
        // the next change.
        return {};
    }
}
/**
 * @param phases - the phases to persist.
 */
function writeStoredPhases(phases) {
    if (typeof localStorage === 'undefined')
        return;
    try {
        const stored = {};
        for (const [id, phase] of Object.entries(phases)) {
            if (phase === 'paused')
                stored[id] = phase;
        }
        localStorage.setItem(PHASE_STORAGE_KEY, JSON.stringify(stored));
    }
    catch (_error) {
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
function createPausePhases() {
    let snapshot = { phases: readStoredPhases() };
    const listeners = new Set();
    return {
        getSnapshot: () => snapshot,
        subscribe: listener => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        setPhase: (sessionId, phase) => {
            const phases = { ...snapshot.phases };
            if (phase === 'idle')
                delete phases[sessionId];
            else
                phases[sessionId] = phase;
            snapshot = { phases };
            writeStoredPhases(phases);
            for (const listener of [...listeners])
                listener();
        },
    };
}
/** Where the observed run spans survive a page or plugin reload. */
const TIMING_STORAGE_KEY = 'dsh.session-control.timings';
/**
 * Read the stored run spans.
 * @returns one span per Session this browser has observed.
 */
function readStoredTimings() {
    const timings = new Map();
    if (typeof localStorage === 'undefined')
        return timings;
    try {
        const raw = localStorage.getItem(TIMING_STORAGE_KEY);
        if (raw === null)
            return timings;
        const stored = JSON.parse(raw);
        if (typeof stored !== 'object' || stored === null)
            return timings;
        for (const [id, value] of Object.entries(stored)) {
            if (typeof value !== 'object' || value === null)
                continue;
            const candidate = value;
            const startedAt = candidate.startedAt;
            const endedAt = candidate.endedAt;
            if (typeof startedAt !== 'number' || !Number.isSafeInteger(startedAt))
                continue;
            if (endedAt !== null && (typeof endedAt !== 'number' || !Number.isSafeInteger(endedAt)))
                continue;
            timings.set(id, { startedAt, endedAt });
        }
        return timings;
    }
    catch (_error) {
        // Unreadable or malformed storage starts from no observations.
        return timings;
    }
}
/**
 * @param timings - the spans to persist.
 */
function writeStoredTimings(timings) {
    if (typeof localStorage === 'undefined')
        return;
    try {
        localStorage.setItem(TIMING_STORAGE_KEY, JSON.stringify(Object.fromEntries(timings)));
    }
    catch (_error) {
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
function formatElapsed(ms) {
    if (ms === null)
        return '—';
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const seconds = total % 60;
    const pad = (value) => String(value).padStart(2, '0');
    return hours > 0 ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}` : `${String(minutes)}:${pad(seconds)}`;
}
/** Where a dragged bar position survives a reload. */
const POSITION_STORAGE_KEY = 'dsh.session-control.position';
/**
 * Read the stored bar position.
 * @returns the stored frame coordinates, or null to use the default anchor.
 */
function readStoredPosition() {
    if (typeof localStorage === 'undefined')
        return null;
    try {
        const raw = localStorage.getItem(POSITION_STORAGE_KEY);
        if (raw === null)
            return null;
        const stored = JSON.parse(raw);
        if (typeof stored !== 'object' || stored === null)
            return null;
        const candidate = stored;
        if (typeof candidate.x !== 'number' || !Number.isFinite(candidate.x))
            return null;
        if (typeof candidate.y !== 'number' || !Number.isFinite(candidate.y))
            return null;
        return { x: candidate.x, y: candidate.y };
    }
    catch (_error) {
        // Unreadable storage falls back to the default anchor.
        return null;
    }
}
/**
 * @param position - the frame coordinates to keep, or null to forget them.
 */
function writeStoredPosition(position) {
    if (typeof localStorage === 'undefined')
        return;
    try {
        if (position === null)
            localStorage.removeItem(POSITION_STORAGE_KEY);
        else
            localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
    }
    catch (_error) {
        // A full or unavailable store leaves the bar where the user dropped it for
        // this page's lifetime.
    }
}
/** Where the frosted-glass preference survives a reload. */
const GLASS_STORAGE_KEY = 'dsh.session-control.glass';
/**
 * Read the frosted-glass preference.
 * @returns whether the floating bar blurs what it covers; on unless turned off.
 */
function readStoredGlass() {
    if (typeof localStorage === 'undefined')
        return true;
    try {
        return localStorage.getItem(GLASS_STORAGE_KEY) !== 'off';
    }
    catch (_error) {
        // Unreadable storage keeps the default surface.
        return true;
    }
}
/**
 * @param glass - whether the floating bar draws the frosted surface.
 */
function writeStoredGlass(glass) {
    if (typeof localStorage === 'undefined')
        return;
    try {
        localStorage.setItem(GLASS_STORAGE_KEY, glass ? 'on' : 'off');
    }
    catch (_error) {
        // A full or unavailable store keeps the choice for this page's lifetime.
    }
}
/**
 * Bare pause glyph: the two rounded bars at the weight the composer's send and
 * stop circles use. The shared pause artwork draws a ring around the bars,
 * which reads as a different control beside them.
 * @param props.size - rendered edge in pixels.
 * @returns the glyph.
 */
function PauseGlyph({ size }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, children: [(0, jsx_runtime_1.jsx)("rect", { x: "4", y: "3", width: "3", height: "10", rx: "1.2", fill: "currentColor" }), (0, jsx_runtime_1.jsx)("rect", { x: "9", y: "3", width: "3", height: "10", rx: "1.2", fill: "currentColor" })] }));
}
/**
 * Bare continue glyph: the shared filled triangle, scaled to the pause bars'
 * optical weight.
 * @returns the glyph.
 */
function PlayGlyph() {
    return (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconTriangleRightFillRegular, { size: 16, className: "dsh-session-control-play" });
}
/**
 * The composer pause seat for the Session in view.
 * @param props - slot props, injected command face, and dictionary.
 * @returns the control, or nothing while there is neither a run nor a pause.
 */
function PauseControl({ useSession, sessionId, requestPause, usePausePhases, setPhase, locked, t, }) {
    const running = useSession(snapshot => snapshot.running) ?? false;
    const phase = usePausePhases(state => state.phases[sessionId] ?? 'idle');
    const [failure, setFailure] = React.useState(null);
    const pending = React.useRef(false);
    const sequence = React.useRef(0);
    const anchor = React.useRef(null);
    if (!running && phase !== 'paused')
        return null;
    const engaged = phase !== 'idle';
    const label = phase === 'paused' ? t('pause.resume') : phase === 'armed' ? t('pause.armed') : t('pause.arm');
    const verb = phase === 'paused' ? 'resume' : phase === 'armed' ? 'off' : 'arm';
    const act = () => {
        if (pending.current)
            return;
        pending.current = true;
        void requestPause(verb).then(outcome => {
            pending.current = false;
            if (outcome === 'ok') {
                setPhase(sessionId, verb === 'arm' ? 'armed' : 'idle');
                return;
            }
            // A refused verb means the Host holds no pause in that state, so the
            // mirror was stale: drop it instead of reporting a failure.
            if (outcome === 'refused') {
                setPhase(sessionId, 'idle');
                return;
            }
            sequence.current += 1;
            setFailure({ seq: sequence.current, text: t('pause.failed') });
        });
    };
    return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Tooltip, { label: label, side: "top", delayMs: 500, portal: true, disabled: locked, children: (0, jsx_runtime_1.jsx)("button", { ref: anchor, type: "button", className: engaged ? `${COMPOSER_CLASS} is-engaged` : COMPOSER_CLASS, "aria-label": label, "aria-pressed": engaged, disabled: locked, onClick: act, children: phase === 'paused' ? (0, jsx_runtime_1.jsx)(PlayGlyph, {}) : (0, jsx_runtime_1.jsx)(PauseGlyph, { size: 16 }) }) }), failure === null ? null : ((0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Toast, { text: failure.text, icon: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconWarningOutlineRegular, {}), anchor: anchor.current, onDone: () => {
                    setFailure(null);
                } }, failure.seq))] }));
}
/**
 * One conversation row in the monitor panel.
 * @param props - row model, busy flag, handlers, and dictionary.
 * @returns the row.
 */
function MonitorRow({ row, pending, onOpen, onPause, onTerminate, t, }) {
    const pauseLabel = row.phase === 'idle' ? t('monitor.pause') : t('monitor.resume');
    const canPause = row.running || row.phase !== 'idle';
    return ((0, jsx_runtime_1.jsxs)("div", { className: "dsh-session-control-row", children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", className: "dsh-session-control-row-main", "aria-label": row.title, title: row.title, onClick: () => {
                    onOpen(row);
                }, children: [(0, jsx_runtime_1.jsx)("span", { className: "dsh-session-control-dot", children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.StateDot, { state: row.running ? 'ongoing' : 'done' }) }), (0, jsx_runtime_1.jsx)("span", { className: "dsh-session-control-row-title", children: row.title })] }), (0, jsx_runtime_1.jsx)("span", { className: "dsh-session-control-row-duration", children: formatElapsed(row.elapsed) }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Tooltip, { label: pauseLabel, side: "top", delayMs: 400, portal: true, children: (0, jsx_runtime_1.jsx)("button", { type: "button", className: "dsh-session-control-action", "aria-label": pauseLabel, disabled: pending || !canPause, onClick: () => {
                        onPause(row);
                    }, children: row.phase === 'idle' ? (0, jsx_runtime_1.jsx)(PauseGlyph, { size: 16 }) : (0, jsx_runtime_1.jsx)(PlayGlyph, {}) }) }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Tooltip, { label: t('monitor.terminate'), side: "top", delayMs: 400, portal: true, children: (0, jsx_runtime_1.jsx)("button", { type: "button", className: "dsh-session-control-action is-danger", "aria-label": t('monitor.terminate'), disabled: pending || !row.running, onClick: () => {
                        onTerminate(row);
                    }, children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconStopFillRegular, { size: 12 }) }) })] }));
}
/**
 * The title-bar monitor: aggregate state, the running and unviewed
 * conversations, and pause/continue/stop for one row or all of them.
 * @param props - root slot props, injected command face, and dictionary.
 * @returns the monitor.
 */
function SessionMonitor({ useSessions, useSessionStatus, usePausePhases, setPhase, requestPause, confirmPaused, terminateSession, openSession, t, }) {
    const [open, setOpen] = React.useState(false);
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [glass, setGlass] = React.useState(() => readStoredGlass());
    const [now, setNow] = React.useState(() => Date.now());
    const [failure, setFailure] = React.useState(null);
    const [pending, setPending] = React.useState(false);
    const root = React.useRef(null);
    /** The visible bar; drag measurement ignores the popovers that hang off the wrapper. */
    const bar = React.useRef(null);
    const sequence = React.useRef(0);
    const timing = React.useRef(readStoredTimings());
    /** Sessions this mount has actually seen running; only those spans can be closed. */
    const watched = React.useRef(new Set());
    const floating = typeof document === 'undefined' || !document.documentElement.hasAttribute('data-platform');
    const [position, setPosition] = React.useState(() => (floating ? readStoredPosition() : null));
    const latestPosition = React.useRef(null);
    const drag = React.useRef(null);
    const list = useSessions(state => state.byId);
    const statuses = useSessionStatus(state => state);
    const phases = usePausePhases(state => state.phases);
    /** Sessions whose armed pause is being confirmed with the Host. */
    const confirming = React.useRef(new Set());
    // Top-level conversations only: a subagent Session is not a conversation the
    // user started, and a blank New Session carries no work.
    const entries = React.useMemo(() => {
        const running = [];
        const unread = [];
        for (const id of Object.keys(list)) {
            const row = list[id];
            if (row === undefined || row.blank || row.origin === 'subagent')
                continue;
            const status = statuses.get(id);
            const isRunning = status?.running ?? row.running;
            const phase = phases[id] ?? 'idle';
            if (isRunning)
                running.push({ id, title: row.displayTitle, phase });
            else if (status?.completionUnread === true)
                unread.push({ id, title: row.displayTitle, phase });
        }
        return { running, unread };
    }, [list, statuses, phases]);
    // The monitor owns every phase transition. An armed pause whose run ended
    // either stopped at its boundary or lost the race to the model's last step, so
    // the Host is asked which of the two happened — the client cannot tell from
    // the run ending alone. A paused run that started again is live.
    React.useEffect(() => {
        for (const [id, phase] of Object.entries(phases)) {
            const sessionId = id;
            const row = list[sessionId];
            if (row === undefined) {
                setPhase(sessionId, 'idle');
                continue;
            }
            const isRunning = statuses.get(sessionId)?.running ?? row.running;
            if (phase === 'paused' && isRunning) {
                setPhase(sessionId, 'idle');
                continue;
            }
            if (phase !== 'armed' || isRunning || confirming.current.has(sessionId))
                continue;
            confirming.current.add(sessionId);
            void confirmPaused(sessionId).then(held => {
                confirming.current.delete(sessionId);
                setPhase(sessionId, held ? 'paused' : 'idle');
            });
        }
    }, [list, statuses, phases, setPhase, confirmPaused]);
    // Elapsed readings. A run is timed from the moment this page first saw it
    // start, and the span is persisted, so a page or plugin reload keeps counting
    // the same run. When a run stops while being watched, its span is frozen: a
    // finished conversation shows how long that run took, not how long ago it
    // stopped. A run that started and stopped unobserved has no span and renders
    // an em dash instead of a guess.
    React.useEffect(() => {
        const seen = timing.current;
        const live = new Set(entries.running.map(entry => entry.id));
        let changed = false;
        const stamp = Date.now();
        for (const id of live) {
            watched.current.add(id);
            const record = seen.get(id);
            if (record === undefined || record.endedAt !== null) {
                seen.set(id, { startedAt: stamp, endedAt: null });
                changed = true;
            }
        }
        for (const [id, record] of seen) {
            if (live.has(id))
                continue;
            if (record.endedAt === null) {
                if (watched.current.has(id))
                    seen.set(id, { startedAt: record.startedAt, endedAt: stamp });
                else
                    seen.delete(id);
                watched.current.delete(id);
                changed = true;
            }
            if (list[id] === undefined) {
                seen.delete(id);
                watched.current.delete(id);
                changed = true;
            }
        }
        if (changed)
            writeStoredTimings(seen);
    }, [entries, list]);
    React.useEffect(() => {
        if (!open)
            return;
        const tick = setInterval(() => {
            setNow(Date.now());
        }, 1000);
        return () => {
            clearInterval(tick);
        };
    }, [open]);
    React.useEffect(() => {
        if (!open && !settingsOpen)
            return;
        const onPointerDown = (event) => {
            if (root.current !== null && !root.current.contains(event.target)) {
                setOpen(false);
                setSettingsOpen(false);
            }
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape')
                return;
            setOpen(false);
            setSettingsOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open, settingsOpen]);
    // Only a deployment without a caption row floats the bar, and only the grip
    // drags it: the gesture is captured on the grip, remembers where the bar was
    // dropped, and stays frame-relative and clamped to the frame.
    const frameBox = () => {
        const host = root.current?.offsetParent;
        if (!(host instanceof HTMLElement)) {
            return { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
        }
        const rect = host.getBoundingClientRect();
        return { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
    };
    const clampInto = (x, y) => {
        const element = bar.current;
        const frame = frameBox();
        const width = element?.offsetWidth ?? 0;
        const height = element?.offsetHeight ?? 0;
        return {
            x: Math.min(Math.max(x, 0), Math.max(0, frame.width - width)),
            y: Math.min(Math.max(y, 0), Math.max(0, frame.height - height)),
        };
    };
    const onDragStart = (event) => {
        if (event.button !== 0 || bar.current === null)
            return;
        const rect = bar.current.getBoundingClientRect();
        const frame = frameBox();
        drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: rect.left - frame.left,
            originY: rect.top - frame.top,
            moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onDragMove = (event) => {
        const active = drag.current;
        if (active === null || active.pointerId !== event.pointerId)
            return;
        const dx = event.clientX - active.startX;
        const dy = event.clientY - active.startY;
        // A press that never leaves the click slop stays a click.
        if (!active.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3)
            return;
        active.moved = true;
        const next = clampInto(active.originX + dx, active.originY + dy);
        latestPosition.current = next;
        setPosition(next);
    };
    const onDragEnd = (event) => {
        const active = drag.current;
        if (active === null || active.pointerId !== event.pointerId)
            return;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (!active.moved)
            return;
        writeStoredPosition(latestPosition.current);
    };
    React.useEffect(() => {
        if (!floating || position === null)
            return;
        const keepInside = () => {
            const next = clampInto(position.x, position.y);
            if (next.x === position.x && next.y === position.y)
                return;
            latestPosition.current = next;
            setPosition(next);
            writeStoredPosition(next);
        };
        window.addEventListener('resize', keepInside);
        return () => {
            window.removeEventListener('resize', keepInside);
        };
        // clampInto reads the live element each call; only the anchor changes.
    }, [position]);
    /** A bar dropped in the lower half opens its panel upward. */
    const flip = floating && position !== null && typeof window !== 'undefined' && position.y > window.innerHeight / 2;
    const fail = () => {
        sequence.current += 1;
        setFailure({ seq: sequence.current, text: t('monitor.failed') });
    };
    /** Run one bulk action over the given ids and settle once. */
    const bulk = async (ids, run) => {
        if (pending || ids.length === 0)
            return;
        setPending(true);
        const outcomes = await Promise.all(ids.map(async (id) => run(id)));
        setPending(false);
        if (outcomes.some(outcome => outcome === 'failed' || outcome === false))
            fail();
    };
    const pauseRow = async (row) => {
        if (pending)
            return;
        setPending(true);
        const verb = row.phase === 'idle' ? 'arm' : 'resume';
        const outcome = await requestPause(row.id, verb);
        setPending(false);
        if (outcome === 'ok')
            setPhase(row.id, verb === 'arm' ? 'armed' : 'idle');
        else if (outcome === 'refused')
            setPhase(row.id, 'idle');
        else
            fail();
    };
    const terminateRow = async (row) => {
        if (pending)
            return;
        setPending(true);
        const stopped = await terminateSession(row.id);
        setPending(false);
        if (!stopped)
            fail();
    };
    const rowsOf = (items, running) => items.map(entry => {
        const record = timing.current.get(entry.id);
        const elapsed = record === undefined
            ? null
            : running
                ? now - record.startedAt
                : record.endedAt === null
                    ? null
                    : record.endedAt - record.startedAt;
        return { id: entry.id, title: entry.title, running, phase: entry.phase, elapsed };
    });
    const runningRows = rowsOf(entries.running, true);
    const unreadRows = rowsOf(entries.unread, false);
    const runningIds = runningRows.map(row => row.id);
    // The bulk pause/continue covers every Session that holds a phase, not only
    // the running ones: a pause that already fired leaves the Session stopped, and
    // that is exactly the state the continue action must still see.
    const pausedIds = Object.keys(phases).filter(id => phases[id] !== undefined);
    const pausableIds = runningRows.filter(row => row.phase === 'idle').map(row => row.id);
    const bulkPauseIds = pausableIds.length > 0 ? pausableIds : pausedIds;
    const bulkPauseVerb = pausableIds.length > 0 ? 'arm' : 'resume';
    const bulkPauseLabel = bulkPauseVerb === 'arm' ? t('monitor.pauseAll') : t('monitor.resumeAll');
    const counters = runningRows.length > 0
        ? { icon: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.StateDot, { state: "ongoing" }), text: t('monitor.running', { count: runningRows.length }) }
        : unreadRows.length > 0
            ? { icon: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.StateDot, { state: "done" }), text: t('monitor.unread', { count: unreadRows.length }) }
            : { icon: null, text: t('monitor.none') };
    const rowNode = (row) => ((0, jsx_runtime_1.jsx)(MonitorRow, { row: row, pending: pending, t: t, onOpen: target => {
            setOpen(false);
            openSession(target.id);
        }, onPause: target => {
            void pauseRow(target);
        }, onTerminate: target => {
            void terminateRow(target);
        } }, row.id));
    return ((0, jsx_runtime_1.jsxs)("div", { ref: root, className: "dsh-session-control-monitor-root", "data-glass": floating && glass ? true : undefined, "data-flip": flip || undefined, "data-placed": position === null ? undefined : true, style: position === null ? undefined : { left: position.x, top: position.y }, children: [(0, jsx_runtime_1.jsxs)("div", { ref: bar, className: MONITOR_CLASS, "data-floating": floating || undefined, children: [floating ? ((0, jsx_runtime_1.jsx)("span", { className: "dsh-session-control-grip", "aria-hidden": true, onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragEnd, children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconDragHandleOutlineRegular, { size: 14 }) })) : null, (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Tooltip, { label: open ? t('monitor.collapse') : t('monitor.expand'), side: "bottom", delayMs: 500, portal: true, children: (0, jsx_runtime_1.jsxs)("button", { type: "button", className: "dsh-session-control-chip", "aria-expanded": open, "aria-label": open ? t('monitor.collapse') : t('monitor.expand'), onClick: () => {
                                setOpen(value => !value);
                            }, children: [counters.icon, (0, jsx_runtime_1.jsx)("span", { children: counters.text })] }) }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Tooltip, { label: bulkPauseLabel, side: "bottom", delayMs: 500, portal: true, children: (0, jsx_runtime_1.jsx)("button", { type: "button", className: "dsh-session-control-action", "aria-label": bulkPauseLabel, disabled: bulkPauseIds.length === 0 || pending, onClick: () => {
                                void bulk(bulkPauseIds, async (id) => {
                                    const outcome = await requestPause(id, bulkPauseVerb);
                                    if (outcome === 'ok')
                                        setPhase(id, bulkPauseVerb === 'arm' ? 'armed' : 'idle');
                                    // A refused resume means the Host no longer holds that pause: the
                                    // mirror is stale, so drop it instead of leaving a dead action.
                                    else if (outcome === 'refused')
                                        setPhase(id, 'idle');
                                    return outcome;
                                });
                            }, children: bulkPauseVerb === 'arm' ? (0, jsx_runtime_1.jsx)(PauseGlyph, { size: 16 }) : (0, jsx_runtime_1.jsx)(PlayGlyph, {}) }) }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Tooltip, { label: t('monitor.terminateAll'), side: "bottom", delayMs: 500, portal: true, children: (0, jsx_runtime_1.jsx)("button", { type: "button", className: "dsh-session-control-action is-danger", "aria-label": t('monitor.terminateAll'), disabled: runningIds.length === 0 || pending, onClick: () => {
                                void bulk(runningIds, id => terminateSession(id));
                            }, children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconStopFillRegular, { size: 12 }) }) }), floating ? ((0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Tooltip, { label: t('monitor.settings'), side: "bottom", delayMs: 500, portal: true, children: (0, jsx_runtime_1.jsx)("button", { type: "button", className: "dsh-session-control-action", "aria-label": t('monitor.settings'), "aria-expanded": settingsOpen, onClick: () => {
                                setSettingsOpen(value => !value);
                                setOpen(false);
                            }, children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconSettingsOutlineRegular, { size: 16 }) }) })) : null] }), floating && settingsOpen ? ((0, jsx_runtime_1.jsxs)("div", { className: "dsh-session-control-settings", role: "group", "aria-label": t('monitor.settings'), children: [(0, jsx_runtime_1.jsx)("span", { children: t('monitor.glass') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Switch, { checked: glass, label: t('monitor.glass'), onChange: next => {
                            setGlass(next);
                            writeStoredGlass(next);
                        } })] })) : null, open ? ((0, jsx_runtime_1.jsx)("div", { className: "dsh-session-control-panel", role: "dialog", "aria-label": t('monitor.expand'), children: runningRows.length === 0 && unreadRows.length === 0 ? ((0, jsx_runtime_1.jsx)("div", { className: "dsh-session-control-empty", children: t('monitor.none') })) : ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [runningRows.length === 0 ? null : ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("div", { className: "dsh-session-control-heading", children: t('monitor.runningHeading') }), runningRows.map(rowNode)] })), unreadRows.length === 0 ? null : ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("div", { className: "dsh-session-control-heading", children: t('monitor.unreadHeading') }), unreadRows.map(rowNode)] }))] })) })) : null, failure === null ? null : ((0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Toast, { text: failure.text, icon: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconWarningOutlineRegular, {}), onDone: () => {
                    setFailure(null);
                } }, failure.seq))] }));
}
/**
 * Run one pause command verb for one Session.
 * @param ctx - client root context.
 * @param sessionId - target Session.
 * @param verb - 'arm', 'off', or 'resume'.
 * @returns 'ok', 'refused' for a business refusal, or 'failed'.
 */
async function runPause(ctx, sessionId, verb) {
    const line = verb === 'arm' ? `/${'pause'}` : `/${'pause'} ${verb}`;
    try {
        const response = await ctx.remote.commands.execute(sessionId, line, []);
        if (!response.ok) {
            console.warn('[session-control] pause request failed', response.error.code, response.error.message);
            return 'failed';
        }
        const execution = response.value;
        if (execution === undefined) {
            console.warn('[session-control] the pause command is not registered');
            return 'failed';
        }
        if (execution.result.kind !== 'success') {
            console.warn('[session-control] pause refused:', execution.result.text);
            return 'refused';
        }
        return 'ok';
    }
    catch (error) {
        console.warn('[session-control] pause request failed', error);
        return 'failed';
    }
}
/**
 * Ask the Host whether one Session still holds a pause that fired.
 * @param ctx - client root context.
 * @param sessionId - target Session.
 * @returns whether the Host holds a stopped pause for it.
 */
async function runStatus(ctx, sessionId) {
    try {
        const response = await ctx.remote.commands.execute(sessionId, `/${'pause'} status`, []);
        if (!response.ok)
            return false;
        return response.value?.result.kind === 'success';
    }
    catch (_error) {
        // An unreachable Host answers nothing; the phase is dropped rather than
        // offering a continue that cannot work.
        return false;
    }
}
/**
 * Stop one Session's active turn.
 * @param ctx - client root context.
 * @param sessionId - target Session.
 * @returns whether the Host accepted the cancellation.
 */
async function runTerminate(ctx, sessionId) {
    try {
        const response = await ctx.remote.session.cancel({ sessionId });
        if (!response.ok) {
            console.warn('[session-control] stop request failed', response.error.code, response.error.message);
            return false;
        }
        return true;
    }
    catch (error) {
        console.warn('[session-control] stop request failed', error);
        return false;
    }
}
exports.inject = ['slots', 'remote', 'remote.commands', 'locale', 'uiWorkspace'];
/**
 * Register the composer pause seat and the title-bar monitor.
 * @param ctx - client root context.
 */
function apply(ctx) {
    const pausePhases = createPausePhases();
    ctx.effect(installStyles);
    ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'session-control: dictionaries');
    ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
        name: 'conversation.input.activity',
        locale: NS,
        inject: (sessionId) => ({
            hooks: { pausePhases },
            setPhase: (id, phase) => {
                pausePhases.setPhase(id, phase);
            },
            requestPause: verb => runPause(ctx, sessionId, verb),
        }),
    }, PauseControl));
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'session-control.monitor',
        order: 40,
        locale: NS,
        inject: () => ({
            hooks: { pausePhases },
            setPhase: (id, phase) => {
                pausePhases.setPhase(id, phase);
            },
            requestPause: (sessionId, verb) => runPause(ctx, sessionId, verb),
            confirmPaused: sessionId => runStatus(ctx, sessionId),
            terminateSession: sessionId => runTerminate(ctx, sessionId),
            openSession: sessionId => {
                ctx.uiWorkspace.openSession(sessionId);
            },
        }),
    }, SessionMonitor));
}

    return module.exports
  },
})
