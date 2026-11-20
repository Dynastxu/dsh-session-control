# Session control

Session control for DeepSeek Harness. A safe-pause control beside the composer stops a run before its next model request instead of aborting work mid-stream, and one status bar — anchored in the desktop title bar, floating in a browser tab — reports and controls every conversation at once.

## What it does

**Pause.** With a run active, the control arms a pause for that Session and every subagent under it that is currently running:

1. Each armed run keeps the step in flight — the streaming response and its whole tool batch settle normally.
2. Its next proposed step never reaches a model request: the turn is cancelled at that boundary with `keepInbox`, so no request is issued and nothing is cut mid-stream.
3. Each turn is recorded as a user stop, so the transcript's turn header reads **已停止 / Stopped** rather than **已完成 / Completed**. The Session returns to idle, and the input that boundary had already claimed goes back to the inbox, so a queued message or steering text is not dropped.

The pause only moves down the delegation tree. Pausing a subagent never arms or stops its parent.

**Continue.** The button stays in place and turns into a continue control (play glyph, primary fill). Pressing it sends one empty continuation receipt to every run this pause stopped, so each one wakes over its own history and continues from where it stopped: the completed tool results are already in its log. Members that never reached a boundary are only disarmed.

A pause that never reached a boundary — because a run ended on its own — is spent with that run. The control clears itself rather than pretending there was something to continue.

### The three states

| State                   | Glyph and fill            | Press             |
| ----------------------- | ------------------------- | ----------------- |
| Run active, no pause    | Pause glyph, neutral fill | Arm the pause     |
| Run active, pause armed | Pause glyph, primary fill | Cancel the pause  |
| Paused                  | Play glyph, primary fill  | Continue the runs |

## Pausing a subagent

Its live parent is notified through runtime context, queued without waking the parent, at its next step:

> User paused 2 agents before their next model request: child-1, grandchild. They produce no result until the user resumes them; do not wait for them or re-delegate their work.

The notice is recorded as a context row from the `session-control` source, so the parent model learns why those results will not arrive before the user resumes them. A top-level Session has no parent, so nothing is notified.

Only agents that are running are paused. An idle child stays untouched, because arming it would stop its next turn — including a message the user had just sent.

## The monitor bar

A second entry, `shell.overlay` id `session-control.monitor`, draws one bar: the status chip and two bulk actions, plus a drag grip only where it floats.

Only the floating deployment draws a surface — the theme's base background with the `l3` hairline border and a shadow, so the bar reads as a panel over the page. The desktop bar draws no fill at all: a filled pill inside the caption row would read as a second piece of window chrome.

The floating bar also carries a gear button that opens one display setting: frosted glass (`毛玻璃效果`), on by default. On, the surface is the theme base at 72% with `backdrop-filter: blur(14px) saturate(1.6)`; off, it is the opaque base. The choice is stored in `dsh.session-control.glass` and applies to the bar and its popovers.

Placement depends on the deployment, decided by the `data-platform` marker only the desktop preload writes:

| Deployment                       | Bar                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Desktop app, Windows             | Anchored in the caption row, centred on the golden section of the window width (61.8%), no grip, not movable |
| Desktop app, macOS               | Anchored below the title clearance at the same golden section, no grip, not movable                          |
| Browser tab (no `data-platform`) | Floating at the top, golden section default; only the grip drags it                                          |

A dragged position is stored in frame pixels (`dsh.session-control.position`), clamped to the frame on drop and on window resize, and wins over the floating default; the desktop bar ignores that key and clears nothing, so clearing it restores the browser default. A floating bar dropped in the lower half opens its panel upward. The chip itself is only a button — it opens and closes the panel — so a drag can never be mistaken for a click.

The chip reports the most urgent fact first:

| Condition                                | Chip                                |
| ---------------------------------------- | ----------------------------------- |
| Any conversation running                 | Spinner + `n 个正在运行的对话`      |
| None running, some finished and unviewed | Green done dot + `n 个未查看的对话` |
| Neither                                  | `没有需要关注的对话`, no icon       |

Opening the chip lists the running conversations and then the finished-but-unviewed ones. Every row carries the state dot, the conversation title, elapsed time, a pause/continue action, and a stop action; clicking the title opens that conversation. The panel is capped at 60vh (and 420px) and scrolls.

Bulk actions run over every conversation at once: pause-all (which becomes continue-all once every running conversation already holds a pause), and stop-all. Continue-all covers every Session that holds a pause phase, including the ones a pause already stopped — a stopped Session is not running, so a continue restricted to running rows could never resume it. Stop is the Session controller's own cancellation: the turn ends as a stopped user turn and queued input is kept. Stop is styled as the danger action.

The pause glyph is bare bars and the continue glyph a bare triangle, matching the send and stop circles beside the composer rather than the ringed pause artwork.

Elapsed time is the observed run span, persisted in `localStorage` (`dsh.session-control.timings`), so a page or plugin reload keeps counting the same run instead of restarting it. A running conversation counts from the moment this browser first saw the run start; a finished one shows the frozen span that run took — the time it consumed — rather than how long ago it stopped. A run that both started and ended while this browser was not watching has no span and renders `—` instead of a guess; a span is only closed when this page saw the run running, so a restart cannot invent one.

