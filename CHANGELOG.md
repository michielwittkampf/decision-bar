# Changelog

## 1.5.0 — 2026-10-31

- The bar starts collapsed, as one line with the state of every decision; click the heading to
  open it. It stays open or collapsed as you leave it for the rest of the session.
- Answers of its own: Claude can give a decision two to four answers ("Commit now", "Run the
  tests first", "Not yet") in place of agree and disagree: two as buttons, three or four as one
  menu (buttons on mobile). You choose one and send it as any decision; the line sent is
  `<label> → <answer>: <proposal>`, the answer exactly as shown. Agree to all leaves those
  decisions as they are. Design: `docs/answer-buttons.md`.
- An answer may carry a longer text (one sentence) next to its short label. Once you choose it,
  the row shows that text in full below it, and that text is what is sent.
- Claude is told to give a question it asks in the bar its answers as `options` when they are
  not agree or disagree.

## 1.4.1 — 2026-10-26

- No more false "Not visible" in a session the user has not opened yet, such as one started in
  the background from another session, or one the user has looked at and left. The desktop app
  attaches to a session only while it is on screen, so an empty list of surfaces does not mean the
  bar cannot be seen. Drawn earlier in the session now counts as visible. Never drawn and nothing
  attached, a side chat and a session not opened yet look the same to a mod: the tool result then
  says "Not shown yet" and names both, and Claude, whose prompt says which session it is in, asks
  in the chat only in a side chat
  ([#103429](https://github.com/anthropics/claude-code/issues/103429)). Surfaces attached that
  never drew the bar still give "Not visible".

## 1.4.0 — 2026-10-26

- The question Claude ends a turn with goes in the bar whenever the bar can be seen, also when no
  other decisions are open, instead of in the desktop app's next-step box. There it stays until
  you answer it; the box's question is gone once you send anything else, and while the box asks,
  the app hides the bar. A setting, `closingQuestionInBar` (on by default), turns this back to
  1.3.0's rule: only while decisions are open.

## 1.3.0 — 2026-10-26

- The question of the desktop app's next-step box is no longer copied into the bar. The app hides
  the bar while that box asks something, so the copy only appeared once the question was
  answered, and could then stay. A copied question still in a session goes when it starts.
- Claude is told to leave the question out of the next-step box while decisions are open, and to
  put it in the bar instead, so the bar stays in sight.

## 1.2.9 — 2026-10-24

- Internal: the bar's state is one list of rows instead of three lists kept in step, the tool
  call's merge is a separate tested function, and the bar's drawing is split into named parts.
  No change in behaviour. Decisions open in the bar when updating from an earlier version are
  dropped once.
- Each place the plugin directory's scan points at says why in the code; the README's notes for
  reviewers explain the finding that holds a version for review.
- PRIVACY.md: what the mod sends (only your answers, into the same conversation), reads and keeps.
  The listing links to it, and to documentation, support and the licence.

## 1.2.8 — 2026-10-24

- Joiners and direction marks (U+200C to U+200F) are kept in labels, proposals and translations:
  1.2.7 removed them, which broke Persian words, Indic scripts, right-to-left text and emoji such
  as a family. Other invisible characters still go.
- A label may start with `#` again (an issue number, say); `/`, `!` and `@` still may not.
- A translated text may be up to 200 characters, room for longer languages; it is still one line.

## 1.2.7 — 2026-10-24

- What Claude puts in the bar reaches the messages sent as the user only as one plain line:
  labels and proposals lose line breaks and invisible characters and are cut to a limited length,
  and a label cannot start with `/`, `!`, `#` or `@`.
- Translations of the bar's texts only fill in what is still missing, each one short line; agree
  and disagree must differ, and the shape of an answer line is no longer translated. A language
  code that is not one is ignored, and a key such as `constructor` no longer breaks the call.
- A proposal Claude changes also drops the remark written for the old text.
- Only this mod's own tool is taken for it, not another server's tool whose name ends the same.
- When setting up the decisions fails, the tool result says why. Dead code removed; the tool and
  the chat box share one parser for proposals.
- Ready for Anthropic's plugin directory: icon, links and keywords in `plugin.json`, and the README
  says what the mod does, with notes for reviewers.

## 1.2.6 — 2026-10-19

- Where the user cannot see the bar, Claude asks in the chat. The tool result says "Not visible"
  when the app never asked this mod to draw its bar or a chat box on a surface that is still
  attached, as in a side chat of the desktop app
  ([#103429](https://github.com/anthropics/claude-code/issues/103429)). Another surface of the
  session (another mod's pane, a phone that never drew the bar) does not count. The rows stay in
  the bar in case it appears.
- README: the side chat item under "What would make it better" says what the mod does there.

## 1.2.5 — 2026-10-19

- Decision box in the chat, terminal only: no remark field, which could be seen but not typed in
  (a transcript row takes no keys there). The remark typed in the bar shows as text, `✎ …`. The
  desktop app keeps the field.
- README: the terminal limit under "Decide in context" and "What would make it better".

## 1.2.4 — 2026-10-18

- README, "What would make it better": each item links to its issue on anthropics/claude-code
  where one is filed, and the decision bar itself is proposed as a built-in feature in #103281.

## 1.2.3 — 2026-10-18

- README, "What would make it better": a redraw keeps an `Input`'s cursor; what the desktop app
  loses is the scroll, which jumps back to the start of the text. The desktop app does report Tab
  moves and focus leaving the band above the prompt; only a click into a field raises no focus
  event.
- README, "Things to know": why typed text stays out of `$.state` until your next action.

## 1.2.2 — 2026-10-18

- Fix: a call that both proposes and removes the same label kept the new proposal out of the
  bar. `remove` now only takes out decisions that were already there.
- README: the shorter intro is back, a screenshot of a decision box in the chat, and the bar in
  Dutch under "In your language".

## 1.2.1 — 2026-10-18

- Fix: decision boxes in the chat fell back to the app's plain tool row whenever the bar was
  empty (everything sent, or taken out with `remove`). The box sized its label column from the
  bar's list, which made the width invalid and the engine refused the box; it now sizes from its
  own proposals.

## 1.2.0 — 2026-10-18

- Decision boxes in the chat: each call shows its decisions where Claude discusses them, with
  agree / disagree, remark and send, in sync with the bar. `Send all` in a box sends only that
  box; sent decisions show their answer and remark.
- No limit on open decisions: the bar no longer drops the oldest beyond twelve.
- Answers sent one by one while Claude is working now arrive with a blank line between them.
- README: screenshots of the bar expanded, collapsed and with many decisions.

## 1.1.0 — 2026-10-18

- A remark always gets its own line, also on an answer without a decision.
- Remarks are marked with `↳`, so they stand out from the answer above.

## 1.0.0 — 2026-10-18

First release.

- One row per decision with agree / disagree, a remark field and send; `Send all` and
  `Agree to all` at the bottom.
- The desktop app's end question mirrored in the bar.
- Collapsed view with each decision's state, shrinking to counts when space runs out.
- The bar follows the chat language; English is built in, other languages are supplied once by
  Claude and kept.
- Long label words break with a hyphen instead of running into the proposal.
