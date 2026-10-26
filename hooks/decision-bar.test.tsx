import { expect, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import type { Row } from '../types'
import { instructions, mergeProposals, withoutQuestions } from './register'

const BAND = {
  plugin: 'decision-bar',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
  } as unknown as RenderPropsOf['AbovePrompt'],
} as const

const TOOL = 'mcp__decision-bar__decisions'
const EN = { language: 'en' }
const S = '  ·  '

// A full Dutch translation as Claude would supply it, for the language tests.
const NL = {
  heading: 'Beslissingen',
  agree: 'akkoord',
  disagree: 'niet akkoord',
  open: '{n} open',
  chosen: '{n} gekozen',
  decided: '{n} gemaakt',
  and: 'en',
  remarkField: 'opmerking (optioneel)',
  send: 'verstuur',
  remarkSent: '✓ opmerking verstuurd',
  sendAll: 'Verstuur alles',
  sendOne: 'Verstuur',
  agreeAll: 'Alles akkoord',
  agreeOne: 'Akkoord',
  hide: 'Verberg',
  hiddenOne: '1 beslissing verborgen',
  hiddenMany: '{n} beslissingen verborgen',
  restoreLater: '(later terug met /{command})',
  restore: 'Terughalen',
  close: 'Sluiten',
  closed: 'gesloten',
  chooseAnswer: 'kies een antwoord',
  nothingToSend: 'Niets te versturen: kies een antwoord, of typ een opmerking.',
  messageDecision: '{label} {decision}: {proposal}',
  undecided: '{label} (nog geen beslissing)',
  messageRemark: 'Opmerking: {remark}',
  commandRestored: '{n} beslissing(en) staan weer boven het invoerveld.',
  commandEmpty: 'Er zijn geen verborgen beslissingen om terug te halen.',
}

const PROPOSALS = [
  { label: 'T1', text: 'tea on Tuesday' },
  { label: 'T2', text: 'orange penguin' },
  { label: 'T3', text: 'four legs' },
]

// What sits below the plugin: an empty band, and a prompt.submit that catches what is sent.
let raw: string[] = []
const setup = (on: On) => {
  const sent: string[] = []
  raw = []
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="empty" />
  })
  on('prompt.submit', (_$, e) => {
    // Every message from the bar ends with one line break (see TRAILER); compared without it.
    sent.push(e.text.endsWith('\n') ? e.text.slice(0, -1) : e.text)
    raw.push(e.text)
    return { text: e.text }
  })
  // Storage across sessions ($.store), which the test kit does not have itself.
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  // Stands in for the desktop app, which answers wrap_up itself.
  on('tool.call', () => ({ result: 'ok' }))
  return sent
}

test('no decision by default; agree and disagree exclude each other, on terminal and desktop', async ($, on) => {
  setup(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ key: 'agree-0' }))?.text).toContain('○')
    expect((await ui.find({ key: 'disagree-0' }))?.text).toContain('○')
    expect(await ui.find({ key: 'send-all' })).toBeDefined()

    await ui.press({ key: 'agree-0' })
    await ui.redraw()
    expect((await ui.find({ key: 'agree-0' }))?.text).toContain('●')

    await ui.press({ key: 'disagree-0' })
    await ui.redraw()
    expect((await ui.find({ key: 'agree-0' }))?.text).toContain('○')
    expect((await ui.find({ key: 'disagree-0' }))?.text).toContain('●')

    // Press again: back to no decision.
    await ui.press({ key: 'disagree-0' })
    await ui.redraw()
    expect((await ui.find({ key: 'disagree-0' }))?.text).toContain('○')
    await ui.unmount()
  }
})

test('"Send all" sends decisions and remarks; undecided rows stay', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'agree-0' })
  await ui.press({ key: 'disagree-1' })
  await ui.input({ key: 'remark-1', text: 'rather purple', kind: 'change' })
  await ui.input({ key: 'remark-2', text: 'why four?', kind: 'change' })
  await ui.redraw()
  await ui.press({ key: 'send-all' })

  expect(sent).toEqual([
    'T1 agree: tea on Tuesday\n\nT2 disagree: orange penguin\n↳ Remark: rather purple\n\nT3 (no decision yet)\n↳ Remark: why four?',
  ])

  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^T3$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^T1$/ })).toBeUndefined()
  expect(await ui.find({ key: 'send-all' })).toBeDefined()
})

test('sending one row: only that row goes, the rest keeps its choice and remark', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'agree-2' })
  await ui.input({ key: 'remark-2', text: 'with felt pads', kind: 'change' })
  await ui.press({ key: 'disagree-1' })
  await ui.input({ key: 'remark-1', text: 'too bright' })
  expect(sent).toEqual(['T2 disagree: orange penguin\n↳ Remark: too bright'])

  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^T2$/ })).toBeUndefined()
  expect((await ui.find({ key: 'agree-1' }))?.text).toContain('●')

  await ui.press({ key: 'send-all' })
  expect(sent.at(-1)).toBe('T3 agree: four legs\n↳ Remark: with felt pads')
})

test('a remark without a decision on one row: the row stays open', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'remark-0', text: 'why tea?' })
  expect(sent).toEqual(['T1 (no decision yet)\n↳ Remark: why tea?'])

  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^T1$/ })).toBeDefined()
  expect((await ui.find({ key: 'remark-0' }))?.text ?? '').toBe('')
})

test('one row without a decision and without a remark sends nothing', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'remark-0', text: '' })
  expect(sent).toEqual([])
})

test('"Agree to all" agrees to everything, with the remarks', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'disagree-1' })
  await ui.input({ key: 'remark-2', text: 'with felt pads', kind: 'change' })
  await ui.press({ key: 'agree-all' })
  expect(sent).toEqual([
    'T1 agree: tea on Tuesday\n\nT2 agree: orange penguin\n\nT3 agree: four legs\n↳ Remark: with felt pads',
  ])
  await ui.redraw()
  expect(await ui.find({ key: 'agree-0' })).toBeUndefined()
})

test('a typed message leaves choices and remarks; also visible while Claude works', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, isWorking: true } })
  await ui.press({ key: 'agree-1' })
  // Like a typed message: only the text, the engine fills in the rest.
  await $.prompt.submit({ text: 'by the way' } as Parameters<typeof $.prompt.submit>[0])
  await ui.redraw()
  expect((await ui.find({ key: 'agree-1' }))?.text).toContain('●')
})