The monitor covers top-level conversations; subagent Sessions are left to the conversation they belong to. It keeps its pause bookkeeping in a client observable shared with the composer button, and the monitor — which sees every Session — is the single writer of those transitions.

A pause armed during a model's last step can lose the race: the run finishes before the request boundary is reached, so nothing stops. The client cannot tell that apart from a pause that fired, so when an armed run ends the monitor asks the Host (`/pause status`) and keeps the continue action only if a stopped pause is really held.

Stopped phases are persisted in `localStorage` (`dsh.session-control.pauses`), so a page reload still offers the continue action. An armed pause belongs to a run in flight and is not persisted; after a reload the user re-arms it.

## The `/pause` command

The button drives the same user-facing command, which can also be typed:

- `/pause` arms a pause across the running delegation subtree. It is idempotent and refused while no run is active.
- `/pause off` cancels an armed pause before it fires.
- `/pause resume` continues every run the pause stopped; it is refused when no pause is waiting.
- `/pause status` answers whether this Agent still holds a pause that stopped its run, which is how the monitor detects a pause the model's last step overtook.

## The control

It occupies `conversation.input.activity`, the composer's single compact seat between the model selector and the stop/send action, and renders nothing while there is neither a run nor a pause to continue.

It reuses the composer's own geometry and materials: a 34px circle on the row's -2px optical seat, neutral selector fill while nothing is requested, and the primary action's info fill once the pause is engaged. Its glyphs are the bare pause bars and the shared filled triangle from the client primitives. Both themes come from the same `--dsw-*` tokens the composer already uses.

## Files

| File                            | Role                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                  | Host half: the delegation-tree walk, the `agent/pre-step` gate, the parent notice, and the `/pause` command with its continuation. |
| `src/client/index.tsx`          | Browser half: the composer pause entry, the title-bar monitor, their styles and dictionaries, and the Remote calls.                |
| `lib/index.js`, `lib/client.js` | Built artifacts the Loader and the Web shell load (not tracked; regenerate with `pnpm build`).                                     |
| `cordis.patch.yml`              | Bundle patch inserting the Host row.                                                                                               |
| `locale/*.json`                 | Plugin display title and description.                                                                                              |

## Known limitations

- The paused state lives in the Host process and in the client's pause-phase observable. Reloading the page during a pause loses the mirror; `/pause resume` in the composer still continues the runs, and a pause whose runs ended on their own is cleared by the Host.
- Pausing a one-shot subagent stops it inside the parent's tool call. The parent blocks in that step until the subagent is resumed, because the parent cannot reach its own boundary while the call is outstanding.
- The parent notice names agents by Session id. Display names live in the subagent catalog, which needs an asynchronous catalog read on the pause path.
- `conversation.input.activity` holds one occupant. Enabling the experimental voice-input plugin, which also registers there, replaces this control.
- The monitor's pause phases are client state, shared with the composer button and lost on reload; the Host stays authoritative and refuses a continue whose pause it no longer holds.

## Development

```sh
pnpm build         # vite: the Host entry → lib/index.js, then the Client entry → lib/client.js
pnpm typecheck     # tsc over src, test, and the build configs
pnpm lint          # oxlint .
pnpm format        # oxfmt .
pnpm test          # host behavior + built-client artifact contract
pnpm check         # typecheck + lint + format:check + build + test
```

The sources are TypeScript. Type checking resolves the DSH packages as ordinary `devDependencies` from the registry, so `pnpm install` alone makes the build work in any checkout — including CI, which has no deepseek-harness tree next to it. The `@deepseek-ai/dsh-*` packages are type-only here: at run time the Host supplies their services through Cordis injection, and the browser half receives `react` and `@deepseek-ai/dsh-client-ui-primitives` from the shell's platform module table.

Both halves are built by Vite. `vite.config.ts` bundles the Host entry into one ESM file with Node builtins external; `vite.client.config.ts` bundles the Client entry into one standalone ES file. The Client source registers the shell's module-loader factory itself, so its only statement at file scope is that registration: React and the primitives arrive through the factory's `require`, the classic JSX runtime keeps `React.createElement` bound to that same `require("react")`, and every constant and component lives inside the factory closure because the shell concatenates plugin bundles into shared scripts. That is why no wrapper script is needed.

Formatting is oxfmt, the formatter the checkout's own toolchain uses: `.oxfmtrc.json` only lists ignored paths, so the sources follow oxfmt's defaults. `format:check` runs in CI, so a change that is not formatted fails the build.

Linting is oxlint, the linter the checkout itself uses, because it parses TypeScript without a separate parser package. The plugin carries its own `.oxlintrc.json`: the checkout's config ignores `**/*.js` and `**/*.mjs` and applies its strict rule set only to `packages/*/*` paths, so inheriting it here would have linted almost nothing.

Tests are Vitest files under `test/`. The Host cases import `src/index.ts` directly and drive it through a Cordis-shaped context; the artifact case evaluates the built `lib/client.js` against the module-loader contract, so `check` builds before it tests. The worker-thread pool is required because the DSH file sandbox blocks the piped child processes the default fork pool spawns.
