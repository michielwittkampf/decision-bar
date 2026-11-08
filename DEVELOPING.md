# Developing decision-bar

How the mod is built, how to run and test your checkout, and the pitfalls of the mod API. What
the mod does, hook by hook, is in [docs/how-it-works.md](docs/how-it-works.md).

## Files

| Path | What |
|---|---|
| `hooks/register.tsx` | the tool, Claude's instructions, state and the bar |
| `hooks/decision-bar.test.tsx` | behaviour tests (terminal and desktop) |
| `types/index.d.ts` | type contract of the state |
| `.claude-plugin/` | manifest, marketplace file and the directory icon |
| `docs/screenshots/` | the README screenshots as pages; `render.sh` turns them into `docs/*.png` |

## Run and test

1. Run your checkout with `claude --plugin-dir .`, or install it from the folder:
   `claude plugin marketplace add .` and `claude plugin install decision-bar@michielwittkampf`.
2. Change the code and tests; check with `claude plugin validate .` and `claude plugin test .`.
3. In a running session, `/reload-plugins` picks up the change.

## Things to know

The `plugin-authoring` skill in Claude Code has the mod API for your version. Things to know:

- Typed text lives in `drafts`, not in `$.state`, and is committed by `commitDrafts` on any other
  action; reading goes through `withDrafts`. Keep it that way. Writing `$.state` on every
  keystroke redraws the field: the cursor stays where it was, but the desktop app scrolls the
  field back to the start of its text, so a remark wider than the field is typed out of sight. A
  test with short text does not show this.
- Tool arguments sit flat in `e` (`e.proposals`); in tests `$.tool.call({ tool, proposals })`.
- Whether the user can see the bar is `visibility`: the app asked this mod itself to draw its bar
  or a chat box (`drawnOn`) on a surface that `$.session.surfaces()` lists now, or, with nothing
  listed now, on any surface earlier in the session: the desktop app attaches only while the
  session is on screen. The list alone is not enough: it holds every client of the session, also
  one there for another mod's pane or another feature. Nothing listed and nothing drawn is a side
  chat or a session not opened yet; the two look the same to a mod (the app's prompt that tells
  them apart is not in what `prompt.compose` hands it), so the result tells Claude both. In tests,
  answer `session.surfaces` with `{ value: [...] }`.
- `next` is reserved inside a hooks module: an inner variable named `next` stops it from loading.
- The test kit has no `$.store`; `setup` in the tests provides one.
- A tree the engine refuses (a prop out of range, such as a width of `-Infinity` from
  `Math.max()` over an empty list) is replaced by the app's own drawing without any visible
  error in an installed plugin: the reason is only in the debug log (`claude --debug`). Run the
  checkout with `--plugin-dir .` to see refusals as a line in the transcript, and in tests
  `$.ui.mount` rejects with the reason.