test('a repeated call keeps choices; a changed proposal starts over', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'agree-0' })
  await ui.press({ key: 'agree-1' })
  const res = await $.tool.call({
    tool: TOOL,
    ...EN,
    proposals: [PROPOSALS[0]!, { label: 'T2', text: 'purple penguin' }, { label: 'T4', text: 'new' }],
  })
  expect(String(res.result)).toContain('Updated: T2')
  expect(String(res.result)).toContain('Added: T4')
  await ui.redraw()
  expect((await ui.find({ key: 'agree-0' }))?.text).toContain('●')
  expect((await ui.find({ key: 'agree-1' }))?.text).toContain('○')
  expect(await ui.find({ type: 'Text', text: 'purple penguin' })).toBeDefined()
  // T3 was there already and stays; T4 comes after it.
  expect(await ui.find({ type: 'Text', text: /^T3$/ })).toBeDefined()
  expect(await ui.find({ key: 'agree-3' })).toBeDefined()
})

test('the bar shows the proposal itself, not only the label', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'tea on Tuesday' })).toBeDefined()
})

test('Hide remembers the labels: a later call does not bring them back', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'hide' })
  const res = await $.tool.call({ tool: TOOL, ...EN, proposals: [...PROPOSALS, { label: 'T4', text: 'new' }] })
  expect(String(res.result)).toContain('hidden earlier by the user: T1, T2, T3')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^T1$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^T4$/ })).toBeDefined()
})

test('remove takes out decisions answered in the chat', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const res = await $.tool.call({ tool: TOOL, ...EN, remove: ['T1', 'T3'] })
  expect(String(res.result)).toContain('Removed: T1, T3')
  expect(String(res.result)).toContain('Now open in the bar: T2')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^T1$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^T2$/ })).toBeDefined()
})

test('remove takes out only what was in the bar: a label proposed in the same call stays', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [PROPOSALS[0]!] })
  const res = await $.tool.call({
    tool: TOOL,
    ...EN,
    remove: ['T1', 'T2'],
    proposals: [{ label: 'T2', text: 'a new one with a used label' }],
  })
  expect(String(res.result)).toContain('Added: T2')
  expect(String(res.result)).toContain('Removed: T1.')
  expect(String(res.result)).toContain('Now open in the bar: T2')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'a new one with a used label' })).toBeDefined()
})

test('Hide removes everything without sending anything', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'agree-0' })
  await ui.press({ key: 'hide' })
  await ui.redraw()
  expect(await ui.find({ key: 'agree-0' })).toBeUndefined()
  expect(sent).toEqual([])
})

const WRAP_UP = {
  tool: 'mcp__ccd_turn__wrap_up' as const,
  recap: 'Done.',
  ask: 'Shall I commit it?',
  actions: [{ label: 'Yes, commit', message: 'Yes, commit it.' }, { label: 'No' }],
}

test("the next-step box's question stays out of the bar; the decisions stay", async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const res = await $.tool.call(WRAP_UP)
  // The call reaches the desktop app (here the stand-in) unchanged.
  expect(res.result).toBe('ok')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Shall I commit it?' })).toBeUndefined()
  expect(await ui.find({ key: 'agree-2' })).toBeDefined()
  expect(await ui.find({ key: 'agree-3' })).toBeUndefined()
})

test('Claude is told to leave the next-step question out while the bar has open decisions', async ($, on) => {
  // What sits below the plugin: an engine that composes no sections of its own.
  on('prompt.compose', () => ({ sections: [] }))
  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['desktop'],
    tools: [],
    outputStyle: null,
    traits: [],
  } as Parameters<typeof $.prompt.compose>[0])
  const text = composed.sections.map(sec => sec.text).join('\n')
  expect(text).toContain('leave `ask` and `actions` out of `wrap_up`')
})

test('a remark without a decision: confirmation in the row, and not sent twice', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'remark-2', text: 'sdfsfaaaa' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /remark sent/ })).toBeDefined()

  // Sending the same text again (the field still showed it): nothing.
  await ui.input({ key: 'remark-2', text: 'sdfsfaaaa' })
  await ui.input({ key: 'remark-2', text: 'sdfsfaaaa' })
  expect(sent).toEqual(['T3 (no decision yet)\n↳ Remark: sdfsfaaaa'])

  // Another remark does go, and the confirmation disappears while typing.
  await ui.input({ key: 'remark-2', text: 'something else', kind: 'change' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /remark sent/ })).toBeUndefined()
  await ui.input({ key: 'remark-2', text: 'something else' })
  expect(sent.at(-1)).toBe('T3 (no decision yet)\n↳ Remark: something else')
})

test('a decision after an earlier remark is sent normally', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'remark-0', text: 'hmm' })
  await ui.press({ key: 'agree-0' })
  await ui.input({ key: 'remark-0', text: 'hmm' })
  expect(sent).toEqual(['T1 (no decision yet)\n↳ Remark: hmm', 'T1 agree: tea on Tuesday\n↳ Remark: hmm'])
})

test('after Hide: a row with Restore brings everything back, with choices and remarks', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'agree-1' })
  await ui.input({ key: 'remark-2', text: 'with felt pads', kind: 'change' })
  await ui.press({ key: 'hide' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /3 decisions hidden/ })).toBeDefined()

  await ui.press({ key: 'restore' })
  await ui.redraw()
  expect((await ui.find({ key: 'agree-1' }))?.text).toContain('●')
  expect(await ui.find({ type: 'Text', text: /hidden/ })).toBeUndefined()

  // Restored is no longer hidden: a call with those labels updates them normally.
  const res = await $.tool.call({ tool: TOOL, ...EN, proposals: [PROPOSALS[0]!] })
  expect(String(res.result)).not.toContain('hidden')
})

test('the Restore row goes away on the next message; /decisions still works', async ($, on) => {
  setup(on)
  on('command.run', () => ({ text: '' }))

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'hide' })
  await $.prompt.submit({ text: 'something else' } as Parameters<typeof $.prompt.submit>[0])
  await ui.redraw()
  expect(await ui.find({ key: 'restore' })).toBeUndefined()

  const back = await $.command.run({ command: 'decisions', args: '' } as Parameters<typeof $.command.run>[0])
  expect(back.text).toContain('3 decision(s)')
  await ui.redraw()
  expect(await ui.find({ key: 'agree-0' })).toBeDefined()

  const empty = await $.command.run({ command: 'decisions', args: '' } as Parameters<typeof $.command.run>[0])
  expect(empty.text).toContain('No hidden decisions')
})

test('the send button with an empty field passed still sends the typed remark', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'remark-1', text: 'discuss first', kind: 'change' })
  // As the app may do on a click on the button: Enter with an empty field.
  await ui.input({ key: 'remark-1', text: '' })
  expect(sent).toEqual(['T2 (no decision yet)\n↳ Remark: discuss first'])
})

test('a long remark is shown in full below the field', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const long = 'this is a fairly long remark that does not fit in one narrow field and belongs below it'
  // The line shows the committed text: after another action, here a choice.
  await ui.input({ key: 'remark-0', text: long, kind: 'change' })
  await ui.press({ key: 'agree-1' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: long })).toBeDefined()
  await ui.input({ key: 'remark-0', text: 'short', kind: 'change' })
  await ui.press({ key: 'agree-1' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: long })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'short' })).toBeUndefined()
})

