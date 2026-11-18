/**
 * Browser half of `@dynastxu/dsh-session-control`.
 *
 * The control occupies `conversation.input.activity`, the composer's single
 * compact seat immediately before the stop/send action, so it reads as one
 * control row with the primary button and renders nothing while there is
 * neither a run nor a pause to continue. Appearance follows the composer's own
 * controls: a 34px circle on the row's -2px optical seat, neutral selector fill
 * while nothing is requested, and the primary action's info fill once the pause
 * is engaged (armed or stopped).
 *
 * Three states: the run is active and unprejudiced (arm a pause), the run is
 * active with a pause waiting for its boundary (cancel it), and the run stopped
 * at that boundary (continue it). Arming and continuing are Host operations
 * reached through the `pause` command the Host half registers; this module only
 * mirrors the outcome and the live run, so a run that ends on its own releases
 * the control.
 */

window.__ModuleLoader__.load({
  id: '@dynastxu/dsh-session-control',
  factory(require) {
    const React = require('react')
    const {
      IconPauseOutlineRegular, IconPlayOutlineRegular, IconWarningOutlineRegular, Toast, Tooltip,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const h = React.createElement
    const NS = 'sessionControl'
    const PAUSE_COMMAND = 'pause'
    const BUTTON_CLASS = 'dsh-session-control-pause'

    const STYLES = `
.dsh-session-control-pause{display:grid;place-items:center;flex:none;width:34px;height:34px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);cursor:pointer;transition:background-color 100ms ease,color 100ms ease;transform:translateY(-2px)}
.dsh-session-control-pause.is-engaged{background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-on-color)}
.dsh-session-control-pause:disabled{opacity:.4;cursor:default}
@media (hover:hover){
.dsh-session-control-pause:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-session-control-pause.is-engaged:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
}
`

    const zh = {
      'pause.arm': '安全暂停：下一次请求发出前停止',
      'pause.armed': '已请求暂停，下一次请求发出前停止，点击取消',
      'pause.resume': '已暂停，点击继续',
      'pause.failed': '暂停状态切换失败',
    }

    const en = {
      'pause.arm': 'Pause before the next request',
      'pause.armed': 'Pause armed, stops before the next request. Click to cancel.',
      'pause.resume': 'Paused. Click to continue.',
      'pause.failed': 'Could not change the pause state',
    }

    /** Attach the control's stylesheet for the plugin fiber's lifetime. */
    function installStyles() {
      const style = document.createElement('style')
      style.dataset.sessionControl = ''
      style.textContent = STYLES
      document.head.append(style)
      return () => { style.remove() }
    }

    /**
     * The composer pause seat.
     * @param props.useSession - Session snapshot selector bound by the slot renderer.
     * @param props.sessionId - Session the resident composer currently addresses.
     * @param props.requestPause - Runs one `pause`-command verb and reports its outcome.
     * @param props.locked - Whether the composer currently refuses interaction.
     * @param props.t - The `sessionControl` dictionary.
     */
    function PauseControl({ useSession, sessionId, requestPause, locked, t }) {
      const running = useSession(snapshot => snapshot.running) ?? false
      /** `idle` (nothing requested), `armed` (waiting for a boundary), `paused` (stopped there). */
      const [phase, setPhase] = React.useState('idle')
      const [failure, setFailure] = React.useState(null)
      const pending = React.useRef(false)
      const sequence = React.useRef(0)
      const anchor = React.useRef(null)

      // A pause belongs to one Session; the resident composer outlives that
      // choice, so selecting another Session drops the mirror.
      React.useEffect(() => { setPhase('idle') }, [sessionId])

      // A run that ends while the pause is armed either reached its boundary or
      // finished on its own. Both offer the continue action, and the Host
      // reports which one happened when it is used.
      React.useEffect(() => {
        setPhase(current => {
          if (running) return current === 'paused' ? 'idle' : current
          return current === 'armed' ? 'paused' : current
        })
      }, [running])

      if (!running && phase !== 'paused') return null

      const engaged = phase !== 'idle'
      const label = phase === 'paused' ? t('pause.resume') : phase === 'armed' ? t('pause.armed') : t('pause.arm')
      const disabled = locked === true

      const act = (verb) => {
        if (pending.current) return
        pending.current = true
        void requestPause(verb).then(outcome => {
          pending.current = false
          if (outcome === 'ok') {
            setPhase(verb === 'arm' ? 'armed' : 'idle')
            return
          }
          // A refused verb means the Host holds no pause in that state, so the
          // mirror was stale: drop it instead of reporting a failure.
          if (outcome === 'refused') {
            setPhase('idle')
            return
          }
          sequence.current += 1
          setFailure({ seq: sequence.current, text: t('pause.failed') })
        })
      }

      const verb = phase === 'paused' ? 'resume' : phase === 'armed' ? 'off' : 'arm'

      return h(React.Fragment, null,
        h(Tooltip, { label, side: 'top', delayMs: 500, portal: true, disabled },
          h('button', {
            ref: anchor,
            type: 'button',
            className: engaged ? `${BUTTON_CLASS} is-engaged` : BUTTON_CLASS,
            'aria-label': label,
            'aria-pressed': engaged,
            disabled,
            onClick: () => { act(verb) },
          }, h(phase === 'paused' ? IconPlayOutlineRegular : IconPauseOutlineRegular, { size: 16 }))),
        failure === null ? null : h(Toast, {
          key: failure.seq,
          text: failure.text,
          icon: h(IconWarningOutlineRegular),
          anchor: anchor.current,
          onDone: () => { setFailure(null) },
        }))
    }

    return {
      inject: ['slots', 'remote', 'remote.commands', 'locale'],
      apply(ctx) {
        ctx.effect(installStyles)
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'session-control: dictionaries')
        // The commands are the Host operations; the component only reports
        // whether the requested state was accepted.
        ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
          name: 'conversation.input.activity',
          locale: NS,
          inject: sessionId => ({
            requestPause: async (verb) => {
              const line = verb === 'arm' ? `/${PAUSE_COMMAND}` : `/${PAUSE_COMMAND} ${verb}`
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
              } catch (error) {
                console.warn('[session-control] pause request failed', error)
                return 'failed'
              }
            },
          }),
        }, PauseControl))
      },
    }
  },
})
