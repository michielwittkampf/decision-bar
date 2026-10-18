# decision-bar

A [Claude Code](https://claude.com/claude-code) mod that turns the decisions Claude proposes into
a bar above the input field. Agree or disagree per decision, add a remark, and send one row or
all of them at once — without typing out your answers. The bar speaks the language of your chat.

Works in the desktop app (Code tab) and in the terminal; on mobile with buttons only.

## Install

At the prompt of a terminal session:

```
/plugin install decision-bar --marketplace michielwittkampf/decision-bar
```

From a shell:

```bash
claude plugin install decision-bar --marketplace michielwittkampf/decision-bar
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with
`michielwittkampf/decision-bar`, then **Add plugin**.

## What it does

- **One row per decision.** Whenever Claude asks you to decide something, each decision appears
  with its label and proposal, `○ agree` / `○ disagree`, a remark field and `send`.
- **Send one or all.** `Send all` and `Agree to all` at the bottom (`Send` and `Agree` for a
  single row). Answers reach the chat as `T1 agree: <proposal>`, with any remark indented below
  and a blank line between answers.
- **It stays out of your way.** Rows stay while you chat and while Claude works; Claude updates
  them by label and removes the ones you answered in the chat. `Hide` clears the bar and
  remembers what you hid; `Restore` or `/decisions` brings it back.
- **The end question too.** The question and buttons of the desktop app's next-step box are
  mirrored as a row, with a field for an answer of your own.
- **Compact when collapsed.** Collapsed, one line shows every decision's state (`T1 ✓ · T2 ✗ ·
  T3 ○ ✎`), shrinking to `1 open and 2 decided · 2 ✎` when space runs out.
- **Any language.** The bar's buttons, counts and messages follow the chat language. English is
  built in; for any other language Claude supplies the texts once, the mod checks them and keeps
  them, and from then on switching is instant. It costs nothing in sessions that do not use the
  bar: Claude only signals the language when the bar would otherwise show the wrong one.
- **Long remarks** are shown in full below the field; while you edit, the old version is struck
  through until it is updated.

## What would make it better

Things the mod works around today, as feedback for the Claude Code team and for other mod
authors:

- **Focus events in the desktop app.** The terminal reports focus moving inside the bar; the
  desktop app does not, and neither surface reports focus leaving the band above the prompt.
  With those, typed remarks could be committed the moment you move on.
- **Controlled text inputs.** Redrawing an `Input` resets its cursor and scroll, so the mod keeps
  typed text out of shared state until your next action. An `Input` that keeps its own cursor
  across redraws would let counts and the full remark update live.
- **Input width.** The desktop app draws an `Input` at a fixed width; a width prop would let the
  remark field use the room on the line.
- **Spacing in proportional layouts.** Margins come in whole character cells, which is coarse in
  the desktop app.

## Developing

| Path | What |
|---|---|
| `hooks/register.tsx` | the tool, Claude's instructions, state and the bar |
| `hooks/decision-bar.test.tsx` | behaviour tests (terminal and desktop) |
| `types/index.d.ts` | type contract of the state |
| `.claude-plugin/` | manifest and marketplace file |

1. Load the `plugin-authoring` skill in Claude Code for the API of your version.
2. Change `hooks/register.tsx` and the tests.
3. Check with `claude plugin validate .` and `claude plugin test .`; type-check with `tsc -p .`
   once the engine has written `.claude-plugin/types/`.
4. In a running session: `/reload-plugins`.

Notes for working on it:

- Typed text lives in `drafts`, not in `$.state`, and is committed by `commitDrafts` on any other
  action; reading goes through `currentRemarks`. Keep it that way, or typing flickers again.
- Tool arguments sit flat in `e` (`e.proposals`); in tests `$.tool.call({ tool, proposals })`.
- `next` is reserved inside a hooks module: an inner variable named `next` stops it from loading.
- Margins take numbers only (`marginTop={1}`).
- The test kit has no `$.store`; `setup` in the tests provides one.
- Find a `Text` by its text in tests, not by `key`.

## License

MIT — provided as is. See [LICENSE](LICENSE).