test('collapsing shows a summary; expanding brings the rows back', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'agree-0' })
  await ui.input({ key: 'remark-2', text: 'with felt pads', kind: 'change' })
  await ui.press({ key: 'toggle' })
  await ui.redraw()
  expect(await ui.find({ key: 'agree-0' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: ['T1 ✓', 'T2 ○', 'T3 ○ ✎'].join(S) })).toBeDefined()

  // Collapsed you can still send everything.
  await ui.press({ key: 'send-all' })
  expect(sent.at(-1)).toBe('T1 agree: tea on Tuesday\n\nT3 (no decision yet)\n↳ Remark: with felt pads')

  await ui.press({ key: 'toggle' })
  await ui.redraw()
  expect(await ui.find({ key: 'agree-0' })).toBeDefined()
})

test('collapsed and too narrow for two lines: only the counts', async ($, on) => {
  setup(on)

  const many = Array.from({ length: 7 }, (_, i) => ({ label: 'Decision' + (i + 1), text: `proposal ${i + 1}` }))
  await $.tool.call({ tool: TOOL, ...EN, proposals: many })
  const wide = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 200 } })
  await wide.press({ key: 'agree-0' })
  await wide.press({ key: 'disagree-1' })
  await wide.press({ key: 'agree-2' })
  await wide.press({ key: 'toggle' })
  await wide.redraw()
  expect(await wide.find({ type: 'Text', text: '4 open and 3 decided' })).toBeUndefined()
  const full = ['Decision1 ✓', 'Decision2 ✗', 'Decision3 ✓', ...[4, 5, 6, 7].map(n => 'Decision' + n + ' ○')].join(S)
  expect(await wide.find({ type: 'Text', text: full })).toBeDefined()
  await wide.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const narrow = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns: 50 } })
    expect(await narrow.find({ type: 'Text', text: '4 open and 3 decided' })).toBeDefined()
    await narrow.unmount()
  }
})

test('mini summary: a count of zero is left out', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 20 } })
  await ui.press({ key: 'toggle' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: '3 open' })).toBeDefined()

  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'agree-0' })
  await ui.press({ key: 'toggle' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: '2 open and 1 decided' })).toBeDefined()

  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'agree-1' })
  await ui.press({ key: 'disagree-2' })
  await ui.press({ key: 'toggle' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: '3 decided' })).toBeDefined()
})

test('the heading counts open and chosen apart; the mini summary counts remarks', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 25 } })
  expect(await ui.find({ type: 'Text', text: '3 open' })).toBeDefined()

  await ui.press({ key: 'agree-0' })
  await ui.input({ key: 'remark-1', text: 'rather purple', kind: 'change' })
  await ui.input({ key: 'remark-2', text: 'why four?', kind: 'change' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: `2 open${S}1 chosen` })).toBeDefined()

  await ui.press({ key: 'toggle' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: `2 open and 1 decided${S}2 ✎` })).toBeDefined()
})

test('in English: no request for a translation', async ($, on) => {
  setup(on)

  const res = await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  expect(String(res.result)).not.toContain('translation')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ key: 'hide' }))?.text).toContain('Hide')
})

test('a language translated before 1.4 is asked only for the new texts', async ($, on) => {
  setup(on)

  // As kept by 1.3: the old key for the "nothing to send" toast, no key for the menu's empty entry.
  const { chooseAnswer: _c, nothingToSend: _n, ...before } = NL
  await $.tool.call({
    tool: TOOL,
    language: 'nl',
    translation: { ...before, nothingToSendDecision: 'Niets te versturen: kies akkoord of niet akkoord.' },
  })
  const res = await $.tool.call({ tool: TOOL, language: 'nl' })
  const result = String(res.result)
  expect(result).toContain('"chooseAnswer"')
  expect(result).toContain('"nothingToSend"')
  expect(result).not.toContain('"agree"')
})

test('a new language: English until Claude supplies the texts, and only what is missing is asked for', async ($, on) => {
  setup(on)

  const first = await $.tool.call({ tool: TOOL, language: 'de-AT', proposals: PROPOSALS })
  expect(String(first.result)).toContain('language "de"')
  expect(String(first.result)).toContain('"agree":"agree"')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'agree-0' }))?.text).toContain('agree')

  // Part of it, with one translation that lost a {placeholder}: that one is not used.
  const then = await $.tool.call({
    tool: TOOL,
    language: 'de',
    translation: { agree: 'zustimmen', hide: 'Ausblenden', open: 'offen', unknown: 'x' },
  })
  await ui.redraw()
  expect((await ui.find({ key: 'agree-0' }))?.text).toContain('zustimmen')
  expect((await ui.find({ key: 'hide' }))?.text).toContain('Ausblenden')
  expect(String(then.result)).toContain('Not used from translation')
  expect(String(then.result)).toContain('"open":"{n} open"')
  expect(String(then.result)).not.toContain('"agree"')
})

test('a translation once supplied is kept, also after switching language', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, language: 'nl', translation: NL, proposals: PROPOSALS })
  await $.tool.call({ tool: TOOL, ...EN })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ key: 'hide' }))?.text).toContain('Hide')

  const back = await $.tool.call({ tool: TOOL, language: 'NL' })
  expect(String(back.result)).not.toContain('translation')
  await ui.redraw()
  expect((await ui.find({ key: 'hide' }))?.text).toContain('Verberg')
  // The messages that go back are in the bar's language too.
  await ui.press({ key: 'disagree-1' })
  await ui.input({ key: 'remark-1', text: 'liever paars' })
  expect(sent.at(-1)).toBe('T2 niet akkoord: orange penguin\n↳ Opmerking: liever paars')
})

test('a call with only a language switches it and leaves rows, choices and remarks', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, language: 'nl', translation: NL, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'agree-0' })
  await ui.input({ key: 'remark-1', text: 'rather purple', kind: 'change' })

  const res = await $.tool.call({ tool: TOOL, ...EN })
  expect(String(res.result)).toContain('Now open in the bar: T1, T2, T3')
  await ui.redraw()
  expect((await ui.find({ key: 'agree-0' }))?.text).toContain('● agree')
  expect((await ui.find({ key: 'remark-1' }))?.text).toContain('rather purple')
})

test('with one row the bottom buttons say Send and Agree; with more they stay plural', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [PROPOSALS[0]!] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'agree-0' })
  await ui.redraw()
  expect((await ui.find({ key: 'send-all' }))?.text).toBe('Send')
  expect((await ui.find({ key: 'agree-all' }))?.text).toBe('Agree')

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  await ui.redraw()
  expect((await ui.find({ key: 'send-all' }))?.text).toBe('Send all')
  expect((await ui.find({ key: 'agree-all' }))?.text).toBe('Agree to all')
})

