# Session pause

A safe-pause control for the DSH composer. It sits immediately left of the send/stop button, lets the step in flight finish, and stops the run before its next model request instead of aborting work mid-stream. One more click continues from exactly that point.

## What it does

**Pause.** With a run active, the control arms a pause for that Session and every subagent under it that is currently running:

1. Each armed run keeps the step in flight — the streaming response and its whole tool batch settle normally.
2. Its next proposed step never reaches a model request: the turn is cancelled at that boundary with `keepInbox`, so no request is issued and nothing is cut mid-stream.
3. Each turn is recorded as a user stop, so the transcript's turn header reads **已停止 / Stopped** rather than **已完成 / Completed**. The Session returns to idle, and the input that boundary had already claimed goes back to the inbox, so a queued message or steering text is not dropped.

The pause only moves down the delegation tree. Pausing a subagent never arms or stops its parent.

**Continue.** The button stays in place and turns into a continue control (play glyph, primary fill). Pressing it sends one empty continuation receipt to every run this pause stopped, so each one wakes over its own history and continues from where it stopped: the completed tool results are already in its log. Members that never reached a boundary are only disarmed.

A pause that never reached a boundary — because a run ended on its own — is spent with that run. The control clears itself rather than pretending there was something to continue.

### The three states

| State | Glyph and fill | Press |
|---|---|---|
| Run active, no pause | Pause glyph, neutral fill | Arm the pause |
| Run active, pause armed | Pause glyph, primary fill | Cancel the pause |
| Paused | Play glyph, primary fill | Continue the runs |

## Pausing a subagent

Its live parent is notified through runtime context, queued without waking the parent, at its next step:

> User paused 2 agents before their next model request: child-1, grandchild. They produce no result until the user resumes them; do not wait for them or re-delegate their work.

The notice is recorded as a context row from the `session-control` source, so the parent model learns why those results will not arrive before the user resumes them. A top-level Session has no parent, so nothing is notified.

Only agents that are running are paused. An idle child stays untouched, because arming it would stop its next turn — including a message the user had just sent.

## The `/pause` command

The button drives the same user-facing command, which can also be typed:

- `/pause` arms a pause across the running delegation subtree. It is idempotent and refused while no run is active.
- `/pause off` cancels an armed pause before it fires.
- `/pause resume` continues every run the pause stopped; it is refused when no pause is waiting.

## The control

It occupies `conversation.input.activity`, the composer's single compact seat between the model selector and the stop/send action, and renders nothing while there is neither a run nor a pause to continue.

It reuses the composer's own geometry and materials: a 34px circle on the row's -2px optical seat, neutral selector fill while nothing is requested, and the primary action's info fill once the pause is engaged. Glyphs are the shared `IconPauseOutlineRegular` and `IconPlayOutlineRegular` from the client primitives. Both themes come from the same `--dsw-*` tokens the composer already uses.

## Files

| File | Role |
|---|---|
| `index.js` | Host half: the delegation-tree walk, the `agent/pre-step` gate, the parent notice, and the `/pause` command with its continuation. |
| `client.js` | Browser half: the `conversation.input.activity` entry, its styles, dictionaries, and the Remote call. |
| `cordis.patch.yml` | Bundle patch inserting the Host row. |
| `locale/*.json` | Plugin display title and description. |

## Known limitations

- The paused state lives in the Host process and in the button's own React state. Reloading the page during a pause loses the button; `/pause resume` in the composer still continues the runs, and a pause whose runs ended on their own is cleared by the Host.
- Pausing a one-shot subagent stops it inside the parent's tool call. The parent blocks in that step until the subagent is resumed, because the parent cannot reach its own boundary while the call is outstanding.
- The parent notice names agents by Session id. Display names live in the subagent catalog, which needs an asynchronous catalog read on the pause path.
- `conversation.input.activity` holds one occupant. Enabling the experimental voice-input plugin, which also registers there, replaces this control.

## Development

```sh
pnpm test    # host-half behavior: node tests/host.test.js
```
