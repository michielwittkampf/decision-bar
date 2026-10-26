import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, LastHidden, Proposal, Row } from '../types'

const TOOL = 'decisions'
const TOOL_FULL = 'mcp__decision-bar__decisions'
const COMMAND = 'decisions'
// The engine may report the tool with a prefix, but the server part must be exactly decision-bar,
// so a tool of another server whose name merely ends the same is not taken for this one.
const OUR_TOOL = new RegExp(`(?:^|_)decision-bar__${TOOL}$`)
const isOurTool = (name: string) => name === TOOL_FULL || OUR_TOOL.test(name)

// The bar's rows, in order: each proposal with its choice (agree, disagree, the index of an answer
// of its own, or nothing yet: null) and its committed remark. One atom, so a proposal and its choice and remark cannot drift apart.
const rows = atom({ plugin: 'decision-bar', key: 'rows' } as const, [] as Row[])
// The last remark sent per open decision (key: `rowKey(p)`): a confirmation in the row, and the
// same remark is not sent twice.
const sentRemarks = atom({ plugin: 'decision-bar', key: 'sentRemarks' } as const, {} as Record<string, string>)
// Labels the user dismissed with Hide: a later call does not bring them back.
const hiddenLabels = atom({ plugin: 'decision-bar', key: 'hiddenLabels' } as const, [] as string[])
// The last hidden group, to restore; `show` is the row with the Restore button.
const lastHidden = atom({ plugin: 'decision-bar', key: 'lastHidden' } as const, null as LastHidden | null)
const collapsed = atom({ plugin: 'decision-bar', key: 'collapsed' } as const, false)
// Proposals (`rowKey`) whose field is being edited: their full-remark line is struck through,
// as visibly stale text next to the field.
const editing = atom({ plugin: 'decision-bar', key: 'editing' } as const, [] as string[])
// The decision sent per proposal (`rowKey`), so its box in the chat can show what was answered.
// A chosen answer of its own is kept as `→ <answer>`.
const sentDecisions = atom({ plugin: 'decision-bar', key: 'answered' } as const, {} as Record<string, string>)
// The remark sent with that decision, if any, shown under it in the box.
const sentAnswerRemarks = atom({ plugin: 'decision-bar', key: 'answeredRemarks' } as const, {} as Record<string, string>)

// The bar's own texts. Only English is built in; any other chat language gets them once from
// Claude (`translation` in the tool) and the mod keeps them per language in `$.store`.
// `{name}` is filled in; a translation must keep the same `{names}`.
const EN = {
  heading: 'Decisions',
  agree: 'agree',
  disagree: 'disagree',
  open: '{n} open',
  chosen: '{n} chosen',
  decided: '{n} decided',
  and: 'and',
  remarkField: 'remark (optional)',
  send: 'send',
  remarkSent: '✓ remark sent',
  sendAll: 'Send all',
  sendOne: 'Send',
  agreeAll: 'Agree to all',
  agreeOne: 'Agree',
  hide: 'Hide',
  hiddenOne: '1 decision hidden',
  hiddenMany: '{n} decisions hidden',
  restoreLater: '(restore later with /{command})',
  restore: 'Restore',
  close: 'Close',
  closed: 'closed',
  chooseAnswer: 'choose an answer',
  nothingToSend: 'Nothing to send: choose an answer, or type a remark.',
  messageDecision: '{label} {decision}: {proposal}',
  messageAnswer: '{label} → {answer}: {proposal}',
  undecided: '{label} (no decision yet)',
  messageRemark: 'Remark: {remark}',
  commandRestored: '{n} decision(s) back above the prompt.',
  commandEmpty: 'No hidden decisions to restore.',
} as const
type TextKey = keyof typeof EN
type Translate = (k: TextKey, vars?: Record<string, string | number>) => string

// The bar's texts in the chat language; empty = English. Every session starts in English; Claude
// reports another chat language with a call holding only `language`.
const texts = atom({ plugin: 'decision-bar', key: 'texts' } as const, {} as Record<string, string>)
const storeKey = (code: string) => `translation:${code}`

const translator =
  (table: Record<string, string>): Translate =>
  (k, vars = {}) =>
    (table[k] ?? EN[k]).replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
const currentTranslator = async ($: EngineInterface) => translator(await read($, texts))

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')

// Why the checks below. What Claude puts in the bar (labels, proposals, answers, translations of the
// bar's texts) leaves as a message from the user when they press Send. A user message carries the user's
// authority: Claude, Claude Code and its permission modes take it as instruction and consent,
// while text Claude wrote or read is only data. If Claude was steered by text it read (prompt
// injection), the bar must not turn that into consent the user never saw. So a press means what
// the row shows: one plain line per answer, nothing hidden, nothing that later changes on its own.
// The limits are generous for normal use and only bound how much text can travel this way.

// "nl-BE", "NL" and "nl_nl" are all "nl"; anything that is not a language code is ignored, since
// the code ends up in a key of the mod's store and in the tool result Claude reads back.
const languageCode = (input: unknown) => {
  const code = typeof input === 'string' ? input.trim().toLowerCase().split(/[-_]/)[0]! : ''
  return /^[a-z]{2,3}$/.test(code) ? code : undefined
}

// Text from Claude goes into the bar and, through the message texts, into what is sent as the
// user, so it may hold no line breaks or invisible characters: those could make one answer look
// like two, or carry text the user cannot see. Joiners and direction marks (U+200C to U+200F) stay:
// Persian, Indic scripts, Arabic and Hebrew need them, and so do emoji like a family of three.
const UNSAFE = /[\p{Cc}\u2028\u2029]|(?![\u200C-\u200F])\p{Cf}/u
// Room for the longest text in a long language; anything beyond that is not a translation.
const MAX_TEXT = 200
// Not translated: it is language-neutral, and a translation of it would be the one place where
// text from Claude is added to every answer line the user sends.
const FIXED: readonly string[] = ['messageDecision', 'messageAnswer']
// An own key of EN only: `in` is also true for the keys every object inherits, and such a key
// broke the call.
const isTextKey = (k: string): k is TextKey => Object.prototype.hasOwnProperty.call(EN, k)

// A translation from Claude: only known keys with one short line of text and the same {placeholders}.
const checkTranslation = (input: unknown) => {
  const accepted: Record<string, string> = {}
  const rejected: string[] = []
  if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input)) {
      if (!isTextKey(k) || FIXED.includes(k)) {
        continue
      }
      if (
        typeof v === 'string' &&
        v.trim() !== '' &&
        v.length <= MAX_TEXT &&
        !UNSAFE.test(v) &&
        placeholders(v) === placeholders(EN[k])
      ) {
        accepted[k] = v
      } else {
        rejected.push(k)
      }
    }
  }
  return { accepted, rejected }
}

// Collapse/expand: medium triangles (⏵ ⏷). The small ones (▸ ▾) were too small to make out,
// the full ones (▶ ▼) too heavy.
const CLOSED = '⏵'
const OPENED = '⏷'
// Longer than this and the remark is also shown in full below the field (which is one line).
const LONG_REMARK = 22

// Separator between items in a summary: a normal space plus an en space on each side.
// Two normal spaces would be collapsed into one by the desktop app.
const SEPARATOR = '  ·  '