test('typed text stays when the bar redraws for another reason', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'remark-1', text: 'half typed', kind: 'change' })
  // Meanwhile Claude puts a new decision in the bar; then a choice on another row.
  await $.tool.call({ tool: TOOL, ...EN, proposals: [{ label: 'T4', text: 'a fourth' }] })
  await ui.press({ key: 'agree-0' })
  await ui.redraw()
  expect((await ui.find({ key: 'remark-1' }))?.text).toContain('half typed')
  await ui.press({ key: 'send-all' })
  expect(sent.at(-1)).toContain('T2 (no decision yet)\n↳ Remark: half typed')
})

test('the full text is struck through while typing and comes back updated on another action', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const first = 'a first long remark that does not fit in the narrow field'
  await ui.input({ key: 'remark-0', text: first, kind: 'change' })
  await ui.press({ key: 'agree-1' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: first })).toBeDefined()

  const later = `${first}, with a bit more`
  await ui.input({ key: 'remark-0', text: later, kind: 'change' })
  await ui.redraw()
  // While typing: the old text struck through, the new one not yet.
  expect(await ui.find({ type: 'Text', text: first })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: later })).toBeUndefined()

  await ui.press({ key: 'agree-2' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: later })).toBeDefined()
})

test('typing in another field commits the previous one: its full text is updated', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const long = 'a long remark that does not fit in the narrow field, for row one'
  await ui.input({ key: 'remark-0', text: long, kind: 'change' })
  await ui.input({ key: 'remark-1', text: 'k', kind: 'change' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: long })).toBeDefined()
})

test('a label word longer than the column is broken with a hyphen', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [{ label: 'Settingsfilename', text: 'restore it' }] })
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: 'Settingsfile-\nname' })).toBeDefined()
  await term.unmount()
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desk.find({ type: 'Text', text: [...'Settingsfilename'].join('\u00AD') })).toBeDefined()
})

test('every message from the bar ends with a line break, so queued answers get a blank line between them', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'agree-0' })
  await ui.input({ key: 'remark-0', text: '' })
  // The sent row left the bar, so T2 is now the first row.
  await ui.press({ key: 'disagree-0' })
  await ui.input({ key: 'remark-0', text: '' })
  expect(raw).toEqual(['T1 agree: tea on Tuesday\n', 'T2 disagree: orange penguin\n'])
})

test('no limit on open decisions: twenty rows stay, none dropped', async ($, on) => {
  setup(on)

  const many = Array.from({ length: 20 }, (_, i) => ({ label: `D${i + 1}`, text: `proposal ${i + 1}` }))
  const res = await $.tool.call({ tool: TOOL, ...EN, proposals: many })
  expect(String(res.result)).toContain('D1, D2')
  expect(String(res.result)).toContain('D20.')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'agree-0' })).toBeDefined()
  expect(await ui.find({ key: 'agree-19' })).toBeDefined()
})

test('the tool call row in the chat shows the decisions, and a press there sets the choice in the bar', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const row = await $.ui.mount({
    plugin: 'decision-bar',
    surface: 'desktop',
    component: 'ToolUse',
    props: {
      tool_use_id: 'call-1',
      tool: TOOL,
      input: { language: 'en', proposals: PROPOSALS },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    } as unknown as RenderPropsOf['ToolUse'],
  })
  expect(await row.find({ type: 'Text', text: 'tea on Tuesday' })).toBeDefined()
  await row.press({ key: 'chat-call-1-agree-1' })
  const bar = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await bar.find({ key: 'agree-1' }))?.text).toContain('●')
})

test('the chat box sends only its own decisions, and then shows the sent answers', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS.slice(0, 2) })
  await $.tool.call({ tool: TOOL, ...EN, proposals: [PROPOSALS[2]!] })
  const box = {
    plugin: 'decision-bar',
    surface: 'desktop',
    component: 'ToolUse',
    props: {
      tool_use_id: 'call-1',
      tool: TOOL,
      input: { language: 'en', proposals: PROPOSALS.slice(0, 2) },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    } as unknown as RenderPropsOf['ToolUse'],
  } as const
  const row = await $.ui.mount(box)
  await row.press({ key: 'chat-call-1-agree-0' })
  await row.press({ key: 'chat-call-1-disagree-1' })
  await row.input({ key: 'chat-call-1-remark-1', text: 'rather purple', kind: 'change' })
  await row.press({ key: 'chat-call-1-send-box' })
  expect(sent.at(-1)).toBe('T1 agree: tea on Tuesday\n\nT2 disagree: orange penguin\n↳ Remark: rather purple')

  await row.redraw()
  expect(await row.find({ type: 'Text', text: '✓ agree' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: '✗ disagree' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: '↳ rather purple' })).toBeDefined()
  // T3 came from another call and is still open in the bar.
  const bar = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await bar.find({ key: 'agree-0' })).toBeDefined()
})

test('a group of tool calls with a decision box stays open; other groups are left alone', async ($, on) => {
  const seen: boolean[] = []
  on('ui.render', ($, e) => {
    if (e.component === 'ToolGroup') {
      seen.push((e.props as { isExpanded: boolean }).isExpanded)
    }
    const { Box } = $.ui.resolve(e)
    return <Box key="group" />
  })
  const group = (tool: string) =>
    ({
      plugin: 'decision-bar',
      surface: 'desktop',
      component: 'ToolGroup',
      props: {
        calls: [
          { tool: 'Bash', input: {}, isRunning: false },
          { tool, input: {}, isRunning: false },
        ],
        isActive: false,
        isExpanded: false,
      } as unknown as RenderPropsOf['ToolGroup'],
    }) as const
  await $.ui.mount(group(TOOL))
  await $.ui.mount(group('Read'))
  expect(seen).toEqual([true, false])
})

// The bar's list can be empty while old boxes are still in the chat (everything sent, or taken
// out with `remove`); the box then sizes its label column from its own proposals, not the bar's.
const chatRow = (proposals: typeof PROPOSALS) =>
  ({
    plugin: 'decision-bar',
    surface: 'desktop',
    component: 'ToolUse',
    props: {
      tool_use_id: 'call-1',
      tool: TOOL,
      input: { language: 'en', proposals },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    } as unknown as RenderPropsOf['ToolUse'],
  }) as const

test('a chat box still draws once remove has emptied the bar', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [PROPOSALS[0]!] })
  await $.tool.call({ tool: TOOL, ...EN, remove: ['T1'] })
  for (const surface of ['terminal', 'desktop'] as const) {
    const row = await $.ui.mount({ ...chatRow([PROPOSALS[0]!]), surface })
    expect(await row.find({ type: 'Text', text: 'tea on Tuesday' })).toBeDefined()
    expect(await row.find({ type: 'Text', text: 'closed' })).toBeDefined()
  }
})

