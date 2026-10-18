# decision-bar

A [Claude Code](https://claude.com/claude-code) mod that puts the decisions Claude proposes in a
bar above the input field. Per decision you choose **agree** or **disagree**, add a remark if you
like, and send — one row at a time or all at once. The bar's own texts follow the language of
the chat.

Works in the desktop app (Code tab) and in the terminal; on mobile only the buttons, without
remark fields.

## Install

At the prompt of a terminal session:

```
/plugin install decision-bar --marketplace michielwittkampf/decision-bar
```

From a shell:

```bash
claude plugin install decision-bar --marketplace michielwittkampf/decision-bar
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `michielwittkampf/decision-bar`, then **Add plugin**.

Answer `y` to add the marketplace and pick a scope (user scope makes it available in every
session). It is active right away.

## What it does

- **Decisions.** Claude calls the tool `mcp__decision-bar__decisions` at the end of a turn
  in which it asks you to decide something. Each decision is a row with its label and the
  proposal, then `○ agree` / `○ disagree` (mutually exclusive; pressing again clears the choice),
  a remark field and `send` for that row alone.
- **At the bottom:** `Send all`, `Agree to all` and `Hide`; with a single row `Send` and
  `Agree`.
- **Messages** sent to the chat: `<label> agree: <proposal>`, `<label> disagree: <proposal>` or
  `<label> (no decision yet), remark: …`, optionally with `Remark: …` indented below, and a blank
  line between answers. A row with a decision disappears once sent; a row with only a remark
  stays open (showing "✓ remark sent"), and the same remark is not sent twice.
- **It stays** while you chat and while Claude works. A row only goes away by sending it, by
  `Hide`, or when Claude calls the tool with `remove: [label]`.
- **Repeated calls** update by label: existing rows keep their choice and remark; a changed
  proposal starts over without a decision; new labels are added. At most 12 decisions.
- **Hide** remembers the labels (a later call does not bring them back; the tool result tells
  Claude so). Right after hiding there is a `Restore` row; later, `/decisions` brings them back.
- **End question mirrored.** The question and answer buttons of the desktop app's next-step box
  appear as a "Question" row, with a field for your own answer. A new end question replaces the
  previous one; answered in the app's own box, it leaves the bar too.
- **Collapse / expand** with `⏷ Decisions`; the heading shows `4 open · 3 chosen`. Collapsed, one
  line shows each decision's state (`✓` agree, `✗` disagree, `○` nothing yet, `✎` with a remark).
  If that line would take more than two lines next to the buttons, only the counts remain:
  `1 open and 2 decided · 2 ✎`.
- **Long remarks** (over 22 characters) are also shown in full below the field. While you type
  in that field the line is struck through as stale text; it is updated on your next action.
- **Language.** Only English is built in. Claude passes the chat language with every call; for a
  language the mod has no texts for yet, the tool result asks Claude for exactly the missing
  ones, and the mod keeps them per language across sessions. The messages sent back are in the
  bar's language too.

## Design choices and platform limits

Several choices follow from what Claude Code, its desktop app and the mod API do or do not
offer. They are recorded here so they are not "fixed" back into a problem.

**The bar only knows what Claude tells it.**
- *No language setting or language event.* The mod API exposes no locale, and the mod does not
  see the chat. Detecting the language of every prompt with a model call would add cost to every
  user's bill, so Claude passes `language` on each call instead, and makes a language-only call
  in the two cases where the bar would otherwise show in the wrong language: right before an end
  question is mirrored, and after a language switch while rows are open. A session that never
  uses the bar costs nothing extra.
- *Every session starts in English.* An empty bar is invisible and every call with decisions
  carries `language`; only the mirrored end question arrives without one. Carrying the last
  language over between sessions would be right only sometimes.
- *Translations come from Claude, once.* Only English is built in. A translation is checked per
  key (same `{placeholders}`, not empty), stored per language in `$.store`, and a key added in a
  later version is asked for on its own.

**Typing must not redraw the bar.**
- Every write to `$.state` redraws the band, and a redrawn `Input` is handed its `value` again:
  on every keystroke that made the field flicker and jump back to the start of the text. Typed
  text therefore lives in a plain module variable (`drafts`) and is committed to state on any
  other action: a button, focus moving to another element (`ui.focus`), typing in another field
  or in Claude Code's own input (`prompt.edit`), a sent message, or a call from Claude.
- Consequences: counts, `✎` and the full-remark line update on your next action, not live (the
  stale full remark is struck through meanwhile); `Send all` is always shown when expanded; text
  typed but not yet committed is lost on `/reload-plugins`; a second screen following the session
  sees typing only after the next action.
- *Focus moves are not reported by the desktop app.* The terminal reports Tab, arrows and clicks
  inside the bar (`ui.focus`); the desktop app does not, so there only typing in another field, a
  button press, a message or a call from Claude commits. Leaving the bar is not an event anywhere:
  only panes report focus, the band above the prompt does not.

**Layout works in whole character cells.**
- Margins and gaps are whole cells, so spacing comes in steps of one line or one column.
- Widths are estimates in cells (`bodyColumns`). Proportional text in the desktop app is narrower
  than a cell, so the collapse-to-counts threshold allows about 30% more there.
- The desktop app draws an `Input` at its own fixed width; a mod cannot size it. The field box is
  sized to the room left on the line, which takes effect in the terminal; the full-remark line
  makes up for the narrow field on the desktop.
- The label column is at most 14 cells; a longer label wraps (top-aligned) instead of narrowing
  the proposal and the field. A word longer than the column is broken with a hyphen: soft hyphens
  outside the terminal (the app breaks only where needed), hard breaks in the terminal.
- Outside the terminal the content is indented one cell to line up with the chevron, which sits
  inside the heading button's border.
- Two ordinary spaces are collapsed into one by the desktop app, so separators use an en space
  (` · ` with wider gaps), and the indent before `Remark:` uses no-break spaces.
- Medium triangles (`⏵ ⏷`) for collapse/expand: the small ones were too small to make out, the
  full ones too heavy.

**Living next to the app's own UI.**
- The desktop app's next-step box shares the spot above the input. The bar does not give way to
  it (`hasSurvey`): otherwise it would disappear exactly when it is needed.
- A message sent while Claude is working is queued and appears after the turn.
- `submitLabel` always renders a button next to the field, and a click on it may pass an empty
  field: an empty pass must not overwrite a typed remark.

## Files

| Path | What |
|---|---|
| `hooks/register.tsx` | everything: tool, instructions for Claude, state, sending, the bar |
| `hooks/decision-bar.test.tsx` | behaviour tests (terminal and desktop) |
| `types/index.d.ts` | type contract of the state (`PluginState['decision-bar']`) |
| `.claude-plugin/plugin.json` | manifest |
| `.claude-plugin/marketplace.json` | makes this repository its own marketplace |

## Developing

1. Load the `plugin-authoring` skill in Claude Code (types and API of your Claude Code version).
2. Change `hooks/register.tsx`, and the tests.
3. Check:
   - `claude plugin validate .`
   - `claude plugin test .`
   - type-check: `tsc -p .` once the engine has written `.claude-plugin/types/`
4. In a running session: `/reload-plugins`. A new session loads it by itself.

Pitfalls learned along the way:

- **Tool arguments sit flat in `e`** (`e.proposals`), not under `e.input`; in tests
  `$.tool.call({ tool, proposals })`. A tool that fails this way reports "no tool.call hook
  answered this call".
- **Do not load it twice.** If the same mod is also in a session's hot-reload folder, two versions
  run with shared state and the old one sometimes wins.
- **Margins only as numbers** (`marginTop={1}`); the step names in the types (`'xs'`, `'md'`) are
  refused.
- **`next` is reserved** inside a hooks module: an inner variable named `next` stops the module
  from loading.
- **Find a `Text` by its text in tests**, not by `key` (`ui.find({ type: 'Text', text })`).
- **The test kit has no `$.store`:** without your own `store.get` / `store.set` hooks every call
  with `language` fails (`no implementation for store.set`). `setup` in the tests provides a Map;
  such a hook answers with `{ value }`.
- **Claude cannot see the bar itself**: visual checks need screenshots.

## License

MIT — see [LICENSE](LICENSE).