// Before a remark under an answer: an arrow that ties it to the answer above. The chat shows
// messages as plain text, so indenting or italics are not available.
const INDENT = '↳ '

// Ends every message from the bar. Claude Code joins messages queued during a turn with a single
// line break; this trailing one turns that into a blank line between separately sent answers.
const TRAILER = '\n'

// A proposal's identity: label and text, and its answers if it has them. Other answers make another
// proposal, so a remark confirmation or a sent answer of the old one does not carry over.
const rowKey = (p: Proposal) =>
  p.options
    ? `${p.label}\u0000${p.text}\u0000${p.options.join('\u0001')}\u0000${(p.details ?? []).join('\u0001')}`
    : `${p.label}\u0000${p.text}`

// What a chosen answer sends: its own longer text if it has one, else what its button or menu
// entry shows. The longer text is on screen below the row as soon as the answer is chosen.
const answerText = (p: Proposal, n: number) => p.details?.[n] || p.options?.[n]

// What is typed in a remark field, per proposal (`rowKey`). Deliberately not in `$.state`: every
// write there redraws the bar, and a redrawn field is handed its text again (`value`), which made
// the field flicker on every keystroke and jump back to the start of the text. Committed to
// `rows` on any other action (`commitDrafts`); a reload of the mod loses only uncommitted typing.
let drafts = new Map<string, string>()
// The field (`key`) last typed in: focus moving there is not another action.
let lastField: string | undefined
// The surfaces on which the app asked this mod itself to draw its bar or a chat box. Not that the
// session has a surface (`$.session.surfaces()` lists every client, also one there for another
// mod's pane or another feature), but that this mod's own drawing was asked there: a side chat in
// the desktop app runs the mod but never asks it to draw.
let drawnOn = new Set<string>()

// Whether the user can see the bar. `seen`: this mod drew on a surface that is attached now, or
// nothing is attached now but it drew in this session before (the desktop app attaches while the
// session is on screen; the user looks elsewhere and finds the bar on coming back). `hidden`:
// surfaces are attached, but none drew it. `unknown`: nothing attached and nothing ever drawn. A
// side chat of the desktop app, which never draws for a mod, and a session the user has not opened
// yet (one started in the background) both look like that here, and the app's prompt that tells
// them apart is not in what `prompt.compose` hands a mod: only Claude reads it (NOT_SHOWN_YET).
// Where the engine cannot say which surfaces are attached, assume `seen`. The answer only decides
// what the tool result asks of Claude; the surfaces read here never go into a prompt.
type Visibility = 'seen' | 'hidden' | 'unknown'
const visibility = async ($: EngineInterface): Promise<Visibility> => {
  const attached = await $.session.surfaces().catch(() => undefined)
  if (attached === undefined || attached.some(s => drawnOn.has(s))) {
    return 'seen'
  }
  if (attached.length > 0) {
    return 'hidden'
  }
  return drawnOn.size > 0 ? 'seen' : 'unknown'
}
const NOT_VISIBLE =
  'Not visible: this session has not drawn the bar or a decision box where the user is looking, so the user cannot see them. Ask these decisions in your reply as well, with the same labels, and do not say they are in the bar. They stay in the bar in case it appears; remove them with `remove` once answered.'
const NOT_SHOWN_YET =
  'Not shown yet: the app has not drawn the bar or a decision box in this session so far. In a side chat of the desktop app (a session the user forked to ask something on the side) it never will: there, ask these decisions in your reply as well, with the same labels, and do not say they are in the bar. In a session the user has not opened yet, such as one started from another session, the bar appears when they open it: there, nothing more is needed.'
const visibilitySentence: Record<Visibility, string> = { seen: '', hidden: NOT_VISIBLE, unknown: NOT_SHOWN_YET }
// The rows with what is typed but not yet committed as their remark.
const withDrafts = (list: Row[]): Row[] => list.map(row => ({ ...row, r: drafts.get(rowKey(row.p)) ?? row.r }))
const commitDrafts = async ($: EngineInterface) => {
  lastField = undefined
  if (drafts.size > 0) {
    const now = withDrafts(await read($, rows))
    drafts.clear()
    await update($, rows, () => now)
  }
  if ((await read($, editing)).length > 0) {
    await update($, editing, () => [])
  }
}

// Width of a button with its border and the gap next to it, in cells (an estimate).
const buttonWidth = (label: string) => [...label].length + 5

// How many lines a text takes when word-wrapped at `width` cells.
const lineCount = (text: string, width: number) => {
  if (width < 1) {
    return Infinity
  }
  let count = 1
  let used = 0
  for (const word of text.split(/[  ]+/).filter(Boolean)) {
    const length = [...word].length
    if (used > 0 && used + 1 + length <= width) {
      used += 1 + length
      continue
    }
    if (used > 0) {
      count += 1
    }
    // A word wider than the line runs on to the next.
    count += Math.floor((length - 1) / width)
    used = length % width || width
  }
  return count
}

// Breaks words longer than `width` cells: soft hyphens (shown only where the line breaks) or,
// with `soft` false, a hyphen and a line break every `width - 1` characters.
const breakLongWords = (text: string, width: number, soft: boolean) =>
  text
    .split(' ')
    .map(word => {
      const chars = [...word]
      if (chars.length <= width || width < 2) {
        return word
      }
      if (soft) {
        return chars.join('\u00AD')
      }
      const parts: string[] = []
      for (let i = 0; i < chars.length; i += width - 1) {
        parts.push(chars.slice(i, i + width - 1).join(''))
      }
      return parts.join('-\n')
    })
    .join(' ')

// Decided is agree, disagree or an answer of its own; the rest is open.
const tally = (list: Row[]) => {
  const decided = list.filter(row => row.d !== null).length
  const withRemark = list.filter(row => !!row.r.trim()).length
  return { open: list.length - decided, decided, withRemark }
}

// Expanded, in the heading: "4 open · 3 chosen"; a count of zero is left out.
const headingTally = (t: Translate, list: Row[]) => {
  const { open, decided } = tally(list)
  return [open > 0 ? t('open', { n: open }) : '', decided > 0 ? t('chosen', { n: decided }) : '']
    .filter(Boolean)
    .join(SEPARATOR)
}

// Collapsed and narrow: "1 open and 2 decided · 2 ✎"; a count of zero is left out.
const miniSummary = (t: Translate, list: Row[]) => {
  const { open, decided, withRemark } = tally(list)
  const parts = [open > 0 ? t('open', { n: open }) : '', decided > 0 ? t('decided', { n: decided }) : ''].filter(
    Boolean,
  )
  return parts.join(` ${t('and')} `) + (withRemark > 0 ? `${SEPARATOR}${withRemark} ✎` : '')
}