test('a chat box still draws once everything in it was sent and the bar is empty', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS.slice(0, 2) })
  const row = await $.ui.mount(chatRow(PROPOSALS.slice(0, 2)))
  await row.press({ key: 'chat-call-1-agree-0' })
  await row.press({ key: 'chat-call-1-disagree-1' })
  await row.press({ key: 'chat-call-1-send-box' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const again = await $.ui.mount({ ...chatRow(PROPOSALS.slice(0, 2)), surface })
    expect(await again.find({ type: 'Text', text: '✓ agree' })).toBeDefined()
    expect(await again.find({ type: 'Text', text: '✗ disagree' })).toBeDefined()
  }
})

test('in the terminal a chat box shows the remark as text, without a field; the desktop keeps the field', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS.slice(0, 2) })
  const bar = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await bar.input({ key: 'remark-1', text: 'rather purple', kind: 'change' })
  await bar.press({ key: 'agree-0' })
  const terminal = await $.ui.mount({ ...chatRow(PROPOSALS.slice(0, 2)), surface: 'terminal' })
  expect(await terminal.find({ key: 'chat-call-1-remark-1' })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: '✎ rather purple' })).toBeDefined()
  const desktop = await $.ui.mount({ ...chatRow(PROPOSALS.slice(0, 2)), surface: 'desktop' })
  expect(await desktop.find({ key: 'chat-call-1-remark-1' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: '✎ rather purple' })).toBeUndefined()
})

// Visibility: the bar counts as visible where the app asked this mod itself to draw it (the bar or
// a chat box) on a surface that is attached now, or, with nothing attached now, drew it in this
// session before: the desktop app attaches while the session is on screen. Another surface of the
// session (another mod's pane, a phone that never drew the bar) does not count. With nothing
// attached and nothing ever drawn, a side chat in the desktop app (never drawn) and a session the
// user has not opened yet look the same: the result leaves it to Claude, which knows which it is.
const NOT_VISIBLE = 'Not visible'
const NOT_SHOWN_YET = 'Not shown yet'

test('nothing attached, nothing drawn yet (a side chat, or not opened yet): Claude is told both, the rows stay', async ($, on) => {
  setup(on)
  on('session.surfaces', () => ({ value: [] }))

  const res = await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  expect(String(res.result)).toContain(NOT_SHOWN_YET)
  expect(String(res.result)).toContain('side chat')
  expect(String(res.result)).toContain('has not opened yet')
  expect(String(res.result)).not.toContain(NOT_VISIBLE)
  expect(String(res.result)).toContain('Now open in the bar: T1, T2, T3')
})

test('drawn earlier, nothing attached now (the user looks at another session): no warning', async ($, on) => {
  setup(on)
  let attached: 'desktop'[] = ['desktop']
  on('session.surfaces', () => ({ value: attached }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.unmount()
  attached = []

  const res = await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  expect(String(res.result)).not.toContain(NOT_VISIBLE)
  expect(String(res.result)).not.toContain(NOT_SHOWN_YET)
})

test('a chat box drawn earlier counts as drawn too', async ($, on) => {
  setup(on)
  let attached: 'desktop'[] = ['desktop']
  on('session.surfaces', () => ({ value: attached }))

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const box = await $.ui.mount({
    plugin: 'decision-bar',
    surface: 'desktop',
    component: 'ToolUse',
    props: {
      tool_use_id: 'call-1',
      tool: TOOL,
      input: { language: 'en', proposals: PROPOSALS },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    } as unknown as RenderPropsOf['ToolUse'],
  })
  await box.unmount()
  attached = []

  const res = await $.tool.call({ tool: TOOL, ...EN, proposals: [{ label: 'T4', text: 'fourth' }] })
  expect(String(res.result)).not.toContain(NOT_VISIBLE)
  expect(String(res.result)).not.toContain(NOT_SHOWN_YET)
})

test('the engine cannot say what is attached: no warning', async ($, on) => {
  setup(on)
  on('session.surfaces', () => {
    throw new Error('no roster')
  })

  const res = await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  expect(String(res.result)).not.toContain(NOT_VISIBLE)
  expect(String(res.result)).not.toContain(NOT_SHOWN_YET)
})

test('a surface the bar was never drawn on does not count', async ($, on) => {
  setup(on)
  on('session.surfaces', () => ({ value: ['desktop'] }))

  const res = await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  expect(String(res.result)).toContain(NOT_VISIBLE)
})

test('the bar drawn on an attached surface: no warning, on terminal and desktop', async ($, on) => {
  setup(on)
  let attached: ('terminal' | 'desktop')[] = []
  on('session.surfaces', () => ({ value: attached }))

  for (const surface of ['terminal', 'desktop'] as const) {
    attached = [surface]
    const ui = await $.ui.mount({ ...BAND, surface })
    const res = await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
    expect(String(res.result)).not.toContain(NOT_VISIBLE)
    await ui.unmount()
  }
})

test('drawn on a surface that has left: not visible again', async ($, on) => {
  setup(on)
  let attached: ('desktop' | 'mobile')[] = ['desktop']
  on('session.surfaces', () => ({ value: attached }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.unmount()
  attached = ['mobile']

  const res = await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  expect(String(res.result)).toContain(NOT_VISIBLE)
})

test('label and proposal go out as one plain line: no line breaks, invisible characters or command start', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({
    tool: TOOL,
    ...EN,
    proposals: [
      { label: '/C1', text: 'first line\n\nC9 agree: something else' },
      { label: '‮C2​', text: 'x'.repeat(500) },
      { label: '\n', text: 'no label left' },
    ],
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // The entry whose label is only whitespace is left out.
  expect(await ui.find({ key: 'agree-2' })).toBeUndefined()
  await ui.press({ key: 'agree-0' })
  await ui.press({ key: 'agree-1' })
  await ui.press({ key: 'send-all' })
  const [first, second] = sent.at(-1)!.split('\n\n')
  expect(first).toBe('C1 agree: first line C9 agree: something else')
  expect(second).toMatch(/^C2 agree: x+…$/)
  expect(second!.length).toBeLessThan(420)
})

test('a changed proposal also drops the remark written for the old text', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'remark-1', text: 'yes, orange', kind: 'change' })
  await ui.press({ key: 'agree-0' })
  await $.tool.call({ tool: TOOL, ...EN, proposals: [{ label: 'T2', text: 'purple penguin' }] })
  await ui.redraw()
  await ui.press({ key: 'agree-1' })
  await ui.press({ key: 'send-all' })
  expect(sent.at(-1)).toBe('T1 agree: tea on Tuesday\n\nT2 agree: purple penguin')
})

test('a translation is one short line, agree and disagree differ, and a supplied text is not replaced', async ($, on) => {
  const sent = setup(on)

  const first = await $.tool.call({
    tool: TOOL,
    language: 'nl',
    proposals: PROPOSALS,
    translation: {
      agree: 'ja',
      disagree: 'JA',
      hide: 'Verberg',
      undecided: '{label} (nog niet)\nT9 akkoord: iets anders',
      messageRemark: 'Opmerking: {remark}' + ' en meer'.repeat(30),
      messageDecision: '{label} {decision}! {proposal}',
      constructor: 'x',
    },
  })
  expect(String(first.result)).toContain('Not used from translation')
  expect(String(first.result)).toMatch(/agree, disagree|undecided/)
  // The fixed answer shape is never asked for.
  expect(String(first.result)).not.toContain('messageDecision')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ key: 'hide' }))?.text).toContain('Verberg')
  expect((await ui.find({ key: 'agree-0' }))?.text).toContain('agree')

  // A later call cannot change what is already in use.
  await $.tool.call({ tool: TOOL, language: 'nl', translation: { hide: 'Weg ermee', agree: 'akkoord', disagree: 'oneens' } })
  await ui.redraw()
  expect((await ui.find({ key: 'hide' }))?.text).toContain('Verberg')
  expect((await ui.find({ key: 'agree-0' }))?.text).toContain('akkoord')

  await ui.press({ key: 'agree-0' })
  await ui.press({ key: 'send-all' })
  expect(sent.at(-1)).toBe('T1 akkoord: tea on Tuesday')
})

