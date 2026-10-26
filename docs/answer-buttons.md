# Answer buttons in the bar (design)

Status: variant A built on branch `claude/answer-buttons`, to try out; not released. Variant B is
a possible extension.

## Why

Since 1.3.0 Claude puts its closing question in the bar rather than in the desktop app's
next-step box, because the app hides the bar while that box asks something
([#105230](https://github.com/anthropics/claude-code/issues/105230)). In the bar a question can
only be answered with agree or disagree. Many questions have other answers ("Commit now", "Run the
tests first", "Not yet"). Answer buttons per decision let the bar ask those questions too, so
Claude hardly needs the next-step box while decisions are open.

What the box still has that the bar cannot offer: the app's own actions (commit, create PR) and
the session's "waiting for you" state in the sidebar.

## Shared by both variants

- The tool takes optional `options` per proposal: the answers, in order. Two to four; with fewer
  the row keeps agree and disagree, more are left out. Each is one plain line of limited length,
  like a label.
- The row shows two answers as buttons where agree and disagree would be; choosing one marks it
  (●), pressing it again clears the choice. Three or four answers show as one menu (Select), with
  an empty entry to clear the choice: four buttons and a remark field crowd the line. The mobile
  app draws no menu, so there they stay buttons. Nothing is sent on a press: answers go with Send,
  Send all or Enter in the remark field, as now, so decisions can still be answered at one's own
  pace and in any order.
- A remark works as on any decision.
- "Agree to all" leaves rows with answers of their own alone, also a choice or remark on them:
  agree is not one of their answers. With no row that agree answers, the button is not there.
- A proposal whose text or answers change starts again without choice and remark, and without
  the confirmation of a remark sent for the old one. A press drawn for the old answers is dropped.
- The chat box shows the same buttons, and after sending the chosen answer.

## Rule for what is sent

What Claude puts in the bar leaves as a message from the user when they press Send. A user
message is instruction and consent to Claude, so a press must mean exactly what the row shows: one
plain line, nothing hidden. This is the rule labels and proposals already follow (see the comment
above `languageCode` in `hooks/register.tsx`).

The desktop app's next-step box does not follow it: a button there shows a short label and sends a
longer message the user does not see. Up to 1.2.9 the mod copied that, because it sent what the
app's own box would have sent. For buttons Claude defines in the bar that argument does not hold.

## Variant A: the button text is what is sent (built)

- An answer is a label only. The line sent is fixed in shape, not translated:
  `<label> → <answer>: <proposal>`, for example `C13 → Run the tests first: Commit the release.`
- The proposal says what the question is about; the answer says what was chosen. Together they
  are the whole message, and all of it is on screen.
- Little to draw: the buttons replace agree and disagree on the same line.

## Variant B: an answer may carry a longer text, shown before it is sent

- An answer is `{ label, text }`. The button shows the label; once chosen, the row shows the full
  text below it, the way a long remark is shown in full today.
- What is sent is that text, in the same shape: `<label> → <text>: <proposal>`.
- Nothing goes out unseen, since the text is on screen before Send. The row grows by a line while
  an answer with its own text is chosen.
- Builds on A: only the extra line and the second field of an answer are new.

## Open questions

- Does a row with four answers and a remark field get too busy in the desktop app, and in the
  terminal? To judge in the running app.
- Should the collapsed bar show the chosen answer, or only that one was chosen (●)? A shows ●.
- Buttons for two answers and a menu from three: does that read as one design, or should it be
  one or the other?
