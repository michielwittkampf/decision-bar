# Privacy

decision-bar runs inside Claude Code, on your machine. In short: it sends nothing anywhere except
your own answers, back into the same conversation.

- **Nothing leaves your machine through the mod.** No network requests, no analytics, no
  telemetry. Its only output is a message in your name to the Claude Code conversation you are
  in, and only when you press Send or Agree, or Enter in a remark field.
- **It reads only what the bar needs:** the decisions Claude puts in it, what you type in it, and
  on which screens the session is shown (terminal, desktop app, phone), to know whether you can
  see the bar. No files, no environment variables, no credentials.
- **It keeps little, and only locally.** Open decisions and your remarks belong to the session.
  The bar's texts in your language are kept in the mod's local store, so they are translated once.
- **No one collects anything.** The author receives no data from the mod, and no one else does.

Once your answers are in the conversation, they are like anything else you type to Claude, under
Anthropic's privacy policy for Claude Code.

Every hook and what it reads or changes: [What the mod does](README.md#what-the-mod-does).
