# What would make it better

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
  stores the decisions. A mod cannot tell a side chat from a session you have not opened yet:
  in both, nothing has been drawn and no surface is attached. So the tool result names both cases
  and Claude, whose prompt says which session it is in, asks in the chat only in a side chat. A
  session started from another session (not as a side chat) shows the bar and the boxes once you
  open it.
- **Spacing in proportional layouts.** Margins come in whole character cells, which is coarse in
  the desktop app.
