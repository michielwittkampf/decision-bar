import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, LastHidden, Option, Proposal } from '../types'

const TOOL = 'decisions'
const TOOL_FULL = 'mcp__decision-bar__decisions'
const COMMAND = 'decisions'

const proposals = atom({ plugin: 'decision-bar', key: 'proposals' } as const, [] as Proposal[])
// Per proposal, at the same index: agree, disagree, or nothing yet (null, the default).
const decisions = atom({ plugin: 'decision-bar', key: 'decisions' } as const, [] as Decision[])
const remarks = atom({ plugin: 'decision-bar', key: 'remarks' } as const, [] as string[])
// The last remark sent per open decision (key: `rowKey(p)`): a confirmation in the row, and the
// same remark is not sent twice.
const sentRemarks = atom({ plugin: 'decision-bar', key: 'sentRemarks' } as const, {} as Record<string, string>)
// Labels the user dismissed with Hide: a later call does not bring them back.
const hiddenLabels = atom({ plugin: 'decision-bar', key: 'hiddenLabels' } as const, [] as string[])
// The last hidden set, to restore; `show` is the row with the Restore button.
const lastHidden = atom({ plugin: 'decision-bar', key: 'lastHidden' } as const, null as LastHidden | null)
const collapsed = atom({ plugin: 'decision-bar', key: 'collapsed' } as const, false)
// Proposals (`rowKey`) whose field is being edited: their full-remark line is struck through,
// as visibly stale text next to the field.
const editing = atom({ plugin: 'decision-bar', key: 'editing' } as const, [] as string[])
// The decision sent per proposal (`rowKey`), so its box in the chat can show what was answered.
const sentDecisions = atom({ plugin: 'decision-bar', key: 'answered' } as const, {} as Record<string, 'agree' | 'disagree'>)
// The remark sent with that decision, if any, shown under it in the box.
const sentAnswerRemarks = atom({ plugin: 'decision-bar', key: 'answeredRemarks' } as const, {} as Record<string, string>)

