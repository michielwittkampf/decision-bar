import { expect, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

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
  question: 'Vraag',
  agree: 'akkoord',
  disagree: 'niet akkoord',
  open: '{n} open',
  chosen: '{n} gekozen',
  decided: '{n} gemaakt',
  and: 'en',
  remarkField: 'opmerking (optioneel)',
  answerField: 'of typ je eigen antwoord',
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
  nothingToSendAnswer: 'Niets te versturen: typ eerst een antwoord.',
  nothingToSendDecision: 'Niets te versturen: kies akkoord of niet akkoord, of typ een opmerking.',
  messageDecision: '{label} {decision}: {proposal}',
  messageNoDecision: '{label} (nog geen beslissing), opmerking: {remark}',
  messageRemark: 'Opmerking: {remark}',
  messageQuestion: 'Op je vraag "{question}": {answer}',
  commandRestored: '{n} beslissing(en) staan weer boven het invoerveld.',
  commandEmpty: 'Er zijn geen verborgen beslissingen om terug te halen.',
}

const PROPOSALS = [
  { label: 'T1', text: 'tea on Tuesday' },
  { label: 'T2', text: 'orange penguin' },
  { label: 'T3', text: 'four legs' },
]

// What sits below the plugin: an empty band, and a prompt.submit that catches what is sent.
const setup = (on: On) => {
  const sent: string[] = []
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="empty" />
  })
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
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
    'T1 agree: tea on Tuesday\n\nT2 disagree: orange penguin\n↳ Remark: rather purple\n\nT3 (no decision yet), remark: why four?',
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
  expect(sent).toEqual(['T1 (no decision yet), remark: why tea?'])

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
  actions: [{ label: 'Yes, commit', message: 'Yes, commit it.' }, { label: 'No' }, { action: 'create_pr' }],
}

test('the question from the next-step box comes into the bar and stays', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  await $.tool.call(WRAP_UP)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: 'Shall I commit it?' })).toBeDefined()
  expect((await ui.find({ key: 'option-3-0' }))?.text).toContain('Yes, commit')
  expect((await ui.find({ key: 'option-3-1' }))?.text).toContain('No')
  // An app action without text is left out.
  expect(await ui.find({ key: 'option-3-2' })).toBeUndefined()

  await $.prompt.submit({ text: 'something else' } as Parameters<typeof $.prompt.submit>[0])
  await ui.redraw()
  expect(await ui.find({ key: 'option-3-0' })).toBeDefined()

  await ui.press({ key: 'option-3-0' })
  expect(sent.at(-1)).toBe('Yes, commit it.')
  await ui.redraw()
  expect(await ui.find({ key: 'option-3-0' })).toBeUndefined()
  // The decisions are still there.
  expect(await ui.find({ key: 'agree-0' })).toBeDefined()
})

test('a button without its own text sends its label; an own answer works too', async ($, on) => {
  const sent = setup(on)

  await $.tool.call(WRAP_UP)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'remark-0', text: 'run the tests first' })
  expect(sent).toEqual(['On your question "Shall I commit it?": run the tests first'])
  await ui.redraw()
  expect(await ui.find({ key: 'option-0-1' })).toBeUndefined()

  await $.tool.call(WRAP_UP)
  await ui.redraw()
  await ui.press({ key: 'option-0-1' })
  expect(sent.at(-1)).toBe('No')
})

test('a new end question replaces the previous one; new decisions leave the question', async ($, on) => {
  setup(on)

  await $.tool.call(WRAP_UP)
  await $.tool.call({ ...WRAP_UP, ask: 'Second question?' })
  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Shall I commit it?' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Second question?' })).toBeDefined()
  expect(await ui.find({ key: 'agree-2' })).toBeDefined()
})

test('an end question without answer buttons does not come into the bar', async ($, on) => {
  setup(on)

  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Done.' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'hide' })).toBeUndefined()
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
  expect(sent).toEqual(['T3 (no decision yet), remark: sdfsfaaaa'])

  // Another remark does go, and the confirmation disappears while typing.
  await ui.input({ key: 'remark-2', text: 'something else', kind: 'change' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /remark sent/ })).toBeUndefined()
  await ui.input({ key: 'remark-2', text: 'something else' })
  expect(sent.at(-1)).toBe('T3 (no decision yet), remark: something else')
})

test('a decision after an earlier remark is sent normally', async ($, on) => {
  const sent = setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'remark-0', text: 'hmm' })
  await ui.press({ key: 'agree-0' })
  await ui.input({ key: 'remark-0', text: 'hmm' })
  expect(sent).toEqual(['T1 (no decision yet), remark: hmm', 'T1 agree: tea on Tuesday\n↳ Remark: hmm'])
})

test("answered in the app's own box: the question also leaves the bar", async ($, on) => {
  setup(on)

  await $.tool.call({ tool: TOOL, ...EN, proposals: PROPOSALS })
  await $.tool.call(WRAP_UP)
  await $.prompt.submit({ text: 'Yes, commit it.' } as Parameters<typeof $.prompt.submit>[0])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Shall I commit it?' })).toBeUndefined()
  expect(await ui.find({ key: 'agree-0' })).toBeDefined()
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
  expect(sent).toEqual(['T2 (no decision yet), remark: discuss first'])
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
  expect(sent.at(-1)).toBe('T1 agree: tea on Tuesday\n\nT3 (no decision yet), remark: with felt pads')

  await ui.press({ key: 'toggle' })
  await ui.redraw()
  expect(await ui.find({ key: 'agree-0' })).toBeDefined()
})

test('collapsed and too narrow for two lines: only the counts', async ($, on) => {
  setup(on)

  const many = Array.from({ length: 7 }, (_, i) => ({ label: `Decision${i + 1}`, text: `proposal ${i + 1}` }))
  await $.tool.call({ tool: TOOL, ...EN, proposals: many })
  const wide = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 200 } })
  await wide.press({ key: 'agree-0' })
  await wide.press({ key: 'disagree-1' })
  await wide.press({ key: 'agree-2' })
  await wide.press({ key: 'toggle' })
  await wide.redraw()
  expect(await wide.find({ type: 'Text', text: '4 open and 3 decided' })).toBeUndefined()
  const full = ['Decision1 ✓', 'Decision2 ✗', 'Decision3 ✓', ...[4, 5, 6, 7].map(n => `Decision${n} ○`)].join(S)
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
  expect(sent.at(-1)).toContain('T2 (no decision yet), remark: half typed')
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
