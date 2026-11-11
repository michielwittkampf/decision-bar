# What the mod does

Everything stays on your machine: the mod makes no network requests and reads no credentials.
The short version is in [PRIVACY.md](../PRIVACY.md); the details are below.

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
  remark field, or run `/decisions` with nothing hidden (see below), does the mod submit a message
  in your name (`$.prompt.submit`), to the same conversation. It holds your answers and what they answer: a line per decision,
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
  With nothing hidden to bring back, the bar may have lost decisions that are still open in the
  conversation: after a rewind, for example, the bar can be empty while the conversation still
  asks them. Then `/decisions` sends Claude a fixed request in your name to put the open decisions
  back with the tool, in full, and tells it which labels the bar holds now; Claude reads the
  conversation and does so, leaving out what was answered. Labels you hid earlier no longer keep
  those decisions out. The request goes just after the command (`$.clock.after`): the engine
  refuses a submit from the `command.run` hook itself, which holds the turn.
- **What it keeps.** Decisions, choices and remarks live in the session's state; a proposal Claude
  changes starts again without its choice and remark. The bar's texts in each language Claude
  translated them into are kept in the mod's own store, so a language is translated once. A
  translation only fills in what is still missing, one short line per text, and agree and
  disagree must differ.

## Notes for reviewers

Findings of the plugin directory's scan, and why they are what they are. The code says the same
next to each place the scan points at.

- **"Mod can read the conversation and submit a prompt."** Submitting the answers is the mod's
  purpose. Nothing reaches the message except the label, proposal and chosen answer Claude put in
  the bar, exactly as shown, the bar's own texts and what you typed, and only on your click or
  Enter. The one other message is the fixed request of `/decisions` (only the labels now in the bar
  filled in), and only when you run that command; no other hook submits. What the
  mod reads (`session.surfaces`) only decides whether Claude is told to ask in its reply as well,
  and never goes into a message. See [What the mod does](#what-the-mod-does) above.
