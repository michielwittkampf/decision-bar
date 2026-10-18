# decision-bar

A [Claude Code](https://claude.com/claude-code) mod for working through many decisions without
losing track of them.

When Claude needs your input, the decisions it proposes go into a bar above the input field
instead of interrupting the conversation. They wait there while you keep working: do some
research, ask Claude a question in between, look into something else. Answer them when you are
ready, in the order you choose — agree or disagree, add a remark, send one or all at once. The
bar always shows what is still open and what you have already decided.

![The decision bar with two decisions, a remark shown in full, and Send all](docs/main.png)

## Install

At the prompt of a terminal session:

```
/plugin install decision-bar --marketplace michielwittkampf/decision-bar
```

From a shell:

```bash
claude plugin install decision-bar --marketplace michielwittkampf/decision-bar
```

In the desktop app:

```
Click + next to the prompt box, then Plugins → Add marketplace → michielwittkampf/decision-bar → Add plugin
```

Works in the desktop app (Code tab) and in the terminal; on mobile with buttons only.

## Why use it

- **Many decisions, one overview.** As many open decisions as you need, each with its own choice
  and remark, and a heading that counts what is open and what is chosen. New questions join the
  list instead of replacing it.
- **Your order, your pace.** Nothing blocks the conversation. Answer one decision now and leave
  the rest while you dig into them; Claude can keep working in the meantime.
- **Out of the way when you need the room.** Collapsed, the bar is a single line with the state of
  every decision, and the conversation gets the space back. Answered something in the chat
  instead? Claude takes it off the list.

  ![Collapsed, the bar shrinks to one line and leaves the space above it free for the conversation](docs/collapsed.png)

- **In your language.** Buttons, counts and answers follow the language of the chat.

![The bar with several decisions, each with its own choice and remark, and the counts in the heading](docs/many.png)

## What would make it better

Things the mod works around today, as feedback for the Claude Code team and for other mod
authors:

- **A text input that grows with its text.** The desktop app draws an `Input` at a fixed width on
  one line. One that widens to the room on the line and then wraps onto more lines as you type
  would show the whole remark while you write it, without a separate full-remark line below.
- **Focus events in the desktop app.** The terminal reports focus moving inside the bar; the
  desktop app does not, and neither surface reports focus leaving the band above the prompt.
  With those, typed remarks could be committed the moment you move on.
- **Controlled text inputs.** Redrawing an `Input` resets its cursor and scroll, so the mod keeps
  typed text out of shared state until your next action. An `Input` that keeps its own cursor
  across redraws would let counts and the full remark update live.
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

MIT — see [LICENSE](LICENSE).