// Where Claude asks the question it ends a turn with. The desktop app hides the bar while its
// next-step box (`wrap_up`) asks something, and that box's question is gone once the user sends
// anything else. With the setting `closingQuestionInBar` on (the default) the question goes in the
// bar whenever the bar can be seen; off, only while decisions are open, so the bar is not hidden.
const CLOSING_QUESTION_ALWAYS =
  'The desktop app hides the bar while its next-step box (`wrap_up`) shows a question with answer buttons, and that question is gone once the user sends anything else. So while the bar can be seen, put the question you end your turn with in the bar as a decision, with its answers as `options` when they are not agree or disagree, also when no other decisions are open, and leave `ask` and `actions` out of `wrap_up`. Not where the bar cannot be seen (the tool result says "Not visible", or "Not shown yet" in a side chat): then the box is the place to ask.'
const CLOSING_QUESTION_WHILE_OPEN =
  'The desktop app hides the bar while its next-step box (`wrap_up`) shows a question with answer buttons. So when the bar has open decisions at the end of your turn, leave `ask` and `actions` out of `wrap_up`: put the question you would ask there in the bar as a decision instead, with its answers as `options` when they are not agree or disagree. Not where the bar cannot be seen (the tool result says "Not visible", or "Not shown yet" in a side chat): then the box is the place to ask.'

// What Claude is told about the bar, with the closing-question rule the setting picks. Exported for
// its tests.
export const instructions = (questionInBar: boolean) => [
  '# Decision bar',
  `When you ask the user for one or more decisions you propose (for example decision point C13, or "shall I do X?"), put them in the bar above the input field with ${TOOL_FULL} at the end of your turn.`,
  '- `language`: the language of the chat as an ISO 639-1 code (en, nl, de, …). The bar shows its own texts in that language; the answers come back in it too.',
  '- `label`: the short name of the decision, such as "C13" or "Order". No "agree" in it: the user picks agree or disagree.',
  '- `text`: the proposal in one sentence, complete enough to understand without your reply; the bar shows label and text, both in the chat language.',
  '- `options` (optional): when the answer is not agree or disagree, 2 to 4 short answers, each a few words that say the whole choice (for example "Run the tests first"); they replace agree and disagree for that decision. Two show as buttons, three or four as a menu; the answer that is sent is exactly the text shown. When a few words cannot say it, give an answer as `{label, text}`: the label on the button, the full answer in one sentence (at most 200 characters) as `text`; the row shows that text once the answer is chosen, and it is what is sent.',
  '- In your reply, use the same label, in bold, for each proposal, so the user can find the row in the bar.',
  'Each call draws a box with its decisions in the chat, so place it where you discuss them: several calls in one reply are fine, each after the text it belongs to. Always keep text between a call and any other tool call: the desktop app folds consecutive tool calls into a collapsed group, which hides the box.',
  'Only real open decisions: not what you already built or did, and not what the user already answered in the chat (a short "go" or "ok" counts).',
  'What is in the bar stays until the user sends or hides it, also while you chat. On a later call give only new or changed decisions: an existing label is updated, not duplicated. Remove a decision answered or overtaken in the chat with `remove: [label]`.',
  'A label the user hid does not come back; the tool result says which. Only ask about it again in your text when really needed.',
  'If the tool result starts a sentence with "Not visible", the user cannot see the bar where they are looking: ask those decisions in your reply as well, with the same labels, and do not say they are in the bar. If it starts a sentence with "Not shown yet", the app has not drawn the bar in this session so far: in a side chat of the desktop app do the same, in a session the user has not opened yet (such as one started from another session) nothing more is needed.',
  'If the tool result asks for the bar texts in the chat language, call it again right away with `language` and `translation` as it says, before ending your turn.',
  questionInBar ? CLOSING_QUESTION_ALWAYS : CLOSING_QUESTION_WHILE_OPEN,
  'Bar language: the bar starts each session in English; after that it is the `language` of your last call in this session. Make a call with only `language` (it changes nothing but the language) only at the end of a turn in which the chat language changed while the bar has open rows. Otherwise no extra call.',
  'Answers arrive as "<label> <agree>: <proposal>", "<label> <disagree>: <proposal>", "<label> → <answer>: <proposal>" (one of its own answers) or "<label> (no decision yet)", with any remark on its own line below starting with "↳", in the bar language.',
  'This bar is the Claude Code mod `decision-bar`; if the user wants to change it, first read the README.md in its folder (behaviour, files, testing, pitfalls).',
].join('\n')

// One line (with any remark below it) per proposal; empty when there is nothing to report.
const messageLine = (t: Translate, p: Proposal, chosen: Decision, remark: string | undefined) => {
  const r = remark?.trim() ?? ''
  // An answer index the row no longer has is no choice: never a line with an empty answer.
  const decision = typeof chosen === 'number' && p.options?.[chosen] === undefined ? null : chosen
  if (decision === null) {
    // The remark always goes on its own line, so it is never mistaken for the proposal.
    return r ? `${t('undecided', { label: p.label })}\n${INDENT}${t('messageRemark', { remark: r })}` : ''
  }
  // An answer of its own sends the text the row shows for it, nothing else (see `parseOptions`).
  const core =
    typeof decision === 'number'
      ? t('messageAnswer', { label: p.label, answer: answerText(p, decision) ?? '', proposal: p.text })
      : t('messageDecision', {
          label: p.label,
          decision: t(decision === 'agree' ? 'agree' : 'disagree'),
          proposal: p.text,
        })
  return r ? `${core}\n${INDENT}${t('messageRemark', { remark: r })}` : core
}

// Label and proposal lead what is sent as the user, so each is one plain line of limited length:
// line breaks and tabs become spaces, invisible characters go (see UNSAFE), and a label cannot
// start like a command, bash mode or a file mention.
// A label is a short name (C13, Order); a proposal is one sentence. Longer is cut with "…", which
// the row shows too, so what is sent never holds more than the user saw.
const MAX_LABEL = 40
const MAX_PROPOSAL = 400
const oneLine = (text: string, max: number) => {
  const flat = text
    .replace(/[\p{Cc}\u2028\u2029\s]+/gu, ' ')
    .replace(/(?![\u200C-\u200F])\p{Cf}/gu, '')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}
const cleanLabel = (label: string) => oneLine(label, MAX_LABEL).replace(/^[/!@\s]+/, '')

// Answers of its own in place of agree and disagree: two to four, each one plain line like a label,
// optionally with a longer text (one sentence) that is sent in its place. That text is shown in full
// below the row once the answer is chosen, before anything is sent, so a pick never carries text
// the user did not see. Fewer than two: the row keeps agree and disagree.
const MAX_OPTIONS = 4
const MAX_ANSWER_TEXT = 200
const parseOptions = (input: unknown): { options: string[]; details?: string[] } | undefined => {
  // One answer per label, in the order given; a later duplicate only lends its text to one without.
  const answers: { label: string; text: string }[] = []
  for (const o of Array.isArray(input) ? input : []) {
    const a =
      typeof o === 'string'
        ? { label: cleanLabel(o), text: '' }
        : o && typeof o === 'object' && typeof o.label === 'string'
          ? { label: cleanLabel(o.label), text: typeof o.text === 'string' ? oneLine(o.text, MAX_ANSWER_TEXT) : '' }
          : { label: '', text: '' }
    const same = answers.find(b => b.label === a.label)
    if (same) {
      same.text ||= a.text
    } else if (a.label !== '' && answers.length < MAX_OPTIONS) {
      answers.push(a)
    }
  }
  if (answers.length < 2) {
    return undefined
  }
  // A longer text equal to the label adds nothing.
  const details = answers.map(a => (a.text === a.label ? '' : a.text))
  return { options: answers.map(a => a.label), ...(details.some(Boolean) ? { details } : {}) }
}

