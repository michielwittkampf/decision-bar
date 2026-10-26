# decision-bar

Work through (many) decisions without losing track, at your own pace and in your own order. A
[Claude Code](https://claude.com/claude-code) mod.

When Claude needs your input, the questions no longer get buried in its reply. Every decision it
asks for goes into one bar above the prompt, and shows in context in the chat as well, the two
kept in sync. Each stays clearly open until you answer it or it no longer applies. Meanwhile you
keep working: dig into one, ask Claude to change something, come back to the rest. Then agree,
disagree or add a remark, and send one or all at once.

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

Works in the desktop app (Code tab) and in the terminal, and on mobile with buttons only. Not yet
in a side chat of the desktop app, where Claude asks in the chat instead
([#103429](https://github.com/anthropics/claude-code/issues/103429)).

## Why use it

- **One overview instead of questions scattered through the text.** However many decisions are
  open, they are together in one place, each with its own choice and remark, and a heading that
  counts what is open and what is chosen. New questions join the list instead of replacing it.
- **Your order, your pace.** Nothing blocks the conversation. Answer one decision now and leave
  the rest while you dig into them; Claude can keep working in the meantime.
- **Decide in context.** The decisions also appear in the chat, right next to Claude's
  reasoning. Answer there while you read, or later in the bar. Afterwards the box keeps showing
  what you decided and which remark went with which decision, so scrolling back shows each answer
  next to its question. In the terminal you type a remark in the bar; the box in the chat shows
  it.

  ![A decision box in the chat, with a choice, a remark and Send all](docs/box.png)

- **Nothing gets lost.** A decision stays visibly open until you answer it. Answered it in the
  chat, or has it been overtaken? Claude takes it off the list. Hidden decisions come back with
  `/decisions`.
- **More than yes or no.** Agree or disagree with a remark, or send just a remark: it goes out
  with the decision it is about, so Claude knows exactly what it refers to. Where the answer is
  not yes or no, Claude gives the decision its own answers ("Commit now", "Run the tests first",
  "Not yet"): two as buttons, more in a menu. An answer can carry a longer text, which the row
  shows in full once you choose it, and which is what is sent.
- **Out of the way when you need the room.** Collapsed, the bar is a single line with the state of
  every decision, and the conversation gets the space back.

  ![Collapsed, the bar shrinks to one line and leaves the space above it free for the conversation](docs/collapsed.png)

- **In your language.** Buttons, counts and answers follow the language of the chat.

  ![The bar in Dutch, with several decisions, each with its own choice and remark, and the counts in the heading](docs/many.png)

## What the mod does

Everything stays on your machine: the mod makes no network requests and reads no credentials.
The short version is in [PRIVACY.md](PRIVACY.md); the details are below.

- **Instructions for Claude.** Each turn the mod adds one section to what Claude is told
  (`prompt.compose`): when to put decisions in the bar, how to word them, and the form the answers
  come back in. It also asks Claude to put the question it ends a turn with in the bar rather than
  in the desktop app's next-step box: the app hides the bar while that box asks something, and the
  box's question is gone once you send anything else. With the setting `closingQuestionInBar` off
  (in `/config`), only while decisions are open. It leaves everything else Claude is told as it
  is.
- **Its own tool.** The mod registers the `decisions` tool and answers it itself (`tool.call`):
  it puts the proposals in the bar, each with agree and disagree or with two to four answers of its
  own, and tells Claude which decisions are open, whether you can see the bar, and,
  for a new chat language, which of the bar's texts to translate. Every other tool call passes
  through unchanged.
- **What it sends as you.** Only when you click Send, Send all or Agree to all, or press Enter in a
  remark field, does the mod submit a message in your name (`$.prompt.submit`), to the same
  conversation. It holds your answers and what they answer: a line per decision,
  `<label> <agree|disagree>: <proposal>`, `<label> → <answer>: <proposal>` or
  `<label> (no decision yet)`, with your remark on its own line below. Label, proposal and answer
  are the ones Claude put in the bar, and an answer is sent exactly as the row shows it (an answer's
  longer text appears below the row as soon as you choose it); each
  is cut to one plain line of limited length, without invisible characters (joiners and direction
  marks that scripts and emoji need stay), and a label cannot start with `/`, `!` or `@`. Agree,
  disagree and remark follow the chat language; the line shape itself is fixed.
- **Your own prompts** (`prompt.submit`, `prompt.edit`) are only read to keep a remark you were
  typing.
- **The `/decisions` command** (`command.run`) brings the decisions you hid last back into the bar.
- **What it keeps.** Decisions, choices and remarks live in the session's state; a proposal Claude
  changes starts again without its choice and remark. The bar's texts in each language Claude
  translated them into are kept in the mod's own store, so a language is translated once. A
  translation only fills in what is still missing, one short line per text, and agree and
  disagree must differ.

### Notes for reviewers

Findings of the plugin directory's scan, and why they are what they are. The code says the same
next to each place the scan points at.

- **"Mod can read the conversation and submit a prompt."** Submitting the answers is the mod's
  purpose. Nothing reaches the message except the label, proposal and chosen answer Claude put in
  the bar, exactly as shown, the bar's own texts and what you typed, and only on your click or
  Enter; no hook submits. What the
  mod reads (`session.surfaces`) only decides whether Claude is told to ask in its reply as well,
  and never goes into a message. See [What the mod does](#what-the-mod-does).

## What would make it better

Things the mod works around today, as feedback for the Claude Code team and for other mod authors,
each with its issue on anthropics/claude-code where one is filed. The decision bar itself is
proposed as a built-in feature in
[#103281](https://github.com/anthropics/claude-code/issues/103281).

- **The band above the prompt beside the next-step box**
  ([#105230](https://github.com/anthropics/claude-code/issues/105230)). While the desktop app's
  next-step box (`wrap_up`) asks a question with answer buttons, the app does not show the band
  above the prompt, although it asks the mod to draw it and `hasSurvey` is false. All open
  decisions are out of sight exactly when Claude waits for an answer. The mod therefore tells
  Claude to ask in the bar instead while decisions are open; a band that stays visible beside the
  box would let both be used.
- **A text input that grows with its text**
  ([#103305](https://github.com/anthropics/claude-code/issues/103305)). The desktop app draws an
  `Input` at a fixed width on one line. One that widens to the room on the line and then wraps onto
  more lines as you type would show the whole remark while you write it, without a separate
  full-remark line below.
- **A focus event for a click into a field**
  ([#103306](https://github.com/anthropics/claude-code/issues/103306)). The desktop app raises
  `ui.focus` when Tab moves through the band above the prompt and when focus leaves it, but not when
  you click into an `Input`. The mod commits a typed remark as soon as focus moves on; after a click
  into another field it has to wait until you type there.
- **Text inputs that keep their scroll**
  ([#103302](https://github.com/anthropics/claude-code/issues/103302)). A redraw keeps an `Input`'s
  cursor where it was, but the desktop app scrolls the field back to the start of its text, so once
  a remark is wider than the field you no longer see where you type. The mod therefore keeps typed
  text out of shared state until your next action. A field that keeps its scroll across redraws
  would let the counts and the full remark update live.
- **Tool groups that stay open**
  ([#103303](https://github.com/anthropics/claude-code/issues/103303)). The desktop app folds
  consecutive tool calls into a collapsed group and does not honour a mod's `isExpanded` on it, so a
  decision box next to another tool call is hidden. Claude is told to keep text between them.
- **Keys for rows in the chat.** In the terminal only the band above the prompt and panes take
  keys, so a field in a transcript row can be shown but not typed in. The decision box there shows
  the remark as text and leaves typing to the bar; the desktop app takes input in the chat, and
  keeps the field.
- **Visible refusals** ([#103304](https://github.com/anthropics/claude-code/issues/103304)). When
  the engine refuses a mod's drawing, an installed mod falls back to the app's own row without a
  word; the reason is only in the debug log.
- **Mod drawing in a side chat** ([#103429](https://github.com/anthropics/claude-code/issues/103429)).
  decision-bar does not work in a side chat of the desktop app: the app shows nothing the mod
  draws there, no bar above the prompt and no decision box in the chat, although the mod runs and
  stores the decisions. The mod notices that it was never asked to draw there and tells Claude to
  ask in the chat instead. A session started from another session (not as a side chat) shows the
  bar and the boxes.
- **Spacing in proportional layouts.** Margins come in whole character cells, which is coarse in
  the desktop app.

## Developing

| Path | What |
|---|---|
| `hooks/register.tsx` | the tool, Claude's instructions, state and the bar |
| `hooks/decision-bar.test.tsx` | behaviour tests (terminal and desktop) |
| `types/index.d.ts` | type contract of the state |
| `.claude-plugin/` | manifest, marketplace file and the directory icon |

1. Run your checkout with `claude --plugin-dir .`, or install it from the folder:
   `claude plugin marketplace add .` and `claude plugin install decision-bar@michielwittkampf`.
2. Change the code and tests; check with `claude plugin validate .` and `claude plugin test .`.
3. In a running session, `/reload-plugins` picks up the change.

The `plugin-authoring` skill in Claude Code has the mod API for your version. Things to know:

- Typed text lives in `drafts`, not in `$.state`, and is committed by `commitDrafts` on any other
  action; reading goes through `withDrafts`. Keep it that way. Writing `$.state` on every
  keystroke redraws the field: the cursor stays where it was, but the desktop app scrolls the
  field back to the start of its text, so a remark wider than the field is typed out of sight. A
  test with short text does not show this.
- Tool arguments sit flat in `e` (`e.proposals`); in tests `$.tool.call({ tool, proposals })`.
- Whether the user can see the bar is `isVisible`: the app asked this mod itself to draw its bar
  or a chat box (`drawnOn`) on a surface that `$.session.surfaces()` still lists. The list alone
  is not enough: it holds every client of the session, also one there for another mod's pane or
  another feature. In tests, answer `session.surfaces` with `{ value: [...] }`.
- `next` is reserved inside a hooks module: an inner variable named `next` stops it from loading.
- The test kit has no `$.store`; `setup` in the tests provides one.
- A tree the engine refuses (a prop out of range, such as a width of `-Infinity` from
  `Math.max()` over an empty list) is replaced by the app's own drawing without any visible
  error in an installed plugin: the reason is only in the debug log (`claude --debug`). Run the
  checkout with `--plugin-dir .` to see refusals as a line in the transcript, and in tests
  `$.ui.mount` rejects with the reason.

## License

MIT — see [LICENSE](LICENSE).