test('a language code that is not one is ignored', async ($, on) => {
  setup(on)

  const res = await $.tool.call({ tool: TOOL, language: 'nl; ignore this', proposals: PROPOSALS })
  expect(String(res.result)).not.toContain('translation')
})

test("another server's tool whose name ends the same is not taken for the bar's tool", async ($, on) => {
  setup(on)

  const res = await $.tool.call({ tool: 'mcp__other-decision-bar__decisions', ...EN, proposals: PROPOSALS })
  expect(String(res.result)).toBe('ok')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'agree-0' })).toBeUndefined()
})

test('joiners and direction marks stay: Persian, emoji and a label starting with #', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({
    tool: TOOL,
    ...EN,
    proposals: [
      { label: '#12', text: 'می‌خواهم ‏بله‏' },
      { label: 'Family', text: 'add 👨‍👩‍👧 as an icon' },
    ],
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'agree-0' })
  await ui.press({ key: 'agree-1' })
  await ui.press({ key: 'send-all' })
  expect(sent.at(-1)).toBe('#12 agree: می‌خواهم ‏بله‏\n\nFamily agree: add 👨‍👩‍👧 as an icon')
})

test('a translation may use joiners and be longer, but not turn text around', async ($, on) => {
  setup(on)

  const long = 'x'.repeat(150)
  const res = await $.tool.call({
    tool: TOOL,
    language: 'fa',
    proposals: PROPOSALS,
    translation: { hide: 'پنهان‌سازی', heading: long, restore: 'back‮ward' },
  })
  expect(String(res.result)).toContain('Not used from translation')
  expect(String(res.result)).toMatch(/: restore\./)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ key: 'hide' }))?.text).toContain('پنهان‌سازی')
})

// Answers of its own: a decision whose answers are not agree or disagree. Two show as buttons,
// three or more as one menu (Select).
const TESTS = { label: 'R2', text: 'Run the tests?', options: ['Yes', 'Later'] }
const RELEASE = { label: 'R1', text: 'Commit the release.', options: ['Commit now', 'Run the tests first', 'Not yet'] }

test('two answers replace agree and disagree as buttons; the chosen one is sent as shown', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [PROPOSALS[0]!, TESTS] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'agree-1' })).toBeUndefined()
  expect((await ui.find({ key: 'answer-1-1' }))?.text).toContain('○ Later')
  // The first row keeps agree and disagree.
  expect(await ui.find({ key: 'agree-0' })).toBeDefined()

  await ui.press({ key: 'answer-1-1' })
  await ui.redraw()
  expect((await ui.find({ key: 'answer-1-1' }))?.text).toContain('● Later')
  // Pressed again: no choice.
  await ui.press({ key: 'answer-1-1' })
  await ui.redraw()
  expect((await ui.find({ key: 'answer-1-1' }))?.text).toContain('○')

  await ui.press({ key: 'answer-1-0' })
  await ui.input({ key: 'remark-1', text: 'after lunch' })
  expect(sent).toEqual(['R2 → Yes: Run the tests?\n↳ Remark: after lunch'])
  await ui.redraw()
  expect(await ui.find({ key: 'answer-1-0' })).toBeUndefined()
})

test('three or more answers are one menu; picking sets the choice, the empty entry clears it', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [RELEASE] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'answer-0-0' })).toBeUndefined()
  expect(await ui.find({ key: 'answers-0' })).toBeDefined()

  await ui.select({ key: 'answers-0', value: '1' })
  await ui.redraw()
  await ui.select({ key: 'answers-0', value: '' })
  await ui.press({ key: 'send-all' })
  // Cleared: nothing to send.
  expect(sent).toEqual([])

  await ui.select({ key: 'answers-0', value: '2' })
  await ui.press({ key: 'send-all' })
  expect(sent).toEqual(['R1 → Not yet: Commit the release.'])
})

test('on mobile, without a menu, three answers stay buttons (the chat box; mobile has no band)', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [RELEASE] })
  const row = await $.ui.mount({
    plugin: 'decision-bar',
    surface: 'mobile',
    component: 'ToolUse',
    props: {
      tool_use_id: 'call-1',
      tool: TOOL,
      input: { language: 'en', proposals: [RELEASE] },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    } as unknown as RenderPropsOf['ToolUse'],
  })
  expect(await row.find({ type: 'Text', text: 'Commit the release.' })).toBeDefined()
  expect(await row.find({ type: 'Select' })).toBeUndefined()
  expect(await row.find({ key: 'chat-call-1-answers-0' })).toBeUndefined()
  expect((await row.find({ key: 'chat-call-1-answer-0-2' }))?.text).toContain('Not yet')
})

test('"Agree to all" sends only the rows agree answers; rows with their own answers stay as they are', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [PROPOSALS[0]!, TESTS] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // A chosen answer and a remark on the other row do not go along.
  await ui.press({ key: 'answer-1-0' })
  await ui.input({ key: 'remark-1', text: 'quickly', kind: 'change' })
  // One row agree can answer: the singular label.
  expect((await ui.find({ key: 'agree-all' }))?.text).not.toContain('all')
  await ui.press({ key: 'agree-all' })
  expect(sent).toEqual(['T1 agree: tea on Tuesday'])
  await ui.redraw()
  expect((await ui.find({ key: 'answer-0-0' }))?.text).toContain('●')
  expect(await ui.find({ key: 'agree-all' })).toBeUndefined()
})