// The `proposals` argument of a tool call, as Claude sent it: entries without a label are left out,
// and a proposal without text shows its label.
const parseProposals = (input: unknown): Proposal[] =>
  (Array.isArray(input) ? input : [])
    .filter((p): p is { label: string; text: string; options?: unknown } => typeof p?.label === 'string' && typeof p?.text === 'string')
    .map(p => ({ label: cleanLabel(p.label), text: oneLine(p.text, MAX_PROPOSAL), options: parseOptions(p.options) }))
    .filter(p => p.label !== '')
    .map(({ options, ...p }): Proposal => ({ label: p.label, text: p.text || p.label, ...(options ?? {}) }))

// Same proposal: same text and the same answers of its own, if any.
const sameProposal = (a: Proposal, b: Proposal) =>
  a.text === b.text &&
  JSON.stringify(a.options ?? null) === JSON.stringify(b.options ?? null) &&
  JSON.stringify(a.details ?? null) === JSON.stringify(b.details ?? null)

// A tool call's proposals merged into the bar's rows. Existing rows keep their choice and remark;
// an updated proposal (other text or answers) starts again without either, so a remark written for the old
// text does not go out with the new one. New labels are added at the end. A label the user hid is
// skipped. `remove` takes out rows that were in the bar; a label proposed in this same call stays.
// Exported for its tests.
export const mergeProposals = (rows: Row[], incoming: Proposal[], toRemove: Set<string>, hidden: string[]) => {
  const skipped = incoming.filter(p => hidden.includes(p.label)).map(p => p.label)
  const admitted = incoming.filter(p => !hidden.includes(p.label))
  const removed = rows.filter(row => toRemove.has(row.p.label)).map(row => row.p.label)
  // A new array: the rows passed in are left as they are.
  const merged = rows.filter(row => !toRemove.has(row.p.label))
  const updated: string[] = []
  const added: string[] = []
  for (const p of admitted) {
    const at = merged.findIndex(row => row.p.label === p.label)
    if (at === -1) {
      added.push(p.label)
      merged.push({ p, d: null, r: '' })
    } else if (!sameProposal(merged[at]!.p, p)) {
      merged[at] = { p, d: null, r: '' }
      updated.push(p.label)
    }
  }
  // No limit: a decision only leaves the bar when it is sent, hidden or removed.
  return { rows: merged, added, updated, removed, skipped }
}

// Up to 1.2.9 the bar copied the question of the desktop app's next-step box into a row of its
// own, with `options` as objects. Such a row in a session's state goes; answer buttons (strings)
// stay. Exported for its tests.
export const withoutQuestions = (list: Row[]) =>
  list.filter(row => !(row.p.options ?? []).some(o => typeof o !== 'string'))

// Hide: out of the bar, and the labels of the decisions remembered.
const hide = async ($: EngineInterface) => {
  await commitDrafts($)
  const list = await read($, rows)
  const labels = list.map(row => row.p.label)
  await update($, hiddenLabels, old => [...new Set([...old, ...labels])])
  await update($, lastHidden, () => ({ rows: list, show: true }))
  await clear($)
}

// Brings back the last hidden group, with choices and remarks as they were. What was added in the
// meantime stays; a label that is back already is not added twice.
const restore = async ($: EngineInterface): Promise<number> => {
  await commitDrafts($)
  const hidden = await read($, lastHidden)
  if (!hidden || hidden.rows.length === 0) {
    return 0
  }
  const now = await read($, rows)
  const back = hidden.rows.filter(row => !now.some(n => n.p.label === row.p.label))
  const merged = [...back, ...now]
  const labels = hidden.rows.map(row => row.p.label)
  await update($, hiddenLabels, old => old.filter(l => !labels.includes(l)))
  await update($, rows, () => merged)
  await update($, lastHidden, () => null)
  return back.length
}

const clear = async ($: EngineInterface) => {
  drafts.clear()
  await update($, rows, () => [])
  await update($, sentRemarks, () => ({}))
}

// Sends the lines for `indexes`. A proposal with a decision disappears; a proposal with only a
// remark stays open, without that remark.
const send = async ($: EngineInterface, indexes: number[], agreeToAll = false): Promise<boolean> => {
  await commitDrafts($)
  const stored = await read($, rows)
  // An answer index the row no longer has counts as no choice (see `messageLine`).
  const valid = stored.map((row): Row =>
    typeof row.d === 'number' && row.p.options?.[row.d] === undefined ? { ...row, d: null } : row,
  )
  const list = agreeToAll ? valid.map((row): Row => (row.p.options ? row : { ...row, d: 'agree' })) : valid
  const sentBefore = await read($, sentRemarks)
  const t = await currentTranslator($)
  // Only a remark, and exactly that one was sent already: not again.
  const alreadySent = (i: number) => {
    const row = list[i]
    const r = row?.r.trim() ?? ''
    return !!row && row.d === null && r !== '' && sentBefore[rowKey(row.p)] === r
  }
  const lines = indexes
    .filter(i => !alreadySent(i))
    .map(i => (list[i] ? messageLine(t, list[i].p, list[i].d, list[i].r) : ''))
    .filter(l => l !== '')
  if (lines.length === 0) {
    await update($, rows, old => old.map((row, i) => (indexes.includes(i) ? { ...row, r: '' } : row)))
    return false
  }

  const sent = new Set(indexes)
  const stays = (i: number) => !sent.has(i) || list[i]!.d === null
  const keep = list.map((_, i) => i).filter(stays)
  await update($, rows, () => keep.map(i => (sent.has(i) ? { ...list[i]!, r: '' } : list[i]!)))
  await update($, sentRemarks, old => {
    const remembered = { ...old }
    for (const i of keep) {
      const r = list[i]!.r.trim()
      if (sent.has(i) && r !== '') {
        remembered[rowKey(list[i]!.p)] = r
      }
    }
    return remembered
  })
  // Remember what was decided, so the decision's box in the chat can show it.
  await update($, sentDecisions, old => {
    const recorded: Record<string, string> = { ...old }
    for (const i of indexes) {
      const row = list[i]
      if (row && row.d !== null) {
        recorded[rowKey(row.p)] = typeof row.d === 'number' ? `→ ${answerText(row.p, row.d) ?? ''}` : row.d
      }
    }
    return recorded
  })
  await update($, sentAnswerRemarks, old => {
    const recorded: Record<string, string> = { ...(old as Record<string, string>) }
    for (const i of indexes) {
      const row = list[i]
      const r = row?.r.trim() ?? ''
      if (row && row.d !== null && r !== '') {
        recorded[rowKey(row.p)] = r
      }
    }
    return recorded
  })
  // Sent as the user, because these are the user's answers, and only from a press of Send, Send
  // all, Agree or Enter in a remark field: no hook sends. The message holds the rows' labels,
  // proposals and chosen answers (checked, see the comment above `languageCode`), the bar's texts
  // and what the user typed, nothing else read from the session. README: "What the mod does".
  // A blank line between answers, so each stands on its own in the chat.
  await $.prompt.submit({ text: lines.join('\n\n') + TRAILER, asUser: true })
  return true
}