// The bar's own texts. Only English is built in; any other chat language gets them once from
// Claude (`translation` in the tool) and the mod keeps them per language in `$.store`.
// `{name}` is filled in; a translation must keep the same `{names}`.
const EN = {
  heading: 'Decisions',
  question: 'Question',
  agree: 'agree',
  disagree: 'disagree',
  open: '{n} open',
  chosen: '{n} chosen',
  decided: '{n} decided',
  and: 'and',
  remarkField: 'remark (optional)',
  answerField: 'or type your own answer',
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
  nothingToSendAnswer: 'Nothing to send: type an answer first.',
  nothingToSendDecision: 'Nothing to send: choose agree or disagree, or type a remark.',
  messageDecision: '{label} {decision}: {proposal}',
  undecided: '{label} (no decision yet)',
  messageRemark: 'Remark: {remark}',
  messageQuestion: 'On your question "{question}": {answer}',
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

// "nl-BE", "NL" and "nl_nl" are all "nl".
const languageCode = (input: unknown) =>
  typeof input === 'string' && input.trim() !== '' ? input.trim().toLowerCase().split(/[-_]/)[0]! : undefined

// A translation from Claude: only known keys with a text and the same {placeholders}.
const checkTranslation = (input: unknown) => {
  const accepted: Record<string, string> = {}
  const rejected: string[] = []
  if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input)) {
      if (!(k in EN)) {
        continue
      }
      if (typeof v === 'string' && v.trim() !== '' && placeholders(v) === placeholders(EN[k as TextKey])) {
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

const rowKey = (p: Proposal) => `${p.label}\u0000${p.text}`

// What is typed in a remark field, per proposal (`rowKey`). Deliberately not in `$.state`: every
// write there redraws the bar, and a redrawn field is handed its text again (`value`), which made
// the field flicker on every keystroke and jump back to the start of the text. Committed to
// `remarks` on any other action (`commitDrafts`); a reload of the mod loses only uncommitted typing.
let drafts = new Map<string, string>()
// The field (`key`) last typed in: focus moving there is not another action.
let lastField: string | undefined
// The surfaces on which the app asked this mod itself to draw its bar or a chat box. Not that the
// session has a surface (`$.session.surfaces()` lists every client, also one there for another
// mod's pane or another feature), but that this mod's own drawing was asked there: a side chat in
// the desktop app runs the mod but never asks it to draw.
let drawnOn = new Set<string>()

// Whether the user can see the bar now: this mod drew on a surface that is still attached. Where
// the engine cannot say which surfaces are attached, assume it can.
const isVisible = async ($: EngineInterface) => {
  const attached = await $.session.surfaces().catch(() => undefined)
  return attached === undefined || attached.some(s => drawnOn.has(s))
}
const NOT_VISIBLE =
  'Not visible: this session has not drawn the bar or a decision box (for example a side chat in the desktop app), so the user cannot see them. Ask these decisions in your reply as well, with the same labels, and do not say they are in the bar. They stay in the bar in case it appears; remove them with `remove` once answered.'
const currentRemarks = (list: Proposal[], stored: string[]) =>
  list.map((p, i) => drafts.get(rowKey(p)) ?? stored[i] ?? '')
const commitDrafts = async ($: EngineInterface) => {
  lastField = undefined
  if (drafts.size > 0) {
    const [list, stored] = await Promise.all([read($, proposals), read($, remarks)])
    const now = currentRemarks(list, stored)
    drafts.clear()
    await update($, remarks, () => now)
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

// Decided is agree / disagree, or a typed answer to a question; the rest is open. Remarks count
// only on decisions: on a question the text is the answer itself.
const tally = (list: Proposal[], dec: Decision[], rem: string[]) => {
  const decided = list.filter((p, i) => (p.options ? !!rem[i]?.trim() : (dec[i] ?? null) !== null)).length
  const withRemark = list.filter((p, i) => !p.options && !!rem[i]?.trim()).length
  return { open: list.length - decided, decided, withRemark }
}

// Expanded, in the heading: "4 open · 3 chosen"; a count of zero is left out.
const headingTally = (t: Translate, list: Proposal[], dec: Decision[], rem: string[]) => {
  const { open, decided } = tally(list, dec, rem)
  return [open > 0 ? t('open', { n: open }) : '', decided > 0 ? t('chosen', { n: decided }) : '']
    .filter(Boolean)
    .join(SEPARATOR)
}

// Collapsed and narrow: "1 open and 2 decided · 2 ✎"; a count of zero is left out.
const miniSummary = (t: Translate, list: Proposal[], dec: Decision[], rem: string[]) => {
  const { open, decided, withRemark } = tally(list, dec, rem)
  const parts = [open > 0 ? t('open', { n: open }) : '', decided > 0 ? t('decided', { n: decided }) : ''].filter(
    Boolean,
  )
  return parts.join(` ${t('and')} `) + (withRemark > 0 ? `${SEPARATOR}${withRemark} ✎` : '')
}

const INSTRUCTIONS = [
  '# Decision bar',
  `When you ask the user for one or more decisions you propose (for example decision point C13, or "shall I do X?"), put them in the bar above the input field with ${TOOL_FULL} at the end of your turn.`,
  '- `language`: the language of the chat as an ISO 639-1 code (en, nl, de, …). The bar shows its own texts in that language; the answers come back in it too.',
  '- `label`: the short name of the decision, such as "C13" or "Order". No "agree" in it: the user picks agree or disagree.',
  '- `text`: the proposal in one sentence, complete enough to understand without your reply; the bar shows label and text, both in the chat language.',
  '- In your reply, use the same label, in bold, for each proposal, so the user can find the row in the bar.',
  'Each call draws a box with its decisions in the chat, so place it where you discuss them: several calls in one reply are fine, each after the text it belongs to. Always keep text between a call and any other tool call: the desktop app folds consecutive tool calls into a collapsed group, which hides the box.',
  'Only real open decisions: not what you already built or did, and not what the user already answered in the chat (a short "go" or "ok" counts).',
  'What is in the bar stays until the user sends or hides it, also while you chat. On a later call give only new or changed decisions: an existing label is updated, not duplicated. Remove a decision answered or overtaken in the chat with `remove: [label]`.',
  'A label the user hid does not come back; the tool result says which. Only ask about it again in your text when really needed.',
  'If the tool result starts a sentence with "Not visible", the user cannot see the bar in this session (for example a side chat in the desktop app): ask those decisions in your reply as well, with the same labels, and do not say they are in the bar.',
  'If the tool result asks for the bar texts in the chat language, call it again right away with `language` and `translation` as it says, before ending your turn.',
  'Bar language: the bar starts each session in English; after that it is the `language` of your last call in this session. Make a call with only `language` (it changes nothing but the language) only when the bar would show in the wrong language: (1) right before you end a turn with a question and answer buttons in the next-step box (the bar copies it) while the chat is not in the bar language, or (2) at the end of a turn in which the chat language changed while the bar has open rows. Otherwise no extra call.',
  'Answers arrive as "<label> <agree>: <proposal>", "<label> <disagree>: <proposal>" or "<label> (no decision yet)", with any remark on its own line below starting with "↳", in the bar language.',
  'This bar is the Claude Code mod `decision-bar`; if the user wants to change it, first read the README.md in its folder (behaviour, files, testing, pitfalls).',
].join('\n')

// One line (with any remark below it) per proposal; empty when there is nothing to report.
const messageLine = (t: Translate, p: Proposal, decision: Decision, remark: string | undefined) => {
  const r = remark?.trim() ?? ''
  if (p.options) {
    return r ? t('messageQuestion', { question: p.text, answer: r }) : ''
  }
  if (decision === null) {
    // The remark always goes on its own line, so it is never mistaken for the proposal.
    return r ? `${t('undecided', { label: p.label })}\n${INDENT}${t('messageRemark', { remark: r })}` : ''
  }
  const core = t('messageDecision', {
    label: p.label,
    decision: t(decision === 'agree' ? 'agree' : 'disagree'),
    proposal: p.text,
  })
  return r ? `${core}\n${INDENT}${t('messageRemark', { remark: r })}` : core
}

// The `proposals` argument of a tool call, as Claude sent it: entries without a label are left out,
// and a proposal without text shows its label.
const parseProposals = (input: unknown): Proposal[] =>
  (Array.isArray(input) ? input : [])
    .filter(
      (p): p is { label: string; text: string } =>
        typeof p?.label === 'string' && typeof p?.text === 'string' && p.label.trim() !== '',
    )
    .map(p => ({ label: p.label.trim(), text: p.text.trim() || p.label.trim() }))

// Hide: out of the bar, and the labels of the decisions remembered.
const hide = async ($: EngineInterface) => {
  await commitDrafts($)
  const [list, dec, rem] = await Promise.all([read($, proposals), read($, decisions), read($, remarks)])
  const labels = list.filter(p => !p.options).map(p => p.label)
  await update($, hiddenLabels, old => [...new Set([...old, ...labels])])
  await update($, lastHidden, () => ({
    rows: list.map((p, i) => ({ p, d: dec[i] ?? null, r: rem[i] ?? '' })),
    show: true,
  }))
  await clear($)
}

// Brings back the last hidden set, with choices and remarks as they were. What was added in the
// meantime stays; a label that is back already is not added twice.
const restore = async ($: EngineInterface): Promise<number> => {
  await commitDrafts($)
  const set = await read($, lastHidden)
  if (!set || set.rows.length === 0) {
    return 0
  }
  const [list, dec, rem] = await Promise.all([read($, proposals), read($, decisions), read($, remarks)])
  const now = list.map((p, i) => ({ p, d: dec[i] ?? null, r: rem[i] ?? '' }))
  const back = set.rows.filter(
    row => !now.some(n => (row.p.options ? n.p.options && n.p.text === row.p.text : !n.p.options && n.p.label === row.p.label)),
  )
  const merged = [
    ...back.filter(row => !row.p.options),
    ...now.filter(row => !row.p.options),
    ...[...back, ...now].filter(row => row.p.options),
  ]
  const labels = set.rows.map(row => row.p.label)
  await update($, hiddenLabels, old => old.filter(l => !labels.includes(l)))
  await update($, proposals, () => merged.map(row => row.p))
  await update($, decisions, () => merged.map(row => row.d))
  await update($, remarks, () => merged.map(row => row.r))
  await update($, lastHidden, () => null)
  return back.length
}

const clear = async ($: EngineInterface) => {
  drafts.clear()
  await update($, proposals, () => [])
  await update($, decisions, () => [])
  await update($, remarks, () => [])
  await update($, sentRemarks, () => ({}))
}

// Sends the lines for `indexes`. A proposal with a decision disappears; a proposal with only a
// remark stays open, without that remark.
const send = async ($: EngineInterface, indexes: number[], agreeToAll = false): Promise<boolean> => {
  await commitDrafts($)
  const list = await read($, proposals)
  const dec = agreeToAll ? list.map((p): Decision => (p.options ? null : 'agree')) : await read($, decisions)
  const rem = await read($, remarks)
  const sentBefore = await read($, sentRemarks)
  const t = await currentTranslator($)
  // Only a remark, and exactly that one was sent already: not again.
  const alreadySent = (i: number) => {
    const p = list[i]
    const r = rem[i]?.trim() ?? ''
    return !!p && !p.options && (dec[i] ?? null) === null && r !== '' && sentBefore[rowKey(p)] === r
  }
  const lines = indexes
    .filter(i => !alreadySent(i))
    .map(i => (list[i] ? messageLine(t, list[i], dec[i] ?? null, rem[i]) : ''))
    .filter(l => l !== '')
  if (lines.length === 0) {
    await update($, remarks, old => old.map((r, i) => (indexes.includes(i) ? '' : r)))
    return false
  }

  const sent = new Set(indexes)
  const answered = (i: number) => (dec[i] ?? null) !== null || (list[i]?.options !== undefined && !!rem[i]?.trim())
  const stays = (i: number) => !sent.has(i) || !answered(i)
  const keep = list.map((_, i) => i).filter(stays)
  await update($, proposals, () => keep.map(i => list[i]!))
  await update($, decisions, () => keep.map(i => dec[i] ?? null))
  await update($, remarks, () => keep.map(i => (sent.has(i) ? '' : (rem[i] ?? ''))))
  await update($, sentRemarks, old => {
    const remembered = { ...old }
    for (const i of keep) {
      const r = rem[i]?.trim() ?? ''
      if (sent.has(i) && r !== '') {
        remembered[rowKey(list[i]!)] = r
      }
    }
    return remembered
  })
  // Remember what was decided, so the decision's box in the chat can show it.
  await update($, sentDecisions, old => {
    const recorded: Record<string, 'agree' | 'disagree'> = { ...(old as Record<string, 'agree' | 'disagree'>) }
    for (const i of indexes) {
      const p = list[i]
      const d = dec[i] ?? null
      if (p && !p.options && d !== null) {
        recorded[rowKey(p)] = d
      }
    }
    return recorded
  })
  await update($, sentAnswerRemarks, old => {
    const recorded: Record<string, string> = { ...(old as Record<string, string>) }
    for (const i of indexes) {
      const p = list[i]
      const r = rem[i]?.trim() ?? ''
      if (p && !p.options && (dec[i] ?? null) !== null && r !== '') {
        recorded[rowKey(p)] = r
      }
    }
    return recorded
  })
  // A blank line between answers, so each stands on its own in the chat.
  await $.prompt.submit({ text: lines.join('\n\n') + TRAILER, asUser: true })
  return true
}

// An answer button of a question: sends that text (with the remark below it) and removes only
// that question.
const pickOption = async ($: EngineInterface, i: number, option: Option) => {
  await commitDrafts($)
  const rem = await read($, remarks)
  const r = rem[i]?.trim() ?? ''
  const t = await currentTranslator($)
  await update($, proposals, old => old.filter((_, j) => j !== i))
  await update($, decisions, old => old.filter((_, j) => j !== i))
  await update($, remarks, old => old.filter((_, j) => j !== i))
  await $.prompt.submit({
    text: (r ? `${option.text}\n${INDENT}${t('messageRemark', { remark: r })}` : option.text) + TRAILER,
    asUser: true,
  })
}

// The question and answer buttons from the desktop app's next-step box (wrap_up). Buttons that
// are an app action (commit, PR, ...) have no text and are left out.
const questionFromWrapUp = (e: object): Proposal | null => {
  const { ask, actions } = e as { ask?: unknown; actions?: unknown }
  if (typeof ask !== 'string' || ask.trim() === '' || !Array.isArray(actions)) {
    return null
  }
  const options = actions
    .filter(a => a && typeof a === 'object' && !('action' in a && a.action))
    .map(a => a as { label?: unknown; message?: unknown })
    .filter(a => typeof a.label === 'string' && a.label.trim() !== '')
    .map(a => ({
      label: (a.label as string).trim(),
      text: typeof a.message === 'string' && a.message.trim() ? a.message.trim() : (a.label as string).trim(),
    }))
  return options.length > 0 ? { label: 'Question', text: ask.trim(), options } : null
}

// The language of a call: sets the bar's texts, keeps a translation that came with it alongside
// the earlier ones, and asks Claude for what is still missing. Returns the tool result sentence.
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
  const merged = { ...stored, ...accepted }
  if (Object.keys(accepted).length > 0) {
    await $.store.set(storeKey(code), merged)
  }
  await update($, texts, () => merged)

  const missing = (Object.keys(EN) as TextKey[]).filter(k => !(k in merged))
  return [
    rejected.length > 0
      ? `Not used from translation (empty, or other {placeholders} than asked): ${rejected.join(', ')}.`
      : '',
    missing.length > 0
      ? `The bar shows English where it has no "${code}" texts yet. Call ${TOOL_FULL} again now with language "${code}" and translation: these texts translated into that language, same keys, {placeholders} and symbols unchanged (no proposals needed): ${JSON.stringify(Object.fromEntries(missing.map(k => [k, EN[k]])))}`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// The elements of one surface, as `$.ui.resolve` hands them out (the same for the bar and a
// chat row); `Input` is missing on mobile.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Elements = { Box: any; Button: any; Text: any; Input?: any }

// What the bar and the chat boxes share to draw decision rows: the elements, the state and the
// handlers, with element keys under `prefix` so the bar's and each box's elements stay apart.
// `shown` is what the label column is sized for: a chat box shows its own proposals, also when
// they have all left the bar and `list` is empty. `remarkAsText`: no field, the remark as plain
// text (a chat box in the terminal, where only the bar and panes take keys).
const rowView = async (
  $: EngineInterface,
  els: Elements,
  surface: string,
  list: Proposal[],
  prefix: string,
  columns: number,
  shown: Proposal[] = list,
  remarkAsText = false,
) => {
  const { Box, Button, Text } = els
  const Input = remarkAsText ? undefined : els.Input
  const t = translator(await read($, texts))
  const dec = await read($, decisions)
  const stored = await read($, remarks)
  const rem = currentRemarks(list, stored)
  const sent = await read($, sentRemarks)
  const beingEdited = await read($, editing)
  // The line shows the last committed text; while the field is edited it is struck through:
  // visibly stale, until the next action updates it.
  const showFull = (i: number) => (stored[i]?.trim().length ?? 0) > LONG_REMARK
  const isStale = (p: Proposal) => beingEdited.includes(rowKey(p))

  // Typing does not redraw (see `drafts`); only clearing "✓ remark sent" or striking through the
  // full remark does, once.
  const setRemark = async (i: number, text: string) => {
    const p = list[i]
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
    if ((stored[i]?.trim().length ?? 0) > LONG_REMARK && !beingEdited.includes(rowKey(p))) {
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
      $.ui.toast(list[i]?.options ? t('nothingToSendAnswer') : t('nothingToSendDecision'))
    }
  }
  // Pressing the chosen state again sets it back to "no decision".
  const choose = (i: number, decision: Exclude<Decision, null>) =>
    commitDrafts($).then(() =>
      update($, decisions, old => {
        const choices = list.map((_, j) => old[j] ?? null)
        choices[i] = choices[i] === decision ? null : decision
        return choices
      }),
    )

  // In the terminal every line costs room above the prompt; elsewhere there is space to breathe.
  const roomy = surface !== 'terminal'
  // A question from the next-step box is called "Question" in the bar's language.
  const shownLabel = (p: Proposal) => (p.options ? t('question') : p.label)
  // Labels in one column of equal width, so buttons and fields line up. At most 14 cells: a
  // longer label wraps onto two lines (top-aligned), leaving the room to proposal and field.
  const labelWidth = Math.min(14, Math.max(0, ...shown.map(p => [...shownLabel(p)].length)) + 2)
  // A word longer than the column is broken with a hyphen. Outside the terminal soft hyphens let
  // the app break only where proportional text really needs it; the terminal gets hard breaks.
  const labelText = (p: Proposal) => breakLongWords(shownLabel(p), labelWidth - 1, roomy)
  // The field as wide as the line allows next to the buttons before it and "send" after it. The
  // desktop app draws an Input at its own width; this only takes effect in the terminal.
  const fieldWidth = (buttons: string[]) =>
    Math.max(
      20,
      columns - (roomy ? 1 : 0) - (labelWidth + 1) - [...buttons, t('send')].reduce((sum, b) => sum + buttonWidth(b), 0) - 1,
    )
  return {
    Box, Button, Text, Input, t, prefix, dec, stored, rem, sent, showFull, isStale,
    setRemark, keepAndSend, choose, roomy, labelText, labelWidth, fieldWidth, remarkAsText,
  }
}
type RowView = Awaited<ReturnType<typeof rowView>>

// One decision row: label, proposal, agree / disagree, remark field and its full text below.
const decisionRow = (v: RowView, p: Proposal, i: number) => {
  const { Box, Button, Text, Input, t, prefix: k, dec, rem, sent, stored, showFull, isStale } = v
  return (
    // Outside the terminal some air around the buttons, and clearly more between rows.
    <Box key={`${k}row-${i}`} flexDirection="column" rowGap={v.roomy ? 1 : 0} marginTop={v.roomy && i > 0 ? 1 : 0}>
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
      <Box
        key={`${k}choice-${i}`}
        flexDirection="row"
        alignItems="center"
        flexWrap="wrap"
        columnGap={1}
        marginLeft={v.labelWidth + 1}
      >
        <Button
          key={`${k}agree-${i}`}
          label={`${dec[i] === 'agree' ? '●' : '○'} ${t('agree')}`}
          variant={dec[i] === 'agree' ? 'primary' : 'secondary'}
          onPress={() => v.choose(i, 'agree')}
        />
        <Button
          key={`${k}disagree-${i}`}
          label={`${dec[i] === 'disagree' ? '●' : '○'} ${t('disagree')}`}
          variant={dec[i] === 'disagree' ? 'primary' : 'secondary'}
          onPress={() => v.choose(i, 'disagree')}
        />
        {Input && (
          <Box key={`${k}field-${i}`} flexGrow={1} minWidth={20} width={v.fieldWidth([`○ ${t('agree')}`, `○ ${t('disagree')}`])}>
            <Input
              key={`${k}remark-${i}`}
              placeholder={t('remarkField')}
              value={rem[i] ?? ''}
              // Enter or the button: send only this row; the rest stays.
              submitLabel={t('send')}
              onInput={(text: string) => void v.setRemark(i, text)}
              onSubmit={(text: string) => void v.keepAndSend(i, text)}
            />
          </Box>
        )}
        {v.remarkAsText && rem[i]?.trim() && (
          <Text key={`${k}remark-text-${i}`} dimColor>
            {`✎ ${rem[i]!.trim()}`}
          </Text>
        )}
        {sent[rowKey(p)] !== undefined && !rem[i]?.trim() && (
          <Text key={`${k}sent-${i}`} dimColor>
            {t('remarkSent')}
          </Text>
        )}
      </Box>
      {showFull(i) && !v.remarkAsText && (
        <Box key={`${k}full-${i}`} marginLeft={v.labelWidth + 1}>
          <Text key={`${k}full-remark-${i}`} dimColor strikethrough={isStale(p)}>
            {stored[i]}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export const register: Register = on => {
  drafts = new Map()
  lastField = undefined
  drawnOn = new Set()

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: TOOL,
      description:
        "Puts a row per proposed decision (label and proposal) above the user's input field, with agree / disagree and a remark field. An existing label is updated; `remove` removes decisions answered in the chat.",
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

  on('command.run', { command: COMMAND }, async $ => {
    const count = await restore($)
    const t = await currentTranslator($)
    return { text: count > 0 ? t('commandRestored', { n: count }) : t('commandEmpty') }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      sections: [...composed.sections, { id: 'decision-bar:instructions', text: INSTRUCTIONS, scope: 'session' }],
    }
  })

  // No matcher on the exact name: the engine may report the tool with a prefix.
  on('tool.call', async ($, e, next) => {
    if (e.tool.includes('ccd_turn') && e.tool.endsWith('__wrap_up')) {
      // The previous mirrored question makes way for the new one; decisions stay.
      const question = questionFromWrapUp(e)
      if (question) {
        await commitDrafts($).catch(() => undefined)
        await Promise.all([read($, proposals), read($, decisions), read($, remarks)])
          .then(async ([list, dec, rem]) => {
            const keep = list.map((_, i) => i).filter(i => !list[i]!.options)
            await update($, proposals, () => [...keep.map(i => list[i]!), question])
            await update($, decisions, () => [...keep.map(i => dec[i] ?? null), null])
            await update($, remarks, () => [...keep.map(i => rem[i] ?? ''), ''])
          })
          .catch(() => undefined)
      }
      return next(e)
    }

    if (!(e.tool === TOOL_FULL || e.tool.endsWith(`decision-bar__${TOOL}`))) {
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
      (Array.isArray(removeInput) ? removeInput : []).filter((l): l is string => typeof l === 'string').map(l => l.trim()),
    )

    try {
      await commitDrafts($)
      const languageSentence = await setLanguage($, languageCode(languageInput), translationInput)
      const [list, dec, rem, hidden] = await Promise.all([
        read($, proposals),
        read($, decisions),
        read($, remarks),
        read($, hiddenLabels),
      ])
      const skipped = incoming.filter(p => hidden.includes(p.label)).map(p => p.label)
      const admitted = incoming.filter(p => !hidden.includes(p.label))

      // Existing rows keep their choice and remark; an updated proposal (other text) starts again
      // without a decision. New labels are added, before a mirrored question.
      type Row = { p: Proposal; d: Decision; r: string }
      const before: Row[] = list.map((p, i) => ({ p, d: dec[i] ?? null, r: rem[i] ?? '' }))
      // `remove` takes out rows that were in the bar; a label proposed in this same call stays.
      const removed = before.filter(row => !row.p.options && toRemove.has(row.p.label)).map(row => row.p.label)
      const rows = before.filter(row => row.p.options || !toRemove.has(row.p.label))
      const updated: string[] = []
      const added: string[] = []
      for (const p of admitted) {
        const existing = rows.find(row => !row.p.options && row.p.label === p.label)
        if (existing) {
          if (existing.p.text !== p.text) {
            existing.p = p
            existing.d = null
            updated.push(p.label)
          }
        } else {
          added.push(p.label)
          const at = rows.findIndex(row => row.p.options)
          rows.splice(at === -1 ? rows.length : at, 0, { p, d: null, r: '' })
        }
      }
      const decisionRows = rows.filter(row => !row.p.options)
      // No limit: a decision only leaves the bar when it is sent, hidden or removed.
      const keep = [...decisionRows, ...rows.filter(row => row.p.options)]

      await update($, proposals, () => keep.map(row => row.p))
      await update($, decisions, () => keep.map(row => row.d))
      await update($, remarks, () => keep.map(row => row.r))

      const sentence = (head: string, labels: string[]) => (labels.length > 0 ? `${head}: ${labels.join(', ')}.` : '')
      const open = keep.filter(row => !row.p.options).map(row => row.p.label)
      const visible = await isVisible($)
      return {
        result: [
          sentence('Added', added),
          sentence('Updated', updated),
          sentence('Removed', removed),
          sentence('Not shown, hidden earlier by the user', skipped),
          open.length > 0 ? `Now open in the bar: ${open.join(', ')}.` : 'The bar has no open decisions.',
          open.length > 0 && !visible ? NOT_VISIBLE : '',
          languageSentence,
        ]
          .filter(s => s !== '')
          .join(' '),
      }
    } catch (error) {
      return { result: `The decisions could not be set up: ${String(error)}` }
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

  // Answered in the app's own box: the message is exactly the text of one of the answer buttons.
  // Then the mirrored question no longer belongs in the bar.
  on('prompt.submit', async ($, e, next) => {
    // The "hidden — Restore" row belongs to the moment of hiding; /decisions keeps working.
    await update($, lastHidden, set => (set && set.show ? { ...set, show: false } : set)).catch(() => undefined)
    await commitDrafts($).catch(() => undefined)
    const text = e.text.trim()
    await read($, proposals)
      .then(async list => {
        const answered = list.map((p, i) => (p.options?.some(o => o.text === text) ? i : -1)).filter(i => i >= 0)
        if (answered.length === 0) {
          return
        }
        const stays = (_: unknown, i: number) => !answered.includes(i)
        await update($, proposals, old => old.filter(stays))
        await update($, decisions, old => old.filter(stays))
        await update($, remarks, old => old.filter(stays))
      })
      .catch(() => undefined)

    return next(e)
  })

  // A group of tool calls folds into one line ("Used 2 tools"); one holding a decision box stays
  // open, so the box is visible without expanding the group. The terminal honours this; the
  // desktop app folds groups its own way, hence the instruction to call the tool on its own.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const isOurs = (tool: string) => tool === TOOL_FULL || tool.endsWith(`decision-bar__${TOOL}`)
    if (e.props.isExpanded || !e.props.calls.some(c => isOurs(c.tool))) {
      return next(e)
    }
    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })

  // In the chat: the tool call's own row becomes a box with the decisions it proposed, drawn like
  // the bar's rows and sharing their state, so you can decide in context and scroll back later. A
  // decision that left the bar shows its sent answer, or "closed" when the bar no longer knows it.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(e.props.tool === TOOL_FULL || e.props.tool.endsWith(`decision-bar__${TOOL}`))) {
      return next(e)
    }
    drawnOn.add(e.surface)
    const input = e.props.input as { proposals?: unknown }
    const asked = parseProposals(input?.proposals)
    if (asked.length === 0) {
      return next(e)
    }
    const els = $.ui.resolve(e) as unknown as Elements
    const list = await read($, proposals)
    const prefix = `chat-${e.props.tool_use_id}-`
    // Columns 0: the field takes its minimum width, so it stays on the row inside the box. A
    // transcript row takes no keys in the terminal, so there the remark is text, typed in the bar.
    const v = await rowView($, els, e.surface, list, prefix, 0, asked, e.surface === 'terminal')
    const { Box, Button, Text, t } = v
    const done = await read($, sentDecisions)
    const doneRemarks = await read($, sentAnswerRemarks)
    const indexOf = (p: Proposal) => list.findIndex(o => !o.options && rowKey(o) === rowKey(p))
    const openIndexes = asked.map(indexOf).filter(i => i >= 0)
    const openList = openIndexes.map(i => list[i]!)
    const openDec = openIndexes.map(i => v.dec[i] ?? null)
    const openRem = openIndexes.map(i => v.rem[i] ?? '')
    const sendBox = async () => {
      if (!(await send($, openIndexes))) {
        $.ui.toast(t('nothingToSendDecision'))
      }
    }
    return (
      <Box flexDirection="column" rowGap={1} borderStyle="round" paddingX={1}>
        <Box key={`${prefix}heading`} flexDirection="row" columnGap={1}>
          <Text key={`${prefix}title`} bold>
            {t('heading')}
          </Text>
          <Text key={`${prefix}tally`} dimColor>
            {headingTally(t, openList, openDec, openRem)}
          </Text>
        </Box>
        {asked.map((p, k) => {
          const i = indexOf(p)
          if (i >= 0) {
            return decisionRow(v, list[i]!, i)
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
                  {answer === 'agree' ? `✓ ${t('agree')}` : answer === 'disagree' ? `✗ ${t('disagree')}` : t('closed')}
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
    const list = await read($, proposals)

    // Also visible while Claude works (a sent message then waits until the turn is done) and while
    // the app holds the spot (`hasSurvey`): otherwise the bar disappears the moment the next-step
    // box appears, which is exactly when it is needed.
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const t = translator(await read($, texts))

    if (list.length === 0) {
      const set = await read($, lastHidden)
      if (!set || !set.show || set.rows.length === 0) {
        return next(e)
      }
      const n = set.rows.length
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

    const v = await rowView($, table as Elements, e.surface, list, '', e.props.bodyColumns)
    const { Input, dec, stored, rem, showFull, isStale, setRemark, keepAndSend, roomy, labelWidth, labelText, fieldWidth } = v
    const hasDecisions = list.some(p => !p.options)
    const all = list.map((_, i) => i)
    // With one row no "all": you would look for what else goes along.
    const sendLabel = t(list.length === 1 ? 'sendOne' : 'sendAll')
    const agreeLabel = t(list.filter(p => !p.options).length === 1 ? 'agreeOne' : 'agreeAll')
    const hasSomething = all.some(i => (dec[i] ?? null) !== null || rem[i]?.trim())
    const isCollapsed = await read($, collapsed)

    // Per row its state: ✓ agree / ✗ disagree / ○ nothing yet, ✎ with a remark.
    const summary = list
      .map((p, i) => {
        const pen = rem[i]?.trim() ? ' ✎' : ''
        if (p.options) {
          return `${t('question')}${pen}`
        }
        const state = dec[i] === 'agree' ? '✓' : dec[i] === 'disagree' ? '✗' : '○'
        return `${p.label} ${state}${pen}`
      })
      .join(SEPARATOR)
    // If the summary does not fit in two lines next to the buttons, only the counts. Outside the
    // terminal text is narrower than a cell: about 30% more fits on a line there.
    const room =
      (e.props.bodyColumns - buttonWidth(`${CLOSED} ${t('heading')}`) - (hasSomething ? buttonWidth(sendLabel) : 0)) *
      (roomy ? 1.3 : 1)
    const collapsedLines = (text: string) => (e.props.bodyColumns > 0 ? lineCount(text, room) : 1)
    const toggle = () => commitDrafts($).then(() => update($, collapsed, c => !c))
    // Expanded, "Send all" is always there: typing a remark alone does not redraw the bar, so the
    // button would otherwise appear only after another action.
    const sendAll = async () => {
      if (!(await send($, all))) {
        $.ui.toast(t('nothingToSendDecision'))
      }
    }

    if (isCollapsed) {
      return (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Button key="toggle" label={`${CLOSED} ${t('heading')}`} onPress={toggle} />
          <Box key="summary-box" flexGrow={1} flexShrink={1}>
            <Text key="summary" dimColor>
              {collapsedLines(summary) > 2 ? miniSummary(t, list, dec, rem) : summary}
            </Text>
          </Box>
          {hasSomething && (
            <Button key="send-all" label={sendLabel} variant="primary" onPress={() => send($, all)} />
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box key="heading" flexDirection="row" alignItems="center" columnGap={1}>
          <Button key="toggle" label={`${OPENED} ${t('heading')}`} plain onPress={toggle} />
          <Text key="tally" dimColor>
            {headingTally(t, list, dec, rem)}
          </Text>
        </Box>
        {/* Outside the terminal the chevron sits a little to the right because of the button's
            border: the content moves one cell along so it lines up below it. */}
        <Box key="content" flexDirection="column" rowGap={1} marginLeft={roomy ? 1 : 0}>
          {list.map((p, i) =>
            p.options ? (
              // Same columns as the decisions: "Question" in the label column, the question next to
              // it, and the answers below, indented to under the question.
              <Box key={`row-${i}`} flexDirection="column" rowGap={1} marginTop={i > 0 ? 1 : 0}>
                <Box key={`top-${i}`} flexDirection="row" alignItems="flex-start" columnGap={1}>
                  <Box key={`label-box-${i}`} width={labelWidth} flexShrink={0}>
                    <Text key={`label-${i}`} bold>
                      {labelText(p)}
                    </Text>
                  </Box>
                  <Box key={`question-box-${i}`} flexGrow={1} flexShrink={1}>
                    <Text key={`question-${i}`}>{p.text}</Text>
                  </Box>
                </Box>
                <Box
                  key={`options-${i}`}
                  flexDirection="row"
                  alignItems="center"
                  flexWrap="wrap"
                  columnGap={1}
                  marginLeft={labelWidth + 1}
                >
                  {p.options.map((o, k) => (
                    <Button
                      key={`option-${i}-${k}`}
                      label={o.label}
                      variant={k === 0 ? 'primary' : 'secondary'}
                      onPress={() => pickOption($, i, o)}
                    />
                  ))}
                  {Input && (
                    <Box key={`field-${i}`} flexGrow={1} minWidth={20} width={fieldWidth(p.options.map(o => o.label))}>
                      <Input
                        key={`remark-${i}`}
                        placeholder={t('answerField')}
                        value={rem[i] ?? ''}
                        submitLabel={t('send')}
                        onInput={(text: string) => void setRemark(i, text)}
                        onSubmit={(text: string) => void keepAndSend(i, text)}
                      />
                    </Box>
                  )}
                </Box>
                {showFull(i) && (
                  <Box key={`full-${i}`} marginLeft={labelWidth + 1}>
                    <Text key={`full-remark-${i}`} dimColor strikethrough={isStale(p)}>
                      {stored[i]}
                    </Text>
                  </Box>
                )}
              </Box>
            ) : (
              decisionRow(v, p, i)
            ),
          )}
          <Box key="actions" flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
            <Button key="send-all" label={sendLabel} variant="primary" onPress={() => void sendAll()} />
            {hasDecisions && <Button key="agree-all" label={agreeLabel} onPress={() => send($, all, true)} />}
            <Button key="hide" label={t('hide')} role="dismiss" onPress={() => hide($)} />
          </Box>
        </Box>
      </Box>
    )
  })
}
