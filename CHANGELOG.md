# Changelog

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