// The language of a call: sets the bar's texts, adds what a translation that came with it still
// lacked, and asks Claude for what is missing. Returns the tool result sentence.
const setLanguage = async ($: EngineInterface, code: string | undefined, translation: unknown) => {
  if (!code) {
    return ''
  }
  if (code === 'en') {
    await update($, texts, () => ({}))
    return ''
  }
  const stored = checkTranslation(await $.store.get(storeKey(code))).accepted
  const { accepted, rejected } = checkTranslation(translation)
  // Only what is still missing is added: a later call cannot change texts already in use.
  const merged: Record<string, string> = { ...accepted, ...stored }
  // Agree and disagree must read differently, or an answer cannot be told apart.
  const t = translator(merged)
  if (t('agree').trim().toLowerCase() === t('disagree').trim().toLowerCase()) {
    delete merged.agree
    delete merged.disagree
    rejected.push('agree', 'disagree')
  }
  if (JSON.stringify(merged) !== JSON.stringify(stored)) {
    await $.store.set(storeKey(code), merged)
  }
  await update($, texts, () => merged)

  const missing = (Object.keys(EN) as TextKey[]).filter(k => !(k in merged) && !FIXED.includes(k))
  return [
    rejected.length > 0
      ? `Not used from translation (empty, longer than ${MAX_TEXT} characters, more than one line, other {placeholders} than asked, or agree and disagree the same): ${rejected.join(', ')}.`
      : '',
    missing.length > 0
      ? `The bar shows English where it has no "${code}" texts yet. Call ${TOOL_FULL} again now with language "${code}" and translation: these texts translated into that language, same keys, {placeholders} and symbols unchanged (no proposals needed): ${JSON.stringify(Object.fromEntries(missing.map(k => [k, EN[k]])))}`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// The elements of one surface, as `$.ui.resolve` hands them out (the same for the bar and a
// chat row). On mobile `Input` and `Select` draw nothing (see `menus`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Elements = { Box: any; Button: any; Text: any; Input?: any; Select?: any }

// How the bar or a chat box asks for its rows. `rows` are the bar's rows. Element keys go under
// `prefix`, so the bar's and each box's elements stay apart. `shown` is what the label column is
// sized for: a chat box shows its own proposals, also when they have all left the bar and `rows`
// is empty. `remarkAsText`: no field, the remark as plain text (a chat box in the terminal, where
// only the bar and panes take keys).
type RowViewOptions = {
  surface: string
  rows: Row[]
  prefix: string
  columns: number
  shown?: Proposal[]
  remarkAsText?: boolean
}

// What the bar and the chat boxes share to draw rows: the elements, the state and the handlers.
// `stored` holds the rows as committed, `current` the same with what is being typed (`drafts`).
type RowView = Elements & {
  t: Translate
  prefix: string
  stored: Row[]
  current: Row[]
  sent: Record<string, string>
  showFull: (i: number) => boolean
  isStale: (p: Proposal) => boolean
  setRemark: (i: number, text: string) => Promise<void>
  keepAndSend: (i: number, text: string) => Promise<void>
  choose: (i: number, decision: Exclude<Decision, null>, p: Proposal) => Promise<unknown>
  setChoice: (i: number, decision: Decision, p: Proposal) => Promise<unknown>
  roomy: boolean
  labelText: (p: Proposal) => string
  labelWidth: number
  fieldWidth: (buttons: string[]) => number
  remarkAsText: boolean
}

const rowView = async (
  $: EngineInterface,
  els: Elements,
  { surface, rows: stored, prefix, columns, shown = stored.map(row => row.p), remarkAsText = false }: RowViewOptions,
): Promise<RowView> => {
  const { Box, Button, Text } = els
  const Input = remarkAsText ? undefined : els.Input
  const t = translator(await read($, texts))
  const current = withDrafts(stored)
  const sent = await read($, sentRemarks)
  const beingEdited = await read($, editing)
  // The line shows the last committed text; while the field is edited it is struck through:
  // visibly stale, until the next action updates it.
  const showFull = (i: number) => (stored[i]?.r.trim().length ?? 0) > LONG_REMARK
  const isStale = (p: Proposal) => beingEdited.includes(rowKey(p))

  // Typing does not redraw (see `drafts`); only clearing "✓ remark sent" or striking through the
  // full remark does, once.
  const setRemark = async (i: number, text: string) => {
    const p = stored[i]?.p
    if (!p) {
      return
    }
    const field = `${prefix}remark-${i}`
    // Typed in another field first: that is another action, the other field is committed.
    // Works also where the app does not report focus moves to the mod.
    if (lastField !== undefined && lastField !== field) {
      await commitDrafts($)
    }
    drafts.set(rowKey(p), text)
    lastField = field
    if (showFull(i) && !beingEdited.includes(rowKey(p))) {
      await update($, editing, old => [...old, rowKey(p)])
    }
    if (sent[rowKey(p)] !== undefined && sent[rowKey(p)] !== text.trim()) {
      await update($, sentRemarks, old => {
        const { [rowKey(p)]: _gone, ...rest } = old
        return rest
      })
    }
  }
  // Enter or the "send" button next to a field: only that row. If the app passes an empty field
  // with the button, the typed remark stays; if nothing goes out, a toast says so.
  const keepAndSend = async (i: number, text: string) => {
    if (text.trim() !== '') {
      await setRemark(i, text)
    }
    const done = await send($, [i])
    if (!done) {
      $.ui.toast(t('nothingToSend'))
    }
  }
  // Only on the row as it was drawn: if its proposal or answers changed before the press landed,
  // the press is about something else and is dropped.
  const setChoice = (i: number, decision: Decision, p: Proposal) =>
    commitDrafts($).then(() =>
      update($, rows, old =>
        old.map((row, j) => (j === i && rowKey(row.p) === rowKey(p) ? { ...row, d: decision } : row)),
      ),
    )
  // Pressing the chosen state again sets it back to "no decision".
  const choose = (i: number, decision: Exclude<Decision, null>, p: Proposal) =>
    setChoice(i, stored[i]?.d === decision ? null : decision, p)

  // In the terminal every line costs room above the prompt; elsewhere there is space to breathe.
  const roomy = surface !== 'terminal'
  // A menu only where it can be used: the terminal and the desktop app draw a Select, mobile draws
  // nothing for it, and a chat row in the terminal takes no keys (see `remarkAsText`). Elsewhere the
  // answers stay buttons, which a click reaches.
  const menus = (surface === 'terminal' || surface === 'desktop') && !remarkAsText
  // Labels in one column of equal width, so buttons and fields line up. At most 14 cells: a
  // longer label wraps onto two lines (top-aligned), leaving the room to proposal and field.
  const labelWidth = Math.min(14, Math.max(0, ...shown.map(p => [...p.label].length)) + 2)
  // A word longer than the column is broken with a hyphen. Outside the terminal soft hyphens let
  // the app break only where proportional text really needs it; the terminal gets hard breaks.
  const labelText = (p: Proposal) => breakLongWords(p.label, labelWidth - 1, roomy)
  // The field as wide as the line allows next to the buttons before it and "send" after it. The
  // desktop app draws an Input at its own width; this only takes effect in the terminal.
  const fieldWidth = (buttons: string[]) =>
    Math.max(
      20,
      columns - (roomy ? 1 : 0) - (labelWidth + 1) - [...buttons, t('send')].reduce((sum, b) => sum + buttonWidth(b), 0) - 1,
    )
  return {
    Box, Button, Text, Input, t, prefix, stored, current, sent, showFull, isStale,
    Select: menus ? els.Select : undefined, setRemark, keepAndSend, choose, setChoice, roomy, labelText, labelWidth, fieldWidth, remarkAsText,
  }
}

// The top line of every row: the label in its column, and the proposal next to it.
const rowTop = (v: RowView, p: Proposal, i: number) => {
  const { Box, Text, prefix: k } = v
  return (
    <Box key={`${k}top-${i}`} flexDirection="row" alignItems="flex-start" columnGap={1}>
      <Box key={`${k}label-box-${i}`} width={v.labelWidth} flexShrink={0}>
        <Text key={`${k}label-${i}`} bold>
          {v.labelText(p)}
        </Text>
      </Box>
      <Box key={`${k}proposal-box-${i}`} flexGrow={1} flexShrink={1}>
        <Text key={`${k}proposal-${i}`}>{p.text}</Text>
      </Box>
    </Box>
  )
}

// The remark field. Enter or its button sends only this row; the rest stays. `buttons` stand
// before it on the line and fix its width.
const remarkField = (v: RowView, i: number, placeholder: string, buttons: string[]) => {
  const { Box, Input, prefix: k } = v
  return (
    Input && (
      <Box key={`${k}field-${i}`} flexGrow={1} minWidth={20} width={v.fieldWidth(buttons)}>
        <Input
          key={`${k}remark-${i}`}
          placeholder={placeholder}
          value={v.current[i]?.r ?? ''}
          submitLabel={v.t('send')}
          onInput={(text: string) => void v.setRemark(i, text)}
          onSubmit={(text: string) => void v.keepAndSend(i, text)}
        />
      </Box>
    )
  )
}

// A remark longer than the field, in full below the row (see `showFull`).
const fullRemark = (v: RowView, p: Proposal, i: number) => {
  const { Box, Text, prefix: k } = v
  return (
    v.showFull(i) &&
    !v.remarkAsText && (
      <Box key={`${k}full-${i}`} marginLeft={v.labelWidth + 1}>
        <Text key={`${k}full-remark-${i}`} dimColor strikethrough={v.isStale(p)}>
          {v.stored[i]!.r}
        </Text>
      </Box>
    )
  )
}

// From this many answers a row shows them in one menu (Select) instead of a button each: four
// buttons and a field crowd the line. Where there is no Select (mobile) they stay buttons.
const SELECT_FROM = 3

// What stands before the remark field on the line, as button texts, for the field's width. A menu
// is about as wide as its longest entry with its arrow.
const choiceWidths = (v: RowView, p: Proposal) => {
  if (p.options && v.Select && p.options.length >= SELECT_FROM) {
    return [[v.t('chooseAnswer'), ...p.options].reduce((a, b) => ([...b].length > [...a].length ? b : a)) + ' ▾']
  }
  return (p.options ?? [v.t('agree'), v.t('disagree')]).map(o => `○ ${o}`)
}

// One decision row: label, proposal, agree / disagree or its own answers, remark field and its
// full text below.
const decisionRow = (v: RowView, p: Proposal, i: number) => {
  const { Box, Button, Text, t, prefix: k, sent } = v
  const d = v.stored[i]?.d ?? null
  const r = v.current[i]?.r ?? ''
  return (
    // Outside the terminal some air around the buttons, and clearly more between rows.
    <Box key={`${k}row-${i}`} flexDirection="column" rowGap={v.roomy ? 1 : 0} marginTop={v.roomy && i > 0 ? 1 : 0}>
      {rowTop(v, p, i)}
      <Box
        key={`${k}choice-${i}`}
        flexDirection="row"
        alignItems="center"
        flexWrap="wrap"
        columnGap={1}
        marginLeft={v.labelWidth + 1}
      >
        {p.options && v.Select && p.options.length >= SELECT_FROM ? (
          <v.Select
            key={`${k}answers-${i}`}
            options={[
              { value: '', label: t('chooseAnswer') },
              ...p.options.map((o, n) => ({ value: String(n), label: o })),
            ]}
            value={typeof d === 'number' ? String(d) : ''}
            onSelect={(value: string) => void v.setChoice(i, value === '' ? null : Number(value), p)}
          />
        ) : p.options ? (
          p.options.map((o, n) => (
            <Button
              key={`${k}answer-${i}-${n}`}
              label={`${d === n ? '●' : '○'} ${o}`}
              variant={d === n ? 'primary' : 'secondary'}
              onPress={() => v.choose(i, n, p)}
            />
          ))
        ) : (
          [
            <Button
              key={`${k}agree-${i}`}
              label={`${d === 'agree' ? '●' : '○'} ${t('agree')}`}
              variant={d === 'agree' ? 'primary' : 'secondary'}
              onPress={() => v.choose(i, 'agree', p)}
            />,
            <Button
              key={`${k}disagree-${i}`}
              label={`${d === 'disagree' ? '●' : '○'} ${t('disagree')}`}
              variant={d === 'disagree' ? 'primary' : 'secondary'}
              onPress={() => v.choose(i, 'disagree', p)}
            />,
          ]
        )}
        {remarkField(v, i, t('remarkField'), choiceWidths(v, p))}
        {v.remarkAsText && r.trim() && (
          <Text key={`${k}remark-text-${i}`} dimColor>
            {`✎ ${r.trim()}`}
          </Text>
        )}
        {sent[rowKey(p)] !== undefined && !r.trim() && (
          <Text key={`${k}sent-${i}`} dimColor>
            {t('remarkSent')}
          </Text>
        )}
      </Box>
      {typeof d === 'number' && p.details?.[d] && (
        <Box key={`${k}answer-text-box-${i}`} marginLeft={v.labelWidth + 1}>
          <Text key={`${k}answer-text-${i}`} dimColor>{`→ ${p.details[d]}`}</Text>
        </Box>
      )}
      {fullRemark(v, p, i)}
    </Box>
  )
}

// After Hide, in place of the bar: how many decisions went, with Restore and Close.
const hiddenNotice = ($: EngineInterface, els: Elements, t: Translate, n: number) => {
  const { Box, Button, Text } = els
  return (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      <Text key="hidden" dimColor>
        {n === 1 ? t('hiddenOne') : t('hiddenMany', { n })} {t('restoreLater', { command: COMMAND })}
      </Text>
      <Button key="restore" label={t('restore')} onPress={() => void restore($)} />
      <Button
        key="close"
        label={t('close')}
        role="dismiss"
        onPress={() => update($, lastHidden, s => (s ? { ...s, show: false } : s))}
      />
    </Box>
  )
}

// What the collapsed and the expanded bar both need.
const barBasics = ($: EngineInterface, v: RowView) => ({
  all: v.stored.map((_, i) => i),
  // With one row no "all": you would look for what else goes along.
  sendLabel: v.t(v.stored.length === 1 ? 'sendOne' : 'sendAll'),
  toggle: () => commitDrafts($).then(() => update($, collapsed, c => !c)),
})

// Collapsed: one line with the heading as a button, the state of each row, and Send all once
// something is chosen or typed.
const collapsedBar = ($: EngineInterface, v: RowView, columns: number) => {
  const { Box, Button, Text, t, current } = v
  const { all, sendLabel, toggle } = barBasics($, v)
  const hasSomething = current.some(row => row.d !== null || row.r.trim())
  // Per row its state: ✓ agree / ✗ disagree / ● an answer chosen / ○ nothing yet, ✎ with a remark.
  const summary = current
    .map(({ p, d, r }) => {
      const pen = r.trim() ? ' ✎' : ''
      const state = d === 'agree' ? '✓' : d === 'disagree' ? '✗' : typeof d === 'number' ? '●' : '○'
      return `${p.label} ${state}${pen}`
    })
    .join(SEPARATOR)
  // If the summary does not fit in two lines next to the buttons, only the counts. Outside the
  // terminal text is narrower than a cell: about 30% more fits on a line there.
  const room =
    (columns - buttonWidth(`${CLOSED} ${t('heading')}`) - (hasSomething ? buttonWidth(sendLabel) : 0)) *
    (v.roomy ? 1.3 : 1)
  const lines = columns > 0 ? lineCount(summary, room) : 1
  return (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      <Button key="toggle" label={`${CLOSED} ${t('heading')}`} onPress={toggle} />
      <Box key="summary-box" flexGrow={1} flexShrink={1}>
        <Text key="summary" dimColor>
          {lines > 2 ? miniSummary(t, current) : summary}
        </Text>
      </Box>
      {hasSomething && <Button key="send-all" label={sendLabel} variant="primary" onPress={() => send($, all)} />}
    </Box>
  )
}

// Expanded: the heading with the counts, every row, and the buttons that act on all of them.
const expandedBar = ($: EngineInterface, v: RowView) => {
  const { Box, Button, Text, t, stored, current } = v
  const { all, sendLabel, toggle } = barBasics($, v)
  // Agree is not an answer to a row with answers of its own, so "Agree to all" takes only the others.
  const agreeable = stored.map((row, i) => (row.p.options ? -1 : i)).filter(i => i >= 0)
  // "Send all" is always there: typing a remark alone does not redraw the bar, so the button
  // would otherwise appear only after another action.
  const sendAll = async () => {
    if (!(await send($, all))) {
      $.ui.toast(t('nothingToSend'))
    }
  }
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box key="heading" flexDirection="row" alignItems="center" columnGap={1}>
        <Button key="toggle" label={`${OPENED} ${t('heading')}`} plain onPress={toggle} />
        <Text key="tally" dimColor>
          {headingTally(t, current)}
        </Text>
      </Box>
      {/* Outside the terminal the chevron sits a little to the right because of the button's
          border: the content moves one cell along so it lines up below it. */}
      <Box key="content" flexDirection="column" rowGap={1} marginLeft={v.roomy ? 1 : 0}>
        {stored.map(({ p }, i) => decisionRow(v, p, i))}
        <Box key="actions" flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
          <Button key="send-all" label={sendLabel} variant="primary" onPress={() => void sendAll()} />
          {agreeable.length > 0 && (
            <Button
              key="agree-all"
              label={t(agreeable.length === 1 ? 'agreeOne' : 'agreeAll')}
              onPress={() => send($, agreeable, true)}
            />
          )}
          <Button key="hide" label={t('hide')} role="dismiss" onPress={() => hide($)} />
        </Box>
      </Box>
    </Box>
  )
}

export const register: Register = (on, options) => {
  // A setting of the plugin (`userConfig` in plugin.json); on unless turned off.
  const questionInBar = options?.closingQuestionInBar !== false
  drafts = new Map()
  lastField = undefined
  drawnOn = new Set()

  on('session.start', async ($, e, next) => {
    // A question copied by 1.2.9 goes once (see `withoutQuestions`); other rows stay as they are.
    await update($, rows, old => {
      const kept = withoutQuestions(old)
      return kept.length < old.length ? kept : old
    }).catch(() => undefined)
    await update($, lastHidden, last => {
      const kept = last ? withoutQuestions(last.rows) : []
      return last && kept.length < last.rows.length ? { ...last, rows: kept } : last
    }).catch(() => undefined)
    await $.tool.register({
      name: TOOL,
      description:
        "Puts a row per proposed decision (label and proposal) above the user's input field, with agree / disagree or the decision's own answers, and a remark field. An existing label is updated; `remove` removes decisions answered in the chat.",
      inputSchema: {
        type: 'object',
        properties: {
          language: {
            type: 'string',
            description: "Language of the chat, ISO 639-1 (en, nl, de, …); the bar's own texts follow it",
          },
          translation: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description:
              "Only when the tool result asks for it: the bar's texts in `language`, with the keys and {placeholders} it gives",
          },
          proposals: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Short name of the decision (e.g. "C13")' },
                text: { type: 'string', description: 'The proposal in one sentence' },
                options: {
                  type: 'array',
                  items: {
                    anyOf: [
                      { type: 'string' },
                      {
                        type: 'object',
                        properties: {
                          label: { type: 'string', description: 'The answer as its button or menu entry shows it' },
                          text: { type: 'string', description: 'Optional: the full answer in one sentence, sent in its place' },
                        },
                        required: ['label'],
                      },
                    ],
                  },
                  description:
                    'Optional: 2 to 4 short answers in place of agree / disagree (two as buttons, more as a menu); the chosen one is sent as shown, or its longer text, which the row shows once it is chosen',
                },
              },
              required: ['label', 'text'],
            },
          },
          remove: {
            type: 'array',
            items: { type: 'string' },
            description: 'Labels of decisions answered or overtaken in the chat',
          },
        },
        required: ['language'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: COMMAND,
      description: 'Bring the last hidden decisions back into the bar',
    })

    return next(e)
  })

  // Only this mod's own /decisions command (the matcher); other commands never reach this hook.
  on('command.run', { command: COMMAND }, async $ => {
    const count = await restore($)
    const t = await currentTranslator($)
    return { text: count > 0 ? t('commandRestored', { n: count }) : t('commandEmpty') }
  })

  // Adds one section of its own, `instructions`: how Claude uses the bar. Everything else Claude is
  // told passes through unchanged. README: "What the mod does".
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      ...composed,
      sections: [...composed.sections, { id: 'decision-bar:instructions', text: instructions(questionInBar), scope: 'session' }],
    }
  })

  // No matcher on the exact name: the engine may report the tool with a prefix.
  // This hook answers one tool itself: `decisions`, the tool this mod registers, which has nothing
  // else behind it (`isOurTool`). Every other tool call passes through untouched.
  on('tool.call', async ($, e, next) => {
    if (!isOurTool(e.tool)) {
      return next(e)
    }

    // The tool's arguments sit flat next to `tool` in `e`.
    const {
      proposals: proposalsInput,
      remove: removeInput,
      language: languageInput,
      translation: translationInput,
    } = e as { proposals?: unknown; remove?: unknown; language?: unknown; translation?: unknown }
    const incoming = parseProposals(proposalsInput)
    const toRemove = new Set(
      (Array.isArray(removeInput) ? removeInput : []).filter((l): l is string => typeof l === 'string').map(cleanLabel),
    )

    try {
      await commitDrafts($)
      const languageSentence = await setLanguage($, languageCode(languageInput), translationInput)
      const [before, hidden] = await Promise.all([read($, rows), read($, hiddenLabels)])
      const { rows: keep, added, updated, removed, skipped } = mergeProposals(before, incoming, toRemove, hidden)
      await update($, rows, () => keep)

      const sentence = (head: string, labels: string[]) => (labels.length > 0 ? `${head}: ${labels.join(', ')}.` : '')
      const open = keep.map(row => row.p.label)
      const visible = await visibility($)
      return {
        result: [
          sentence('Added', added),
          sentence('Updated', updated),
          sentence('Removed', removed),
          sentence('Not shown, hidden earlier by the user', skipped),
          open.length > 0 ? `Now open in the bar: ${open.join(', ')}.` : 'The bar has no open decisions.',
          open.length > 0 ? visibilitySentence[visible] : '',
          languageSentence,
        ]
          .filter(s => s !== '')
          .join(' '),
      }
    } catch (error) {
      return { result: `The decisions could not be prepared: ${String(error)}` }
    }
  })

  // To another field or a button (Tab, arrows, click): what was typed is committed.
  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    const result = await next(e)
    if (e.element !== lastField) {
      await commitDrafts($).catch(() => undefined)
    }
    return result
  })
  // Typing in Claude Code's own input field is another action too.
  on('prompt.edit', async ($, e, next) => {
    if (lastField !== undefined) {
      await commitDrafts($).catch(() => undefined)
    }
    return next(e)
  })

  // A message of the user's own: the Restore row and what was typed in the bar are settled.
  on('prompt.submit', async ($, e, next) => {
    // The "hidden — Restore" row belongs to the moment of hiding; /decisions keeps working.
    await update($, lastHidden, last => (last && last.show ? { ...last, show: false } : last)).catch(() => undefined)
    await commitDrafts($).catch(() => undefined)
    return next(e)
  })

  // A group of tool calls folds into one line ("Used 2 tools"); one holding a decision box stays
  // open, so the box is visible without expanding the group. The terminal honours this; the
  // desktop app folds groups its own way, hence the instruction to call the tool on its own.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded || !e.props.calls.some(c => isOurTool(c.tool))) {
      return next(e)
    }
    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })

  // In the chat: the tool call's own row becomes a box with the decisions it proposed, drawn like
  // the bar's rows and sharing their state, so you can decide in context and scroll back later. A
  // decision that left the bar shows its sent answer, or "closed" when the bar no longer knows it.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!isOurTool(e.props.tool)) {
      return next(e)
    }
    drawnOn.add(e.surface)
    const input = e.props.input as { proposals?: unknown }
    const asked = parseProposals(input?.proposals)
    if (asked.length === 0) {
      return next(e)
    }
    const els = $.ui.resolve(e) as unknown as Elements
    const list = await read($, rows)
    const prefix = `chat-${e.props.tool_use_id}-`
    // Columns 0: the field takes its minimum width, so it stays on the row inside the box. A
    // transcript row takes no keys in the terminal, so there the remark is text, typed in the bar.
    const v = await rowView($, els, {
      surface: e.surface,
      rows: list,
      prefix,
      columns: 0,
      shown: asked,
      remarkAsText: e.surface === 'terminal',
    })
    const { Box, Button, Text, t } = v
    const done = await read($, sentDecisions)
    const doneRemarks = await read($, sentAnswerRemarks)
    const indexOf = (p: Proposal) => list.findIndex(row => rowKey(row.p) === rowKey(p))
    const openIndexes = asked.map(indexOf).filter(i => i >= 0)
    const openRows = openIndexes.map(i => v.current[i]!)
    const sendBox = async () => {
      if (!(await send($, openIndexes))) {
        $.ui.toast(t('nothingToSend'))
      }
    }
    return (
      <Box flexDirection="column" rowGap={1} borderStyle="round" paddingX={1}>
        <Box key={`${prefix}heading`} flexDirection="row" columnGap={1}>
          <Text key={`${prefix}title`} bold>
            {t('heading')}
          </Text>
          <Text key={`${prefix}tally`} dimColor>
            {headingTally(t, openRows)}
          </Text>
        </Box>
        {asked.map((p, k) => {
          const i = indexOf(p)
          if (i >= 0) {
            return decisionRow(v, list[i]!.p, i)
          }
          const answer = done[rowKey(p)]
          return (
            <Box key={`${prefix}closed-${k}`} flexDirection="row" alignItems="flex-start" columnGap={1}>
              <Box key={`${prefix}closed-label-box-${k}`} width={v.labelWidth} flexShrink={0}>
                <Text key={`${prefix}closed-label-${k}`} bold dimColor>
                  {breakLongWords(p.label, v.labelWidth - 1, v.roomy)}
                </Text>
              </Box>
              <Box key={`${prefix}closed-text-box-${k}`} flexDirection="column" flexGrow={1} flexShrink={1}>
                <Text key={`${prefix}closed-text-${k}`} dimColor>
                  {p.text}
                </Text>
                <Text key={`${prefix}closed-answer-${k}`} dimColor>
                  {answer === 'agree'
                    ? `✓ ${t('agree')}`
                    : answer === 'disagree'
                      ? `✗ ${t('disagree')}`
                      : (answer ?? t('closed'))}
                </Text>
                {answer && doneRemarks[rowKey(p)] && (
                  <Text key={`${prefix}closed-remark-${k}`} dimColor>
                    {`${INDENT}${doneRemarks[rowKey(p)]}`}
                  </Text>
                )}
              </Box>
            </Box>
          )
        })}
        {openIndexes.length > 0 && (
          <Box key={`${prefix}actions`} flexDirection="row" columnGap={1}>
            <Button
              key={`${prefix}send-box`}
              label={t(openIndexes.length === 1 ? 'sendOne' : 'sendAll')}
              variant="primary"
              onPress={() => void sendBox()}
            />
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Asked to draw the band, also while it is empty: the bar can be seen on this surface.
    drawnOn.add(e.surface)
    const list = await read($, rows)

    // Also visible while Claude works: a sent message then waits until the turn is done.
    const table = $.ui.resolve(e) as Elements
    if (list.length === 0) {
      const hidden = await read($, lastHidden)
      if (!hidden || !hidden.show || hidden.rows.length === 0) {
        return next(e)
      }
      return hiddenNotice($, table, translator(await read($, texts)), hidden.rows.length)
    }
    const v = await rowView($, table, { surface: e.surface, rows: list, prefix: '', columns: e.props.bodyColumns })
    return (await read($, collapsed)) ? collapsedBar($, v, e.props.bodyColumns) : expandedBar($, v)
  })
}
