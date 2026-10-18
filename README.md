# decision-bar

A [Claude Code](https://claude.com/claude-code) mod for working through many decisions without
losing track of them.

When Claude needs your input, the decisions it proposes go into a bar above the input field
instead of interrupting the conversation. They wait there while you keep working: do some
research, ask Claude to change something in between, look into something else. Answer them when you are
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
- **Decide in context.** The decisions also appear in the chat, right next to Claude's
  reasoning. Answer there while you read, or later in the bar.

  ![A decision box in the chat, with a choice, a remark and Send all](docs/box.png)

- **Your order, your pace.** Nothing blocks the conversation. Answer one decision now and leave
  the rest while you dig into them; Claude can keep working in the meantime.
- **Out of the way when you need the room.** Collapsed, the bar is a single line with the state of
  every decision, and the conversation gets the space back. Answered something in the chat
  instead? Claude takes it off the list.

  ![Collapsed, the bar shrinks to one line and leaves the space above it free for the conversation](docs/collapsed.png)

- **In your language.** Buttons, counts and answers follow the language of the chat.

  ![The bar in Dutch, with several decisions, each with its own choice and remark, and the counts in the heading](docs/many.png)

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
- **Tool groups that stay open.** The desktop app folds consecutive tool calls into a collapsed
  group and does not honour a mod's `isExpanded` on it, so a decision box next to another tool call
  is hidden. Claude is told to keep text between them.
- **Visible refusals.** When the engine refuses a mod's drawing, an installed mod falls back to the
  app's own row without a word; the reason is only in the debug log.
- **Spacing in proportional layouts.** Margins come in whole character cells, which is coarse in
  the desktop app.

## Developing

| Path | What |
|---|---|
| `hooks/register.tsx` | the tool, Claude's instructions, state and the bar |
| `hooks/decision-bar.test.tsx` | behaviour tests (terminal and desktop) |
| `types/index.d.ts` | type contract of the state |
| `.claude-plugin/` | manifest and marketplace file |

1. Run your checkout with `claude --plugin-dir .`, or install it from the folder:
   `claude plugin marketplace add .` and `claude plugin install decision-bar@decision-bar`.
2. Change the code and tests; check with `claude plugin validate .` and `claude plugin test .`.
3. In a running session, `/reload-plugins` picks up the change.

The `plugin-authoring` skill in Claude Code has the mod API for your version. Things to know:

- Typed text lives in `drafts`, not in `$.state`, and is committed by `commitDrafts` on any other
  action; reading goes through `currentRemarks`. Keep it that way, or typing flickers.
- Tool arguments sit flat in `e` (`e.proposals`); in tests `$.tool.call({ tool, proposals })`.
- `next` is reserved inside a hooks module: an inner variable named `next` stops it from loading.
- The test kit has no `$.store`; `setup` in the tests provides one.
- A tree the engine refuses (a prop out of range, such as a width of `-Infinity` from
  `Math.max()` over an empty list) is replaced by the app's own drawing without any visible
  error in an installed plugin: the reason is only in the debug log (`claude --debug`). Run the
  checkout with `--plugin-dir .` to see refusals as a line in the transcript, and in tests
  `$.ui.mount` rejects with the reason.

## License

MIT — see [LICENSE](LICENSE).