test('answers are two to four plain lines; fewer leaves agree and disagree', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({
    tool: TOOL,
    ...EN,
    proposals: [
      { label: 'A', text: 'one answer only', options: ['Yes'] },
      { label: 'B', text: 'too many', options: ['one', 'two', 'two', 'three\nlines', '', 'four', 'five'] },
    ],
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'agree-0' })).toBeDefined()
  expect(await ui.find({ key: 'answer-0-0' })).toBeUndefined()
  // Duplicates and empty ones go, line breaks become spaces, at most four: entry 2 is "three
  // lines", entry 3 "four", and there is no fifth.
  await ui.select({ key: 'answers-1', value: '2' })
  await ui.press({ key: 'send-all' })
  expect(sent.at(-1)).toBe('B → three lines: too many')
  // After sending, row 0 is the only one left before B came back; propose B again to pick "four".
  await $.tool.call({ tool: TOOL, ...EN, proposals: [{ label: 'B', text: 'too many', options: ['one', 'two', 'three\nlines', 'four', 'five'] }] })
  await ui.redraw()
  await ui.select({ key: 'answers-1', value: '3' })
  await ui.press({ key: 'send-all' })
  expect(sent.at(-1)).toBe('B → four: too many')
})

test('collapsed, a chosen answer shows as ●', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [PROPOSALS[0]!, TESTS] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'answer-1-1' })
  await ui.press({ key: 'toggle' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: ['T1 ○', 'R2 ●'].join(S) })).toBeDefined()
})

test('the chat box shows the answers, and after sending the chosen one', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [TESTS] })
  const row = await $.ui.mount({
    plugin: 'decision-bar',
    surface: 'desktop',
    component: 'ToolUse',
    props: {
      tool_use_id: 'call-1',
      tool: TOOL,
      input: { language: 'en', proposals: [TESTS] },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    } as unknown as RenderPropsOf['ToolUse'],
  })
  await row.press({ key: 'chat-call-1-answer-0-1' })
  await row.press({ key: 'chat-call-1-send-box' })
  expect(sent.at(-1)).toBe('R2 → Later: Run the tests?')
  await row.redraw()
  expect(await row.find({ type: 'Text', text: '→ Later' })).toBeDefined()
})

test('other answers for the same proposal start over: no old choice or remark confirmation', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [TESTS] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'remark-0', text: 'why now?' })
  expect(sent).toEqual(['R2 (no decision yet)\n↳ Remark: why now?'])
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /remark sent/ })).toBeDefined()

  await $.tool.call({ tool: TOOL, ...EN, proposals: [{ ...TESTS, options: ['Yes', 'No'] }] })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /remark sent/ })).toBeUndefined()
  // The same remark again is a new remark on a new proposal: it goes out.
  await ui.input({ key: 'remark-0', text: 'why now?' })
  expect(sent.at(-1)).toBe('R2 (no decision yet)\n↳ Remark: why now?')
})

test('Hide and Restore keep a chosen answer', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [TESTS] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'answer-0-1' })
  await ui.press({ key: 'hide' })
  await ui.redraw()
  await ui.press({ key: 'restore' })
  await ui.redraw()
  expect((await ui.find({ key: 'answer-0-1' }))?.text).toContain('●')
  await ui.press({ key: 'send-all' })
  expect(sent).toEqual(['R2 → Later: Run the tests?'])
})

test('in the terminal a row with its own answers lays out like the others', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [PROPOSALS[0]!, TESTS, RELEASE] })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'answer-1-0' }))?.text).toContain('Yes')
  expect(await ui.find({ key: 'answers-2' })).toBeDefined()
  expect(await ui.find({ key: 'remark-2' })).toBeDefined()

  // A chat row in the terminal takes no keys: three answers stay buttons there.
  const row = await $.ui.mount({
    plugin: 'decision-bar',
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      tool_use_id: 'call-1',
      tool: TOOL,
      input: { language: 'en', proposals: [RELEASE] },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    } as unknown as RenderPropsOf['ToolUse'],
  })
  expect(await row.find({ key: 'chat-call-1-answers-2' })).toBeUndefined()
  expect((await row.find({ key: 'chat-call-1-answer-2-2' }))?.text).toContain('Not yet')
})

test('Claude is told about answers of its own, and the tool takes them', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['desktop'],
    tools: [],
    outputStyle: null,
    traits: [],
  } as Parameters<typeof $.prompt.compose>[0])
  const text = composed.sections.map(sec => sec.text).join('\n')
  expect(text).toContain('`options` (optional)')
  expect(text).toContain('"<label> → <answer>: <proposal>"')
})

// Variant B: an answer may carry a longer text, shown below the row once chosen and sent in its
// place.
const DEPLOY = {
  label: 'D1',
  text: 'Deploy the fix.',
  options: [
    { label: 'Now', text: 'Deploy now and watch the error rate for an hour' },
    'Tomorrow',
  ],
}

test('an answer with a longer text shows it once chosen, and sends it', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [DEPLOY] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // The button shows the short label; the longer text is not on screen yet.
  expect((await ui.find({ key: 'answer-0-0' }))?.text).toContain('○ Now')
  expect(await ui.find({ key: 'answer-text-box-0' })).toBeUndefined()

  await ui.press({ key: 'answer-0-0' })
  await ui.redraw()
  expect((await ui.find({ key: 'answer-text-box-0' }))?.text).toBe('→ Deploy now and watch the error rate for an hour')

  await ui.press({ key: 'send-all' })
  expect(sent).toEqual(['D1 → Deploy now and watch the error rate for an hour: Deploy the fix.'])
})

test('an answer without a longer text sends its label, and shows no extra line', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: [DEPLOY] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'answer-0-1' })
  await ui.redraw()
  expect(await ui.find({ key: 'answer-text-box-0' })).toBeUndefined()
  await ui.press({ key: 'send-all' })
  expect(sent).toEqual(['D1 → Tomorrow: Deploy the fix.'])
})

test('in a menu too, the chosen answer shows its longer text; the chat box shows what was sent', async ($, on) => {
  const sent = setup(on)

  const plan = {
    label: 'P1',
    text: 'Plan the release.',
    options: ['Friday', { label: 'Monday', text: 'Monday, after the stand-up' }, { label: 'Later', text: 'Later' }],
  }
  await $.tool.call({ tool: TOOL, ...EN, proposals: [plan] })
  const row = await $.ui.mount({
    plugin: 'decision-bar',
    surface: 'desktop',
    component: 'ToolUse',
    props: {
      tool_use_id: 'call-1',
      tool: TOOL,
      input: { language: 'en', proposals: [plan] },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    } as unknown as RenderPropsOf['ToolUse'],
  })
  await row.select({ key: 'chat-call-1-answers-0', value: '1' })
  await row.redraw()
  expect((await row.find({ key: 'chat-call-1-answer-text-box-0' }))?.text).toBe('→ Monday, after the stand-up')
  // A longer text equal to its label adds nothing.
  await row.select({ key: 'chat-call-1-answers-0', value: '2' })
  await row.redraw()
  expect(await row.find({ key: 'chat-call-1-answer-text-box-0' })).toBeUndefined()

  await row.select({ key: 'chat-call-1-answers-0', value: '1' })
  await row.press({ key: 'chat-call-1-send-box' })
  expect(sent.at(-1)).toBe('P1 → Monday, after the stand-up: Plan the release.')
  await row.redraw()
  expect(await row.find({ type: 'Text', text: '→ Monday, after the stand-up' })).toBeDefined()
})

test('a longer text is one plain line of limited length', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({
    tool: TOOL,
    ...EN,
    proposals: [{ label: 'L', text: 'long', options: [{ label: 'A', text: `two\nlines ${'x'.repeat(300)}` }, 'B'] }],
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'answer-0-0' })
  await ui.press({ key: 'send-all' })
  const answer = sent[0]!.slice('L → '.length, -': long'.length)
  expect(answer.startsWith('two lines x')).toBe(true)
  expect(answer.endsWith('…')).toBe(true)
  expect([...answer].length).toBe(200)
})

// mergeProposals on its own: how a tool call's proposals join the rows already in the bar.
const row = (label: string, text: string, d: Row['d'] = null, r = ''): Row => ({ p: { label, text }, d, r })
// A question as 1.2.9 copied it from the next-step box into the bar. Its `options` are 1.2.9's
// objects, not this version's answer labels, so it is no Row by today's type.
const QUESTION = {
  p: { label: 'Question', text: 'Commit?', options: [{ label: 'Yes', text: 'Yes, commit' }] },
  d: null,
  r: 'later',
} as unknown as Row

test('merge: new labels go at the end; existing rows keep choice and remark', () => {
  const before = [row('T1', 'tea', 'agree', 'hot')]
  const merged = mergeProposals(before, [{ label: 'T1', text: 'tea' }, { label: 'T2', text: 'penguin' }], new Set(), [])
  expect(merged.rows).toEqual([row('T1', 'tea', 'agree', 'hot'), row('T2', 'penguin')])
  expect(merged.added).toEqual(['T2'])
  expect(merged.updated).toEqual([])
  expect(merged.removed).toEqual([])
  expect(merged.skipped).toEqual([])
})

test('merge: an updated proposal starts again without its choice and its remark', () => {
  const merged = mergeProposals([row('T1', 'tea', 'disagree', 'too hot')], [{ label: 'T1', text: 'coffee' }], new Set(), [])
  expect(merged.rows).toEqual([row('T1', 'coffee')])
  expect(merged.updated).toEqual(['T1'])
  expect(merged.added).toEqual([])
})

test('merge: remove takes out rows that were there, not a label proposed in the same call', () => {
  const before = [row('T1', 'tea', 'agree'), row('T2', 'penguin')]
  const merged = mergeProposals(before, [{ label: 'T3', text: 'four legs' }], new Set(['T1', 'T3', 'gone']), [])
  expect(merged.rows).toEqual([row('T2', 'penguin'), row('T3', 'four legs')])
  expect(merged.removed).toEqual(['T1'])
  expect(merged.added).toEqual(['T3'])
})

test('merge: a label the user hid is skipped, and the rows passed in are left as they were', () => {
  const before = [row('T1', 'tea', 'agree', 'hot')]
  const copy = JSON.parse(JSON.stringify(before))
  const merged = mergeProposals(
    before,
    [{ label: 'T1', text: 'coffee' }, { label: 'T2', text: 'penguin' }],
    new Set(),
    ['T2'],
  )
  expect(merged.rows).toEqual([row('T1', 'coffee')])
  expect(merged.skipped).toEqual(['T2'])
  expect(before).toEqual(copy)
})

test('a question copied by 1.2.9 goes; decisions keep choice and remark', () => {
  const before = [row('T1', 'tea', 'agree', 'hot'), QUESTION, row('T2', 'penguin')]
  expect(withoutQuestions(before)).toEqual([row('T1', 'tea', 'agree', 'hot'), row('T2', 'penguin')])
})

test('merge: other answers start the proposal again without its choice and remark', () => {
  const before: Row[] = [{ p: RELEASE, d: 1, r: 'soon' }]
  const merged = mergeProposals(before, [{ ...RELEASE, options: ['Commit now', 'Not yet'] }], new Set(), [])
  expect(merged.rows).toEqual([{ p: { ...RELEASE, options: ['Commit now', 'Not yet'] }, d: null, r: '' }])
  expect(merged.updated).toEqual(['R1'])
  // The same answers again: choice and remark stay.
  expect(mergeProposals(before, [RELEASE], new Set(), []).rows).toEqual(before)
})

test('answer buttons are not taken for a question copied by 1.2.9', () => {
  const before: Row[] = [{ p: RELEASE, d: 0, r: '' }, QUESTION]
  expect(withoutQuestions(before)).toEqual([{ p: RELEASE, d: 0, r: '' }])
})

test('merge: another longer text for an answer starts the proposal again', () => {
  const p = { label: 'D1', text: 'Deploy the fix.', options: ['Now', 'Tomorrow'], details: ['Deploy now', ''] }
  const before: Row[] = [{ p, d: 0, r: 'ok' }]
  const changed = { ...p, details: ['Deploy now and watch it', ''] }
  expect(mergeProposals(before, [changed], new Set(), []).rows).toEqual([{ p: changed, d: null, r: '' }])
  expect(mergeProposals(before, [p], new Set(), []).rows).toEqual(before)
})

test('the closing-question rule follows the setting: in the bar always, or only while decisions are open', () => {
  expect(instructions(true)).toContain('also when no other decisions are open')
  expect(instructions(false)).toContain('when the bar has open decisions at the end of your turn')
  expect(instructions(false)).not.toContain('also when no other decisions are open')
  // Either way, not where the bar cannot be seen.
  for (const questionInBar of [true, false]) {
    expect(instructions(questionInBar)).toContain('"Not visible", or "Not shown yet" in a side chat): then the box is the place to ask')
  }
})

test('a duplicate answer lends its text to the first one without; a row with texts survives the 1.2.9 clean-up', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({
    tool: TOOL,
    ...EN,
    proposals: [{ label: 'D', text: 'Deploy.', options: ['Now', { label: 'Now', text: 'Now, and watch it' }, 'Later'] }],
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'answer-0-0' })
  await ui.redraw()
  expect((await ui.find({ key: 'answer-text-box-0' }))?.text).toBe('→ Now, and watch it')
  // Two answers left: buttons, no third.
  expect(await ui.find({ key: 'answer-0-2' })).toBeUndefined()
  await ui.press({ key: 'send-all' })
  expect(sent).toEqual(['D → Now, and watch it: Deploy.'])

  const rowWithTexts: Row = { p: { label: 'X', text: 'x', options: ['A', 'B'], details: ['A long', ''] }, d: 0, r: '' }
  expect(withoutQuestions([rowWithTexts, QUESTION])).toEqual([rowWithTexts])
})
